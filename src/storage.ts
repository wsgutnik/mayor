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

/** Download the city as a file the player can keep or move to another device. */
export function exportFile(s: CityState): void {
  const blob = new Blob([serialize(s)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mayor-day-${s.day}.mayor.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ */
/* IndexedDB backend (mayor-saves) with one-shot legacy migration.     */
/* The serialized payload stays opaque: no save-format change.         */
/* ------------------------------------------------------------------ */

export interface SaveRecord {
  slot: string;
  payload: string;
  meta: SlotInfo;
  bytes: number;
  updatedAt: number;
  source: "localStorage-migration" | "game";
}

/** Minimal store contract so tests can substitute an in-memory backend. */
export interface SaveStore {
  get(slot: string): Promise<SaveRecord | null>;
  put(record: SaveRecord): Promise<void>;
  getAll(): Promise<SaveRecord[]>;
  delete(slot: string): Promise<void>;
}

const DB_NAME = "mayor-saves";
const STORE_NAME = "saves";
const MIGRATED_KEY = "mayor:idb-migrated";
export const ALL_SLOTS: readonly string[] = [AUTOSAVE, "1", "2", "3"];

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

class IdbSaveStore implements SaveStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME, { keyPath: "slot" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
        request.onblocked = () => reject(new Error("IndexedDB open blocked"));
      }).catch((e: unknown) => {
        this.dbPromise = null;
        throw e;
      });
    }
    return this.dbPromise;
  }

  async get(slot: string): Promise<SaveRecord | null> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, "readonly");
    const record = await idbRequest(tx.objectStore(STORE_NAME).get(slot) as IDBRequest<SaveRecord | undefined>);
    await txDone(tx).catch(() => undefined);
    return record ?? null;
  }

  async put(record: SaveRecord): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    await txDone(tx);
  }

  async getAll(): Promise<SaveRecord[]> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, "readonly");
    const records = await idbRequest(tx.objectStore(STORE_NAME).getAll() as IDBRequest<SaveRecord[]>);
    await txDone(tx).catch(() => undefined);
    return records;
  }

  async delete(slot: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(slot);
    await txDone(tx);
  }
}

let defaultStore: SaveStore | null = null;
function store(): SaveStore {
  if (!defaultStore) defaultStore = new IdbSaveStore();
  return defaultStore;
}

/** Meta cache so the (synchronous) menu render never awaits IndexedDB. */
const metaCache = new Map<string, SlotInfo>();

export function slotInfoCached(slot: string): SlotInfo | null {
  return metaCache.get(slot) ?? slotInfo(slot);
}

export async function refreshMetaCache(s: SaveStore = store()): Promise<void> {
  try {
    const records = await s.getAll();
    metaCache.clear();
    for (const r of records) metaCache.set(r.slot, r.meta);
  } catch {
    // Cache stays as-is; legacy slotInfo() remains the fallback.
  }
}

export async function saveGame(
  slot: string, s: CityState, backend: SaveStore = store(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const payload = serialize(s); // Serialize synchronously, before any await.
  const info = describe(s);
  const meta: SlotInfo = { slot, saved: Date.now(), ...info };
  try {
    await backend.put({ slot, payload, meta, bytes: payload.length, updatedAt: meta.saved, source: "game" });
    metaCache.set(slot, meta);
    return { ok: true };
  } catch {
    // IndexedDB unavailable or failed: fall through to the legacy backend.
  }
  const r = saveTo(slot, s);
  if (r.ok) metaCache.set(slot, meta);
  return r;
}

export async function loadGame(
  slot: string, backend: SaveStore = store(),
): Promise<{ ok: true; state: CityState } | { ok: false; reason: string }> {
  try {
    const record = await backend.get(slot);
    if (record) return { ok: true, state: deserialize(record.payload) };
  } catch {
    // Dual-read: fall through to the legacy key for one release.
  }
  return loadFrom(slot);
}

export async function deleteGame(slot: string, backend: SaveStore = store()): Promise<void> {
  metaCache.delete(slot);
  try {
    await backend.delete(slot);
  } catch {
    // Legacy removal below also runs, so the slot is gone either way.
  }
  try {
    localStorage.removeItem(PREFIX + slot);
    localStorage.removeItem(PREFIX + slot + ":meta");
  } catch {
    // Storage blocked: nothing else can be done here.
  }
}

/**
 * One-shot, idempotent, lossless migration of mayor:save:* keys into
 * IndexedDB. Legacy keys are removed only after every migrated record
 * reads back byte-identical; any failure leaves localStorage untouched.
 */
export async function migrateLegacySaves(backend: SaveStore = store()): Promise<boolean> {
  try {
    if (localStorage.getItem(MIGRATED_KEY) === "1") {
      await refreshMetaCache(backend);
      return true;
    }
  } catch {
    return false;
  }
  const found: SaveRecord[] = [];
  try {
    for (const slot of ALL_SLOTS) {
      const payload = localStorage.getItem(PREFIX + slot);
      if (!payload) continue;
      const parsed: unknown = JSON.parse(payload);
      const v = (parsed as { v?: unknown } | null)?.v;
      if (v !== 1 && v !== 2) continue; // Not a Mayor save: leave it alone.
      let meta: SlotInfo = { slot, saved: Date.now(), pop: 0, money: 0, day: 0 };
      try {
        const rawMeta = localStorage.getItem(PREFIX + slot + ":meta");
        if (rawMeta) meta = { slot, ...(JSON.parse(rawMeta) as Omit<SlotInfo, "slot">) };
      } catch {
        // Meta is advisory; the payload above is the source of truth.
      }
      found.push({ slot, payload, meta, bytes: payload.length, updatedAt: meta.saved, source: "localStorage-migration" });
    }
  } catch {
    return false;
  }
  try {
    for (const record of found) await backend.put(record);
    for (const record of found) {
      const back = await backend.get(record.slot);
      if (!back || back.payload !== record.payload) return false; // Keep legacy keys.
    }
  } catch {
    return false;
  }
  try {
    for (const record of found) {
      localStorage.removeItem(PREFIX + record.slot);
      localStorage.removeItem(PREFIX + record.slot + ":meta");
    }
    localStorage.setItem(MIGRATED_KEY, "1");
  } catch {
    // Records are safe in IndexedDB; stale legacy keys dual-read harmlessly.
  }
  await refreshMetaCache(backend);
  return true;
}

/** Read a city from a file the player picked. */
export async function importFile(file: File): Promise<{ ok: true; state: CityState } | { ok: false; reason: string }> {
  try {
    if (file.size > 5_000_000) return { ok: false, reason: "That file is too large to be a Mayor save" };
    return { ok: true, state: deserialize(await file.text()) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Could not read the file" };
  }
}
