// Usage: node cdp.mjs <cmd> [arg]
//   nav <url> [w h dpr]   navigate the first page target, set device metrics
//   eval <js-file|expr>   evaluate (awaitPromise) and print JSON
//   shot <out.png>        capture a PNG at the emulated size
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [cmd, arg, ...rest] = process.argv.slice(2);
const list = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

if (cmd === "nav") {
  const [w = 1376, h = 1032, dpr = 2] = rest.map(Number);
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  await send("Page.navigate", { url: arg });
  console.log("ok");
} else if (cmd === "click") {
  const x = +arg, y = +rest[0];
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, pointerType: "mouse" });
    await new Promise((r) => setTimeout(r, 60));
  }
  console.log("clicked", x, y);
} else if (cmd === "metrics") {
  const [w, h, dpr] = [arg, ...rest].map(Number);
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  console.log("ok");
} else if (cmd === "js") {
  const expr = existsSync(arg) ? readFileSync(arg, "utf8") : arg;
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout: 600000 });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r, null, 1));
} else if (cmd === "shot") {
  const [w = 1376, h = 1032, dpr = 2, wait = 2500] = rest.map(Number);
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  await send("Page.bringToFront");
  await new Promise((r) => setTimeout(r, wait));
  const keep = setInterval(() => {}, 1000);
  const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  clearInterval(keep);
  if (!r.result) { console.log(JSON.stringify(r)); process.exit(1); }
  writeFileSync(arg, Buffer.from(r.result.data, "base64"));
  console.log("saved", arg);
}
ws.close();
process.exit(0);
