import "./ui/style.css";
import { applyTool, CityState, isFacilityTool, newCity, placeRoad, planRoad, step, ToolId } from "./sim/sim";
import { CityRenderer } from "./render/scene";
import { bindInput } from "./input";
import { Hud, RoadMode, toolColor } from "./ui/hud";
import { Pt, ROAD_NAME, RoadType, tileHeight } from "./sim/world";

const state: CityState = newCity(1337);
const app = document.getElementById("app")!;
const view = document.createElement("div");
view.className = "view";
app.appendChild(view);

const renderer = new CityRenderer(view, state);
let tool: ToolId = "road";
let speed = 1;
let roadType: RoadType = 1;
let roadMode: RoadMode = "paint";

/** Points already placed for the road being drawn (start, and the bend in curve mode). */
let draft: Pt[] = [];
let cursor: Pt | null = null;

const hud = new Hud(app, {
  onTool: (t) => {
    tool = t;
    if (t === "pan") renderer.setHover(null);
    if (t !== "road") cancelDraft();
    refreshHint();
  },
  onSpeed: (s) => { speed = s; hud.setSpeed(s); },
  onTax: (r) => { state.taxRate = r; },
  onOverlay: (layer) => renderer.setOverlay(layer),
  onRoad: (t, m) => { roadType = t; roadMode = m; cancelDraft(); refreshHint(); },
  onFinishRoad: () => cancelDraft(),
});
hud.setTool(tool);
hud.setSpeed(speed);

const placing = () => tool === "road" && roadMode !== "paint";

function cancelDraft(): void {
  draft = [];
  cursor = null;
  renderer.setRoadPreview(null);
  hud.showFinish(false);
  refreshHint();
}

function refreshHint(): void {
  if (!placing()) return;
  const name = ROAD_NAME[roadType];
  if (draft.length === 0) hud.setHint(`${name}: tap a start point (or an existing road to connect)`);
  else if (roadMode === "curve" && draft.length === 1) hud.setHint(`${name}: tap the bend point`);
  else hud.setHint(`${name}: tap the end point`);
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
  const name = ROAD_NAME[roadType];
  hud.setHint(plan.ok
    ? `${name}: ${plan.newTiles} tiles, $${plan.cost}`
    : `${name}: ${plan.reason}`);
}

function onTap(cx: number, cy: number): void {
  if (!placing()) return;
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
    hud.showToast(res.reason);
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
    if (!res.ok && res.reason !== lastToast) { hud.showToast(res.reason); lastToast = res.reason; }
    if (res.ok) lastToast = "";
  },
  hover: (cx, cy) => {
    if (tool === "pan") { renderer.setHover(null); return; }
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
  if (e.key === "Escape") cancelDraft();
});

// Fixed-step sim: 2 days/second at 1x.
let seenFires = 0;
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
  if (state.fires !== seenFires) {
    hud.showToast("Fire! A building burned down. Build a fire station.");
    seenFires = state.fires;
  }
  hud.update(state);
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug/test hook.
(window as unknown as { __city: unknown }).__city = { state, renderer, tileHeight };
