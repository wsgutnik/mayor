import * as THREE from "three";
import { CityState } from "../sim/sim";
import { ZONE, FAC, COVER, LAND_VALUE_LAYER, FacilityKind, idx, tileHeight, isLand, World } from "../sim/world";
import { CameraRig } from "./camera";

const BUILD_H = {
  [ZONE.RES]: [0, 0.55, 1.0, 1.7],
  [ZONE.COM]: [0, 0.7, 1.5, 2.6],
  [ZONE.IND]: [0, 0.6, 0.9, 1.2],
} as const;

const ZONE_TILE = {
  [ZONE.RES]: new THREE.Color("#4fbf6a"),
  [ZONE.COM]: new THREE.Color("#4a8fe0"),
  [ZONE.IND]: new THREE.Color("#e0b43a"),
} as const;

const BUILD_COLOR = {
  [ZONE.RES]: new THREE.Color("#c9d8c0"),
  [ZONE.COM]: new THREE.Color("#b6c9ea"),
  [ZONE.IND]: new THREE.Color("#d8c690"),
} as const;

/** Facility look: [height, footprint, color]. */
const FACILITY_LOOK = {
  [FAC.POWER]: [1.9, 0.7, new THREE.Color("#f2c230")],
  [FAC.WATER]: [1.0, 0.7, new THREE.Color("#39b6e8")],
  [FAC.SEWAGE]: [0.6, 0.8, new THREE.Color("#8a6a4a")],
  [FAC.LANDFILL]: [0.45, 0.9, new THREE.Color("#7d848c")],
  [FAC.POLICE]: [0.9, 0.8, new THREE.Color("#2f5fd0")],
  [FAC.FIRE]: [0.9, 0.8, new THREE.Color("#e0453a")],
  [FAC.CLINIC]: [0.8, 0.8, new THREE.Color("#e8eef5")],
  [FAC.SCHOOL]: [0.8, 0.9, new THREE.Color("#f08a3c")],
  [FAC.PARK]: [0.1, 0.96, new THREE.Color("#3fa34d")],
} as const;

/** 0 = off, a COVER bit, or LAND_VALUE_LAYER. */
export type OverlayLayer = number;

export const OVERLAY_COLOR: Record<number, string> = {
  [COVER.POWER]: "#f2c230",
  [COVER.WATER]: "#2ea8e8",
  [COVER.SEWAGE]: "#a07848",
  [COVER.GARBAGE]: "#9aa3ad",
  [COVER.POLICE]: "#3d6ee8",
  [COVER.FIRE]: "#ee5a4c",
  [COVER.HEALTH]: "#f2f6fb",
  [COVER.EDU]: "#f59a4a",
  [COVER.PARK]: "#48b85a",
};

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class CityRenderer {
  readonly rig: CameraRig;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private terrain!: THREE.Mesh;
  private terrainGeo!: THREE.PlaneGeometry;
  private roads!: THREE.InstancedMesh;
  private zones!: THREE.InstancedMesh;
  private buildings!: THREE.InstancedMesh;
  private facilities!: THREE.InstancedMesh;
  private overlay!: THREE.InstancedMesh;
  private overlayLayer: OverlayLayer = 0;
  private overlaySeen = -1;
  private overlayLvSeen = -1;
  private hover: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private seenRevision = -1;
  private dummy = new THREE.Object3D();
  private world: World;

  constructor(private container: HTMLElement, state: CityState) {
    this.world = state.world;
    const size = this.world.size;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color("#a9c8e8");
    this.scene.fog = new THREE.Fog("#a9c8e8", 90, 260);
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#6b7a5a", 1.35));
    const sun = new THREE.DirectionalLight("#fff4de", 1.8);
    sun.position.set(-40, 70, 30);
    this.scene.add(sun);

    this.rig = new CameraRig(1, size);
    this.rig.target.set(8, 0, this.world.entry.y + 0.5);

    this.buildTerrain();
    const cap = size * size;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mk = (mat: THREE.Material) => {
      const m = new THREE.InstancedMesh(box, mat, cap);
      m.count = 0;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    this.roads = mk(new THREE.MeshLambertMaterial({ color: "#3b3f46" }));
    this.zones = mk(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    this.buildings = mk(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    this.facilities = mk(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    this.overlay = mk(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5, depthWrite: false }));

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 3, size * 3).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: "#3c78b4", transparent: true, opacity: 0.88 }),
    );
    water.position.set(size / 2, -0.02, size / 2);
    this.scene.add(water);

    this.hover = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 0.12, 1.02),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55 }),
    );
    this.hover.visible = false;
    this.scene.add(this.hover);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private buildTerrain(): void {
    const n = this.world.size;
    this.terrainGeo = new THREE.PlaneGeometry(n, n, n, n);
    this.terrainGeo.rotateX(-Math.PI / 2);
    this.terrainGeo.translate(n / 2, 0, n / 2);
    this.terrainGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array((n + 1) * (n + 1) * 3), 3),
    );
    this.terrain = new THREE.Mesh(
      this.terrainGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    this.scene.add(this.terrain);
  }

  private updateTerrain(): void {
    const s = this.world.size + 1;
    const pos = this.terrainGeo.attributes.position as THREE.BufferAttribute;
    const col = this.terrainGeo.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < s * s; i++) {
      const h = this.world.heights[i];
      pos.setY(i, h);
      const j = (hash(i % s, (i / s) | 0) - 0.5) * 0.04;
      if (h < 0.3) c.set("#d6c690");
      else if (h < 2.4) c.set("#6f9b4e").offsetHSL(0, 0, j - h * 0.015);
      else c.set("#8b8678").offsetHSL(0, 0, j);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.terrainGeo.computeVertexNormals();
    this.terrainGeo.computeBoundingSphere();
  }

  private rebuild(): void {
    const w = this.world;
    this.updateTerrain();
    let nr = 0, nz = 0, nb = 0, nf = 0;
    const d = this.dummy;
    const color = new THREE.Color();
    for (let y = 0; y < w.size; y++) {
      for (let x = 0; x < w.size; x++) {
        const i = idx(w, x, y);
        const h = tileHeight(w, x, y);
        if (w.facility[i]) {
          const [fh, fw, fc] = FACILITY_LOOK[w.facility[i] as FacilityKind];
          d.position.set(x + 0.5, h + 0.04 + fh / 2, y + 0.5);
          d.scale.set(fw, fh, fw);
          d.updateMatrix();
          this.facilities.setMatrixAt(nf, d.matrix);
          this.facilities.setColorAt(nf++, fc);
        } else if (w.road[i]) {
          // Pad extends below the surface so sloped neighbours never poke through.
          d.position.set(x + 0.5, h + 0.06 - 0.5, y + 0.5);
          d.scale.set(1, 1.0, 1);
          d.updateMatrix();
          this.roads.setMatrixAt(nr++, d.matrix);
        } else if (w.zone[i]) {
          const z = w.zone[i] as 1 | 2 | 3;
          d.position.set(x + 0.5, h + 0.04 - 0.5, y + 0.5);
          d.scale.set(0.97, 1.0, 0.97);
          d.updateMatrix();
          this.zones.setMatrixAt(nz, d.matrix);
          this.zones.setColorAt(nz++, ZONE_TILE[z]);
          const l = w.level[i];
          if (l) {
            const r = hash(x, y);
            const bh = BUILD_H[z][l] * (0.85 + r * 0.3);
            d.position.set(x + 0.5, h + 0.04 + bh / 2, y + 0.5);
            d.scale.set(0.62 + r * 0.14, bh, 0.62 + (1 - r) * 0.14);
            d.updateMatrix();
            this.buildings.setMatrixAt(nb, d.matrix);
            color.copy(BUILD_COLOR[z]).offsetHSL(0, 0, (r - 0.5) * 0.1 - (l - 1) * 0.03);
            this.buildings.setColorAt(nb++, color);
          }
        }
      }
    }
    for (const [m, n] of [[this.roads, nr], [this.zones, nz], [this.buildings, nb], [this.facilities, nf]] as const) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Show one service's coverage as a tinted layer; 0 hides it. */
  setOverlay(layer: OverlayLayer): void {
    this.overlayLayer = layer;
    this.overlaySeen = -1;
    this.overlayLvSeen = -1;
  }

  private rebuildOverlay(): void {
    const w = this.world;
    const m = this.overlay;
    this.overlaySeen = w.revision;
    this.overlayLvSeen = w.lvRevision;
    const layer = this.overlayLayer;
    if (!layer) { m.count = 0; return; }
    const isValue = layer === LAND_VALUE_LAYER;
    const flat = new THREE.Color(OVERLAY_COLOR[layer] ?? "#ffffff");
    const col = new THREE.Color();
    const d = this.dummy;
    let n = 0;
    for (let y = 0; y < w.size; y++) {
      for (let x = 0; x < w.size; x++) {
        const i = idx(w, x, y);
        if (!isLand(w, x, y)) continue;
        if (!isValue && !(w.cover[i] & layer)) continue;
        d.position.set(x + 0.5, tileHeight(w, x, y) + 0.12, y + 0.5);
        d.scale.set(0.98, 0.02, 0.98);
        d.updateMatrix();
        m.setMatrixAt(n, d.matrix);
        if (isValue) col.setHSL((w.landValue[i] / 100) * 0.33, 0.8, 0.5); // red (low) to green (high)
        else col.copy(flat);
        m.setColorAt(n, col);
        n++;
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** Tile under a client-space pointer, or null if it hits nothing. */
  pick(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (!hit) return null;
    const x = Math.floor(hit.point.x), y = Math.floor(hit.point.z);
    if (x < 0 || y < 0 || x >= this.world.size || y >= this.world.size) return null;
    return { x, y };
  }

  setHover(tile: { x: number; y: number } | null, color = "#ffffff"): void {
    if (!tile) { this.hover.visible = false; return; }
    const h = tileHeight(this.world, tile.x, tile.y);
    this.hover.position.set(tile.x + 0.5, h + 0.1, tile.y + 0.5);
    (this.hover.material as THREE.MeshBasicMaterial).color.set(color);
    this.hover.visible = true;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.rig.resize(w / h);
  }

  get viewportHeight(): number {
    return this.renderer.domElement.clientHeight;
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  render(): void {
    if (this.seenRevision !== this.world.revision) {
      this.seenRevision = this.world.revision;
      this.rebuild();
    }
    if (this.overlaySeen !== this.world.revision || (this.overlayLayer === LAND_VALUE_LAYER && this.overlayLvSeen !== this.world.lvRevision)) this.rebuildOverlay();
    this.renderer.render(this.scene, this.rig.camera);
  }
}
