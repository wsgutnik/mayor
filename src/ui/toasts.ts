// Adapted from fable-cities (MIT, (c) 2026 raw):
//   src/modules/ui/toasts.js — createToasts (at most 3 visible, life by
//   tone, overflow into a bell with an unread badge, log capped at 40).
// Mayor difference: the pure queue (ToastQueue) is DOM-free and tested;
// ToastsView renders it into the HUD.

import { tr } from "../i18n";

export type ToastTone = "info" | "success" | "warning" | "error" | "milestone";

/** Auto-dismiss life per tone in ms (Fable's TONE_LIFE). */
export const TOAST_LIFE: Record<ToastTone, number> = {
  info: 6000, success: 5000, warning: 8000, error: 9000, milestone: 8000,
};

/** At most this many toasts on screen; older ones slide into the bell. */
export const MAX_VISIBLE_TOASTS = 3;
/** Notification-centre history cap. */
export const TOAST_LOG_MAX = 40;

export interface ToastInput {
  kind?: ToastTone;
  title: string;
  text?: string;
  /** Override the tone's life; 0 = sticky (stays until dismissed). */
  life?: number;
}

export interface ToastEntry {
  id: number;
  kind: ToastTone;
  title: string;
  text: string;
  /** Resolved life in ms; 0 = sticky. */
  life: number;
  read: boolean;
}

export interface ToastCounts { unread: number; total: number }

/**
 * DOM-free notification queue: visible toasts, an unread badge count and a
 * capped history log. The view owns the dismiss timers.
 */
export class ToastQueue {
  readonly live: ToastEntry[] = [];
  readonly log: ToastEntry[] = [];
  unread = 0;
  private nextId = 1;
  private listeners = new Set<(c: ToastCounts) => void>();

  push(n: ToastInput): ToastEntry {
    const kind = n.kind && TOAST_LIFE[n.kind] !== undefined ? n.kind : "info";
    const life = n.life ?? TOAST_LIFE[kind];
    const entry: ToastEntry = { id: this.nextId++, kind, title: n.title, text: n.text ?? "", life, read: false };
    this.log.unshift(entry);
    if (this.log.length > TOAST_LOG_MAX) this.log.length = TOAST_LOG_MAX;
    this.unread++;
    this.live.push(entry);
    while (this.live.length > MAX_VISIBLE_TOASTS) this.live.shift();
    this.notify();
    return entry;
  }

  dismiss(id: number): boolean {
    const i = this.live.findIndex((t) => t.id === id);
    if (i < 0) return false;
    this.live.splice(i, 1);
    return true;
  }

  /** Opening the centre marks everything read and clears the badge. */
  markAllRead(): void {
    this.unread = 0;
    for (const e of this.log) e.read = true;
    this.notify();
  }

  clearLog(): void {
    this.log.length = 0;
    this.live.length = 0;
    this.unread = 0;
    this.notify();
  }

  onChange(fn: (c: ToastCounts) => void): () => void {
    this.listeners.add(fn);
    fn({ unread: this.unread, total: this.log.length });
    return () => { this.listeners.delete(fn); };
  }

  private notify(): void {
    const c = { unread: this.unread, total: this.log.length };
    for (const fn of [...this.listeners]) fn(c);
  }
}

const TONE_GLYPH: Record<ToastTone, string> = {
  info: "ℹ", success: "✓", warning: "⚠", error: "⚠", milestone: "★",
};

/**
 * Renders a ToastQueue into the HUD: stacked toasts, a top-bar bell with an
 * unread badge, and the notification-centre dropdown. All strings via i18n.
 */
export class ToastsView {
  readonly queue = new ToastQueue();
  private box: HTMLElement;
  private centre: HTMLElement;
  private list: HTMLElement;
  private empty: HTMLElement;
  private countEl: HTMLElement;
  private clearBtn: HTMLButtonElement;
  private bellBtn: HTMLButtonElement | null = null;
  private badge: HTMLElement | null = null;
  private timers = new Map<number, number>();
  private unsub: (() => void) | null = null;
  private els = new Map<number, HTMLElement>();

  constructor(root: HTMLElement) {
    this.box = document.createElement("div");
    this.box.className = "toasts";
    this.box.setAttribute("aria-live", "polite");
    root.appendChild(this.box);

    this.countEl = document.createElement("span");
    this.countEl.className = "notif-count";
    const closeBtn = document.createElement("button");
    closeBtn.className = "notif-close";
    closeBtn.setAttribute("aria-label", tr("Close notifications"));
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.closeCentre());
    const head = document.createElement("div");
    head.className = "notif-head";
    const title = document.createElement("h3");
    title.textContent = tr("Notifications");
    head.append(title, this.countEl, closeBtn);
    this.list = document.createElement("div");
    this.list.className = "notif-list";
    this.empty = document.createElement("div");
    this.empty.className = "notif-empty";
    this.empty.textContent = tr("All quiet — no notifications yet.");
    this.clearBtn = document.createElement("button");
    this.clearBtn.className = "notif-clear";
    this.clearBtn.textContent = tr("Clear all");
    this.clearBtn.addEventListener("click", () => { this.queue.clearLog(); this.renderCentre(); });
    const foot = document.createElement("div");
    foot.className = "notif-foot";
    foot.appendChild(this.clearBtn);
    this.centre = document.createElement("div");
    this.centre.className = "panel notif";
    this.centre.setAttribute("role", "dialog");
    this.centre.setAttribute("aria-label", tr("Notifications"));
    this.centre.append(head, this.list, this.empty, foot);
    root.appendChild(this.centre);
  }

  /** The bell lives in the top bar; the HUD passes its speed-row slot. */
  mountBell(slot: HTMLElement): void {
    const bell = document.createElement("button");
    bell.className = "speed-btn bell-btn";
    bell.setAttribute("aria-label", tr("Notifications"));
    bell.innerHTML = `<span aria-hidden="true">🔔</span>`;
    const badge = document.createElement("b");
    badge.className = "bell-badge";
    badge.hidden = true;
    bell.appendChild(badge);
    bell.addEventListener("click", () => this.toggleCentre());
    slot.appendChild(bell);
    this.bellBtn = bell;
    this.badge = badge;
    this.unsub?.();
    this.unsub = this.queue.onChange(({ unread, total }) => {
      void total;
      if (!this.badge || !this.bellBtn) return;
      this.badge.hidden = unread === 0;
      this.badge.textContent = unread > 9 ? "9+" : String(unread);
      this.bellBtn.classList.toggle("has-unread", unread > 0);
      if (this.isOpen) this.renderCentre();
    });
  }

  get isOpen(): boolean { return this.centre.classList.contains("open"); }

  push(n: ToastInput): ToastEntry {
    const entry = this.queue.push(n);
    // Evicted live toasts (over the cap) leave the screen but stay in the log.
    for (const [id, el] of [...this.els]) {
      if (!this.queue.live.some((t) => t.id === id)) this.removeEl(id, el);
    }
    const el = document.createElement("div");
    el.className = `toast-item tone-${entry.kind}`;
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = TONE_GLYPH[entry.kind];
    const body = document.createElement("div");
    body.className = "toast-body";
    const title = document.createElement("div");
    title.className = "toast-title";
    title.textContent = entry.title;
    body.appendChild(title);
    if (entry.text) {
      const text = document.createElement("div");
      text.className = "toast-text";
      text.textContent = entry.text;
      body.appendChild(text);
    }
    const close = document.createElement("button");
    close.className = "toast-close";
    close.setAttribute("aria-label", tr("Dismiss"));
    close.textContent = "✕";
    close.addEventListener("click", (e) => { e.stopPropagation(); this.dismiss(entry.id); });
    el.append(icon, body, close);
    el.addEventListener("click", () => this.dismiss(entry.id));
    this.box.appendChild(el);
    this.els.set(entry.id, el);
    if (entry.life > 0) {
      this.timers.set(entry.id, window.setTimeout(() => this.dismiss(entry.id), entry.life));
    }
    if (this.isOpen) this.renderCentre();
    return entry;
  }

  dismiss(id: number): void {
    if (!this.queue.dismiss(id)) return;
    const el = this.els.get(id);
    if (el) this.removeEl(id, el);
  }

  toggleCentre(): void {
    if (this.isOpen) this.closeCentre();
    else {
      this.renderCentre();
      this.centre.classList.add("open");
      this.bellBtn?.classList.add("is-on");
      this.queue.markAllRead();
    }
  }

  closeCentre(): void {
    this.centre.classList.remove("open");
    this.bellBtn?.classList.remove("is-on");
  }

  private removeEl(id: number, el: HTMLElement): void {
    window.clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.els.delete(id);
    el.classList.add("leaving");
    window.setTimeout(() => el.remove(), 220);
  }

  private renderCentre(): void {
    this.list.innerHTML = "";
    this.countEl.textContent = this.queue.log.length ? String(this.queue.log.length) : "";
    this.empty.style.display = this.queue.log.length ? "none" : "";
    this.clearBtn.disabled = this.queue.log.length === 0;
    for (const e of this.queue.log) {
      const item = document.createElement("div");
      item.className = `notif-item tone-${e.kind}${e.read ? "" : " unread"}`;
      const icon = document.createElement("span");
      icon.className = "toast-icon";
      icon.textContent = TONE_GLYPH[e.kind];
      const body = document.createElement("div");
      body.className = "notif-body";
      const title = document.createElement("div");
      title.className = "notif-title";
      title.textContent = e.title;
      body.appendChild(title);
      if (e.text) {
        const text = document.createElement("div");
        text.className = "notif-text";
        text.textContent = e.text;
        body.appendChild(text);
      }
      item.append(icon, body);
      this.list.appendChild(item);
    }
  }

  destroy(): void {
    for (const t of this.timers.values()) window.clearTimeout(t);
    this.timers.clear();
    this.unsub?.();
    this.box.remove();
    this.centre.remove();
    this.bellBtn?.remove();
  }
}
