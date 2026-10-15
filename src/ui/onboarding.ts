// Adapted from fable-cities (MIT, (c) 2026 raw):
//   src/modules/ui/onboarding.js — createOnboarding (four-step objective
//   card completing on real world events, pointer ring, session-scoped
//   dismissal with storage wrapped in try).
// Mayor differences: the pure step machine (OnboardingModel) is DOM-free
// and tested; steps compare against baselines captured at start because
// Mayor pre-builds an entry road; text is plain (i18n strings, no markup).

import { tr } from "../i18n";
import { CityEvent, EventBus } from "./events";

/** The world facts one onboarding step can complete on. */
export interface OnboardingSnapshot {
  /** Road segments in the graph. */
  roads: number;
  /** Tiles carrying a zone. */
  zoned: number;
  /** Game speed multiplier (0 = paused). */
  speed: number;
  /** Tool currently in hand. */
  tool: string;
  /** Tiles with a building. */
  buildings: number;
}

export interface OnboardingStepDef {
  id: string;
  /** Event that triggers the completion check (never a timer). */
  event: CityEvent;
  /** Tool that arms this step (swaps the body text). Empty = no tool. */
  armTool: string;
  done: (s: OnboardingSnapshot, base: OnboardingSnapshot) => boolean;
}

export const ONBOARDING_STEPS: OnboardingStepDef[] = [
  {
    id: "road", event: "roads:changed", armTool: "road",
    done: (s, base) => s.roads > base.roads,
  },
  {
    id: "zone", event: "zones:changed", armTool: "",
    done: (s, base) => s.zoned > base.zoned,
  },
  {
    id: "speed", event: "time:speed", armTool: "",
    done: (s) => s.speed >= 2,
  },
  {
    id: "grow", event: "building:added", armTool: "",
    done: (s, base) => s.buildings > base.buildings,
  },
];

/** Session-scoped dismissal flag; the view wraps sessionStorage in try. */
export interface DismissalStore {
  get(): boolean;
  set(): void;
}

export const memoryDismissal = (): DismissalStore => {
  let dismissed = false;
  return { get: () => dismissed, set: () => { dismissed = true; } };
};

/**
 * DOM-free guided-start machine. Steps complete only via check() (wired to
 * their event); nothing here runs on a timer. Baselines are captured at
 * start because a fresh Mayor city already has an entry road.
 */
export class OnboardingModel {
  private i = 0;
  private base: OnboardingSnapshot | null = null;
  private _active = false;
  private _finished = false;

  constructor(private store: DismissalStore = memoryDismissal()) {}

  get active(): boolean { return this._active; }
  get finished(): boolean { return this._finished; }
  get index(): number { return this.i; }
  get step(): string | null {
    if (this._finished) return "done";
    return this._active ? ONBOARDING_STEPS[this.i]?.id ?? null : null;
  }

  eligible(snapshot: OnboardingSnapshot): boolean {
    if (this.store.get()) return false;
    return snapshot.buildings === 0 && snapshot.roads <= 4;
  }

  start(snapshot: OnboardingSnapshot): boolean {
    if (this._active || this._finished || !this.eligible(snapshot)) return false;
    this.base = { ...snapshot };
    this.i = 0;
    while (this.i < ONBOARDING_STEPS.length && ONBOARDING_STEPS[this.i].done(snapshot, this.base)) this.i++;
    if (this.i >= ONBOARDING_STEPS.length) return false;
    this._active = true;
    return true;
  }

  /** Evaluate the current step; returns true when a step completed. */
  check(snapshot: OnboardingSnapshot): boolean {
    if (!this._active || this._finished || !this.base) return false;
    const step = ONBOARDING_STEPS[this.i];
    if (!step || !step.done(snapshot, this.base)) return false;
    this.i++;
    while (this.i < ONBOARDING_STEPS.length && ONBOARDING_STEPS[this.i].done(snapshot, this.base)) this.i++;
    if (this.i >= ONBOARDING_STEPS.length) {
      this._finished = true;
      this._active = false;
      this.store.set(); // a finished guide stays gone for the session, like a dismissed one
    }
    return true;
  }

  dismiss(): void {
    this._active = false;
    this.store.set();
  }
}

const STEP_COLOR: Record<string, string> = {
  road: "#7fd4ff", zone: "#8ce99a", speed: "#ffd66b", grow: "#ffa8c5",
};

export const STEP_TITLE: Record<string, string> = {
  road: "Draw your first road",
  zone: "Zone homes beside it",
  speed: "Let the clock run",
  grow: "Watch them move in",
};

export const STEP_TEXT: Record<string, string> = {
  road: "Roads is the first button below. Open it, tap a start point on the ground, then tap the end point — everything in a city grows along a street.",
  zone: "Open Zones, take Residential, and drag over the ground next to your road.",
  speed: "Nothing is built while time crawls. Push the speed to 2× up in the clock — the plots start building straight away.",
  grow: "Buildings rise on each plot, then residents arrive. The RCI bars top-left tell you what to zone next.",
};

export const STEP_ARMED: Record<string, string> = {
  road: "Road tool ready. Tap a start point, then tap the end point to build.",
};

export interface OnboardingTargets {
  road: () => HTMLElement | null;
  zone: () => HTMLElement | null;
  speed: () => HTMLElement | null;
  grow: () => HTMLElement | null;
}

/**
 * The objective card + pointer ring. Subscribes to step events on the bus;
 * tick() (called from Hud.update) repositions the ring and re-checks as a
 * safety net for mutations that emit nothing.
 */
export class OnboardingCard {
  private model: OnboardingModel;
  private card: HTMLElement;
  private badge: HTMLElement;
  private titleEl: HTMLElement;
  private textEl: HTMLElement;
  private dots: HTMLElement[] = [];
  private ring: HTMLElement;
  private unsubs: (() => void)[] = [];
  private ringTimer = 0;
  private finishTimer = 0;
  private lastTarget: HTMLElement | null = null;

  constructor(
    root: HTMLElement,
    mount: HTMLElement,
    private targets: OnboardingTargets,
    bus: EventBus,
    store?: DismissalStore,
  ) {
    this.model = new OnboardingModel(store ?? sessionDismissal());
    this.badge = document.createElement("span");
    this.badge.className = "onb-badge";
    const kicker = document.createElement("div");
    kicker.className = "onb-kicker";
    kicker.textContent = tr("Getting started");
    const close = document.createElement("button");
    close.className = "onb-close";
    close.setAttribute("aria-label", tr("Dismiss the guide"));
    close.textContent = "✕";
    close.addEventListener("click", () => this.dismiss());
    const head = document.createElement("div");
    head.className = "onb-head";
    head.append(this.badge, kicker, close);
    this.titleEl = document.createElement("div");
    this.titleEl.className = "onb-title";
    this.textEl = document.createElement("div");
    this.textEl.className = "onb-text";
    const dots = document.createElement("div");
    dots.className = "onb-dots";
    for (const _ of ONBOARDING_STEPS) {
      const d = document.createElement("i");
      dots.appendChild(d);
      this.dots.push(d);
    }
    this.card = document.createElement("div");
    this.card.className = "panel guide-card";
    this.card.setAttribute("role", "status");
    this.card.hidden = true;
    this.card.append(head, this.titleEl, this.textEl, dots);
    mount.prepend(this.card);
    this.ring = document.createElement("div");
    this.ring.className = "guide-ring";
    this.ring.setAttribute("aria-hidden", "true");
    root.appendChild(this.ring);
    const seen = new Set<CityEvent>();
    for (const s of ONBOARDING_STEPS) {
      if (seen.has(s.event)) continue;
      seen.add(s.event);
      this.unsubs.push(bus.on(s.event, () => this.check()));
    }
    this.unsubs.push(bus.on("tool:changed", () => this.render()));
  }

  get step(): string | null { return this.model.step; }

  start(snapshot: OnboardingSnapshot): void {
    if (!this.model.start(snapshot)) return;
    this.card.hidden = false;
    this.render();
  }

  /** Event entry point: needs the latest snapshot. */
  check(): void {
    const s = this.snapshot?.();
    if (!s) return;
    if (!this.model.check(s)) return;
    if (this.model.finished) this.finish();
    else this.render();
  }

  private snapshot: (() => OnboardingSnapshot | null) | null = null;

  bind(snapshot: () => OnboardingSnapshot | null): void {
    this.snapshot = snapshot;
  }

  /** Reposition the ring (~8 Hz) and re-check twice a second as a safety net. */
  tick(now: number): void {
    if (!this.model.active) return;
    if (now - this.ringTimer < 120) return;
    this.ringTimer = now;
    const s = this.snapshot?.();
    if (s && this.model.check(s)) {
      if (this.model.finished) { this.finish(); return; }
      this.render();
    }
    const id = this.model.step;
    const target = id ? this.targets[id as keyof OnboardingTargets]?.() ?? null : null;
    if (!target || !target.isConnected || this.card.hidden) {
      this.ring.classList.remove("on");
      this.lastTarget = null;
      return;
    }
    const r = target.getBoundingClientRect();
    if (r.width < 2) {
      this.ring.classList.remove("on");
      this.lastTarget = null;
      return;
    }
    this.ring.style.transform = `translate(${Math.round(r.left - 6)}px, ${Math.round(r.top - 6)}px)`;
    this.ring.style.width = `${Math.round(r.width + 12)}px`;
    this.ring.style.height = `${Math.round(r.height + 12)}px`;
    this.ring.style.setProperty("--onb", STEP_COLOR[id!] ?? "#fff");
    this.ring.classList.toggle("below", r.top < 42);
    if (this.lastTarget !== target) {
      this.lastTarget = target;
      this.ring.classList.add("on");
    }
  }

  private render(): void {
    const id = this.model.step;
    if (!id || id === "done") return;
    this.card.dataset.step = id;
    this.card.style.setProperty("--onb", STEP_COLOR[id] ?? "#fff");
    this.badge.textContent = String(this.model.index + 1);
    this.titleEl.textContent = tr(STEP_TITLE[id]);
    const s = this.snapshot?.();
    const step = ONBOARDING_STEPS[this.model.index];
    const armed = step && s && step.armTool !== "" && s.tool === step.armTool && STEP_ARMED[id];
    this.textEl.textContent = tr(armed ? STEP_ARMED[id] : STEP_TEXT[id]);
    for (let i = 0; i < this.dots.length; i++) {
      this.dots[i].classList.toggle("done", i < this.model.index);
      this.dots[i].classList.toggle("now", i === this.model.index);
    }
  }

  private finish(): void {
    this.badge.textContent = "✓";
    this.titleEl.textContent = tr("That is the whole loop");
    this.textEl.textContent = tr("Road, zone, let time run. Watch the RCI bars and add services as people arrive.");
    for (const d of this.dots) d.classList.add("done");
    this.ring.classList.remove("on");
    this.lastTarget = null;
    window.clearTimeout(this.finishTimer);
    this.finishTimer = window.setTimeout(() => this.dismiss(), 11000);
  }

  dismiss(): void {
    this.model.dismiss();
    this.hideVisual();
  }

  /** City swapped: drop the card and its baselines without session-dismissing. */
  reset(store?: DismissalStore): void {
    this.hideVisual();
    this.model = new OnboardingModel(store ?? sessionDismissal());
  }

  private hideVisual(): void {
    window.clearTimeout(this.finishTimer);
    this.card.hidden = true;
    this.ring.classList.remove("on");
    this.lastTarget = null;
  }

  destroy(): void {
    window.clearTimeout(this.finishTimer);
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.card.remove();
    this.ring.remove();
  }
}

/** Session-scoped dismissal; storage access wrapped because it can throw. */
export function sessionDismissal(key = "mayor-guide-dismissed"): DismissalStore {
  return {
    get: () => {
      try { return sessionStorage.getItem(key) === "1"; } catch { return false; }
    },
    set: () => {
      try { sessionStorage.setItem(key, "1"); } catch { /* private mode */ }
    },
  };
}
