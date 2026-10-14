/** Tiny event bus for UI reactions (onboarding completes on these, never on timers). */
export type CityEvent =
  | "roads:changed"
  | "zones:changed"
  | "time:speed"
  | "building:added"
  | "tool:changed"
  | "infoview:changed"
  | "landmark:appeared";

export interface LandmarkAppeared { id: string; name: string; nameEn: string; x: number; z: number }
export type CityEventHandler = (detail?: LandmarkAppeared) => void;

export class EventBus {
  private listeners = new Map<CityEvent, Set<CityEventHandler>>();

  /** Subscribe; returns an unsubscribe function. */
  on(name: CityEvent, fn: CityEventHandler): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn);
    return () => { this.listeners.get(name)?.delete(fn); };
  }

  emit(name: CityEvent, detail?: LandmarkAppeared): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) fn(detail);
  }
}

/** The shared bus: main.ts emits, HUD components subscribe. */
export const cityEvents = new EventBus();
