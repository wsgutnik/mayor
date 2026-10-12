import { CityState, COST, ToolId, UtilityKey, CivicKey, dateOf, DAYS_PER_MONTH } from "../sim/sim";
import { MAX_LINE_VEHICLES } from "../sim/transit";
import { COVER, LAND_VALUE_LAYER, TRAFFIC_LAYER, UNDERGROUND_LAYER, RoadType, ROAD_COST } from "../sim/world";
import type { OverlayLayer } from "../render/scene";
import { lineName, monthName, tr } from "../i18n";

export type RoadMode = "paint" | "line" | "curve";

/** Art from the brand sheet (public/ui) or a plain glyph. */
interface Icon { img?: string; glyph?: string; color?: string }

interface ToolDef { id: ToolId; label: string; hint: string; color: string; icon: Icon }

const T: Record<string, ToolDef> = {
  pan: { id: "pan", label: "Move", hint: "Drag to move the camera", color: "#ffffff", icon: { glyph: "✋" } },
  road: { id: "road", label: "Roads", hint: "Paint roads", color: "#9aa3b2", icon: { img: "kit/ico-estrada" } },
  res: { id: "res", label: "Residential", hint: "Zone residential", color: "#4fbf6a", icon: { img: "kit/tile-residential" } },
  com: { id: "com", label: "Commercial", hint: "Zone commercial", color: "#4a8fe0", icon: { img: "kit/tile-commercial" } },
  ind: { id: "ind", label: "Industrial", hint: "Zone industrial", color: "#e0b43a", icon: { img: "kit/tile-industrial" } },
  power: { id: "power", label: "Power plant", hint: "Place a power plant (radius 14)", color: "#f2c230", icon: { img: "kit/ico-energia" } },
  water: { id: "water", label: "Water pump", hint: "Place a water pump near water (radius 10)", color: "#39b6e8", icon: { img: "kit/ico-agua" } },
  sewage: { id: "sewage", label: "Sewage", hint: "Place a sewage outlet near water (radius 10)", color: "#a07848", icon: { glyph: "≋", color: "#a07848" } },
  landfill: { id: "landfill", label: "Landfill", hint: "Place a landfill (radius 12)", color: "#9aa3ad", icon: { img: "kit/ico-reciclar" } },
  police: { id: "police", label: "Police", hint: "Police station: crime cover (radius 12)", color: "#3d6ee8", icon: { img: "kit/ico-escudo" } },
  fire: { id: "fire", label: "Fire", hint: "Fire station: stops fires (radius 12)", color: "#ee5a4c", icon: { img: "kit/ico-extintor" } },
  clinic: { id: "clinic", label: "Clinic", hint: "Clinic: health cover (radius 12)", color: "#f2f6fb", icon: { img: "kit/ico-maleta" } },
  school: { id: "school", label: "School", hint: "School: education, needed for level 3 (radius 14)", color: "#f59a4a", icon: { img: "kit/ico-formatura" } },
  park: { id: "park", label: "Park", hint: "Park: land value and happiness (radius 8)", color: "#48b85a", icon: { img: "kit/ico-arvore" } },
  busstop: { id: "busstop", label: "Bus stop", hint: "Place a bus stop on a street or avenue", color: "#3d8bff", icon: { img: "kit/ico-onibus" } },
  metro: { id: "metro", label: "Metro station", hint: "Metro station: any free land tile (radius 9)", color: "#9b7bff", icon: { img: "kit/ico-trem" } },
  busline: { id: "busline", label: "Bus line", hint: "Tap bus stops in order, then Create line", color: "#3d8bff", icon: { glyph: "➰", color: "#3d8bff" } },
  metroline: { id: "metroline", label: "Metro line", hint: "Tap metro stations in order, then Create line", color: "#9b7bff", icon: { glyph: "➿", color: "#9b7bff" } },
  hospital: { id: "hospital", label: "Hospital", hint: "General hospital: wide health cover (radius 18)", color: "#f2f6fb", icon: { img: "kit/ico-maleta" } },
  highschool: { id: "highschool", label: "High school", hint: "Secondary school: wide education cover (radius 20)", color: "#f59a4a", icon: { img: "kit/ico-formatura" } },
  library: { id: "library", label: "Library", hint: "Public library: culture and happiness (radius 12)", color: "#d98a55", icon: { img: "kit/ico-governo" } },
  community: { id: "community", label: "Community centre", hint: "Community centre: culture and happiness (radius 10)", color: "#e6dccb", icon: { img: "kit/ico-pessoas" } },
  museum: { id: "museum", label: "Museum", hint: "City museum: culture and land value (radius 16)", color: "#efe6d2", icon: { img: "kit/ico-trofeu" } },
  cityhall: { id: "cityhall", label: "City hall", hint: "City hall (one per city): happiness and tax income", color: "#4f5f86", icon: { img: "kit/ico-martelo" } },
  substation: { id: "substation", label: "Substation", hint: "Substation: extends the power network (radius 14)", color: "#cfd3d6", icon: { img: "kit/ico-energia" } },
  bulldoze: { id: "bulldoze", label: "Bulldoze", hint: "Remove roads, zones and facilities", color: "#e5584f", icon: { img: "kit/ico-lixeira" } },
};

const ZONE_TOOLS = ["res", "com", "ind"];
const SERVICE_TOOLS = [
  "power", "substation", "water", "sewage", "landfill", "police", "fire", "clinic", "hospital", "school", "highschool",
  "park", "library", "community", "museum", "cityhall",
];
const TRANSIT_TOOLS = ["busstop", "metro", "busline", "metroline"];

const ROAD_MODES: { mode: RoadMode; label: string; glyph: string; hint: string }[] = [
  { mode: "paint", label: "Paint", glyph: "▪", hint: "Drag to paint road tiles" },
  { mode: "line", label: "Line", glyph: "╱", hint: "Tap a start, then an end" },
  { mode: "curve", label: "Curve", glyph: "⌒", hint: "Tap start, a bend point, then the end" },
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
  onRoad(type: RoadType, mode: RoadMode): void;
  onCreateLine(): void;
  onLineVehicles(id: number, delta: number): void;
  onRemoveLine(id: number): void;
  onFinishRoad(): void;
  onTool(t: ToolId): void;
  onSpeed(s: number): void;
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
  private toast!: HTMLElement;
  private toastTimer = 0;
  private budget!: HTMLElement;
  private hint!: HTMLElement;
  private finishBtn!: HTMLElement;
  private createBtn!: HTMLElement;
  private linesPanel!: HTMLElement;
  private linesSig = "";
  private viewBtn!: HTMLElement;
  private layerBtns: HTMLElement[] = [];
  private roadTypeBtns = new Map<RoadType, HTMLElement>();
  private roadModeBtns = new Map<RoadMode, HTMLElement>();
  private roadType: RoadType = 1;
  private roadMode: RoadMode = "paint";
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
    this.buildTop();
    this.buildLeft();
    this.buildBottom();
    this.buildBudget();
    this.toast = el("div", "toast");
    this.root.appendChild(this.toast);
  }

  destroy(): void {
    clearTimeout(this.toastTimer);
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
    const menu = el("button", "speed-btn menu-btn", `<img class="ic-img sm" src="/ui/kit/ico-engrenagem.png" alt="">`);
    menu.title = tr("Menu: save, load, new city");
    menu.setAttribute("aria-label", tr("Menu: save, load, new city"));
    menu.addEventListener("click", () => this.hooks.onMenu());
    speed.appendChild(menu);
    top.appendChild(speed);
    this.root.appendChild(top);
  }

  private buildLeft(): void {
    const col = el("div", "left-col");

    const rci = el("div", "panel demand");
    rci.innerHTML = `
      <div class="bar r"><i></i></div><div class="bar c"><i></i></div><div class="bar i"><i></i></div>
      <div class="legend"><span>R</span><span>C</span><span>I</span></div>`;
    const [r, c, i] = Array.from(rci.querySelectorAll<HTMLElement>(".bar i"));
    this.bars = { r, c, i };
    col.appendChild(rci);

    const ind = el("div", "panel indicators");
    for (const d of INDICATORS) {
      const row = el("div", "ind",
        `<img class="ic-img xs" src="/ui/${d.icon}.png" alt=""><span class="ind-l">${tr(d.label)}</span>` +
        `<div class="ind-bar"><i></i></div><span class="ind-v">–</span>`);
      this.ind.set(d.key, { fill: row.querySelector("i")!, val: row.querySelector(".ind-v")! });
      ind.appendChild(row);
    }
    col.appendChild(ind);

    const p = el("div", "panel services");
    const head = el("button", "svc-head toggle", `<span>${tr("Services")} ▾</span><b></b>`);
    head.setAttribute("aria-expanded", "true");
    head.addEventListener("click", () => {
      p.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!p.classList.contains("collapsed")));
    });
    p.appendChild(head);
    for (const r2 of SERVICE_ROWS) p.appendChild(this.svcRow(r2.label, r2.color, "none", (f, v) => this.svc.set(r2.key, { fill: f, val: v })));
    for (const r2 of CIVIC_ROWS) p.appendChild(this.svcRow(r2.label, r2.color, "0%", (f, v) => this.civ.set(r2.key, { fill: f, val: v })));
    p.appendChild(this.svcRow("Traffic", "#e5584f", `0 ${tr("cars")}`, (f, v) => { this.trafficFill = f; this.trafficVal = v; }));
    const lv = el("div", "svc-head lv", `<span>${tr("Land value")}</span><b data-k="lv">0</b>`);
    this.lvEl = lv.querySelector('[data-k="lv"]')!;
    p.appendChild(lv);
    col.appendChild(p);
    this.root.appendChild(col);
  }

  private svcRow(label: string, color: string, initial: string, bind: (fill: HTMLElement, val: HTMLElement) => void): HTMLElement {
    const row = el("div", "svc", `<span class="svc-l">${tr(label)}</span><div class="svc-bar"><i style="background:${color}"></i></div><span class="svc-v">${initial}</span>`);
    bind(row.querySelector("i")!, row.querySelector(".svc-v")!);
    return row;
  }

  private toolButton(t: ToolDef, big = false): HTMLElement {
    const cost = t.id === "pan" || t.id === "busline" || t.id === "metroline" ? "" : `<small>$${COST[t.id as Exclude<ToolId, "pan">]}</small>`;
    const b = el("button", "tool", `${iconHtml(t.icon)}<span>${tr(t.label)}</span>${big ? "" : cost}`);
    b.title = tr(t.hint);
    b.addEventListener("click", () => {
      this.hooks.onTool(t.id);
      this.setTool(t.id);
      this.closeFlyouts();
    });
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
    this.groupBtns.set(name, b);
    this.flyouts.set(name, fly);
    this.root.appendChild(fly);
    return b;
  }

  private buildBottom(): void {
    const bar = el("div", "panel toolbar");
    bar.appendChild(this.toolButton(T.pan));

    // Roads: class and drawing mode
    const flyRoad = el("div", "panel fly");
    for (const t of [1, 2, 3] as RoadType[]) {
      const name = t === 1 ? "Street" : t === 2 ? "Avenue" : "Highway";
      const b = el("button", "tool", `<span class="ic">${t === 1 ? "─" : t === 2 ? "═" : "≡"}</span><span>${tr(name)}</span><small>$${ROAD_COST[t]}/${tr("tile")}</small>`);
      b.addEventListener("click", () => { this.setRoadChoice(t, this.roadMode); this.hooks.onTool("road"); this.setTool("road"); });
      this.roadTypeBtns.set(t, b);
      flyRoad.appendChild(b);
    }
    flyRoad.appendChild(el("span", "sep"));
    for (const m of ROAD_MODES) {
      const b = el("button", "tool", `<span class="ic">${m.glyph}</span><span>${tr(m.label)}</span>`);
      b.title = tr(m.hint);
      b.addEventListener("click", () => { this.setRoadChoice(this.roadType, m.mode); this.hooks.onTool("road"); this.setTool("road"); });
      this.roadModeBtns.set(m.mode, b);
      flyRoad.appendChild(b);
    }
    const roads = this.group("road", "Roads", T.road.icon, flyRoad, () => {
      this.hooks.onTool("road");
      this.setTool("road");
      this.hooks.onRoad(this.roadType, this.roadMode);
    });
    this.toolBtns.set("road", roads);
    bar.appendChild(roads);
    this.setRoadChoice(1, "paint", false);

    const flyZones = el("div", "panel fly");
    for (const id of ZONE_TOOLS) flyZones.appendChild(this.toolButton(T[id]));
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
        this.layerBtns.forEach((x) => x.classList.toggle("active", x === b));
        this.viewBtn.classList.toggle("active", l.layer !== 0);
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
    this.root.appendChild(this.linesPanel);

    this.hint = el("div", "hint", "");
    this.root.appendChild(this.hint);
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

  /** Restore the controls after the HUD was rebuilt (language change). */
  restore(opts: { tool: ToolId; speed: number; taxRate: number; roadType: RoadType; roadMode: RoadMode; tips: boolean }): void {
    this.setRoadChoice(opts.roadType, opts.roadMode, false);
    this.setTool(opts.tool);
    this.setSpeed(opts.speed);
    this.setTips(opts.tips);
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
  }

  private closeFlyouts(): void {
    this.flyouts.forEach((f) => f.classList.remove("open"));
  }

  setRoadChoice(type: RoadType, mode: RoadMode, notify = true): void {
    this.roadType = type;
    this.roadMode = mode;
    this.roadTypeBtns.forEach((b, t) => b.classList.toggle("active", t === type));
    this.roadModeBtns.forEach((b, m) => b.classList.toggle("active", m === mode));
    if (notify) this.hooks.onRoad(type, mode);
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
    const order = [0, 1, 2, 4];
    this.speedBtns.forEach((b, i) => b.classList.toggle("active", order[i] === s));
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

  showToast(msg: string): void {
    this.toast.textContent = msg;
    this.toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), 1800);
  }

  /** Rebuild the lines list when lines or vehicle counts change. */
  private updateLines(s: CityState): void {
    const sig = s.world.lines.map((l) => `${l.id}:${l.vehicles}:${l.stops.length}`).join("|");
    if (sig === this.linesSig) return;
    this.linesSig = sig;
    this.linesPanel.classList.toggle("has", s.world.lines.length > 0);
    this.linesPanel.innerHTML = "";
    for (const l of s.world.lines) {
      const row = el("div", "line-row",
        `<i style="background:${l.color}"></i><span class="ln">${lineName(l.name)}</span><span class="lm">${l.stops.length} ${tr("stops")}</span>` +
        `<button data-d="-1" aria-label="${tr("Fewer vehicles")}">−</button><b>${l.vehicles}</b><button data-d="1" aria-label="${tr("More vehicles")}">+</button><button data-x aria-label="${tr("Remove line")}">✕</button>`);
      row.querySelector<HTMLButtonElement>('[data-d="-1"]')!.addEventListener("click", () => this.hooks.onLineVehicles(l.id, -1));
      const plus = row.querySelector<HTMLButtonElement>('[data-d="1"]')!;
      plus.disabled = l.vehicles >= MAX_LINE_VEHICLES;
      plus.addEventListener("click", () => this.hooks.onLineVehicles(l.id, 1));
      row.querySelector("[data-x]")!.addEventListener("click", () => this.hooks.onRemoveLine(l.id));
      this.linesPanel.appendChild(row);
    }
  }

  update(s: CityState): void {
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
