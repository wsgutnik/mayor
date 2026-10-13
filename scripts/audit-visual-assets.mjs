/**
 * Mayor Visual Asset Audit — read-only inspection of built GLBs.
 * Usage: node scripts/audit-visual-assets.mjs [--strict] [--json path]
 * Does not invoke Blender, mutate models, or alter the simulation.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const root = process.cwd();
const modelDir = join(root, "public/models");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const outFlag = args.indexOf("--json");
const output = outFlag >= 0 ? resolve(args[outFlag + 1] || "docs/asset-audit.json") : null;
const loader = new GLTFLoader();
const EXPECTED = Array.from({ length: 40 }, (_, i) => String(i + 1).padStart(2, "0") + ".glb");
const issues = [];
function issue(level, asset, message) { issues.push({ level, asset, message }); }
function parse(file) {
  const b = readFileSync(file);
  const raw = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Promise((ok, fail) => loader.parse(raw, "", gltf => ok(gltf.scene), fail));
}
const report = { schema: 1, expectedBuildings: 40, buildings: [], props: [], issues };
if (!existsSync(modelDir)) {
  issue("error", "public/models", "Model directory missing");
} else {
  const available = new Set(readdirSync(modelDir).filter(f => f.endsWith(".glb")));
  for (const file of EXPECTED) if (!available.has(file)) issue("error", file, "Required catalog GLB missing");
  for (const file of available) if (!EXPECTED.includes(file)) issue("warning", file, "GLB not registered in 01..40 catalog");
  const assets = [
    ...EXPECTED.filter(f => available.has(f)).map(f => ({ file, path: join(modelDir, f), kind: "building" })),
    ...(existsSync(join(modelDir, "props")) ? readdirSync(join(modelDir, "props")).filter(f => f.endsWith(".glb")).map(f => ({ file: "props/" + f, path: join(modelDir, "props", f), kind: "prop" })) : []),
  ];
  for (const asset of assets) {
    try {
      const scene = await parse(asset.path);
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3();
      let triangles = 0, meshes = 0, materials = new Set(), missingUV = 0, nonFinite = 0;
      scene.traverse(obj => {
        if (!obj.isMesh) return;
        meshes++;
        const geo = obj.geometry;
        const p = geo?.getAttribute("position");
        if (!p) { issue("error", asset.file, "Mesh without position attribute"); return; }
        for (let i = 0; i < p.count; i++) if (![p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)) nonFinite++;
        if (!geo.getAttribute("uv")) missingUV++;
        triangles += (geo.index ? geo.index.count : p.count) / 3;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) if (mat) materials.add(mat.name || "(unnamed)");
        const b = new THREE.Box3().setFromObject(obj);
        box.union(b);
      });
      const min = box.min.toArray(), max = box.max.toArray();
      const dimensions = box.getSize(new THREE.Vector3()).toArray();
      const result = { name: asset.file, bytes: statSync(asset.path).size, meshes, triangles, materials: [...materials].sort(), missingUV, nonFinite, bounds: { min, max, dimensions } };
      if (!meshes || box.isEmpty()) issue("error", asset.file, "Empty scene");
      if (nonFinite) issue("error", asset.file, "Non-finite coordinates: " + nonFinite);
      if (missingUV) issue("warning", asset.file, "Meshes without UVs: " + missingUV);
      if (asset.kind === "building") {
        if (min[0] < -0.51 || max[0] > 0.51 || min[2] < -0.51 || max[2] > 0.51 || min[1] < -0.01 || max[1] > 2.7) issue("error", asset.file, "Outside existing building tile bounds");
        if (triangles > 450) issue("error", asset.file, "Exceeds current 450-triangle limit");
        report.buildings.push(result);
      } else report.props.push(result);
    } catch (e) {
      issue("error", asset.file, "Could not parse GLB: " + String(e));
    }
  }
}
report.summary = {
  buildingsFound: report.buildings.length, propsFound: report.props.length,
  totalBuildingTriangles: report.buildings.reduce((s, a) => s + a.triangles, 0),
  errors: issues.filter(i => i.level === "error").length,
  warnings: issues.filter(i => i.level === "warning").length,
};
if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify(report.summary, null, 2));
for (const i of issues) console.log(`[${i.level}] ${i.asset}: ${i.message}`);
if (strict && report.summary.errors) process.exitCode = 1;
