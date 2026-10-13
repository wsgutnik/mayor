import * as THREE from "three";
import type { CityState } from "../sim/sim";
import {
  ZONE, COVER, LAND_VALUE_LAYER, TRAFFIC_LAYER, UNDERGROUND_LAYER, FacilityKind, idx, tileHeight, isLand, World,
  RoadType, Pt, inBounds, heightAt, Biome, blocksBuilding, isTunnelTile,
} from "../sim/world";
import { CameraRig } from "./camera";
import { buildModels, makeWindowTextures } from "./models";
import { zoneEntries, tileHash, facilityEntry, pickLotEntry } from "../sim/catalog";
import { lotFrontTile, lotInstances } from "./lots";
import { loadGlb, LoadedModel } from "./glb-models";
import { BUS_LOOKS, CAR_LOOKS, FLEET_BY_ROLE, TRUCK_LOOKS, pickLook } from "./fleet";
import { WaterSurface, makeNoiseTexture, tierForPixelCap } from "./water";
import { Ambience, SmokeSource } from "./ambience";
import { TrafficState, ROAD_CAPACITY } from "../sim/traffic";
import { buildRoadNetworkGeometry, buildStripGeometry } from "./roads";
import { UndergroundView } from "./underground";
import { createRoadDetailMaterial, loadRoadAtlas, loadRoadDetailMaps, RoadDetail } from "./road-material";
import { createTerrainSplatMaterial, loadSplatMaps, SplatTier, TerrainSplat } from "./terrain-splat";
import { createPlotMaterial } from "./plot-material";
import { LodSorter } from "./lod";
import { QUALITY_PROFILE, qualityForPixelCap } from "../prefs";
import { configureKitTextures } from "./kit-materials";
import { nodeArms, signalNodes, signalPhase } from "../sim/roads";
import { PROP_KINDS, PropKind, planProps } from "../sim/props";
import { PROP_TINT, propGeometry } from "./props";
import { nearestCell } from "../sim/mirror";
import type { ZoneBlockSet } from "../sim/zoneblocks";
import type { CellPose, CellRef } from "../sim/zonecells";

const ZONE_TILE = {
  [ZONE.RES]: new THREE.Color("#4fbf6a"),
  [ZONE.COM]: new THREE.Color("#4a8fe0"),
  [ZONE.IND]: new THREE.Color("#e0b43a"),
} as const;
/** Street kerb strips and the shared plot under multi-tile buildings. */
const KERB_TINT = new THREE.Color("#dfe3e8");
const PLOT_TINT = new THREE.Color("#c9c2b4");

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
const CAR_MODELS = CAR_LOOKS;
const VEHICLE_PROPS = [...new Set<string>([...CAR_LOOKS, ...TRUCK_LOOKS, ...BUS_LOOKS, ...Object.values(FLEET_BY_ROLE).flat(), "truck", "bus", "train"])];
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
  private lastUndergroundAt = 0;
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
  private propMeshes = new Map<PropKind, THREE.InstancedMesh>();
  private signalPole!: THREE.InstancedMesh;
  private signalLamp!: THREE.InstancedMesh;
  /** Per signal-lamp instance: true when its arm runs north-south. */
  private signalPoleH = 1.1;
  private signalLampNs: boolean[] = [];
  private lastSignalKey = "";
  private propDensitySeen = -1;
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
  private splat!: TerrainSplat;
  private splatTier: "off" | SplatTier = "off";
  private roadDetail!: RoadDetail;
  private roadAtlasReady = false;
  private roadAtlasAllowed = true;
  private maxAniso = 4;
  private profileAniso = QUALITY_PROFILE.high.aniso as number;
  private plotTex: THREE.Texture | null = null;
  private lod = new LodSorter();
  private lodBox!: THREE.InstancedMesh;
  private lodDist = 70;
  private lodEnabled = true;
  private vegMul = 1;
  private lodFull = new Map<THREE.InstancedMesh, number>();
  private lodAt = new THREE.Vector3(1e9, 0, 0);
  private lodStatsCache = { total: 0, near: 0, boxed: 0, culled: 0 };
  private fogBase = 0.0042;
  private lampGlowWarmed = false;
  private ambience!: Ambience;
  private asphaltTex!: THREE.Texture;
  private lastFrame = 0;
  private markMesh!: THREE.InstancedMesh;
  private previewMesh!: THREE.Mesh;
  /** Crossing markers on the road ghost (junction yellow, grade-separated blue, blocked red). */
  private crossMesh!: THREE.InstancedMesh;
  private zones!: THREE.InstancedMesh;
  private kerbs!: THREE.InstancedMesh;
  private underground!: UndergroundView;
  private warnMesh!: THREE.InstancedMesh;
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
      t.anisotropy = Math.min(this.profileAniso, this.maxAniso);
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    };
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    configureKitTextures(QUALITY_PROFILE.high.tex, this.profileAniso, this.maxAniso);
    this.grassTex = detail("grass");
    this.asphaltTex = detail("asphalt");
    this.plotTex = detail("plot");
    this.splat = createTerrainSplatMaterial();
    this.roadDetail = createRoadDetailMaterial(this.asphaltTex);
    loadRoadDetailMaps(this.asphaltTex, this.maxAniso, this.profileAniso, (m) => this.roadDetail.setMaps(m));
    loadRoadAtlas(this.maxAniso, this.profileAniso, (m) => {
      this.roadDetail.setAtlas(m);
      this.roadAtlasReady = true;
      if (this.roadMesh) this.rebuildRoads();
    }, () => { /* atlas missing: keep the vertex-colour path */ });
    this.scene.background = new THREE.Color("#a9c8e8");
    this.scene.fog = new THREE.FogExp2("#a9c8e8", 0.0042);
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
      this.roadDetail.material,
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
    this.crossMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.42, 0.3, 0.42),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthWrite: false }), 64);
    this.crossMesh.count = 0;
    this.crossMesh.frustumCulled = false;
    this.scene.add(this.crossMesh);
    const tex = makeWindowTextures(Math.min(this.profileAniso, this.maxAniso));
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
    this.underground = new UndergroundView(this.scene);
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
    this.zones = mk(createPlotMaterial({
      texture: this.plotTex,
      anisotropy: this.profileAniso,
      maxAnisotropy: this.maxAniso,
      enabled: QUALITY_PROFILE.high.padTex,
    }));
    this.kerbs = mk(new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    // Amber diamonds over buildings missing power or water (red when both are out).
    this.warnMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ toneMapped: false }), cap);
    this.warnMesh.count = 0;
    this.warnMesh.frustumCulled = false;
    own(this.warnMesh);
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
      // Warmer street light: the bulb emissive reads sodium, not white.
      if (!this.lampGlowWarmed) {
        this.lampGlowWarmed = true;
        for (const g of model.glow) g.emissive.set("#ffc27d");
      }
    });
    // Cheap far buildings: one shared box mesh fed by the LOD pass.
    this.lodFull.clear();
    this.lodBox = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.7, 0.9).translate(0, 0.35, 0),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }), cap,
    );
    this.lodBox.count = 0;
    this.lodBox.frustumCulled = false;
    this.lodBox.setColorAt(0, this.whiteTint);
    this.lodBox.count = 0;
    own(this.lodBox);
    // Street furniture and traffic-light poles/heads: procedural geometry
    // first, swapped for the Blender prop when its GLB exists (same pattern
    // as lamps). Signal lamps stay procedural so phase colours can drive them.
    this.propMeshes.clear();
    for (const kind of PROP_KINDS) {
      const capacity = kind.startsWith("shelter_") || kind === "stop_sign_bus" || kind === "kiosk_route" || kind === "ticket_machine" ? 256 : 1024;
      const m: THREE.InstancedMesh = new THREE.InstancedMesh(propGeometry(kind), new THREE.MeshLambertMaterial({ color: "#ffffff" }), capacity);
      m.count = 0;
      m.frustumCulled = false;
      own(m);
      this.propMeshes.set(kind, m);
      this.useProp(kind, (model) => {
        if (!this.sized.includes(m)) return;
        m.geometry = model.geometry;
        m.material = model.materials;
      });
    }
    this.signalPole = new THREE.InstancedMesh(propGeometry("traffic_light"), new THREE.MeshLambertMaterial({ color: "#ffffff" }) as THREE.Material, 256);
    this.signalPole.count = 0;
    this.signalPole.frustumCulled = false;
    own(this.signalPole);
    this.useProp("traffic_light", (model) => {
      if (!this.sized.includes(this.signalPole)) return;
      this.signalPole.geometry = model.geometry;
      this.signalPole.material = model.materials;
      // The Blender pole is about a third of the procedural one: keep the lit lamp on its head, not floating above it.
      model.geometry.computeBoundingBox();
      this.signalPoleH = Math.max(0.1, model.geometry.boundingBox!.max.y);
      this.seenRevision = -1;
    });
    this.signalLamp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffffff" }), 256);
    this.signalLamp.count = 0;
    this.signalLamp.frustumCulled = false;
    own(this.signalLamp);
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
    this.water?.dispose();
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
    this.terrain = new THREE.Mesh(this.terrainGeo, this.splat.material);
    // Blend bands follow the same biome heights the vertex colours use.
    const look = BIOME_LOOK[this.world.biome];
    this.splat.setParams({ sandAt: 0.3, rockAt: look.rockAt, slopeRock: 0.32 });
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
    let nz = 0, nl = 0, nk = 0;
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
        } else if (blocksBuilding(w, i)) {
          // Drawn as ribbons (see buildRoadGeometry). Tunnels fall through: ground above keeps its trees.
        } else if (!w.zone[i]) {
          // Open ground: scatter plants by terrain preset, never on water or the entry strip.
          const r = hash(x * 7 + 3, y * 13 + 5);
          if (r < look.trees * this.vegMul && isLand(w, x, y) && h > 0.2 && h < look.rockAt + 1.5 && Math.hypot(x - w.entry.x, y - w.entry.y) > 5) {
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
        } // zoned tiles draw per lot below (pads for empty lots, one building per built lot)
      }
    }
    // Lots: empty lots read as depth-shaded pads with a street kerb; built
    // lots hold one composed building on a shared plot, facing the street.
    const renderLots = w.zoning === "oriented" ? (w.olots ?? []) : w.lots;
    for (const lot of renderLots) {
      const z = lot.zone as 1 | 2 | 3;
      // The kerb strip belongs on a road edge: skip lots whose front is not actually a road tile.
      const onRoad = "cx" in lot
        ? lot.col === 0
        : (() => {
            const front = lotFrontTile(lot);
            return !!front && inBounds(w, front.x, front.y) && w.road[idx(w, front.x, front.y)] > 0;
          })();
      const plan = lotInstances(lot, onRoad);
      const c = plan.centre;
      let hLot = 0;
      if ("cx" in lot) hLot = heightAt(w, c.x, c.z);
      else {
        for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) hLot += tileHeight(w, x, y);
        hLot /= plan.area;
      }
      for (const kerb of plan.kerb) {
        if (nk >= this.kerbs.instanceMatrix.count) break;
        d.position.set(kerb.x, heightAt(w, kerb.x, kerb.z) + 0.06, kerb.z);
        d.rotation.set(0, kerb.yaw, 0);
        d.scale.set(kerb.sx, 0.14, kerb.sz);
        d.updateMatrix();
        this.kerbs.setMatrixAt(nk, d.matrix);
        this.kerbs.setColorAt(nk++, KERB_TINT);
        d.rotation.set(0, 0, 0);
      }
      if (lot.level === 0) {
        for (const pad of plan.pad) {
          if (nz >= this.zones.instanceMatrix.count) break;
          d.position.set(pad.x, this.padY(pad.x, pad.z, pad.sx, pad.sz, pad.yaw, 0.03), pad.z);
          d.rotation.set(0, pad.yaw, 0);
          d.scale.set(pad.sx, 0.06, pad.sz);
          d.updateMatrix();
          this.zones.setMatrixAt(nz, d.matrix);
          this.zones.setColorAt(nz++, tint.copy(ZONE_TILE[z]).multiplyScalar(pad.shade));
          d.rotation.set(0, 0, 0);
        }
      } else {
        for (const pad of plan.pad) {
          if (nz >= this.zones.instanceMatrix.count) break;
          d.position.set(pad.x, this.padY(pad.x, pad.z, pad.sx, pad.sz, pad.yaw, 0.02), pad.z);
          d.rotation.set(0, pad.yaw, 0);
          d.scale.set(pad.sx, 0.08, pad.sz);
          d.updateMatrix();
          this.zones.setMatrixAt(nz, d.matrix);
          this.zones.setColorAt(nz++, PLOT_TINT);
          d.rotation.set(0, 0, 0);
        }
        const r = hash(Math.floor(c.x), Math.floor(c.z));
        if (z === 3 && lot.level >= 2) {
          smoke.push({ x: c.x + 0.22, y: hLot + (lot.level === 3 ? 0.95 : 0.7), z: c.z - 0.2, strength: lot.level === 3 ? 0.8 : 0.5 });
        }
        const look = pickLotEntry(z, lot.level, plan.area, tileHash(Math.floor(c.x) + 17, Math.floor(c.z) + 29));
        const mesh = this.bMeshes.get(`${z}-${look.level}-${look.index}`);
        if (mesh) {
          tint.setScalar(0.9 + r * 0.2);
          for (const cell of plan.models) {
            this.placeLotCell(mesh, counts, cell.x, cell.z, cell.yaw, 0.92 + r * 0.2, tint);
          }
        }
      }
    }
    this.zones.count = nz;
    this.zones.instanceMatrix.needsUpdate = true;
    if (this.zones.instanceColor) this.zones.instanceColor.needsUpdate = true;
    this.kerbs.count = nk;
    this.kerbs.instanceMatrix.needsUpdate = true;
    if (this.kerbs.instanceColor) this.kerbs.instanceColor.needsUpdate = true;
    const furniturePlan = planProps(w, this.propDensity());
    const alternateLamps = furniturePlan.filter((p) => p.kind === "streetlight_b");
    // Street lamps on the verge of every fourth street and avenue tile, arm turned over the road.
    for (let y = 0; y < w.size && nl < this.lampMesh.instanceMatrix.count; y++) {
      for (let x = 0; x < w.size; x++) {
        const i2 = y * w.size + x;
        const cls = w.roadSurface[i2];
        if (!cls || cls === 3 || (x + y * 3) % 4 !== 0) continue;
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nx = x + dx, ny = y + dy;
          if (!inBounds(w, nx, ny) || blocksBuilding(w, ny * w.size + nx) || w.facility[ny * w.size + nx]) continue;
          // the lamp sits on the neighbouring tile's edge nearest the road; its arm (+x) points at the road
          const px = nx + 0.5 - dx * 0.42, pz = ny + 0.5 - dy * 0.42;
          if (alternateLamps.some((p) => Math.hypot(p.x - px, p.z - pz) < 1.5)) continue;
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
    // Warning diamonds over buildings missing power or water (hidden underground).
    let nw = 0;
    const wcap = this.warnMesh.instanceMatrix.count;
    for (let y = 0; y < w.size && nw < wcap; y++) {
      for (let x = 0; x < w.size && nw < wcap; x++) {
        const i = idx(w, x, y);
        if (!w.level[i]) continue;
        const c = w.cover[i];
        const missing = (c & COVER.POWER ? 0 : 1) + (c & COVER.WATER ? 0 : 2);
        if (!missing) continue;
        d.position.set(x + 0.5, tileHeight(w, x, y) + 1.15, y + 0.5);
        d.scale.setScalar(1);
        d.updateMatrix();
        this.warnMesh.setMatrixAt(nw, d.matrix);
        this.warnMesh.setColorAt(nw++, tint.set(missing === 3 ? "#ff5a3c" : "#ffb02e"));
      }
    }
    this.warnMesh.count = nw;
    this.warnMesh.instanceMatrix.needsUpdate = true;
    if (this.warnMesh.instanceColor) this.warnMesh.instanceColor.needsUpdate = true;
    this.rebuildProps(furniturePlan);
    this.rebuildSignals();
  }

  /** Quality-tier density for decorative props (low/medium/high pixel caps). */
  private propDensity(): number {
    return this.qualityCap <= 1 ? 0.45 : this.qualityCap < 2 ? 0.75 : 1;
  }

  /** Fill the street-furniture instanced meshes from the deterministic plan. */
  private rebuildProps(planned?: readonly ReturnType<typeof planProps>[number][]): void {
    const w = this.world;
    const density = this.propDensity();
    this.propDensitySeen = density;
    const counts = new Map<PropKind, number>();
    const tint = new THREE.Color();
    const d = this.dummy;
    for (const p of planned ?? planProps(w, density)) {
      const mesh = this.propMeshes.get(p.kind);
      if (!mesh) continue;
      const c = counts.get(p.kind) ?? 0;
      if (c >= mesh.instanceMatrix.count) continue;
      d.position.set(p.x, heightAt(w, p.x, p.z) + 0.07, p.z);
      d.rotation.set(0, p.yaw, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      mesh.setMatrixAt(c, d.matrix);
      mesh.setColorAt(c, tint.set(PROP_TINT[p.kind]));
      counts.set(p.kind, c + 1);
    }
    for (const [kind, mesh] of this.propMeshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    d.rotation.set(0, 0, 0);
  }

  /** One pole + lamp per arm at every signalised node, on the corner to the right of entering traffic. */
  private rebuildSignals(): void {
    const w = this.world;
    const d = this.dummy;
    const tint = new THREE.Color(PROP_TINT.traffic_light);
    this.signalLampNs = [];
    let n = 0;
    for (const node of signalNodes(w)) {
      for (const arm of nodeArms(w, node.id)) {
        if (n >= this.signalPole.instanceMatrix.count) break;
        const px = -arm.dz, pz = arm.dx; // left of the outward arm = right of traffic entering the node
        const cx = node.x + arm.dx * (arm.halfWidth + 0.5) + px * (arm.halfWidth + 0.16);
        const cz = node.z + arm.dz * (arm.halfWidth + 0.5) + pz * (arm.halfWidth + 0.16);
        const y = heightAt(w, cx, cz) + 0.07;
        d.position.set(cx, y, cz);
        d.rotation.set(0, Math.atan2(-arm.dx, -arm.dz), 0);
        d.scale.setScalar(1);
        d.updateMatrix();
        this.signalPole.setMatrixAt(n, d.matrix);
        this.signalPole.setColorAt(n, tint);
        const k = this.signalPoleH / 1.1;
        d.position.set(cx - arm.dx * 0.09 * k, y + this.signalPoleH * 0.92, cz - arm.dz * 0.09 * k);
        d.scale.setScalar(Math.max(0.35, k));
        d.updateMatrix();
        this.signalLamp.setMatrixAt(n, d.matrix);
        this.signalLampNs.push(Math.abs(arm.dx) <= Math.abs(arm.dz));
        n++;
      }
    }
    this.signalPole.count = n;
    this.signalLamp.count = n;
    this.signalPole.instanceMatrix.needsUpdate = true;
    this.signalLamp.instanceMatrix.needsUpdate = true;
    if (this.signalPole.instanceColor) this.signalPole.instanceColor.needsUpdate = true;
    this.lastSignalKey = "";
    d.rotation.set(0, 0, 0);
  }

  /**
   * Lamp colours follow the two-phase cycle (with a 1 s amber at each change).
   * Instance colours are rewritten only when the displayed state changes —
   * a phase flip, the amber window, or day/night — never per frame.
   */
  private updateSignalColors(): void {
    if (!this.signalLamp || this.signalLamp.count === 0) return;
    const time = this.traffic?.time ?? 0;
    const phase = signalPhase(time);
    const cyc = ((time % 16) + 16) % 16;
    const nsAmber = cyc >= 7 && cyc < 8, ewAmber = cyc >= 15;
    const night = this.nightGlow > 0.25;
    const key = `${phase}|${nsAmber ? 1 : 0}|${ewAmber ? 1 : 0}|${night ? 1 : 0}`;
    if (key === this.lastSignalKey) return;
    this.lastSignalKey = key;
    const bright = 1 + this.nightGlow * 1.6; // lamps glow after dark
    const col = new THREE.Color();
    for (let i = 0; i < this.signalLamp.count; i++) {
      const ns = this.signalLampNs[i];
      const amber = ns ? nsAmber : ewAmber;
      const green = ns ? phase === 0 : phase === 1;
      col.set(amber ? "#ffb020" : green ? "#27e05a" : "#ff4038").multiplyScalar(bright);
      this.signalLamp.setColorAt(i, col);
    }
    if (this.signalLamp.instanceColor) this.signalLamp.instanceColor.needsUpdate = true;
  }

  /** Yaw so a model's front (+z) faces the adjacent road, else a stable pseudo-random side. */
  private facing(x: number, y: number): number {
    const w = this.world;
    const road = (nx: number, ny: number) => inBounds(w, nx, ny) && w.roadSurface[ny * w.size + nx] > 0;
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

  /** One composed cell of a lot's building: explicit ground spot and street-facing yaw. */
  private placeLotCell(mesh: THREE.InstancedMesh, counts: Map<THREE.InstancedMesh, number>, fx: number, fz: number, yaw: number, scaleY: number, tint: THREE.Color): void {
    const n = counts.get(mesh) ?? 0;
    if (n >= mesh.instanceMatrix.count) return;
    const d = this.dummy;
    d.position.set(fx, heightAt(this.world, fx, fz) + 0.04, fz);
    d.rotation.set(0, yaw, 0);
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

  private padY(x: number, z: number, sx: number, sz: number, yaw: number, lift: number): number {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    let h = 0;
    for (const ax of [-sx / 2, sx / 2]) {
      for (const dz of [-sz / 2, sz / 2]) h += heightAt(this.world, x + ax * c + dz * s, z - ax * s + dz * c);
    }
    return h / 4 + lift;
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
    this.roadMesh.geometry = buildRoadNetworkGeometry(this.world, (x, z) => this.groundY(x, z),
      { hideBridges: this.underground.visible, atlas: this.roadAtlasReady && this.roadAtlasAllowed });
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
    // Always rebuild: water bed/flow textures, boats and instance buffers all belong to the previous world.
    this.disposeWorldResources();
    this.world = world;
    this.buildWorldResources();
    this.ambience.setMapSize(world.size);
    this.rig.setBounds(world.size);
    this.focusEntry();
    this.seenRevision = -1;
    this.overlaySeen = -1;
    this.overlayLvSeen = -1;
    // Fresh materials arrive opaque; re-ghost them when the soil is showing.
    this.setUndergroundLook(this.overlayLayer === UNDERGROUND_LAYER);
  }

  /**
   * Time of day (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset) and weather.
   * Drives light, sky, fog and window glow.
   */
  setAtmosphere(tod: number, raining: boolean): void {
    this.lastAtmo = [tod, raining];
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const elev = Math.sin((tod - 0.25) * Math.PI * 2);
    const day = clamp01(elev * 1.3 + 0.25);
    const dusk = clamp01(1 - Math.abs(elev) * 3.2) * (elev > -0.3 ? 1 : 0);
    const sky = new THREE.Color("#0a1224").lerp(new THREE.Color("#a9c8e8"), day);
    sky.lerp(new THREE.Color("#f0a070"), dusk * 0.45);
    if (raining) sky.lerp(new THREE.Color("#6f7d8c"), 0.55);
    // The underground view sits on a lit soil-brown backdrop whatever the hour.
    (this.scene.background as THREE.Color).copy(this.overlayLayer === UNDERGROUND_LAYER ? sky.lerp(new THREE.Color("#5a4330"), 0.85) : sky);
    this.dayLevel = day * (raining ? 0.6 : 1);
    this.skyCol.copy(sky);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(sky);
    this.fogBase = raining ? 0.009 : 0.0042 + (1 - day) * 0.0008;
    this.renderer.toneMappingExposure = 0.85 + day * 0.2 - dusk * 0.05;
    const a = (tod - 0.25) * Math.PI * 2;
    this.sunDir.set(-Math.cos(a) * 60, Math.max(6, Math.sin(a) * 70 + 8), 30);
    // Night keeps a readable moonlit floor (cool, soft) instead of near black; the underground view is always lit.
    const night = 1 - day;
    const under = this.overlayLayer === UNDERGROUND_LAYER;
    this.sun.intensity = under ? 1.6 : (0.15 + 1.7 * day + 0.32 * night) * (raining ? 0.55 : 1);
    if (under) this.sun.color.set("#fff4de");
    else this.sun.color.set("#fff4de").lerp(new THREE.Color("#ff9a58"), dusk * 0.6).lerp(new THREE.Color("#9db8ff"), night * 0.7);
    if (under) this.renderer.toneMappingExposure = 1.05;
    this.hemi.intensity = under ? 1.8 : (0.4 + 0.95 * day + 0.5 * night) * (raining ? 0.85 : 1);
    this.winMat.emissiveIntensity = Math.max(0, 1 - day * 1.6) * 1.1;
    this.nightGlow = this.winMat.emissiveIntensity;
    for (const g of this.glowMats) g.emissiveIntensity = this.nightGlow;
    this.rainOn = raining;
    this.rain.visible = raining;
    this.roadDetail.setDayWet(this.dayLevel, raining ? 1 : 0);
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
    const place = (name: string, x: number, z: number, hx: number, hz: number, tint: THREE.Color, boxScale: [number, number, number], boxLift: number, baseY: number) => {
      const glb = this.vehReady.has(name);
      const mesh = glb ? this.vehMeshes.get(name)! : this.vehicleMesh;
      const c = counts.get(mesh) ?? 0;
      if (c >= mesh.instanceMatrix.count) return;
      d.position.set(x, baseY + (glb ? 0.07 : boxLift), z);
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
    const w = this.world;
    const tx = this.rig.target.x, tz = this.rig.target.z;
    const vd2 = this.lodDist * this.lodDist;
    const lodV = this.lodEnabled;
    for (const v of t.vehicles) {
      const i = Math.min(v.tiles.length - 2, Math.floor(v.progress));
      if (i < 0) continue;
      // Layer decides height: tunnel hidden, deck rides deckH, ground stays low even under a deck.
      const vi = Math.min(v.tiles.length - 1, Math.floor(v.progress));
      const rt = v.tiles[vi];
      const layer = v.layers ? v.layers[vi] : (isTunnelTile(w, rt) ? 2 : w.roadDeck[rt] && !w.roadSurface[rt] ? 1 : 0);
      if (layer === 2) continue;
      const p = heading(v.pts, i, v.progress - i, v.kind === 1 ? 0.12 : 0.1);
      const dh = w.deckH[rt];
      const baseY = layer === 1 && !Number.isNaN(dh) ? dh : heightAt(w, p.x, p.z);
      if (lodV && (p.x - tx) * (p.x - tx) + (p.z - tz) * (p.z - tz) > vd2) continue;
      if (v.kind === 1) {
        place(pickLook(TRUCK_LOOKS, v.id), p.x, p.z, p.hx, p.hz, col.set("#f0f0f0"), [0.58, 0.24, 0.26], 0.17, baseY);
      } else {
        place(pickLook(CAR_MODELS, v.id), p.x, p.z, p.hx, p.hz, col.set(CAR[(v.id * 7) % CAR.length]), [0.42, 0.17, 0.22], 0.17, baseY);
      }
    }
    for (const v of t.transit) {
      const i = Math.min(v.tiles.length - 2, Math.floor(v.progress));
      if (i < 0) continue;
      const vi = Math.min(v.tiles.length - 1, Math.floor(v.progress));
      const rt = v.tiles[vi];
      const layer = v.layers ? v.layers[vi] : (isTunnelTile(w, rt) ? 2 : w.roadDeck[rt] && !w.roadSurface[rt] ? 1 : 0);
      if (layer === 2) continue;
      const p = heading(v.pts, i, Math.min(1, v.progress - i), v.kind === "bus" ? 0.14 : 0);
      const dh = w.deckH[rt];
      const baseY = layer === 1 && !Number.isNaN(dh) ? dh : heightAt(w, p.x, p.z);
      if (lodV && (p.x - tx) * (p.x - tx) + (p.z - tz) * (p.z - tz) > vd2) continue;
      place(v.kind === "bus" ? pickLook(BUS_LOOKS, v.id) : "train", p.x, p.z, p.hx, p.hz, col.set(v.color),
        v.kind === "bus" ? [0.8, 0.26, 0.28] : [1.2, 0.3, 0.4], v.kind === "bus" ? 0.22 : 0.3, baseY);
    }
    for (const m of [this.vehicleMesh, ...this.vehMeshes.values()]) {
      m.count = counts.get(m) ?? 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    d.rotation.set(0, 0, 0);
  }

  /** Ghost of a road being drawn; null clears it. Crossing markers reuse one instanced mesh. */
  setRoadPreview(seg: { type: RoadType; pts: Pt[] } | null, valid = true,
    crossings: { x: number; z: number; kind: "junction" | "overpass" | "underpass" | "blocked" }[] = []): void {
    this.previewMesh.visible = !!seg;
    if (!seg) { this.crossMesh.count = 0; this.crossMesh.instanceMatrix.needsUpdate = true; return; }
    this.previewMesh.geometry.dispose();
    // Clamped above the waterline so a bridge draft stays visible over the gap.
    this.previewMesh.geometry = buildStripGeometry([seg], (x, z) => Math.max(this.groundY(x, z), 0.12),
      new THREE.Color(valid ? "#7fe08a" : "#ff6b60"));
    this.previewMesh.position.y = 0.05;
    const m = this.crossMesh, d = this.dummy, col = new THREE.Color();
    let n = 0;
    for (const c of crossings) {
      if (n >= 64) break;
      d.position.set(c.x, Math.max(this.groundY(c.x, c.z), 0.12) + 0.35, c.z);
      d.rotation.set(0, 0, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      m.setMatrixAt(n, d.matrix);
      m.setColorAt(n, col.set(c.kind === "junction" ? "#ffd84a" : c.kind === "blocked" ? "#ff6b60" : "#4aa8ff"));
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
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
    const flat = new Set<THREE.Object3D>([this.zones, this.kerbs, this.overlay, ...this.underground.objects, this.hover, this.water?.mesh as THREE.Object3D].filter(Boolean) as THREE.Object3D[]);
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

  /** Ghost the surface over a dark soil backdrop so the pipe networks underneath read clearly. */
  private lastAtmo: [number, boolean] = [0.5, false];

  private setUndergroundLook(on: boolean): void {
    // Lighting and backdrop depend on the layer: refresh them now, not on the next clock tick.
    this.setAtmosphere(this.lastAtmo[0], this.lastAtmo[1]);
    const fade = (m: THREE.Material | THREE.Material[], opacity: number) => {
      for (const mat of Array.isArray(m) ? m : [m]) {
        mat.transparent = on || mat.transparent && opacity < 1;
        mat.opacity = opacity;
        mat.depthWrite = !on;
        mat.needsUpdate = true;
      }
    };
    fade(this.terrain.material, on ? 0.6 : 1);
    // soil: brown earth while looking underneath, the normal tint otherwise
    (this.terrain.material as THREE.MeshStandardMaterial).color.set(on ? "#a07e58" : "#ffffff");
    fade(this.roadMesh.material, on ? 0.45 : 1);
    fade(this.lodBox.material, on ? 0.3 : 1);
    for (const m of this.bMeshes.values()) fade(m.material, on ? 0.3 : 1);
    for (const m of this.fMeshes.values()) fade(m.material, on ? 0.45 : 1);
    this.zones.visible = !on;
    this.kerbs.visible = !on;
    // Surface clutter hides; the ghosted buildings keep their lots readable.
    for (const m of this.treeMeshes.values()) m.visible = !on;
    this.lampMesh.visible = !on;
    this.stopMesh.visible = !on;
    this.vehicleMesh.visible = !on;
    for (const m of this.vehMeshes.values()) m.visible = !on;
    for (const m of this.boatMeshes.values()) m.visible = !on;
    this.metroMesh.visible = !on;
    this.warnMesh.visible = !on;
    if (this.water) this.water.mesh.visible = !on;
    this.underground.setVisible(on);
    // Bridges are a surface feature: drop the decks while the soil is showing.
    this.rebuildRoads();
  }

  private rebuildOverlay(): void {
    const w = this.world;
    const m = this.overlay;
    const layer = this.overlayLayer;
    if (!layer) { this.overlaySeen = w.revision; m.count = 0; return; }
    if (layer === UNDERGROUND_LAYER) {
      m.count = 0;
      // Like the main rebuild, at most one pipe rebuild per gap while painting;
      // overlaySeen stays stale so the next frames retry until the gap passes.
      const now = performance.now();
      if (now - this.lastUndergroundAt >= REBUILD_GAP_MS || this.overlaySeen === -1) {
        this.lastUndergroundAt = now;
        this.overlaySeen = w.revision;
        this.underground.rebuild(this.world, (x, z) => this.groundY(x, z));
      }
      return;
    }
    this.overlaySeen = w.revision;
    this.overlayLvSeen = w.lvRevision;
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

  pickCell(clientX: number, clientY: number): CellRef | null {
    const p = this.pickPoint(clientX, clientY);
    const set = this.world.cells as unknown as ZoneBlockSet | undefined;
    return p && set ? nearestCell(set, p.x, p.z, 0.75) : null;
  }

  setHover(tile: { x: number; y: number } | null, color = "#ffffff"): void {
    if (!tile) { this.hover.visible = false; return; }
    const h = tileHeight(this.world, tile.x, tile.y);
    this.hover.position.set(tile.x + 0.5, h + 0.1, tile.y + 0.5);
    this.hover.rotation.set(0, 0, 0);
    this.hover.scale.set(1, 1, 1);
    (this.hover.material as THREE.MeshBasicMaterial).color.set(color);
    this.hover.visible = true;
  }

  setHoverCell(pose: CellPose | null, color = "#ffffff"): void {
    if (!pose) { this.hover.visible = false; return; }
    this.hover.position.set(pose.x, heightAt(this.world, pose.x, pose.z) + 0.1, pose.z);
    this.hover.rotation.set(0, pose.yaw, 0);
    this.hover.scale.set(1, 1, 1);
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
    const profile = QUALITY_PROFILE[qualityForPixelCap(cap)];
    this.profileAniso = Math.min(profile.aniso, this.maxAniso);
    configureKitTextures(profile.tex, this.profileAniso, this.maxAniso);
    for (const t of [this.grassTex, this.asphaltTex, this.plotTex]) {
      if (t) t.anisotropy = Math.min(profile.aniso, this.maxAniso);
    }
    const zoneMat = this.zones?.material;
    if (zoneMat && !Array.isArray(zoneMat) && "map" in zoneMat) {
      (zoneMat as THREE.MeshLambertMaterial).map = profile.padTex ? this.plotTex : null;
      zoneMat.needsUpdate = true;
    }
    // Road atlas follows the tier: the low tier keeps flat vertex colours.
    const atlasAllowed = qualityForPixelCap(cap) !== "low";
    if (atlasAllowed !== this.roadAtlasAllowed) {
      this.roadAtlasAllowed = atlasAllowed;
      if (this.roadMesh) this.rebuildRoads();
    }
    // shadows by tier: off on low, a 1k map on medium, 2k on high
    const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const res = profile.shadow === 4096 && (this.renderer.capabilities.maxTextureSize < 8192 || isiOS) ? 2048 : profile.shadow;
    this.sun.castShadow = res > 0;
    if (res > 0 && this.sun.shadow.mapSize.x !== res) {
      this.sun.shadow.mapSize.set(res, res);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // Terrain splat follows the tier; low renders flat vertex colours.
    if (profile.splat !== this.splatTier) {
      this.splatTier = profile.splat;
      if (profile.splat === "off") this.splat.setEnabled(false);
      else {
        const tier = profile.splat;
        loadSplatMaps(tier, this.grassTex, this.maxAniso, this.profileAniso, (m) => {
          if (this.splatTier !== tier) return; // the tier moved on mid-load
          this.splat.setMaps(m);
          this.splat.setEnabled(true);
        });
      }
    }
    // Vegetation density needs a rebuild; the LOD range needs a fresh pass.
    if (profile.veg !== this.vegMul) {
      this.vegMul = profile.veg;
      this.seenRevision = -1;
    }
    this.lodDist = profile.lodDist;
    this.lodAt.set(1e9, 0, 0);
    // Water detail follows the same tier: flat ripple, then normals, then foam.
    this.water?.setTier(tierForPixelCap(cap));
    this.resize();
  }

  /** Debug/measure switch for the distance LOD (on by default). */
  setLodEnabled(on: boolean): void {
    this.lodEnabled = on;
    for (const [m, full] of this.lodFull) {
      if (this.sized.includes(m)) m.count = full;
    }
    this.lodBox.count = 0;
    if (this.lodBox.instanceColor) this.lodBox.instanceColor.needsUpdate = true;
    if (on) this.updateLod(false);
  }

  /** Last LOD pass counts plus live draw stats, for the perf readout. */
  lodStats(): { lod: boolean; dist: number; total: number; near: number; boxed: number; culled: number; triangles: number; calls: number; textures: number } {
    const info = this.renderer.info.render;
    return {
      lod: this.lodEnabled, dist: this.lodDist, ...this.lodStatsCache,
      triangles: info.triangles, calls: info.calls, textures: this.renderer.info.memory.textures,
    };
  }

  /**
   * Distance-bucket LOD: every registered mesh is ordered near-first around
   * the camera target, then only counts change — small far props hide, far
   * buildings move to the shared box mesh. After a rebuild the full counts
   * are re-recorded; otherwise they are restored before re-partitioning.
   */
  private updateLod(afterRebuild: boolean): void {
    const cx = this.rig.target.x, cz = this.rig.target.z;
    this.lodAt.set(cx, 0, cz);
    const dist = this.lodEnabled ? this.lodDist : Infinity;
    let total = 0, near = 0;
    const full = (m: THREE.InstancedMesh): number => {
      if (afterRebuild || !this.lodFull.has(m)) this.lodFull.set(m, m.count);
      m.count = this.lodFull.get(m)!;
      return m.count;
    };
    const box = this.lodBox;
    const boxM = box.instanceMatrix.array as Float32Array;
    const boxC = box.instanceColor?.array as Float32Array | undefined;
    let slots = 0;
    for (const m of this.bMeshes.values()) {
      if (full(m) === 0) continue;
      const r = this.lod.partition(m, cx, cz, dist);
      m.count = this.lodEnabled ? r.near : r.total;
      total += r.total;
      near += m.count;
      if (this.lodEnabled && boxC && m.instanceColor) {
        const sm = m.instanceMatrix.array as Float32Array;
        const sc = m.instanceColor.array as Float32Array;
        for (let i = r.near; i < r.total && slots < box.instanceMatrix.count; i++) {
          boxM.set(sm.subarray(i * 16, i * 16 + 16), slots * 16);
          boxC.set(sc.subarray(i * 3, i * 3 + 3), slots * 3);
          slots++;
        }
      }
    }
    box.count = slots;
    box.instanceMatrix.needsUpdate = true;
    if (box.instanceColor) box.instanceColor.needsUpdate = true;
    for (const m of this.treeMeshes.values()) {
      if (full(m) === 0) { m.count = 0; continue; }
      const r = this.lod.partition(m, cx, cz, dist, { farKeep: (s) => s >= 1 });
      m.count = this.lodEnabled ? r.kept : r.total;
      total += r.total;
      near += m.count;
    }
    if (full(this.lampMesh) > 0) {
      const r = this.lod.partition(this.lampMesh, cx, cz, dist);
      this.lampMesh.count = this.lodEnabled ? r.kept : r.total;
      total += r.total;
      near += this.lampMesh.count;
    }
    for (const m of [this.zones, this.kerbs]) {
      if (full(m) === 0) { m.count = 0; continue; }
      const r = this.lod.partition(m, cx, cz, dist);
      m.count = this.lodEnabled ? r.near : r.total;
      total += r.total;
      near += m.count;
    }
    this.lodStatsCache = { total, near, boxed: slots, culled: total - near - slots };
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
      this.updateLod(true);
    }
    this.frame++;
    if (this.frame % 45 === 0) {
      const t = this.rig.target;
      const dx = t.x - this.lodAt.x, dz = t.z - this.lodAt.z;
      if (dx * dx + dz * dz > 36) this.updateLod(false);
    }
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
    if (this.underground.visible) this.underground.update(time);
    this.updateBoats(dt, time);
    this.ambience.update(time, dt, this.dayLevel, this.skyCol);
    this.updateVehicles();
    this.updateSignalColors();
    if (this.propDensitySeen >= 0 && this.propDensitySeen !== this.propDensity()) this.rebuildProps();
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
    // Height-flavoured fog: thin haze from high above, thicker at street level.
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = this.fogBase * THREE.MathUtils.clamp(1.25 - this.rig.camera.position.y / 140, 0.65, 1.25);
    this.renderer.render(this.scene, this.rig.camera);
  }
}
