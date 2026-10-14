import { describe, expect, it } from "vitest";
import { makeRng } from "./rng";
import {
  FableLotType, KIND, MIN_RECT_TILE, SURF, checkGroundPlan, mayorGroundType,
  planLot, planMayorLot, rectWorld,
} from "./lotground";

const TYPES: FableLotType[] = ["res-low", "res-high", "com-low", "com-high", "office", "ind"];

describe("lot ground plans (fable GroundPlan.js, metres ÷ 8)", () => {
  it("tiles every integer lot exactly once: disjoint, inside, no thin rects", () => {
    for (const type of TYPES) {
      const rng = makeRng(1000 + type.length * 77 + type.charCodeAt(0));
      for (let n = 0; n < 1000; n++) {
        const w = 1 + Math.floor(rng() * 4), d = 1 + Math.floor(rng() * 4);
        const rects = planLot(w, d, type, rng);
        expect(rects.length).toBeGreaterThan(0);
        const check = checkGroundPlan(w, d, rects);
        expect(check.inside).toBe(true);
        expect(check.overlap).toBeLessThan(1e-9);
        // Rects (built surfaces plus NONE grass gaps) tile the lot exactly once.
        expect(Math.abs(check.area - w * d)).toBeLessThan(1e-6);
        expect(check.minSide).toBeGreaterThanOrEqual(MIN_RECT_TILE - 1e-9);
      }
    }
  });

  it("keeps res-low mostly terrain grass and hard zones mostly paving", () => {
    const hard = (type: FableLotType) => {
      const rects = planLot(4, 4, type, makeRng(3));
      const area = rects.filter((r) => r.surf !== SURF.NONE)
        .reduce((s, r) => s + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
      return area / 16;
    };
    expect(hard("res-low")).toBeLessThan(0.5);
    expect(hard("com-low")).toBeGreaterThan(0.9);
    expect(hard("ind")).toBeGreaterThan(0.9);
  });

  it("pins the converted band constants", () => {
    // Footway bands from the kerb: res-low 1.4 m, com-low 2.2 m, com-high 3.4 m.
    const first = (type: FableLotType) => planLot(4, 4, type, makeRng(11))[0];
    expect(first("res-low").v1).toBeCloseTo(1.4 / 8, 12);
    expect(first("com-low").v1).toBeCloseTo(2.2 / 8, 12);
    expect(first("com-high").v1).toBeCloseTo(3.4 / 8, 12);
    expect(first("com-low").kind).toBe(KIND.PLAZA);
    expect(MIN_RECT_TILE).toBe(0.044);
  });

  it("is deterministic per lot id", () => {
    for (const [zone, level] of [[1, 1], [1, 3], [2, 3], [3, 2]] as const) {
      const a = planMayorLot(3, 2, zone, level, 42);
      const b = planMayorLot(3, 2, zone, level, 42);
      expect(b).toEqual(a);
      expect(a.length).toBeGreaterThan(0);
    }
  });

  it("maps Mayor zone/level/area to fable types (§1.2)", () => {
    expect(mayorGroundType(1, 1, 1)).toBe("res-low");
    expect(mayorGroundType(1, 2, 2)).toBe("res-low");
    expect(mayorGroundType(1, 2, 4)).toBe("res-high");
    expect(mayorGroundType(1, 3, 1)).toBe("res-high");
    expect(mayorGroundType(2, 1, 9)).toBe("com-low");
    expect(mayorGroundType(2, 2, 9)).toBe("com-low");
    expect(mayorGroundType(2, 3, 8)).toBe("com-high");
    expect(mayorGroundType(2, 3, 9)).toBe("office");
    expect(mayorGroundType(3, 1, 1)).toBe("ind");
  });

  it("maps rects to world pads with the kerb band at the road edge", () => {
    const pose = { cx: 10, cz: 20, yaw: 0, w: 4, d: 2 };
    const full = rectWorld({ u0: 0, v0: 0, u1: 4, v1: 2, surf: SURF.PAVE, kind: 0 }, pose);
    expect(full).toEqual({ x: 10, z: 20, sx: 4, sz: 2, yaw: 0 });
    // v = 0 (kerb) is the +d/2 edge, matching orientedKerb's front edge.
    const kerb = rectWorld({ u0: 0, v0: 0, u1: 4, v1: 0.5, surf: SURF.PAVE, kind: 0 }, pose);
    expect(kerb.x).toBeCloseTo(10);
    expect(kerb.z).toBeCloseTo(20.75);
    // Rotation preserves rect size and stays inside the rotated lot.
    const rot = rectWorld({ u0: 1, v0: 0, u1: 3, v1: 1, surf: SURF.ASPH, kind: 0 }, { ...pose, yaw: Math.PI / 2 });
    expect(rot.sx).toBeCloseTo(2);
    expect(rot.sz).toBeCloseTo(1);
    expect(Math.abs(rot.x - 10) + Math.abs(rot.z - 20)).toBeLessThanOrEqual(3);
  });
});
