#!/usr/bin/env node
/**
 * Serve dist/ behind HTTP Basic auth (any user name, one shared password) for private remote viewing, e.g. behind a
 * Cloudflare named tunnel. The password comes from MAYOR_GATE_PASSWORD and is never stored in the repository.
 *
 *   MAYOR_GATE_PASSWORD=... node scripts/serve-gated.mjs [dir=dist] [port=8766]
 */
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";

const root = resolve(process.argv[2] ?? "dist");
const port = Number(process.argv[3] ?? 8766);
const secret = process.env.MAYOR_GATE_PASSWORD;
if (!secret) { console.error("Set MAYOR_GATE_PASSWORD"); process.exit(1); }

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
};

function authorised(header) {
  if (!header?.startsWith("Basic ")) return false;
  const given = Buffer.from(header.slice(6), "base64").toString("utf8");
  const pass = given.slice(given.indexOf(":") + 1);
  const a = Buffer.from(pass), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

createServer((req, res) => {
  if (!authorised(req.headers.authorization)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Mayor", charset="UTF-8"', "Content-Type": "text/plain" });
    res.end("Password required");
    return;
  }
  let path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error("not a file");
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    // The service worker and the shell must revalidate so a new build is picked up.
    const cache = /(?:^|\/)(sw\.js|index\.html)$/.test(path) ? "no-cache" : "public, max-age=3600";
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`gated server on http://127.0.0.1:${port} serving ${root}`));
