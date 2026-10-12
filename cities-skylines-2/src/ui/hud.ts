import { CityState, COST, ToolId, UtilityKey, CivicKey, dateOf, DAYS_PER_MONTH } from "../sim/sim";
import { MAX_LINE_VEHICLES } from "../sim/transit";
import { COVER, LAND_VALUE_LAYER, TRAFFIC_LAYER, RoadType, ROAD_COST, ROAD_NAME } from "../sim/world";
import type { OverlayLayer } from "../render/scene";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface ToolDef { id: ToolId; label: string; icon: string; hint: string; color: string }

const T: Record<string, ToolDef> = {
  pan: { id: "pan", label: "Move", icon: "✋", hint: "Drag to move the camera", color: "#ffffff" },
  road: { id: "road", label: "Road", icon: "═", hint: "Paint roads", color: "#9aa3b2" },
  res: { id: "res", label: "Residential", icon: "⌂", hint: "Zone residential", color: "#4fbf6a" },
  com: { id: "com", label: "Commercial", icon: "▣", hint: "Zone commercial", color: "#4a8fe0" },
  ind: { id: "ind", label: "Industrial", icon: "⚙", hint: "Zone industrial", color: "#e0b43a" },
  power: { id: "power", label: "Power plant", icon: "⚡", hint: "Place a power plant (radius 14)", color: "#f2c230" },
  water: { id: "water", label: "Water pump", icon: "💧", hint: "Place a water pump near water (radius 10)", color: "#39b6e8" },
  sewage: { id: "sewage", label: "Sewage", icon: "≋", hint: "Place a sewage outlet near water (radius 10)", color: "#a07848" },
  landfill: { id: "landfill", label: "Landfill", icon: "♻", hint: "Place a landfill (radius 12)", color: "#9aa3ad" },
  police: { id: "police", label: "Police", icon: "★", hint: "Police station: crime cover (radius 12)", color: "#3d6ee8" },
  fire: { id: "fire", label: "Fire", icon: "▲", hint: "Fire station: stops fires (radius 12)", color: "#ee5a4c" },
  clinic: { id: "clinic", label: "Clinic", icon: "✚", hint: "Clinic: health cover (radius 12)", color: "#f2f6fb" },
  school: { id: "school", label: "School", icon: "✎", hint: "School: education, needed for level 3 (radius 14)", color: "#f59a4a" },
  park: { id: "park", label: "Park", icon: "❀", hint: "Park: land value and happiness (radius 8)", color: "#48b85a" },
  busstop: { id: "busstop", label: "Bus stop", icon: "◴", hint: "Place a bus stop on a street or avenue", color: "#3d8bff" },
  metro: { id: "metro", label: "Metro", icon: "Ⓜ", hint: "Metro station: any free land tile (radius 9)", color: "#9b7bff" },
  busline: { id: "busline", label: "Bus line", icon: "➰", hint: "Tap bus stops in order, then Create line", color: "#3d8bff" },
  metroline: { id: "metroline", label: "Metro line", icon: "➿", hint: "Tap metro stations in order, then Create line", color: "#9b7bff" },
  bulldoze: { id: "bulldoze", label: "Bulldoze", icon: "✕", hint: "Remove roads, zones and facilities", color: "#e5584f" },
};

const UTILITY_TOOLS = ["power", "water", "sewage", "landfill"];
const CIVIC_TOOLS = ["police", "fire", "clinic", "school", "park"];
const TRANSIT_TOOLS = ["busstop", "metro", "busline", "metroline"];

const LAYERS: { layer: OverlayLayer; label: string; icon: string; color: string }[] = [
  { layer: 0, label: "Off", icon: "○", color: "#ffffff" },
  { layer: COVER.POWER, label: "Power", icon: "⚡", color: "#f2c230" },
  { layer: COVER.WATER, label: "Water", icon: "💧", color: "#39b6e8" },
  { layer: COVER.SEWAGE, label: "Sewage", icon: "≋", color: "#a07848" },
  { layer: COVER.GARBAGE, label: "Garbage", icon: "♻", color: "#9aa3ad" },
  { layer: COVER.POLICE, label: "Police", icon: "★", color: "#3d6ee8" },
  { layer: COVER.FIRE, label: "Fire", icon: "▲", color: "#ee5a4c" },
  { layer: COVER.HEALTH, label: "Health", icon: "✚", color: "#f2f6fb" },
  { layer: COVER.EDU, label: "Education", icon: "✎", color: "#f59a4a" },
  { layer: COVER.PARK, label: "Parks", icon: "❀", color: "#48b85a" },
  { layer: COVER.TRANSIT, label: "Transit", icon: "◴", color: "#9b7bff" },
  { layer: LAND_VALUE_LAYER, label: "Land value", icon: "▦", color: "#7fd35c" },
  { layer: TRAFFIC_LAYER, label: "Traffic", icon: "⇆", color: "#e5584f" },
];

export const toolColor = (t: ToolId) => (T[t] ? T[t].color : "#ffffff");

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (n: number) => (n < 0 ? "-$" : "$") + fmt(Math.abs(n));

export type RoadMode = "paint" | "line" | "curve";

const ROAD_MODES: { mode: RoadMode; label: string; icon: string; hint: string }[] = [
  { mode: "paint", label: "Paint", icon: "▪", hint: "Drag to paint road tiles" },
  { mode: "line", label: "Line", icon: "╱", hint: "Tap a start, then an end" },
  { mode: "curve", label: "Curve", icon: "⌒", hint: "Tap start, a bend point, then the end" },
];

export interface HudHooks {
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
];

export class Hud {
  private root: HTMLElement;
  private moneyEl!: HTMLElement;
  private deltaEl!: HTMLElement;
  private popEl!: HTMLElement;
  private dateEl!: HTMLElement;
  private jobsEl!: HTMLElement;
  private bars!: { r: HTMLElement; c: HTMLElement; i: HTMLElement };
  private toolBtns = new Map<ToolId, HTMLElement>();
  private groupBtn!: HTMLElement;
  private speedBtns: HTMLElement[] = [];
  private toast!: HTMLElement;
  private toastTimer = 0;
  private budget!: HTMLElement;
  private taxLabel!: HTMLElement;
  private hint!: HTMLElement;
  private flyUtil!: HTMLElement;
  private flyRoad!: HTMLElement;
  private roadTypeBtns = new Map<RoadType, HTMLElement>();
  private roadModeBtns = new Map<RoadMode, HTMLElement>();
  private finishBtn!: HTMLElement;
  private roadType: RoadType = 1;
  private roadMode: RoadMode = "paint";
  private flyCivic!: HTMLElement;
  private civicBtn!: HTMLElement;
  private flyTransit!: HTMLElement;
  private transitBtn!: HTMLElement;
  private createBtn!: HTMLElement;
  private linesPanel!: HTMLElement;
  private linesSig = "";
  private civ = new Map<CivicKey, { fill: HTMLElement; val: HTMLElement }>();
  private lvEl!: HTMLElement;
  private trafficFill!: HTMLElement;
  private trafficVal!: HTMLElement;
  private flyView!: HTMLElement;
  private viewBtn!: HTMLElement;
  private layerBtns: HTMLElement[] = [];
  private svc = new Map<UtilityKey, { fill: HTMLElement; val: HTMLElement }>();
  private happyEl!: HTMLElement;

  constructor(parent: HTMLElement, private hooks: HudHooks) {
    this.root = el("div", "hud");
    parent.appendChild(this.root);
    this.buildTop();
    this.buildDemand();
    this.buildServices();
    this.buildBottom();
    this.buildBudget();
    this.toast = el("div", "toast");
    this.root.appendChild(this.toast);
  }

  private buildTop(): void {
    const top = el("div", "panel topbar");
    top.innerHTML = `
      <div class="stat"><span class="lbl">Population</span><b data-k="pop">0</b></div>
      <div class="stat"><span class="lbl">Jobs</span><b data-k="jobs">0</b></div>
      <div class="stat date"><span class="lbl">Date</span><b data-k="date"></b></div>
      <div class="stat"><span class="lbl">Balance</span><b data-k="money"></b><small data-k="delta"></small></div>`;
    this.popEl = top.querySelector('[data-k="pop"]')!;
    this.jobsEl = top.querySelector('[data-k="jobs"]')!;
    this.dateEl = top.querySelector('[data-k="date"]')!;
    this.moneyEl = top.querySelector('[data-k="money"]')!;
    this.deltaEl = top.querySelector('[data-k="delta"]')!;

    const speed = el("div", "speed");
    [["⏸", 0], ["▶", 1], ["▶▶", 2], ["▶▶▶", 4]].forEach(([label, v]) => {
      const b = el("button", "speed-btn", String(label));
      b.addEventListener("click", () => this.hooks.onSpeed(v as number));
      speed.appendChild(b);
      this.speedBtns.push(b);
    });
    top.appendChild(speed);
    this.root.appendChild(top);
  }

  private buildDemand(): void {
    const p = el("div", "panel demand");
    p.innerHTML = `
      <div class="bar r"><i></i></div><div class="bar c"><i></i></div><div class="bar i"><i></i></div>
      <div class="legend"><span>R</span><span>C</span><span>I</span></div>`;
    const [r, c, i] = Array.from(p.querySelectorAll<HTMLElement>(".bar i"));
    this.bars = { r, c, i };
    this.root.appendChild(p);
  }

  private buildServices(): void {
    const p = el("div", "panel services");
    p.innerHTML = `<div class="svc-head"><span>Services</span><b data-k="happy">100</b></div>`;
    this.happyEl = p.querySelector('[data-k="happy"]')!;
    for (const r of SERVICE_ROWS) {
      const row = el("div", "svc", `<span class="svc-l">${r.label}</span><div class="svc-bar"><i style="background:${r.color}"></i></div><span class="svc-v">–</span>`);
      this.svc.set(r.key, { fill: row.querySelector("i")!, val: row.querySelector(".svc-v")! });
      p.appendChild(row);
    }
    for (const r of CIVIC_ROWS) {
      const row = el("div", "svc", `<span class="svc-l">${r.label}</span><div class="svc-bar"><i style="background:${r.color}"></i></div><span class="svc-v">0%</span>`);
      this.civ.set(r.key, { fill: row.querySelector("i")!, val: row.querySelector(".svc-v")! });
      p.appendChild(row);
    }
    const tr = el("div", "svc", `<span class="svc-l">Traffic</span><div class="svc-bar"><i style="background:#e5584f"></i></div><span class="svc-v">0 cars</span>`);
    this.trafficFill = tr.querySelector("i")!;
    this.trafficVal = tr.querySelector(".svc-v")!;
    p.appendChild(tr);
    const lv = el("div", "svc-head lv", `<span>Land value</span><b data-k="lv">0</b>`);
    this.lvEl = lv.querySelector('[data-k="lv"]')!;
    p.appendChild(lv);
    this.root.appendChild(p);
  }

  private toolButton(t: ToolDef): HTMLElement {
    const cost = t.id === "pan" ? "" : `<small>$${COST[t.id as Exclude<ToolId, "pan">]}</small>`;
    const b = el("button", "tool", `<span class="ic" style="color:${t.color}">${t.icon}</span><span>${t.label}</span>${cost}`);
    b.title = t.hint;
    b.addEventListener("click", () => {
      this.hooks.onTool(t.id);
      this.setTool(t.id);
      this.closeFlyouts();
    });
    this.toolBtns.set(t.id, b);
    return b;
  }

  private buildBottom(): void {
    const bar = el("div", "panel toolbar");
    bar.appendChild(this.toolButton(T.pan));
    const roads = el("button", "tool", `<span class="ic" style="color:#9aa3b2">═</span><span>Roads</span><small>▴</small>`);
    roads.title = "Roads: streets, avenues and highways";
    roads.addEventListener("click", () => {
      this.toggleFly(this.flyRoad);
      this.hooks.onTool("road");
      this.setTool("road");
      this.hooks.onRoad(this.roadType, this.roadMode);
    });
    this.toolBtns.set("road", roads);
    bar.appendChild(roads);
    for (const id of ["res", "com", "ind"]) bar.appendChild(this.toolButton(T[id]));

    this.groupBtn = el("button", "tool", `<span class="ic" style="color:#f2c230">⚡</span><span>Utilities</span><small>▴</small>`);
    this.groupBtn.addEventListener("click", () => this.toggleFly(this.flyUtil));
    bar.appendChild(this.groupBtn);

    this.civicBtn = el("button", "tool", `<span class="ic" style="color:#3d6ee8">★</span><span>Civic</span><small>▴</small>`);
    this.civicBtn.addEventListener("click", () => this.toggleFly(this.flyCivic));
    bar.appendChild(this.civicBtn);

    this.transitBtn = el("button", "tool", `<span class="ic" style="color:#9b7bff">◴</span><span>Transit</span><small>▴</small>`);
    this.transitBtn.addEventListener("click", () => this.toggleFly(this.flyTransit));
    bar.appendChild(this.transitBtn);

    bar.appendChild(this.toolButton(T.bulldoze));

    this.viewBtn = el("button", "tool", `<span class="ic">◉</span><span>Infoview</span><small>▴</small>`);
    this.viewBtn.addEventListener("click", () => this.toggleFly(this.flyView));
    bar.appendChild(this.viewBtn);

    const eco = el("button", "tool", `<span class="ic">$</span><span>Economy</span>`);
    eco.addEventListener("click", () => this.budget.classList.toggle("open"));
    bar.appendChild(eco);
    this.root.appendChild(bar);

    this.flyUtil = el("div", "panel fly");
    for (const id of UTILITY_TOOLS) this.flyUtil.appendChild(this.toolButton(T[id]));
    this.flyRoad = el("div", "panel fly");
    for (const t of [1, 2, 3] as RoadType[]) {
      const b = el("button", "tool", `<span class="ic">${t === 1 ? "─" : t === 2 ? "═" : "≡"}</span><span>${ROAD_NAME[t]}</span><small>$${ROAD_COST[t]}/tile</small>`);
      b.addEventListener("click", () => { this.setRoadChoice(t, this.roadMode); this.hooks.onTool("road"); this.setTool("road"); });
      this.roadTypeBtns.set(t, b);
      this.flyRoad.appendChild(b);
    }
    this.flyRoad.appendChild(el("span", "sep"));
    for (const m of ROAD_MODES) {
      const b = el("button", "tool", `<span class="ic">${m.icon}</span><span>${m.label}</span>`);
      b.title = m.hint;
      b.addEventListener("click", () => { this.setRoadChoice(this.roadType, m.mode); this.hooks.onTool("road"); this.setTool("road"); });
      this.roadModeBtns.set(m.mode, b);
      this.flyRoad.appendChild(b);
    }
    this.root.appendChild(this.flyRoad);
    this.setRoadChoice(1, "paint", false);

    this.finishBtn = el("button", "finish", "Finish road");
    this.finishBtn.addEventListener("click", () => this.hooks.onFinishRoad());
    this.finishBtn.hidden = true;
    this.root.appendChild(this.finishBtn);

    this.flyCivic = el("div", "panel fly");
    for (const id of CIVIC_TOOLS) this.flyCivic.appendChild(this.toolButton(T[id]));
    this.flyTransit = el("div", "panel fly");
    for (const id of TRANSIT_TOOLS) this.flyTransit.appendChild(this.toolButton(T[id]));
    this.flyView = el("div", "panel fly wrap");
    for (const l of LAYERS) {
      const b = el("button", "tool", `<span class="ic" style="color:${l.color}">${l.icon}</span><span>${l.label}</span>`);
      b.addEventListener("click", () => {
        this.hooks.onOverlay(l.layer);
        this.layerBtns.forEach((x) => x.classList.toggle("active", x === b));
        this.viewBtn.classList.toggle("active", l.layer !== 0);
        this.closeFlyouts();
      });
      this.layerBtns.push(b);
      this.flyView.appendChild(b);
    }
    this.layerBtns[0].classList.add("active");
    this.root.appendChild(this.flyUtil);
    this.root.appendChild(this.flyCivic);
    this.root.appendChild(this.flyTransit);

    this.createBtn = el("button", "finish create", "Create line");
    this.createBtn.addEventListener("click", () => this.hooks.onCreateLine());
    this.createBtn.hidden = true;
    this.root.appendChild(this.createBtn);

    this.linesPanel = el("div", "panel lines");
    this.root.appendChild(this.linesPanel);
    this.root.appendChild(this.flyView);

    this.hint = el("div", "hint", "");
    this.root.appendChild(this.hint);
  }

  setRoadChoice(type: RoadType, mode: RoadMode, notify = true): void {
    this.roadType = type;
    this.roadMode = mode;
    this.roadTypeBtns.forEach((b, t) => b.classList.toggle("active", t === type));
    this.roadModeBtns.forEach((b, m) => b.classList.toggle("active", m === mode));
    if (notify) this.hooks.onRoad(type, mode);
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }

  showFinish(on: boolean, label = "Finish road"): void {
    this.finishBtn.hidden = !on;
    this.finishBtn.textContent = label;
  }

  showCreateLine(on: boolean): void {
    this.createBtn.hidden = !on;
  }

  /** Rebuild the lines list when lines, vehicles or ridership change. */
  updateLines(s: CityState): void {
    const sig = s.world.lines.map((l) => `${l.id}:${l.vehicles}:${l.stops.length}`).join("|");
    if (sig === this.linesSig) return;
    this.linesSig = sig;
    this.linesPanel.classList.toggle("has", s.world.lines.length > 0);
    this.linesPanel.innerHTML = "";
    for (const l of s.world.lines) {
      const row = el("div", "line-row",
        `<i style="background:${l.color}"></i><span class="ln">${l.name}</span><span class="lm">${l.stops.length} stops</span>` +
        `<button data-d="-1">−</button><b>${l.vehicles}</b><button data-d="1">+</button><button data-x>✕</button>`);
      row.querySelector<HTMLButtonElement>('[data-d="-1"]')!.addEventListener("click", () => this.hooks.onLineVehicles(l.id, -1));
      const plus = row.querySelector<HTMLButtonElement>('[data-d="1"]')!;
      plus.disabled = l.vehicles >= MAX_LINE_VEHICLES;
      plus.addEventListener("click", () => this.hooks.onLineVehicles(l.id, 1));
      row.querySelector("[data-x]")!.addEventListener("click", () => this.hooks.onRemoveLine(l.id));
      this.linesPanel.appendChild(row);
    }
  }

  private toggleFly(which: HTMLElement): void {
    const open = which.classList.contains("open");
    this.closeFlyouts();
    if (!open) which.classList.add("open");
  }

  private closeFlyouts(): void {
    this.flyUtil.classList.remove("open");
    this.flyRoad.classList.remove("open");
    this.flyCivic.classList.remove("open");
    this.flyTransit.classList.remove("open");
    this.flyView.classList.remove("open");
  }

  private buildBudget(): void {
    this.budget = el("div", "panel budget");
    this.budget.innerHTML = `
      <h3>Economy</h3>
      <div class="row"><span>Income (last month)</span><b data-k="inc">$0</b></div>
      <div class="row"><span>Expenses (last month)</span><b data-k="exp">$0</b></div>
      <label class="row"><span>Tax rate <b data-k="tax">10%</b></span>
        <input type="range" min="2" max="25" value="10"></label>`;
    const slider = this.budget.querySelector("input")!;
    this.taxLabel = this.budget.querySelector('[data-k="tax"]')!;
    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      this.taxLabel.textContent = `${v}%`;
      this.hooks.onTax(v / 100);
    });
    this.root.appendChild(this.budget);
  }

  setTool(t: ToolId): void {
    this.toolBtns.forEach((b, id) => b.classList.toggle("active", id === t));
    this.groupBtn.classList.toggle("active", UTILITY_TOOLS.includes(t));
    this.civicBtn.classList.toggle("active", CIVIC_TOOLS.includes(t));
    this.transitBtn.classList.toggle("active", TRANSIT_TOOLS.includes(t));
    this.hint.textContent = T[t].hint;
  }

  setSpeed(s: number): void {
    const order = [0, 1, 2, 4];
    this.speedBtns.forEach((b, i) => b.classList.toggle("active", order[i] === s));
  }

  showToast(msg: string): void {
    this.toast.textContent = msg;
    this.toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), 1800);
  }

  update(s: CityState): void {
    const d = dateOf(s.day);
    this.dateEl.textContent = `${MONTHS[d.month]} ${d.day}, ${d.year}`;
    this.popEl.textContent = fmt(s.population);
    this.jobsEl.textContent = `${fmt(s.employed)} / ${fmt(s.capacity.com + s.capacity.ind)}`;
    this.moneyEl.textContent = money(s.money);
    this.moneyEl.classList.toggle("neg", s.money < 0);
    const net = s.lastMonth.income - s.lastMonth.expenses;
    this.deltaEl.textContent = s.day >= DAYS_PER_MONTH ? `${net >= 0 ? "+" : ""}${money(net)}/mo` : "";
    this.deltaEl.classList.toggle("neg", net < 0);
    for (const k of ["r", "c", "i"] as const) {
      const v = s.demand[k];
      const bar = this.bars[k];
      bar.style.height = `${Math.abs(v) * 50}%`;
      bar.style.bottom = v >= 0 ? "50%" : `${50 - Math.abs(v) * 50}%`;
      bar.classList.toggle("neg", v < 0);
    }
    this.happyEl.textContent = String(Math.round(s.happiness));
    this.happyEl.classList.toggle("neg", s.happiness < 60);
    for (const [key, ref] of this.svc) {
      const u = s.utilities[key];
      const ratio = u.supply === 0 ? (u.demand > 0 ? 1 : 0) : Math.min(1, u.demand / u.supply);
      ref.fill.style.width = `${ratio * 100}%`;
      const over = u.demand > u.supply;
      ref.val.textContent = u.supply === 0 ? "none" : `${fmt(u.demand)}/${fmt(u.supply)}`;
      ref.val.classList.toggle("neg", over);
    }
    for (const [key, ref] of this.civ) {
      const v = s.coverage[key];
      ref.fill.style.width = `${v * 100}%`;
      ref.val.textContent = `${Math.round(v * 100)}%`;
    }
    this.lvEl.textContent = String(Math.round(s.landValue));
    this.updateLines(s);
    this.trafficFill.style.width = `${Math.min(1, s.congestion) * 100}%`;
    this.trafficVal.textContent = `${s.vehicles} cars`;
    this.trafficVal.classList.toggle("neg", s.congestion > 0.4);
    const inc = this.budget.querySelector('[data-k="inc"]')!;
    const exp = this.budget.querySelector('[data-k="exp"]')!;
    inc.textContent = money(s.lastMonth.income);
    exp.textContent = money(s.lastMonth.expenses);
  }
}
