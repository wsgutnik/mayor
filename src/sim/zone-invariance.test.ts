/**
 * Invariant (owner report, task zinv): zoned building areas must NEVER invade
 * the road, and no zone cell or lot kerb may float detached from the road frame.
 * After EVERY operation, however it was reached:
 *  - every zoned cell is valid in the current block set (validity keeps the
 *    cell's samples clear of every road footprint: asphalt + kerb + sidewalk,
 *    junction polygons included — see zoneblocks applyValidity);
 *  - no zoned cell's physical quad enters any ground road's asphalt;
 *  - no mirror tile on a road raster tile carries a zone;
 *  - every oriented lot sits only on valid cells of its own zone, no lot
 *    rectangle enters asphalt, and lots never overlap;
 *  - a drawn kerb strip exists only for a front (col 0) lot and never on asphalt.
 * The randomised half drives 200 seeded operations (roads straight/diagonal/
 * curved, upgrades, removals, re-adds, zone paints, bulldozes, roundabouts,
 * steps, save/load and undo/redo snapshots) and asserts this after each one.
 */
import { describe, expect, it } from "vitest";
import {
  applyTool, applyZoneAt, applyZoneBulk, bulldozeAt, getZoneBlocks, newCity, placeRoad,
  placeRoundabout, step, upgradeRoad, type CityState,
} from "./sim";
import { deserialize, serialize } from "./save";
import { cellCorners, cellIndex } from "./zoneblocks";
import { checkLots, lotCorners } from "./orientedlots";
import { lotInstances } from "../render/lots";
import { profileOf } from "./corridor";
import { curvePoints, segElevation } from "./world";
import { junctionsOf } from "./junction";

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flatCity(size = 24): CityState {
  const s = newCity(7, size);
  s.world.heights.fill(0.5);
  s.world.zoning = "oriented";
  s.money = 100_000_000;
  return s;
}

/**
 * Distance from a point to the nearest ground road surface, and that road's asphalt
 * half-width. Ends are flat-capped (the drawn dead end is a flat square cap, docs 07),
 * exactly like the validity test in zoneblocks; the junction asphalt rings cover nodes.
 */
function nearestRoad(s: CityState, x: number, z: number, layouts: ReturnType<typeof junctionsOf>["byNode"]): { d: number; asphalt: number } {
  let best = Infinity, asphalt = 0;
  for (const seg of s.world.segments) {
    if (segElevation(seg) !== "ground") continue;
    // Like zoneblocks' sampler: straights stay a single span so the flat-cap rule
    // applies to the whole end, curves are subdivided.
    const pts = seg.pts.length === 2 ? seg.pts : curvePoints(seg.pts, 0.25);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], c = pts[i];
      const vx = c.x - a.x, vz = c.z - a.z, l2 = vx * vx + vz * vz || 1;
      const raw = ((x - a.x) * vx + (z - a.z) * vz) / l2;
      // Flat cap only where a junction layout takes over (validity's rule); a plain
      // continuation node keeps the ribbon distance, as the asphalt is continuous there.
      if ((i === 1 && raw < 0 && layouts.has(seg.a)) || (i === pts.length - 1 && raw > 1 && layouts.has(seg.b))) continue;
      const u = Math.max(0, Math.min(1, raw));
      const d = Math.hypot(a.x + vx * u - x, a.z + vz * u - z);
      if (d < best) { best = d; asphalt = profileOf(seg.type).drawHalf; }
    }
  }
  return { d: best, asphalt };
}

/**
 * True when the point lies on a drawn asphalt ribbon (flat-capped where a junction
 * layout takes over). Junction interiors are not re-measured here: validity tests
 * them against the sidewalkOuter rings and zone-attach asserts that oracle at 0.
 */
function onAsphalt(s: CityState, x: number, z: number, layouts: ReturnType<typeof junctionsOf>["byNode"]): boolean {
  const r = nearestRoad(s, x, z, layouts);
  return r.d < r.asphalt - 1e-6;
}

function quadEntersAsphalt(s: CityState, corners: Float32Array, layouts: ReturnType<typeof junctionsOf>["byNode"]): boolean {
  for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) {
    const u = a / 4, v = b / 4;
    const x = (corners[0] * (1 - u) + corners[2] * u) * (1 - v) + (corners[6] * (1 - u) + corners[4] * u) * v;
    const z = (corners[1] * (1 - u) + corners[3] * u) * (1 - v) + (corners[7] * (1 - u) + corners[5] * u) * v;
    if (onAsphalt(s, x, z, layouts)) return true;
  }
  return false;
}

/** Assert the whole invariant against the live state; `where` names the operation for failures. */
function assertInvariant(s: CityState, where: string): void {
  const w = s.world;
  const set = getZoneBlocks(w);
  const layouts = junctionsOf(w).byNode;
  const corners = new Float32Array(8);
  for (const b of set.blocks.values()) {
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < 4; c++) {
      const i = cellIndex(r, c);
      if (!b.zone[i]) continue;
      expect(b.valid[i], `${where}: zoned cell ${b.key} r${r}c${c} is not valid`).toBe(1);
      cellCorners(b, r, c, corners);
      expect(quadEntersAsphalt(s, corners, layouts), `${where}: zoned cell ${b.key} r${r}c${c} enters asphalt`).toBe(false);
    }
  }
  for (let t = 0; t < w.zone.length; t++) {
    if (w.zone[t]) expect(w.road[t], `${where}: mirror tile ${t} is zoned on a road tile`).toBe(0);
  }
  const lots = w.olots ?? [];
  for (const lot of lots) {
    const b = set.blocks.get(`${lot.seg}:${lot.side}:${lot.block}`);
    expect(b, `${where}: lot ${lot.id} has no block`).toBeDefined();
    for (let r = lot.row; r < lot.row + lot.w; r++) for (let c = lot.col; c < lot.col + lot.d; c++) {
      const i = cellIndex(r, c);
      expect(b!.valid[i], `${where}: lot ${lot.id} covers invalid cell r${r}c${c}`).toBe(1);
      expect(b!.zone[i], `${where}: lot ${lot.id} covers unzoned/differently zoned cell r${r}c${c}`).toBe(lot.zone);
    }
    for (const t of lot.tiles) expect(w.road[t], `${where}: lot ${lot.id} mirror tile ${t} is a road tile`).toBe(0);
    const plan = lotInstances(lot, lot.col === 0);
    if (lot.col !== 0) expect(plan.kerb, `${where}: lot ${lot.id} at col ${lot.col} draws a kerb`).toEqual([]);
    for (const k of plan.kerb) {
      const r = nearestRoad(s, k.x, k.z, layouts);
      expect(r.d, `${where}: kerb of lot ${lot.id} sits on asphalt`).toBeGreaterThanOrEqual(r.asphalt - 0.02);
    }
    for (const p of plan.pad) {
      const r = nearestRoad(s, p.x, p.z, layouts);
      expect(r.d, `${where}: pad of lot ${lot.id} centre sits on asphalt`).toBeGreaterThanOrEqual(r.asphalt - 0.02);
    }
  }
  // Lot-lot overlap uses the project's exact trapezoid SAT oracle. Lot-road is
  // measured on the same trapezoid quads with the flat-capped ribbon distance
  // (checkLots' interior OBB sampling round-caps dead-end tips, which the drawn
  // flat square caps do not cover).
  const overlap = checkLots(set.blocks, lots, []);
  expect(overlap.lotLot, `${where}: overlapping lots`).toBe(0);
  for (const lot of lots) {
    const b = set.blocks.get(`${lot.seg}:${lot.side}:${lot.block}`)!;
    const q = new Float32Array(8);
    lotCorners(b, lot, q);
    expect(quadEntersAsphalt(s, q, layouts), `${where}: lot ${lot.id} rectangle enters asphalt`).toBe(false);
  }
}

const rect = (x0: number, y0: number, x1: number, y1: number) => {
  const out: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
};

describe("zoning never invades the road (zinv)", () => {
  it("road drawn through a zoned strip, removed, re-added, saved and loaded", () => {
    const s = flatCity(32);
    s.world.heights.fill(0.5);
    placeRoad(s, 1, [{ x: 4.5, z: 16.5 }, { x: 27.5, z: 16.5 }]);
    applyZoneBulk(s, "res", rect(6, 12, 25, 20));
    assertInvariant(s, "zoned beside road");
    placeRoad(s, 1, [{ x: 16.5, z: 6.5 }, { x: 16.5, z: 26.5 }]);
    assertInvariant(s, "crossing road through zones");
    placeRoad(s, 1, [{ x: 8.5, z: 8.5 }, { x: 20.5, z: 15.4 }]);
    assertInvariant(s, "angled road through zones");
    applyTool(s, "bulldoze", 16, 20);
    assertInvariant(s, "immediately after road bulldoze");
    placeRoad(s, 1, [{ x: 16.5, z: 6.5 }, { x: 16.5, z: 26.5 }]);
    assertInvariant(s, "road re-added");
    const back = deserialize(serialize(s));
    assertInvariant(back, "save/load round trip");
  });

  it("roundabout stamped over a zoned junction leaves no lot on the ring", () => {
    const s = flatCity(32);
    placeRoad(s, 1, [{ x: 4.5, z: 16.5 }, { x: 27.5, z: 16.5 }]);
    placeRoad(s, 1, [{ x: 16.5, z: 6.5 }, { x: 16.5, z: 26.5 }]);
    applyZoneBulk(s, "res", rect(5, 7, 26, 25));
    placeRoundabout(s, 16, 16);
    // No syncLots/step in between: the operation itself must leave valid state,
    // because the renderer draws w.olots and the mirror exactly as they are.
    assertInvariant(s, "immediately after roundabout");
  });

  it("200 seeded random operations keep the invariant after each one", { timeout: 60000 }, () => {
    const rng = mulberry(20261014);
    let s = flatCity(24);
    const snapshots: string[] = [];
    const pt = () => 3.5 + rng() * 17;
    for (let op = 0; op < 200; op++) {
      snapshots.push(serialize(s));
      if (snapshots.length > 12) snapshots.shift();
      const kind = Math.floor(rng() * 10);
      const where = `op ${op} kind ${kind}`;
      if (kind <= 2) {
        const x = pt(), z = pt(), len = 4 + rng() * 10, ang = rng() * Math.PI;
        const x2 = Math.max(1.5, Math.min(22.5, x + Math.cos(ang) * len));
        const z2 = Math.max(1.5, Math.min(22.5, z + Math.sin(ang) * len));
        const type = rng() < 0.3 ? 2 : 1;
        if (rng() < 0.3) {
          placeRoad(s, type as 1 | 2, [{ x, z }, { x: (x + x2) / 2 + (rng() - 0.5) * 4, z: (z + z2) / 2 + (rng() - 0.5) * 4 }, { x: x2, z: z2 }]);
        } else {
          placeRoad(s, type as 1 | 2, [{ x, z }, { x: x2, z: z2 }]);
        }
      } else if (kind === 3) {
        const x = Math.floor(rng() * 18), y = Math.floor(rng() * 18);
        applyZoneBulk(s, (["res", "com", "ind"] as const)[Math.floor(rng() * 3)],
          rect(x, y, x + Math.floor(rng() * 6), y + Math.floor(rng() * 6)));
      } else if (kind === 4) {
        applyZoneAt(s, ([1, 2, 3] as const)[Math.floor(rng() * 3)], pt(), pt(),
          { radius: Math.floor(rng() * 3) as 0 | 1 | 2 });
      } else if (kind === 5) {
        if (rng() < 0.5) applyTool(s, "bulldoze", Math.floor(rng() * 24), Math.floor(rng() * 24));
        else bulldozeAt(s, pt(), pt());
      } else if (kind === 6) {
        const segs = s.world.segments;
        if (segs.length) {
          const seg = segs[Math.floor(rng() * segs.length)];
          upgradeRoad(s, seg.id, seg.type === 2 ? 1 : 2);
        }
      } else if (kind === 7) {
        placeRoundabout(s, Math.floor(rng() * 24), Math.floor(rng() * 24));
      } else if (kind === 8) {
        step(s);
      } else {
        // Undo/redo and save/load both travel through serialize/deserialize.
        const snap = snapshots[Math.floor(rng() * snapshots.length)];
        s = deserialize(rng() < 0.5 ? snap : serialize(s));
        s.money = 100_000_000;
      }
      s.money = 100_000_000;
      assertInvariant(s, where);
    }
  });
});
