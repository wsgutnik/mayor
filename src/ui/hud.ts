import { ROAD_TYPES } from "../sim/world";
import { specOf } from "../sim/roadprofile";
import { CityState, COST, ToolId, UtilityKey, CivicKey, dateOf, DAYS_PER_MONTH, FACILITY_OF_TOOL, facilityToolFootprint, isFacilityTool } from "../sim/sim";
import { facilityUsage } from "../sim/facility-usage";
import { usageRows } from "./facility-usage-view";
import { MAX_LINE_VEHICLES, transitTotals } from "../sim/transit";
import { COVER, LAND_VALUE_LAYER, TRAFFIC_LAYER, UNDERGROUND_LAYER, RoadType } from "../sim/world";
import type { OverlayLayer } from "../render/scene";
import { getLang, lineName, monthName, tr } from "../i18n";
import { facilityEntry, thumbnailOf } from "../sim/catalog";
import { PanelId, PanelState, loadPanelState, savePanelState, setPanelsHidden, togglePanelCollapsed } from "./panel-state";
import type { RoadReadoutRow } from "./road-readout";
import { cityEvents } from "./events";
import { ToastsView, type ToastInput, type ToastTone } from "./toasts";
import { Tooltip, type TooltipContent } from "./tooltip";
import { LegendView } from "./legend";
import { OnboardingCard, type OnboardingSnapshot } from "./onboarding";
import { DEFAULT_ROAD_SNAP, type AngleSnap, type LengthSnap, type RoadSnapOptions } from "./road-snap";
import type { ZoneMode } from "./zone-tools";
import { DEFAULT_ROAD_PARALLEL, type ParallelGap, type ParallelSide, type RoadParallelOptions } from "./road-parallel";
import {
  initialToolState, isRoadGroupTool, ZONE_TOOLS, type FlyoutId, type RoadLevel, type RoadMode, type ToolEvent, type ToolState,
} from "./tool-state";
import { ROAD_LEVEL_LABEL, ROAD_MODE_LABEL, roadFacts, roadSummary } from "./road-facts";
import { toolAvailability } from "./tool-availability";

export type { RoadLevel, RoadMode } from "./tool-state";

/** Art from the brand sheet (public/ui) or a plain glyph. */
interface Icon { img?: string; glyph?: string; color?: string }

interface ToolDef { id: ToolId; label: string; hint: string; color: string; icon: Icon }

const T: Record<string, ToolDef> = {
  pan: { id: "pan", label: "Move", hint: "Drag to move the camera", color: "#ffffff", icon: { glyph: "✋" } },
  road: { id: "road", label: "Roads", hint: "Draw roads", color: "#9aa3b2", icon: { img: "kit/ico-estrada" } },
  res: { id: "res", label: "Residential", hint: "Zone residential", color: "#4fbf6a", icon: { img: "kit/tile-residential" } },
  com: { id: "com", label: "Commercial", hint: "Zone commercial", color: "#4a8fe0", icon: { img: "kit/tile-commercial" } },
  ind: { id: "ind", label: "Industrial", hint: "Zone industrial", color: "#e0b43a", icon: { img: "kit/tile-industrial" } },
  power: { id: "power", label: "Power plant", hint: "Place a power plant (2x2, feeds the road grid)", color: "#f2c230", icon: { img: "kit/ico-energia" } },
  water: { id: "water", label: "Water pump", hint: "Place a water pump near water (2x2, feeds the road grid)", color: "#39b6e8", icon: { img: "kit/ico-agua" } },
  sewage: { id: "sewage", label: "Sewage", hint: "Place a sewage outlet near water (feeds the road grid)", color: "#a07848", icon: { glyph: "≋", color: "#a07848" } },
  landfill: { id: "landfill", label: "Landfill", hint: "Place a landfill (radius 12)", color: "#9aa3ad", icon: { img: "kit/ico-reciclar" } },
  police: { id: "police", label: "Police", hint: "Police station: crime cover (radius 12)", color: "#3d6ee8", icon: { img: "kit/ico-escudo" } },
  fire: { id: "fire", label: "Fire", hint: "Fire station: stops fires (radius 12)", color: "#ee5a4c", icon: { img: "kit/ico-extintor" } },
  clinic: { id: "clinic", label: "Clinic", hint: "Clinic: health cover (radius 12)", color: "#f2f6fb", icon: { img: "kit/ico-maleta" } },
  school: { id: "school", label: "School", hint: "School: education, needed for level 3 (radius 14)", color: "#f59a4a", icon: { img: "kit/ico-formatura" } },
  park: { id: "park", label: "Park", hint: "Park: land value and happiness (radius 8)", color: "#48b85a", icon: { img: "kit/ico-arvore" } },
  busstop: { id: "busstop", label: "Bus stop", hint: "Place a bus stop on a street or avenue", color: "#3d8bff", icon: { img: "kit/ico-onibus" } },
  metro: { id: "metro", label: "Metro station", hint: "Metro station: 2x2 footprint (radius 9)", color: "#9b7bff", icon: { img: "kit/ico-trem" } },
  busline: { id: "busline", label: "Bus line", hint: "Tap bus stops in order, then Create line", color: "#3d8bff", icon: { glyph: "➰", color: "#3d8bff" } },
  metroline: { id: "metroline", label: "Metro line", hint: "Tap metro stations in order, then Create line", color: "#9b7bff", icon: { glyph: "➿", color: "#9b7bff" } },
  trainstation: { id: "trainstation", label: "Train station", hint: "Train station: 2x2 footprint (radius 12)", color: "#e07a3f", icon: { img: "kit/ico-trem" } },
  trainline: { id: "trainline", label: "Train line", hint: "Tap train stations in order, then Create line", color: "#e07a3f", icon: { glyph: "🚆", color: "#e07a3f" } },
  hospital: { id: "hospital", label: "Hospital", hint: "General hospital: 2x2 footprint (radius 18)", color: "#f2f6fb", icon: { img: "kit/ico-maleta" } },
  highschool: { id: "highschool", label: "High school", hint: "Secondary school: 2x2 footprint (radius 20)", color: "#f59a4a", icon: { img: "kit/ico-formatura" } },
  library: { id: "library", label: "Library", hint: "Public library: culture and happiness (radius 12)", color: "#d98a55", icon: { img: "kit/ico-governo" } },
  community: { id: "community", label: "Community centre", hint: "Community centre: culture and happiness (radius 10)", color: "#e6dccb", icon: { img: "kit/ico-pessoas" } },
  museum: { id: "museum", label: "Museum", hint: "City museum: culture and land value (radius 16)", color: "#efe6d2", icon: { img: "kit/ico-trofeu" } },
  cityhall: { id: "cityhall", label: "City hall", hint: "City hall (2x2, one per city): happiness and tax income", color: "#4f5f86", icon: { img: "kit/ico-martelo" } },
  substation: { id: "substation", label: "Substation", hint: "Substation: relays power to nearby roads", color: "#cfd3d6", icon: { img: "kit/ico-energia" } },
  solar: { id: "solar", label: "Solar plant", hint: "Solar plant: clean power, no smoke (2x2, feeds the road grid)", color: "#f2c230", icon: { img: "kit/ico-energia" } },
  powerlarge: { id: "powerlarge", label: "Large power plant", hint: "Large power plant: high output (2x2, feeds the road grid)", color: "#e08a3c", icon: { img: "kit/ico-energia" } },
  watertower: { id: "watertower", label: "Water tower", hint: "Water tower: small supply, no water tile needed (feeds the road grid)", color: "#39b6e8", icon: { img: "kit/ico-agua" } },
  waterlarge: { id: "waterlarge", label: "Large water plant", hint: "Large water plant near water (2x2, feeds the road grid)", color: "#2a86cc", icon: { img: "kit/ico-agua" } },
  firepost: { id: "firepost", label: "Fire post", hint: "Fire post: fast local cover (radius 8)", color: "#ee5a4c", icon: { img: "kit/ico-extintor" } },
  firehq: { id: "firehq", label: "Fire headquarters", hint: "Fire headquarters: 2x2, wide cover (radius 20)", color: "#c22f28", icon: { img: "kit/ico-extintor" } },
  bulldoze: { id: "bulldoze", label: "Bulldoze", hint: "Remove roads, zones and facilities", color: "#e5584f", icon: { img: "kit/ico-lixeira" } },
  roundabout: { id: "roundabout", label: "Roundabout", hint: "Stamp a roundabout on a junction", color: "#9aa3b2", icon: { glyph: "⟳", color: "#9aa3b2" } },
};

/** Every tool label and hint (translated in src/i18n.ts; facility-usage-view.test.ts checks pt-BR coverage). */
export const TOOL_I18N_KEYS: string[] = Object.values(T).flatMap((t) => [t.label, t.hint]);

/** Section titles and row labels the flyouts render (strings.test.ts checks pt-BR). */
export const FLYOUT_I18N_KEYS: string[] = [
  "Type", "Draw", "Level", "Tools", "Zone", "Shape", "Stops", "Lines", "Lanes", "Width", "One-way", "per tile", "Footprint",
  "Tap a start, then an end", "Tap start, a bend point, then the end", "Tap where a road crosses a highway to build an interchange",
  "Tap a road to change its class", "Press E to cycle", "Both legs are planned together and undo as one",
  "Interchange", "Upgrade road", "Roundabout", "Infoview", "On", "Off", "Back", "Buildings",
];

const ZONE_MODES: { mode: ZoneMode; label: string; glyph: string }[] = [
  { mode: "paint", label: "Paint", glyph: "🖌" },
  { mode: "marquee", label: "Marquee", glyph: "⛶" },
  { mode: "fill", label: "Fill", glyph: "🪣" },
];
/** Services grouped by type, tiers side by side: one lean flyout, no tool lost. */
const SERVICE_GROUPS: { label: string; icon: string; tools: string[] }[] = [
  { label: "Power", icon: "kit/ico-energia", tools: ["power", "solar", "powerlarge", "substation"] },
  { label: "Water", icon: "kit/ico-agua", tools: ["water", "watertower", "waterlarge", "sewage"] },
  { label: "Safety", icon: "kit/ico-escudo", tools: ["police", "firepost", "fire", "firehq"] },
  { label: "Health & schools", icon: "kit/ico-maleta", tools: ["clinic", "hospital", "school", "highschool"] },
  { label: "City", icon: "kit/ico-governo", tools: ["park", "library", "community", "museum", "cityhall", "landfill"] },
];
const SERVICE_TOOLS = SERVICE_GROUPS.flatMap((g) => g.tools);
const TRANSIT_GROUPS: { label: string; tools: string[] }[] = [
  { label: "Stops", tools: ["busstop", "metro", "trainstation"] },
  { label: "Lines", tools: ["busline", "metroline", "trainline"] },
];
const TRANSIT_TOOLS = TRANSIT_GROUPS.flatMap((g) => g.tools);

const ROAD_MODES: { mode: RoadMode; glyph: string; hint: string }[] = [
  { mode: "line", glyph: "╱", hint: "Tap a start, then an end" },
  { mode: "curve", glyph: "⌒", hint: "Tap start, a bend point, then the end" },
];

const ROAD_LEVELS: { level: RoadLevel; glyph: string }[] = [
  { level: "ground", glyph: "─" },
  { level: "elevated", glyph: "⌒" },
  { level: "tunnel", glyph: "⌄" },
];

const ROAD_GLYPH: Record<RoadType, string> = { 1: "─", 2: "═", 3: "≡", 4: "→", 5: "⇒", 6: "↗" };

const LAYERS: { layer: OverlayLayer; label: string; glyph: string; color: string; img?: string }[] = [
  { layer: 0, label: "Off", glyph: "○", color: "#ffffff" },
  { layer: COVER.POWER, label: "Power", glyph: "⚡", color: "#f2c230", img: "kit/ico-energia" },
  { layer: COVER.WATER, label: "Water", glyph: "💧", color: "#39b6e8", img: "kit/ico-agua" },
  { layer: COVER.SEWAGE, label: "Sewage", glyph: "≋", color: "#a07848" },
  { layer: COVER.GARBAGE, label: "Garbage", glyph: "♻", color: "#9aa3ad", img: "kit/ico-reciclar" },
  { layer: COVER.POLICE, label: "Police", glyph: "★", color: "#3d6ee8", img: "kit/ico-escudo" },
  { layer: COVER.FIRE, label: "Fire", glyph: "▲", color: "#ee5a4c", img: "kit/ico-extintor" },
  { layer: COVER.HEALTH, label: "Health", glyph: "✚", color: "#f2f6fb", img: "kit/ico-maleta" },
  { layer: COVER.EDU, label: "Education", glyph: "✎", color: "#f59a4a", img: "kit/ico-formatura" },
  { layer: COVER.PARK, label: "Parks", glyph: "❀", color: "#48b85a", img: "kit/ico-arvore" },
  { layer: COVER.CULTURE, label: "Culture", glyph: "✦", color: "#e8b35a", img: "kit/ico-trofeu" },
  { layer: COVER.TRANSIT, label: "Transit", glyph: "◴", color: "#9b7bff", img: "kit/ico-onibus" },
  { layer: LAND_VALUE_LAYER, label: "Land value", glyph: "▦", color: "#7fd35c", img: "kit/ico-grafico" },
  { layer: TRAFFIC_LAYER, label: "Traffic", glyph: "⇆", color: "#e5584f", img: "kit/ico-estrada" },
  { layer: UNDERGROUND_LAYER, label: "Underground", glyph: "⌸", color: "#c89a5a" },
];

export const toolColor = (t: ToolId) => (T[t] ? T[t].color : "#ffffff");

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (n: number) => (n < 0 ? "-$" : "$") + fmt(Math.abs(n));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const iconHtml = (i: Icon) =>
  i.img
    ? `<img class="ic-img" src="/ui/${i.img}.png" alt="" draggable="false">`
    : `<span class="ic" style="${i.color ? `color:${i.color}` : ""}">${i.glyph ?? ""}</span>`;

export interface HudHooks {
  onMenu(): void;
  /** Every tool, flyout, road and zoning choice goes through the tool state machine (src/ui/tool-state.ts). */
  onEvent(e: ToolEvent): void;
  onCreateLine(): void;
  onLineVehicles(id: number, delta: number): void;
  onRemoveLine(id: number): void;
  onFinishRoad(): void;
  /** Road-draft snap options changed (angle / length / road toggles). */
  onSnap?(opts: RoadSnapOptions): void;
  /** Parallel-road options changed (toggle / gap / side). */
  onParallel?(opts: RoadParallelOptions): void;
  onSpeed(s: number): void;
  onUndo(): void;
  /** Reset the camera to the default overview (a stray gesture can lose the map). */
  onHomeView?(): void;
  onRedo(): void;
  onTax(rate: number): void;
  onOverlay(layer: OverlayLayer): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const SERVICE_ROWS: { key: UtilityKey; label: string; color: string }[] = [
  { key: "power", label: "Power", color: "#f2c230" },
  { key: "water", label: "Water", color: "#39b6e8" },
  { key: "sewage", label: "Sewage", color: "#a07848" },
  { key: "garbage", label: "Garbage", color: "#9aa3ad" },
];

const CIVIC_ROWS: { key: CivicKey; label: string; color: string }[] = [
  { key: "police", label: "Police", color: "#3d6ee8" },
  { key: "fire", label: "Fire", color: "#ee5a4c" },
  { key: "health", label: "Health", color: "#e8eef5" },
  { key: "edu", label: "Education", color: "#f59a4a" },
  { key: "park", label: "Parks", color: "#48b85a" },
  { key: "transit", label: "Transit", color: "#9b7bff" },
  { key: "culture", label: "Culture", color: "#e8b35a" },
];

const INDICATORS = [
  { key: "pop", label: "Popularity", icon: "kit/ico-pessoas", colors: ["#e5584f", "#f0b43a", "#5fd08a"] },
  { key: "bud", label: "Budget", icon: "kit/ico-dinheiro", colors: ["#e5584f", "#f0b43a", "#5fd08a"] },
  { key: "env", label: "Environment", icon: "kit/ico-ambiente", colors: ["#e5584f", "#f0b43a", "#5fd08a"] },
  { key: "trf", label: "Traffic", icon: "kit/ico-estrada", colors: ["#e5584f", "#f0b43a", "#5fd08a"] },
] as const;

export class Hud {
  private root: HTMLElement;
  private moneyEl!: HTMLElement;
  private deltaEl!: HTMLElement;
  private popEl!: HTMLElement;
  private dateEl!: HTMLElement;
  private jobsEl!: HTMLElement;
  private skyEl!: HTMLElement;
  private bars!: { r: HTMLElement; c: HTMLElement; i: HTMLElement };
  private toolBtns = new Map<ToolId, HTMLElement>();
  private groupBtns = new Map<string, HTMLElement>();
  private flyouts = new Map<string, HTMLElement>();
  private speedBtns: HTMLElement[] = [];
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private speedSlot!: HTMLElement;
  private demandPanel!: HTMLElement;
  private readout!: HTMLElement;
  /** P3-B views: stacked toasts + bell, rich tooltip, infoview legend, guide card. */
  private toasts!: ToastsView;
  /** Shared rich tooltip (main.ts suspends it while the menu is open). */
  tooltip!: Tooltip;
  private legend!: LegendView;
  private guide!: OnboardingCard;
  private speedVal = 1;
  private lastState: CityState | null = null;
  private guideStarted = false;
  private budget!: HTMLElement;
  private hint!: HTMLElement;
  private finishBtn!: HTMLElement;
  private createBtn!: HTMLElement;
  private linesPanel!: HTMLElement;
  private linesBody!: HTMLElement;
  private linesSig = "";
  private panels: PanelState = loadPanelState();
  private leftCol!: HTMLElement;
  private panelToggles = new Map<PanelId, { panel: HTMLElement; btn: HTMLButtonElement; label: HTMLElement; text: string }>();
  private stackHideBtn!: HTMLButtonElement;
  private stackShowBtn!: HTMLButtonElement;
  private viewBtn!: HTMLElement;
  private layerBtns: HTMLElement[] = [];
  private roadTypeBtns = new Map<RoadType, HTMLElement>();
  private roadModeBtns = new Map<RoadMode, HTMLElement>();
  private roadLevelBtns = new Map<RoadLevel, HTMLElement>();
  private zoneModeBtns = new Map<ZoneMode, HTMLElement>();
  private upgradeBtn!: HTMLButtonElement;
  private interchangeBtn!: HTMLButtonElement;
  private roadSummaryEl!: HTMLElement;
  /** The rendered tool state; main.ts owns the real one and calls render() after every event. */
  private ui: ToolState = initialToolState();
  /** Why each build button is greyed out right now (null = usable); refreshed from the city each frame. */
  private avail = new Map<ToolId, string | null>();
  private snap: RoadSnapOptions = { ...DEFAULT_ROAD_SNAP };
  private snapAngleBtns = new Map<AngleSnap, HTMLButtonElement>();
  private snapLengthBtns = new Map<LengthSnap, HTMLButtonElement>();
  private snapRoadsBtn: HTMLButtonElement | null = null;
  private snapGuidesBtn: HTMLButtonElement | null = null;
  private snapTouchOffsetBtn: HTMLButtonElement | null = null;
  private parallel: RoadParallelOptions = { ...DEFAULT_ROAD_PARALLEL };
  private parallelToggleBtn: HTMLButtonElement | null = null;
  private parallelGapBtns = new Map<ParallelGap, HTMLButtonElement>();
  private parallelSideBtns = new Map<ParallelSide, HTMLButtonElement>();
  private svc = new Map<UtilityKey, { fill: HTMLElement; val: HTMLElement }>();
  private civ = new Map<CivicKey, { fill: HTMLElement; val: HTMLElement }>();
  private ind = new Map<string, { fill: HTMLElement; val: HTMLElement }>();
  private lvEl!: HTMLElement;
  private trafficFill!: HTMLElement;
  private trafficVal!: HTMLElement;
  private tips = true;

  constructor(parent: HTMLElement, private hooks: HudHooks) {
    this.root = el("div", "hud");
    parent.appendChild(this.root);
    this.tooltip = new Tooltip(this.root);
    this.buildTop();
    this.buildLeft();
    this.buildBottom();
    this.buildBudget();
    this.toasts = new ToastsView(this.root);
    this.toasts.mountBell(this.speedSlot);
    this.legend = new LegendView(this.leftCol, () => {
      this.hooks.onOverlay(0);
      this.setOverlay(0);
    }, this.stackHideBtn);
    this.guide = new OnboardingCard(this.root, this.leftCol, {
      road: () => this.groupBtns.get("road") ?? null,
      zone: () => this.groupBtns.get("zones") ?? null,
      speed: () => this.speedBtns[2] ?? null,
      grow: () => this.demandPanel ?? null,
    }, cityEvents);
    this.guide.bind(() => this.guideSnapshot());
    this.readout = el("div", "road-readout");
    this.readout.hidden = true;
    this.root.appendChild(this.readout);
    this.render(this.ui);
  }

  destroy(): void {
    this.toasts.destroy();
    this.tooltip.destroy();
    this.legend.destroy();
    this.guide.destroy();
    this.root.remove();
  }

  // ------------------------------------------------------------------ build

  private buildTop(): void {
    const top = el("div", "panel topbar");
    top.innerHTML = `
      <div class="stat"><span class="lbl">${tr("Population")}</span><b data-k="pop">0</b></div>
      <div class="stat"><span class="lbl">${tr("Jobs")}</span><b data-k="jobs">0</b></div>
      <div class="stat date"><span class="lbl">${tr("Date")} <span data-k="sky"></span></span><b data-k="date"></b></div>
      <div class="stat"><span class="lbl">${tr("Balance")}</span><b data-k="money"></b><small data-k="delta"></small></div>`;
    this.popEl = top.querySelector('[data-k="pop"]')!;
    this.jobsEl = top.querySelector('[data-k="jobs"]')!;
    this.dateEl = top.querySelector('[data-k="date"]')!;
    this.moneyEl = top.querySelector('[data-k="money"]')!;
    this.deltaEl = top.querySelector('[data-k="delta"]')!;
    this.skyEl = top.querySelector('[data-k="sky"]')!;

    const speed = el("div", "speed");
    [["⏸", 0], ["▶", 1], ["▶▶", 2], ["▶▶▶", 4]].forEach(([label, v]) => {
      const b = el("button", "speed-btn", String(label));
      b.setAttribute("aria-label", v === 0 ? tr("Pause") : `${tr("Speed")} ${v}x`);
      b.addEventListener("click", () => this.hooks.onSpeed(v as number));
      speed.appendChild(b);
      this.speedBtns.push(b);
    });
    const undo = el("button", "speed-btn undo-btn", "↩");
    undo.title = tr("Undo");
    undo.setAttribute("aria-label", tr("Undo"));
    undo.addEventListener("click", () => this.hooks.onUndo());
    speed.appendChild(undo);
    this.undoBtn = undo;
    const redo = el("button", "speed-btn undo-btn", "↪");
    redo.title = tr("Redo");
    redo.setAttribute("aria-label", tr("Redo"));
    redo.addEventListener("click", () => this.hooks.onRedo());
    speed.appendChild(redo);
    this.redoBtn = redo;
    const home = el("button", "speed-btn home-btn", "⌂");
    home.title = tr("Reset view");
    home.setAttribute("aria-label", tr("Reset view"));
    home.addEventListener("click", () => this.hooks.onHomeView?.());
    speed.appendChild(home);
    const menu = el("button", "speed-btn menu-btn", `<img class="ic-img sm" src="/ui/kit/ico-engrenagem.png" alt="">`);
    menu.title = tr("Menu: save, load, new city");
    menu.setAttribute("aria-label", tr("Menu: save, load, new city"));
    menu.addEventListener("click", () => this.hooks.onMenu());
    speed.appendChild(menu);
    this.speedSlot = speed;
    top.appendChild(speed);
    this.root.appendChild(top);
  }

  private buildLeft(): void {
    const col = el("div", "left-col");
    this.leftCol = col;

    const rci = el("div", "panel demand");
    rci.innerHTML = `
      <div class="demand-body"><div class="bar r"><i></i></div><div class="bar c"><i></i></div><div class="bar i"><i></i></div>
      <div class="demand-legend"><span>R</span><span>C</span><span>I</span></div></div>`;
    const [r, c, i] = Array.from(rci.querySelectorAll<HTMLElement>(".bar i"));
    this.bars = { r, c, i };
    const rciBtn = el("button", "svc-head toggle demand-toggle", "<span></span>");
    rciBtn.setAttribute("aria-label", tr("Demand"));
    rci.appendChild(rciBtn);
    this.demandPanel = rci;
    this.collapsible("demand", rci, rciBtn, rciBtn.querySelector("span")!, "");
    col.appendChild(rci);

    const ind = el("div", "panel indicators");
    const indBtn = el("button", "svc-head toggle", "<span></span>");
    ind.appendChild(indBtn);
    for (const d of INDICATORS) {
      const row = el("div", "ind",
        `<img class="ic-img xs" src="/ui/${d.icon}.png" alt=""><span class="ind-l">${tr(d.label)}</span>` +
        `<div class="ind-bar"><i></i></div><span class="ind-v">–</span>`);
      this.ind.set(d.key, { fill: row.querySelector("i")!, val: row.querySelector(".ind-v")! });
      ind.appendChild(row);
    }
    this.collapsible("indicators", ind, indBtn, indBtn.querySelector("span")!, "Indicators");
    col.appendChild(ind);

    const p = el("div", "panel services");
    const head = el("button", "svc-head toggle", "<span></span><b></b>");
    p.appendChild(head);
    for (const r2 of SERVICE_ROWS) p.appendChild(this.svcRow(r2.label, r2.color, "none", (f, v) => this.svc.set(r2.key, { fill: f, val: v })));
    for (const r2 of CIVIC_ROWS) p.appendChild(this.svcRow(r2.label, r2.color, "0%", (f, v) => this.civ.set(r2.key, { fill: f, val: v })));
    p.appendChild(this.svcRow("Traffic", "#e5584f", `0 ${tr("cars")}`, (f, v) => { this.trafficFill = f; this.trafficVal = v; }));
    const lv = el("div", "svc-head lv", `<span>${tr("Land value")}</span><b data-k="lv">0</b>`);
    this.lvEl = lv.querySelector('[data-k="lv"]')!;
    p.appendChild(lv);
    this.collapsible("services", p, head, head.querySelector("span")!, "Services");
    col.appendChild(p);

    this.stackHideBtn = el("button", "tool stack-hide", `<span class="ic">◂</span><span>${tr("Hide panels")}</span>`);
    this.stackHideBtn.addEventListener("click", () => this.setPanelsHidden(true));
    col.appendChild(this.stackHideBtn);
    this.root.appendChild(col);

    this.stackShowBtn = el("button", "panel stack-show", `<span aria-hidden="true">▸</span>`);
    this.stackShowBtn.title = tr("Show panels");
    this.stackShowBtn.setAttribute("aria-label", tr("Show panels"));
    this.stackShowBtn.addEventListener("click", () => this.setPanelsHidden(false));
    this.root.appendChild(this.stackShowBtn);
    this.applyPanelsHidden();
  }

  /** Wire one permanent panel to its collapse toggle, restoring and persisting state. */
  private collapsible(id: PanelId, panel: HTMLElement, btn: HTMLButtonElement, label: HTMLElement, text: string): void {
    this.panelToggles.set(id, { panel, btn, label, text });
    btn.addEventListener("click", () => {
      this.panels = togglePanelCollapsed(this.panels, id);
      savePanelState(this.panels);
      this.applyPanelCollapsed(id);
    });
    this.applyPanelCollapsed(id);
  }

  private applyPanelCollapsed(id: PanelId): void {
    const t = this.panelToggles.get(id)!;
    const collapsed = this.panels.collapsed[id];
    t.panel.classList.toggle("collapsed", collapsed);
    t.btn.setAttribute("aria-expanded", String(!collapsed));
    const chevron = collapsed ? "▸" : "▾";
    t.label.textContent = t.text ? `${tr(t.text)} ${chevron}` : chevron;
  }

  /** Hide or reveal the whole left stack to show the city; the choice persists. */
  setPanelsHidden(hidden: boolean): void {
    this.panels = setPanelsHidden(this.panels, hidden);
    savePanelState(this.panels);
    this.applyPanelsHidden();
  }

  /** Toggle the left stack (key H). Returns the new hidden state. */
  togglePanelsHidden(): boolean {
    this.setPanelsHidden(!this.panels.panelsHidden);
    return this.panels.panelsHidden;
  }

  get panelsHidden(): boolean { return this.panels.panelsHidden; }

  private applyPanelsHidden(): void {
    const h = this.panels.panelsHidden;
    this.leftCol.classList.toggle("hidden", h);
    this.stackShowBtn.hidden = !h;
    this.stackHideBtn.setAttribute("aria-expanded", String(!h));
    this.stackShowBtn.setAttribute("aria-expanded", String(!h));
  }

  private svcRow(label: string, color: string, initial: string, bind: (fill: HTMLElement, val: HTMLElement) => void): HTMLElement {
    const row = el("div", "svc", `<span class="svc-l">${tr(label)}</span><div class="svc-bar"><i style="background:${color}"></i></div><span class="svc-v">${initial}</span>`);
    bind(row.querySelector("i")!, row.querySelector(".svc-v")!);
    return row;
  }

  /** Tooltip body of a build button: description, cost, footprint and the facility's numbers of use. */
  private toolTip(t: ToolDef): TooltipContent {
    const free = t.id === "pan" || t.id === "busline" || t.id === "metroline" || t.id === "trainline";
    const price = free ? 0 : COST[t.id as Exclude<ToolId, "pan">];
    // Service buildings show their numbers of use before placing: upkeep, capacity or radius, homes served.
    const usage = isFacilityTool(t.id) ? facilityUsage(FACILITY_OF_TOOL[t.id]) : null;
    const fp = isFacilityTool(t.id) ? facilityToolFootprint(t.id) : 0;
    const reason = this.avail.get(t.id);
    return {
      icon: t.icon.glyph, title: tr(t.label), desc: tr(t.hint),
      cost: free ? undefined : price, color: t.color,
      upkeep: usage?.upkeep, rows: usage ? usageRows(usage) : undefined,
      badge: fp ? `${fp}×${fp}` : undefined,
      warn: reason ? tr(reason) : undefined,
    };
  }

  private toolButton(t: ToolDef, big = false): HTMLElement {
    const free = t.id === "pan" || t.id === "busline" || t.id === "metroline" || t.id === "trainline";
    const price = free ? 0 : COST[t.id as Exclude<ToolId, "pan">];
    const cost = free ? "" : `<small>$${price}</small>`;
    const fp = isFacilityTool(t.id) ? facilityToolFootprint(t.id) : 0;
    const badge = fp ? `<em class="fp" aria-label="${tr("Footprint")} ${fp}x${fp}">${fp}×${fp}</em>` : "";
    const b = el("button", "tool", `${iconHtml(t.icon)}<span>${tr(t.label)}</span>${big ? "" : cost}${badge}`);
    b.title = tr(t.hint);
    b.addEventListener("click", () => {
      const reason = this.avail.get(t.id);
      // A greyed button says why instead of arming a tool the map would refuse anyway.
      if (reason) { this.toasts.push({ kind: "warning", title: tr(t.label), text: tr(reason) }); return; }
      this.hooks.onEvent({ kind: "tool", tool: t.id });
    });
    this.tooltip.attach(b, () => this.toolTip(t));
    this.toolBtns.set(t.id, b);
    return b;
  }

  /** A service building as a thumbnail card (Services level 2): photo, name, price, footprint. */
  private buildingCard(t: ToolDef): HTMLElement {
    const entry = isFacilityTool(t.id) ? facilityEntry(FACILITY_OF_TOOL[t.id]) : undefined;
    // Diorama thumbnails from the Mayor asset sheets (consistent style across services).
    const override: Partial<Record<ToolId, string>> = {
      solar: "/ui/thumbs/svc-solar2.jpg", watertower: "/ui/thumbs/svc-watertower2.jpg",
      firehq: "/ui/thumbs/svc-fire.jpg", firepost: "/ui/thumbs/svc-fire.jpg", fire: "/ui/thumbs/svc-fire.jpg",
      water: "/ui/thumbs/svc-waterpump2.jpg", waterlarge: "/ui/thumbs/svc-waterpump2.jpg",
      park: "/ui/thumbs/svc-park2.jpg", cityhall: "/ui/thumbs/svc-cityhall.jpg",
      police: "/ui/thumbs/svc-police.jpg", hospital: "/ui/thumbs/svc-hospital.jpg",
      clinic: "/ui/thumbs/svc-clinic.jpg", school: "/ui/thumbs/svc-school.jpg",
      highschool: "/ui/thumbs/svc-university.jpg", sewage: "/ui/thumbs/svc-sewage.jpg",
      substation: "/ui/thumbs/svc-substation.jpg", landfill: "/ui/thumbs/svc-garbage.jpg",
      metro: "/ui/thumbs/tr-metroentrance.jpg", trainstation: "/ui/thumbs/tr-trainstation.jpg",
      busstop: "/ui/thumbs/tr-busstop.jpg",
    };
    const price = COST[t.id as Exclude<ToolId, "pan">];
    const fp = isFacilityTool(t.id) ? facilityToolFootprint(t.id) : 0;
    const badge = fp ? `<em class="fp" aria-label="${tr("Footprint")} ${fp}x${fp}">${fp}×${fp}</em>` : "";
    const name = entry ? (getLang() === "pt" ? entry.name : entry.nameEn) : tr(t.label);
    // Kit thumbnails exist for entries 1-40; expansion entries use the atlas override or the tool icon.
    const thumb = override[t.id]
      ? `<img class="build-thumb" src="${override[t.id]}" alt="" draggable="false">`
      : entry && entry.n <= 40
        ? `<img class="build-thumb" src="${thumbnailOf(entry.n)}" alt="" draggable="false">`
        : `<span class="build-thumb build-thumb-icon">${iconHtml(t.icon)}</span>`;
    // Miniature lot: the building block grows with the footprint, and a 2x2
    // lot also shows its parking strip, like the grown cities in CS2/Fable.
    const lot = `<span class="build-lot lot${fp}" aria-hidden="true"><i class="lot-b"></i>${fp > 1 ? `<i class="lot-p"></i>` : ""}</span>`;
    const b = el("button", "build-card", `${thumb}<span class="build-info"><span>${name}</span><small>$${price}</small></span>${lot}${badge}`);
    b.title = tr(t.hint);
    b.addEventListener("click", () => {
      const reason = this.avail.get(t.id);
      if (reason) { this.toasts.push({ kind: "warning", title: tr(t.label), text: tr(reason) }); return; }
      this.hooks.onEvent({ kind: "tool", tool: t.id });
    });
    this.tooltip.attach(b, () => this.toolTip(t));
    this.toolBtns.set(t.id, b);
    return b;
  }

  /** A toolbar category button that opens a flyout. */
  private group(name: FlyoutId, label: string, icon: Icon, fly: HTMLElement): HTMLElement {
    const b = el("button", "tool", `${iconHtml(icon)}<span>${tr(label)}</span><small>▴</small>`);
    b.setAttribute("aria-haspopup", "true");
    b.addEventListener("click", () => this.hooks.onEvent({ kind: "group", flyout: name }));
    this.tooltip.attach(b, () => ({ title: tr(label), icon: icon.glyph }));
    this.groupBtns.set(name, b);
    this.flyouts.set(name, fly);
    this.root.appendChild(fly);
    return b;
  }

  /** A flyout panel: optional header, a scrolling body of titled sections, each one row of buttons. */
  private flyout(cls: string): { fly: HTMLElement; body: HTMLElement; section: (title: string, icon?: string) => HTMLElement } {
    const fly = el("div", `panel fly ${cls}`);
    const body = el("div", "fly-body");
    fly.appendChild(body);
    const section = (title: string, icon?: string): HTMLElement => {
      const s = el("section", "fly-sec");
      s.setAttribute("role", "group");
      s.setAttribute("aria-label", title);
      s.appendChild(el("span", "fly-sec-title", `${icon ? `<img class="ic-img xs" src="/ui/${icon}.png" alt="">` : ""}${title}`));
      const row = el("div", "fly-row");
      s.appendChild(row);
      body.appendChild(s);
      return row;
    };
    return { fly, body, section };
  }

  private buildBottom(): void {
    const bar = el("div", "panel toolbar");
    bar.appendChild(this.toolButton(T.pan));

    // Roads: header with the live selection, then type | draw mode | level | tools | snap | parallel.
    const road = this.flyout("road-fly");
    const head = el("div", "fly-head", `<span class="fly-title">${tr("Roads")}</span>`);
    this.roadSummaryEl = el("span", "fly-summary");
    this.roadSummaryEl.setAttribute("aria-live", "polite");
    head.appendChild(this.roadSummaryEl);
    road.fly.insertBefore(head, road.body);

    const typeRow = road.section(tr("Type"));
    for (const t of ROAD_TYPES) {
      const f = roadFacts(t);
      const lanes = Array.from({ length: f.lanes }, () => "<i></i>").join("");
      const roadThumb = specOf(t).thumb;
      const b = el("button", "tool", `<img class="road-thumb" src="${roadThumb}" alt="" draggable="false"><span>${tr(f.name)}</span><small>$${f.costPerTile}/${tr("tile")}</small><span class="road-mini" aria-hidden="true">${lanes}</span>`);
      b.addEventListener("click", () => {
        pendingRoadType = t;
        this.roadTypeBtns.forEach((x, k) => x.classList.toggle("active", k === t));
        showRoadConfig();
      });
      this.tooltip.attach(b, () => ({
        icon: ROAD_GLYPH[t], title: tr(f.name), color: T.road.color,
        badge: f.oneWay ? tr("One-way") : undefined,
        cost: f.costPerTile, unit: ` / ${tr("tile")}`,
        upkeep: f.upkeepPerTile, per: `${tr("tile")} · ${tr("mo")}`,
        rows: [
          { k: tr("Lanes"), v: String(f.lanes) },
          { k: tr("Capacity"), v: `${f.capacity} ${tr("cars")} ${tr("per tile")}` },
          { k: tr("Width"), v: `${f.widthTiles} ${tr(f.widthTiles === 1 ? "tile" : "tiles")}` },
        ],
      }));
      this.roadTypeBtns.set(t, b);
      typeRow.appendChild(b);
    }
    const drawRow = road.section(tr("Draw"));
    for (const m of ROAD_MODES) {
      const b = el("button", "tool", `${m.mode === "curve" ? `<img class="road-thumb" src="/ui/thumbs/rd-curved.jpg" alt="" draggable="false">` : `<span class="ic">${m.glyph}</span>`}<span>${tr(ROAD_MODE_LABEL[m.mode])}</span>`);
      b.title = tr(m.hint);
      b.addEventListener("click", () => this.hooks.onEvent({ kind: "roadMode", mode: m.mode }));
      this.tooltip.attach(b, () => ({ icon: m.glyph, title: tr(ROAD_MODE_LABEL[m.mode]), desc: tr(m.hint), color: T.road.color }));
      this.roadModeBtns.set(m.mode, b);
      drawRow.appendChild(b);
    }
    const levelRow = road.section(tr("Level"));
    for (const lv of ROAD_LEVELS) {
      const b = el("button", "tool", `${lv.level === "tunnel" ? `<img class="road-thumb" src="/ui/thumbs/rd-tunnel.jpg" alt="" draggable="false">` : `<span class="ic">${lv.glyph}</span>`}<span>${tr(ROAD_LEVEL_LABEL[lv.level])}</span>`);
      b.title = `${tr(ROAD_LEVEL_LABEL[lv.level])} (${tr("Press E to cycle")})`;
      b.addEventListener("click", () => this.hooks.onEvent({ kind: "roadLevel", level: lv.level }));
      this.tooltip.attach(b, () => ({ icon: lv.glyph, title: tr(ROAD_LEVEL_LABEL[lv.level]), key: "E", desc: tr("Press E to cycle"), color: T.road.color }));
      this.roadLevelBtns.set(lv.level, b);
      levelRow.appendChild(b);
    }
    const toolsRow = road.section(tr("Tools"));
    const roundaboutBtn = this.toolButton(T.roundabout);
    const roundaboutImg = document.createElement("img");
    roundaboutImg.className = "road-thumb"; roundaboutImg.src = "/ui/thumbs/rd-roundabout.jpg"; roundaboutImg.alt = ""; roundaboutImg.draggable = false;
    roundaboutBtn.prepend(roundaboutImg);
    toolsRow.appendChild(roundaboutBtn);
    const trevo = el("button", "tool", `<span class="ic">✥</span><span>${tr("Interchange")}</span>`);
    trevo.title = tr("Tap where a road crosses a highway to build an interchange");
    trevo.setAttribute("aria-pressed", "false");
    trevo.addEventListener("click", () => this.hooks.onEvent({ kind: "interchange" }));
    this.tooltip.attach(trevo, () => ({ icon: "✥", title: tr("Interchange"), desc: tr("Tap where a road crosses a highway to build an interchange"), color: T.road.color }));
    this.interchangeBtn = trevo;
    toolsRow.appendChild(trevo);
    const up = el("button", "tool", `<span class="ic">⇪</span><span>${tr("Upgrade road")}</span><small>${tr("Off")}</small>`);
    up.title = tr("Tap a road to change its class");
    up.setAttribute("aria-pressed", "false");
    up.addEventListener("click", () => this.hooks.onEvent({ kind: "upgrade", on: !this.ui.upgradeMode }));
    this.tooltip.attach(up, () => ({ icon: "⇪", title: tr("Upgrade road"), desc: tr("Tap a road to change its class"), color: T.road.color }));
    this.upgradeBtn = up;
    toolsRow.appendChild(up);
    road.body.appendChild(this.buildSnapGroup());
    road.body.appendChild(this.buildParallelGroup());
    // Roads is two levels too: level 1 picks the road type, level 2 configures it
    // (draw, level, tools, snap, parallel) as grouped miniature cards.
    const roadHome = el("div", "fly-level");
    const roadConfig = el("div", "fly-level");
    roadConfig.hidden = true;
    let pendingRoadType: RoadType = 1;
    const showRoadConfig = () => { roadHome.hidden = true; roadConfig.hidden = false; };
    const roadBack = el("button", "fly-back", `← ${tr("Back")}`);
    roadBack.addEventListener("click", () => { roadConfig.hidden = true; roadHome.hidden = false; });
    const roadBuild = el("button", "build-road map-play", tr("Build"));
    roadBuild.addEventListener("click", () => this.hooks.onEvent({ kind: "roadType", roadType: pendingRoadType }));
    // Config picks apply at once (and close the flyout by the flyout rule);
    // reopen at the config level so the player can keep configuring, then Build.
    roadConfig.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".fly-back, .build-road")) return;
      setTimeout(() => { if (!this.ui.flyout) this.hooks.onEvent({ kind: "group", flyout: "road" }); }, 0);
    });
    roadConfig.append(roadBack);
    const typeSection = typeRow.parentElement as HTMLElement;
    const configSections = [drawRow, levelRow, toolsRow].map((r) => r.parentElement as HTMLElement);
    const snapEl = road.body.children[road.body.children.length - 2] as HTMLElement;
    const parallelEl = road.body.children[road.body.children.length - 1] as HTMLElement;
    roadHome.appendChild(typeSection);
    for (const s of configSections) roadConfig.appendChild(s);
    roadConfig.append(snapEl, parallelEl);
    road.body.append(roadHome, roadConfig);
    roadConfig.appendChild(roadBuild);
    const roads = this.group("road", "Roads", T.road.icon, road.fly);
    this.toolBtns.set("road", roads);
    bar.appendChild(roads);

    const zones = this.flyout("wrap");
    const zoneRow = zones.section(tr("Zone"));
    for (const id of ZONE_TOOLS) zoneRow.appendChild(this.toolButton(T[id]));
    const shapeRow = zones.section(tr("Shape"));
    for (const m of ZONE_MODES) {
      const b = el("button", "tool", `<span class="ic">${m.glyph}</span><span>${tr(m.label)}</span>`);
      b.title = tr(m.label);
      b.addEventListener("click", () => this.hooks.onEvent({ kind: "zoneMode", mode: m.mode }));
      this.zoneModeBtns.set(m.mode, b);
      shapeRow.appendChild(b);
    }
    bar.appendChild(this.group("zones", "Zones", { img: "kit/ico-zonas" }, zones.fly));

    // Services is two levels: level 1 picks a type, level 2 shows its buildings as thumbnail cards.
    const services = this.flyout("wrap services-fly");
    const svcHome = el("div", "fly-level svc-cats");
    const svcDetail = el("div", "fly-level svc-detail");
    svcDetail.hidden = true;
    services.body.append(svcHome, svcDetail);
    const showSvcGroup = (label: string) => {
      const g = SERVICE_GROUPS.find((x) => x.label === label);
      if (!g) return;
      svcDetail.replaceChildren();
      const head = el("div", "svc-detail-head");
      const back = el("button", "fly-back", `← ${tr("Back")}`);
      back.addEventListener("click", () => { svcDetail.hidden = true; svcHome.hidden = false; });
      head.append(back, el("span", "fly-sec-title", tr(g.label)));
      svcDetail.appendChild(head);
      const cards = el("div", "build-cards");
      for (const id of g.tools) cards.appendChild(this.buildingCard(T[id]));
      svcDetail.appendChild(cards);
      svcHome.hidden = true;
      svcDetail.hidden = false;
    };
    for (const g of SERVICE_GROUPS) {
      const cat = el("button", "svc-cat",
        `<img class="ic-img" src="/ui/${g.icon}.png" alt="" draggable="false"><span class="svc-cat-info"><span>${tr(g.label)}</span><small>${g.tools.length} ${tr("Buildings")}</small></span><span class="svc-cat-arrow">›</span>`);
      cat.addEventListener("click", () => showSvcGroup(g.label));
      svcHome.appendChild(cat);
    }
    bar.appendChild(this.group("services", "Services", { img: "kit/ico-governo" }, services.fly));

    const transit = this.flyout("wrap services-fly");
    for (const g of TRANSIT_GROUPS) {
      const row = transit.section(tr(g.label));
      for (const id of g.tools) {
        if (g.label === "Stops") { row.appendChild(this.buildingCard(T[id])); continue; }
        const btn = this.toolButton(T[id]);
        const lineThumb: Partial<Record<string, string>> = {
          busline: "/ui/thumbs/tr-citybus.jpg", metroline: "/ui/thumbs/tr-metroentrance.jpg", trainline: "/ui/thumbs/tr-train.jpg",
        };
        if (lineThumb[id]) {
          const img = document.createElement("img");
          img.className = "road-thumb"; img.src = lineThumb[id]; img.alt = ""; img.draggable = false;
          btn.prepend(img);
        }
        row.appendChild(btn);
      }
    }
    bar.appendChild(this.group("transit", "Transit", { img: "kit/ico-onibus" }, transit.fly));

    bar.appendChild(this.toolButton(T.bulldoze, true));

    const view = this.flyout("wrap");
    const viewRow = view.section(tr("Infoview"));
    for (const l of LAYERS) {
      const b = el("button", "tool", `${iconHtml(l.img ? { img: l.img } : { glyph: l.glyph, color: l.color })}<span>${tr(l.label)}</span>`);
      b.addEventListener("click", () => {
        this.hooks.onOverlay(l.layer);
        this.setOverlay(l.layer);
        this.hooks.onEvent({ kind: "closeFlyouts" });
      });
      this.layerBtns.push(b);
      viewRow.appendChild(b);
    }
    this.layerBtns[0].classList.add("active");
    this.viewBtn = this.group("view", "Infoview", { img: "kit/ico-busca" }, view.fly);
    bar.appendChild(this.viewBtn);

    const eco = el("button", "tool", `<img class="ic-img" src="/ui/kit/ico-dinheiro.png" alt=""><span>${tr("Economy")}</span>`);
    eco.addEventListener("click", () => this.budget.classList.toggle("open"));
    bar.appendChild(eco);
    this.root.appendChild(bar);

    this.finishBtn = el("button", "finish", tr("Finish road"));
    this.finishBtn.addEventListener("click", () => this.hooks.onFinishRoad());
    this.finishBtn.hidden = true;
    this.root.appendChild(this.finishBtn);

    this.createBtn = el("button", "finish create", tr("Create line"));
    this.createBtn.addEventListener("click", () => this.hooks.onCreateLine());
    this.createBtn.hidden = true;
    this.root.appendChild(this.createBtn);

    this.linesPanel = el("div", "panel lines");
    const linesBtn = el("button", "svc-head toggle", "<span></span>");
    this.linesBody = el("div", "lines-body");
    this.linesPanel.appendChild(linesBtn);
    this.linesPanel.appendChild(this.linesBody);
    this.collapsible("lines", this.linesPanel, linesBtn, linesBtn.querySelector("span")!, "Transit lines");
    this.root.appendChild(this.linesPanel);

    this.hint = el("div", "hint", "");
    this.root.appendChild(this.hint);
  }

  /** Compact snap toggles (angle / length / road) on their own flyout row. */
  private buildSnapGroup(): HTMLElement {
    const group = el("div", "snap-group");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", tr("Snap"));
    group.appendChild(el("span", "snap-title", tr("Snap")));
    const row = (label: string) => {
      const r = el("div", "snap-row");
      r.setAttribute("role", "group");
      r.setAttribute("aria-label", label);
      r.appendChild(el("span", "snap-lbl", label));
      group.appendChild(r);
      return r;
    };
    const angleRow = row(tr("Angle"));
    for (const a of [0, 15, 45] as AngleSnap[]) {
      const b = el("button", "tool snap-btn", `<span>${a === 0 ? tr("Off") : `${a}°`}</span>`);
      b.title = a === 0 ? tr("Off") : `${tr("Angle")} ${a}°`;
      b.setAttribute("aria-pressed", String(a === this.snap.angle));
      b.addEventListener("click", () => this.setSnap({ ...this.snap, angle: a }));
      this.snapAngleBtns.set(a, b);
      angleRow.appendChild(b);
    }
    const lenRow = row(tr("Length"));
    for (const v of [0, 1, 2, 4] as LengthSnap[]) {
      const b = el("button", "tool snap-btn", `<span>${v === 0 ? tr("Off") : v}</span>`);
      b.title = v === 0 ? tr("Off") : `${v} ${tr("tiles")}`;
      b.setAttribute("aria-pressed", String(v === this.snap.length));
      b.addEventListener("click", () => this.setSnap({ ...this.snap, length: v }));
      this.snapLengthBtns.set(v, b);
      lenRow.appendChild(b);
    }
    const roadsRow = row(tr("Road snap"));
    const roads = el("button", "tool snap-btn", `<span>${tr("Road snap")}</span>`);
    roads.title = tr("Road snap");
    roads.setAttribute("aria-pressed", String(this.snap.roads));
    roads.addEventListener("click", () => this.setSnap({ ...this.snap, roads: !this.snap.roads }));
    this.snapRoadsBtn = roads;
    roadsRow.appendChild(roads);
    const guidesRow = row(tr("Guides"));
    const guides = el("button", "tool snap-btn", `<span>${tr("Guides")}</span>`);
    guides.title = tr("Guides");
    guides.setAttribute("aria-pressed", String(this.snap.guides));
    guides.addEventListener("click", () => this.setSnap({ ...this.snap, guides: !this.snap.guides }));
    this.snapGuidesBtn = guides;
    guidesRow.appendChild(guides);
    const offsetRow = row(tr("Touch offset"));
    const offset = el("button", "tool snap-btn", `<span>${tr("Touch offset")}</span>`);
    offset.title = tr("Touch offset");
    offset.setAttribute("aria-pressed", String(this.snap.touchOffset));
    offset.addEventListener("click", () => this.setSnap({ ...this.snap, touchOffset: !this.snap.touchOffset }));
    offsetRow.appendChild(offset);
    // It is not otherwise queried outside this flyout, so retain it with the other snap controls.
    this.snapTouchOffsetBtn = offset;
    this.setSnap(this.snap, false);
    return group;
  }

  /** Compact parallel-road controls (toggle / gap / side) next to the snap group. */
  private buildParallelGroup(): HTMLElement {
    const group = el("div", "snap-group");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", tr("Parallel"));
    group.appendChild(el("span", "snap-title", tr("Parallel")));
    const row = (label: string) => {
      const r = el("div", "snap-row");
      r.setAttribute("role", "group");
      r.setAttribute("aria-label", label);
      r.appendChild(el("span", "snap-lbl", label));
      group.appendChild(r);
      return r;
    };
    const toggleRow = row(tr("Parallel"));
    const toggle = el("button", "tool snap-btn", `<span>${tr("Off")}</span>`);
    toggle.title = tr("Both legs are planned together and undo as one");
    toggle.setAttribute("aria-pressed", String(this.parallel.enabled));
    toggle.addEventListener("click", () => this.setParallel({ ...this.parallel, enabled: !this.parallel.enabled }));
    this.parallelToggleBtn = toggle;
    toggleRow.appendChild(toggle);
    const gapRow = row(tr("Gap"));
    for (const g of [1, 2, 3, 4] as ParallelGap[]) {
      const b = el("button", "tool snap-btn", `<span>${g}</span>`);
      b.title = tr("{n} lots per side", { n: g });
      b.setAttribute("aria-pressed", String(g === this.parallel.gap));
      b.setAttribute("aria-label", `${tr("Gap")} ${g}`);
      b.addEventListener("click", () => this.setParallel({ ...this.parallel, gap: g }));
      this.parallelGapBtns.set(g, b);
      gapRow.appendChild(b);
    }
    const sideRow = row(tr("Side"));
    for (const [side, glyph] of [["left", "◀"], ["right", "▶"]] as [ParallelSide, string][]) {
      const label = side === "left" ? tr("Left") : tr("Right");
      const b = el("button", "tool snap-btn", `<span aria-hidden="true">${glyph}</span>`);
      b.title = label;
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-pressed", String(side === this.parallel.side));
      b.addEventListener("click", () => this.setParallel({ ...this.parallel, side }));
      this.parallelSideBtns.set(side, b);
      sideRow.appendChild(b);
    }
    this.setParallel(this.parallel, false);
    return group;
  }

  private buildBudget(): void {
    this.budget = el("div", "panel budget");
    this.budget.innerHTML = `
      <h3>${tr("Economy")}</h3>
      <div class="row"><span>${tr("Income (last month)")}</span><b data-k="inc">$0</b></div>
      <div class="row"><span>${tr("Expenses (last month)")}</span><b data-k="exp">$0</b></div>
      <label class="row"><span>${tr("Tax rate")} <b data-k="tax">10%</b></span>
        <input type="range" min="2" max="25" value="10"></label>
      <h3>${tr("City statistics")}</h3>
      <div class="row"><span>${tr("Children")}</span><b data-k="age-c">0</b></div>
      <div class="row"><span>${tr("Working age")}</span><b data-k="age-w">0</b></div>
      <div class="row"><span>${tr("Seniors")}</span><b data-k="age-s">0</b></div>
      <div class="row"><span>${tr("Employment rate")}</span><b data-k="employment">0%</b></div>
      <div class="row"><span>${tr("Jobs filled")}</span><b data-k="filled">0 / 0</b></div>`;
    const slider = this.budget.querySelector("input")!;
    const label = this.budget.querySelector('[data-k="tax"]')!;
    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      label.textContent = `${v}%`;
      this.hooks.onTax(v / 100);
    });
    this.root.appendChild(this.budget);
  }

  // ------------------------------------------------------------------ state

  /**
   * Reflect the tool state: active tool and group, road choices, armed modes, the open flyout and the
   * selection summary. Pure DOM writes; main.ts calls it after every dispatched event.
   */
  render(s: ToolState): void {
    this.ui = s;
    this.toolBtns.forEach((b, id) => b.classList.toggle("active", id === s.tool));
    const lit = (key: FlyoutId, on: boolean) => this.groupBtns.get(key)?.classList.toggle("active", on);
    lit("road", isRoadGroupTool(s.tool));
    lit("zones", ZONE_TOOLS.includes(s.tool));
    lit("services", SERVICE_TOOLS.includes(s.tool));
    lit("transit", TRANSIT_TOOLS.includes(s.tool));
    this.roadTypeBtns.forEach((b, t) => b.classList.toggle("active", t === s.roadType));
    this.roadModeBtns.forEach((b, m) => b.classList.toggle("active", m === s.roadMode));
    this.roadLevelBtns.forEach((b, l) => b.classList.toggle("active", l === s.roadLevel));
    this.zoneModeBtns.forEach((b, m) => b.classList.toggle("active", m === s.zoneMode));
    this.upgradeBtn.classList.toggle("active", s.upgradeMode);
    this.upgradeBtn.setAttribute("aria-pressed", String(s.upgradeMode));
    this.upgradeBtn.querySelector("small")!.textContent = s.upgradeMode ? tr("On") : tr("Off");
    this.interchangeBtn.classList.toggle("active", s.pendingInterchange);
    this.interchangeBtn.setAttribute("aria-pressed", String(s.pendingInterchange));
    this.flyouts.forEach((f, name) => f.classList.toggle("open", name === s.flyout));
    this.groupBtns.forEach((b, name) => b.setAttribute("aria-expanded", String(name === s.flyout)));
    this.roadSummaryEl.textContent = roadSummary(s, tr);
    this.placeHint();
  }

  /** The tool's own one-line description (the resting hint for tools the state machine has no hint for). */
  toolHint(t: ToolId): string {
    return T[t] ? tr(T[t].hint) : "";
  }

  /** Restore the controls after the HUD was rebuilt (language change). */
  restore(opts: { ui: ToolState; speed: number; taxRate: number; snap: RoadSnapOptions; parallel?: RoadParallelOptions; tips: boolean; overlay?: OverlayLayer }): void {
    this.setSnap(opts.snap, false);
    if (opts.parallel) this.setParallel(opts.parallel, false);
    this.render(opts.ui);
    this.setSpeed(opts.speed);
    this.setTips(opts.tips);
    if (opts.overlay !== undefined) this.setOverlay(opts.overlay);
    const slider = this.budget.querySelector("input")!;
    slider.value = String(Math.round(opts.taxRate * 100));
    this.budget.querySelector('[data-k="tax"]')!.textContent = `${slider.value}%`;
  }

  setTips(on: boolean): void {
    this.tips = on;
    this.hint.hidden = !on;
  }

  /** Keep the tool hint and the Finish / Create pills above an open flyout instead of under it. */
  private placeHint(): void {
    let top = 0;
    this.flyouts.forEach((f) => { if (f.classList.contains("open")) top = Math.max(top, f.offsetHeight); });
    // Flyout bottom sits 96px up; the default positions (hint 196px, finish 210px, create 250px) already clear a one-row flyout.
    const lift = top > 90 ? 96 + top + 10 : 0;
    this.hint.style.bottom = lift ? `calc(${lift}px + var(--safe-bottom))` : "";
    this.finishBtn.style.bottom = lift ? `calc(${lift + 20}px + var(--safe-bottom))` : "";
    this.createBtn.style.bottom = lift ? `calc(${lift + 60}px + var(--safe-bottom))` : "";
  }

  /** Apply snap options to the toggle buttons (exactly one pressed per group). */
  setSnap(opts: RoadSnapOptions, notify = true): void {
    this.snap = { ...opts };
    this.snapAngleBtns.forEach((b, a) => {
      const on = a === opts.angle;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    this.snapLengthBtns.forEach((b, v) => {
      const on = v === opts.length;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    if (this.snapRoadsBtn) {
      this.snapRoadsBtn.classList.toggle("active", opts.roads);
      this.snapRoadsBtn.setAttribute("aria-pressed", String(opts.roads));
    }
    if (this.snapGuidesBtn) {
      this.snapGuidesBtn.classList.toggle("active", opts.guides);
      this.snapGuidesBtn.setAttribute("aria-pressed", String(opts.guides));
    }
    if (this.snapTouchOffsetBtn) {
      this.snapTouchOffsetBtn.classList.toggle("active", opts.touchOffset);
      this.snapTouchOffsetBtn.setAttribute("aria-pressed", String(opts.touchOffset));
    }
    if (notify) this.hooks.onSnap?.({ ...this.snap });
  }

  /** Apply parallel options to the toggle buttons (pressed state mirrors the choice). */
  setParallel(opts: RoadParallelOptions, notify = true): void {
    this.parallel = { ...opts };
    if (this.parallelToggleBtn) {
      this.parallelToggleBtn.querySelector("span")!.textContent = opts.enabled ? tr("On") : tr("Off");
      this.parallelToggleBtn.classList.toggle("active", opts.enabled);
      this.parallelToggleBtn.setAttribute("aria-pressed", String(opts.enabled));
    }
    this.parallelGapBtns.forEach((b, g) => {
      const on = g === opts.gap;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    this.parallelSideBtns.forEach((b, s) => {
      const on = s === opts.side;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    if (notify) this.hooks.onParallel?.({ ...this.parallel });
  }

  setSpeed(s: number): void {
    this.speedVal = s;
    const order = [0, 1, 2, 4];
    this.speedBtns.forEach((b, i) => b.classList.toggle("active", order[i] === s));
  }

  /** Enable/disable the Undo/Redo buttons after every history change. */
  setUndoRedo(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  /** Highlight the active infoview (also used by the U keyboard shortcut). */
  setOverlay(layer: OverlayLayer): void {
    LAYERS.forEach((l, i) => this.layerBtns[i]?.classList.toggle("active", l.layer === layer));
    this.viewBtn.classList.toggle("active", layer !== 0);
    if (layer) this.legend.show(layer);
    else this.legend.hide();
  }

  setSky(tod: number, raining: boolean): void {
    const night = tod < 0.22 || tod > 0.78;
    this.skyEl.textContent = raining ? "🌧" : night ? "🌙" : "☀";
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }

  showFinish(on: boolean, label = "Finish road"): void {
    this.finishBtn.hidden = !on;
    this.finishBtn.textContent = tr(label);
  }

  showCreateLine(on: boolean): void {
    this.createBtn.hidden = !on;
  }

  /** Floating road-build stats near the preview end; pointer-events none, never blocks the canvas. */
  showRoadReadout(rows: RoadReadoutRow[], x: number, y: number): void {
    this.readout.innerHTML = "";
    for (const r of rows) {
      const row = el("div", r.bad ? "rr-row bad" : "rr-row");
      if (r.label) {
        const l = el("span", "rr-l");
        l.textContent = r.label;
        row.appendChild(l);
      }
      const v = el("span", "rr-v");
      v.textContent = r.value;
      row.appendChild(v);
      this.readout.appendChild(row);
    }
    this.readout.hidden = false;
    const w = this.readout.offsetWidth || 220;
    const h = this.readout.offsetHeight || 130;
    this.readout.style.left = `${Math.max(8, Math.min(x + 16, window.innerWidth - w - 8))}px`;
    this.readout.style.top = `${Math.max(8, Math.min(y + 16, window.innerHeight - h - 8))}px`;
  }

  hideRoadReadout(): void {
    this.readout.hidden = true;
  }

  /** One-line notice (kept for existing callers); lands in the bell log too. */
  showToast(msg: string): void {
    this.toasts.push({ title: msg });
  }

  /** Toned notification with an optional body. */
  notify(kind: ToastTone, title: string, text?: string): void {
    const input: ToastInput = text === undefined ? { kind, title } : { kind, title, text };
    this.toasts.push(input);
  }

  /** Rebuild the lines list when lines or vehicle counts change. */
  private updateLines(s: CityState): void {
    const sig = s.world.lines.map((l) => `${l.id}:${l.vehicles}:${l.stops.length}`).join("|") + `#${s.world.stops.length}`;
    if (sig === this.linesSig) return;
    this.linesSig = sig;
    this.linesPanel.classList.toggle("has", s.world.lines.length > 0);
    this.linesBody.innerHTML = "";
    if (s.world.lines.length) {
      const t = transitTotals(s.world);
      const head = el("div", "line-row transit-summary",
        `<span class="ln">${t.lines} ${tr("lines")} · ${t.vehicles} ${tr("vehicles")}</span>` +
        `<span class="lm">${t.dailyCapacity}/day · $${t.monthlyUpkeep}/mo</span>`);
      this.linesBody.appendChild(head);
    }
    for (const l of s.world.lines) {
      const row = el("div", "line-row",
        `<i style="background:${l.color}"></i><span class="ln">${lineName(l.name)}</span><span class="lm">${l.stops.length} ${tr("stops")}</span>` +
        `<button data-d="-1" aria-label="${tr("Fewer vehicles")}">−</button><b>${l.vehicles}</b><button data-d="1" aria-label="${tr("More vehicles")}">+</button><button data-x aria-label="${tr("Remove line")}">✕</button>`);
      row.querySelector<HTMLButtonElement>('[data-d="-1"]')!.addEventListener("click", () => this.hooks.onLineVehicles(l.id, -1));
      const plus = row.querySelector<HTMLButtonElement>('[data-d="1"]')!;
      plus.disabled = l.vehicles >= MAX_LINE_VEHICLES;
      plus.addEventListener("click", () => this.hooks.onLineVehicles(l.id, 1));
      row.querySelector("[data-x]")!.addEventListener("click", () => this.hooks.onRemoveLine(l.id));
      this.linesBody.appendChild(row);
    }
  }

  /** Grey out build buttons the city cannot use right now (balance, one city hall); DOM writes only on change. */
  private refreshAvailability(s: CityState): void {
    for (const [id, btn] of this.toolBtns) {
      if (id === "road" || id === "pan") continue;
      const reason = toolAvailability(id, s);
      if (reason === (this.avail.get(id) ?? null)) continue;
      this.avail.set(id, reason);
      btn.classList.toggle("disabled", reason !== null);
      btn.setAttribute("aria-disabled", String(reason !== null));
    }
  }

  /** The running city was swapped (load / new / undo): the guide re-seeds on the next frame. */
  onCitySwapped(): void {
    this.lastState = null;
    this.guide.reset();
    this.guideStarted = false;
  }

  /** World facts the guide completes on; counts are O(tiles) but run at most ~8 Hz while guiding. */
  private guideSnapshot(): OnboardingSnapshot | null {
    const s = this.lastState;
    if (!s) return null;
    let zoned = 0, buildings = 0;
    const { zone, level } = s.world;
    for (let i = 0; i < zone.length; i++) {
      if (zone[i] !== 0) zoned++;
      if (level[i] > 0) buildings++;
    }
    return { roads: s.world.segments.length, zoned, speed: this.speedVal, tool: this.ui.tool, buildings };
  }

  update(s: CityState): void {
    this.lastState = s;
    if (!this.guideStarted) {
      this.guideStarted = true;
      const snap = this.guideSnapshot();
      if (snap) this.guide.start(snap);
    }
    this.legend.refresh(s);
    this.tooltip.tick();
    this.guide.tick(performance.now());
    this.refreshAvailability(s);
    const d = dateOf(s.day);
    this.dateEl.textContent = `${d.day} ${monthName(d.month)} ${d.year}`;
    this.popEl.textContent = fmt(s.population);
    this.jobsEl.textContent = `${fmt(s.employed)} / ${fmt(s.capacity.com + s.capacity.ind)}`;
    this.moneyEl.textContent = money(s.money);
    this.moneyEl.classList.toggle("neg", s.money < 0);
    const net = s.lastMonth.income - s.lastMonth.expenses;
    this.deltaEl.textContent = s.day >= DAYS_PER_MONTH ? `${net >= 0 ? "+" : ""}${money(net)}/${tr("mo")}` : "";
    this.deltaEl.classList.toggle("neg", net < 0);
    for (const k of ["r", "c", "i"] as const) {
      const v = s.demand[k];
      const bar = this.bars[k];
      bar.style.height = `${Math.abs(v) * 50}%`;
      bar.style.bottom = v >= 0 ? "50%" : `${50 - Math.abs(v) * 50}%`;
      bar.classList.toggle("neg", v < 0);
    }

    // Indicators: each 0..1, higher is better.
    const flow = s.lastMonth.income + s.lastMonth.expenses;
    const util = (k: UtilityKey) => (s.utilities[k].demand > 0 ? clamp01(s.utilities[k].supply / s.utilities[k].demand) : 1);
    const values = {
      pop: clamp01(s.happiness / 100),
      bud: flow > 0 ? clamp01(0.5 + net / (flow * 1.2)) : 0.5,
      env: clamp01(0.4 * util("sewage") + 0.4 * util("garbage") + 0.2 * Math.min(1, s.coverage.park * 2)),
      trf: clamp01(1 - s.congestion),
    };
    for (const [key, v] of Object.entries(values)) {
      const ref = this.ind.get(key)!;
      ref.fill.style.width = `${v * 100}%`;
      ref.fill.style.background = v > 0.66 ? "#5fd08a" : v > 0.33 ? "#f0b43a" : "#e5584f";
      ref.val.textContent = `${Math.round(v * 100)}`;
    }

    for (const [key, ref] of this.svc) {
      const u = s.utilities[key];
      const ratio = u.supply === 0 ? (u.demand > 0 ? 1 : 0) : Math.min(1, u.demand / u.supply);
      ref.fill.style.width = `${ratio * 100}%`;
      const over = u.demand > u.supply;
      ref.val.textContent = u.supply === 0 ? tr("none") : `${fmt(u.demand)}/${fmt(u.supply)}`;
      ref.val.classList.toggle("neg", over);
    }
    for (const [key, ref] of this.civ) {
      const v = s.coverage[key];
      ref.fill.style.width = `${v * 100}%`;
      ref.val.textContent = `${Math.round(v * 100)}%`;
    }
    this.lvEl.textContent = String(Math.round(s.landValue));
    const stat = (k: string, v: string) => { const e = this.budget.querySelector<HTMLElement>(`[data-k="${k}"]`); if (e) e.textContent = v; };
    stat("age-c", fmt(s.ages.children)); stat("age-w", fmt(s.ages.working)); stat("age-s", fmt(s.ages.seniors));
    stat("employment", `${Math.round(s.employmentRate * 100)}%`); stat("filled", `${fmt(s.jobsFilled)} / ${fmt(s.jobsAvailable)}`);
    this.trafficFill.style.width = `${Math.min(1, s.congestion) * 100}%`;
    this.trafficVal.textContent = `${s.vehicles} ${tr("cars")}`;
    this.trafficVal.classList.toggle("neg", s.congestion > 0.4);
    this.updateLines(s);
    const inc = this.budget.querySelector('[data-k="inc"]')!;
    const exp = this.budget.querySelector('[data-k="exp"]')!;
    inc.textContent = money(s.lastMonth.income);
    exp.textContent = money(s.lastMonth.expenses);
  }

  get tool(): ToolId { return this.ui.tool; }
  get tipsOn(): boolean { return this.tips; }
}
