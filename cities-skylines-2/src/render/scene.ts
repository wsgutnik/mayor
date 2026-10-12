import * as THREE from "three";
import { CityState } from "../sim/sim";
import {
  ZONE, COVER, LAND_VALUE_LAYER, TRAFFIC_LAYER, FacilityKind, idx, tileHeight, isLand, World,
  RoadSegment, RoadType, Pt, ROAD_DRAW_WIDTH, curvePoints, inBounds, heightAt, Biome,
} from "../sim/world";
import { CameraRig } from "./camera";
import { buildModels, makeWindowTextures, VARIANTS } from "./models";
import { TrafficState, ROAD_CAPACITY } from "../sim/traffic";

const ZONE_TILE = {
  [ZONE.RES]: new THREE.Color("#4fbf6a"),
  [ZONE.COM]: new THREE.Color("#4a8fe0"),
  [ZONE.IND]: new THREE.Color("#e0b43a"),
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
  [COVER.TRANSIT]: "#9b7bff",
};

/** Ground colours and tree density per terrain preset. */
const BIOME_LOOK: Record<Biome, { sand: string; grass: string; rock: string; rockAt: number; snowAt: number; trees: number; leaf: string[] }> = {
  plains: { sand: "#d6c690", grass: "#6f9b4e", rock: "#8b8678", rockAt: 2.4, snowAt: 99, trees: 0.035, leaf: ["#3f7a3a", "#4f8a43", "#5a9a4a"] },
  forest: { sand: "#cdbf8a", grass: "#527f3e", rock: "#7d7a6c", rockAt: 2.8, snowAt: 99, trees: 0.4, leaf: ["#2f6a34", "#3a7a3c", "#285c2c", "#4a8a3a"] },
  river: { sand: "#d6c690", grass: "#74a352", rock: "#8b8678", rockAt: 2.6, snowAt: 99, trees: 0.07, leaf: ["#3f7a3a", "#4f8a43"] },
  coast: { sand: "#e2d3a0", grass: "#79a856", rock: "#8b8678", rockAt: 2.6, snowAt: 99, trees: 0.05, leaf: ["#3f7a3a", "#5a9a4a"] },
  mountain: { sand: "#bdb59a", grass: "#628554", rock: "#85817a", rockAt: 3.2, snowAt: 7.2, trees: 0.12, leaf: ["#2f6a34", "#285c2c"] },
  desert: { sand: "#dcc084", grass: "#d2b57a", rock: "#a9946a", rockAt: 3.0, snowAt: 99, trees: 0.012, leaf: ["#6f8f4a", "#7d9a52"] },
};

/** Minimum time between full scene rebuilds. */
const REBUILD_GAP_MS = 80;

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
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private rain!: THREE.LineSegments;
  private rainOn = false;
  private lastRebuildAt = 0;
  private pixelCap = 2;
  private pixelRatio = 1;
  private frameMs = 16;
  private slowFor = 0;
  private fastFor = 0;
  private lastFrameAt = 0;
  private roadMesh!: THREE.Mesh;
  private metroMesh!: THREE.Mesh;
  private stopMesh!: THREE.InstancedMesh;
  private trees!: THREE.InstancedMesh;
  private markMesh!: THREE.InstancedMesh;
  private previewMesh!: THREE.Mesh;
  private zones!: THREE.InstancedMesh;
  private overlay!: THREE.InstancedMesh;
  private overlayLayer: OverlayLayer = 0;
  private vehicleMesh!: THREE.InstancedMesh;
  private traffic: TrafficState | null = null;
  private frame = 0;
  private overlaySeen = -1;
  private overlayLvSeen = -1;
  private hover: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private seenRevision = -1;
  private dummy = new THREE.Object3D();
  private world: World;
  private winMat!: THREE.MeshLambertMaterial;
  private plainMat!: THREE.MeshLambertMaterial;
  private bMeshes = new Map<string, THREE.InstancedMesh>();
  private fMeshes = new Map<number, THREE.InstancedMesh>();

  constructor(private container: HTMLElement, state: CityState) {
    this.world = state.world;
    const size = this.world.size;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.pixelCap = Math.min(window.devicePixelRatio, 2);
    this.pixelRatio = this.pixelCap;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color("#a9c8e8");
    this.scene.fog = new THREE.Fog("#a9c8e8", 90, 260);
    this.hemi = new THREE.HemisphereLight("#ffffff", "#6b7a5a", 1.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff4de", 1.8);
    this.sun.position.set(-40, 70, 30);
    this.scene.add(this.sun);
    this.buildRain();

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
    this.roadMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    this.roadMesh.frustumCulled = false;
    this.scene.add(this.roadMesh);
    this.metroMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    this.metroMesh.frustumCulled = false;
    this.scene.add(this.metroMesh);
    this.previewMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.previewMesh.frustumCulled = false;
    this.previewMesh.visible = false;
    this.scene.add(this.previewMesh);
    this.zones = mk(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    const tex = makeWindowTextures();
    this.winMat = new THREE.MeshLambertMaterial({
      map: tex.map, vertexColors: true, emissive: new THREE.Color("#ffd98a"), emissiveMap: tex.glow, emissiveIntensity: 0,
    });
    this.plainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const models = buildModels();
    const mkModel = (geo: THREE.BufferGeometry, capacity: number) => {
      const m = new THREE.InstancedMesh(geo, [this.winMat, this.plainMat], capacity);
      m.count = 0;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    for (const [k, g] of models.buildings) this.bMeshes.set(k, mkModel(g, Math.ceil(cap / 2)));
    for (const [k, g] of models.facilities) this.fMeshes.set(k, mkModel(g, Math.ceil(cap / 4)));
    this.trees = new THREE.InstancedMesh(new THREE.ConeGeometry(0.17, 0.62, 6).translate(0, 0.31, 0), new THREE.MeshLambertMaterial({ color: "#ffffff" }), cap);
    this.trees.count = 0;
    this.trees.frustumCulled = false;
    this.scene.add(this.trees);
    this.stopMesh = mk(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    this.markMesh = mk(new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    this.vehicleMesh = mk(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    this.vehicleMesh.count = 0;
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
    const look = BIOME_LOOK[this.world.biome];
    for (let i = 0; i < s * s; i++) {
      const h = this.world.heights[i];
      pos.setY(i, h);
      const j = (hash(i % s, (i / s) | 0) - 0.5) * 0.04;
      if (h < 0.3) c.set(look.sand);
      else if (h < look.rockAt) c.set(look.grass).offsetHSL(0, 0, j - h * 0.015);
      else if (h < look.snowAt) c.set(look.rock).offsetHSL(0, 0, j);
      else c.set("#eef2f6");
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
    this.rebuildRoads();
    let nz = 0, nt = 0;
    const counts = new Map<THREE.InstancedMesh, number>();
    const tint = new THREE.Color();
    const look = BIOME_LOOK[w.biome];
    const leaf = look.leaf.map((c) => new THREE.Color(c));
    const d = this.dummy;
    for (let y = 0; y < w.size; y++) {
      for (let x = 0; x < w.size; x++) {
        const i = idx(w, x, y);
        const h = tileHeight(w, x, y);
        if (w.facility[i]) {
          const mesh = this.fMeshes.get(w.facility[i] as FacilityKind);
          if (mesh) this.placeModel(mesh, counts, x, y, h, 1, tint.setScalar(1));
        } else if (w.road[i]) {
          // Drawn as ribbons (see buildRoadGeometry).
        } else if (!w.zone[i]) {
          // Open ground: scatter trees by terrain preset, never on water or the entry strip.
          const r = hash(x * 7 + 3, y * 13 + 5);
          if (r < look.trees && isLand(w, x, y) && h > 0.2 && h < look.rockAt + 1.5 && !(x < 7 && Math.abs(y - w.entry.y) < 3)) {
            const j1 = hash(x + 101, y + 211), j2 = hash(x + 307, y + 53);
            const sc = 0.8 + j1 * 0.9;
            d.position.set(x + 0.2 + j1 * 0.6, h, y + 0.2 + j2 * 0.6);
            d.scale.set(sc, sc * (0.9 + j2 * 0.5), sc);
            d.updateMatrix();
            this.trees.setMatrixAt(nt, d.matrix);
            this.trees.setColorAt(nt++, leaf[Math.floor(j2 * leaf.length) % leaf.length]);
          }
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
            const mesh = this.bMeshes.get(`${z}-${l}-${Math.floor(hash(x + 17, y + 29) * VARIANTS)}`);
            const shade = 0.9 + r * 0.2;
            if (mesh) this.placeModel(mesh, counts, x, y, h, 0.92 + r * 0.2, tint.setScalar(shade));
          }
        }
      }
    }
    this.trees.count = nt;
    this.trees.instanceMatrix.needsUpdate = true;
    if (this.trees.instanceColor) this.trees.instanceColor.needsUpdate = true;
    this.zones.count = nz;
    this.zones.instanceMatrix.needsUpdate = true;
    if (this.zones.instanceColor) this.zones.instanceColor.needsUpdate = true;
    for (const m of [...this.bMeshes.values(), ...this.fMeshes.values()]) {
      m.count = counts.get(m) ?? 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Yaw so a model's front (+z) faces the adjacent road, else a stable pseudo-random side. */
  private facing(x: number, y: number): number {
    const w = this.world;
    const road = (nx: number, ny: number) => inBounds(w, nx, ny) && w.road[ny * w.size + nx] > 0;
    if (road(x, y + 1)) return 0;
    if (road(x + 1, y)) return Math.PI / 2;
    if (road(x, y - 1)) return Math.PI;
    if (road(x - 1, y)) return -Math.PI / 2;
    return Math.floor(hash(x + 5, y + 9) * 4) * (Math.PI / 2);
  }

  private placeModel(mesh: THREE.InstancedMesh, counts: Map<THREE.InstancedMesh, number>, x: number, y: number, h: number, scaleY: number, tint: THREE.Color): void {
    const n = counts.get(mesh) ?? 0;
    if (n >= mesh.instanceMatrix.count) return;
    const d = this.dummy;
    d.position.set(x + 0.5, h + 0.04, y + 0.5);
    d.rotation.set(0, this.facing(x, y), 0);
    d.scale.set(1, scaleY, 1);
    d.updateMatrix();
    mesh.setMatrixAt(n, d.matrix);
    mesh.setColorAt(n, tint);
    counts.set(mesh, n + 1);
    d.rotation.set(0, 0, 0);
  }

  private groundY(x: number, z: number): number {
    return heightAt(this.world, x, z);
  }

  /**
   * Ribbon geometry for road segments: asphalt strip plus a centre line or median.
   * `tint` replaces the per-class colours (used for the build preview).
   */
  private buildRoadGeometry(segs: { type: RoadType; pts: Pt[]; width?: number; color?: string; lift?: number }[], tint?: THREE.Color): THREE.BufferGeometry {
    const pos: number[] = [];
    const col: number[] = [];
    const ind: number[] = [];
    const c = new THREE.Color();
    const strip = (samples: Pt[], halfW: number, lift: number, color: string) => {
      if (tint) c.copy(tint); else c.set(color);
      const base = pos.length / 3;
      for (let i = 0; i < samples.length; i++) {
        const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
        let tx = b.x - a.x, tz = b.z - a.z;
        const l = Math.hypot(tx, tz) || 1;
        tx /= l; tz /= l;
        const nx = -tz, nz = tx;
        const p = samples[i];
        const y = this.groundY(p.x, p.z) + lift;
        pos.push(p.x + nx * halfW, y, p.z + nz * halfW, p.x - nx * halfW, y, p.z - nz * halfW);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        if (i > 0) {
          const k = base + (i - 1) * 2;
          ind.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
    };
    segs.forEach((seg, n) => {
      const samples = curvePoints(seg.pts, 0.5);
      const lift = seg.lift ?? 0.07 + (n % 7) * 0.002;
      if (seg.color) { strip(samples, (seg.width ?? 0.3) / 2, lift, seg.color); return; }
      const hw = ROAD_DRAW_WIDTH[seg.type] / 2;
      strip(samples, hw, lift, seg.type === 3 ? "#4a4f57" : "#3b3f46");
      if (seg.type === 1) strip(samples, 0.04, lift + 0.01, "#6b717b");
      else if (seg.type === 2) strip(samples, 0.16, lift + 0.01, "#5f8a4a");
      else strip(samples, 0.14, lift + 0.01, "#b8bec6");
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(ind);
    g.computeVertexNormals();
    return g;
  }

  private rebuildRoads(): void {
    this.roadMesh.geometry.dispose();
    this.roadMesh.geometry = this.buildRoadGeometry(this.world.segments as RoadSegment[]);
    this.rebuildTransit();
  }

  /** Metro tracks as coloured ground lines, and bus stop posts. */
  private rebuildTransit(): void {
    const w = this.world;
    const tracks: { type: RoadType; pts: Pt[]; width: number; color: string; lift: number }[] = [];
    for (const line of w.lines) {
      if (line.kind !== "metro") continue;
      const n = line.stops.length;
      for (let i = 0; i < n; i++) {
        const a = w.stops.find((x) => x.id === line.stops[i]);
        const b = w.stops.find((x) => x.id === line.stops[(i + 1) % n]);
        if (!a || !b || a.id === b.id) continue;
        const p = (t: number) => ({ x: (t % w.size) + 0.5, z: ((t / w.size) | 0) + 0.5 });
        tracks.push({ type: 1, pts: [p(a.tile), p(b.tile)], width: 0.28, color: line.color, lift: 0.1 });
      }
    }
    this.metroMesh.geometry.dispose();
    this.metroMesh.geometry = this.buildRoadGeometry(tracks);

    const m = this.stopMesh;
    const d = this.dummy;
    const col = new THREE.Color();
    let n = 0;
    for (const st of w.stops) {
      if (st.kind !== "bus") continue;
      const x = st.tile % w.size, y = (st.tile / w.size) | 0;
      const line = w.lines.find((l) => l.stops.includes(st.id));
      d.position.set(x + 0.2, tileHeight(w, x, y) + 0.4, y + 0.2);
      d.scale.set(0.16, 0.7, 0.16);
      d.updateMatrix();
      m.setMatrixAt(n, d.matrix);
      col.set(line ? line.color : "#8a95a8");
      m.setColorAt(n, col);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** Mark tiles (stops picked while building a line). */
  setStopMarks(tiles: number[], color = "#ffd84a"): void {
    const m = this.markMesh;
    const d = this.dummy;
    const col = new THREE.Color(color);
    tiles.forEach((t, i) => {
      const x = t % this.world.size, y = (t / this.world.size) | 0;
      d.position.set(x + 0.5, tileHeight(this.world, x, y) + 1.0, y + 0.5);
      d.scale.set(0.3, 0.3, 0.3);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      m.setColorAt(i, col);
    });
    m.count = tiles.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  private buildRain(): void {
    const N = 700;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 70, y = Math.random() * 32, z = (Math.random() - 0.5) * 70;
      p.set([x, y, z, x - 0.05, y + 0.9, z], i * 6);
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#bcd0e6", transparent: true, opacity: 0.55 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  /** Swap in another world of the same size (load / new city). */
  setWorld(world: World): void {
    this.world = world;
    this.seenRevision = -1;
    this.overlaySeen = -1;
    this.overlayLvSeen = -1;
  }

  /**
   * Time of day (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset) and weather.
   * Drives light, sky, fog and window glow.
   */
  setAtmosphere(tod: number, raining: boolean): void {
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const elev = Math.sin((tod - 0.25) * Math.PI * 2);
    const day = clamp01(elev * 1.3 + 0.25);
    const dusk = clamp01(1 - Math.abs(elev) * 3.2) * (elev > -0.3 ? 1 : 0);
    const sky = new THREE.Color("#0a1224").lerp(new THREE.Color("#a9c8e8"), day);
    sky.lerp(new THREE.Color("#f0a070"), dusk * 0.45);
    if (raining) sky.lerp(new THREE.Color("#6f7d8c"), 0.55);
    (this.scene.background as THREE.Color).copy(sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    fog.near = raining ? 40 : 90;
    fog.far = raining ? 150 : 260;
    const a = (tod - 0.25) * Math.PI * 2;
    this.sun.position.set(-Math.cos(a) * 60, Math.max(6, Math.sin(a) * 70 + 8), 30);
    this.sun.intensity = (0.15 + 1.7 * day) * (raining ? 0.5 : 1);
    this.sun.color.set("#fff4de").lerp(new THREE.Color("#ff9a58"), dusk * 0.6);
    this.hemi.intensity = (0.4 + 0.95 * day) * (raining ? 0.8 : 1);
    this.winMat.emissiveIntensity = Math.max(0, 1 - day * 1.6) * 1.1;
    this.rainOn = raining;
    this.rain.visible = raining;
  }

  /** Traffic whose vehicles are drawn and whose loads colour the traffic infoview. */
  setTraffic(t: TrafficState): void {
    this.traffic = t;
  }

  private updateVehicles(): void {
    const t = this.traffic;
    const m = this.vehicleMesh;
    if (!t) return;
    const d = this.dummy;
    const col = new THREE.Color();
    const CAR = ["#e8eef5", "#d0453a", "#3a6fd0", "#2c2f36", "#e0b43a", "#58a86a"];
    let n = 0;
    for (const v of t.vehicles) {
      if (n >= m.instanceMatrix.count) break;
      const i = Math.min(v.tiles.length - 2, Math.floor(v.progress));
      if (i < 0) continue;
      const f = v.progress - i;
      const ax = v.pts[i * 2], az = v.pts[i * 2 + 1], bx = v.pts[i * 2 + 2], bz = v.pts[i * 2 + 3];
      let hx = bx - ax, hz = bz - az;
      const l = Math.hypot(hx, hz) || 1;
      hx /= l; hz /= l;
      const lane = v.kind === 1 ? 0.12 : 0.1;
      const x = ax + (bx - ax) * f - hz * lane;
      const z = az + (bz - az) * f + hx * lane;
      d.position.set(x, heightAt(this.world, x, z) + 0.17, z);
      d.rotation.set(0, -Math.atan2(hz, hx), 0);
      if (v.kind === 1) d.scale.set(0.58, 0.24, 0.26); else d.scale.set(0.42, 0.17, 0.22);
      d.updateMatrix();
      m.setMatrixAt(n, d.matrix);
      col.set(v.kind === 1 ? "#f08a3c" : CAR[v.id % CAR.length]);
      m.setColorAt(n, col);
      n++;
    }
    for (const v of t.transit) {
      if (n >= m.instanceMatrix.count) break;
      const i = Math.min(v.tiles.length - 2, Math.floor(v.progress));
      if (i < 0) continue;
      const f = Math.min(1, v.progress - i);
      const ax = v.pts[i * 2], az = v.pts[i * 2 + 1], bx = v.pts[i * 2 + 2], bz = v.pts[i * 2 + 3];
      let hx = bx - ax, hz = bz - az;
      const l = Math.hypot(hx, hz) || 1;
      hx /= l; hz /= l;
      const lane = v.kind === "bus" ? 0.14 : 0;
      const x = ax + (bx - ax) * f - hz * lane;
      const z = az + (bz - az) * f + hx * lane;
      d.position.set(x, heightAt(this.world, x, z) + (v.kind === "bus" ? 0.22 : 0.3), z);
      d.rotation.set(0, -Math.atan2(hz, hx), 0);
      if (v.kind === "bus") d.scale.set(0.8, 0.26, 0.28); else d.scale.set(1.2, 0.3, 0.4);
      d.updateMatrix();
      m.setMatrixAt(n, d.matrix);
      col.set(v.color);
      m.setColorAt(n, col);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    d.rotation.set(0, 0, 0);
  }

  /** Ghost of a road being drawn; null clears it. */
  setRoadPreview(seg: { type: RoadType; pts: Pt[] } | null, valid = true): void {
    this.previewMesh.visible = !!seg;
    if (!seg) return;
    this.previewMesh.geometry.dispose();
    this.previewMesh.geometry = this.buildRoadGeometry([seg], new THREE.Color(valid ? "#7fe08a" : "#ff6b60"));
    this.previewMesh.position.y = 0.05;
  }

  /** Ground position under a client-space pointer. */
  pickPoint(clientX: number, clientY: number): Pt | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (!hit) return null;
    if (!inBounds(this.world, Math.floor(hit.point.x), Math.floor(hit.point.z))) return null;
    return { x: hit.point.x, z: hit.point.z };
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
    const isTraffic = layer === TRAFFIC_LAYER;
    const flat = new THREE.Color(OVERLAY_COLOR[layer] ?? "#ffffff");
    const col = new THREE.Color();
    const d = this.dummy;
    let n = 0;
    for (let y = 0; y < w.size; y++) {
      for (let x = 0; x < w.size; x++) {
        const i = idx(w, x, y);
        if (isTraffic) {
          if (!w.road[i]) continue;
        } else {
          if (!isLand(w, x, y)) continue;
          if (!isValue && !(w.cover[i] & layer)) continue;
        }
        d.position.set(x + 0.5, tileHeight(w, x, y) + 0.12, y + 0.5);
        d.scale.set(0.98, 0.02, 0.98);
        d.updateMatrix();
        m.setMatrixAt(n, d.matrix);
        if (isTraffic) {
          const load = this.traffic ? this.traffic.load[i] : 0;
          const ratio = Math.min(1.5, load / ROAD_CAPACITY[w.road[i]]);
          col.setHSL(0.33 * (1 - Math.min(1, ratio)), 0.9, 0.5); // green (free) to red (jammed)
        } else if (isValue) col.setHSL((w.landValue[i] / 100) * 0.33, 0.8, 0.5); // red (low) to green (high)
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
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.rig.resize(w / h);
  }

  get viewportHeight(): number {
    return this.renderer.domElement.clientHeight;
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Keep the game smooth on slower GPUs (iPad): drop the render resolution when frames run long,
   * and win it back when there is headroom. Pixel ratio moves in 0.25 steps between 1 and the cap.
   */
  private adaptResolution(now: number): void {
    if (this.lastFrameAt) {
      const dt = Math.min(100, now - this.lastFrameAt);
      this.frameMs += (dt - this.frameMs) * 0.1;
      if (this.frameMs > 26) { this.slowFor += dt; this.fastFor = 0; }
      else if (this.frameMs < 14) { this.fastFor += dt; this.slowFor = 0; }
      else { this.slowFor = 0; this.fastFor = 0; }
      if (this.slowFor > 1500 && this.pixelRatio > 1) {
        this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
        this.slowFor = 0;
        this.resize();
      } else if (this.fastFor > 6000 && this.pixelRatio < this.pixelCap) {
        this.pixelRatio = Math.min(this.pixelCap, this.pixelRatio + 0.25);
        this.fastFor = 0;
        this.resize();
      }
    }
    this.lastFrameAt = now;
  }

  /** Highest pixel ratio the quality setting allows (also bounded by the display). */
  setQualityCap(cap: number): void {
    this.pixelCap = Math.min(window.devicePixelRatio || 1, cap);
    this.pixelRatio = Math.min(this.pixelRatio, this.pixelCap);
    this.resize();
  }

  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  render(): void {
    this.adaptResolution(performance.now());
    // Painting bumps the revision every frame; rebuilding the scene costs several ms, so
    // coalesce changes into at most one rebuild per REBUILD_GAP_MS.
    const now = performance.now();
    if (this.seenRevision !== this.world.revision && (now - this.lastRebuildAt >= REBUILD_GAP_MS || this.seenRevision === -1)) {
      this.seenRevision = this.world.revision;
      this.lastRebuildAt = now;
      this.rebuild();
    }
    this.frame++;
    if (this.rainOn) {
      const pos = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < a.length; i += 6) {
        a[i + 1] -= 0.9; a[i + 4] -= 0.9;
        if (a[i + 1] < 0) { a[i + 1] += 32; a[i + 4] += 32; }
      }
      pos.needsUpdate = true;
      this.rain.position.set(this.rig.target.x, 0, this.rig.target.z);
    }
    this.updateVehicles();
    if (this.overlayLayer === TRAFFIC_LAYER && this.frame % 10 === 0) this.overlaySeen = -1;
    if (this.overlaySeen !== this.world.revision || (this.overlayLayer === LAND_VALUE_LAYER && this.overlayLvSeen !== this.world.lvRevision)) this.rebuildOverlay();
    this.renderer.render(this.scene, this.rig.camera);
  }
}
