import "./ui/style.css";
import "./ui/touch.css";
import { applyTool, applyZoneAt, applyZoneBulk, bulldozeAt, CityState, FACILITY_OF_TOOL, facilityToolFootprint, findUpgradeTarget, getZoneBlocks, isFacilityTool, isFillOpenTile, newCity, placeRoad, planRoad, planRoadPair, planRoadUpgrade, previewZoneBulk, reconcileZones, setZoningMode, step, syncLots, ToolId, ToolResult, upgradeRoad, ZoneBulkTool } from "./sim/sim";
import { planFacilityPlacement } from "./sim/facilityplace";
import { History } from "./sim/history";
import { deserialize, serialize } from "./sim/save";
import { newTraffic, tickTraffic, TrafficState } from "./sim/traffic";
import { Menu } from "./ui/menu";
import { Inspector } from "./ui/inspector";
import { describeTile } from "./sim/inspect";
import { AUTOSAVE, exportFile, importFile, loadFrom, saveTo, slotInfo } from "./storage";
import { createLine, setLineVehicles, removeLine, stopAt } from "./sim/transit";
import { CityRenderer } from "./render/scene";
import type { OverlayLayer } from "./render/scene";
import { bindInput } from "./input";
import { Hud, RoadMode, RoadLevel, toolColor } from "./ui/hud";
import { cityEvents } from "./ui/events";
import { Pt, ROAD_NAME, RoadType, ZONE, heightAt, idx, rebuildRoadRaster, segmentLength, tileHeight, UNDERGROUND_LAYER } from "./sim/world";
import { formatRoadReadout, maxSlopePercent, resolveReadoutMode } from "./ui/road-readout";
import { exitAngle, loadRoadSnap, resolveRoadSnap, saveRoadSnap, snapRadiusTiles, worldPerPixel, type RoadSnapOptions, type SnapHit, type SnapTarget } from "./ui/road-snap";
import { guideAngles, resolveGuide, type RoadGuide } from "./ui/road-guides";
import { isTouchLongPress, touchDraftPoint } from "./ui/touch-road";
import { loadRoadParallel, offsetPolyline, parallelOffset, saveRoadParallel, type RoadParallelOptions } from "./ui/road-parallel";
import { cellPose, nearestCell } from "./sim/zoneblocks";
import { floodFill, rectangleTiles, ZONE_FILL_CAP, type ZoneMode, type ZoneTile } from "./ui/zone-tools";
import { diamondRamps, summarizeCrossings } from "./sim/crossings";
import { addSegment } from "./sim/roads";
import { setLang, tr, trReason, getLang } from "./i18n";
import { MapData, MapIndex } from "./sim/maps";
import { newCityFromMap } from "./sim/map-world";
import { Prefs, QUALITY_PIXEL_CAP, applyUiPrefs, loadPrefs, savePrefs } from "./prefs";

let prefs: Prefs = loadPrefs();
setLang(prefs.lang);
applyUiPrefs(prefs);
let state: CityState = newCity(1337);
// The boot city skips swapCity, so it must adopt the player's zoning model here (otherwise it stays on tile zoning).
setZoningMode(state, prefs.zoning);
/** Snapshot history of player actions (undo/redo); the simulation itself is untouched. */
const history = new History();
const app = document.getElementById("app")!;
const view = document.createElement("div");
view.className = "view";
app.appendChild(view);

const renderer = new CityRenderer(view, state);
let traffic: TrafficState = newTraffic(state.world.size);
renderer.setTraffic(traffic);
renderer.setQualityCap(QUALITY_PIXEL_CAP[prefs.quality]);
let tool: ToolId = "road";
/** Zoning shape for res/com/ind and bulldoze (zone submenu). */
let zoneMode: ZoneMode = "paint";
/** Marquee drag corners while a marquee stroke is active. */
let marqueeAnchor: ZoneTile | null = null;
let marqueeCurrent: ZoneTile | null = null;
let overlay: OverlayLayer = 0;
let speed = 1;
let roadType: RoadType = 1;
let roadMode: RoadMode = "line";
let roadLevel: RoadLevel = "ground";

/** Next road-tool tap stamps a diamond interchange instead of drawing. */
let pendingInterchange = false;
/** Points already placed for the road being drawn (start, and the bend in curve mode). */
let draft: Pt[] = [];
/** Road-draft snap options (angle / length / road), persisted across sessions. */
let snapOpts: RoadSnapOptions = loadRoadSnap();
/** Parallel-road options (toggle / gap / side), persisted across sessions. */
let parallelOpts: RoadParallelOptions = loadRoadParallel();
/** Exit direction of the last committed segment: angle snap measures from it while drawing continues. */
let lastSegDir: number | null = null;
/** Alt/Option held: all road snapping is temporarily off. */
let altDown = false;
let shiftDown = false;
let guideHold: RoadGuide | null = null;
/** Last resolved snap of the draft cursor (target, refusal) and the target held for hysteresis. */
let lastSnap: SnapHit | null = null;
let snapHold: SnapTarget | null = null;
/** Tangent of the road the draft started on: the optional angle guide measures from it. */
let startRef: number | null = null;
/** The last pointer was a finger or pen (wider snap radius) rather than a mouse. */
let touchPointer = false;
/** Last pointer position over the canvas while drafting, for re-snapping without a new event. */
let lastHover: { x: number; y: number } | null = null;
let lastSnapRadius = 0.5;
let touchTether: Pt | null = null;
let touchDrag: { id: number; down: number; moved: boolean; cancelled: boolean; timer: number } | null = null;
/** Stop ids picked so far for the transit line being built. */
let lineDraft: number[] = [];
let cursor: Pt | null = null;

function makeHud(): Hud {
  return new Hud(app, {
  onTool: (t) => {
    tool = t;
    if (t === "pan") renderer.setHover(null); else inspector.hide();
    if (t !== "road") cancelDraft();
    refreshHint();
    refreshZoneHint();
    cityEvents.emit("tool:changed");
  },
  onZoneMode: (m) => {
    zoneMode = m;
    cancelDraft();
    refreshZoneHint();
  },
  onSpeed: (s) => { speed = s; hud.setSpeed(s); cityEvents.emit("time:speed"); },
  onTax: (r) => { state.taxRate = r; },
  onOverlay: (layer) => { overlay = layer; renderer.setOverlay(layer); },
  onRoad: (t, m, lvl) => { roadType = t; roadMode = m; if (lvl) roadLevel = lvl; cancelDraft(); refreshHint(); },
  onInterchange: () => {
    tool = "road";
    cancelDraft();
    pendingInterchange = true;
    hud.setTool("road");
    hud.setHint(tr("Tap a bridge crossing to stamp an interchange"));
  },
  onFinishRoad: () => cancelDraft(),
  onHomeView: () => {
    const rig = renderer.rig;
    rig.target.set(state.world.entry.x + 8, 0, state.world.entry.y);
    rig.dist = 38; rig.pitch = 0.9; rig.yaw = Math.PI * 0.25;
    rig.apply();
  },
  onSnap: (o) => {
    snapOpts = o;
    saveRoadSnap(o);
    refreshDraftPoint();
  },
  onUpgradeMode: (on) => {
    upgradeMode = on;
    if (!on) hud.hideRoadReadout();
    refreshHint();
  },
  onParallel: (o) => {
    parallelOpts = o;
    saveRoadParallel(o);
    refreshDraftPoint();
  },
  onMenu: () => { menu.toggle(); hud.tooltip.suspend(menu.isOpen); },
  onCreateLine: () => {
    const kind = tool === "metroline" ? "metro" : tool === "trainline" ? "train" : "bus";
    const res = attempt(() => createLine(state, kind, lineDraft));
    if (res.ok) { hud.notify("success", tr("Line created")); cancelDraft(); } else hud.notify("error", trReason(res.reason));
  },
  onLineVehicles: (id, delta) => {
    const line = state.world.lines.find((l) => l.id === id);
    if (!line) return;
    const res = attempt(() => setLineVehicles(state, id, line.vehicles + delta));
    if (!res.ok) hud.notify("error", trReason(res.reason));
  },
  onRemoveLine: (id) => {
    if (!state.world.lines.some((l) => l.id === id)) return;
    history.push(serialize(state));
    removeLine(state, id);
    refreshHistoryButtons();
  },
  onUndo: () => doUndo(),
  onRedo: () => doRedo(),
  });
}
let hud = makeHud();
hud.setTool(tool);
hud.setSpeed(speed);
hud.setSnap(snapOpts, false);
hud.setParallel(parallelOpts, false);
hud.setTips(prefs.tips);
refreshHistoryButtons();

/**
 * Run a one-shot player mutation with undo support: the pre-action snapshot is
 * pushed first, and popped back off when the action reports failure.
 */
function attempt(run: () => ToolResult): ToolResult {
  history.push(serialize(state));
  const res = run();
  if (!res.ok) history.pop();
  refreshHistoryButtons();
  return res;
}

function refreshHistoryButtons(): void {
  hud.setUndoRedo(history.canUndo, history.canRedo);
}

function doUndo(): void {
  if (strokeActive) return; // never rewind history under a stroke that is still being painted
  const snap = history.undo(serialize(state));
  if (snap === null) return;
  restoreSnapshot(snap, tr("Undone"));
}

function doRedo(): void {
  if (strokeActive) return;
  const snap = history.redo(serialize(state));
  if (snap === null) return;
  restoreSnapshot(snap, tr("Redone"));
}

/** Restore a history snapshot through the same path as loading a save. Money refunds: it is inside the snapshot. */
function restoreSnapshot(snap: string, msg: string): void {
  swapCity(deserialize(snap));
  hud.showToast(msg);
  refreshHistoryButtons();
}

/** Rebuild the HUD in the current language, keeping what the player had selected. */
function rebuildHud(): void {
  hud.destroy();
  hud = makeHud();
  hud.restore({ tool, speed, taxRate: state.taxRate, roadType, roadMode, roadLevel, snap: snapOpts, parallel: parallelOpts, tips: prefs.tips, zoneMode, overlay });
  cancelDraft();
  menu.raise();
  menu.refresh();
  refreshHistoryButtons();
}

/** Replace the running city (load or new game); everything player-facing resets with it. */
function useCity(next: CityState): void {
  swapCity(next);
  history.clear();
  refreshHistoryButtons();
}

/** Swap the running city: renderer, traffic, drafts, selection and inspector all reset. Undo/redo reuse this so a restore looks exactly like a load. */
function swapCity(next: CityState): void {
  state = next;
  // The player's zoning model applies to every loaded city; switching migrates zones instead of dropping them (05 §1.8).
  setZoningMode(state, prefs.zoning);
  traffic = newTraffic(state.world.size);
  renderer.setWorld(state.world);
  renderer.setTraffic(traffic);
  cancelDraft();
  inspector.hide();
  renderer.setHover(null);
  seenFires = state.fires;
  seenPop = state.population;
  lastMonthSaved = Math.floor(state.day / 30);
  hud.onCitySwapped();
}

/** Fetch an official map and start a city on it. */
async function startMap(id: string): Promise<void> {
  try {
    const index = (await (await fetch("/maps/index.json")).json()) as MapIndex;
    const listing = index.maps.find((m) => m.id === id);
    if (!listing) throw new Error("unknown map");
    const res = await fetch(listing.data);
    if (!res.ok) throw new Error("map data missing");
    const data = (await res.json()) as MapData;
    useCity(newCityFromMap(data, listing.terrain));
    hud.showToast(getLang() === "pt" ? listing.name : listing.nameEn);
  } catch {
    hud.notify("error", tr("Could not load the map"));
  }
}

const inspector = new Inspector(app, { onClose: () => renderer.setHover(null) });

const menu = new Menu(app, {
  info: (slot) => slotInfo(slot),
  onSave: (n) => {
    const r = saveTo(String(n), state);
    hud.notify(r.ok ? "success" : "error", r.ok ? tr("Saved to slot {n}", { n }) : trReason(r.reason));
  },
  onLoad: (slot) => {
    const r = loadFrom(slot);
    if (r.ok) { useCity(r.state); hud.notify("success", tr("City loaded")); } else hud.notify("error", trReason(r.reason));
  },
  onNew: (seed, biome) => { useCity(newCity(seed, 96, biome)); hud.notify("success", tr("New city, seed {n}", { n: seed })); },
  onNewMap: (id) => { void startMap(id); },
  getPrefs: () => prefs,
  onPrefs: (p) => {
    const langChanged = p.lang !== prefs.lang;
    prefs = p;
    savePrefs(p);
    setLang(p.lang);
    applyUiPrefs(p);
    renderer.setQualityCap(QUALITY_PIXEL_CAP[p.quality]);
    hud.setTips(p.tips);
    if (langChanged) rebuildHud();
  },
  onExport: () => { exportFile(state); hud.notify("success", tr("Save file downloaded")); },
  onImport: async (file) => {
    const r = await importFile(file);
    if (r.ok) { useCity(r.state); hud.notify("success", tr("City imported")); } else hud.notify("error", trReason(r.reason));
  },
});

// Offline support: only in production builds, where the file names are stable.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
if (slotInfo(AUTOSAVE)) setTimeout(() => hud.notify("warning", tr("Autosave found: open the menu to continue")), 800);

const lineTool = () => tool === "busline" || tool === "metroline" || tool === "trainline";
const placing = () => tool === "road" || lineTool() || tool === "roundabout";

function cancelDraft(): void {
  pendingInterchange = false;
  draft = [];
  lineDraft = [];
  cursor = null;
  lastSegDir = null;
  lastHover = null;
  lastSnap = null;
  touchTether = null;
  if (touchDrag) window.clearTimeout(touchDrag.timer);
  touchDrag = null;
  snapHold = null;
  startRef = null;
  marqueeAnchor = null;
  marqueeCurrent = null;
  renderer.setZoneRect(null, null);
  renderer.setRoadPreview(null);
  renderer.setRoadGuides(null);
  renderer.setStopMarks([]);
  hud.showFinish(false);
  hud.showCreateLine(false);
  hud.hideRoadReadout();
  refreshHint();
}

/** Tap while building a transit line: pick the stop on (or next to) the tapped tile. */
function onLineTap(cx: number, cy: number): void {
  const raw = renderer.pickPoint(cx, cy);
  if (!raw) return;
  const kind = tool === "metroline" ? "metro" : tool === "trainline" ? "train" : "bus";
  const w = state.world;
  const tx = Math.floor(raw.x), ty = Math.floor(raw.z);
  let found = null;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = tx + dx, y = ty + dy;
    if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
    const st = stopAt(w, y * w.size + x);
    if (st && st.kind === kind) { found = st; break; }
  }
  if (!found) { hud.showToast(tr(kind === "bus" ? "Tap a bus stop" : kind === "train" ? "Tap a train station" : "Tap a metro station")); return; }
  if (lineDraft[lineDraft.length - 1] === found.id) return;
  lineDraft.push(found.id);
  renderer.setStopMarks(lineDraft.map((id) => w.stops.find((s) => s.id === id)!.tile),
    kind === "metro" ? "#b9a3ff" : kind === "train" ? "#ffb37a" : "#ffd84a");
  hud.showFinish(true, "Cancel");
  hud.showCreateLine(lineDraft.length >= 2);
  refreshHint();
}

function refreshHint(): void {
  if (!placing()) return;
  if (tool === "roundabout") { hud.setHint(tr("Tap a junction to stamp a roundabout")); return; }
  if (lineTool()) {
    const what = tr(tool === "metroline" ? "metro station" : tool === "trainline" ? "train station" : "bus stop");
    hud.setHint(lineDraft.length < 2
      ? tr("Tap {what}s in the order the line should run ({n} picked)", { what, n: lineDraft.length })
      : tr("{n} stops. Tap more, or Create line (the route loops)", { n: lineDraft.length }));
    return;
  }
  const name = tr(ROAD_NAME[roadType]);
  if (draft.length === 0 && upgradeMode) hud.setHint(tr("{name}: tap a road to upgrade it", { name }));
  else if (draft.length === 0) hud.setHint(tr("{name}: tap a start point (or an existing road to connect)", { name }));
  else if (roadMode === "curve" && draft.length === 1) hud.setHint(tr("{name}: tap the bend point", { name }));
  else hud.setHint(tr("{name}: tap the end point", { name }));
}

/**
 * Resolve a raw pick into the draft point: angle/length snap around the last
 * placed point (measured from the previous segment, else the map axes), then
 * road snap so connecting to existing roads still wins. Alt/Option bypasses all.
 */
function resolveDraftPoint(raw: Pt): Pt {
  if (altDown) { lastSnap = null; snapHold = null; guideHold = null; return raw; }
  const anchor = draft.length ? draft[draft.length - 1] : null;
  // Constant on-screen radius: tiles per CSS pixel at the picked ground point.
  const cam = renderer.rig.camera;
  const h = heightAt(state.world, raw.x, raw.z);
  const camTo = Math.hypot(cam.position.x - raw.x, cam.position.y - h, cam.position.z - raw.z);
  const radius = snapRadiusTiles(touchPointer, worldPerPixel(camTo, cam.fov, renderer.viewportHeight));
  lastSnapRadius = radius;
  const hit = resolveRoadSnap(state.world, raw, {
    roadType, radius, opts: snapOpts, anchor, refAngle: lastSegDir ?? startRef, prev: snapHold,
  });
  lastSnap = hit;
  snapHold = hit.target;
  // Existing node/segment attachments always win. A guide only affects free space.
  if (hit.kind === "free" && anchor && snapOpts.guides && !shiftDown) {
    const guide = resolveGuide(anchor, hit.pt, guideAngles(anchor, lastSegDir ?? startRef), radius * (touchPointer ? .5 : 1), 4, guideHold);
    guideHold = guide.guide;
    return guide.pt;
  }
  guideHold = null;
  return hit.pt;
}

/** Re-resolve the draft end from the last pointer position (snap or Alt changed mid-draft). */
function refreshDraftPoint(): void {
  if (!draft.length || !lastHover) return;
  const raw = renderer.pickPoint(lastHover.x, lastHover.y);
  if (!raw) return;
  cursor = resolveDraftPoint(raw);
  updatePreview(lastHover);
}

function currentSegment(): { pts: Pt[] } | null {
  if (!draft.length) return null;
  const end = cursor ?? draft[draft.length - 1];
  return { pts: roadMode === "curve" && draft.length === 2 ? [draft[0], draft[1], end] : [draft[0], end] };
}

function updatePreview(at?: { x: number; y: number }): void {
  const seg = currentSegment();
  if (!seg) { renderer.setRoadPreview(null); renderer.setRoadGuides(null); hud.hideRoadReadout(); return; }
  // Before the bend point is set in curve mode, show the straight guide.
  const plan = planRoad(state, roadType, seg.pts, roadLevel);
  // Parallel twin: same class, offset sideways, with its own plan and validity colour.
  const twinPts = parallelOpts.enabled ? offsetPolyline(seg.pts, parallelOffset(roadType, parallelOpts.gap), parallelOpts.side) : null;
  const twinPlan = twinPts ? planRoad(state, roadType, twinPts, roadLevel) : null;
  // Each leg only checks its own price; the pair must afford both together.
  const pairBroke = plan.ok && !!twinPlan?.ok && state.money < plan.cost + twinPlan.cost;
  const twinOk = !!twinPlan?.ok && !pairBroke;
  const twinReason = pairBroke ? "Not enough money" : twinPlan?.reason;
  const crossMarks = (plan.crossings ?? []).filter((c) => !c.atEnd || c.kind === "blocked");
  const marks: { x: number; z: number; kind: "junction" | "overpass" | "underpass" | "blocked" | "snap" }[] = [...crossMarks];
  // Snap target ghost: where the end attaches (node or centreline), red when refused.
  if (cursor && lastSnap && lastSnap.kind !== "free") marks.push({ x: cursor.x, z: cursor.z, kind: lastSnap.refused ? "blocked" : "snap" });
  renderer.setRoadPreview({ type: roadType, pts: seg.pts }, plan.ok, marks,
    twinPts ? { pts: twinPts, valid: twinOk } : null);
  const anchor = draft[draft.length - 1];
  const showGuides = tool === "road" && !!cursor && (!altDown && !shiftDown) && (snapOpts.guides || touchPointer);
  renderer.setRoadGuides(showGuides ? {
    anchor, guides: snapOpts.guides ? guideAngles(anchor, lastSegDir ?? startRef) : [], activeGuide: guideHold,
    cursor: cursor!, snapKind: lastSnap?.kind ?? "free", prevDir: lastSegDir,
    anchorPending: touchPointer, snapRadius: lastSnapRadius, tether: touchTether,
  } : null);
  const len = segmentLength(seg.pts);
  if (!at || len < 0.5) {
    hud.hideRoadReadout();
  } else {
    const slope = maxSlopePercent(seg.pts, (x, z) => heightAt(state.world, x, z));
    const mode = resolveReadoutMode(plan.span, roadLevel, plan.ok);
    hud.showRoadReadout(
      formatRoadReadout({
        cost: plan.cost, lengthTiles: len, maxSlopePct: slope, mode, ok: plan.ok, reason: plan.reason,
        ...(lastSegDir !== null ? { angleDeg: Math.abs(Math.atan2(Math.sin(Math.atan2(seg.pts.at(-1)!.z - anchor.z, seg.pts.at(-1)!.x - anchor.x) - lastSegDir), Math.cos(Math.atan2(seg.pts.at(-1)!.z - anchor.z, seg.pts.at(-1)!.x - anchor.x) - lastSegDir))) * 180 / Math.PI } : {}),
        ...(twinPlan ? { parallel: { cost: twinPlan.cost, ok: twinOk, ...(twinReason ? { reason: twinReason } : {}) } } : {}),
      }, { tr, trReason }),
      at.x, at.y,
    );
  }
  const name = tr(ROAD_NAME[roadType]);
  const spanHint = plan.span === "bridge" ? ` · ${tr("Bridge")}` : plan.span === "tunnel" ? ` · ${tr("Tunnel")}` : "";
  if (!plan.ok) { hud.setHint(`${name}: ${trReason(plan.reason!)}`); return; }
  if (twinPlan && !twinOk) { hud.setHint(`${tr("Parallel")}: ${trReason(twinReason!)}`); return; }
  const n = summarizeCrossings(crossMarks);
  const parts: string[] = [];
  if (n.overpass) parts.push(tr(n.overpass === 1 ? "{n} viaduct" : "{n} viaducts", { n: n.overpass }));
  if (n.underpass) parts.push(tr(n.underpass === 1 ? "{n} underpass" : "{n} underpasses", { n: n.underpass }));
  if (n.junction) parts.push(tr(n.junction === 1 ? "{n} crossing" : "{n} crossings", { n: n.junction }));
  const crossHint = parts.length ? ` · ${parts.join(", ")}` : "";
  const gradeHint = roadLevel !== "ground" && n.junction > 0 ? ` · ${tr("Crossing at grade")}` : "";
  const pairTiles = plan.newTiles + (twinPlan?.newTiles ?? 0);
  const pairCost = plan.cost + (twinPlan?.cost ?? 0);
  const snapHint = lastSnap?.kind === "node" ? ` · ${tr("Joins junction")}` : lastSnap?.kind === "segment" ? ` · ${tr("Joins road")}` : "";
  hud.setHint(tr("{name}: {n} tiles, ${cost}", { name, n: pairTiles, cost: pairCost }) + spanHint + crossHint + gradeHint + snapHint);
}

/** Hovering tarmac with another class chosen previews the in-place upgrade: cost and result. */
function showUpgradeReadout(raw: Pt, cx: number, cy: number): void {
  const target = findUpgradeTarget(state.world, raw.x, raw.z, roadType);
  if (!target) { hud.hideRoadReadout(); refreshHint(); return; }
  const plan = planRoadUpgrade(state, target.id, roadType);
  const elev = target.elevation ?? "ground";
  hud.showRoadReadout(
    formatRoadReadout({
      cost: plan.cost,
      lengthTiles: segmentLength(target.pts),
      maxSlopePct: maxSlopePercent(target.pts, (x, z) => heightAt(state.world, x, z)),
      mode: elev === "bridge" ? "bridge" : elev === "tunnel" ? "tunnel" : "ground",
      ok: plan.ok,
      reason: plan.reason,
    }, { tr, trReason }),
    cx, cy,
  );
  hud.setHint(plan.ok
    ? tr("Tap to upgrade to {name} (${cost})", { name: tr(ROAD_NAME[roadType]), cost: Math.round(plan.cost) })
    : trReason(plan.reason!));
}

/** Stamp diamond ramps where a deck crosses a ground road (the Trevo button's tap). */
function stampInterchangeAt(cx: number, cy: number): void {
  const raw = renderer.pickPoint(cx, cy);
  pendingInterchange = false;
  if (!raw) return;
  const w = state.world;
  const tx = Math.floor(raw.x), ty = Math.floor(raw.z);
  let tile = -1;
  for (let r = 0; r <= 2 && tile < 0; r++) {
    for (let dy = -r; dy <= r && tile < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
      const t = idx(w, x, y);
      if (w.roadDeck[t] && w.roadSurface[t]) { tile = t; break; }
    }
  }
  if (tile < 0) { hud.showToast(tr("Tap a bridge crossing to stamp an interchange")); return; }
  const deck = w.segments.find((sg) => (sg.elevation ?? "ground") === "bridge" && sg.tiles.includes(tile));
  const ground = w.segments.find((sg) => (sg.elevation ?? "ground") === "ground" && sg.tiles.includes(tile));
  if (!deck || !ground) return;
  const dirOf = (pts: Pt[]) => {
    const dx = pts[pts.length - 1].x - pts[0].x, dz = pts[pts.length - 1].z - pts[0].z;
    const l = Math.hypot(dx, dz) || 1;
    return { dx: dx / l, dz: dz / l };
  };
  const hwSeg = [deck, ground].find((sg) => sg.type === 3) ?? ground;
  const crossSeg = hwSeg === deck ? ground : deck;
  const cxp = (tile % w.size) + 0.5, czp = ((tile / w.size) | 0) + 0.5;
  const ramps = diamondRamps(cxp, czp, dirOf(hwSeg.pts), dirOf(crossSeg.pts));
  const cost = Math.round(ramps.reduce((a, r) => a + segmentLength(r), 0) * 22);
  if (state.money < cost) { hud.notify("error", trReason("Not enough money")); return; }
  history.push(serialize(state));
  for (const ramp of ramps) addSegment(w, 4, ramp);
  rebuildRoadRaster(w);
  // New ramps cover ground: zones there go, like every other road edit (05 §1.8).
  w.roadRevision++; w.zoneRevision++; w.obstacleRevision++; w.lotsDirty = true;
  reconcileZones(state);
  state.money -= cost;
  state.monthExpenses += cost;
  w.coverageDirty = true;
  w.revision++;
  refreshHistoryButtons();
  hud.notify("success", tr("Interchange"));
}

/** Move tool: a tap shows what stands on the tile. */
function inspectAt(cx: number, cy: number): void {
  const t = renderer.pick(cx, cy);
  const info = t ? describeTile(state, t.x, t.y) : null;
  if (!info || info.kind === "empty") { inspector.hide(); renderer.setHover(null); return; }
  inspector.show(info);
  renderer.setHover(t, "#ffd84a");
}

function onTap(cx: number, cy: number): void {
  if (tool === "pan") { inspectAt(cx, cy); return; }
  if (!placing()) return;
  if (lineTool()) { onLineTap(cx, cy); return; }
  if (tool === "roundabout") {
    const raw = renderer.pickPoint(cx, cy);
    if (!raw) return;
    const res = attempt(() => applyTool(state, "roundabout", Math.floor(raw.x), Math.floor(raw.z)));
    if (!res.ok) hud.showToast(trReason(res.reason));
    else cityEvents.emit("roads:changed");
    return;
  }
  if (pendingInterchange) { stampInterchangeAt(cx, cy); return; }
  const raw = renderer.pickPoint(cx, cy);
  if (!raw) return;
  if (draft.length === 0 && upgradeMode) {
    // Upgrade toggle on: a tap on tarmac of another class converts it in place (Undoable).
    const target = findUpgradeTarget(state.world, raw.x, raw.z, roadType);
    if (target) {
      const res = attempt(() => upgradeRoad(state, target.id, roadType));
      hud.hideRoadReadout();
      if (res.ok) { refreshHint(); cityEvents.emit("roads:changed"); return; }
      hud.showToast(trReason(res.reason));
      // Fall through: start a draft from the tap so connecting still works.
    }
  }
  lastHover = { x: cx, y: cy };
  const p = resolveDraftPoint(raw);
  if (lastSnap?.refused) {
    // Never bend the stroke to dodge a junction keep-out: say why and keep the draft as it was.
    hud.showToast(trReason(lastSnap.refused));
    if (draft.length) updatePreview({ x: cx, y: cy });
    return;
  }
  cursor = p;
  if (draft.length === 0) {
    startRef = lastSnap?.tangent ?? null;
    snapHold = null;
    draft = [p];
    hud.showFinish(true);
    if (touchPointer) hud.setHint(tr("Tap again to start")); else refreshHint();
    updatePreview({ x: cx, y: cy });
    return;
  }
  if (roadMode === "curve" && draft.length === 1) {
    draft.push(p);
    cursor = null;
    refreshHint();
    return;
  }
  const seg = currentSegment()!;
  // Parallel twin, committed atomically with the player's road: both legs are
  // validated first, so one tap (and one undo) always covers exactly the pair.
  const twinPts = parallelOpts.enabled ? offsetPolyline(seg.pts, parallelOffset(roadType, parallelOpts.gap), parallelOpts.side) : null;
  if (twinPts) {
    const gate = planRoadPair(state, roadType, seg.pts, twinPts, roadLevel);
    if (!gate.ok) {
      hud.showToast(trReason(gate.reason!));
      updatePreview({ x: cx, y: cy });
      return;
    }
    // Rehearse on a clone: placing the first leg must not strand the second
    // (a cusped curve could otherwise leave half a pair behind).
    const trial = deserialize(serialize(state));
    const first = placeRoad(trial, roadType, seg.pts, roadLevel);
    const second = first.ok ? placeRoad(trial, roadType, twinPts, roadLevel) : first;
    if (!second.ok) {
      hud.showToast(trReason(second.reason));
      updatePreview({ x: cx, y: cy });
      return;
    }
  }
  const res = attempt(() => {
    const r1 = placeRoad(state, roadType, seg.pts, roadLevel);
    if (!r1.ok || !twinPts) return r1;
    return placeRoad(state, roadType, twinPts, roadLevel);
  });
  if (res.ok) {
    cityEvents.emit("roads:changed");
    // Keep drawing from the end point, like a continuous road.
    lastSegDir = exitAngle(seg.pts);
    startRef = null;
    snapHold = null;
    draft = [p];
    cursor = null;
    renderer.setRoadPreview(null);
    hud.hideRoadReadout();
    refreshHint();
  } else {
    hud.showToast(trReason(res.reason));
    updatePreview({ x: cx, y: cy });
  }
}

let lastToast = "";
const ZONE_BY_TOOL = { res: ZONE.RES, com: ZONE.COM, ind: ZONE.IND } as const;
/** Tools the zoning shapes (paint/marquee/fill) apply to. */
const isZoneLike = (t: ToolId): boolean =>
  (ZONE_BY_TOOL as Record<string, number | undefined>)[t] !== undefined || t === "bulldoze";
let lastPaintCell = "";
let strokeActive = false;
/** Road flyout "Upgrade" toggle: taps on existing roads convert them instead of starting a draft. */
let upgradeMode = false;
let strokeOk = false;

function zoneDisplayName(): string {
  if (tool === "res") return tr("Residential");
  if (tool === "com") return tr("Commercial");
  if (tool === "ind") return tr("Industrial");
  return tr("Bulldoze");
}

/** Hint for the current zoning shape; with a count it reports the last fill/marquee result. */
function refreshZoneHint(count?: number, cost?: number): void {
  if (!isZoneLike(tool)) return;
  if (count !== undefined && cost !== undefined) {
    hud.setHint(tr("{name}: {n} tiles, ${cost}", { name: zoneDisplayName(), n: count, cost }));
    return;
  }
  if (zoneMode === "marquee") hud.setHint(tr(tool === "bulldoze" ? "Drag to clear a rectangle" : "Drag to zone a rectangle"));
  else if (zoneMode === "fill") hud.setHint(tr(tool === "bulldoze" ? "Tap to clear the connected zones" : "Tap to fill the connected area"));
  else hud.setTool(tool);
}

/** A paint/drag stroke is ONE history entry: push on stroke start… */
function strokeStart(): void {
  history.push(serialize(state));
  strokeActive = true;
  strokeOk = false;
  refreshHistoryButtons();
}

/** …and drop the entry when the whole stroke changed nothing. */
function strokeEnd(cancelled = false): void {
  if (cancelled && marqueeAnchor) {
    // A second finger or a system cancel aborts the rectangle instead of applying it.
    marqueeAnchor = null;
    marqueeCurrent = null;
    renderer.setZoneRect(null, null);
    refreshZoneHint();
  }
  // A marquee stroke previews while dragging and applies once on release: still one entry.
  if (strokeActive && marqueeAnchor && marqueeCurrent && isZoneLike(tool) && zoneMode === "marquee") {
    const tiles = rectangleTiles(marqueeAnchor, marqueeCurrent);
    const preview = previewZoneBulk(state, tool as ZoneBulkTool, tiles);
    const res = applyZoneBulk(state, tool as ZoneBulkTool, tiles);
    if (!res.ok) hud.showToast(trReason(res.reason));
    else if (preview.count > 0) {
      lastToast = "";
      strokeOk = true;
      refreshZoneHint(preview.count, preview.cost);
    }
    marqueeAnchor = null;
    marqueeCurrent = null;
    renderer.setZoneRect(null, null);
    if (!res.ok || preview.count === 0) refreshZoneHint();
  }
  if (!strokeActive) return;
  strokeActive = false;
  if (!strokeOk) history.pop();
  else cityEvents.emit("zones:changed");
  refreshHistoryButtons();
}

/** Marquee drag: the anchor is set on press, the rectangle follows the pointer without mutating. */
function paintMarquee(p: { x: number; z: number }, first: boolean): void {
  const t = { x: Math.floor(p.x), y: Math.floor(p.z) };
  if (first) {
    marqueeAnchor = t;
    marqueeCurrent = t;
    strokeStart();
  } else if (marqueeAnchor) {
    marqueeCurrent = t;
  } else {
    marqueeAnchor = t;
    marqueeCurrent = t;
  }
  updateMarqueePreview();
}

function updateMarqueePreview(): void {
  if (!marqueeAnchor || !marqueeCurrent) return;
  const preview = previewZoneBulk(state, tool as ZoneBulkTool, rectangleTiles(marqueeAnchor, marqueeCurrent));
  renderer.setZoneRect(marqueeAnchor, marqueeCurrent, toolColor(tool));
  hud.setHint(preview.count === 0 && preview.reason
    ? trReason(preview.reason)
    : tr("{name}: {n} tiles, ${cost}", { name: zoneDisplayName(), n: preview.count, cost: preview.cost }));
}

/** Fill tap: one connected region, one undo entry; the hint keeps the count and cost. */
function doZoneFill(t: ZoneTile): void {
  const bulkTool = tool as ZoneBulkTool;
  const w = state.world;
  const region = floodFill(t, (q) => isFillOpenTile(w, bulkTool, q.x, q.y), ZONE_FILL_CAP);
  // An empty region still names its tile so the refusal says why (road, water, …).
  const tiles = region.length ? region : [t];
  const preview = previewZoneBulk(state, bulkTool, tiles);
  if (preview.count === 0) {
    if (preview.reason) hud.showToast(trReason(preview.reason));
    return;
  }
  const res = attempt(() => applyZoneBulk(state, bulkTool, tiles));
  if (!res.ok) hud.showToast(trReason(res.reason));
  else {
    refreshZoneHint(preview.count, preview.cost);
    cityEvents.emit("zones:changed");
  }
}

/** Fill hover (desktop): live count and cost in the hint, nothing applied. */
function updateFillHint(cx: number, cy: number): void {
  const t = renderer.pick(cx, cy);
  if (!t) return;
  const bulkTool = tool as ZoneBulkTool;
  const w = state.world;
  const region = floodFill(t, (q) => isFillOpenTile(w, bulkTool, q.x, q.y), ZONE_FILL_CAP);
  const tiles = region.length ? region : [t];
  const preview = previewZoneBulk(state, bulkTool, tiles);
  hud.setHint(preview.count === 0 && preview.reason
    ? trReason(preview.reason)
    : tr("{name}: {n} tiles, ${cost}", { name: zoneDisplayName(), n: preview.count, cost: preview.cost }));
}

/** Oriented zoning paints cells under the pointer at ground-point precision (diagonal and curved streets). */
function paintGroundPoint(p: { x: number; z: number }, first: boolean): void {
  if (isZoneLike(tool) && zoneMode === "marquee") {
    paintMarquee(p, first);
    return;
  }
  if (isZoneLike(tool) && zoneMode === "fill") {
    // One region per tap, like facilities: dragging must not refill every tile.
    if (first) doZoneFill({ x: Math.floor(p.x), y: Math.floor(p.z) });
    return;
  }
  const oriented = state.world.zoning === "oriented";
  const zone = (ZONE_BY_TOOL as Record<string, number | undefined>)[tool];
  if (first) { lastPaintCell = ""; strokeStart(); }
  if (oriented && (zone !== undefined || tool === "bulldoze")) {
    const set = getZoneBlocks(state.world);
    const c = nearestCell(set, p.x, p.z, 0.75);
    const key = c ? `${c.seg}:${c.side}:${c.block}:${c.row}:${c.col}` : `t${Math.floor(p.x)},${Math.floor(p.z)}`;
    if (key === lastPaintCell) return;
    lastPaintCell = key;
    const res = tool === "bulldoze" ? bulldozeAt(state, p.x, p.z) : applyZoneAt(state, zone as 1 | 2 | 3, p.x, p.z, { radius: 0 });
    if (!res.ok && res.reason !== lastToast) { hud.showToast(trReason(res.reason)); lastToast = res.reason; }
    if (res.ok) { lastToast = ""; strokeOk = true; }
    return;
  }
  const t = { x: Math.floor(p.x), y: Math.floor(p.z) };
  const key = `t${t.x},${t.y}`;
  if (!first && key === lastPaintCell) return;
  lastPaintCell = key;
  if (isFacilityTool(tool) && !first) return;
  const res = applyTool(state, tool, t.x, t.y, roadType);
  if (!res.ok && res.reason !== lastToast) { hud.showToast(trReason(res.reason)); lastToast = res.reason; }
  if (res.ok) { lastToast = ""; strokeOk = true; }
}

// Finger/pen vs mouse decides the snap radius (36 vs 16 CSS px).
renderer.canvas.addEventListener("pointerdown", (e) => {
  touchPointer = e.pointerType !== "mouse";
  hud.dismissFlyouts();
  // A second stationary press on the anchor is a deliberate cancel. Moving it
  // becomes a preview-only drag; release never commits, preserving click-click.
  if (e.pointerType === "touch" && tool === "road" && draft.length && !pendingInterchange) {
    const d = { id: e.pointerId, down: performance.now(), moved: false, cancelled: false, timer: 0 };
    d.timer = window.setTimeout(() => {
      if (!touchDrag || touchDrag !== d || !isTouchLongPress(d.down, performance.now(), d.moved)) return;
      d.cancelled = true;
      cancelDraft();
      hud.showToast(tr("Tap again to start"));
    }, 450);
    touchDrag = d;
  }
}, { capture: true });
renderer.canvas.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") touchPointer = false; }, { capture: true });
renderer.canvas.addEventListener("pointermove", (e) => {
  const d = touchDrag;
  if (!d || d.id !== e.pointerId || d.cancelled) return;
  const dx = e.clientX - (lastHover?.x ?? e.clientX), dy = e.clientY - (lastHover?.y ?? e.clientY);
  if (Math.hypot(dx, dy) < 4 && !d.moved) return;
  d.moved = true;
  window.clearTimeout(d.timer);
  const finger = renderer.pickPoint(e.clientX, e.clientY);
  const q = touchDraftPoint({ x: e.clientX, y: e.clientY }, snapOpts.touchOffset);
  const raw = renderer.pickPoint(q.x, q.y);
  if (!raw) return;
  lastHover = q;
  touchTether = finger;
  cursor = resolveDraftPoint(raw);
  updatePreview(q);
  e.stopImmediatePropagation();
}, { capture: true });
renderer.canvas.addEventListener("pointerup", (e) => {
  const d = touchDrag;
  if (!d || d.id !== e.pointerId) return;
  window.clearTimeout(d.timer);
  touchDrag = null;
  if (d.moved || d.cancelled) {
    touchTether = null;
    e.stopImmediatePropagation();
  }
}, { capture: true });

bindInput(renderer, {
  paintsWithPrimary: () => tool !== "pan" && !placing(),
  tap: (cx, cy) => onTap(cx, cy),
  paintPoint: (p, first) => paintGroundPoint(p, first),
  paint: (tile, first) => {
    if (first) strokeStart();
    // Facilities are expensive: place one per click, never along a drag.
    if (isFacilityTool(tool) && !first) return;
    const res = applyTool(state, tool, tile.x, tile.y, roadType);
    if (!res.ok && res.reason !== lastToast) { hud.showToast(trReason(res.reason)); lastToast = res.reason; }
    if (res.ok) { lastToast = ""; strokeOk = true; }
  },
  strokeEnd: () => strokeEnd(),
  hover: (cx, cy) => {
    if (tool === "pan") { renderer.setHover(null); return; }
    if (lineTool()) { renderer.setHover(renderer.pick(cx, cy), toolColor(tool)); return; }
    if (placing()) {
      const raw = renderer.pickPoint(cx, cy);
      if (draft.length) {
        lastHover = { x: cx, y: cy };
        cursor = raw ? resolveDraftPoint(raw) : null;
        // In curve mode the preview only becomes a curve once the bend is placed.
        updatePreview({ x: cx, y: cy });
      } else if (raw) {
        const t = { x: Math.floor(raw.x), y: Math.floor(raw.z) };
        renderer.setHover(t, toolColor("road"));
        if (tool === "road" && !pendingInterchange && upgradeMode) showUpgradeReadout(raw, cx, cy);
      } else if (tool === "road" && !pendingInterchange) {
        hud.hideRoadReadout();
      }
      return;
    }
    if (isFacilityTool(tool)) {
      const t = renderer.pick(cx, cy);
      const fp = facilityToolFootprint(tool);
      const p = t ? planFacilityPlacement(state.world, FACILITY_OF_TOOL[tool], t.x + .5, t.y + .5) : null;
      renderer.setFacilityHover(p ? { cx: p.cx, cz: p.cz, yaw: p.yaw, side: fp } : null, p?.ok ? toolColor(tool) : "#e45454");
      return;
    }
    if (isZoneLike(tool) && zoneMode === "fill") updateFillHint(cx, cy);
    if (state.world.zoning === "oriented" && ((ZONE_BY_TOOL as Record<string, number | undefined>)[tool] !== undefined || tool === "bulldoze")) {
      const c = renderer.pickCell(cx, cy);
      const b = c ? (getZoneBlocks(state.world).blocks.get(`${c.seg}:${c.side}:${c.block}`)) : undefined;
      renderer.setHoverCell(c && b ? cellPose(b, c.row, c.col) : null, toolColor(tool));
      return;
    }
    const t = renderer.pick(cx, cy);
    renderer.setHover(t, toolColor(tool));
  },
});

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !isEditingText(e)) {
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
    if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); doRedo(); return; }
  }
  if (e.key === "Escape") {
    if (menu.isOpen) menu.close();
    else if (inspector.isOpen) { inspector.hide(); renderer.setHover(null); }
    else cancelDraft();
  } else if (e.key === "u" || e.key === "U") {
    overlay = overlay === UNDERGROUND_LAYER ? 0 : UNDERGROUND_LAYER;
    renderer.setOverlay(overlay);
    hud.setOverlay(overlay);
  } else if (e.key === "e" || e.key === "E") {
    if (tool === "road") { roadLevel = hud.cycleRoadLevel(); cancelDraft(); refreshHint(); }
  } else if ((e.key === "h" || e.key === "H") && !e.repeat && !isEditingText(e)) {
    hud.togglePanelsHidden();
  }
});

/** Alt/Option held temporarily disables all road snapping; the preview follows live. */
window.addEventListener("keydown", (e) => {
  if (e.key === "Alt" && !e.repeat && !altDown) { altDown = true; refreshDraftPoint(); }
  if (e.key === "Shift" && !e.repeat && !shiftDown) { shiftDown = true; refreshDraftPoint(); }
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Alt" && altDown) { altDown = false; refreshDraftPoint(); }
  if (e.key === "Shift" && shiftDown) { shiftDown = false; refreshDraftPoint(); }
});
window.addEventListener("blur", () => {
  if (altDown) { altDown = false; refreshDraftPoint(); }
  if (shiftDown) { shiftDown = false; refreshDraftPoint(); }
});

/** True while the player is typing (menu seed, save name): H must not hide panels then. */
function isEditingText(e: KeyboardEvent): boolean {
  const els = [e.target as HTMLElement | null, document.activeElement as HTMLElement | null];
  return els.some((t) => !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable));
}

// Fixed-step sim: 2 days/second at 1x.
let seenFires = 0;
let seenPop = state.population;
let lastMonthSaved = Math.floor(state.day / 30);
cityEvents.on("landmark:appeared", (d) => { if (d) hud.notify("milestone", tr("Landmark appeared"), tr("A new landmark rises at {name}.", { name: d.name })); });
/** Time of day, 0..1; a full cycle takes 90 s at 1x. */
let tod = 0.34;
let acc = 0;
let prev = performance.now();
const DAY_MS = 500;
function frame(now: number) {
  const dt = Math.min(250, now - prev);
  prev = now;
  if (speed > 0) {
    acc += dt * speed;
    while (acc >= DAY_MS) { step(state); acc -= DAY_MS; }
  }
  tickTraffic(state, traffic, (dt / 1000) * speed);
  tod = prefs.dayNight ? (tod + ((dt / 1000) * speed) / 90) % 1 : 0.45;
  renderer.setAtmosphere(tod, state.raining);
  hud.setSky(tod, state.raining);
  const month = Math.floor(state.day / 30);
  if (month !== lastMonthSaved) {
    lastMonthSaved = month;
    if (prefs.autosave) saveTo(AUTOSAVE, state);
  }
  if (state.fires !== seenFires) {
    hud.notify("warning", tr("Fire! A building burned down. Build a fire station."));
    seenFires = state.fires;
  }
  if (state.population > seenPop) {
    seenPop = state.population;
    cityEvents.emit("building:added");
  }
  hud.update(state);
  syncLots(state); // lots stay fresh for the renderer even while paused
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug/test hook.
(window as unknown as { __city: unknown }).__city = {
  get state() { return state; },
  get traffic() { return traffic; },
  renderer, tileHeight,
  setTod: (v: number) => { tod = v; },
};

// Dev-only scripted scenario (?scenario=upgrade): staged city, fixed camera, paused.
if (import.meta.env.DEV && new URLSearchParams(location.search).has("scenario")) {
  void import("./dev/scenario").then((m) => m.initScenario({
    useCity, renderer, pause: () => { speed = 0; hud.setSpeed(0); },
  }, new URLSearchParams(location.search)));
}

// Dev-only junction showcase (docs/process/junction-gate.md G1): lazy-loaded
// only when the flag is present, so normal play never pays for it.
if (import.meta.env.DEV && new URLSearchParams(location.search).get("showcase") === "1") {
  void import("./dev/showcase").then((m) => m.initShowcase({
    useCity, renderer, setTod: (v: number) => { tod = v; },
  }));
}
