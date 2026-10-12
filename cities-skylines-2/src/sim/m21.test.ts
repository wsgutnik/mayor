import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad, CityState } from "./sim";
import { deserialize, serialize } from "./save";
import { findPath, newTraffic } from "./traffic";
import { planProps } from "./props";
import { cidx, idx, RoadType } from "./world";

function flat(s: CityState) {
  const ey = s.world.entry.y;
  for (let y = ey - 14; y <= ey + 16; y++)
    for (let x = 0; x <= 60; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e7;
  return ey;
}

const road = (s: CityState, type: RoadType, pts: [number, number][]) => {
  const r = placeRoad(s, type, pts.map(([x, y]) => ({ x, z: y })));
  expect(r.ok).toBe(true);
};

const path = (s: CityState, ax: number, ay: number, bx: number, by: number) => {
  const t = newTraffic(s.world.size);
  return findPath(s.world, t.load, idx(s.world, ax, ay), idx(s.world, bx, by));
};

describe("one-way roads", () => {
  const loopCity = (): { s: CityState; ey: number } => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 4, [[5.5, ey + 0.5], [20.5, ey + 0.5]]); // eastbound one-way street
    road(s, 1, [[5.5, ey + 4.5], [20.5, ey + 4.5]]);
    road(s, 1, [[5.5, ey + 0.5], [5.5, ey + 4.5]]);
    road(s, 1, [[20.5, ey + 0.5], [20.5, ey + 4.5]]);
    return { s, ey };
  };

  it("routes with the flow and detours against it", () => {
    const { s, ey } = loopCity();
    const withFlow = path(s, 6, ey, 19, ey)!;
    expect(withFlow).not.toBeNull();
    expect(withFlow.length).toBeLessThanOrEqual(15); // straight along the row
    const against = path(s, 19, ey, 6, ey)!;
    expect(against).not.toBeNull();
    expect(against.length).toBeGreaterThan(withFlow.length + 4); // went around the block
    // No step of the detour travels west along the one-way row itself.
    for (let i = 1; i < against.length; i++) {
      const y = (against[i] / s.world.size) | 0;
      if (y === ey) expect(against[i] % s.world.size).toBeGreaterThanOrEqual(against[i - 1] % s.world.size);
    }
  });

  it("has no route against the flow without a detour", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 4, [[5.5, ey + 0.5], [20.5, ey + 0.5]]);
    expect(path(s, 6, ey, 19, ey)).not.toBeNull();
    expect(path(s, 19, ey, 6, ey)).toBeNull();
  });

  it("stores direction as drawn (a→b) for a westward stroke", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 4, [[20.5, ey + 0.5], [5.5, ey + 0.5]]);
    const seg = s.world.segments.find((sg) => sg.oneWay)!;
    expect(seg).toBeDefined();
    expect(seg.dir ?? 1).toBe(1);
    const aNode = s.world.nodes.find((n) => n.id === seg.a)!;
    expect(aNode.x).toBeGreaterThan(20); // node a is the stroke start (west end drawn first)
    expect(path(s, 19, ey, 6, ey)).not.toBeNull();
    expect(path(s, 6, ey, 19, ey)).toBeNull();
  });

  it("re-drawing with the same one-way tool flips the direction for free", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 5, [[5.5, ey + 0.5], [20.5, ey + 0.5]]); // one-way avenue, eastbound
    const seg = () => s.world.segments.find((sg) => sg.oneWay)!;
    expect(seg().dir ?? 1).toBe(1);
    const money = s.money;
    road(s, 5, [[5.5, ey + 0.5], [20.5, ey + 0.5]]);
    expect(seg().dir).toBe(-1);
    expect(s.money).toBe(money);
    expect(path(s, 19, ey, 6, ey)).not.toBeNull();
    expect(path(s, 6, ey, 19, ey)).toBeNull();
  });
});

describe("roundabout tool", () => {
  const stamped = (): { s: CityState; ey: number } => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[4.5, ey + 0.5], [24.5, ey + 0.5]]);
    road(s, 1, [[14.5, ey - 6], [14.5, ey + 6]]);
    expect(applyTool(s, "roundabout", 14, ey).ok).toBe(true);
    return { s, ey };
  };

  it("replaces a 4-arm junction with a one-way ring and an island", () => {
    const { s, ey } = stamped();
    const w = s.world;
    expect(w.roundabouts).toEqual([{ x: 14.5, z: ey + 0.5, r: 1.5 }]);
    const ring = w.segments.filter((sg) => sg.roundabout);
    expect(ring.length).toBe(4);
    for (const seg of ring) {
      expect(seg.oneWay).toBe(true);
      expect(seg.type).toBe(4);
    }
    // The old centre node is gone; every segment still has two live nodes.
    expect(w.nodes.some((n) => Math.hypot(n.x - 14.5, n.z - (ey + 0.5)) < 0.01)).toBe(false);
    for (const seg of w.segments) {
      expect(w.nodes.some((n) => n.id === seg.a)).toBe(true);
      expect(w.nodes.some((n) => n.id === seg.b)).toBe(true);
    }
    void ey;
  });

  it("circulates traffic the right way around the ring", () => {
    const { s, ey } = stamped();
    const w = s.world;
    // South of the centre the ring runs west (E→S→W→N circulation).
    const south = idx(w, 15, ey + 1);
    expect(w.dirX[south]).toBeLessThan(-0.3);
    expect(path(s, 14, ey + 4, 14, ey - 4)).not.toBeNull(); // south arm to north arm
    expect(path(s, 20, ey, 8, ey)).not.toBeNull(); // east arm to west arm
  });

  it("refuses junctions with fewer than 3 arms", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[4.5, ey + 0.5], [24.5, ey + 0.5]]);
    expect(applyTool(s, "roundabout", 10, ey).ok).toBe(false);
    expect(s.world.roundabouts.length).toBe(0);
  });
});

describe("one-way and roundabout saves", () => {
  it("round-trips direction, ring flags and islands", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 4, [[5.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(s, 4, [[5.5, ey + 0.5], [20.5, ey + 0.5]]); // toggle to b→a
    road(s, 1, [[4.5, ey + 6.5], [24.5, ey + 6.5]]);
    road(s, 1, [[14.5, ey + 1], [14.5, ey + 12]]);
    expect(applyTool(s, "roundabout", 14, ey + 6).ok).toBe(true);
    const b = deserialize(serialize(s));
    const seg = b.world.segments.find((sg) => sg.oneWay && !sg.roundabout)!;
    expect(seg.dir).toBe(-1);
    expect(b.world.roundabouts).toEqual(s.world.roundabouts);
    expect(b.world.segments.filter((sg) => sg.roundabout).length).toBe(4);
    expect(path(b, 19, ey, 6, ey)).not.toBeNull(); // flipped direction survived the load
  });

  it("loads saves from before one-way roads existed", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[5.5, ey + 0.5], [20.5, ey + 0.5]]);
    const f = JSON.parse(serialize(s)) as { segments: Record<string, unknown>[]; roundabouts?: unknown };
    delete f.roundabouts;
    const b = deserialize(JSON.stringify(f));
    expect(b.world.roundabouts).toEqual([]);
    expect(path(b, 6, ey, 19, ey)).not.toBeNull();
    expect(path(b, 19, ey, 6, ey)).not.toBeNull();
  });
});

describe("sidewalk props plan", () => {
  it("plants trees on avenue medians and shelters at bus stops", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 2, [[5.5, ey + 6.5], [30.5, ey + 6.5]]);
    road(s, 1, [[5.5, ey + 0.5], [20.5, ey + 0.5]]);
    expect(applyTool(s, "busstop", 10, ey).ok).toBe(true);
    const plan = planProps(s.world, 1);
    const trees = plan.filter((p) => p.kind === "planter_tree");
    expect(trees.length).toBeGreaterThanOrEqual(3);
    for (const t of trees) {
      expect([2, 5]).toContain(s.world.road[idx(s.world, Math.floor(t.x), Math.floor(t.z))]);
    }
    expect(plan.filter((p) => p.kind === "bus_shelter").length).toBe(1);
  });

  it("thins decorative props with density but keeps shelters", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 2, [[5.5, ey + 6.5], [30.5, ey + 6.5]]);
    road(s, 1, [[5.5, ey + 0.5], [20.5, ey + 0.5]]);
    expect(applyTool(s, "busstop", 10, ey).ok).toBe(true);
    const full = planProps(s.world, 1);
    const low = planProps(s.world, 0.25);
    expect(low.length).toBeLessThan(full.length);
    expect(low.filter((p) => p.kind === "bus_shelter").length).toBe(1);
    expect(planProps(s.world, 1)).toEqual(full); // deterministic
  });
});
