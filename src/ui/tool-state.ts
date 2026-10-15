/**
 * Tool and menu state machine for the HUD (docs/process/25-tool-state.md).
 *
 * One pure reducer owns everything the toolbar, the flyouts and the map-tap handlers used to keep in separate
 * variables: the active tool, the road class / drawing mode / level, the Upgrade and Interchange modes, how many
 * draft points are placed, the open flyout and the zoning shape. `main.ts` dispatches `ToolEvent`s through
 * `reduceTool` and applies the returned `ToolEffects`; `hud.ts` only renders a `ToolState` and emits events.
 * Nothing here touches the DOM, the renderer or the city, so every transition is unit-tested.
 *
 * Flyout rule (applied everywhere): choosing a tool or a road / zone selection closes the flyout; the option
 * groups (Snap, Parallel, Upgrade) keep it open; any pointer-down on the map closes it.
 */
import type { ToolId } from "../sim/sim";
import { ROAD_NAME, type RoadType } from "../sim/world";
import type { ZoneMode } from "./zone-tools";

export type RoadMode = "line" | "curve";
export type RoadLevel = "ground" | "elevated" | "tunnel";
export type FlyoutId = "road" | "zones" | "services" | "transit" | "view";

export const ROAD_LEVEL_ORDER: readonly RoadLevel[] = ["ground", "elevated", "tunnel"];

export interface ToolState {
  tool: ToolId;
  roadType: RoadType;
  roadMode: RoadMode;
  roadLevel: RoadLevel;
  /** Road flyout "Upgrade road" toggle: taps on existing roads convert them instead of starting a draft. */
  upgradeMode: boolean;
  /** Next road-tool tap stamps a diamond interchange instead of drawing. */
  pendingInterchange: boolean;
  /** Points placed for the road being drawn: 0 none, 1 start, 2 start and bend (curve mode only). */
  draft: 0 | 1 | 2;
  /** Stops picked so far for the transit line being built. */
  lineStops: number;
  flyout: FlyoutId | null;
  zoneMode: ZoneMode;
}

export const LINE_TOOLS: readonly ToolId[] = ["busline", "metroline", "trainline"];
export const ZONE_TOOLS: readonly ToolId[] = ["res", "com", "ind"];
export const isLineTool = (t: ToolId): boolean => LINE_TOOLS.includes(t);
/** Tools the zoning shapes (paint / marquee / fill) apply to. */
export const isZoneLikeTool = (t: ToolId): boolean => ZONE_TOOLS.includes(t) || t === "bulldoze";
/** Tools that live in the Roads flyout, so the Roads toolbar button stays lit for them. */
export const isRoadGroupTool = (t: ToolId): boolean => t === "road" || t === "roundabout";

export function initialToolState(): ToolState {
  return {
    tool: "road", roadType: 1, roadMode: "line", roadLevel: "ground",
    upgradeMode: false, pendingInterchange: false, draft: 0, lineStops: 0, flyout: null, zoneMode: "paint",
  };
}

export type ToolEvent =
  /** A tool button (toolbar or inside a flyout). */
  | { kind: "tool"; tool: ToolId }
  /** A toolbar group button: toggles its flyout. */
  | { kind: "group"; flyout: FlyoutId }
  | { kind: "roadType"; roadType: RoadType }
  | { kind: "roadMode"; mode: RoadMode }
  | { kind: "roadLevel"; level: RoadLevel }
  /** Keyboard E: ground -> elevated -> tunnel. */
  | { kind: "cycleLevel" }
  | { kind: "upgrade"; on: boolean }
  /** The Interchange button: arm the stamp for the next map tap. */
  | { kind: "interchange" }
  /** The stamp was attempted (placed or refused): disarm. */
  | { kind: "interchangeDone" }
  | { kind: "zoneMode"; mode: ZoneMode }
  /** Pointer down on the map: every flyout closes so it never hides the work. */
  | { kind: "mapDown" }
  | { kind: "closeFlyouts" }
  /** A draft point was placed (start, or the bend in curve mode). */
  | { kind: "draftPoint" }
  /** A segment was built; drawing continues from its end point. */
  | { kind: "draftCommit" }
  | { kind: "lineStop"; count: number }
  /** Escape, the Finish button, a touch long-press, a created line: drop drafts and armed stamps. */
  | { kind: "cancel" }
  /** Load, new game, undo or redo replaced the city. */
  | { kind: "citySwapped" };

export interface ToolEffects {
  /** Draft geometry (preview, guides, stop marks, readout, buttons) must be dropped. */
  clearDraft: boolean;
  /** Keep only the first draft point (curve -> line with the bend already placed). */
  trimDraft: boolean;
  /** Re-plan the live preview with the new class / level (the draft is kept). */
  replan: boolean;
  /** The active tool changed: hide the inspector, clear ghosts, notify listeners. */
  toolChanged: boolean;
  /** Upgrade mode was switched off: the upgrade readout goes away. */
  upgradeOff: boolean;
}

const NO_FX: ToolEffects = { clearDraft: false, trimDraft: false, replan: false, toolChanged: false, upgradeOff: false };

/** Everything a tool switch drops: the road draft, the line draft and an armed interchange. */
function dropWork(s: ToolState): ToolState {
  return { ...s, draft: 0, lineStops: 0, pendingInterchange: false };
}

/** Select `tool`, closing the flyout it was picked from and dropping work that belongs to another tool. */
function selectTool(s: ToolState, tool: ToolId, flyout: FlyoutId | null = null): { state: ToolState; fx: ToolEffects } {
  if (tool === s.tool) return { state: { ...s, flyout }, fx: NO_FX };
  const state: ToolState = { ...dropWork(s), tool, flyout };
  return { state, fx: { ...NO_FX, clearDraft: true, toolChanged: true } };
}

/** Road class / mode / level picks always land on the road tool (the roundabout tool shares the flyout). */
function onRoadTool(s: ToolState): { state: ToolState; fx: ToolEffects } {
  if (s.tool === "road") return { state: { ...s, pendingInterchange: false }, fx: { ...NO_FX, clearDraft: s.pendingInterchange } };
  return selectTool(s, "road");
}

export function reduceTool(s: ToolState, e: ToolEvent): { state: ToolState; fx: ToolEffects } {
  switch (e.kind) {
    case "tool":
      return selectTool(s, e.tool);
    case "group": {
      const flyout = s.flyout === e.flyout ? null : e.flyout;
      // Opening Roads arms the road tool (a draft in progress is kept); opening Zones takes Residential unless a
      // zoning tool is already active. Services, Transit and Infoview only show their choices.
      if (e.flyout === "road" && !isRoadGroupTool(s.tool)) return selectTool(s, "road", flyout);
      if (e.flyout === "zones" && !isZoneLikeTool(s.tool)) return selectTool(s, "res", flyout);
      return { state: { ...s, flyout }, fx: NO_FX };
    }
    case "roadType": {
      const r = onRoadTool(s);
      return { state: { ...r.state, roadType: e.roadType, flyout: null }, fx: { ...r.fx, replan: r.state.draft > 0 } };
    }
    case "roadMode": {
      const r = onRoadTool(s);
      const trim = e.mode === "line" && r.state.draft === 2;
      const draft = trim ? 1 : r.state.draft;
      return { state: { ...r.state, roadMode: e.mode, draft, flyout: null }, fx: { ...r.fx, trimDraft: trim, replan: draft > 0 } };
    }
    case "roadLevel": {
      const r = onRoadTool(s);
      return { state: { ...r.state, roadLevel: e.level, flyout: null }, fx: { ...r.fx, replan: r.state.draft > 0 } };
    }
    case "cycleLevel": {
      if (s.tool !== "road") return { state: s, fx: NO_FX };
      const level = ROAD_LEVEL_ORDER[(ROAD_LEVEL_ORDER.indexOf(s.roadLevel) + 1) % ROAD_LEVEL_ORDER.length];
      return { state: { ...s, roadLevel: level, pendingInterchange: false }, fx: { ...NO_FX, replan: s.draft > 0, clearDraft: s.pendingInterchange } };
    }
    case "upgrade": {
      const r = onRoadTool(s);
      return { state: { ...r.state, upgradeMode: e.on }, fx: { ...r.fx, upgradeOff: !e.on && s.upgradeMode } };
    }
    case "interchange": {
      const base = s.tool === "road" ? s : selectTool(s, "road").state;
      return {
        state: { ...dropWork(base), pendingInterchange: true, flyout: null },
        fx: { ...NO_FX, clearDraft: true, toolChanged: s.tool !== "road" },
      };
    }
    case "interchangeDone":
      return { state: { ...s, pendingInterchange: false }, fx: NO_FX };
    case "zoneMode": {
      const r = isZoneLikeTool(s.tool) ? { state: s, fx: NO_FX } : selectTool(s, "res");
      return { state: { ...r.state, zoneMode: e.mode, flyout: null }, fx: r.fx };
    }
    case "mapDown":
    case "closeFlyouts":
      return { state: s.flyout === null ? s : { ...s, flyout: null }, fx: NO_FX };
    case "draftPoint": {
      if (s.tool !== "road" || s.pendingInterchange) return { state: s, fx: NO_FX };
      const draft = s.draft === 0 ? 1 : s.roadMode === "curve" ? 2 : s.draft;
      return { state: { ...s, draft }, fx: NO_FX };
    }
    case "draftCommit":
      if (s.tool !== "road") return { state: s, fx: NO_FX };
      return { state: { ...s, draft: 1 }, fx: NO_FX };
    case "lineStop":
      if (!isLineTool(s.tool)) return { state: s, fx: NO_FX };
      return { state: { ...s, lineStops: Math.max(0, e.count) }, fx: NO_FX };
    case "cancel":
    case "citySwapped":
      return { state: dropWork(s), fx: { ...NO_FX, clearDraft: true } };
  }
}

/** A hint the HUD renders: `key` is the i18n key, `name`/`what` are i18n keys themselves, `n` is a count. */
export interface Hint { key: string; name?: string; what?: string; n?: number }

/**
 * The resting hint for the state (hover previews overwrite it transiently and dispatch restores it).
 * `null` means "the tool's own description" (facilities, bulldoze paint, pan): the HUD has those strings.
 */
export function hintFor(s: ToolState): Hint | null {
  const t = s.tool;
  if (t === "roundabout") return { key: "Tap a junction to stamp a roundabout" };
  if (isLineTool(t)) {
    const what = t === "metroline" ? "metro station" : t === "trainline" ? "train station" : "bus stop";
    return s.lineStops < 2
      ? { key: "Tap {what}s in the order the line should run ({n} picked)", what, n: s.lineStops }
      : { key: "{n} stops. Tap more, or Create line (the route loops)", n: s.lineStops };
  }
  if (isZoneLikeTool(t)) {
    const clear = t === "bulldoze";
    if (s.zoneMode === "marquee") return { key: clear ? "Drag to clear a rectangle" : "Drag to zone a rectangle" };
    if (s.zoneMode === "fill") return { key: clear ? "Tap to clear the connected zones" : "Tap to fill the connected area" };
    return null;
  }
  if (t !== "road") return null;
  if (s.pendingInterchange) return { key: "Tap a bridge crossing to stamp an interchange" };
  const name = ROAD_NAME[s.roadType];
  if (s.draft === 0 && s.upgradeMode) return { key: "{name}: tap a road to upgrade it", name };
  if (s.draft === 0) return { key: "{name}: tap a start point (or an existing road to connect)", name };
  if (s.roadMode === "curve" && s.draft === 1) return { key: "{name}: tap the bend point", name };
  return { key: "{name}: tap the end point", name };
}

/** Translate a hint with the app's `tr`; `name` and `what` are translated before substitution. */
export function renderHint(h: Hint, tr: (key: string, vars?: Record<string, string | number>) => string): string {
  const vars: Record<string, string | number> = {};
  if (h.name !== undefined) vars.name = tr(h.name);
  if (h.what !== undefined) vars.what = tr(h.what);
  if (h.n !== undefined) vars.n = h.n;
  return tr(h.key, vars);
}

/** Invariants every reachable state must satisfy; tests walk random event sequences through this. */
export function checkToolState(s: ToolState): string[] {
  const bad: string[] = [];
  if (s.draft > 0 && s.tool !== "road") bad.push(`draft ${s.draft} with tool ${s.tool}`);
  if (s.draft === 2 && s.roadMode !== "curve") bad.push("two draft points outside curve mode");
  if (s.pendingInterchange && s.tool !== "road") bad.push(`interchange armed with tool ${s.tool}`);
  if (s.pendingInterchange && s.draft > 0) bad.push("interchange armed during a draft");
  if (s.lineStops > 0 && !isLineTool(s.tool)) bad.push(`${s.lineStops} line stops with tool ${s.tool}`);
  if (s.flyout === "road" && !isRoadGroupTool(s.tool)) bad.push(`road flyout open with tool ${s.tool}`);
  if (s.flyout === "zones" && !isZoneLikeTool(s.tool)) bad.push(`zones flyout open with tool ${s.tool}`);
  return bad;
}
