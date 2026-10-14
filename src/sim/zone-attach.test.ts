/**
 * Zone attachment diagnostics (docs/process/05-oriented-lots.md §1.4-§1.5, "zoned cells touch their road").
 *
 * Builds the hard cases (the owner's Y fork, a curve, an acute 25 degree Y, a T and a bend), bulk-paints residential
 * over each and measures, per zoneable road side:
 *  - cover: fraction of frontage stations with free space where a zoned cell sits right behind the sidewalk;
 *  - gap: max distance (tiles) from the setback line to the first zoned cell on those stations;
 *  - misassigned: zoned cells another road's setback line is nearer to by more than 0.5 tile than their owner's;
 *  - intrude: zoned cells with a (7 % shrunk) sample inside any road footprint (drawHalf + sidewalk) or junction
 *    sidewalk polygon;
 *  - lotLot: lot overlaps (checkLots).
 * Set ZATTACH_SVG=<dir> to write an SVG dump per scene.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyZoneBulk, getZoneBlocks, newCity, placeRoad, syncLots } from "./sim";
import { deserialize, serialize } from "./save";
import { buildZoneBlocks } from "./zoneblocks";
import { cidx, curvePoints, segElevation, baseRoadType, type Pt } from "./world";
import { profileOf } from "./corridor";
import { junctionsOf } from "./junction";
import { cellCorners, cellIndex } from "./zoneblocks";
import { checkLots, lotCorners } from "./orientedlots";
import { CELL_DEPTH, type ZoneBlock } from "./zonecells";

type City = ReturnType<typeof newCity>;
const P = (x: number, y: number): Pt => ({ x, z: y });

interface Scene { name: string; city: City; paint: { x0: number; x1: number; y0: number; y1: number } }

function city(flat?: { x0: number; x1: number; y0: number; y1: number }): City {
  const f = newCity(1337, 96);
  const w = f.world;
  w.zoning = "oriented";
  f.money = 1e9;
  const r = flat ?? { x0: 0, x1: w.size, y0: 0, y1: w.size };
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) w.heights[cidx(w, x, y)] = 0.35;
  return f;
}

function road(f: City, pts: Pt[]): void {
  const r = placeRoad(f, 1, pts);
  if (!r.ok) throw new Error(`placeRoad failed: ${r.reason}`);
}

function paint(s: Scene): void {
  const t: { x: number; y: number }[] = [];
  for (let y = s.paint.y0; y <= s.paint.y1; y++) for (let x = s.paint.x0; x <= s.paint.x1; x++) t.push({ x, y });
  const r = applyZoneBulk(s.city, "res", t);
  if (!r.ok) throw new Error(`applyZoneBulk failed: ${r.reason}`);
}

export function scenes(): Scene[] {
  const out: Scene[] = [];
  {
    // Owner's repro: a street ending in a Y fork of two 30 degree diagonals.
    const probe = newCity(1337, 96);
    const ey = probe.world.entry.y;
    const f = city({ x0: 0, x1: 70, y0: ey - 16, y1: ey + 16 });
    road(f, [P(6.5, ey + .5), P(30.5, ey + .5)]);
    road(f, [P(30.5, ey + .5), P(52.5, ey - 12.5)]);
    road(f, [P(30.5, ey + .5), P(52.5, ey + 13.5)]);
    out.push({ name: "yfork", city: f, paint: { x0: 26, x1: 60, y0: ey - 18, y1: ey + 18 } });
  }
  {
    const f = city(); const ey = f.world.entry.y;
    road(f, [P(10.5, ey + .5), P(30, ey - 14), P(50.5, ey + .5)]);
    out.push({ name: "curve", city: f, paint: { x0: 6, x1: 55, y0: ey - 16, y1: ey + 5 } });
  }
  {
    const f = city(); const ey = f.world.entry.y;
    const a = (25 * Math.PI) / 180;
    road(f, [P(10.5, ey + .5), P(60.5, ey + .5)]);
    road(f, [P(25.5, ey + .5), P(25.5 + 30 * Math.cos(a), ey + .5 - 30 * Math.sin(a))]);
    out.push({ name: "acute25", city: f, paint: { x0: 18, x1: 62, y0: ey - 18, y1: ey + 5 } });
  }
  {
    const f = city(); const ey = f.world.entry.y;
    road(f, [P(10.5, ey + .5), P(50.5, ey + .5)]);
    road(f, [P(30.5, ey + .5), P(30.5, ey - 15.5)]);
    out.push({ name: "tee", city: f, paint: { x0: 14, x1: 47, y0: ey - 18, y1: ey + 5 } });
  }
  {
    const f = city(); const ey = f.world.entry.y;
    road(f, [P(10.5, ey + .5), P(30.5, ey + .5)]);
    road(f, [P(30.5, ey + .5), P(45.5, ey - 14.5)]);
    out.push({ name: "bend", city: f, paint: { x0: 8, x1: 52, y0: ey - 20, y1: ey + 5 } });
  }
  for (const s of out) paint(s);
  return out;
}

// ------------------------------------------------------------------ geometry oracle

/** Distance to a centreline; ends flagged flat stop at the node (the junction polygon covers the node area). */
function distToLine(x: number, z: number, pts: Pt[], flatA = false, flatB = false): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
    const raw = ((x - a.x) * vx + (z - a.z) * vz) / l2;
    if ((flatA && i === 1 && raw < 0) || (flatB && i === pts.length - 1 && raw > 1)) continue;
    const u = Math.max(0, Math.min(1, raw));
    best = Math.min(best, Math.hypot(a.x + vx * u - x, a.z + vz * u - z));
  }
  return best;
}

function inPoly(poly: Pt[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function quadArea(q: Float32Array): number {
  return 0.5 * ((q[0] * q[3] - q[2] * q[1]) + (q[2] * q[5] - q[4] * q[3]) + (q[4] * q[7] - q[6] * q[5]) + (q[6] * q[1] - q[0] * q[7]));
}

function quadsOverlap(a: Float32Array, b: Float32Array): boolean {
  for (const p of [a, b]) for (let i = 0; i < 4; i++) {
    const j = (i + 1) & 3, ax = -(p[j * 2 + 1] - p[i * 2 + 1]), az = p[j * 2] - p[i * 2];
    let alo = Infinity, ahi = -Infinity, blo = Infinity, bhi = -Infinity;
    for (let k = 0; k < 4; k++) {
      const va = a[k * 2] * ax + a[k * 2 + 1] * az, vb = b[k * 2] * ax + b[k * 2 + 1] * az;
      alo = Math.min(alo, va); ahi = Math.max(ahi, va); blo = Math.min(blo, vb); bhi = Math.max(bhi, vb);
    }
    if (Math.min(ahi, bhi) - Math.max(alo, blo) <= 1e-3) return false;
  }
  return true;
}

function inQuad(q: Float32Array, x: number, z: number): boolean {
  let pos = 0, neg = 0;
  for (let e = 0; e < 4; e++) {
    const ax = q[e * 2], az = q[e * 2 + 1], bx = q[((e + 1) & 3) * 2], bz = q[((e + 1) & 3) * 2 + 1];
    const cr = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    if (cr > 1e-9) pos++; else if (cr < -1e-9) neg++;
  }
  return pos === 0 || neg === 0;
}

function samples9(q: Float32Array): [number, number][] {
  const cx = (q[0] + q[2] + q[4] + q[6]) / 4, cz = (q[1] + q[3] + q[5] + q[7]) / 4;
  const out: [number, number][] = [[cx, cz]];
  for (let e = 0; e < 4; e++) {
    const ax = q[e * 2], az = q[e * 2 + 1], bx = q[((e + 1) & 3) * 2], bz = q[((e + 1) & 3) * 2 + 1];
    out.push([cx + (ax - cx) * 0.93, cz + (az - cz) * 0.93]);
    out.push([cx + ((ax + bx) / 2 - cx) * 0.93, cz + ((az + bz) / 2 - cz) * 0.93]);
  }
  return out;
}

export interface SideMetric {
  seg: number; side: number; stations: number; free: number; covered: number; contested: number; gap: number; miss: number[];
}
export interface SceneMetric {
  name: string; cells: number; lots: number; cover: number; worstCover: number; maxGap: number; contested: number;
  misassigned: number; intrude: number; lotLot: number; lotRoad: number; sides: SideMetric[];
}

export function measure(s: Scene): SceneMetric {
  const w = s.city.world;
  const set = getZoneBlocks(w);
  const roads = w.segments.filter((g) => segElevation(g) === "ground").map((g) => {
    const p = profileOf(g.type);
    return { id: g.id, a: g.a, b: g.b, pts: curvePoints(g.pts, 0.25), body: p.drawHalf + p.sidewalk, hw: p.drawHalf + p.sidewalk + p.setback, zoneable: baseRoadType(g.type) !== 3 };
  });
  const dist = (x: number, z: number, r: (typeof roads)[number]) => distToLine(x, z, r.pts, polyNodes.has(r.a), polyNodes.has(r.b));
  const layouts = [...junctionsOf(w).byNode.values()].filter((l) => l.sidewalkOuter.length >= 3);
  const polys = layouts.map((l) => l.sidewalkOuter);
  const polyNodes = new Set(layouts.map((l) => l.nodeId));
  // Zoned cell quads with a coarse bucket grid.
  const zoned: { b: ZoneBlock; row: number; col: number; q: Float32Array }[] = [];
  for (const b of set.blocks.values()) for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
    const i = cellIndex(r, c);
    if (!b.valid[i] || !b.zone[i]) continue;
    const q = new Float32Array(8);
    cellCorners(b, r, c, q);
    zoned.push({ b, row: r, col: c, q });
  }
  const grid = new Map<number, Float32Array[]>();
  for (const z of zoned) {
    const xs = [z.q[0], z.q[2], z.q[4], z.q[6]], zs = [z.q[1], z.q[3], z.q[5], z.q[7]];
    for (let ty = Math.floor(Math.min(...zs)); ty <= Math.floor(Math.max(...zs)); ty++)
      for (let tx = Math.floor(Math.min(...xs)); tx <= Math.floor(Math.max(...xs)); tx++) {
        const k = ty * 4096 + tx;
        const arr = grid.get(k); if (arr) arr.push(z.q); else grid.set(k, [z.q]);
      }
  }
  const covered = (x: number, z: number) => (grid.get(Math.floor(z) * 4096 + Math.floor(x)) ?? []).some((q) => inQuad(q, x, z));
  const inPainted = (x: number, z: number) => x >= s.paint.x0 && x < s.paint.x1 + 1 && z >= s.paint.y0 && z < s.paint.y1 + 1;
  // A road continuing straight through a shared node is the same kerb line: no extra margin against it.
  const straightOn = (a: number, b: number): boolean => {
    const ga = w.segments.find((g) => g.id === a)!, gb = w.segments.find((g) => g.id === b)!;
    const out = (g: typeof ga, end: "a" | "b") => {
      const p = g.pts, o = end === "a" ? p[0] : p[p.length - 1], q = end === "a" ? p[1] : p[p.length - 2];
      const l = Math.hypot(q.x - o.x, q.z - o.z) || 1;
      return [(q.x - o.x) / l, (q.z - o.z) / l];
    };
    for (const ea of ["a", "b"] as const) for (const eb of ["a", "b"] as const) {
      if (ga[ea] !== gb[eb]) continue;
      const [ax, az] = out(ga, ea), [bx, bz] = out(gb, eb);
      if (ax * bx + az * bz < -0.99) return true;
    }
    return false;
  };
  const blocked = (x: number, z: number, own: number, margin: number) => {
    if (x < 0 || z < 0 || x > w.size || z > w.size) return true;
    for (const r of roads) if (r.id !== own && dist(x, z, r) < r.body + (straightOn(own, r.id) ? -1e-6 : margin)) return true;
    for (const p of polys) if (inPoly(p, x, z)) return true;
    return false;
  };
  // Frontage stations per road side, tested against the real depth-0 cell of the row that holds the station.
  const sides: SideMetric[] = [];
  for (const g of w.segments) {
    const r = roads.find((q) => q.id === g.id);
    if (!r || !r.zoneable) continue;
    const pts = r.pts;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const len = cum[cum.length - 1];
    for (const side of [-1, 1] as const) {
      const m: SideMetric = { seg: g.id, side, stations: 0, free: 0, covered: 0, contested: 0, gap: 0, miss: [] };
      const mine = [...set.blocks.values()].filter((b) => b.seg === g.id && b.side === side);
      for (let st = 0.125; st <= len + 1e-6; st += 0.25) {
        let i = 0;
        while (i < cum.length - 2 && cum[i + 1] < st) i++;
        const a = pts[i], b = pts[i + 1];
        const u = (st - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i]);
        const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const tx = (b.x - a.x) / tl, tz = (b.z - a.z) / tl, nx = -tz * side, nz = tx * side;
        const cx = a.x + (b.x - a.x) * u, cz = a.z + (b.z - a.z) * u;
        m.stations++;
        const blk = mine.find((q) => st >= q.s0 - 0.5 - 1e-6 && st < q.s0 + q.rows - 0.5 - 1e-6);
        if (!blk) continue;
        const row = Math.min(blk.rows - 1, Math.max(0, Math.round(st - blk.s0)));
        const q = new Float32Array(8);
        cellCorners(blk, row, 0, q);
        const [mx, mz] = samples9(q)[0];
        if (!inPainted(mx, mz) || Math.abs(quadArea(q)) < 0.42 ||
          samples9(q).some(([x, z]) => blocked(x, z, g.id, 0.12) || distToLine(x, z, pts) < r.body - 1e-6)) continue;
        m.free++;
        const qx = cx + nx * (r.hw + 0.3), qz = cz + nz * (r.hw + 0.3);
        if (covered(qx, qz)) { m.covered++; continue; }
        // Lost a fair tie: the own depth-0 cell overlaps another road's zoned cell that is at most as deep.
        const depth = blk.lat0;
        if (!blk.valid[cellIndex(row, 0)] && zoned.some((z) => z.b.seg !== g.id && z.b.lat0 + z.col <= depth + 1e-6 && quadsOverlap(z.q, q))) {
          m.contested++;
          continue;
        }
        m.miss.push(Math.round(st * 100) / 100);
        let gap = 4;
        for (let t = 0.02; t <= 4; t += 0.05) if (covered(cx + nx * (r.hw + t), cz + nz * (r.hw + t))) { gap = t - 0.02; break; }
        m.gap = Math.max(m.gap, gap);
      }
      sides.push(m);
    }
  }
  let misassigned = 0, intrude = 0;
  for (const z of zoned) {
    const own = roads.find((r) => r.id === z.b.seg)!;
    const sm = samples9(z.q);
    const [cx, cz] = sm[0];
    const dOwn = dist(cx, cz, own) - own.hw;
    let dOther = Infinity;
    for (const r of roads) if (r.id !== own.id && r.zoneable) dOther = Math.min(dOther, dist(cx, cz, r) - r.hw);
    if (dOther < dOwn - 0.5) misassigned++;
    if (sm.some(([x, zz]) => roads.some((r) => dist(x, zz, r) < r.body - 1e-3) || polys.some((p) => inPoly(p, x, zz)))) intrude++;
  }
  const lots = w.olots ?? [];
  const check = checkLots(set.blocks, lots, w.segments.filter((g) => segElevation(g) === "ground").map((g) => ({ pts: g.pts, half: profileOf(g.type).drawHalf })));
  const free = sides.reduce((a, m) => a + m.free - m.contested, 0), cov = sides.reduce((a, m) => a + m.covered, 0);
  const res: SceneMetric = {
    name: s.name, cells: zoned.length, lots: lots.length,
    cover: free ? cov / free : 1,
    worstCover: Math.min(1, ...sides.filter((m) => m.free - m.contested >= 4).map((m) => m.covered / (m.free - m.contested))),
    maxGap: Math.max(0, ...sides.map((m) => m.gap)),
    contested: sides.reduce((a, m) => a + m.contested, 0),
    misassigned, intrude, lotLot: check.lotLot, lotRoad: check.lotRoad, sides,
  };
  if (process.env.ZATTACH_SVG) dumpSvg(s, process.env.ZATTACH_SVG, zoned, polys);
  return res;
}

function dumpSvg(s: Scene, dir: string, zoned: { q: Float32Array }[], polys: Pt[][]): void {
  const w = s.city.world;
  const set = getZoneBlocks(w);
  const S = 20, x0 = s.paint.x0 - 2, y0 = s.paint.y0 - 2, W = (s.paint.x1 - s.paint.x0 + 5) * S, H = (s.paint.y1 - s.paint.y0 + 5) * S;
  const X = (x: number) => ((x - x0) * S).toFixed(1), Y = (z: number) => ((z - y0) * S).toFixed(1);
  const quad = (q: Float32Array) => `${X(q[0])},${Y(q[1])} ${X(q[2])},${Y(q[3])} ${X(q[4])},${Y(q[5])} ${X(q[6])},${Y(q[7])}`;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#9cc47a"/>`];
  for (let y = s.paint.y0; y <= s.paint.y1 + 1; y++) parts.push(`<line x1="0" x2="${W}" y1="${Y(y)}" y2="${Y(y)}" stroke="#8ab06a" stroke-width="0.5"/>`);
  for (let x = s.paint.x0; x <= s.paint.x1 + 1; x++) parts.push(`<line y1="0" y2="${H}" x1="${X(x)}" x2="${X(x)}" stroke="#8ab06a" stroke-width="0.5"/>`);
  for (const g of w.segments) {
    const p = profileOf(g.type);
    const d = curvePoints(g.pts, 0.25).map((q, i) => `${i ? "L" : "M"}${X(q.x)},${Y(q.z)}`).join(" ");
    parts.push(`<path d="${d}" stroke="#d8d4c8" stroke-width="${(2 * (p.drawHalf + p.sidewalk)) * S}" fill="none"/>`);
    parts.push(`<path d="${d}" stroke="#555" stroke-width="${2 * p.drawHalf * S}" fill="none"/>`);
  }
  for (const p of polys) parts.push(`<polygon points="${p.map((q) => `${X(q.x)},${Y(q.z)}`).join(" ")}" fill="#555" stroke="#d8d4c8" stroke-width="1" fill-opacity="0.8"/>`);
  for (const z of zoned) parts.push(`<polygon points="${quad(z.q)}" fill="#3fae4a" fill-opacity="0.55" stroke="#1d6b25" stroke-width="0.6"/>`);
  for (const l of w.olots ?? []) {
    const b = set.blocks.get(`${l.seg}:${l.side}:${l.block}`);
    if (!b) continue;
    const q = new Float32Array(8);
    lotCorners(b, l, q);
    parts.push(`<polygon points="${quad(q)}" fill="none" stroke="#123" stroke-width="1.4"/>`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${s.name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join("")}</svg>`);
}

// ------------------------------------------------------------------ assertions

describe("zoned cells attach to their road (05 §1.4-§1.5)", () => {
  const all = scenes().map(measure);
  const table = all.map((m) =>
    `${m.name.padEnd(8)} cells=${String(m.cells).padStart(4)} lots=${String(m.lots).padStart(3)} cover=${m.cover.toFixed(3)} ` +
    `worst=${m.worstCover.toFixed(3)} gap=${m.maxGap.toFixed(2)} contested=${m.contested} misassigned=${m.misassigned} intrude=${m.intrude} lotLot=${m.lotLot} lotRoad=${m.lotRoad}`);
  console.log(`zone-attach metrics\n${table.join("\n")}`);
  if (process.env.ZATTACH_SIDES) for (const m of all) for (const sd of m.sides) console.log(m.name, JSON.stringify(sd));

  for (const m of all) {
    describe(m.name, () => {
      it("depth-0 cells cover the free frontage of every side", () => {
        expect(m.cover).toBeGreaterThanOrEqual(0.99);
        expect(m.worstCover).toBeGreaterThanOrEqual(0.97);
      });
      it("no gap between the setback line and the first zoned cell", () => {
        expect(m.maxGap).toBeLessThanOrEqual(0.1);
      });
      it("contested cells belong to the nearest road", () => {
        expect(m.misassigned).toBe(0);
      });
      it("no zoned cell sits in a road footprint or junction polygon", () => {
        expect(m.intrude).toBe(0);
      });
      it("lots never overlap", () => {
        expect(m.lotLot).toBe(0);
        expect(m.lotRoad).toBe(0);
      });
    });
  }
});

describe("zone attachment keeps determinism and saves", () => {
  const zonedCells = (c: City): number => {
    let n = 0;
    for (const b of getZoneBlocks(c.world).blocks.values()) for (let i = 0; i < b.valid.length; i++) if (b.valid[i] && b.zone[i]) n++;
    return n;
  };

  it("validity does not depend on segment order", () => {
    for (const s of scenes()) {
      const w = s.city.world;
      const a = buildZoneBlocks(w, getZoneBlocks(w));
      const saved = w.segments;
      w.segments = [...saved].reverse();
      const b = buildZoneBlocks(w, a);
      w.segments = saved;
      for (const [k, blk] of a.blocks) expect(Array.from(b.blocks.get(k)!.valid), `${s.name} ${k}`).toEqual(Array.from(blk.valid));
    }
  });

  it("a save round trip keeps every zoned cell and lot", () => {
    for (const s of scenes()) {
      syncLots(s.city);
      const before = zonedCells(s.city), lots = s.city.world.olots!.length;
      const back = deserialize(serialize(s.city));
      syncLots(back);
      expect(zonedCells(back), s.name).toBe(before);
      expect(back.world.olots!.length, s.name).toBe(lots);
    }
  });

  it("an older save zoned under other rules keeps every cell that is still valid", () => {
    // Emulates a save written by the old rules: every saved cell (valid now or not) is zoned and the lots are gone.
    const s = scenes()[0];
    const json = JSON.parse(serialize(s.city)) as { cells: { zone: string; level: string }[]; lots: unknown[] };
    for (const c of json.cells) {
      const z = Buffer.from(c.zone, "base64");
      z.fill(1);
      c.zone = z.toString("base64");
      c.level = Buffer.alloc(z.length).toString("base64");
    }
    json.lots = [];
    const back = deserialize(JSON.stringify(json));
    let valid = 0, kept = 0;
    for (const b of getZoneBlocks(back.world).blocks.values()) {
      if (!json.cells.length) break;
      for (let i = 0; i < b.valid.length; i++) if (b.valid[i]) { valid++; if (b.zone[i]) kept++; }
    }
    const savedBlocks = new Set((JSON.parse(serialize(s.city)) as { cells: { seg: number; side: number; block: number }[] }).cells.map((c) => `${c.seg}:${c.side}:${c.block}`));
    let validInSaved = 0;
    for (const b of getZoneBlocks(back.world).blocks.values()) if (savedBlocks.has(b.key)) for (let i = 0; i < b.valid.length; i++) if (b.valid[i]) validInSaved++;
    expect(kept).toBe(validInSaved);
    expect(valid).toBeGreaterThan(0);
  });
});
