import "./ui/style.css";
import "./ui/touch.css";
import { applyTool, applyZoneAt, bulldozeAt, CityState, getZoneBlocks, isFacilityTool, newCity, placeRoad, planRoad, step, syncLots, ToolId } from "./sim/sim";
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
import { Pt, ROAD_NAME, RoadType, ZONE, heightAt, idx, rebuildRoadRaster, segmentLength, tileHeight, UNDERGROUND_LAYER } from "./sim/world";
import { formatRoadReadout, maxSlopePercent, resolveReadoutMode } from "./ui/road-readout";
import { cellPose, nearestCell } from "./sim/zoneblocks";
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
const app = document.getElementById("app")!;
const view = document.createElement("div");
view.className = "view";
app.appendChild(view);

const renderer = new CityRenderer(view, state);
let traffic: TrafficState = newTraffic(state.world.size);
renderer.setTraffic(traffic);
renderer.setQualityCap(QUALITY_PIXEL_CAP[prefs.quality]);
let tool: ToolId = "road";
let overlay: OverlayLayer = 0;
let speed = 1;
let roadType: RoadType = 1;
let roadMode: RoadMode = "line";
let roadLevel: RoadLevel = "ground";

/** Next road-tool tap stamps a diamond interchange instead of drawing. */
let pendingInterchange = false;
/** Points already placed for the road being drawn (start, and the bend in curve mode). */
let draft: Pt[] = [];
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
  },
  onSpeed: (s) => { speed = s; hud.setSpeed(s); },
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
  onMenu: () => menu.toggle(),
  onCreateLine: () => {
    const kind = tool === "metroline" ? "metro" : "bus";
    const res = createLine(state, kind, lineDraft);
    if (res.ok) { hud.showToast(tr("Line created")); cancelDraft(); } else hud.showToast(trReason(res.reason));
  },
  onLineVehicles: (id, delta) => {
    const line = state.world.lines.find((l) => l.id === id);
    if (!line) return;
    const res = setLineVehicles(state, id, line.vehicles + delta);
    if (!res.ok) hud.showToast(trReason(res.reason));
  },
  onRemoveLine: (id) => removeLine(state, id),
  });
}
let hud = makeHud();
hud.setTool(tool);
hud.setSpeed(speed);
hud.setTips(prefs.tips);

/** Rebuild the HUD in the current language, keeping what the player had selected. */
function rebuildHud(): void {
  hud.destroy();
  hud = makeHud();
  hud.restore({ tool, speed, taxRate: state.taxRate, roadType, roadMode, roadLevel, tips: prefs.tips });
  cancelDraft();
  menu.raise();
  menu.refresh();
}

/** Replace the running city (load or new game); everything player-facing resets with it. */
function useCity(next: CityState): void {
  state = next;
  state.world.zoning = prefs.zoning;   // the oriented model is opt-in until the cutover (docs/process/05-oriented-lots.md)
  traffic = newTraffic(state.world.size);
  renderer.setWorld(state.world);
  renderer.setTraffic(traffic);
  cancelDraft();
  seenFires = state.fires;
  lastMonthSaved = Math.floor(state.day / 30);
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
    hud.showToast(tr("Could not load the map"));
  }
}

const inspector = new Inspector(app, { onClose: () => renderer.setHover(null) });

const menu = new Menu(app, {
  info: (slot) => slotInfo(slot),
  onSave: (n) => {
    const r = saveTo(String(n), state);
    hud.showToast(r.ok ? tr("Saved to slot {n}", { n }) : trReason(r.reason));
  },
  onLoad: (slot) => {
    const r = loadFrom(slot);
    if (r.ok) { useCity(r.state); hud.showToast(tr("City loaded")); } else hud.showToast(trReason(r.reason));
  },
  onNew: (seed, biome) => { useCity(newCity(seed, 96, biome)); hud.showToast(tr("New city, seed {n}", { n: seed })); },
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
  onExport: () => { exportFile(state); hud.showToast(tr("Save file downloaded")); },
  onImport: async (file) => {
    const r = await importFile(file);
    if (r.ok) { useCity(r.state); hud.showToast(tr("City imported")); } else hud.showToast(trReason(r.reason));
  },
});

// Offline support: only in production builds, where the file names are stable.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
if (slotInfo(AUTOSAVE)) setTimeout(() => hud.showToast(tr("Autosave found: open the menu to continue")), 800);

const lineTool = () => tool === "busline" || tool === "metroline";
const placing = () => tool === "road" || lineTool() || tool === "roundabout";

function cancelDraft(): void {
  pendingInterchange = false;
  draft = [];
  lineDraft = [];
  cursor = null;
  renderer.setRoadPreview(null);
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
  const kind = tool === "metroline" ? "metro" : "bus";
  const w = state.world;
  const tx = Math.floor(raw.x), ty = Math.floor(raw.z);
  let found = null;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = tx + dx, y = ty + dy;
    if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
    const st = stopAt(w, y * w.size + x);
    if (st && st.kind === kind) { found = st; break; }
  }
  if (!found) { hud.showToast(tr(kind === "bus" ? "Tap a bus stop" : "Tap a metro station")); return; }
  if (lineDraft[lineDraft.length - 1] === found.id) return;
  lineDraft.push(found.id);
  renderer.setStopMarks(lineDraft.map((id) => w.stops.find((s) => s.id === id)!.tile),
    kind === "metro" ? "#b9a3ff" : "#ffd84a");
  hud.showFinish(true, "Cancel");
  hud.showCreateLine(lineDraft.length >= 2);
  refreshHint();
}

function refreshHint(): void {
  if (!placing()) return;
  if (tool === "roundabout") { hud.setHint(tr("Tap a junction to stamp a roundabout")); return; }
  if (lineTool()) {
    const what = tr(tool === "metroline" ? "metro station" : "bus stop");
    hud.setHint(lineDraft.length < 2
      ? tr("Tap {what}s in the order the line should run ({n} picked)", { what, n: lineDraft.length })
      : tr("{n} stops. Tap more, or Create line (the route loops)", { n: lineDraft.length }));
    return;
  }
  const name = tr(ROAD_NAME[roadType]);
  if (draft.length === 0) hud.setHint(tr("{name}: tap a start point (or an existing road to connect)", { name }));
  else if (roadMode === "curve" && draft.length === 1) hud.setHint(tr("{name}: tap the bend point", { name }));
  else hud.setHint(tr("{name}: tap the end point", { name }));
}

/** Snap to the centre of an existing road tile so new roads connect cleanly. */
function snap(p: Pt): Pt {
  const x = Math.floor(p.x), y = Math.floor(p.z);
  if (state.world.road[y * state.world.size + x]) return { x: x + 0.5, z: y + 0.5 };
  return p;
}

function currentSegment(): { pts: Pt[] } | null {
  if (!draft.length) return null;
  const end = cursor ?? draft[draft.length - 1];
  return { pts: roadMode === "curve" && draft.length === 2 ? [draft[0], draft[1], end] : [draft[0], end] };
}

function updatePreview(at?: { x: number; y: number }): void {
  const seg = currentSegment();
  if (!seg) { renderer.setRoadPreview(null); hud.hideRoadReadout(); return; }
  // Before the bend point is set in curve mode, show the straight guide.
  const plan = planRoad(state, roadType, seg.pts, roadLevel);
  const marks = (plan.crossings ?? []).filter((c) => !c.atEnd || c.kind === "blocked");
  renderer.setRoadPreview({ type: roadType, pts: seg.pts }, plan.ok, marks);
  const len = segmentLength(seg.pts);
  if (!at || len < 0.5) {
    hud.hideRoadReadout();
  } else {
    const slope = maxSlopePercent(seg.pts, (x, z) => heightAt(state.world, x, z));
    const mode = resolveReadoutMode(plan.span, roadLevel, plan.ok);
    hud.showRoadReadout(
      formatRoadReadout({ cost: plan.cost, lengthTiles: len, maxSlopePct: slope, mode, ok: plan.ok, reason: plan.reason }, { tr, trReason }),
      at.x, at.y,
    );
  }
  const name = tr(ROAD_NAME[roadType]);
  const spanHint = plan.span === "bridge" ? ` · ${tr("Bridge")}` : plan.span === "tunnel" ? ` · ${tr("Tunnel")}` : "";
  if (!plan.ok) { hud.setHint(`${name}: ${trReason(plan.reason!)}`); return; }
  const n = summarizeCrossings(marks);
  const parts: string[] = [];
  if (n.overpass) parts.push(tr(n.overpass === 1 ? "{n} viaduct" : "{n} viaducts", { n: n.overpass }));
  if (n.underpass) parts.push(tr(n.underpass === 1 ? "{n} underpass" : "{n} underpasses", { n: n.underpass }));
  if (n.junction) parts.push(tr(n.junction === 1 ? "{n} crossing" : "{n} crossings", { n: n.junction }));
  const crossHint = parts.length ? ` · ${parts.join(", ")}` : "";
  const gradeHint = roadLevel !== "ground" && n.junction > 0 ? ` · ${tr("Crossing at grade")}` : "";
  hud.setHint(tr("{name}: {n} tiles, ${cost}", { name, n: plan.newTiles, cost: plan.cost }) + spanHint + crossHint + gradeHint);
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
  if (state.money < cost) { hud.showToast(trReason("Not enough money")); return; }
  for (const ramp of ramps) addSegment(w, 4, ramp);
  rebuildRoadRaster(w);
  state.money -= cost;
  state.monthExpenses += cost;
  w.coverageDirty = true;
  w.revision++;
  hud.showToast(tr("Interchange"));
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
    const res = applyTool(state, "roundabout", Math.floor(raw.x), Math.floor(raw.z));
    if (!res.ok) hud.showToast(trReason(res.reason));
    return;
  }
  if (pendingInterchange) { stampInterchangeAt(cx, cy); return; }
  const raw = renderer.pickPoint(cx, cy);
  if (!raw) return;
  const p = snap(raw);
  cursor = p;
  if (draft.length === 0) {
    draft = [p];
    hud.showFinish(true);
    refreshHint();
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
  const res = placeRoad(state, roadType, seg.pts, roadLevel);
  if (res.ok) {
    // Keep drawing from the end point, like a continuous road.
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
let lastPaintCell = "";

/** Oriented zoning paints cells under the pointer at ground-point precision (diagonal and curved streets). */
function paintGroundPoint(p: { x: number; z: number }, first: boolean): void {
  const oriented = state.world.zoning === "oriented";
  const zone = (ZONE_BY_TOOL as Record<string, number | undefined>)[tool];
  if (first) lastPaintCell = "";
  if (oriented && (zone !== undefined || tool === "bulldoze")) {
    const set = getZoneBlocks(state.world);
    const c = nearestCell(set, p.x, p.z, 0.75);
    const key = c ? `${c.seg}:${c.side}:${c.block}:${c.row}:${c.col}` : `t${Math.floor(p.x)},${Math.floor(p.z)}`;
    if (key === lastPaintCell) return;
    lastPaintCell = key;
    const res = tool === "bulldoze" ? bulldozeAt(state, p.x, p.z) : applyZoneAt(state, zone as 1 | 2 | 3, p.x, p.z, { radius: 0 });
    if (!res.ok && res.reason !== lastToast) { hud.showToast(trReason(res.reason)); lastToast = res.reason; }
    if (res.ok) lastToast = "";
    return;
  }
  const t = { x: Math.floor(p.x), y: Math.floor(p.z) };
  const key = `t${t.x},${t.y}`;
  if (!first && key === lastPaintCell) return;
  lastPaintCell = key;
  if (isFacilityTool(tool) && !first) return;
  const res = applyTool(state, tool, t.x, t.y, roadType);
  if (!res.ok && res.reason !== lastToast) { hud.showToast(trReason(res.reason)); lastToast = res.reason; }
  if (res.ok) lastToast = "";
}

bindInput(renderer, {
  paintsWithPrimary: () => tool !== "pan" && !placing(),
  tap: (cx, cy) => onTap(cx, cy),
  paintPoint: (p, first) => paintGroundPoint(p, first),
  paint: (tile, first) => {
    // Facilities are expensive: place one per click, never along a drag.
    if (isFacilityTool(tool) && !first) return;
    const res = applyTool(state, tool, tile.x, tile.y, roadType);
    if (!res.ok && res.reason !== lastToast) { hud.showToast(trReason(res.reason)); lastToast = res.reason; }
    if (res.ok) lastToast = "";
  },
  hover: (cx, cy) => {
    if (tool === "pan") { renderer.setHover(null); return; }
    if (lineTool()) { renderer.setHover(renderer.pick(cx, cy), toolColor(tool)); return; }
    if (placing()) {
      const raw = renderer.pickPoint(cx, cy);
      if (draft.length) {
        cursor = raw ? snap(raw) : null;
        // In curve mode the preview only becomes a curve once the bend is placed.
        updatePreview({ x: cx, y: cy });
      } else if (raw) {
        const t = { x: Math.floor(raw.x), y: Math.floor(raw.z) };
        renderer.setHover(t, toolColor("road"));
      }
      return;
    }
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

/** True while the player is typing (menu seed, save name): H must not hide panels then. */
function isEditingText(e: KeyboardEvent): boolean {
  const els = [e.target as HTMLElement | null, document.activeElement as HTMLElement | null];
  return els.some((t) => !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable));
}

// Fixed-step sim: 2 days/second at 1x.
let seenFires = 0;
let lastMonthSaved = Math.floor(state.day / 30);
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
    hud.showToast(tr("Fire! A building burned down. Build a fire station."));
    seenFires = state.fires;
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
