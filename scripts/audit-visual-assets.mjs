/**
 * Mayor Visual Asset Audit — read-only inspection of the built GLBs (buildings, props, vehicles, vegetation).
 * Usage: node scripts/audit-visual-assets.mjs [--strict] [--json path] [--md path]
 * Does not invoke Blender, mutate models, or touch the simulation.
 *
 * Coordinate convention (see blender/README.md): +Y up, base at y = 0, building footprint inside the unit tile
 * (|x|, |z| <= 0.5), front facing -Z in the GLB (Blender -Y).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const root = process.cwd();
const modelDir = join(root, "public/models");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? resolve(args[i + 1] || def) : null;
};
const jsonOut = flag("--json", "docs/asset-audit.json");
const mdOut = flag("--md", "docs/asset-inventory.md");

const TRI_LIMIT = Number(process.env.MAYOR_BUILDING_TRI_LIMIT || 700);
const BOUND = 0.51, HEIGHT_MAX = 2.7;
const EXPECTED = Array.from({ length: 40 }, (_, i) => String(i + 1).padStart(2, "0") + ".glb");

// Catalog metadata from src/sim/catalog.ts (TypeScript cannot be imported from plain node).
const catalogSrc = readFileSync(join(root, "src/sim/catalog.ts"), "utf8");
const catalog = new Map();
for (const m of catalogSrc.matchAll(/^\s*e\((\d+),\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)"/gm)) {
  catalog.set(Number(m[1]), { id: Number(m[1]), name: m[2], nameEn: m[3], category: m[4], group: m[5] });
}

const issues = [];
const issue = (level, asset, message) => issues.push({ level, asset, message });
const loader = new GLTFLoader();

function parse(path) {
  const b = readFileSync(path);
  const raw = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Promise((ok, fail) => loader.parse(raw, "", (g) => ok(g.scene), fail));
}

function propClass(name) {
  if (/^(car_|van|truck|semi_|bus|train)/.test(name)) return "vehicle";
  if (/^(boat_)/.test(name)) return "boat";
  if (/^(tree_|bush|rock)/.test(name)) return "vegetation";
  if (/^(pedestrian|cyclist|dog)/.test(name)) return "agent";
  return "street-furniture";
}

/** LOD bands proposed in the 2026 audit (hypotheses, not benchmarks). */
const LOD0_BANDS = { residential: [1500, 4000], commercial: [3000, 8000], industrial: [4000, 12000], civic: [8000, 20000] };

async function inspect(path, file, kind) {
  const scene = await parse(path);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let triangles = 0, vertices = 0, meshes = 0, degenerate = 0, nonFinite = 0, missingUV = 0, missingNormals = 0;
  const materials = new Map();
  const textures = new Set();
  const geomHashes = [];
  const lodNodes = [];
  scene.traverse((o) => {
    if (/lod\d/i.test(o.name || "")) lodNodes.push(o.name);
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    const p = g.getAttribute("position");
    if (!p) { issue("error", file, "Mesh without position attribute"); return; }
    vertices += p.count;
    for (let i = 0; i < p.count; i++) {
      if (!Number.isFinite(p.getX(i)) || !Number.isFinite(p.getY(i)) || !Number.isFinite(p.getZ(i))) nonFinite++;
    }
    if (!g.getAttribute("uv")) missingUV++;
    if (!g.getAttribute("normal")) missingNormals++;
    const n = g.index ? g.index.count : p.count;
    triangles += n / 3;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i + 2 < n; i += 3) {
      const ia = g.index ? g.index.getX(i) : i, ib = g.index ? g.index.getX(i + 1) : i + 1, ic = g.index ? g.index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic);
      if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-14) degenerate++;
    }
    geomHashes.push(createHash("sha1").update(Buffer.from(p.array.buffer, p.array.byteOffset, p.array.byteLength)).digest("hex").slice(0, 12));
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      materials.set(m.name || "(unnamed)", { emissive: m.emissiveIntensity > 0 && !!m.emissive && m.emissive.getHex() !== 0 });
      for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"]) {
        const t = m[k];
        if (t) textures.add(k + ":" + (t.name || t.image?.width + "x" + t.image?.height || "embedded"));
      }
    }
    box.union(new THREE.Box3().setFromObject(o));
  });
  const min = box.min.toArray().map((v) => +v.toFixed(4)), max = box.max.toArray().map((v) => +v.toFixed(4));
  const dimensions = box.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(4));
  const r = {
    file, kind, bytes: statSync(path).size, meshes, vertices, triangles, materials: [...materials.keys()].sort(),
    emissiveMaterials: [...materials].filter(([, v]) => v.emissive).map(([k]) => k).sort(),
    textures: [...textures].sort(), missingUV, missingNormals, degenerateTriangles: degenerate, nonFinite,
    bounds: { min, max, dimensions }, lodNodes, geometryHash: createHash("sha1").update(geomHashes.join(",")).digest("hex").slice(0, 12),
  };
  if (!meshes || box.isEmpty()) issue("error", file, "Empty scene");
  if (nonFinite) issue("error", file, "Non-finite coordinates: " + nonFinite);
  if (missingNormals) issue("warning", file, "Meshes without normals: " + missingNormals);
  if (missingUV && kind === "building") issue("warning", file, "Meshes without UVs: " + missingUV);
  if (degenerate) issue("warning", file, "Degenerate triangles: " + degenerate);
  return r;
}

const report = { schema: 2, expectedBuildings: 40, buildings: [], props: [], issues, catalogEntries: catalog.size };
if (!existsSync(modelDir)) {
  issue("error", "public/models", "Model directory missing");
} else {
  const available = new Set(readdirSync(modelDir).filter((f) => f.endsWith(".glb")));
  for (const f of EXPECTED) if (!available.has(f)) issue("error", f, "Required catalog GLB missing");
  for (const f of available) if (!EXPECTED.includes(f)) issue("warning", f, "GLB not registered in 01..40 catalog");
  if (catalog.size !== 40) issue("error", "src/sim/catalog.ts", `Catalog parsed ${catalog.size} entries, expected 40`);

  for (const f of EXPECTED.filter((x) => available.has(x))) {
    try {
      const r = await inspect(join(modelDir, f), f, "building");
      const id = Number(f.slice(0, 2));
      const meta = catalog.get(id);
      Object.assign(r, { id, name: meta?.nameEn ?? "?", category: meta?.category ?? "?", group: meta?.group ?? "?" });
      const { min, max } = r.bounds;
      if (min[0] < -BOUND || max[0] > BOUND || min[2] < -BOUND || max[2] > BOUND) issue("error", f, "Footprint outside the unit tile");
      if (min[1] < -0.01) issue("error", f, `Geometry below ground (y=${min[1]})`);
      if (max[1] > HEIGHT_MAX) issue("error", f, `Taller than ${HEIGHT_MAX} (y=${max[1]})`);
      if (min[1] > 0.02) issue("warning", f, `Floats above ground (y=${min[1]})`);
      if (r.triangles > TRI_LIMIT) issue("error", f, `Exceeds ${TRI_LIMIT}-triangle limit (${r.triangles})`);
      const band = LOD0_BANDS[r.group] ?? LOD0_BANDS.civic;
      r.lodReady = { hasLodNodes: r.lodNodes.length > 0, trianglesVsProposedLod0: r.triangles < band[0] ? "below" : "within" };
      report.buildings.push(r);
    } catch (e) {
      issue("error", f, "Could not parse GLB: " + String(e));
    }
  }

  const propDir = join(modelDir, "props");
  if (existsSync(propDir)) {
    for (const f of readdirSync(propDir).filter((x) => x.endsWith(".glb")).sort()) {
      try {
        const r = await inspect(join(propDir, f), "props/" + f, "prop");
        r.class = propClass(f.replace(".glb", ""));
        report.props.push(r);
      } catch (e) {
        issue("error", "props/" + f, "Could not parse GLB: " + String(e));
      }
    }
  }

  // Duplicate geometry across buildings (instancing / variant-sharing opportunities).
  const byHash = new Map();
  for (const b of [...report.buildings, ...report.props]) {
    byHash.set(b.geometryHash, [...(byHash.get(b.geometryHash) ?? []), b.file]);
  }
  report.duplicateGeometry = [...byHash.values()].filter((v) => v.length > 1);
  for (const d of report.duplicateGeometry) issue("warning", d.join(", "), "Identical geometry (duplicate asset)");
}

const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
report.summary = {
  buildingsFound: report.buildings.length, propsFound: report.props.length,
  propsByClass: Object.fromEntries(["vehicle", "boat", "vegetation", "agent", "street-furniture"].map((c) => [c, report.props.filter((p) => p.class === c).length])),
  totalBuildingTriangles: sum(report.buildings, "triangles"), totalBuildingVertices: sum(report.buildings, "vertices"),
  totalBuildingBytes: sum(report.buildings, "bytes"),
  maxBuildingTriangles: report.buildings.reduce((m, b) => Math.max(m, b.triangles), 0),
  buildingsWithLodNodes: report.buildings.filter((b) => b.lodNodes.length).length,
  buildingsWithTextures: report.buildings.filter((b) => b.textures.length).length,
  errors: issues.filter((i) => i.level === "error").length,
  warnings: issues.filter((i) => i.level === "warning").length,
};

if (jsonOut) { mkdirSync(dirname(jsonOut), { recursive: true }); writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n"); }
if (mdOut) {
  const rows = report.buildings.map((b) =>
    `| ${String(b.id).padStart(2, "0")} | ${b.name} | ${b.category} | ${b.triangles} | ${b.vertices} | ${b.materials.length} | ${b.textures.length} | ${b.bounds.dimensions.join(" × ")} | ${(b.bytes / 1024).toFixed(1)} |`);
  const props = report.props.map((p) => `| ${p.file} | ${p.class} | ${p.triangles} | ${p.materials.length} | ${(p.bytes / 1024).toFixed(1)} |`);
  mkdirSync(dirname(mdOut), { recursive: true });
  writeFileSync(mdOut, [
    "# Asset inventory (generated by scripts/audit-visual-assets.mjs)", "",
    "| ID | Building | Cat | Tris | Verts | Mats | Tex | Size (x × y × z) | KiB |", "|---|---|---|---|---|---|---|---|---|", ...rows, "",
    "## Props, vehicles, vegetation", "", "| File | Class | Tris | Mats | KiB |", "|---|---|---|---|---|", ...props, "",
  ].join("\n"));
}
console.log(JSON.stringify(report.summary, null, 2));
for (const i of issues) console.log(`[${i.level}] ${i.asset}: ${i.message}`);
if (strict && report.summary.errors) process.exitCode = 1;
