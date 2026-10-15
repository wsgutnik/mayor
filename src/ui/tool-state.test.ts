import { describe, expect, it } from "vitest";
import { getLang, hasTranslation, setLang, tr } from "../i18n";
import {
  checkToolState, hintFor, initialToolState, reduceTool, renderHint, type ToolEvent, type ToolState,
} from "./tool-state";

/** Run a sequence of events from a state, asserting the invariants after every step. */
function run(start: ToolState, events: ToolEvent[]): ToolState {
  let s = start;
  for (const e of events) {
    s = reduceTool(s, e).state;
    expect(checkToolState(s), JSON.stringify({ e, s })).toEqual([]);
  }
  return s;
}

const drafting = (): ToolState => run(initialToolState(), [{ kind: "group", flyout: "road" }, { kind: "mapDown" }, { kind: "draftPoint" }]);

describe("tool state: road flyout picks", () => {
  it("picking a road class keeps the draft, re-plans it and closes the flyout", () => {
    const s0 = run(drafting(), [{ kind: "group", flyout: "road" }]);
    expect(s0.flyout).toBe("road");
    expect(s0.draft).toBe(1);
    const { state, fx } = reduceTool(s0, { kind: "roadType", roadType: 2 });
    expect(state.roadType).toBe(2);
    expect(state.draft).toBe(1);
    expect(state.flyout).toBeNull();
    expect(fx).toMatchObject({ clearDraft: false, replan: true, trimDraft: false });
    expect(hintFor(state)).toEqual({ key: "{name}: tap the end point", name: "Avenue" });
  });

  it("switching curve to line after the bend trims the draft back to its start", () => {
    const s = run(initialToolState(), [{ kind: "roadMode", mode: "curve" }, { kind: "draftPoint" }, { kind: "draftPoint" }]);
    expect(s.draft).toBe(2);
    expect(hintFor(s)).toEqual({ key: "{name}: tap the end point", name: "Street" });
    const { state, fx } = reduceTool(s, { kind: "roadMode", mode: "line" });
    expect(state.draft).toBe(1);
    expect(fx).toMatchObject({ trimDraft: true, replan: true, clearDraft: false });
    // A third point never appears in line mode.
    expect(run(state, [{ kind: "draftPoint" }]).draft).toBe(1);
  });

  it("level pick and the E key change the level in place; E is ignored off the road tool", () => {
    const s = run(drafting(), [{ kind: "roadLevel", level: "elevated" }]);
    expect(s.roadLevel).toBe("elevated");
    expect(s.draft).toBe(1);
    expect(run(s, [{ kind: "cycleLevel" }]).roadLevel).toBe("tunnel");
    expect(run(s, [{ kind: "cycleLevel" }, { kind: "cycleLevel" }]).roadLevel).toBe("ground");
    const pan = run(s, [{ kind: "tool", tool: "pan" }]);
    expect(reduceTool(pan, { kind: "cycleLevel" }).state).toBe(pan);
  });

  it("a road pick from the roundabout tool returns to the road tool", () => {
    const s = run(initialToolState(), [{ kind: "group", flyout: "road" }, { kind: "tool", tool: "roundabout" }]);
    expect(s.tool).toBe("roundabout");
    expect(s.flyout).toBeNull();
    expect(hintFor(s)).toEqual({ key: "Tap a junction to stamp a roundabout" });
    const { state, fx } = reduceTool(s, { kind: "roadType", roadType: 3 });
    expect(state.tool).toBe("road");
    expect(state.roadType).toBe(3);
    expect(fx.toolChanged).toBe(true);
  });
});

describe("tool state: upgrade and interchange", () => {
  it("upgrade toggles keep the flyout open and only report upgradeOff on the way down", () => {
    const s = run(initialToolState(), [{ kind: "group", flyout: "road" }]);
    const on = reduceTool(s, { kind: "upgrade", on: true });
    expect(on.state.upgradeMode).toBe(true);
    expect(on.state.flyout).toBe("road");
    expect(on.fx.upgradeOff).toBe(false);
    expect(hintFor(on.state)).toEqual({ key: "{name}: tap a road to upgrade it", name: "Street" });
    const off = reduceTool(on.state, { kind: "upgrade", on: false });
    expect(off.fx.upgradeOff).toBe(true);
    expect(hintFor(off.state)).toEqual({ key: "{name}: tap a start point (or an existing road to connect)", name: "Street" });
  });

  it("upgrade mode survives a tool round trip but a draft takes the normal hint", () => {
    const s = run(initialToolState(), [{ kind: "upgrade", on: true }, { kind: "tool", tool: "res" }, { kind: "group", flyout: "road" }]);
    expect(s.upgradeMode).toBe(true);
    expect(s.tool).toBe("road");
    expect(run(s, [{ kind: "mapDown" }, { kind: "draftPoint" }]).draft).toBe(1);
    expect(hintFor(run(s, [{ kind: "draftPoint" }]))).toEqual({ key: "{name}: tap the end point", name: "Street" });
  });

  it("interchange arms the stamp, drops the draft, closes the flyout and disarms once used", () => {
    const { state, fx } = reduceTool(run(drafting(), [{ kind: "group", flyout: "road" }]), { kind: "interchange" });
    expect(state).toMatchObject({ tool: "road", pendingInterchange: true, draft: 0, flyout: null });
    expect(fx.clearDraft).toBe(true);
    expect(hintFor(state)).toEqual({ key: "Tap a bridge crossing to stamp an interchange" });
    // Taps while armed never start a draft.
    expect(reduceTool(state, { kind: "draftPoint" }).state.draft).toBe(0);
    const done = reduceTool(state, { kind: "interchangeDone" }).state;
    expect(done.pendingInterchange).toBe(false);
    expect(hintFor(done)).toEqual({ key: "{name}: tap a start point (or an existing road to connect)", name: "Street" });
  });

  it("interchange from another tool lands on the road tool; a later class pick disarms it", () => {
    const armed = run(initialToolState(), [{ kind: "tool", tool: "pan" }, { kind: "interchange" }]);
    expect(armed.tool).toBe("road");
    expect(armed.pendingInterchange).toBe(true);
    const picked = reduceTool(armed, { kind: "roadType", roadType: 2 });
    expect(picked.state.pendingInterchange).toBe(false);
    expect(picked.fx.clearDraft).toBe(true);
    expect(run(armed, [{ kind: "cycleLevel" }]).pendingInterchange).toBe(false);
  });
});

describe("tool state: switching tools and going back", () => {
  it("the Roads button mid-draft opens the flyout and keeps the draft", () => {
    const { state, fx } = reduceTool(drafting(), { kind: "group", flyout: "road" });
    expect(state.flyout).toBe("road");
    expect(state.draft).toBe(1);
    expect(fx.clearDraft).toBe(false);
    expect(reduceTool(state, { kind: "group", flyout: "road" }).state.flyout).toBeNull();
  });

  it("Move and back to Roads drops the draft exactly once and restores the start hint", () => {
    const pan = reduceTool(drafting(), { kind: "tool", tool: "pan" });
    expect(pan.state).toMatchObject({ tool: "pan", draft: 0, flyout: null });
    expect(pan.fx).toMatchObject({ clearDraft: true, toolChanged: true });
    expect(hintFor(pan.state)).toBeNull();
    const back = reduceTool(pan.state, { kind: "group", flyout: "road" });
    expect(back.state).toMatchObject({ tool: "road", draft: 0, flyout: "road" });
    expect(back.fx.toolChanged).toBe(true);
    expect(hintFor(back.state)).toEqual({ key: "{name}: tap a start point (or an existing road to connect)", name: "Street" });
  });

  it("re-selecting the active tool is a no-op apart from closing the flyout", () => {
    const s = run(drafting(), [{ kind: "group", flyout: "road" }]);
    const { state, fx } = reduceTool(s, { kind: "tool", tool: "road" });
    expect(state).toEqual({ ...s, flyout: null });
    expect(fx).toMatchObject({ clearDraft: false, toolChanged: false });
  });

  it("a facility or zone pick from a flyout closes it and lights its group", () => {
    const s = run(initialToolState(), [{ kind: "group", flyout: "services" }, { kind: "tool", tool: "school" }]);
    expect(s).toMatchObject({ tool: "school", flyout: null });
    const z = run(s, [{ kind: "group", flyout: "zones" }]);
    expect(z).toMatchObject({ tool: "res", flyout: "zones" });
    expect(run(z, [{ kind: "tool", tool: "com" }])).toMatchObject({ tool: "com", flyout: null });
  });

  it("zone shape from another tool takes Residential; with Bulldoze it keeps Bulldoze", () => {
    const s = run(initialToolState(), [{ kind: "zoneMode", mode: "marquee" }]);
    expect(s).toMatchObject({ tool: "res", zoneMode: "marquee", flyout: null });
    expect(hintFor(s)).toEqual({ key: "Drag to zone a rectangle" });
    const b = run(initialToolState(), [{ kind: "tool", tool: "bulldoze" }, { kind: "zoneMode", mode: "fill" }]);
    expect(b.tool).toBe("bulldoze");
    expect(hintFor(b)).toEqual({ key: "Tap to clear the connected zones" });
    expect(hintFor(run(b, [{ kind: "zoneMode", mode: "paint" }]))).toBeNull();
  });
});

describe("tool state: map taps, cancel, undo and lines", () => {
  it("a map pointer-down only closes the open flyout", () => {
    const s = run(initialToolState(), [{ kind: "group", flyout: "services" }]);
    const { state, fx } = reduceTool(s, { kind: "mapDown" });
    expect(state).toEqual({ ...s, flyout: null });
    expect(fx).toMatchObject({ clearDraft: false, toolChanged: false });
    expect(reduceTool(state, { kind: "mapDown" }).state).toBe(state);
  });

  it("cancel (Escape, Finish, touch long-press) and undo/redo drop the draft but keep the selection", () => {
    const s = run(drafting(), [{ kind: "roadType", roadType: 5 }, { kind: "roadLevel", level: "tunnel" }, { kind: "upgrade", on: true }]);
    for (const kind of ["cancel", "citySwapped"] as const) {
      const { state, fx } = reduceTool(s, { kind });
      expect(state).toMatchObject({ tool: "road", draft: 0, roadType: 5, roadLevel: "tunnel", upgradeMode: true });
      expect(fx.clearDraft).toBe(true);
    }
  });

  it("commit keeps drawing from the end point", () => {
    const s = run(drafting(), [{ kind: "draftCommit" }]);
    expect(s.draft).toBe(1);
    expect(hintFor(s)).toEqual({ key: "{name}: tap the end point", name: "Street" });
  });

  it("line drafts count stops and the hint follows", () => {
    const s = run(initialToolState(), [{ kind: "tool", tool: "metroline" }, { kind: "lineStop", count: 1 }]);
    expect(hintFor(s)).toEqual({ key: "Tap {what}s in the order the line should run ({n} picked)", what: "metro station", n: 1 });
    const two = run(s, [{ kind: "lineStop", count: 2 }]);
    expect(hintFor(two)).toEqual({ key: "{n} stops. Tap more, or Create line (the route loops)", n: 2 });
    expect(run(two, [{ kind: "tool", tool: "busline" }]).lineStops).toBe(0);
    expect(reduceTool(initialToolState(), { kind: "lineStop", count: 3 }).state.lineStops).toBe(0);
  });
});

describe("tool state: hints", () => {
  it("render translates the road name and the stop kind in both languages", () => {
    const prev = getLang();
    try {
      setLang("en");
      expect(renderHint({ key: "{name}: tap the end point", name: "Avenue" }, tr)).toBe("Avenue: tap the end point");
      setLang("pt");
      expect(renderHint({ key: "{name}: tap the end point", name: "Avenue" }, tr)).toBe("Avenida: toque no ponto final");
      expect(renderHint({ key: "Tap {what}s in the order the line should run ({n} picked)", what: "bus stop", n: 0 }, tr))
        .toBe("Toque nos ponto de ônibus na ordem da linha (0 escolhidos)");
    } finally { setLang(prev); }
  });

  it("every hint key has a pt-BR translation", () => {
    const states: ToolState[] = [
      initialToolState(),
      run(initialToolState(), [{ kind: "upgrade", on: true }]),
      run(initialToolState(), [{ kind: "interchange" }]),
      run(initialToolState(), [{ kind: "draftPoint" }]),
      run(initialToolState(), [{ kind: "roadMode", mode: "curve" }, { kind: "draftPoint" }]),
      run(initialToolState(), [{ kind: "tool", tool: "roundabout" }]),
      run(initialToolState(), [{ kind: "tool", tool: "busline" }]),
      run(initialToolState(), [{ kind: "tool", tool: "trainline" }, { kind: "lineStop", count: 2 }]),
      run(initialToolState(), [{ kind: "zoneMode", mode: "marquee" }]),
      run(initialToolState(), [{ kind: "zoneMode", mode: "fill" }]),
      run(initialToolState(), [{ kind: "tool", tool: "bulldoze" }, { kind: "zoneMode", mode: "marquee" }]),
      run(initialToolState(), [{ kind: "tool", tool: "bulldoze" }, { kind: "zoneMode", mode: "fill" }]),
    ];
    for (const s of states) {
      const h = hintFor(s);
      expect(h, JSON.stringify(s)).not.toBeNull();
      expect(hasTranslation(h!.key), h!.key).toBe(true);
      if (h!.name) expect(hasTranslation(h!.name), h!.name).toBe(true);
      if (h!.what) expect(hasTranslation(h!.what), h!.what).toBe(true);
    }
  });
});

describe("tool state: random walks never break an invariant", () => {
  const EVENTS: ToolEvent[] = [
    { kind: "tool", tool: "pan" }, { kind: "tool", tool: "road" }, { kind: "tool", tool: "res" }, { kind: "tool", tool: "bulldoze" },
    { kind: "tool", tool: "roundabout" }, { kind: "tool", tool: "busline" }, { kind: "tool", tool: "school" }, { kind: "tool", tool: "metro" },
    { kind: "group", flyout: "road" }, { kind: "group", flyout: "zones" }, { kind: "group", flyout: "services" }, { kind: "group", flyout: "transit" }, { kind: "group", flyout: "view" },
    { kind: "roadType", roadType: 1 }, { kind: "roadType", roadType: 3 }, { kind: "roadMode", mode: "curve" }, { kind: "roadMode", mode: "line" },
    { kind: "roadLevel", level: "elevated" }, { kind: "cycleLevel" }, { kind: "upgrade", on: true }, { kind: "upgrade", on: false },
    { kind: "interchange" }, { kind: "interchangeDone" }, { kind: "zoneMode", mode: "fill" }, { kind: "zoneMode", mode: "paint" },
    { kind: "mapDown" }, { kind: "closeFlyouts" }, { kind: "draftPoint" }, { kind: "draftCommit" }, { kind: "lineStop", count: 2 },
    { kind: "cancel" }, { kind: "citySwapped" },
  ];

  it("holds over 20,000 seeded transitions and effects agree with the state change", () => {
    let seed = 1234567;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    let s = initialToolState();
    for (let i = 0; i < 20_000; i++) {
      const e = EVENTS[rnd() % EVENTS.length];
      const { state, fx } = reduceTool(s, e);
      expect(checkToolState(state), JSON.stringify({ i, e, state })).toEqual([]);
      // A draft that disappears must have asked the host to clear its geometry, and trimming only happens 2 -> 1.
      if (s.draft > 0 && state.draft === 0) expect(fx.clearDraft, JSON.stringify({ e, s })).toBe(true);
      if (fx.trimDraft) expect([s.draft, state.draft]).toEqual([2, 1]);
      if (state.tool !== s.tool) expect(fx.toolChanged, JSON.stringify({ e, s })).toBe(true);
      if (fx.upgradeOff) expect([s.upgradeMode, state.upgradeMode]).toEqual([true, false]);
      s = state;
    }
  });
});
