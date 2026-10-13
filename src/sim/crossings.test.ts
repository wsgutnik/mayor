import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad, planRoad, CityState } from "./sim";
import { ROAD, cidx, hasDeck, hasTunnel, idx, segElevation } from "./world";
import { addSegment } from "./roads";
import { classifyCrossings, suggestInterchange, summarizeCrossings } from "./crossings";
import { deserialize, serialize } from "./save";

function flat(s: CityState): number {
  const ey = s.world.entry.y;
  for (let y = ey - 18; y <= ey + 18; y++)
    for (let x = 0; x <= 64; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e7;
  return ey;
}
const H = (ey: number, x0: number, x1: number) => [{ x: x0 + 0.5, z: ey + 0.5 }, { x: x1 + 0.5, z: ey + 0.5 }];
const V = (x: number, y0: number, y1: number) => [{ x: x + 0.5, z: y0 + 0.5 }, { x: x + 0.5, z: y1 + 0.5 }];

function highwayCity() {
  const s = newCity(3);
  const ey = flat(s);
  expect(placeRoad(s, ROAD.HIGHWAY, H(ey, 4, 32)).ok).toBe(true);
  return { s, ey };
}

describe("crossings: highways (rule 1)", () => {
  it("a ground street crossing a highway automatically becomes a bridge", () => {
    const { s, ey } = highwayCity();
    const plan = planRoad(s, ROAD.STREET, V(16, ey - 10, ey + 10));
    expect(plan.ok).toBe(true);
    expect(plan.span).toBe("bridge");
    expect(plan.crossings!.map((c) => c.kind)).toEqual(["overpass"]);
    expect(plan.crossings![0].tile).toBe(idx(s.world, 16, ey));
    expect(plan.pieces!.map((p) => p.elevation)).toEqual(["ground", "bridge", "ground"]);
    expect(plan.cost).toBeGreaterThan(plan.newTiles * 20);
    expect(placeRoad(s, ROAD.STREET, V(16, ey - 10, ey + 10)).ok).toBe(true);
    const w = s.world;
    expect(w.segments.filter((sg) => segElevation(sg) === "bridge").length).toBe(1);
    expect(w.nodes.some((n) => Math.abs(n.x - 16.5) < 0.1 && Math.abs(n.z - (ey + 0.5)) < 0.1)).toBe(false);
    expect(hasDeck(w, idx(w, 16, ey))).toBe(true);
    expect(w.roadSurface[idx(w, 16, ey)]).toBe(ROAD.HIGHWAY);
  });

  it("highway-to-highway crossings are always grade-separated", () => {
    const { s, ey } = highwayCity();
    const plan = planRoad(s, ROAD.HIGHWAY, V(16, ey - 10, ey + 10));
    expect(plan.ok).toBe(true);
    expect(plan.crossings!.map((c) => c.kind)).toEqual(["overpass"]);
    expect(plan.span).toBe("bridge");
    expect(placeRoad(s, ROAD.HIGHWAY, V(16, ey - 10, ey + 10)).ok).toBe(true);
    expect(s.world.nodes.some((n) => n.segs.length >= 4)).toBe(false);
  });

  it("a street drawn across a hill highway becomes an underpass", () => {
    const { s, ey } = highwayCity();
    const w = s.world;
    for (let y = ey - 2; y <= ey + 3; y++) for (let x = 14; x <= 19; x++) w.heights[cidx(w, x, y)] = 3.2;
    const plan = planRoad(s, ROAD.STREET, V(16, ey - 10, ey + 10));
    expect(plan.ok).toBe(true);
    expect(plan.crossings!.map((c) => c.kind)).toEqual(["underpass"]);
    expect(plan.span).toBe("tunnel");
    expect(placeRoad(s, ROAD.STREET, V(16, ey - 10, ey + 10)).ok).toBe(true);
    expect(hasTunnel(w, idx(w, 16, ey))).toBe(true);
  });

  it("a T-junction ending on a highway is refused", () => {
    const { s, ey } = highwayCity();
    const plan = planRoad(s, ROAD.STREET, V(16, ey - 8, ey));
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("Highways need an interchange");
    expect(plan.crossings!.some((c) => c.kind === "blocked")).toBe(true);
    expect(placeRoad(s, ROAD.STREET, V(16, ey - 8, ey))).toEqual({ ok: false, reason: "Highways need an interchange" });
  });

  it("a highway crossing too close to the drawn end is blocked", () => {
    const { s, ey } = highwayCity();
    const plan = planRoad(s, ROAD.STREET, V(16, ey - 2, ey + 10));
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("Highways need an interchange");
    expect(plan.crossings!.map((c) => c.kind)).toEqual(["blocked"]);
  });

  it("ordinary street crossings stay junctions, with counts", () => {
    const s = newCity(3);
    const ey = flat(s);
    expect(placeRoad(s, ROAD.STREET, H(ey, 4, 28)).ok).toBe(true);
    expect(placeRoad(s, ROAD.STREET, H(ey + 6, 4, 28)).ok).toBe(true);
    const plan = planRoad(s, ROAD.STREET, V(14, ey - 6, ey + 12));
    expect(plan.ok).toBe(true);
    expect(plan.span).toBeUndefined();
    expect(summarizeCrossings(plan.crossings!)).toMatchObject({ junction: 2, overpass: 0, underpass: 0, blocked: 0 });
    expect(placeRoad(s, ROAD.STREET, V(14, ey - 6, ey + 12)).ok).toBe(true);
    expect(s.world.nodes.filter((n) => n.segs.length === 4).length).toBe(2);
  });
});

describe("crossings: existing bridge/tunnel (rule 2)", () => {
  function deckCity() {
    const s = newCity(3);
    const ey = flat(s);
    expect(placeRoad(s, ROAD.STREET, H(ey, 4, 24)).ok).toBe(true);
    expect(placeRoad(s, ROAD.STREET, V(12, ey - 8, ey + 8), "elevated").ok).toBe(true);
    return { s, ey };
  }

  it("a ground road under a deck passes without a node at ground cost", () => {
    const { s, ey } = deckCity();
    const plan = planRoad(s, ROAD.STREET, H(ey - 3, 4, 22));
    expect(plan.ok).toBe(true);
    expect(plan.crossings!.map((c) => c.kind)).toEqual(["underpass"]);
    expect(plan.cost).toBe(plan.newTiles * 20);
    expect(placeRoad(s, ROAD.STREET, H(ey - 3, 4, 22)).ok).toBe(true);
    expect(s.world.nodes.some((n) => Math.abs(n.x - 12.5) < 0.1 && Math.abs(n.z - (ey - 2.5)) < 0.1)).toBe(false);
  });

  it("a ground road over a tunnel passes without a node", () => {
    const s = newCity(3);
    const ey = flat(s);
    expect(placeRoad(s, ROAD.AVENUE, H(ey, 4, 24)).ok).toBe(true);
    expect(placeRoad(s, ROAD.STREET, V(12, ey - 6, ey + 8), "tunnel").ok).toBe(true);
    const plan = planRoad(s, ROAD.STREET, H(ey + 1, 4, 22));
    expect(plan.crossings!.map((c) => c.kind)).toEqual(["overpass"]);
    expect(plan.cost).toBe(plan.newTiles * 20);
  });

  it("ends never snap onto a bridge or tunnel interior", () => {
    const { s, ey } = deckCity();
    const segsBefore = s.world.segments.length, nodesBefore = s.world.nodes.length;
    const plan = planRoad(s, ROAD.STREET, [{ x: 6.5, z: ey - 2.5 }, { x: 12.5, z: ey - 2.5 }]);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("Cannot connect to a bridge or tunnel");
    expect(plan.crossings!.some((c) => c.kind === "blocked")).toBe(true);
    expect(placeRoad(s, ROAD.STREET, [{ x: 6.5, z: ey - 2.5 }, { x: 12.5, z: ey - 2.5 }]).ok).toBe(false);
    expect(s.world.segments.length).toBe(segsBefore);
    expect(s.world.nodes.length).toBe(nodesBefore);
  });

  it("classifyCrossings is pure (does not split or mutate the world)", () => {
    const { s, ey } = deckCity();
    const segs = s.world.segments.length, nodes = s.world.nodes.length;
    const cs = classifyCrossings(s.world, ROAD.STREET, V(16, ey - 6, ey + 6), "ground");
    expect(cs.length).toBeGreaterThan(0);
    expect(s.world.segments.length).toBe(segs);
    expect(s.world.nodes.length).toBe(nodes);
  });
});

describe("crossings: ramps and short spans (rule 3)", () => {
  it("an Elevado crossing within 3 tiles of its end falls back to a ground junction", () => {
    const s = newCity(3);
    const ey = flat(s);
    expect(placeRoad(s, ROAD.STREET, H(ey, 4, 24)).ok).toBe(true);
    const plan = planRoad(s, ROAD.STREET, V(12, ey - 2, ey + 8), "elevated");
    expect(plan.ok).toBe(true);
    expect(plan.span).toBeUndefined();
    expect(plan.crossings!.map((c) => c.kind)).toEqual(["junction"]);
    expect(plan.pieces!.every((p) => p.elevation === "ground")).toBe(true);
    expect(plan.cost).toBe(plan.newTiles * 20);
    expect(placeRoad(s, ROAD.STREET, V(12, ey - 2, ey + 8), "elevated").ok).toBe(true);
    expect(s.world.nodes.some((n) => n.segs.length === 4)).toBe(true);
    expect(s.world.segments.some((sg) => segElevation(sg) === "bridge")).toBe(false);
  });

  it("an Elevado crossing well inside the span stays an overpass", () => {
    const s = newCity(3);
    const ey = flat(s);
    expect(placeRoad(s, ROAD.STREET, H(ey, 4, 24)).ok).toBe(true);
    const plan = planRoad(s, ROAD.STREET, V(12, ey - 8, ey + 8), "elevated");
    expect(plan.crossings!.map((c) => c.kind)).toEqual(["overpass"]);
    expect(plan.span).toBe("bridge");
  });
});

describe("crossings: interchange helper, bulldoze and save", () => {
  it("suggestInterchange returns four diamond ramps 6 tiles out", () => {
    const s = newCity(3);
    const ey = flat(s);
    const w = s.world;
    addSegment(w, ROAD.HIGHWAY, H(ey, 4, 32));
    addSegment(w, ROAD.AVENUE, V(16, ey - 9, ey + 9));
    const node = w.nodes.find((n) => n.segs.length >= 4)!;
    expect(node).toBeTruthy();
    const ramps = suggestInterchange(w, node.id);
    expect(ramps.length).toBe(4);
    for (const ramp of ramps) {
      expect(ramp.length).toBe(3);
      // Starts on the highway centreline, ends on the cross-road centreline.
      expect(Math.abs(ramp[0].z - (ey + 0.5))).toBeLessThan(0.6);
      expect(Math.abs(ramp[2].x - 16.5)).toBeLessThan(0.6);
      expect(Math.abs(ramp[0].x - 16.5)).toBeCloseTo(6, 0);
      for (const p of ramp) {
        expect(Math.abs(p.x - 16.5)).toBeLessThanOrEqual(6.01);
        expect(Math.abs(p.z - (ey + 0.5))).toBeLessThanOrEqual(6.01);
      }
    }
    expect(suggestInterchange(w, 99999)).toEqual([]);
    const endNode = w.nodes.find((n) => n.segs.length === 1)!;
    expect(suggestInterchange(w, endNode.id)).toEqual([]);
  });

  it("bulldozing an auto-overpass deck keeps the highway; saves round-trip", () => {
    const { s, ey } = highwayCity();
    expect(placeRoad(s, ROAD.STREET, V(16, ey - 10, ey + 10)).ok).toBe(true);
    const b = deserialize(serialize(s));
    expect(b.world.segments.filter((sg) => segElevation(sg) === "bridge").length).toBe(1);
    expect(b.world.roadSurface[idx(b.world, 16, ey)]).toBe(ROAD.HIGHWAY);
    expect(applyTool(s, "bulldoze", 16, ey - 4).ok).toBe(true);
    expect(s.world.segments.some((sg) => segElevation(sg) === "bridge")).toBe(false);
    expect(s.world.roadSurface[idx(s.world, 16, ey)]).toBe(ROAD.HIGHWAY);
  });
});
