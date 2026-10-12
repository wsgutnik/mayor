import "./ui/style.css";
import { applyTool, CityState, isFacilityTool, newCity, step, ToolId } from "./sim/sim";
import { CityRenderer } from "./render/scene";
import { bindInput } from "./input";
import { Hud, toolColor } from "./ui/hud";

const state: CityState = newCity(1337);
const app = document.getElementById("app")!;
const view = document.createElement("div");
view.className = "view";
app.appendChild(view);

const renderer = new CityRenderer(view, state);
let tool: ToolId = "road";
let speed = 1;

const hud = new Hud(app, {
  onTool: (t) => { tool = t; if (t === "pan") renderer.setHover(null); },
  onSpeed: (s) => { speed = s; hud.setSpeed(s); },
  onTax: (r) => { state.taxRate = r; },
  onOverlay: (layer) => renderer.setOverlay(layer),
});
hud.setTool(tool);
hud.setSpeed(speed);

let lastToast = "";
bindInput(renderer, {
  paintsWithPrimary: () => tool !== "pan",
  paint: (tile, first) => {
    // Facilities are expensive: place one per click, never along a drag.
    if (isFacilityTool(tool) && !first) return;
    const res = applyTool(state, tool, tile.x, tile.y);
    if (!res.ok && res.reason !== lastToast) { hud.showToast(res.reason); lastToast = res.reason; }
    if (res.ok) lastToast = "";
  },
  hover: (tile) => renderer.setHover(tool === "pan" ? null : tile, toolColor(tool)),
});

// Fixed-step sim: 2 days/second at 1x.
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
  hud.update(state);
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug/test hook.
(window as unknown as { __city: unknown }).__city = { state, renderer };
