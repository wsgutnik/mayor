// src/sim/ramp-rules.test.ts
import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { CROSSING_ANGLE_REASON, placeRoad, planRoad, planRoadUpgrade } from "./sim";
import { GORE_PROXIMITY_REASON, INTERCHANGE_REASON, RAMP_ANGLE_REASON, RAMP_DIRECTION_REASON } from "./crossings";
import { connectable } from "../ui/road-snap";
import { ZONE, idx } from "./world";
import { junctionsOf } from "./junction";
import { triangulateRing } from "../render/earclip";

type V = { x: number; z: number };
/** Overlap area of two triangles by Sutherland-Hodgman clipping. */
function clipArea(subject: V[], clip0: V[]): number {
  const area = (p: V[]) => p.reduce((t, a, i) => { const b = p[(i + 1) % p.length]; return t + a.x * b.z - b.x * a.z; }, 0) / 2;
  const clip = area(clip0) < 0 ? [...clip0].reverse() : clip0;
  let poly: V[] = [...subject];
  for (let i = 0; i < 3 && poly.length; i++) {
    const a = clip[i], b = clip[(i + 1) % 3];
    const cr = (p: V) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    const input = poly; poly = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length], cp = cr(p), cq = cr(q);
      if (cp >= -1e-10) poly.push(p);
      if ((cp >= -1e-10) === (cq >= -1e-10)) continue;
      const t = cp / (cp - cq);
      poly.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return poly.length < 3 ? 0 : Math.abs(area(poly));
}

const P = (x: number, z: number) => ({ x, z });
function hw() {
  const s = blankShowcaseCity();
  expect(placeRoad(s, 3, [P(10.5, 40.5), P(70.5, 40.5)]).ok).toBe(true); // eastbound carriageway on +z side
  return s;
}
// Exit on the eastbound side: starts on the highway, leaves at ~20° to the south-east.
const exitPts = [P(30.5, 40.5), P(36, 41.6), P(40.5, 44.5)];

describe("ramp rules", () => {
  it("a street still cannot end on a highway", () => {
    const s = hw();
    expect(planRoad(s, 1, [P(30.5, 48.5), P(30.5, 40.5)]).reason).toBe(INTERCHANGE_REASON);
  });
  it("a ramp leaving the eastbound side at ~20° is accepted as a junction", () => {
    const s = hw();
    const plan = planRoad(s, 6, exitPts);
    expect(plan.ok).toBe(true);
    expect(plan.crossings!.some((c) => c.kind === "junction" && c.atEnd)).toBe(true);
  });
  it("a ramp at 60° is refused with the angle reason", () => {
    const s = hw();
    expect(planRoad(s, 6, [P(30.5, 40.5), P(35.5, 49.1)]).reason).toBe(RAMP_ANGLE_REASON);
  });
  it("an exit drawn toward the highway on the eastbound side (arriving against traffic) is refused", () => {
    const s = hw();
    // Same geometry, stroke reversed: it would ENTER heading west into the eastbound carriageway.
    expect(planRoad(s, 6, exitPts.slice().reverse()).reason).toBe(RAMP_DIRECTION_REASON);
  });
  it("an entry on the eastbound side arriving heading east is accepted", () => {
    const s = hw();
    expect(planRoad(s, 6, [P(20.5, 44.5), P(25, 41.6), P(30.5, 40.5)]).ok).toBe(true);
  });
  it("a ramp may end on a street normally", () => {
    const s = hw();
    placeRoad(s, 1, [P(40.5, 44.5), P(40.5, 56.5)]);
    expect(planRoad(s, 6, exitPts).ok).toBe(true);
  });
});

// Note: a ramp at ~11° passes the 10° rule but is refused by the physical
// overlap rule (footprints run together), so the effective lower bound is
// ~12° for a 0.85-wide ramp. Angle-boundary tests use 9°/29°/31° to stay
// clear of that overlap band.
const angPts = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  return [P(30.5, 40.5), P(30.5 + 10 * Math.cos(r), 40.5 + 10 * Math.sin(r))];
};

describe("ramp rules fix round 1", () => {
  it("refuses two same-side gores six tiles apart", () => {
    const s = hw();
    const first = [P(50.5, 40.5), P(44.5, 39.3), P(40.5, 36.5)];
    const second = [P(44.5, 40.5), P(38.5, 39.3), P(34.5, 36.5)];
    expect(placeRoad(s, 6, first).ok).toBe(true);
    expect(planRoad(s, 6, second)).toMatchObject({ ok: false, reason: GORE_PROXIMITY_REASON });
  });
  it("westbound exit and entry are accepted", () => {
    const s = hw();
    // Exit: starts on the highway, leaves west-north at ~11°.
    expect(planRoad(s, 6, [P(50.5, 40.5), P(45, 39.4), P(40.5, 36.5)]).ok).toBe(true);
    // Entry: arrives heading west from the east-north.
    expect(planRoad(s, 6, [P(40.5, 36.5), P(35, 39.4), P(30.5, 40.5)]).ok).toBe(true);
  });
  it("westbound wrong-way is refused", () => {
    const s = hw();
    // Exit heading east on the -z side.
    expect(planRoad(s, 6, [P(30.5, 40.5), P(36, 39.4), P(40.5, 36.5)]).reason).toBe(RAMP_DIRECTION_REASON);
    // Entry arriving heading east on the -z side.
    expect(planRoad(s, 6, [P(20.5, 36.5), P(25, 39.4), P(30.5, 40.5)]).reason).toBe(RAMP_DIRECTION_REASON);
  });
  it("refuses a ramp on a curved highway below the 120-tile radius floor", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 3, [P(20.5, 40.5), P(40.5, 35.5), P(60.5, 40.5)]).ok).toBe(true);
    // At t=0.5 the tangent is east and the quadratic's radius is 80 tiles.
    const a = 25 * Math.PI / 180;
    expect(planRoad(s, 6, [P(40.5, 38), P(40.5 + 12 * Math.cos(a), 38 + 12 * Math.sin(a))]))
      .toMatchObject({ ok: false, reason: "Ramps need a straight stretch of highway" });
  });
  it("contact at an existing mid node is accepted", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 3, [P(10.5, 40.5), P(40.5, 40.5)]).ok).toBe(true);
    expect(placeRoad(s, 3, [P(40.5, 40.5), P(70.5, 40.5)]).ok).toBe(true);
    expect(planRoad(s, 6, [P(40.5, 40.5), P(46, 41.6), P(50.5, 44.5)]).ok).toBe(true);
  });
  it("contact at a highway end node is accepted", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 3, [P(10.5, 40.5), P(40.5, 40.5)]).ok).toBe(true);
    expect(planRoad(s, 6, [P(40.5, 40.5), P(46, 41.6), P(50.5, 44.5)]).ok).toBe(true);
    const t = blankShowcaseCity();
    expect(placeRoad(t, 3, [P(20.5, 40.5), P(60.5, 40.5)]).ok).toBe(true);
    expect(planRoad(t, 6, [P(10.5, 44.5), P(15, 41.6), P(20.5, 40.5)]).ok).toBe(true);
  });
  it("9° is refused with the angle reason", () => {
    const s = hw();
    expect(planRoad(s, 6, angPts(9)).reason).toBe(RAMP_ANGLE_REASON);
  });
  it("29° is accepted", () => {
    const s = hw();
    expect(planRoad(s, 6, angPts(29)).ok).toBe(true);
  });
  it("31° is refused with the angle reason", () => {
    const s = hw();
    expect(planRoad(s, 6, angPts(31)).reason).toBe(RAMP_ANGLE_REASON);
  });
  it("ramp->highway upgrade is refused when the ramp's other end is a street", () => {
    const s = hw();
    expect(placeRoad(s, 1, [P(40.5, 44.5), P(40.5, 56.5)]).ok).toBe(true);
    expect(placeRoad(s, 6, exitPts).ok).toBe(true);
    const ramp = s.world.segments.find((sg) => sg.type === 6)!;
    expect(planRoadUpgrade(s, ramp.id, 3)).toMatchObject({ ok: false, reason: INTERCHANGE_REASON });
  });
  it("street->highway upgrade is refused when a ramp tip on it is at a bad angle", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 1, [P(10.5, 40.5), P(30.5, 40.5)]).ok).toBe(true);
    const r = (60 * Math.PI) / 180;
    const far = P(30.5 + 10 * Math.cos(r), 40.5 + 10 * Math.sin(r));
    expect(placeRoad(s, 6, [P(30.5, 40.5), far]).ok).toBe(true);
    const street = s.world.segments.find((sg) => !sg.fixed && sg.type === 1)!;
    expect(planRoadUpgrade(s, street.id, 3)).toMatchObject({ ok: false, reason: RAMP_ANGLE_REASON });
  });
  it("street->highway upgrade is refused when a ramp tip on it is against traffic", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 1, [P(10.5, 40.5), P(30.5, 40.5)]).ok).toBe(true);
    const r = (155 * Math.PI) / 180;
    const far = P(30.5 + 10 * Math.cos(r), 40.5 + 10 * Math.sin(r));
    expect(placeRoad(s, 6, [P(30.5, 40.5), far]).ok).toBe(true);
    const street = s.world.segments.find((sg) => !sg.fixed && sg.type === 1)!;
    expect(planRoadUpgrade(s, street.id, 3)).toMatchObject({ ok: false, reason: RAMP_DIRECTION_REASON });
  });
  it("street->highway upgrade is accepted when the ramp tip is valid", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 1, [P(10.5, 40.5), P(30.5, 40.5)]).ok).toBe(true);
    const r = (25 * Math.PI) / 180;
    const far = P(30.5 + 10 * Math.cos(r), 40.5 + 10 * Math.sin(r));
    expect(placeRoad(s, 6, [P(30.5, 40.5), far]).ok).toBe(true);
    const street = s.world.segments.find((sg) => !sg.fixed && sg.type === 1)!;
    expect(planRoadUpgrade(s, street.id, 3).ok).toBe(true);
  });
  it("street->highway upgrade applies the same 120-tile curvature floor", () => {
    const s = blankShowcaseCity();
    // The endpoint tangent is east and the endpoint radius is 80 tiles.
    expect(placeRoad(s, 1, [P(20.5, 40.5), P(40.5, 30.5), P(60.5, 30.5)]).ok).toBe(true);
    const a = 25 * Math.PI / 180;
    expect(placeRoad(s, 6, [P(60.5, 30.5), P(60.5 + 10 * Math.cos(a), 30.5 + 10 * Math.sin(a))]).ok).toBe(true);
    const street = s.world.segments.find((sg) => !sg.fixed && sg.type === 1)!;
    expect(planRoadUpgrade(s, street.id, 3))
      .toMatchObject({ ok: false, reason: "Ramps need a straight stretch of highway" });
  });

  // Two 3-point ramps on the same (+z) side whose far ends bend apart, so the
  // exit (at X-d) and the entry (at X+d) never cross each other at grade.
  const pairFixture = (deg: number, d: number) => {
    const a = deg * Math.PI / 180, c = 3, c2 = Math.cos(a), s2 = Math.sin(a);
    const x0 = 40.5 - d, x1 = 40.5 + d;
    const exit = [P(x0, 40.5), P(x0 + c * c2, 40.5 + c * s2), P(x0 + c * c2 - 1, 40.5 + c * s2 + 9)];
    const entry = [P(x1 - c * c2 + 1, 40.5 + c * s2 + 9), P(x1 - c * c2, 40.5 + c * s2), P(x1, 40.5)];
    return { exit, entry };
  };
  const padOverlap = (s: ReturnType<typeof hw>): number => {
    const pads = [...junctionsOf(s.world).byNode.values()].filter((l) => l.gore);
    expect(pads.length).toBe(2);
    const t0 = triangulateRing(pads[0].asphalt), t1 = triangulateRing(pads[1].asphalt);
    let sum = 0;
    for (const a of t0) for (const b of t1) sum += clipArea(a, b);
    return sum;
  };

  it.each([
    [20, 6],
    [20, 8],
    [15, 8],
    [12.5, 10],
  ])("accepts non-overlapping same-side exit/entry pads at %s degrees and d=%s", (deg, d) => {
    const s = hw();
    const { exit, entry } = pairFixture(deg, d);
    expect(placeRoad(s, 6, exit).ok).toBe(true);
    const plan = planRoad(s, 6, entry);
    expect(plan.ok, plan.reason).toBe(true);
    expect(placeRoad(s, 6, entry).ok).toBe(true);
    expect(padOverlap(s)).toBeLessThanOrEqual(1e-4);
  });

  it.each([
    [15, 7],
    [20, 5.5],
    [25, 4.5],
    [29, 3.5],
  ])("refuses overlapping exit-then-entry pads at %s degrees and d=%s", (deg, d) => {
    const s = hw();
    const { exit, entry } = pairFixture(deg, d);
    expect(placeRoad(s, 6, exit).ok).toBe(true);
    expect(planRoad(s, 6, entry)).toMatchObject({ ok: false, reason: GORE_PROXIMITY_REASON });
  });

  it.each([
    [12.5, 3], [12.5, 5.5], [15, 4.5], [20, 3.5], [29, 2],
  ])("refuses overlapping entry-entry pads at %s degrees and d=%s", (deg, d) => {
    const s = hw();
    const a = deg * Math.PI / 180, c2 = Math.cos(a), s2 = Math.sin(a), c = 3;
    const mk = (x: number) => [P(x - c * c2 + 1, 40.5 + c * s2 + 9), P(x - c * c2, 40.5 + c * s2), P(x, 40.5)];
    expect(placeRoad(s, 6, mk(40.5)).ok).toBe(true);
    expect(planRoad(s, 6, mk(40.5 + d)).ok).toBe(false);
  });

  it("refuses a ramp on any curved highway, even a gentle bend, and accepts a straight one", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 3, [P(20.5, 40.5), P(40.5, 39.5), P(60.5, 40.5)]).ok).toBe(true);
    const a = 25 * Math.PI / 180;
    expect(planRoad(s, 6, [P(40.5, 40), P(40.5 + 12 * Math.cos(a), 40 + 12 * Math.sin(a))]))
      .toMatchObject({ ok: false, reason: "Ramps need a straight stretch of highway" });
  });
  it("street->ramp upgrade runs the strand-lots check", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 1, [P(10.5, 50.5), P(19.5, 50.5)]).ok).toBe(true);
    s.world.zone[idx(s.world, 14, 49)] = ZONE.RES;
    const street = s.world.segments.find((sg) => !sg.fixed && sg.type === 1)!;
    expect(planRoadUpgrade(s, street.id, 6)).toMatchObject({ ok: false, reason: "Highway would strand lots" });
  });
  it("road-snap connectable allows ramp-highway but not street-highway", () => {
    const s = hw();
    const seg = s.world.segments.find((sg) => sg.type === 3)!;
    expect(connectable(seg, 6)).toBe(true);
    expect(connectable(seg, 1)).toBe(false);
  });
  it("the 20° exemption is only for ramp-highway: street at 15° to street still refused", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 1, [P(10.5, 40.5), P(70.5, 40.5)]).ok).toBe(true);
    const r = (15 * Math.PI) / 180;
    const pts = [P(30.5, 40.5), P(30.5 + 10 * Math.cos(r), 40.5 + 10 * Math.sin(r))];
    expect(planRoad(s, 1, pts).reason).toBe(CROSSING_ANGLE_REASON);
  });
  it("a ramp at a node whose highway arms are collinear is accepted", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 3, [P(10.5, 40.5), P(40.5, 40.5)]).ok).toBe(true);
    expect(placeRoad(s, 3, [P(40.5, 40.5), P(70.5, 40.5)]).ok).toBe(true);
    const a = 20 * Math.PI / 180;
    expect(planRoad(s, 6, [P(40.5, 40.5), P(40.5 + 12 * Math.cos(a), 40.5 + 12 * Math.sin(a))]).ok).toBe(true);
  });
  it("a ramp at a bend node of the highway is refused as not straight", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 3, [P(10.5, 40.5), P(40.5, 40.5)]).ok).toBe(true);
    expect(placeRoad(s, 3, [P(40.5, 40.5), P(40.5, 10.5)]).ok).toBe(true);
    // ~17° to the north arm (valid), ~73° to the east arm: best arm wins.
    expect(planRoad(s, 6, [P(40.5, 40.5), P(43.5, 30.5)]))
      .toMatchObject({ ok: false, reason: "Ramps need a straight stretch of highway" });
  });
});
