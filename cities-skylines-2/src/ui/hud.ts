import { CityState, COST, ToolId, dateOf, DAYS_PER_MONTH } from "../sim/sim";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TOOLS: { id: ToolId; label: string; icon: string; hint: string; color: string }[] = [
  { id: "pan", label: "Move", icon: "✋", hint: "Drag to move the camera", color: "#ffffff" },
  { id: "road", label: "Road", icon: "═", hint: "Paint roads", color: "#9aa3b2" },
  { id: "res", label: "Residential", icon: "⌂", hint: "Zone residential", color: "#4fbf6a" },
  { id: "com", label: "Commercial", icon: "▣", hint: "Zone commercial", color: "#4a8fe0" },
  { id: "ind", label: "Industrial", icon: "⚙", hint: "Zone industrial", color: "#e0b43a" },
  { id: "bulldoze", label: "Bulldoze", icon: "✕", hint: "Remove roads and zones", color: "#e5584f" },
];

export const toolColor = (t: ToolId) => TOOLS.find((x) => x.id === t)!.color;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (n: number) => (n < 0 ? "-$" : "$") + fmt(Math.abs(n));

export interface HudHooks {
  onTool(t: ToolId): void;
  onSpeed(s: number): void;
  onTax(rate: number): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export class Hud {
  private root: HTMLElement;
  private moneyEl!: HTMLElement;
  private deltaEl!: HTMLElement;
  private popEl!: HTMLElement;
  private dateEl!: HTMLElement;
  private jobsEl!: HTMLElement;
  private bars!: { r: HTMLElement; c: HTMLElement; i: HTMLElement };
  private toolBtns = new Map<ToolId, HTMLElement>();
  private speedBtns: HTMLElement[] = [];
  private toast!: HTMLElement;
  private toastTimer = 0;
  private budget!: HTMLElement;
  private taxLabel!: HTMLElement;
  private hint!: HTMLElement;

  constructor(parent: HTMLElement, private hooks: HudHooks) {
    this.root = el("div", "hud");
    parent.appendChild(this.root);
    this.buildTop();
    this.buildDemand();
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

  private buildBottom(): void {
    const bar = el("div", "panel toolbar");
    for (const t of TOOLS) {
      const cost = t.id === "pan" ? "" : `<small>$${COST[t.id as Exclude<ToolId, "pan">]}</small>`;
      const b = el("button", "tool", `<span class="ic" style="color:${t.color}">${t.icon}</span><span>${t.label}</span>${cost}`);
      b.title = t.hint;
      b.addEventListener("click", () => {
        this.hooks.onTool(t.id);
        this.setTool(t.id);
      });
      bar.appendChild(b);
      this.toolBtns.set(t.id, b);
    }
    const eco = el("button", "tool", `<span class="ic">$</span><span>Economy</span>`);
    eco.addEventListener("click", () => this.budget.classList.toggle("open"));
    bar.appendChild(eco);
    this.root.appendChild(bar);
    this.hint = el("div", "hint", "");
    this.root.appendChild(this.hint);
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
    this.hint.textContent = TOOLS.find((x) => x.id === t)!.hint;
  }

  setSpeed(s: number): void {
    const order = [0, 1, 2, 4];
    this.speedBtns.forEach((b, i) => b.classList.toggle("active", order[i] === s));
  }

  showToast(msg: string): void {
    this.toast.textContent = msg;
    this.toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), 1600);
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
    const inc = this.budget.querySelector('[data-k="inc"]')!;
    const exp = this.budget.querySelector('[data-k="exp"]')!;
    inc.textContent = money(s.lastMonth.income);
    exp.textContent = money(s.lastMonth.expenses);
  }
}
