import { describe, expect, it } from "vitest";
import { applyZoneBulk, newCity, placeRoad, step, applyTool } from "./sim";
import { ROAD_DRAW_WIDTH, cidx, curvePoints } from "./world";

/** Lots whose rotated rectangle comes closer to a road centreline than half its drawn width (sampled every 0.25 tile). */
function overlapping(s: ReturnType<typeof newCity>): { lots: number; bad: number; ids: number[] } {
  const w = s.world;
  const lines = w.segments.map((sg) => ({ half: ROAD_DRAW_WIDTH[sg.type] / 2, pts: curvePoints(sg.pts, 0.25) }));
  const dist = (x: number, z: number, line: { half: number; pts: { x: number; z: number }[] }) => {
    let best = Infinity;
    for (let i = 0; i + 1 < line.pts.length; i++) {
      const a = line.pts[i], b = line.pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
    }
    return best - line.half;       // negative = inside the asphalt
  };
  let lots = 0, bad = 0;
  const ids: number[] = [];
  for (const l of w.olots ?? []) {
    lots++;
    const c = Math.cos(l.yaw), sn = Math.sin(l.yaw);
    let hit = false;
    for (let a = -l.w / 2 + 0.1; a <= l.w / 2 - 0.1 && !hit; a += 0.25) {
      for (let b = -l.d / 2 + 0.1; b <= l.d / 2 - 0.1 && !hit; b += 0.25) {
        const x = l.cx + a * c + b * sn, z = l.cz - a * sn + b * c;
        for (const line of lines) if (dist(x, z, line) < MARGIN) { hit = true; break; }
      }
    }
    if (hit) { bad++; ids.push(l.id); }
  }
  return { lots, bad, ids };
}

const MARGIN = Number(process.env.OVERLAP_MARGIN ?? -0.02);

describe("oriented lots never cover road tiles", () => {
  it("no lot rectangle intrudes into the asphalt of diagonal and curved streets meeting at junctions", () => {
    const s = newCity(11, 96);
    for (let y = 0; y < s.world.size; y++) for (let x = 0; x < s.world.size; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
    s.money = 1e8;
    s.world.zoning = "oriented";
    const e = s.world.entry;
    const R = (pts: [number, number][]) => placeRoad(s, 1, pts.map(([x, z]) => ({ x: e.x + x + 0.5, z: e.y + z + 0.5 })));
    R([[0, 0], [20, 0]]);
    R([[20, 0], [42, -18]]);
    R([[20, 0], [34, 7], [46, 23]]);
    R([[34, 7], [10, 16]]);
    applyTool(s, "power", e.x + 8, e.y + 3);
    const tiles: { x: number; y: number }[] = [];
    for (let y = e.y - 24; y < e.y + 30; y++) for (let x = e.x; x < e.x + 60; x++) tiles.push({ x, y });
    applyZoneBulk(s, "res", tiles);
    for (let i = 0; i < 400; i++) step(s);
    const r = overlapping(s);
    expect(r.lots).toBeGreaterThan(10);
    expect(r.bad, `overlapping lots: ${r.ids.join(",")}`).toBe(0);
  });
});
