/**
 * Roads may only meet at junction nodes (docs/process/17-road-snapping.md, "Overlap rules").
 * Owner report (iPad, live game): "esta truncando ainda um pelo outro" - two roads drawn over each other along
 * their length, sliver crossings, zone cells and lot kerbs across the asphalt.
 */
import { describe, expect, it } from "vitest";
import {
  CityState, applyZoneAt, getZoneBlocks, newCity, placeRoad, planRoad, setOLotLevel, syncLots, step,
  CROSSING_ANGLE_REASON, DUPLICATE_ROAD_REASON, OVERLAP_REASON,
} from "./sim";
import { MIN_CROSSING_ANGLE_DEG, addSegment, nodeArms } from "./roads";
import { profileOf } from "./corridor";
import { Pt, RoadType, ZONE, cidx, curvePoints, segElevation } from "./world";
import { cellCorners, cellIndex, cellPose } from "./zoneblocks";
import { CELL_DEPTH } from "./zonecells";
import { deserialize, serialize } from "./save";

function flatCity(size = 64, zoning: "oriented" | "tiles" = "oriented"): CityState {
  const s = newCity(7, size);
  for (let y = 0; y <= s.world.size; y++) for (let x = 0; x <= s.world.size; x++) {
    const i = cidx(s.world, Math.min(x, s.world.size - 1), Math.min(y, s.world.size - 1));
    s.world.heights[i] = 0.35;
  }
  s.money = 1e8;
  s.world.zoning = zoning;
  return s;
}

const P = (x: number, z: number): Pt => ({ x, z });

/** Distance from p to a sampled centreline. */
function distTo(p: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z));
  }
  return best;
}

/**
 * Length (tiles) along which two ground segments' footprints (asphalt + kerb + sidewalk) overlap outside a
 * shared node's junction disc. A valid network has 0 for every pair.
 */
function worstFootprintOverlap(s: CityState): number {
  const w = s.world;
  const ground = w.segments.filter((g) => segElevation(g) === "ground" && curvePoints(g.pts, 0.1).length > 1);
  let worst = 0;
  for (const a of ground) {
    const qa = curvePoints(a.pts, 0.1);
    const ha = profileOf(a.type).drawHalf + profileOf(a.type).sidewalk;
    for (const b of ground) {
      if (a.id === b.id) continue;
      const qb = curvePoints(b.pts, 0.1);
      const hb = profileOf(b.type).drawHalf + profileOf(b.type).sidewalk;
      const D = ha + hb;
      const shared = [a.a, a.b].filter((n) => n === b.a || n === b.b)
        .map((id) => w.nodes.find((n) => n.id === id)!).filter(Boolean);
      // A junction of two arms meeting at >= 20 deg closes within D / sin(20 deg) of its node.
      const disc = D / Math.sin((MIN_CROSSING_ANGLE_DEG * Math.PI) / 180) + 0.1;
      let len = 0;
      for (let i = 0; i + 1 < qa.length; i++) {
        const m = { x: (qa[i].x + qa[i + 1].x) / 2, z: (qa[i].z + qa[i + 1].z) / 2 };
        if (shared.some((n) => Math.hypot(n.x - m.x, n.z - m.z) < disc)) continue;
        if (distTo(m, qb) < D - 1e-3) len += Math.hypot(qa[i + 1].x - qa[i].x, qa[i + 1].z - qa[i].z);
      }
      worst = Math.max(worst, len);
    }
  }
  return worst;
}

/** Plan and place must agree (rule 6); returns the shared verdict. */
function tryRoad(s: CityState, type: RoadType, pts: Pt[], level: "ground" | "elevated" = "ground"): { ok: boolean; reason?: string } {
  const plan = planRoad(s, type, pts, level);
  const placed = placeRoad(s, type, pts, level);
  expect(placed.ok, `plan ${plan.ok}/${plan.reason} vs place ${placed.ok}/${"reason" in placed ? placed.reason : ""}`).toBe(plan.ok);
  if (!placed.ok) expect(placed.reason).toBe(plan.reason);
  return placed.ok ? { ok: true } : { ok: false, reason: placed.reason };
}

function graphSnapshot(s: CityState): string {
  return JSON.stringify({ segs: s.world.segments.map((g) => [g.id, g.type, g.a, g.b, g.pts]), nodes: s.world.nodes.length });
}

/** Every zoned cell is valid and its quad stays off every ground road's asphalt + kerb. */
function zonedCellsOnAsphalt(s: CityState): number {
  const w = s.world;
  const set = getZoneBlocks(w);
  const lines = w.segments.filter((g) => segElevation(g) === "ground")
    .map((g) => ({ half: profileOf(g.type).drawHalf, pts: curvePoints(g.pts, 0.1) }));
  const corners = new Float32Array(8);
  let bad = 0;
  for (const b of set.blocks.values()) for (let r = 0; r < b.rows; r++) for (let c = 0; c < CELL_DEPTH; c++) {
    const k = cellIndex(r, c);
    if (!b.zone[k]) continue;
    if (!b.valid[k]) { bad++; continue; }
    cellCorners(b, r, c, corners);
    const p = cellPose(b, r, c);
    // centre + corners pulled 5% in (shared edges with the sidewalk are allowed)
    const probes = [p, ...[0, 1, 2, 3].map((e) => ({ x: p.x + (corners[e * 2] - p.x) * 0.95, z: p.z + (corners[e * 2 + 1] - p.z) * 0.95 }))];
    if (probes.some((q) => lines.some((l) => distTo(q, l.pts) < l.half))) bad++;
  }
  return bad;
}

/** Oriented lots whose rectangle intrudes into any ground road's asphalt + kerb. */
function lotsOnAsphalt(s: CityState): number {
  const w = s.world;
  const lines = w.segments.filter((g) => segElevation(g) === "ground")
    .map((g) => ({ half: profileOf(g.type).drawHalf, pts: curvePoints(g.pts, 0.25) }));
  let bad = 0;
  for (const l of w.olots ?? []) {
    const c = Math.cos(l.yaw), sn = Math.sin(l.yaw);
    let hit = false;
    for (let a = -l.w / 2 + 0.1; a <= l.w / 2 - 0.1 && !hit; a += 0.25) {
      for (let b = -l.d / 2 + 0.1; b <= l.d / 2 - 0.1 && !hit; b += 0.25) {
        const q = { x: l.cx + a * c + b * sn, z: l.cz - a * sn + b * c };
        if (lines.some((ln) => distTo(q, ln.pts) < ln.half - 0.02)) hit = true;
      }
    }
    if (hit) bad++;
  }
  return bad;
}

describe("roads never overlap: they meet at a junction or are refused", () => {
  it("refuses a collinear overlap along an existing street", () => {
    const s = flatCity();
    expect(tryRoad(s, 1, [P(15, 15), P(35, 15)]).ok).toBe(true);
    const before = graphSnapshot(s);
    const r = tryRoad(s, 1, [P(25, 15), P(45, 15)]);
    expect(r).toEqual({ ok: false, reason: OVERLAP_REASON });
    expect(graphSnapshot(s)).toBe(before);
    // Also a slightly rotated copy lying over it (the owner's "one slightly rotated over the other").
    expect(tryRoad(s, 1, [P(16, 14.75), P(34, 15.3)]).ok).toBe(false);
    expect(graphSnapshot(s)).toBe(before);
    expect(worstFootprintOverlap(s)).toBe(0);
  });

  it("refuses a 3 degree sliver crossing with the angle reason", () => {
    const s = flatCity();
    expect(tryRoad(s, 1, [P(10, 20), P(50, 20)]).ok).toBe(true);
    const before = graphSnapshot(s);
    const rise = Math.tan((3 * Math.PI) / 180) * 30;
    const r = tryRoad(s, 1, [P(15, 20 - rise / 2), P(45, 20 + rise / 2)]);
    expect(r).toEqual({ ok: false, reason: CROSSING_ANGLE_REASON });
    expect(graphSnapshot(s)).toBe(before);
  });

  it("refuses a 12 degree arm leaving an existing junction (rule 1: >= 20 deg)", () => {
    const s = flatCity();
    expect(tryRoad(s, 1, [P(10, 20), P(30, 20)]).ok).toBe(true);
    expect(tryRoad(s, 1, [P(30, 20), P(50, 20)]).ok).toBe(true); // collinear continuation is fine
    const a = (12 * Math.PI) / 180;
    expect(tryRoad(s, 1, [P(30, 20), P(30 + Math.cos(a) * 15, 20 + Math.sin(a) * 15)])).toEqual({ ok: false, reason: CROSSING_ANGLE_REASON });
    // 25 degrees (a hard-case Y) is allowed: odd angles stay legal.
    const b = (25 * Math.PI) / 180;
    expect(tryRoad(s, 1, [P(30, 20), P(30 + Math.cos(b) * 15, 20 + Math.sin(b) * 15)]).ok).toBe(true);
    expect(worstFootprintOverlap(s)).toBe(0);
  });

  it("refuses a parallel road 0.3 tile off an existing one", () => {
    const s = flatCity();
    expect(tryRoad(s, 1, [P(10, 20), P(40, 20)]).ok).toBe(true);
    const before = graphSnapshot(s);
    expect(tryRoad(s, 1, [P(14, 20.3), P(36, 20.3)])).toEqual({ ok: false, reason: OVERLAP_REASON });
    expect(tryRoad(s, 2, [P(14, 20.3), P(36, 20.3)])).toEqual({ ok: false, reason: OVERLAP_REASON });
    // 1.0 tile apart: the two sidewalks would still overlap (0.57 + 0.57 > 1).
    expect(tryRoad(s, 1, [P(14, 21.0), P(36, 21.0)])).toEqual({ ok: false, reason: OVERLAP_REASON });
    expect(graphSnapshot(s)).toBe(before);
    // Clear of both footprints (> 1.14 tiles centre to centre) is a legal parallel street.
    expect(tryRoad(s, 1, [P(14, 21.3), P(36, 21.3)]).ok).toBe(true);
    expect(worstFootprintOverlap(s)).toBe(0);
  });

  it("refuses exact and near-duplicate segments (either direction), still allows the one-way flip", () => {
    const s = flatCity();
    expect(tryRoad(s, 1, [P(10, 20), P(30, 20)]).ok).toBe(true);
    const before = graphSnapshot(s);
    expect(tryRoad(s, 1, [P(10, 20), P(30, 20)])).toEqual({ ok: false, reason: DUPLICATE_ROAD_REASON });
    expect(tryRoad(s, 1, [P(30, 20), P(10, 20)])).toEqual({ ok: false, reason: DUPLICATE_ROAD_REASON });
    expect(tryRoad(s, 1, [P(10.2, 20.15), P(29.8, 19.8)])).toEqual({ ok: false, reason: DUPLICATE_ROAD_REASON });
    // A curve between the same two nodes that bulges onto the street is a duplicate too.
    expect(tryRoad(s, 1, [P(10, 20), P(20, 20.4), P(30, 20)])).toEqual({ ok: false, reason: DUPLICATE_ROAD_REASON });
    expect(graphSnapshot(s)).toBe(before);
    // A wider class paved over one whole segment widens it in place (no second segment).
    const n = s.world.segments.length;
    expect(tryRoad(s, 2, [P(10, 20), P(30, 20)]).ok).toBe(true);
    expect(s.world.segments.length).toBe(n);
    expect(s.world.segments.filter((g) => g.type === 2).length).toBe(1);
    // ...but paving a wider class along a street that has a junction in the middle would double it: refused.
    expect(tryRoad(s, 1, [P(20, 20), P(20, 10)]).ok).toBe(true);
    expect(tryRoad(s, 5, [P(10, 20), P(30, 20)])).toEqual({ ok: false, reason: OVERLAP_REASON });
    expect(worstFootprintOverlap(s)).toBe(0);
    // One-way: redrawing the same one-way road flips it (documented, free); that is not a duplicate.
    expect(tryRoad(s, 4, [P(10, 30), P(30, 30)]).ok).toBe(true);
    const ow = s.world.segments.find((g) => g.type === 4)!;
    const dir = ow.dir;
    expect(tryRoad(s, 4, [P(30, 30), P(10, 30)]).ok).toBe(true);
    expect(ow.dir).toBe(dir === -1 ? 1 : -1);
  });

  it("refuses a free end stopping on the side of a street, joins when it reaches the dead-end node", () => {
    const s = flatCity();
    expect(tryRoad(s, 1, [P(10, 20), P(30, 20)]).ok).toBe(true);
    const before = graphSnapshot(s);
    // End 0.8 beside the street (not on it): its cap would sit on the asphalt.
    expect(tryRoad(s, 1, [P(20, 10), P(20, 19.2)])).toEqual({ ok: false, reason: OVERLAP_REASON });
    // Mirror: a new road passing 0.75 beyond the existing dead end, across it: the old cap would sit on the new asphalt.
    expect(tryRoad(s, 1, [P(30.75, 10), P(30.75, 30)])).toEqual({ ok: false, reason: OVERLAP_REASON });
    expect(graphSnapshot(s)).toBe(before);
    // Within the merge radius the new road joins the dead-end node (a bend), no overlap.
    expect(tryRoad(s, 1, [P(30.3, 10), P(30.3, 20)]).ok).toBe(true);
    const corner = s.world.nodes.find((n) => Math.hypot(n.x - 30, n.z - 20) < 1e-6)!;
    expect(nodeArms(s.world, corner.id).length).toBe(2);
    expect(worstFootprintOverlap(s)).toBe(0);
  });

  it("a road crossing an existing junction node is split there (no pass-through without a node)", () => {
    const s = flatCity();
    expect(tryRoad(s, 1, [P(10, 20), P(40, 20)]).ok).toBe(true);
    expect(tryRoad(s, 1, [P(25, 8), P(25, 20)]).ok).toBe(true); // T at (25, 20)
    const tee = s.world.nodes.find((n) => Math.hypot(n.x - 25, n.z - 20) < 1e-6)!;
    expect(nodeArms(s.world, tee.id).length).toBe(3);
    // A diagonal straight through the T node (45 deg to both roads).
    expect(tryRoad(s, 1, [P(17, 12), P(33, 28)]).ok).toBe(true);
    expect(nodeArms(s.world, tee.id).length).toBe(5);
    expect(worstFootprintOverlap(s)).toBe(0);
  });

  it("accepts the legal cases: perpendicular cross, T, Y at 25 deg, parallel twin", () => {
    const s = flatCity();
    expect(tryRoad(s, 1, [P(10, 20), P(50, 20)]).ok).toBe(true);
    expect(tryRoad(s, 1, [P(20, 10), P(20, 30)]).ok).toBe(true); // cross
    expect(tryRoad(s, 1, [P(35, 20), P(35, 8)]).ok).toBe(true); // T
    const a = (25 * Math.PI) / 180;
    expect(tryRoad(s, 1, [P(35, 20), P(35 + Math.sin(a) * 12, 20 - Math.cos(a) * 12)]).ok).toBe(true); // Y, 25 deg off the T arm
    expect(tryRoad(s, 1, [P(10, 25.14), P(50, 25.14)]).ok).toBe(true); // parallel twin (street gap 2)
    expect(tryRoad(s, 2, [P(44, 10), P(44, 30)]).ok).toBe(true); // avenue crossing both
    expect(worstFootprintOverlap(s)).toBe(0);
  });

  it("bridges cross ground roads at any angle without a node (grade separation unchanged)", () => {
    const s = flatCity();
    expect(tryRoad(s, 1, [P(10, 30), P(50, 30)]).ok).toBe(true);
    const nodesBefore = s.world.nodes.length;
    const a = (30 * Math.PI) / 180;
    const c = P(30, 30);
    const r = tryRoad(s, 1, [P(c.x - Math.cos(a) * 10, c.z - Math.sin(a) * 10), P(c.x + Math.cos(a) * 10, c.z + Math.sin(a) * 10)], "elevated");
    expect(r.ok).toBe(true);
    const deck = s.world.segments.filter((g) => segElevation(g) === "bridge");
    expect(deck.length).toBe(1);
    const street = s.world.segments.filter((g) => segElevation(g) === "ground" && g.type === 1 && Math.abs(g.pts[0].z - 30) < 1e-6);
    expect(street.length).toBe(1); // not split under the deck
    expect(s.world.nodes.length).toBe(nodesBefore + 4); // 2 dead ends + 2 ramp joints, nothing on the street
  });
});

describe("zones and lots under a newly placed road", () => {
  function zonedStreet(zoning: "oriented" | "tiles") {
    const s = flatCity(64, zoning);
    expect(tryRoad(s, 1, [P(10, 20), P(50, 20)]).ok).toBe(true);
    for (let x = 11; x < 50; x += 0.5) for (const z of [19, 18, 21, 22]) applyZoneAt(s, ZONE.RES, x, z);
    syncLots(s);
    return s;
  }

  it("oriented: a crossing road clears the cells and lots it covers; none remain on asphalt", () => {
    const s = zonedStreet("oriented");
    const lotsBefore = s.world.olots!.length;
    expect(lotsBefore).toBeGreaterThan(8);
    // Build the lot that the new road will run over.
    const victim = s.world.olots!.find((l) => Math.abs(l.cx - 30) < 1.6 && l.cz < 20)!;
    expect(victim).toBeDefined();
    setOLotLevel(s.world, victim, 2);
    expect(tryRoad(s, 1, [P(30, 8), P(30, 32)]).ok).toBe(true);
    syncLots(s);
    expect(s.world.olots!.some((l) => l.id === victim.id)).toBe(false);
    expect(zonedCellsOnAsphalt(s)).toBe(0);
    expect(lotsOnAsphalt(s)).toBe(0);
    for (let i = 0; i < 30; i++) step(s);
    expect(zonedCellsOnAsphalt(s)).toBe(0);
    expect(lotsOnAsphalt(s)).toBe(0);
  });

  it("oriented: an avenue diagonal over zoned blocks leaves no cell or lot on its asphalt", () => {
    const s = zonedStreet("oriented");
    expect(tryRoad(s, 2, [P(22, 8), P(38, 32)]).ok).toBe(true);
    syncLots(s);
    expect(zonedCellsOnAsphalt(s)).toBe(0);
    expect(lotsOnAsphalt(s)).toBe(0);
  });

  it("tiles: the zoned tiles and built levels under the new road are cleared", () => {
    const s = zonedStreet("tiles");
    const w = s.world;
    const t = 18 * w.size + 30;
    expect(w.zone[t]).toBe(ZONE.RES);
    w.level[t] = 2;
    expect(tryRoad(s, 1, [P(30.5, 8), P(30.5, 32)]).ok).toBe(true);
    syncLots(s);
    expect(w.zone[t]).toBe(0);
    expect(w.level[t]).toBe(0);
    for (const lot of w.lots) for (let y = lot.y; y < lot.y + lot.h; y++) for (let x = lot.x; x < lot.x + lot.w; x++) {
      expect(w.road[y * w.size + x]).toBe(0);
    }
  });
});

describe("old saves keep their roads (rules apply to new placement only)", () => {
  it("a save holding overlapping legacy segments loads them unchanged", () => {
    const s = flatCity();
    // Legacy geometry written straight into the graph (no planRoad): a road lying 0.3 over another.
    addSegment(s.world, 1, [P(10, 20), P(40, 20)]);
    addSegment(s.world, 1, [P(12, 20.3), P(38, 21.1)]);
    const segs = s.world.segments.map((g) => [g.id, g.type, g.a, g.b, g.pts]);
    const back = deserialize(serialize(s));
    expect(back.world.segments.map((g) => [g.id, g.type, g.a, g.b, g.pts])).toEqual(segs);
  });
});
