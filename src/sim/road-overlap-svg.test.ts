/**
 * Opt-in SVG dumps of the overlap hard cases (OVL_SVG=<dir> npx vitest run src/sim/road-overlap-svg.test.ts).
 * Schematic top view: sidewalk band, asphalt + kerb band and centreline per segment, zoned cells, nodes.
 * "before" panels add the stroke through the graph directly (what placeRoad did on main); "after" panels go through
 * placeRoad and print its verdict.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CityState, applyZoneAt, getZoneBlocks, newCity, placeRoad, syncLots } from "./sim";
import { addSegment } from "./roads";
import { profileOf } from "./corridor";
import { Pt, RoadType, ZONE, cidx, curvePoints, segElevation } from "./world";
import { cellCorners, cellIndex } from "./zoneblocks";
import { CELL_DEPTH } from "./zonecells";

const OUT = process.env.OVL_SVG;

function flatCity(): CityState {
  const s = newCity(7, 64);
  for (let y = 0; y <= 64; y++) for (let x = 0; x <= 64; x++) s.world.heights[cidx(s.world, Math.min(x, 63), Math.min(y, 63))] = 0.35;
  s.money = 1e8;
  s.world.zoning = "oriented";
  return s;
}

function svg(s: CityState, title: string, box: [number, number, number, number]): string {
  const [x0, z0, x1, z1] = box, W = 640, k = W / (x1 - x0), H = Math.round((z1 - z0) * k);
  const P = (p: Pt) => `${((p.x - x0) * k).toFixed(1)},${((p.z - z0) * k).toFixed(1)}`;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 28}" viewBox="0 0 ${W} ${H + 28}">`,
    `<rect width="${W}" height="${H + 28}" fill="#eef0e6"/>`];
  const set = getZoneBlocks(s.world);
  const c = new Float32Array(8);
  for (const b of set.blocks.values()) for (let r = 0; r < b.rows; r++) for (let col = 0; col < CELL_DEPTH; col++) {
    const i = cellIndex(r, col);
    if (!b.valid[i]) continue;
    cellCorners(b, r, col, c);
    const pts = [0, 1, 2, 3].map((e) => P({ x: c[e * 2], z: c[e * 2 + 1] })).join(" ");
    out.push(`<polygon points="${pts}" fill="${b.zone[i] ? "#7bc47f" : "none"}" stroke="#9aa58f" stroke-width="0.6"/>`);
  }
  const segs = [...s.world.segments].sort((a, b) => (segElevation(a) === "bridge" ? 1 : 0) - (segElevation(b) === "bridge" ? 1 : 0));
  for (const g of segs) {
    const p = profileOf(g.type), line = curvePoints(g.pts, 0.25).map(P).join(" ");
    const deck = segElevation(g) === "bridge";
    out.push(`<polyline points="${line}" fill="none" stroke="${deck ? "#b9a27a" : "#c9c9c2"}" stroke-opacity="0.85" stroke-width="${(2 * (p.drawHalf + p.sidewalk) * k).toFixed(1)}"/>`);
    out.push(`<polyline points="${line}" fill="none" stroke="${deck ? "#6b5a3e" : "#3b3f46"}" stroke-opacity="0.8" stroke-width="${(2 * p.drawHalf * k).toFixed(1)}"/>`);
    out.push(`<polyline points="${line}" fill="none" stroke="#f3d34a" stroke-width="1.2" stroke-dasharray="6 6"/>`);
  }
  for (const n of s.world.nodes) {
    const q = P(n).split(",");
    out.push(`<circle cx="${q[0]}" cy="${q[1]}" r="3" fill="#d33"/>`);
  }
  out.push(`<text x="8" y="${H + 19}" font-family="sans-serif" font-size="14" fill="#222">${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`);
  out.push("</svg>");
  return out.join("\n");
}

interface Case { name: string; base: [RoadType, Pt[], ("ground" | "elevated")?][]; stroke: [RoadType, Pt[], ("ground" | "elevated")?]; box: [number, number, number, number]; zone?: boolean }

const P = (x: number, z: number): Pt => ({ x, z });
const rise = Math.tan((3 * Math.PI) / 180) * 30;
const y25 = (25 * Math.PI) / 180;
const cases: Case[] = [
  { name: "collinear", base: [[1, [P(15, 20), P(35, 20)]]], stroke: [1, [P(25, 20), P(45, 20)]], box: [12, 14, 48, 26] },
  { name: "rotated-copy", base: [[1, [P(15, 20), P(35, 20)]]], stroke: [1, [P(16, 19.75), P(34, 20.3)]], box: [12, 14, 38, 26] },
  { name: "sliver-3deg", base: [[1, [P(10, 20), P(50, 20)]]], stroke: [1, [P(15, 20 - rise / 2), P(45, 20 + rise / 2)]], box: [8, 14, 52, 26] },
  { name: "parallel-0.3", base: [[1, [P(10, 20), P(40, 20)]]], stroke: [1, [P(14, 20.3), P(36, 20.3)]], box: [8, 15, 42, 25] },
  { name: "cap-on-side", base: [[1, [P(10, 20), P(30, 20)]]], stroke: [1, [P(20, 10), P(20, 19.2)]], box: [8, 8, 32, 26] },
  { name: "avenue-over-street", base: [[1, [P(10, 20), P(30, 20)]], [1, [P(20, 20), P(20, 10)]]], stroke: [5, [P(10, 20), P(30, 20)]], box: [8, 8, 32, 26] },
  { name: "zoned-crossing", base: [[1, [P(10, 20), P(50, 20)]]], stroke: [1, [P(30, 8), P(30, 32)]], box: [20, 10, 40, 30], zone: true },
  { name: "y-25deg", base: [[1, [P(10, 20), P(30, 20)]], [1, [P(30, 20), P(50, 20)]]], stroke: [1, [P(30, 20), P(30 + Math.cos(y25) * 15, 20 + Math.sin(y25) * 15)]], box: [18, 12, 48, 30] },
  { name: "through-junction", base: [[1, [P(10, 20), P(40, 20)]], [1, [P(25, 8), P(25, 20)]]], stroke: [1, [P(17, 12), P(33, 28)]], box: [12, 6, 38, 30] },
  { name: "curve-cross", base: [[2, [P(10, 20), P(50, 20)]]], stroke: [1, [P(22, 8), P(36, 18), P(34, 32)]], box: [16, 6, 42, 34] },
  { name: "bridge-30deg", base: [[1, [P(10, 30), P(50, 30)]]], stroke: [1, [P(30 - Math.cos(Math.PI / 6) * 10, 25), P(30 + Math.cos(Math.PI / 6) * 10, 35)], "elevated"], box: [16, 22, 44, 38] },
];

describe.skipIf(!OUT)("overlap SVG dumps", () => {
  it("writes before/after panels", () => {
    fs.mkdirSync(OUT!, { recursive: true });
    for (const c of cases) {
      for (const mode of ["before", "after"] as const) {
        const s = flatCity();
        for (const [t, pts, lv] of c.base) expect(placeRoad(s, t, pts, lv ?? "ground").ok).toBe(true);
        if (c.zone) {
          for (let x = 11; x < 50; x += 0.5) for (const z of [19, 18, 21, 22]) applyZoneAt(s, ZONE.RES, x, z);
          syncLots(s);
        }
        let verdict: string;
        if (mode === "before" && c.stroke[2] !== "elevated") {
          addSegment(s.world, c.stroke[0], c.stroke[1].map((p) => ({ ...p })));
          verdict = "graph accepts it (main)";
        } else {
          const r = placeRoad(s, c.stroke[0], c.stroke[1], c.stroke[2] ?? "ground");
          verdict = r.ok ? "placed" : `refused: ${r.reason}`;
        }
        syncLots(s);
        fs.writeFileSync(`${OUT}/${c.name}-${mode}.svg`, svg(s, `${c.name} ${mode}: ${verdict}`, c.box));
      }
    }
  });
});
