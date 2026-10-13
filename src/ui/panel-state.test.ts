import { describe, expect, it } from "vitest";
import {
  PANEL_STORAGE_KEY,
  defaultPanelState,
  loadPanelState,
  parsePanelState,
  savePanelState,
  serializePanelState,
  setPanelCollapsed,
  setPanelsHidden,
  togglePanelCollapsed,
  togglePanelsHidden,
  type PanelStorage,
} from "./panel-state";

function memStorage(backing = new Map<string, string>()): PanelStorage & { backing: Map<string, string> } {
  return {
    backing,
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => { backing.set(k, v); },
  };
}

describe("panel-state", () => {
  it("defaults to everything expanded and visible", () => {
    expect(defaultPanelState()).toEqual({
      collapsed: { demand: false, indicators: false, services: false, lines: false },
      panelsHidden: false,
    });
  });

  it("round-trips through the mayor:ui-panels key", () => {
    const store = memStorage();
    let s = defaultPanelState();
    s = togglePanelCollapsed(s, "services");
    s = setPanelsHidden(s, true);
    savePanelState(s, store);
    expect(store.backing.has(PANEL_STORAGE_KEY)).toBe(true);
    expect(loadPanelState(store)).toEqual(s);
    expect(serializePanelState(s)).toBe(store.backing.get(PANEL_STORAGE_KEY));
  });

  it("toggles one panel without touching the others", () => {
    const s = togglePanelCollapsed(togglePanelCollapsed(defaultPanelState(), "demand"), "lines");
    expect(s.collapsed).toEqual({ demand: true, indicators: false, services: false, lines: true });
    expect(togglePanelsHidden(setPanelsHidden(s, false)).panelsHidden).toBe(true);
    expect(setPanelCollapsed(s, "demand", true)).toBe(s); // no-op returns the same object
  });

  it("ignores corrupt, missing or hostile stored values", () => {
    expect(parsePanelState(null)).toEqual(defaultPanelState());
    expect(parsePanelState("")).toEqual(defaultPanelState());
    expect(parsePanelState("{nope")).toEqual(defaultPanelState());
    expect(parsePanelState("42")).toEqual(defaultPanelState());
    expect(parsePanelState(JSON.stringify({ collapsed: { services: true, nope: true }, panelsHidden: "yes" })))
      .toEqual({ ...defaultPanelState(), collapsed: { ...defaultPanelState().collapsed, services: true } });
    expect(loadPanelState(memStorage())).toEqual(defaultPanelState());
  });

  it("survives blocked or throwing storage", () => {
    const throwing: PanelStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(loadPanelState(throwing)).toEqual(defaultPanelState());
    expect(() => savePanelState(defaultPanelState(), throwing)).not.toThrow();
    expect(() => savePanelState(defaultPanelState(), null)).not.toThrow();
  });
});
