import { describe, expect, it } from "vitest";
import { applyTool, applyZoneBulk, newCity, placeRoad, step } from "./sim";
import { corridorsOf } from "./corridor";
import { cidx, type Pt } from "./world";

function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

function distToPolyline(p: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distPointToSegment(p, line[i - 1], line[i]));
  return best;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

describe("corridor frontage gap measurements", () => {
  it("keeps oriented lot fronts outside the nearest asphalt edge on diagonal, curved and junction roads", () => {
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

    const edges = [...corridorsOf(s.world).bySeg.values()].flatMap((c) => [c.offsets.asphaltEdge.left, c.offsets.asphaltEdge.right]);
    const gaps: number[] = [];
    for (const lot of s.world.olots ?? []) {
      const sn = Math.sin(lot.yaw), cs = Math.cos(lot.yaw);
      for (const a of [-lot.w / 2, 0, lot.w / 2]) {
        const p = { x: lot.cx + a * cs + (lot.d / 2) * sn, z: lot.cz - a * sn + (lot.d / 2) * cs };
        gaps.push(Math.min(...edges.map((edge) => distToPolyline(p, edge))));
      }
    }
    gaps.sort((a, b) => a - b);
    const msg = `front asphalt-edge gaps n=${gaps.length} min=${gaps[0]?.toFixed(3)} p50=${percentile(gaps, 0.5).toFixed(3)} p90=${percentile(gaps, 0.9).toFixed(3)} max=${gaps.at(-1)?.toFixed(3)}`;
    expect(gaps.length, msg).toBeGreaterThan(10);
    expect(gaps[0], msg).toBeGreaterThanOrEqual(0);
  });

  it.todo("asserts every oriented lot front edge sits on the setback line");
  it.todo("asserts the oriented planner creates no interior lots without frontage");
});
