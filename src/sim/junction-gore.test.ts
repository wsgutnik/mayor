import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad, planRoad } from "./sim";
import { junctionsOf, checkJunction } from "./junction";
import { pointInPolygon } from "./lanes";
import { triangulateRing } from "../render/earclip";
import { minTriAngleDeg } from "./showcase-cases";
import { addSegment } from "./roads";

const P = (x: number, z: number) => ({ x, z });
function build(entry: boolean) {
  const s = blankShowcaseCity();
  placeRoad(s, 3, [P(10.5, 40.5), P(70.5, 40.5)]);
  const pts = entry ? [P(20.5, 44.5), P(25, 41.6), P(30.5, 40.5)] : [P(30.5, 40.5), P(36, 41.6), P(40.5, 44.5)];
  expect(placeRoad(s, 6, pts).ok).toBe(true);
  const l = [...junctionsOf(s.world).byNode.values()].find((x) => x.kind === (entry ? "merge" : "diverge"))!;
  return { s, l };
}

describe("merge and diverge gores", () => {
  for (const entry of [false, true]) {
    it(`${entry ? "merge" : "diverge"}: kind, rings, connectors`, () => {
      const { l } = build(entry);
      expect(l).toBeTruthy();
      expect(checkJunction(l).errors).toEqual([]);
      expect(l.gore!.side).toBe(1);                        // eastbound carriageway is the +z side
      expect(l.gore!.length).toBeGreaterThanOrEqual(2);
      // Ramp lane connects only to the outer eastbound lane.
      const ramp = l.gore!.rampArm;
      const rampConns = l.connectors!.filter((c) => (entry ? c.inArm === ramp : c.outArm === ramp));
      expect(rampConns).toHaveLength(1);
      // Through lanes: 3 each way, straight.
      const through = l.connectors!.filter((c) => c.inArm !== ramp && c.outArm !== ramp);
      expect(through).toHaveLength(6);
      for (const c of l.connectors!) for (const p of c.points) expect(pointInPolygon(p, l.asphalt)).toBe(true);
      expect(l.arms.every((a) => a.markingsSuppressed)).toBe(true);
    });
  }

  it("keeps opposite-side and steep legal gores valid and sliver-free", () => {
    const cases = [
      { kind: "diverge", side: -1, pts: [P(50.5, 40.5), P(45, 39.4), P(40.5, 36.5)] },
      { kind: "merge", side: -1, pts: [P(40.5, 36.5), P(35, 39.4), P(30.5, 40.5)] },
      { kind: "diverge", side: 1, pts: [P(30.5, 40.5), P(39.246, 45.348)] },
    ] as const;
    for (const c of cases) {
      const s = blankShowcaseCity();
      expect(placeRoad(s, 3, [P(10.5, 40.5), P(70.5, 40.5)]).ok).toBe(true);
      expect(placeRoad(s, 6, [...c.pts]).ok).toBe(true);
      const l = [...junctionsOf(s.world).byNode.values()].find((x) => x.kind === c.kind)!;
      expect(checkJunction(l).errors).toEqual([]);
      expect(l.gore!.side).toBe(c.side);
      expect(l.connectors).toHaveLength(7);
      for (const [a, b, d] of triangulateRing(l.asphalt)) {
        expect(minTriAngleDeg({ ax: a.x, az: a.z, bx: b.x, bz: b.z, cx: d.x, cz: d.z })).toBeGreaterThanOrEqual(2);
      }
    }
  });

  const rotated = (p: { x: number; z: number }, degrees: number, c = P(40.5, 40.5)) => {
    const a = degrees * Math.PI / 180, dx = p.x - c.x, dz = p.z - c.z;
    return P(c.x + dx * Math.cos(a) - dz * Math.sin(a), c.z + dx * Math.sin(a) + dz * Math.cos(a));
  };

  const distToRing = (p: { x: number; z: number }, ring: { x: number; z: number }[]) => {
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      const t = d2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / d2));
      best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
    }
    return best;
  };

  it("keeps the full legal angle sweep clean, sliver-free, contained, and off ribbon mouths", () => {
    for (const rotation of [0, 33, 135]) for (const entry of [false, true]) {
      for (let deg = 10.25; deg <= 30; deg += 0.25) {
        const s = blankShowcaseCity(), c = P(40.5, 40.5);
        addSegment(s.world, 3, [rotated(P(10.5, 40.5), rotation), rotated(P(70.5, 40.5), rotation)]);
        const a = deg * Math.PI / 180;
        const far = entry
          ? P(c.x - 18 * Math.cos(a), c.z + 18 * Math.sin(a))
          : P(c.x + 18 * Math.cos(a), c.z + 18 * Math.sin(a));
        addSegment(s.world, 6, entry
          ? [rotated(far, rotation), c]
          : [c, rotated(far, rotation)]);
        const kind = entry ? "merge" : "diverge";
        const l = [...junctionsOf(s.world).byNode.values()].find((x) => x.kind === kind)!;
        const label = `${kind} ${deg.toFixed(2)}deg rot${rotation}`;
        expect(l, label).toBeTruthy();
        expect(checkJunction(l).errors, label).toEqual([]);
        expect(l.gore!.length, label).toBeGreaterThanOrEqual(l.gore!.noseStation + 0.5 - 1e-3);
        for (const tri of triangulateRing(l.asphalt)) {
          expect(minTriAngleDeg({ ax: tri[0].x, az: tri[0].z, bx: tri[1].x, bz: tri[1].z, cx: tri[2].x, cz: tri[2].z }), label)
            .toBeGreaterThanOrEqual(2);
        }
        for (const connector of l.connectors) for (const p of connector.points) {
          expect(pointInPolygon(p, l.asphalt), label).toBe(true);
        }
        // The render overlap helper is test-local, so guard its seam oracle:
        // every highway/ramp ribbon mouth lies on the pad boundary, not inside it.
        for (const arm of l.arms.filter((x) => x.type === 3 || x.type === 6)) {
          const mouth = arm.mouth!.asphalt!;
          for (const [side, p] of [[-1, mouth.neg.p], [1, mouth.pos.p]] as const) {
            const strictlyInside = pointInPolygon(p, l.asphalt) && distToRing(p, l.asphalt) > 1e-4;
            expect(strictlyInside, `${label} seg${arm.segId} side${side} d=${distToRing(p, l.asphalt)}`).toBe(false);
          }
        }
      }
    }
  });

  for (const [name, side] of [["inside", 1], ["outside", -1]] as const) {
    for (const [label, mid] of [["sharp", 35.5], ["gentle radius-150", 37.5], ["very gentle", 39.5]] as const) {
      it(`refuses a ramp on the ${name} of a ${label} bend (curved highway)`, () => {
        const s = blankShowcaseCity();
        const highway = placeRoad(s, 3, [P(20.5, 40.5), P(40.5, mid), P(60.5, 40.5)]);
        expect(highway.ok, "reason" in highway ? highway.reason : undefined).toBe(true);
        // Quadratic midpoint (t = 0.5) sits on the bend with an east tangent.
        const c = P(40.5, 0.5 * 40.5 + 0.5 * mid), a = 25 * Math.PI / 180;
        const far = P(c.x + 12 * Math.cos(a), c.z + side * 12 * Math.sin(a));
        expect(planRoad(s, 6, [c, far]))
          .toMatchObject({ ok: false, reason: "Ramps need a straight stretch of highway" });
      });
    }
  }

  it("reports a clamp only when rounded values really changed", () => {
    const s = blankShowcaseCity();
    expect(placeRoad(s, 3, [P(10.5, 40.5), P(70.5, 40.5)]).ok).toBe(true);
    const a = 29 * Math.PI / 180;
    expect(placeRoad(s, 6, [P(30.5, 40.5), P(30.5 + 16 * Math.cos(a), 40.5 + 16 * Math.sin(a))]).ok).toBe(true);
    const l = [...junctionsOf(s.world).byNode.values()].find((x) => x.kind === "diverge")!;
    expect(l.diagnostics.some((d) => d.code === "gore-clamped")).toBe(false);
  });
});
