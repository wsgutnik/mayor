// node tileshot.mjs out.png [cssW cssH dpr cols rows] — capture in clipped tiles at full device resolution and stitch.
import { writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [out, W = 1376, H = 1032, D = 2, C = 4, R = 2] = process.argv.slice(2);
const w = +W, h = +H, dpr = +D, cols = +C, rows = +R;
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const t = setTimeout(() => { console.log("timeout"); process.exit(2); }, 240000);
await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
await new Promise((r) => setTimeout(r, 3500));
const tiles = [];
const tw = w / cols, th = h / rows;
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const clip = { x: c * tw, y: r * th, width: tw, height: th, scale: 1 };
  const res = await send("Page.captureScreenshot", { format: "png", clip });
  if (!res.result) { console.log(JSON.stringify(res)); process.exit(1); }
  const p = `${out}.t${r}_${c}.png`;
  writeFileSync(p, Buffer.from(res.result.data, "base64"));
  tiles.push([p, Math.round(c * tw * dpr), Math.round(r * th * dpr)]);
}
clearTimeout(t);
execFileSync("python3", ["-c", `
import sys, json
from PIL import Image
tiles=json.loads(sys.argv[1]); W,H=int(sys.argv[2]),int(sys.argv[3])
o=Image.new('RGB',(W,H))
for p,x,y in tiles: o.paste(Image.open(p).convert('RGB'),(x,y))
o.save(sys.argv[4]); print(o.size)
`, JSON.stringify(tiles), String(w * dpr), String(h * dpr), out], { stdio: "inherit" });
for (const [p] of tiles) unlinkSync(p);
process.exit(0);
