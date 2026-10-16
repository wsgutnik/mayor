import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { placeRoad, planRoad } from "./sim";
import { cidx, segElevation } from "./world";

const P = (x: number, z: number) => ({ x, z });
const len = (pts: { x: number; z: number }[]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - pts[i].x, p.z - pts[i].z), 0);

describe("auto grade separation lifts a local span", () => {
  it("a 60-tile avenue over a highway is ground-bridge-ground with a short bridge", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 3, [P(8.5, 48.5), P(48.5, 48.5)]);
    placeRoad(s, 3, [P(48.5, 48.5), P(88.5, 48.5)]);
    const plan = planRoad(s, 2, [P(48.5, 18.5), P(48.5, 78.5)]);
    expect(plan.ok).toBe(true);
    expect(plan.pieces!.map((p) => p.elevation)).toEqual(["ground", "bridge", "ground"]);
    expect(len(plan.pieces![1].pts)).toBeLessThanOrEqual(2 * (1.4 + 0.25 + 3 + 1) + 0.5);
  });

  it("a street crossing two highways gets two local bridges", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 3, [P(8.5, 40.5), P(48.5, 40.5)]);
    placeRoad(s, 3, [P(8.5, 60.5), P(48.5, 60.5)]);
    const plan = planRoad(s, 2, [P(30.5, 20.5), P(30.5, 80.5)]);
    expect(plan.ok).toBe(true);
    expect(plan.pieces!.map((p) => p.elevation)).toEqual(["ground", "bridge", "ground", "bridge", "ground"]);
    expect(placeRoad(s, 2, [P(30.5, 20.5), P(30.5, 80.5)]).ok).toBe(true);
    expect(s.world.segments.filter((g) => g.type === 2 && segElevation(g) === "bridge")).toHaveLength(2);
  });

  it("water on the same stroke still becomes a bridge", () => {
    for (const [z0, z1] of [[24, 28], [38, 42], [60, 64]]) {
      const s = blankShowcaseCity();
      s.money = 1e8;
      placeRoad(s, 3, [P(8.5, 48.5), P(48.5, 48.5)]);
      placeRoad(s, 3, [P(48.5, 48.5), P(88.5, 48.5)]);
      for (let y = z0; y <= z1; y++) for (let x = 44; x <= 54; x++) s.world.heights[cidx(s.world, x, y)] = -1;
      const plan = planRoad(s, 2, [P(48.5, 20.5), P(48.5, 76.5)]);
      expect(plan.reason).toBeUndefined();
      expect(plan.ok).toBe(true);
      expect(plan.pieces!.some((p) => p.elevation === "bridge")).toBe(true);
      expect(placeRoad(s, 2, [P(48.5, 20.5), P(48.5, 76.5)]).ok).toBe(true);
    }
  });

  it("never leaves a ground piece shorter than 3 tiles between decks", () => {
    for (const gap of [11.5, 12, 13, 14, 15, 16]) {
      const s = blankShowcaseCity();
      placeRoad(s, 3, [P(8.5, 40.5), P(48.5, 40.5)]);
      placeRoad(s, 3, [P(8.5, 40.5 + gap), P(48.5, 40.5 + gap)]);
      const plan = planRoad(s, 2, [P(30.5, 20.5), P(30.5, 80.5)]);
      expect(plan.ok).toBe(true);
      const ps = plan.pieces!;
      ps.forEach((p, i) => { if (p.elevation === "ground" && i > 0 && i < ps.length - 1) expect(len(p.pts)).toBeGreaterThanOrEqual(3); });
    }
  });
});
