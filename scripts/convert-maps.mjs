#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bakeHeights, bakeMask, decodePng, encodePng, pickEntry } from "./lib/heightmap.mjs";

const maps = [
  ["01_Baia_Metropolitana", "baia-metropolitana"],
  ["02_Vale_Verde", "vale-verde"],
  ["03_Arquipelago_Azul", "arquipelago-azul"],
  ["04_Planicie_Central", "planicie-central"],
];
const args = process.argv.slice(2);
let source = "/tmp/mapkit-extract/MAYOR_Map_Kit";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--src" && args[i + 1]) source = args[++i];
  else throw new Error(`Usage: node scripts/convert-maps.mjs [--src DIR]`);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public/maps");

function toB64(bytes) { return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64"); }
function packHeights(heights) {
  const bytes = Buffer.alloc(heights.length * 2);
  for (let i = 0; i < heights.length; i++) bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(heights[i] * 100))), i * 2);
  return bytes.toString("base64");
}
function areaDownscale(image, targetWidth) {
  const targetHeight = Math.round(image.height * targetWidth / image.width);
  const out = new Uint8Array(targetWidth * targetHeight * image.channels);
  for (let oy = 0; oy < targetHeight; oy++) for (let ox = 0; ox < targetWidth; ox++) {
    const x0 = ox * image.width / targetWidth, x1 = (ox + 1) * image.width / targetWidth;
    const y0 = oy * image.height / targetHeight, y1 = (oy + 1) * image.height / targetHeight;
    const totals = new Float64Array(image.channels); let area = 0;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
      const weight = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
      for (let c = 0; c < image.channels; c++) totals[c] += image.data[(sy * image.width + sx) * image.channels + c] * weight;
      area += weight;
    }
    for (let c = 0; c < image.channels; c++) out[(oy * targetWidth + ox) * image.channels + c] = Math.round(totals[c] / area);
  }
  return { width: targetWidth, height: targetHeight, channels: image.channels, data: out };
}

for (const [folder, id] of maps) {
  const dir = path.join(source, folder);
  const metadata = JSON.parse(await readFile(path.join(dir, "map.json"), "utf8"));
  const heightmap = decodePng(await readFile(path.join(dir, "heightmap_16bit.png")));
  const waterSource = decodePng(await readFile(path.join(dir, "water_mask.png")));
  const buildableSource = decodePng(await readFile(path.join(dir, "buildable_mask.png")));
  const heights = bakeHeights(heightmap, 128, metadata.sea_level_normalized);
  const water = bakeMask(waterSource, 128);
  const buildable = bakeMask(buildableSource, 128);
  const entry = pickEntry(heights, buildable, 128);
  const data = { id, size: 128, heightsB64: packHeights(heights), waterB64: toB64(water), buildableB64: toB64(buildable), entry, seaLevel: metadata.sea_level_normalized };
  await writeFile(path.join(output, `${id}.json`), JSON.stringify(data) + "\n");
  const preview = areaDownscale(decodePng(await readFile(path.join(dir, "terrain_preview.png"))), 480);
  await writeFile(path.join(output, `${id}.png`), encodePng(preview));
  const percent = mask => (mask.reduce((sum, value) => sum + value, 0) / mask.length * 100).toFixed(1);
  console.log(`${id}: entry ${entry.x},${entry.y},${entry.dx},${entry.dy}; water ${percent(water)}%; buildable ${percent(buildable)}%`);
}

const indexPath = path.join(output, "index.json");
const index = JSON.parse(await readFile(indexPath, "utf8"));
for (const entry of index.maps) entry.preview = entry.preview.replace(/\.jpg$/, ".png");
await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n");
