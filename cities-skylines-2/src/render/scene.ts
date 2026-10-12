import * as THREE from "three";
import { CityState } from "../sim/sim";
import {
  ZONE, COVER, LAND_VALUE_LAYER, TRAFFIC_LAYER, UNDERGROUND_LAYER, FacilityKind, idx, tileHeight, isLand, World,
  RoadType, Pt, inBounds, heightAt, Biome,
} from "../sim/world";
import { CameraRig } from "./camera";
import { buildModels, makeWindowTextures } from "./models";
import { zoneEntries, tileHash, facilityEntry } from "../sim/catalog";
import { loadGlb, LoadedModel } from "./glb-models";
import { WaterSurface, makeNoiseTexture, tierForPixelCap } from "./water";
import { Ambience, SmokeSource } from "./ambience";
import { TrafficState, ROAD_CAPACITY } from "../sim/traffic";
import { buildRoadNetworkGeometry, buildStripGeometry } from "./roads";

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
  [COVER.CULTURE]: "#e8b35a",
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

/** Deep bed colour the underwater terrain fades to (shows through shallow water). */
const BED_MUD = new THREE.Color("#2b4a3a");

/** Which Blender prop a scattered plant uses, with cumulative weights per terrain preset. */
const TREE_SPECIES = ["tree_oak", "tree_pine", "tree_poplar", "tree_cherry", "tree_autumn", "tree_palm", "bush", "bush_flowers", "rock"] as const;
type Species = (typeof TREE_SPECIES)[number];
const SPECIES_WEIGHTS: Record<Biome, [Species, number][]> = {
  plains: [["tree_oak", 0.4], ["tree_poplar", 0.15], ["bush", 0.2], ["bush_flowers", 0.08], ["tree_cherry", 0.06], ["tree_autumn", 0.06], ["rock", 0.05]],
  forest: [["tree_pine", 0.42], ["tree_oak", 0.33], ["tree_poplar", 0.05], ["bush", 0.1], ["tree_autumn", 0.06], ["rock", 0.04]],
  river: [["tree_oak", 0.38], ["tree_poplar", 0.25], ["bush", 0.18], ["tree_cherry", 0.1], ["bush_flowers", 0.04], ["rock", 0.05]],
  coast: [["tree_palm", 0.35], ["tree_oak", 0.2], ["bush", 0.22], ["bush_flowers", 0.08], ["rock", 0.1], ["tree_poplar", 0.05]],
  mountain: [["tree_pine", 0.58], ["rock", 0.24], ["tree_oak", 0.1], ["bush", 0.08]],
  desert: [["tree_palm", 0.18], ["bush", 0.32], ["rock", 0.5]],
};
const SPECIES_SCALE: Record<Species, [number, number]> = {
  tree_oak: [0.9, 1.5], tree_pine: [0.9, 1.6], tree_poplar: [0.9, 1.4], tree_cherry: [0.9, 1.3], tree_autumn: [0.9, 1.4],
  tree_palm: [0.9, 1.3], bush: [0.8, 1.4], bush_flowers: [0.9, 1.3], rock: [0.6, 1.5],
};
/** Vehicle props: which GLB each kind of mover uses. */
const CAR_MODELS = ["car_sedan", "car_hatch", "car_suv", "van"];
const VEHICLE_PROPS = [...CAR_MODELS, "truck", "bus", "train"];
const BOAT_PROPS = ["boat_motor", "boat_sail", "boat_ferry"];

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
  private sunDir = new THREE.Vector3(-40, 70, 30);
  private rain!: THREE.LineSegments;
  private rainOn = false;
  private lastRebuildAt = 0;
  private pixelCap = 2;
  private qualityCap = 2;
  private pixelRatio = 1;
  private frameMs = 16;
  private slowFor = 0;
  private fastFor = 0;
  private lastFrameAt = 0;
  private roadMesh!: THREE.Mesh;
  private metroMesh!: THREE.Mesh;
  private stopMesh!: THREE.InstancedMesh;
  private treeMeshes = new Map<string, THREE.InstancedMesh>();
  private lampMesh!: THREE.InstancedMesh;
  private water: WaterSurface | null = null;
  private noiseTex!: THREE.DataTexture;
  private dayLevel = 1;
  private skyCol = new THREE.Color("#a9c8e8");
  private props = new Map<string, LoadedModel | null>();
  private propPending = new Set<string>();
  private propWaiters = new Map<string, ((m: LoadedModel) => void)[]>();
  private vehMeshes = new Map<string, THREE.InstancedMesh>();
  private vehReady = new Set<string>();
  private boatMeshes = new Map<string, THREE.InstancedMesh>();
  private boatReady = new Set<string>();
  private boats: { x: number; z: number; a: number; speed: number; turn: number; prop: string; phase: number }[] = [];
  private whiteTint = new THREE.Color("#ffffff");
  private grassTex!: THREE.Texture;
  private ambience!: Ambience;
  private asphaltTex!: THREE.Texture;
  private lastFrame = 0;
  private markMesh!: THREE.InstancedMesh;
  private previewMesh!: THREE.Mesh;
  private zones!: THREE.InstancedMesh;
  private pipes!: THREE.InstancedMesh;
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
  private sized: THREE.Object3D[] = [];
  /** Kit models from Blender (public/models/NN.glb), loaded once and shared across map swaps. */
  private glb = new Map<number, LoadedModel | null>();
  private glbPending = new Set<number>();
  private glowMats = new Set<THREE.MeshStandardMaterial>();
  private nightGlow = 0;
  private models!: ReturnType<typeof buildModels>;

  constructor(private container: HTMLElement, state: CityState) {
    this.world = state.world;
    const size = this.world.size;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.pixelCap = Math.min(window.devicePixelRatio, 2);
    this.pixelRatio = this.pixelCap;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.container.appendChild(this.renderer.domElement);

    const texLoader = new THREE.TextureLoader();
    const detail = (file: string) => {
      const t = texLoader.load(`/textures/${file}.png`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    this.grassTex = detail("grass");
    this.asphaltTex = detail("asphalt");
    this.scene.background = new THREE.Color("#a9c8e8");
    this.scene.fog = new THREE.Fog("#a9c8e8", 90, 260);
    this.hemi = new THREE.HemisphereLight("#ffffff", "#6b7a5a", 1.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff4de", 1.8);
    this.sun.position.set(-40, 70, 30);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // Soft sun shadows over the area around the camera target (see render()); the map size follows the quality level.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.buildRain();

    this.rig = new CameraRig(1, size);
    this.focusEntry();

    // Size-independent parts: ribbons, previews, shared models and window materials.
    this.roadMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: this.asphaltTex, color: new THREE.Color(1.35, 1.35, 1.35) }),
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
    const tex = makeWindowTextures();
    this.winMat = new THREE.MeshLambertMaterial({
      map: tex.map, vertexColors: true, emissive: new THREE.Color("#ffd98a"), emissiveMap: tex.glow, emissiveIntensity: 0,
    });
    this.plainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.models = buildModels();
    this.noiseTex = makeNoiseTexture(128);
    this.ambience = new Ambience(this.scene);
    this.ambience.setMapSize(this.world.size);
    const fallback = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    for (const name of VEHICLE_PROPS) {
      const m: THREE.InstancedMesh = new THREE.InstancedMesh(fallback, new THREE.MeshLambertMaterial({ color: "#ffffff" }), 320);
      m.count = 0;
      m.frustumCulled = false;
      this.scene.add(m);
      this.vehMeshes.set(name, m);
      this.useProp(name, (model) => { m.geometry = model.geometry; m.material = model.materials; this.vehReady.add(name); });
    }
    for (const name of BOAT_PROPS) {
      const m: THREE.InstancedMesh = new THREE.InstancedMesh(fallback, new THREE.MeshLambertMaterial({ color: "#ffffff" }), 16);
      m.count = 0;
      m.frustumCulled = false;
      this.scene.add(m);
      this.boatMeshes.set(name, m);
      this.useProp(name, (model) => { m.geometry = model.geometry; m.material = model.materials; this.boatReady.add(name); });
    }
    this.buildWorldResources();

    this.hover = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 0.12, 1.02),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55 }),
    );
    this.hover.visible = false;
    this.scene.add(this.hover);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** Everything whose size depends on the map: terrain, instance buffers, water. Rebuilt when the map size changes. */
  private buildWorldResources(): void {
    const size = this.world.size;
    const cap = size * size;
    const own = (o: THREE.Object3D) => { this.sized.push(o); this.scene.add(o); return o; };
    this.buildTerrain();
    own(this.terrain);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mk = (mat: THREE.Material) => {
      const m = new THREE.InstancedMesh(box, mat, cap);
      m.count = 0;
      m.frustumCulled = false;
      own(m);
      return m;
    };
    this.zones = mk(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    this.pipes = mk(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    this.pipes.renderOrder = 0;
    const mkModel = (geo: THREE.BufferGeometry, capacity: number) => {
      const m = new THREE.InstancedMesh(geo, [this.winMat, this.plainMat], capacity);
      m.count = 0;
      m.frustumCulled = false;
      own(m);
      return m;
    };
    this.bMeshes.clear();
    this.fMeshes.clear();
    for (const [k, g] of this.models.buildings) this.bMeshes.set(k, mkModel(g, Math.ceil(cap * 0.6)));
    for (const [k, g] of this.models.facilities) this.fMeshes.set(k, mkModel(g, Math.ceil(cap * 0.3)));
    // Plants: one instanced mesh per species; cones stand in until its GLB arrives.
    this.treeMeshes.clear();
    const cone = new THREE.ConeGeometry(0.17, 0.62, 6).translate(0, 0.31, 0);
    for (const sp of TREE_SPECIES) {
      const m: THREE.InstancedMesh = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: "#ffffff" }), Math.ceil(cap / 3));
      m.count = 0;
      m.frustumCulled = false;
      own(m);
      this.treeMeshes.set(sp, m);
      this.useProp(sp, (model) => {
        if (!this.sized.includes(m)) return;
        m.geometry = model.geometry;
        m.material = model.materials;
      });
    }
    this.lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.3, 0.02).translate(0, 0.15, 0), new THREE.MeshLambertMaterial({ color: "#3a3f47" }), Math.ceil(cap / 3));
    this.lampMesh.count = 0;
    this.lampMesh.frustumCulled = false;
    own(this.lampMesh);
    this.useProp("lamp", (model) => {
      if (!this.sized.includes(this.lampMesh)) return;
      this.lampMesh.geometry = model.geometry;
      this.lampMesh.material = model.materials;
    });
    this.stopMesh = mk(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    this.markMesh = mk(new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    this.vehicleMesh = mk(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    this.overlay = mk(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5, depthWrite: false }));
    this.water = new WaterSurface(this.world, this.noiseTex);
    this.water.setTier(tierForPixelCap(this.qualityCap));
    own(this.water.mesh);
    this.seedBoats();
    this.applyGlbModels();
  }

  /** Run `apply` with a prop's GLB as soon as it is available (immediately when cached). */
  private useProp(name: string, apply: (m: LoadedModel) => void): void {
    const hit = this.props.get(name);
    const done = (model: LoadedModel) => {
      apply(model);
      for (const g of model.glow) {
        this.glowMats.add(g);
        g.emissiveIntensity = this.nightGlow;
      }
    };
    if (hit) { done(hit); return; }
    if (hit === null) return;
    const list = this.propWaiters.get(name) ?? [];
    list.push(done);
    this.propWaiters.set(name, list);
    if (this.propPending.has(name)) return;
    this.propPending.add(name);
    loadGlb(`/models/props/${name}.glb`).then((model) => {
      this.props.set(name, model);
      this.propPending.delete(name);
      const waiters = this.propWaiters.get(name) ?? [];
      this.propWaiters.delete(name);
      if (model) waiters.forEach((f) => f(model));
    });
  }

  /** A few boats drifting on the larger bodies of water. */
  private seedBoats(): void {
    const w = this.world;
    const n = w.size;
    const spots: [number, number][] = [];
    let wet = 0;
    for (let y = 2; y < n - 2; y += 1) {
      for (let x = 2; x < n - 2; x += 1) {
        if (isLand(w, x, y)) continue;
        wet++;
        // only open water: no land within two tiles
        let open = true;
        for (let dy = -2; dy <= 2 && open; dy++) for (let dx = -2; dx <= 2; dx++) if (isLand(w, x + dx, y + dy)) { open = false; break; }
        if (open) spots.push([x, y]);
      }
    }
    this.boats = [];
    if (spots.length < 12) return;
    const count = Math.min(10, Math.floor(wet / 400) + 2);
    for (let i = 0; i < count; i++) {
      const [x, y] = spots[Math.floor(hash(i * 13 + 1, n + 5) * spots.length)];
      this.boats.push({
        x: x + 0.5, z: y + 0.5, a: hash(i, 7) * Math.PI * 2, speed: 0.35 + hash(i, 3) * 0.5,
        turn: hash(i, 11) < 0.5 ? -1 : 1, prop: BOAT_PROPS[i % BOAT_PROPS.length], phase: hash(i, 17) * 6.28,
      });
    }
  }

  private updateBoats(dt: number, time: number): void {
    const w = this.world;
    const d = this.dummy;
    const counts = new Map<string, number>();
    for (const b of this.boats) {
      // steer away from land: look ahead and turn until the water ahead is clear
      for (let tries = 0; tries < 3; tries++) {
        const ax = b.x + Math.cos(b.a) * 1.4, az = b.z + Math.sin(b.a) * 1.4;
        const ix = Math.floor(ax), iz = Math.floor(az);
        if (inBounds(w, ix, iz) && !isLand(w, ix, iz)) break;
        b.a += b.turn * 0.7;
      }
      b.a += Math.sin(time * 0.4 + b.phase) * 0.15 * dt;
      b.x += Math.cos(b.a) * b.speed * dt;
      b.z += Math.sin(b.a) * b.speed * dt;
      if (!inBounds(w, Math.floor(b.x), Math.floor(b.z))) { b.a += Math.PI; b.x = Math.min(w.size - 1, Math.max(1, b.x)); b.z = Math.min(w.size - 1, Math.max(1, b.z)); }
      const mesh = this.boatMeshes.get(b.prop);
      if (!mesh || !this.boatReady.has(b.prop)) continue;
      const c = counts.get(b.prop) ?? 0;
      if (c >= mesh.instanceMatrix.count) continue;
      d.position.set(b.x, -0.02 + Math.sin(time * 1.3 + b.phase) * 0.012, b.z);
      d.rotation.set(0, -b.a, Math.sin(time * 0.9 + b.phase) * 0.04);
      d.scale.setScalar(1);
      d.updateMatrix();
      mesh.setMatrixAt(c, d.matrix);
      mesh.setColorAt(c, this.whiteTint);
      counts.set(b.prop, c + 1);
    }
    for (const [name, mesh] of this.boatMeshes) {
      mesh.count = counts.get(name) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    d.rotation.set(0, 0, 0);
  }

  /** Swap procedural models for the Blender ones as they arrive; instance data is untouched. */
  private applyGlbModels(): void {
    const wanted = new Map<number, THREE.InstancedMesh[]>();
    const want = (n: number | undefined, mesh: THREE.InstancedMesh | undefined) => {
      if (n === undefined || !mesh) return;
      (wanted.get(n) ?? wanted.set(n, []).get(n)!).push(mesh);
    };
    for (const [key, mesh] of this.bMeshes) {
      const [z, l, i] = key.split("-").map(Number);
      want(zoneEntries(z, l)[i]?.n, mesh);
    }
    for (const [kind, mesh] of this.fMeshes) want(facilityEntry(kind as never)?.n, mesh);
    for (const [n, meshes] of wanted) {
      const apply = (model: LoadedModel) => {
        for (const m of meshes) {
          if (!this.sized.includes(m)) continue; // the world was swapped meanwhile
          m.geometry = model.geometry;
          m.material = model.materials;
        }
        for (const g of model.glow) {
          this.glowMats.add(g);
          g.emissiveIntensity = this.nightGlow;
        }
      };
      if (this.glb.has(n)) {
        const hit = this.glb.get(n);
        if (hit) apply(hit);
      } else if (!this.glbPending.has(n)) {
        this.glbPending.add(n);
        const url = `/models/${String(n).padStart(2, "0")}.glb`;
        loadGlb(url).then((model) => {
          this.glb.set(n, model);
          this.glbPending.delete(n);
          // Re-run so whichever world is current gets the model, even after a map swap.
          if (model) this.applyGlbModels();
        });
      }
    }
  }

  private disposeWorldResources(): void {
    const models = new Set<THREE.BufferGeometry>([...this.models.buildings.values(), ...this.models.facilities.values()]);
    for (const m of this.glb.values()) if (m) models.add(m.geometry);
    for (const m of this.props.values()) if (m) models.add(m.geometry);
    for (const o of this.sized) {
      this.scene.remove(o);
      const m = o as THREE.Mesh;
      if (m.geometry && !models.has(m.geometry as THREE.BufferGeometry)) m.geometry.dispose();
      const mat = m.material;
      // Window/plain materials are shared with the model meshes and live as long as the renderer.
      if (mat && !Array.isArray(mat)) mat.dispose();
    }
    this.sized = [];
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
      new THREE.MeshLambertMaterial({ vertexColors: true, map: this.grassTex, color: new THREE.Color(1.3, 1.3, 1.3) }),
    );
    // one texture repeat per three tiles gives the ground grain without visible tiling
    this.grassTex.repeat.set(n / 3, n / 3);
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
      if (h < 0) {
        // Bed under water: wet sand sinking to dark mud with depth, so it reads through shallow water.
        c.set(look.sand).lerp(BED_MUD, Math.min(1, -h / 2));
      } else if (h < 0.25) {
        // Damp band just above the waterline.
        c.set(look.sand).multiplyScalar(0.72);
      } else if (h < 0.3) c.set(look.sand);
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
    let nz = 0, nl = 0;
    const smoke: SmokeSource[] = [];
    const treeCounts = new Map<THREE.InstancedMesh, number>();
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
          if (w.facility[i] === 1) smoke.push({ x: x + 0.7, y: h + 0.85, z: y + 0.72, strength: 1 });
          const mesh = this.fMeshes.get(w.facility[i] as FacilityKind);
          if (mesh) this.placeModel(mesh, counts, x, y, h, 1, tint.setScalar(1));
        } else if (w.road[i]) {
          // Drawn as ribbons (see buildRoadGeometry).
        } else if (!w.zone[i]) {
          // Open ground: scatter plants by terrain preset, never on water or the entry strip.
          const r = hash(x * 7 + 3, y * 13 + 5);
          if (r < look.trees && isLand(w, x, y) && h > 0.2 && h < look.rockAt + 1.5 && Math.hypot(x - w.entry.x, y - w.entry.y) > 5) {
            const j1 = hash(x + 101, y + 211), j2 = hash(x + 307, y + 53);
            // pick a species from the cumulative weights of this terrain
            let acc = 0, species: Species = "tree_oak";
            const pick = hash(x + 419, y + 97);
            for (const [sp, wt] of SPECIES_WEIGHTS[w.biome]) { acc += wt; if (pick <= acc) { species = sp; break; } }
            const mesh = this.treeMeshes.get(species)!;
            const c = treeCounts.get(mesh) ?? 0;
            if (c < mesh.instanceMatrix.count) {
              const [lo, hi] = SPECIES_SCALE[species];
              const sc = lo + j1 * (hi - lo);
              d.position.set(x + 0.15 + j1 * 0.7, h, y + 0.15 + j2 * 0.7);
              d.rotation.set(0, j2 * 6.28, 0);
              d.scale.set(sc, sc * (0.9 + j2 * 0.35), sc);
              d.updateMatrix();
              mesh.setMatrixAt(c, d.matrix);
              // cones (before the GLB lands) take the biome's leaf colour; models are lightly shaded
              if (this.props.get(species)) mesh.setColorAt(c, tint.setScalar(0.85 + j2 * 0.3));
              else mesh.setColorAt(c, leaf[Math.floor(j2 * leaf.length) % leaf.length]);
              treeCounts.set(mesh, c + 1);
              d.rotation.set(0, 0, 0);
            }
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
            if (z === 3 && l >= 2) smoke.push({ x: x + 0.72, y: h + (l === 3 ? 0.95 : 0.7), z: y + 0.3, strength: l === 3 ? 0.8 : 0.5 });
            const variants = zoneEntries(z, l).length;
            const mesh = this.bMeshes.get(`${z}-${l}-${Math.min(variants - 1, Math.floor(tileHash(x + 17, y + 29) * variants))}`);
            const shade = 0.9 + r * 0.2;
            if (mesh) this.placeModel(mesh, counts, x, y, h, 0.92 + r * 0.2, tint.setScalar(shade));
          }
        }
      }
    }
    this.zones.count = nz;
    this.zones.instanceMatrix.needsUpdate = true;
    if (this.zones.instanceColor) this.zones.instanceColor.needsUpdate = true;
    // Street lamps on the verge of every fourth street and avenue tile, arm turned over the road.
    for (let y = 0; y < w.size && nl < this.lampMesh.instanceMatrix.count; y++) {
      for (let x = 0; x < w.size; x++) {
        const i2 = y * w.size + x;
        const cls = w.road[i2];
        if (!cls || cls === 3 || (x + y * 3) % 4 !== 0) continue;
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nx = x + dx, ny = y + dy;
          if (!inBounds(w, nx, ny) || w.road[ny * w.size + nx] || w.facility[ny * w.size + nx]) continue;
          // the lamp sits on the neighbouring tile's edge nearest the road; its arm (+x) points at the road
          const px = nx + 0.5 - dx * 0.42, pz = ny + 0.5 - dy * 0.42;
          d.position.set(px, tileHeight(w, x, y) + 0.05, pz);
          d.rotation.set(0, -Math.atan2(-dy, -dx), 0);
          d.scale.setScalar(1);
          d.updateMatrix();
          this.lampMesh.setMatrixAt(nl, d.matrix);
          this.lampMesh.setColorAt(nl++, tint.setScalar(1));
          d.rotation.set(0, 0, 0);
          break;
        }
        if (nl >= this.lampMesh.instanceMatrix.count) break;
      }
    }
    this.ambience.setSources(smoke);
    this.lampMesh.count = nl;
    this.lampMesh.instanceMatrix.needsUpdate = true;
    if (this.lampMesh.instanceColor) this.lampMesh.instanceColor.needsUpdate = true;
    for (const m of this.treeMeshes.values()) {
      m.count = treeCounts.get(m) ?? 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
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
   * Simple strips without junctions: road preview ghosts and metro tracks.
   * The live network renders through buildRoadNetworkGeometry (see rebuildRoads).
   */
  private buildRoadGeometry(segs: { type: RoadType; pts: Pt[]; width?: number; color?: string; lift?: number }[], tint?: THREE.Color): THREE.BufferGeometry {
    return buildStripGeometry(segs, (x, z) => this.groundY(x, z), tint);
  }

  private rebuildRoads(): void {
    this.roadMesh.geometry.dispose();
    this.roadMesh.geometry = buildRoadNetworkGeometry(this.world, (x, z) => this.groundY(x, z));
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

  /** Point the camera at the road entry so a new city opens on something to build from. */
  private focusEntry(): void {
    const e = this.world.entry;
    this.rig.target.set(e.x + 0.5 + e.dx * 7, 0, e.y + 0.5 + e.dy * 7);
    this.rig.apply();
  }

  /** Swap in another world; rebuilds size-dependent buffers when the map size differs. (load / new city). */
  setWorld(world: World): void {
    if (world.size !== this.world.size) {
      this.disposeWorldResources();
      this.world = world;
      this.buildWorldResources();
      this.ambience.setMapSize(world.size);
      this.rig.setBounds(world.size);
    }
    this.world = world;
    this.focusEntry();
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
    this.dayLevel = day * (raining ? 0.6 : 1);
    this.skyCol.copy(sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    fog.near = raining ? 40 : 90;
    fog.far = raining ? 150 : 260;
    const a = (tod - 0.25) * Math.PI * 2;
    this.sunDir.set(-Math.cos(a) * 60, Math.max(6, Math.sin(a) * 70 + 8), 30);
    this.sun.intensity = (0.15 + 1.7 * day) * (raining ? 0.5 : 1);
    this.sun.color.set("#fff4de").lerp(new THREE.Color("#ff9a58"), dusk * 0.6);
    this.hemi.intensity = (0.4 + 0.95 * day) * (raining ? 0.8 : 1);
    this.winMat.emissiveIntensity = Math.max(0, 1 - day * 1.6) * 1.1;
    this.nightGlow = this.winMat.emissiveIntensity;
    for (const g of this.glowMats) g.emissiveIntensity = this.nightGlow;
    this.rainOn = raining;
    this.rain.visible = raining;
  }

  /** Traffic whose vehicles are drawn and whose loads colour the traffic infoview. */
  setTraffic(t: TrafficState): void {
    this.traffic = t;
  }

  private updateVehicles(): void {
    const t = this.traffic;
    if (!t) return;
    const d = this.dummy;
    const col = new THREE.Color();
    const CAR = ["#e8eef5", "#d0453a", "#3a6fd0", "#2c2f36", "#e0b43a", "#58a86a", "#8a8f98", "#f2f2f2"];
    const counts = new Map<THREE.InstancedMesh, number>();
    /** Put one vehicle on the road: a Blender model when its GLB is ready, else the old box. */
    const place = (name: string, x: number, z: number, hx: number, hz: number, tint: THREE.Color, boxScale: [number, number, number], boxLift: number) => {
      const glb = this.vehReady.has(name);
      const mesh = glb ? this.vehMeshes.get(name)! : this.vehicleMesh;
      const c = counts.get(mesh) ?? 0;
      if (c >= mesh.instanceMatrix.count) return;
      d.position.set(x, heightAt(this.world, x, z) + (glb ? 0.07 : boxLift), z);
      d.rotation.set(0, -Math.atan2(hz, hx), 0);
      if (glb) d.scale.setScalar(1); else d.scale.set(boxScale[0], boxScale[1], boxScale[2]);
      d.updateMatrix();
      mesh.setMatrixAt(c, d.matrix);
      mesh.setColorAt(c, tint);
      counts.set(mesh, c + 1);
    };
    const heading = (pts: Float32Array, i: number, f: number, lane: number) => {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
      let hx = bx - ax, hz = bz - az;
      const l = Math.hypot(hx, hz) || 1;
      hx /= l; hz /= l;
      return { x: ax + (bx - ax) * f - hz * lane, z: az + (bz - az) * f + hx * lane, hx, hz };
    };
    for (const v of t.vehicles) {
      const i = Math.min(v.tiles.length - 2, Math.floor(v.progress));
      if (i < 0) continue;
      const p = heading(v.pts, i, v.progress - i, v.kind === 1 ? 0.12 : 0.1);
      if (v.kind === 1) {
        place("truck", p.x, p.z, p.hx, p.hz, col.set("#f0f0f0"), [0.58, 0.24, 0.26], 0.17);
      } else {
        place(CAR_MODELS[v.id % CAR_MODELS.length], p.x, p.z, p.hx, p.hz, col.set(CAR[(v.id * 7) % CAR.length]), [0.42, 0.17, 0.22], 0.17);
      }
    }
    for (const v of t.transit) {
      const i = Math.min(v.tiles.length - 2, Math.floor(v.progress));
      if (i < 0) continue;
      const p = heading(v.pts, i, Math.min(1, v.progress - i), v.kind === "bus" ? 0.14 : 0);
      place(v.kind === "bus" ? "bus" : "train", p.x, p.z, p.hx, p.hz, col.set(v.color),
        v.kind === "bus" ? [0.8, 0.26, 0.28] : [1.2, 0.3, 0.4], v.kind === "bus" ? 0.22 : 0.3);
    }
    for (const m of [this.vehicleMesh, ...this.vehMeshes.values()]) {
      m.count = counts.get(m) ?? 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
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

  /** Instanced models cast and receive sun shadows; flat overlays and ribbons only receive. Re-run as meshes appear. */
  private markShadows(): void {
    const flat = new Set<THREE.Object3D>([this.zones, this.overlay, this.pipes, this.hover, this.water?.mesh as THREE.Object3D].filter(Boolean) as THREE.Object3D[]);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || flat.has(o)) return;
      if (o === this.terrain || o === this.roadMesh) { m.receiveShadow = true; m.castShadow = false; return; }
      if ((o as THREE.InstancedMesh).isInstancedMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
  }

  /** Show one service's coverage as a tinted layer; 0 hides it. */
  setOverlay(layer: OverlayLayer): void {
    const wasUnder = this.overlayLayer === UNDERGROUND_LAYER;
    this.overlayLayer = layer;
    this.overlaySeen = -1;
    this.overlayLvSeen = -1;
    const under = layer === UNDERGROUND_LAYER;
    if (under !== wasUnder) this.setUndergroundLook(under);
  }

  /** Make the ground and everything on it translucent so the pipe networks underneath read clearly. */
  private setUndergroundLook(on: boolean): void {
    const fade = (m: THREE.Material | THREE.Material[], opacity: number) => {
      for (const mat of Array.isArray(m) ? m : [m]) {
        mat.transparent = on || mat.transparent && opacity < 1;
        mat.opacity = opacity;
        mat.depthWrite = !on;
        mat.needsUpdate = true;
      }
    };
    fade(this.terrain.material, on ? 0.6 : 1);
    // soil: brown earth while looking underneath, the normal grass tint otherwise
    (this.terrain.material as THREE.MeshLambertMaterial).color.set(on ? "#7a5a3c" : "#ffffff").multiplyScalar(on ? 1 : 1.3);
    fade(this.roadMesh.material, on ? 0.45 : 1);
    for (const m of this.bMeshes.values()) fade(m.material, on ? 0.3 : 1);
    for (const m of this.fMeshes.values()) fade(m.material, on ? 0.45 : 1);
    this.zones.visible = !on;
    this.pipes.visible = on;
    if (!on) this.pipes.count = 0;
  }

  /** Water, sewage and power runs under every road tile they cover, joined tile to tile. */
  private rebuildPipes(): void {
    const w = this.world;
    const m = this.pipes;
    const nets: { bit: number; color: string; off: number; depth: number; r: number }[] = [
      { bit: COVER.WATER, color: "#2ea8e8", off: -0.16, depth: 0.22, r: 0.075 },
      { bit: COVER.SEWAGE, color: "#a07848", off: 0.0, depth: 0.34, r: 0.095 },
      { bit: COVER.POWER, color: "#f2c230", off: 0.16, depth: 0.16, r: 0.045 },
    ];
    const d = this.dummy;
    const col = new THREE.Color();
    let n = 0;
    const cap = m.instanceMatrix.count;
    const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: THREE.Color): void => {
      if (n >= cap) return;
      d.position.set(x, y, z);
      d.scale.set(sx, sy, sz);
      d.updateMatrix();
      m.setMatrixAt(n, d.matrix);
      m.setColorAt(n++, c);
    };
    for (const net of nets) {
      col.set(net.color);
      for (let y = 0; y < w.size; y++) {
        for (let x = 0; x < w.size; x++) {
          const i = idx(w, x, y);
          if (!w.road[i] || !(w.cover[i] & net.bit)) continue;
          const h = tileHeight(w, x, y) - net.depth;
          const cx = x + 0.5, cz = y + 0.5;
          // joints and straight runs: a block at the tile centre, then half-tile arms to each road neighbour
          put(cx + net.off, h, cz + net.off, net.r * 2.1, net.r * 2.1, net.r * 2.1, col);
          if (x + 1 < w.size && w.road[idx(w, x + 1, y)] && (w.cover[idx(w, x + 1, y)] & net.bit)) put(cx + 0.5, h, cz + net.off, 1.0, net.r * 1.8, net.r * 1.8, col);
          if (y + 1 < w.size && w.road[idx(w, x, y + 1)] && (w.cover[idx(w, x, y + 1)] & net.bit)) put(cx + net.off, h, cz + 0.5, net.r * 1.8, net.r * 1.8, 1.0, col);
        }
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  private rebuildOverlay(): void {
    const w = this.world;
    const m = this.overlay;
    this.overlaySeen = w.revision;
    this.overlayLvSeen = w.lvRevision;
    const layer = this.overlayLayer;
    if (!layer) { m.count = 0; return; }
    if (layer === UNDERGROUND_LAYER) { m.count = 0; this.rebuildPipes(); return; }
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
    this.qualityCap = cap;
    this.pixelCap = Math.min(window.devicePixelRatio || 1, cap);
    this.pixelRatio = Math.min(this.pixelRatio, this.pixelCap);
    // shadows by tier: off on low, a 1k map on medium, 2k on high
    const res = cap <= 1 ? 0 : cap < 2 ? 1024 : 2048;
    this.sun.castShadow = res > 0;
    if (res > 0 && this.sun.shadow.mapSize.x !== res) {
      this.sun.shadow.mapSize.set(res, res);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // Water detail follows the same tier: flat ripple, then normals, then foam.
    this.water?.setTier(tierForPixelCap(cap));
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
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0.016;
    this.lastFrame = now;
    const time = now / 1000;
    this.water?.update(time, this.dayLevel, this.skyCol, this.sunDir, this.rig.target.x, this.rig.target.z);
    this.updateBoats(dt, time);
    this.ambience.update(time, dt, this.dayLevel, this.skyCol);
    this.updateVehicles();
    if (this.overlayLayer === TRAFFIC_LAYER && this.frame % 10 === 0) this.overlaySeen = -1;
    if (this.overlaySeen !== this.world.revision || (this.overlayLayer === LAND_VALUE_LAYER && this.overlayLvSeen !== this.world.lvRevision)) this.rebuildOverlay();
    if (this.frame % 90 === 0) this.markShadows();
    // the shadow frustum travels with the camera target and covers the visible ground at this zoom
    const tg = this.rig.target, span = Math.min(60, 8 + this.rig.dist * 0.75);
    this.sun.target.position.set(tg.x, 0, tg.z);
    this.sun.position.set(tg.x + this.sunDir.x, this.sunDir.y, tg.z + this.sunDir.z);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - span) > 0.5) {
      sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = 220;
      sc.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.rig.camera);
  }
}
