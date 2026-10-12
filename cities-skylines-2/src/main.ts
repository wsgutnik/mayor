import "./ui/style.css";
import "./ui/touch.css";
import { applyTool, CityState, isFacilityTool, newCity, placeRoad, planRoad, step, syncLots, ToolId } from "./sim/sim";
import { newTraffic, tickTraffic, TrafficState } from "./sim/traffic";
import { Menu } from "./ui/menu";
import { Inspector } from "./ui/inspector";
import { describeTile } from "./sim/inspect";
import { AUTOSAVE, exportFile, importFile, loadFrom, saveTo, slotInfo } from "./storage";
import { createLine, setLineVehicles, removeLine, stopAt } from "./sim/transit";
import { CityRenderer } from "./render/scene";
import type { OverlayLayer } from "./render/scene";
import { bindInput } from "./input";
import { Hud, RoadMode, toolColor } from "./ui/hud";
import { Pt, ROAD_NAME, RoadType, tileHeight, UNDERGROUND_LAYER } from "./sim/world";
import { setLang, tr, trReason, getLang } from "./i18n";
import { MapData, MapIndex } from "./sim/maps";
import { newCityFromMap } from "./sim/map-world";
import { Prefs, QUALITY_PIXEL_CAP, loadPrefs, savePrefs } from "./prefs";

let prefs: Prefs = loadPrefs();
setLang(prefs.lang);
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
  onRoad: (t, m) => { roadType = t; roadMode = m; cancelDraft(); refreshHint(); },
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
  hud.restore({ tool, speed, taxRate: state.taxRate, roadType, roadMode, tips: prefs.tips });
  cancelDraft();
  menu.raise();
  menu.refresh();
}

/** Replace the running city (load or new game); everything player-facing resets with it. */
function useCity(next: CityState): void {
  state = next;
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
const placing = () => tool === "road" || lineTool();

function cancelDraft(): void {
  draft = [];
  lineDraft = [];
  cursor = null;
  renderer.setRoadPreview(null);
  renderer.setStopMarks([]);
  hud.showFinish(false);
  hud.showCreateLine(false);
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

function updatePreview(): void {
  const seg = currentSegment();
  if (!seg) { renderer.setRoadPreview(null); return; }
  // Before the bend point is set in curve mode, show the straight guide.
  const plan = planRoad(state, roadType, seg.pts);
  renderer.setRoadPreview({ type: roadType, pts: seg.pts }, plan.ok);
  const name = tr(ROAD_NAME[roadType]);
  const spanHint = plan.span === "bridge" ? ` · ${tr("Bridge")}` : plan.span === "tunnel" ? ` · ${tr("Tunnel")}` : "";
  hud.setHint(plan.ok
    ? tr("{name}: {n} tiles, ${cost}", { name, n: plan.newTiles, cost: plan.cost }) + spanHint
    : `${name}: ${trReason(plan.reason!)}`);
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
  const raw = renderer.pickPoint(cx, cy);
  if (!raw) return;
  const p = snap(raw);
  cursor = p;
  if (draft.length === 0) {
    draft = [p];
    hud.showFinish(true);
    refreshHint();
    updatePreview();
    return;
  }
  if (roadMode === "curve" && draft.length === 1) {
    draft.push(p);
    cursor = null;
    refreshHint();
    return;
  }
  const seg = currentSegment()!;
  const res = placeRoad(state, roadType, seg.pts);
  if (res.ok) {
    // Keep drawing from the end point, like a continuous road.
    draft = [p];
    cursor = null;
    renderer.setRoadPreview(null);
    refreshHint();
  } else {
    hud.showToast(trReason(res.reason));
    updatePreview();
  }
}

let lastToast = "";
bindInput(renderer, {
  paintsWithPrimary: () => tool !== "pan" && !placing(),
  tap: (cx, cy) => onTap(cx, cy),
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
        updatePreview();
      } else if (raw) {
        const t = { x: Math.floor(raw.x), y: Math.floor(raw.z) };
        renderer.setHover(t, toolColor("road"));
      }
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
  }
});

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
