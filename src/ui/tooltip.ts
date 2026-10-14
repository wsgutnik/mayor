// Adapted from fable-cities (MIT, (c) 2026 raw):
//   src/modules/ui/tooltip.js — createTooltip (one shared rich tooltip that
//   never covers sibling UI, suspend() for modals).
// Mayor differences: placement is a pure tested function (placeTooltip);
// touch shows the tip on long-press; content rows are pre-translated by the caller.

import { tr } from "../i18n";

export interface TooltipRow { k: string; v: string }
export interface TooltipContent {
  icon?: string;
  title: string;
  key?: string;
  desc?: string;
  /** Absolute cost, or 0 for Free. */
  cost?: number;
  unit?: string;
  upkeep?: number;
  per?: string;
  rows?: TooltipRow[];
  color?: string;
}

export interface TipAnchor { left: number; top: number; bottom: number; width: number }
export interface TipViewport { w: number; h: number }

/**
 * Pure placement: above the anchor, lifted above `liftAbove` (the open
 * flyout/tray top) so sibling UI is never covered, or below when there is
 * no room. Returns the top-left corner plus the arrow offset.
 */
export function placeTooltip(
  anchor: TipAnchor, tip: { w: number; h: number }, viewport: TipViewport, liftAbove?: number,
): { x: number; y: number; below: boolean; arrowX: number } {
  const w = Math.max(1, tip.w), h = Math.max(1, tip.h);
  let x = anchor.left + anchor.width / 2 - w / 2;
  x = Math.max(8, Math.min(Math.max(8, viewport.w - w - 8), x));
  let y = anchor.top - h - 12;
  let below = false;
  if (liftAbove !== undefined) y = Math.min(y, liftAbove - h - 10);
  if (y < 8) {
    y = anchor.bottom + 12;
    below = true;
  }
  if (below && y + h > viewport.h - 8) y = Math.max(8, viewport.h - h - 8);
  const cx = anchor.left + anchor.width / 2;
  const arrowX = Math.round(Math.max(14, Math.min(w - 14, cx - x)));
  return { x: Math.round(x), y: Math.round(y), below, arrowX };
}

/** Format a money amount the way tooltips show it ($1,234). */
export function tipMoney(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

/** One shared rich tooltip for the whole HUD. */
export class Tooltip {
  private el: HTMLElement;
  private timer = 0;
  private current: HTMLElement | null = null;
  private pinned: HTMLElement | null = null;
  private lastHide = 0;
  private enabled = true;
  private suspended = false;
  private pressTimer = 0;

  constructor(private root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "rich-tip";
    this.el.setAttribute("role", "tooltip");
    root.appendChild(this.el);
  }

  private build(content: TooltipContent | string): void {
    this.el.innerHTML = "";
    if (typeof content === "string") {
      const simple = document.createElement("div");
      simple.className = "tip-simple";
      simple.textContent = content;
      this.el.appendChild(simple);
      return;
    }
    this.el.style.setProperty("--tt", content.color ?? "var(--accent)");
    const head = document.createElement("div");
    head.className = "tip-head";
    if (content.icon) {
      const icon = document.createElement("span");
      icon.className = "tip-icon";
      icon.textContent = content.icon;
      head.appendChild(icon);
    }
    const title = document.createElement("div");
    title.className = "tip-title";
    title.textContent = content.title;
    head.appendChild(title);
    if (content.key) {
      const key = document.createElement("span");
      key.className = "tip-key";
      key.textContent = content.key;
      head.appendChild(key);
    }
    this.el.appendChild(head);
    if (content.desc) {
      const desc = document.createElement("div");
      desc.className = "tip-desc";
      desc.textContent = content.desc;
      this.el.appendChild(desc);
    }
    if (content.cost !== undefined) {
      this.el.appendChild(this.row(tr("Cost"), content.cost === 0 ? tr("Free") : tipMoney(content.cost) + (content.unit ?? "")));
    }
    if (content.upkeep) {
      this.el.appendChild(this.row(tr("Upkeep"), `${tipMoney(content.upkeep)} / ${content.per ?? tr("mo")}`));
    }
    for (const r of content.rows ?? []) this.el.appendChild(this.row(r.k, r.v));
  }

  private row(k: string, v: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "tip-row";
    const kk = document.createElement("span");
    kk.className = "k";
    kk.textContent = k;
    const vv = document.createElement("span");
    vv.className = "v";
    vv.textContent = v;
    row.append(kk, vv);
    return row;
  }

  private detached(target: HTMLElement | null): boolean {
    return !target || !target.isConnected || target.offsetParent === null;
  }

  private place(target: HTMLElement): void {
    const r = target.getBoundingClientRect();
    // Lift above an open flyout so the tip never covers the toolbar tray.
    const openFly = this.root.querySelector(".fly.open");
    const liftAbove = target.closest(".fly") || target.closest(".toolbar")
      ? (openFly ? openFly.getBoundingClientRect().top : undefined)
      : undefined;
    const p = placeTooltip(
      { left: r.left, top: r.top, bottom: r.bottom, width: r.width },
      { w: this.el.offsetWidth, h: this.el.offsetHeight },
      { w: window.innerWidth, h: window.innerHeight },
      liftAbove,
    );
    this.el.style.left = `${p.x}px`;
    this.el.style.top = `${p.y}px`;
    this.el.style.setProperty("--tip-arrow-x", `${p.arrowX}px`);
    this.el.classList.toggle("below", p.below);
  }

  show(target: HTMLElement, content: TooltipContent | string | (() => TooltipContent | string)): void {
    if (this.suspended) return;
    if (!this.enabled && !this.pinned) return;
    if (this.detached(target)) return;
    this.current = target;
    this.build(typeof content === "function" ? content() : content);
    this.el.classList.add("visible");
    this.place(target);
  }

  hide(force = false): void {
    if (this.pinned && !force) return;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.current = null;
    this.el.classList.remove("visible");
    this.lastHide = performance.now();
  }

  attach(target: HTMLElement, content: TooltipContent | string | (() => TooltipContent | string)): HTMLElement {
    target.addEventListener("mouseenter", () => {
      if (this.pinned || this.suspended) return;
      window.clearTimeout(this.timer);
      const quick = performance.now() - this.lastHide < 350;
      this.timer = window.setTimeout(() => this.show(target, content), quick ? 40 : 320);
    });
    target.addEventListener("mouseleave", () => { if (!this.pinned) this.hide(); });
    target.addEventListener("mousedown", () => { if (!this.pinned) this.hide(); });
    // Touch (iPad): long-press shows the tip, release hides it.
    target.addEventListener("touchstart", () => {
      if (this.pinned || this.suspended) return;
      window.clearTimeout(this.pressTimer);
      this.pressTimer = window.setTimeout(() => this.show(target, content), 450);
    }, { passive: true });
    target.addEventListener("touchend", () => {
      window.clearTimeout(this.pressTimer);
      if (!this.pinned) this.hide();
    });
    (target as unknown as { __tip: unknown }).__tip = content;
    return target;
  }

  /** Keep a tip open (dev pin); pin(null) releases. */
  pin(target: HTMLElement | null): void {
    this.pinned = target;
    if (target) {
      const c = (target as unknown as { __tip: TooltipContent | string }).__tip ?? "";
      this.show(target, c);
    } else this.hide(true);
  }

  /** Per-frame guard: release dead pins, keep the visible tip glued to its anchor. */
  tick(): void {
    if (this.pinned && this.detached(this.pinned)) {
      this.pinned = null;
      this.hide(true);
      return;
    }
    if (this.current && this.el.classList.contains("visible")) {
      if (this.detached(this.current)) this.hide(true);
      else this.place(this.current);
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.hide(true);
  }

  /** Modal overlays: hide, release any pin and ignore hover until resumed. */
  suspend(v: boolean): void {
    this.suspended = v;
    if (v) {
      this.pinned = null;
      this.hide(true);
    }
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.pressTimer);
    this.el.remove();
  }
}
