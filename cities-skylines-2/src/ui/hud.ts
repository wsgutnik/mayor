import { CityState, COST, ToolId, UtilityKey, dateOf, DAYS_PER_MONTH } from "../sim/sim";
import { COVER } from "../sim/world";
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
  bulldoze: { id: "bulldoze", label: "Bulldoze", icon: "✕", hint: "Remove roads, zones and facilities", color: "#e5584f" },
};

const UTILITY_TOOLS = ["power", "water", "sewage", "landfill"];

const LAYERS: { layer: OverlayLayer; label: string; icon: string; color: string }[] = [
  { layer: 0, label: "Off", icon: "○", color: "#ffffff" },
  { layer: COVER.POWER, label: "Power", icon: "⚡", color: "#f2c230" },
  { layer: COVER.WATER, label: "Water", icon: "💧", color: "#39b6e8" },
  { layer: COVER.SEWAGE, label: "Sewage", icon: "≋", color: "#a07848" },
  { layer: COVER.GARBAGE, label: "Garbage", icon: "♻", color: "#9aa3ad" },
];

export const toolColor = (t: ToolId) => (T[t] ? T[t].color : "#ffffff");

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (n: number) => (n < 0 ? "-$" : "$") + fmt(Math.abs(n));

export interface HudHooks {
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
    for (const id of ["pan", "road", "res", "com", "ind"]) bar.appendChild(this.toolButton(T[id]));

    this.groupBtn = el("button", "tool", `<span class="ic" style="color:#f2c230">⚡</span><span>Utilities</span><small>▴</small>`);
    this.groupBtn.addEventListener("click", () => this.toggleFly(this.flyUtil));
    bar.appendChild(this.groupBtn);

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
    this.flyView = el("div", "panel fly");
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
    this.root.appendChild(this.flyView);

    this.hint = el("div", "hint", "");
    this.root.appendChild(this.hint);
  }

  private toggleFly(which: HTMLElement): void {
    const open = which.classList.contains("open");
    this.closeFlyouts();
    if (!open) which.classList.add("open");
  }

  private closeFlyouts(): void {
    this.flyUtil.classList.remove("open");
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
    const inc = this.budget.querySelector('[data-k="inc"]')!;
    const exp = this.budget.querySelector('[data-k="exp"]')!;
    inc.textContent = money(s.lastMonth.income);
    exp.textContent = money(s.lastMonth.expenses);
  }
}
