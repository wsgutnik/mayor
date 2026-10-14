import { CityState, COST, ToolId, UtilityKey, CivicKey, dateOf, DAYS_PER_MONTH } from "../sim/sim";
import { MAX_LINE_VEHICLES } from "../sim/transit";
import { COVER, LAND_VALUE_LAYER, TRAFFIC_LAYER, UNDERGROUND_LAYER, RoadType, ROAD_COST, ROAD_NAME } from "../sim/world";
import type { OverlayLayer } from "../render/scene";
import { lineName, monthName, tr } from "../i18n";
import { PanelId, PanelState, loadPanelState, savePanelState, setPanelsHidden, togglePanelCollapsed } from "./panel-state";
import type { RoadReadoutRow } from "./road-readout";
import { cityEvents } from "./events";
import { ToastsView, type ToastInput, type ToastTone } from "./toasts";
import { Tooltip } from "./tooltip";
import { LegendView } from "./legend";
import { OnboardingCard, type OnboardingSnapshot } from "./onboarding";
import { DEFAULT_ROAD_SNAP, type AngleSnap, type LengthSnap, type RoadSnapOptions } from "./road-snap";
import type { ZoneMode } from "./zone-tools";
import { DEFAULT_ROAD_PARALLEL, type ParallelGap, type ParallelSide, type RoadParallelOptions } from "./road-parallel";

export type RoadMode = "paint" | "line" | "curve";
export type RoadLevel = "ground" | "elevated" | "tunnel";

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
  hospital: { id: "hospital", label: "Hospital", hint: "General hospital: 2x2 footprint (radius 18)", color: "#f2f6fb", icon: { img: "kit/ico-maleta" } },
  highschool: { id: "highschool", label: "High school", hint: "Secondary school: 2x2 footprint (radius 20)", color: "#f59a4a", icon: { img: "kit/ico-formatura" } },
  library: { id: "library", label: "Library", hint: "Public library: culture and happiness (radius 12)", color: "#d98a55", icon: { img: "kit/ico-governo" } },
  community: { id: "community", label: "Community centre", hint: "Community centre: culture and happiness (radius 10)", color: "#e6dccb", icon: { img: "kit/ico-pessoas" } },
  museum: { id: "museum", label: "Museum", hint: "City museum: culture and land value (radius 16)", color: "#efe6d2", icon: { img: "kit/ico-trofeu" } },
  cityhall: { id: "cityhall", label: "City hall", hint: "City hall (2x2, one per city): happiness and tax income", color: "#4f5f86", icon: { img: "kit/ico-martelo" } },
  substation: { id: "substation", label: "Substation", hint: "Substation: relays power to nearby roads", color: "#cfd3d6", icon: { img: "kit/ico-energia" } },
  bulldoze: { id: "bulldoze", label: "Bulldoze", hint: "Remove roads, zones and facilities", color: "#e5584f", icon: { img: "kit/ico-lixeira" } },
  roundabout: { id: "roundabout", label: "Roundabout", hint: "Stamp a roundabout on a junction", color: "#9aa3b2", icon: { glyph: "⟳", color: "#9aa3b2" } },
};

const ZONE_TOOLS = ["res", "com", "ind"];

const ZONE_MODES: { mode: ZoneMode; label: string; glyph: string }[] = [
  { mode: "paint", label: "Paint", glyph: "🖌" },
  { mode: "marquee", label: "Marquee", glyph: "⛶" },
  { mode: "fill", label: "Fill", glyph: "🪣" },
];
const SERVICE_TOOLS = [
  "power", "substation", "water", "sewage", "landfill", "police", "fire", "clinic", "hospital", "school", "highschool",
  "park", "library", "community", "museum", "cityhall",
];
const TRANSIT_TOOLS = ["busstop", "metro", "busline", "metroline"];

const ROAD_MODES: { mode: RoadMode; label: string; glyph: string; hint: string }[] = [
  { mode: "line", label: "Line", glyph: "╱", hint: "Tap a start, then an end" },
  { mode: "curve", label: "Curve", glyph: "⌒", hint: "Tap start, a bend point, then the end" },
];

const ROAD_LEVELS: { level: RoadLevel; label: string; glyph: string }[] = [
  { level: "ground", label: "Ground", glyph: "─" },
  { level: "elevated", label: "Elevated", glyph: "⌒" },
  { level: "tunnel", label: "Underground", glyph: "⌄" },
];

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
  onRoad(type: RoadType, mode: RoadMode, level?: RoadLevel): void;
  /** Stamp a diamond interchange on the next tapped bridge crossing. */
  onInterchange?(): void;
  onCreateLine(): void;
  onLineVehicles(id: number, delta: number): void;
  onRemoveLine(id: number): void;
  onFinishRoad(): void;
  /** Road-draft snap options changed (angle / length / road toggles). */
  onSnap?(opts: RoadSnapOptions): void;
  /** Parallel-road options changed (toggle / gap / side). */
  onParallel?(opts: RoadParallelOptions): void;
  /** The road flyout's Upgrade toggle changed: taps on existing roads convert them while it is on. */
  onUpgradeMode?(on: boolean): void;
  onTool(t: ToolId): void;
  /** Zoning shape changed (paint brush / marquee rectangle / fill); applies to res/com/ind and bulldoze. */
  onZoneMode?(mode: ZoneMode): void;
  onSpeed(s: number): void;
  onUndo(): void;
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
  private zoneMode: ZoneMode = "paint";
  private roadType: RoadType = 1;
  private roadMode: RoadMode = "line";
  private roadLevel: RoadLevel = "ground";
  private snap: RoadSnapOptions = { ...DEFAULT_ROAD_SNAP };
  private snapAngleBtns = new Map<AngleSnap, HTMLButtonElement>();
  private snapLengthBtns = new Map<LengthSnap, HTMLButtonElement>();
  private snapRoadsBtn: HTMLButtonElement | null = null;
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
  private currentTool: ToolId = "road";

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
      <div class="legend"><span>R</span><span>C</span><span>I</span></div></div>`;
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

  private toolButton(t: ToolDef, big = false): HTMLElement {
    const free = t.id === "pan" || t.id === "busline" || t.id === "metroline";
    const price = free ? 0 : COST[t.id as Exclude<ToolId, "pan">];
    const cost = free ? "" : `<small>$${price}</small>`;
    const b = el("button", "tool", `${iconHtml(t.icon)}<span>${tr(t.label)}</span>${big ? "" : cost}`);
    b.title = tr(t.hint);
    b.addEventListener("click", () => {
      this.hooks.onTool(t.id);
      this.setTool(t.id);
      this.closeFlyouts();
    });
    this.tooltip.attach(b, () => ({
      icon: t.icon.glyph, title: tr(t.label), desc: tr(t.hint),
      cost: free ? undefined : price, color: t.color,
    }));
    this.toolBtns.set(t.id, b);
    return b;
  }

  /** A toolbar category button that opens a flyout. */
  private group(name: string, label: string, icon: Icon, fly: HTMLElement, onOpen?: () => void): HTMLElement {
    const b = el("button", "tool", `${iconHtml(icon)}<span>${tr(label)}</span><small>▴</small>`);
    b.addEventListener("click", () => {
      this.toggleFly(name);
      onOpen?.();
    });
    this.tooltip.attach(b, () => ({ title: tr(label), icon: icon.glyph }));
    this.groupBtns.set(name, b);
    this.flyouts.set(name, fly);
    this.root.appendChild(fly);
    return b;
  }

  private buildBottom(): void {
    const bar = el("div", "panel toolbar");
    bar.appendChild(this.toolButton(T.pan));

    // Roads: class and drawing mode
    const flyRoad = el("div", "panel fly snap-wrap");
    for (const t of [1, 2, 3, 4, 5] as RoadType[]) {
      const glyph = t === 1 ? "─" : t === 2 ? "═" : t === 3 ? "≡" : t === 4 ? "→" : "⇒";
      const b = el("button", "tool", `<span class="ic">${glyph}</span><span>${tr(ROAD_NAME[t])}</span><small>$${ROAD_COST[t]}/${tr("tile")}</small>`);
      b.addEventListener("click", () => { this.setRoadChoice(t, this.roadMode); this.hooks.onTool("road"); this.setTool("road"); });
      this.roadTypeBtns.set(t, b);
      flyRoad.appendChild(b);
    }
    flyRoad.appendChild(this.toolButton(T.roundabout));
    flyRoad.appendChild(el("span", "sep"));
    for (const m of ROAD_MODES) {
      const b = el("button", "tool", `<span class="ic">${m.glyph}</span><span>${tr(m.label)}</span>`);
      b.title = tr(m.hint);
      b.addEventListener("click", () => { this.setRoadChoice(this.roadType, m.mode); this.hooks.onTool("road"); this.setTool("road"); });
      this.roadModeBtns.set(m.mode, b);
      flyRoad.appendChild(b);
    }
    flyRoad.appendChild(el("span", "sep"));
    const lvlLabel = el("span", "level-label", tr("Level"));
    flyRoad.appendChild(lvlLabel);
    for (const lv of ROAD_LEVELS) {
      const b = el("button", "tool", `<span class="ic">${lv.glyph}</span><span>${tr(lv.label)}</span>`);
      b.addEventListener("click", () => { this.setRoadLevel(lv.level); this.hooks.onTool("road"); this.setTool("road"); });
      this.roadLevelBtns.set(lv.level, b);
      flyRoad.appendChild(b);
    }
    const trevo = el("button", "tool", `<span class="ic">✥</span><span>${tr("Interchange")}</span>`);
    trevo.title = tr("Tap a bridge crossing to stamp an interchange");
    trevo.addEventListener("click", () => { this.hooks.onInterchange?.(); this.closeFlyouts(); });
    flyRoad.appendChild(trevo);
    flyRoad.appendChild(this.buildSnapGroup());
    flyRoad.appendChild(this.buildParallelGroup());
    flyRoad.appendChild(this.buildUpgradeGroup());
    const roads = this.group("road", "Roads", T.road.icon, flyRoad, () => {
      this.hooks.onTool("road");
      this.setTool("road");
      this.hooks.onRoad(this.roadType, this.roadMode, this.roadLevel);
    });
    this.toolBtns.set("road", roads);
    bar.appendChild(roads);
    this.setRoadChoice(1, "line", false);
    this.setRoadLevel("ground", false);

    const flyZones = el("div", "panel fly wrap");
    for (const id of ZONE_TOOLS) flyZones.appendChild(this.toolButton(T[id]));
    flyZones.appendChild(el("span", "sep"));
    for (const m of ZONE_MODES) {
      const b = el("button", "tool", `<span class="ic">${m.glyph}</span><span>${tr(m.label)}</span>`);
      b.title = tr(m.label);
      b.addEventListener("click", () => this.setZoneMode(m.mode));
      this.zoneModeBtns.set(m.mode, b);
      flyZones.appendChild(b);
    }
    this.setZoneMode("paint", false);
    bar.appendChild(this.group("zones", "Zones", { img: "kit/ico-zonas" }, flyZones));

    const flyServices = el("div", "panel fly wrap");
    for (const id of SERVICE_TOOLS) flyServices.appendChild(this.toolButton(T[id]));
    bar.appendChild(this.group("services", "Services", { img: "kit/ico-governo" }, flyServices));

    const flyTransit = el("div", "panel fly");
    for (const id of TRANSIT_TOOLS) flyTransit.appendChild(this.toolButton(T[id]));
    bar.appendChild(this.group("transit", "Transit", { img: "kit/ico-onibus" }, flyTransit));

    bar.appendChild(this.toolButton(T.bulldoze, true));

    const flyView = el("div", "panel fly wrap");
    for (const l of LAYERS) {
      const b = el("button", "tool", `${iconHtml(l.img ? { img: l.img } : { glyph: l.glyph, color: l.color })}<span>${tr(l.label)}</span>`);
      b.addEventListener("click", () => {
        this.hooks.onOverlay(l.layer);
        this.setOverlay(l.layer);
        this.closeFlyouts();
      });
      this.layerBtns.push(b);
      flyView.appendChild(b);
    }
    this.layerBtns[0].classList.add("active");
    this.viewBtn = this.group("view", "Infoview", { img: "kit/ico-busca" }, flyView);
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
    this.setSnap(this.snap, false);
    return group;
  }

  /** Upgrade toggle: off by default so a tap on an existing road starts a draft (branching) as before. */
  private buildUpgradeGroup(): HTMLElement {
    const group = el("div", "snap-group");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", tr("Upgrade road"));
    group.appendChild(el("span", "snap-title", tr("Upgrade road")));
    const b = el("button", "tool snap-btn", `<span>${tr("Off")}</span>`);
    b.title = tr("Tap a road to change its class");
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("active", on);
      b.querySelector("span")!.textContent = on ? tr("On") : tr("Off");
      this.hooks.onUpgradeMode?.(on);
    });
    group.appendChild(b);
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
    toggle.title = tr("Parallel");
    toggle.setAttribute("aria-pressed", String(this.parallel.enabled));
    toggle.addEventListener("click", () => this.setParallel({ ...this.parallel, enabled: !this.parallel.enabled }));
    this.parallelToggleBtn = toggle;
    toggleRow.appendChild(toggle);
    const gapRow = row(tr("Gap"));
    for (const g of [1, 2, 3] as ParallelGap[]) {
      const b = el("button", "tool snap-btn", `<span>${g}</span>`);
      b.title = `${g} ${tr("tiles")}`;
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
        <input type="range" min="2" max="25" value="10"></label>`;
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

  /** Highlight the active zoning shape (paint brush / marquee / fill). */
  setZoneMode(mode: ZoneMode, notify = true): void {
    this.zoneMode = mode;
    this.zoneModeBtns.forEach((b, m) => b.classList.toggle("active", m === mode));
    if (notify) this.hooks.onZoneMode?.(mode);
  }

  getZoneMode(): ZoneMode { return this.zoneMode; }

  /** Restore the controls after the HUD was rebuilt (language change). */
  restore(opts: { tool: ToolId; speed: number; taxRate: number; roadType: RoadType; roadMode: RoadMode; roadLevel?: RoadLevel; snap: RoadSnapOptions; parallel?: RoadParallelOptions; tips: boolean; zoneMode?: ZoneMode; overlay?: OverlayLayer }): void {
    this.setSnap(opts.snap, false);
    if (opts.parallel) this.setParallel(opts.parallel, false);
    this.setRoadChoice(opts.roadType, opts.roadMode, false);
    if (opts.roadLevel) this.setRoadLevel(opts.roadLevel, false);
    if (opts.zoneMode) this.setZoneMode(opts.zoneMode, false);
    this.setTool(opts.tool);
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

  private toggleFly(name: string): void {
    const f = this.flyouts.get(name)!;
    const open = f.classList.contains("open");
    this.closeFlyouts();
    if (!open) f.classList.add("open");
    this.placeHint();
  }

  private closeFlyouts(): void {
    this.flyouts.forEach((f) => f.classList.remove("open"));
    this.placeHint();
  }

  /** Keep the tool hint above an open flyout (the road flyout is several rows tall) instead of under it. */
  private placeHint(): void {
    let top = 0;
    this.flyouts.forEach((f) => { if (f.classList.contains("open")) top = Math.max(top, f.offsetHeight); });
    // Flyout bottom sits 96px up; the default hint position (196px) already clears a one-row flyout.
    this.hint.style.bottom = top > 90 ? `calc(${96 + top + 10}px + var(--safe-bottom))` : "";
  }

  setRoadChoice(type: RoadType, mode: RoadMode, notify = true): void {
    if (mode === "paint") mode = "line";
    this.roadType = type;
    this.roadMode = mode;
    this.roadTypeBtns.forEach((b, t) => b.classList.toggle("active", t === type));
    this.roadModeBtns.forEach((b, m) => b.classList.toggle("active", m === mode));
    if (notify) this.hooks.onRoad(type, mode, this.roadLevel);
  }

  setRoadLevel(level: RoadLevel, notify = true): void {
    this.roadLevel = level;
    this.roadLevelBtns.forEach((b, l) => b.classList.toggle("active", l === level));
    if (notify) this.hooks.onRoad(this.roadType, this.roadMode, level);
  }

  getRoadLevel(): RoadLevel { return this.roadLevel; }

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

  /** Cycle Solo → Elevado → Subterrâneo (key E). */
  cycleRoadLevel(): RoadLevel {
    const order: RoadLevel[] = ["ground", "elevated", "tunnel"];
    const next = order[(order.indexOf(this.roadLevel) + 1) % order.length];
    this.setRoadLevel(next);
    return next;
  }

  setTool(t: ToolId): void {
    this.currentTool = t;
    this.toolBtns.forEach((b, id) => b.classList.toggle("active", id === t));
    const group = (names: string[], key: string) => this.groupBtns.get(key)?.classList.toggle("active", names.includes(t));
    group(ZONE_TOOLS, "zones");
    group(SERVICE_TOOLS, "services");
    group(TRANSIT_TOOLS, "transit");
    if (T[t]) this.hint.textContent = tr(T[t].hint);
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
    const sig = s.world.lines.map((l) => `${l.id}:${l.vehicles}:${l.stops.length}`).join("|");
    if (sig === this.linesSig) return;
    this.linesSig = sig;
    this.linesPanel.classList.toggle("has", s.world.lines.length > 0);
    this.linesBody.innerHTML = "";
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
    return { roads: s.world.segments.length, zoned, speed: this.speedVal, tool: this.currentTool, buildings };
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
    this.trafficFill.style.width = `${Math.min(1, s.congestion) * 100}%`;
    this.trafficVal.textContent = `${s.vehicles} ${tr("cars")}`;
    this.trafficVal.classList.toggle("neg", s.congestion > 0.4);
    this.updateLines(s);
    const inc = this.budget.querySelector('[data-k="inc"]')!;
    const exp = this.budget.querySelector('[data-k="exp"]')!;
    inc.textContent = money(s.lastMonth.income);
    exp.textContent = money(s.lastMonth.expenses);
  }

  get tool(): ToolId { return this.currentTool; }
  get tipsOn(): boolean { return this.tips; }
}
