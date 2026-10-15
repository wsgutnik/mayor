import { beforeEach, describe, expect, it } from "vitest";
import { newCity } from "./sim/sim";
import { serialize } from "./sim/save";
import {
  SaveRecord,
  SaveStore,
  loadGame,
  migrateLegacySaves,
  saveGame,
  slotInfoCached,
} from "./storage";

class MemoryStore implements SaveStore {
  records = new Map<string, SaveRecord>();
  fail = false;
  async get(slot: string): Promise<SaveRecord | null> {
    if (this.fail) throw new Error("idb unavailable");
    return this.records.get(slot) ?? null;
  }
  async put(record: SaveRecord): Promise<void> {
    if (this.fail) throw new Error("idb unavailable");
    this.records.set(record.slot, record);
  }
  async getAll(): Promise<SaveRecord[]> {
    if (this.fail) throw new Error("idb unavailable");
    return [...this.records.values()];
  }
  async delete(slot: string): Promise<void> {
    this.records.delete(slot);
  }
}

function stubLocalStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
  };
  return map;
}

describe("IndexedDB save backend", () => {
  let ls: Map<string, string>;
  beforeEach(() => { ls = stubLocalStorage(); });

  it("saves and loads a city through the async store", async () => {
    const store = new MemoryStore();
    const city = newCity(42, 32);
    const saved = await saveGame("1", city, store);
    expect(saved.ok).toBe(true);
    expect(store.records.get("1")?.payload).toBe(serialize(city));
    expect(slotInfoCached("1")?.slot).toBe("1");
    const loaded = await loadGame("1", store);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.state.day).toBe(city.day);
  });

  it("migrates legacy keys losslessly, verifies, then removes them", async () => {
    const store = new MemoryStore();
    const city = newCity(7, 32);
    const payload = serialize(city);
    ls.set("mayor:save:auto", payload);
    ls.set("mayor:save:auto:meta", JSON.stringify({ saved: 123, pop: 5, money: 900, day: 3 }));
    ls.set("mayor:save:2", payload);
    await expect(migrateLegacySaves(store)).resolves.toBe(true);
    expect(store.records.get("auto")?.payload).toBe(payload);
    expect(store.records.get("auto")?.source).toBe("localStorage-migration");
    expect(store.records.get("2")?.payload).toBe(payload);
    expect(ls.has("mayor:save:auto")).toBe(false);
    expect(ls.has("mayor:save:2")).toBe(false);
    expect(ls.get("mayor:idb-migrated")).toBe("1");
    // Second boot is a no-op and keeps the records.
    await expect(migrateLegacySaves(store)).resolves.toBe(true);
    expect(store.records.size).toBe(2);
  });

  it("keeps legacy keys when the store fails (private mode)", async () => {
    const store = new MemoryStore();
    store.fail = true;
    const payload = serialize(newCity(9, 32));
    ls.set("mayor:save:1", payload);
    await expect(migrateLegacySaves(store)).resolves.toBe(false);
    expect(ls.get("mayor:save:1")).toBe(payload);
    expect(ls.has("mayor:idb-migrated")).toBe(false);
  });

  it("dual-reads a legacy save when IndexedDB has no record", async () => {
    const store = new MemoryStore();
    const city = newCity(11, 32);
    ls.set("mayor:save:3", serialize(city));
    const loaded = await loadGame("3", store);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.state.day).toBe(city.day);
  });
});
