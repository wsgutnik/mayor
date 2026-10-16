import { describe, expect, it } from "vitest";
import { applyTool, applyZoneBulk, getZoneBlocks, newCity, placeRoad, step } from "./sim";
import { ROAD_DRAW_WIDTH, cidx, curvePoints } from "./world";
import { cellIndex, cellPose } from "./zoneblocks";
import { orientedKerb } from "../render/lots";
import { CELL_DEPTH } from "./zonecells";

type P = [number, number];

/** Corners of a 1x1 cell in its frame. */
function quad(p: { x: number; z: number; tx: number; tz: number }): P[] {
  const nx = -p.tz, nz = p.tx, h = 0.5;
  return [[p.x - p.tx * h - nx * h, p.z - p.tz * h - nz * h], [p.x + p.tx * h - nx * h, p.z + p.tz * h - nz * h],
    [p.x + p.tx * h + nx * h, p.z + p.tz * h + nz * h], [p.x - p.tx * h + nx * h, p.z - p.tz * h + nz * h]];
}

/** Intersection area of two convex quads (Sutherland-Hodgman). */
export function overlapArea(a: P[], b: P[]): number {
  let out = a;
  for (let i = 0; i < b.length && out.length; i++) {
    const c = b[i], d = b[(i + 1) % b.length];
    const inside = (p: P) => (d[0] - c[0]) * (p[1] - c[1]) - (d[1] - c[1]) * (p[0] - c[0]) >= 0;
    const inter = (p: P, q: P): P => {
      const A1 = q[1] - p[1], B1 = p[0] - q[0], C1 = A1 * p[0] + B1 * p[1];
      const A2 = d[1] - c[1], B2 = c[0] - d[0], C2 = A2 * c[0] + B2 * c[1];
      const det = A1 * B2 - A2 * B1;
      return [(B2 * C1 - B1 * C2) / det, (A1 * C2 - A2 * C1) / det];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prev = input[(j + input.length - 1) % input.length];
      if (inside(cur)) { if (!inside(prev)) out.push(inter(prev, cur)); out.push(cur); } else if (inside(prev)) out.push(inter(prev, cur));
    }
  }
  let s = 0;
  for (let i = 0; i < out.length; i++) { const p = out[i], q = out[(i + 1) % out.length]; s += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(s) / 2;
}

describe("acute junction (reference: iPad capture 2026-10-13, three roads meeting in an A)", () => {
  it("measures zoned cells of different roads that overlap", () => {
    const s = newCity(3, 96);
    for (let y = 0; y < s.world.size; y++) for (let x = 0; x < s.world.size; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
    s.money = 1e8;
    s.world.zoning = "oriented";
    const e = s.world.entry;
    const R = (pts: [number, number][]) => placeRoad(s, 1, pts.map(([x, z]) => ({ x: e.x + x + 0.5, z: e.y + z + 0.5 })));
    R([[0, 0], [12, 0]]); R([[12, 0], [30, -14]]); R([[12, 0], [30, 2]]); R([[12, 0], [28, 14]]);
    applyTool(s, "power", e.x + 6, e.y + 3);
    const tiles: { x: number; y: number }[] = [];
    for (let y = e.y - 24; y < e.y + 30; y++) for (let x = e.x; x < e.x + 60; x++) tiles.push({ x, y });
    applyZoneBulk(s, "res", tiles);
    for (let i = 0; i < 50; i++) step(s);

    const cells: { q: P[]; seg: number }[] = [];
    for (const b of getZoneBlocks(s.world).blocks.values()) {
      for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
        const i = cellIndex(r, c);
        if (!b.valid[i] || !b.zone[i]) continue;
        cells.push({ q: quad(cellPose(b, r, c) as never), seg: b.seg });
      }
    }
    let pairs = 0, total = 0, worst = 0;
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      if (cells[i].seg === cells[j].seg) continue;
      const a = overlapArea(cells[i].q, cells[j].q);
      if (a > 0.02) { pairs++; total += a; worst = Math.max(worst, a); }
    }
    // Cells whose centre lies inside the asphalt of any road (distance to a centreline under half the drawn width).
    const lines = s.world.segments.map((sg) => ({ half: ROAD_DRAW_WIDTH[sg.type] / 2, pts: curvePoints(sg.pts, 0.1) }));
    let onRoad = 0;
    for (const c of cells) {
      const cx = (c.q[0][0] + c.q[2][0]) / 2, cz = (c.q[0][1] + c.q[2][1]) / 2;
      let inside = false;
      for (const ln of lines) for (const p of ln.pts) if (Math.hypot(p.x - cx, p.z - cz) < ln.half - 0.02) { inside = true; break; }
      if (inside) onRoad++;
    }
    // Lot kerb strips: should be parallel to, and just beside, a road edge.
    let strips = 0, far = 0, skew = 0;
    for (const l of s.world.olots ?? []) {
      if (l.col !== 0) continue;
      strips++;
      const k = orientedKerb({ cx: l.cx, cz: l.cz, yaw: l.yaw, w: l.w, d: l.d });
      let best = Infinity, ang = 0;
      for (const sg of s.world.segments) {
        const pts = curvePoints(sg.pts, 0.25);
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1];
          const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((k.x - a.x) * dx + (k.z - a.z) * dz) / l2));
          const d = Math.hypot(a.x + dx * t - k.x, a.z + dz * t - k.z) - ROAD_DRAW_WIDTH[sg.type] / 2;
          if (d < best) { best = d; ang = Math.abs(Math.sin(Math.atan2(dz, dx) - k.yaw - Math.PI / 2 * 0)); }
        }
      }
      if (best > 0.35) far++;
      // strip direction is the lot's local x axis = (cos yaw, -sin yaw)
      const kx = Math.cos(k.yaw), kz = -Math.sin(k.yaw);
      let near = 0; let bestd = Infinity;
      for (const sg of s.world.segments) {
        const pts = curvePoints(sg.pts, 0.25);
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1];
          const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
          const t = Math.max(0, Math.min(1, ((k.x - a.x) * dx + (k.z - a.z) * dz) / (len * len)));
          const d = Math.hypot(a.x + dx * t - k.x, a.z + dz * t - k.z);
          if (d < bestd) { bestd = d; near = Math.abs((dx / len) * kz - (dz / len) * kx); }
        }
      }
      if (near > 0.35) skew++;
      void ang;
    }
    expect(cells.length).toBeGreaterThan(20);
  });

  it("zoning first, then a road that splits the zoned segment at an acute angle", () => {
    const s = newCity(3, 96);
    for (let y = 0; y < s.world.size; y++) for (let x = 0; x < s.world.size; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
    s.money = 1e8;
    s.world.zoning = "oriented";
    const e = s.world.entry;
    const R = (pts: [number, number][]) => placeRoad(s, 1, pts.map(([x, z]) => ({ x: e.x + x + 0.5, z: e.y + z + 0.5 })));
    R([[0, 0], [40, 0]]);
    applyTool(s, "power", e.x + 6, e.y + 3);
    const tiles: { x: number; y: number }[] = [];
    for (let y = e.y - 24; y < e.y + 30; y++) for (let x = e.x; x < e.x + 60; x++) tiles.push({ x, y });
    applyZoneBulk(s, "res", tiles);
    for (let i = 0; i < 30; i++) step(s);
    // an acute branch off the middle of the zoned road, then a third road closing the A
    R([[20, 0], [34, -12]]);
    R([[20, 0], [36, 12]]);
    applyZoneBulk(s, "res", tiles);
    for (let i = 0; i < 30; i++) step(s);
    const cells: { q: P[]; seg: number }[] = [];
    for (const b of getZoneBlocks(s.world).blocks.values()) {
      for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
        const i = cellIndex(r, c);
        if (!b.valid[i] || !b.zone[i]) continue;
        cells.push({ q: quad(cellPose(b, r, c) as never), seg: b.seg });
      }
    }
    let pairs = 0, total = 0;
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      if (cells[i].seg === cells[j].seg) continue;
      const a = overlapArea(cells[i].q, cells[j].q);
      if (a > 0.02) { pairs++; total += a; }
    }
    const lines = s.world.segments.map((sg) => ({ half: ROAD_DRAW_WIDTH[sg.type] / 2, pts: curvePoints(sg.pts, 0.1) }));
    let onRoad = 0;
    for (const c of cells) {
      const cx = (c.q[0][0] + c.q[2][0]) / 2, cz = (c.q[0][1] + c.q[2][1]) / 2;
      for (const ln of lines) if (ln.pts.some((p) => Math.hypot(p.x - cx, p.z - cz) < ln.half - 0.02)) { onRoad++; break; }
    }
    expect(cells.length).toBeGreaterThan(20);
  });
});
