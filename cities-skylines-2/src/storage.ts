import { CityState } from "./sim/sim";
import { deserialize, describe, serialize } from "./sim/save";

const PREFIX = "mayor:save:";
export const SLOTS = [1, 2, 3] as const;
export const AUTOSAVE = "auto";

export interface SlotInfo { slot: string; saved: number; pop: number; money: number; day: number }

/** localStorage can be unavailable or full; callers get a result instead of an exception. */
export function saveTo(slot: string, s: CityState): { ok: true } | { ok: false; reason: string } {
  try {
    const info = describe(s);
    localStorage.setItem(PREFIX + slot, serialize(s));
    localStorage.setItem(PREFIX + slot + ":meta", JSON.stringify({ saved: Date.now(), ...info }));
    return { ok: true };
  } catch {
    return { ok: false, reason: "Could not save: browser storage is full or blocked" };
  }
}

export function loadFrom(slot: string): { ok: true; state: CityState } | { ok: false; reason: string } {
  try {
    const raw = localStorage.getItem(PREFIX + slot);
    if (!raw) return { ok: false, reason: "That slot is empty" };
    return { ok: true, state: deserialize(raw) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Could not load" };
  }
}

export function slotInfo(slot: string): SlotInfo | null {
  try {
    const raw = localStorage.getItem(PREFIX + slot + ":meta");
    if (!raw) return null;
    return { slot, ...JSON.parse(raw) } as SlotInfo;
  } catch {
    return null;
  }
}
