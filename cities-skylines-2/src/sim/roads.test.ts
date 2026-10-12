import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad, step, CityState } from "./sim";
import { deserialize, serialize } from "./save";
import { findPath, newTraffic, tickTraffic } from "./traffic";
import {
  armHasGreen, hasSignal, nodeArms, nodeById, nodeLayout,
  rebuildNodes, redHold, removeSegment, signalNodes, signalPhase,
} from "./roads";
import { cidx, idx, rasterizeRoad, updateConnectivity } from "./world";

/** Dry, flat ground for a wide band around the entry row. */
function flat(s: CityState) {
  const ey = s.world.entry.y;
  for (let y = ey - 14; y <= ey + 14; y++)
    for (let x = 0; x <= 60; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  return ey;
}

const road = (s: CityState, type: 1 | 2 | 3, pts: [number, number][]) => {
  const r = placeRoad(s, type, pts.map(([x, y]) => ({ x, z: y })));
  expect(r.ok).toBe(true);
  return r;
};

const sortedTiles = (tiles: number[]): number[] => [...tiles].sort((a, b) => a - b);

describe("road graph", () => {
  it("snaps ends to nearby nodes and shares them", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[5.5, ey + 0.5], [14.5, ey + 0.5]]);
    road(s, 1, [[14.7, ey + 0.5], [22.5, ey + 0.5]]);
    const w = s.world;
    const [a, b] = w.segments.filter((sg) => !sg.fixed);
    expect(b.a).toBe(a.b);
    const node = nodeById(w, a.b)!;
    expect(node.segs).toContain(a.id);
    expect(node.segs).toContain(b.id);
  });

  it("splits a segment side for a T-junction", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(s, 1, [[12.5, ey - 6], [12.5, ey + 0.5]]);
    const w = s.world;
    // Entry plus the split horizontal (2) plus the stem (1).
    expect(w.segments.length).toBe(4);
    const junction = w.nodes.find((n) => n.segs.length === 3)!;
    expect(junction).toBeDefined();
    expect(Math.abs(junction.x - 12.5)).toBeLessThan(0.01);
    const arms = nodeArms(w, junction.id);
    expect(arms.length).toBe(3);
  });

  it("creates a crossing node that splits both roads", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(s, 1, [[12.5, ey - 5], [12.5, ey + 5]]);
    const w = s.world;
    expect(w.segments.length).toBe(5); // entry + 2 horizontal + 2 vertical
    const cross = w.nodes.find((n) => n.segs.length === 4)!;
    expect(cross).toBeDefined();
    expect(nodeArms(w, cross.id).length).toBe(4);
  });

  it("orders arms by angle with half width and tangent", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(s, 1, [[12.5, ey - 5], [12.5, ey + 5]]);
    const w = s.world;
    const cross = w.nodes.find((n) => n.segs.length === 4)!;
    const arms = nodeArms(w, cross.id);
    expect(arms.length).toBe(4);
    for (let i = 1; i < arms.length; i++) expect(arms[i].angle).toBeGreaterThan(arms[i - 1].angle);
    for (const a of arms) {
      expect(a.halfWidth).toBeCloseTo(0.45 - 0.07, 9);
      expect(Math.hypot(a.dx, a.dz)).toBeCloseTo(1, 9);
    }
    // East and west arms point along x, north and south along z.
    const xs = arms.filter((a) => Math.abs(a.dx) > 0.9);
    const zs = arms.filter((a) => Math.abs(a.dz) > 0.9);
    expect(xs.length).toBe(2);
    expect(zs.length).toBe(2);
  });

  it("merges straight degree-2 nodes on remove and drops orphans", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(s, 1, [[12.5, ey - 6], [12.5, ey + 0.5]]);
    const w = s.world;
    const stem = w.segments.find((sg) => sg.tiles.includes(idx(w, 12, ey - 3)))!;
    expect(removeSegment(w, stem.id)).toBe(true);
    // The T is gone: entry plus one horizontal again, no orphan nodes.
    expect(w.segments.length).toBe(2);
    expect(w.nodes.length).toBe(4);
    for (const n of w.nodes) expect(n.segs.length).toBeGreaterThan(0);
    expect(w.segments.every((sg) => nodeById(w, sg.a) && nodeById(w, sg.b))).toBe(true);
  });

  it("bulldozing a junction arm keeps the rest and cleans nodes", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    road(s, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(s, 1, [[12.5, ey - 6], [12.5, ey + 0.5]]);
    const w = s.world;
    const before = w.segments.length;
    expect(applyTool(s, "bulldoze", 12, ey - 4).ok).toBe(true);
    expect(w.segments.length).toBeLessThan(before);
    // The horizontal road still spans the junction tile.
    expect(w.road[idx(w, 12, ey)]).toBe(1);
    expect(w.road[idx(w, 12, ey - 4)]).toBe(0);
    for (const n of w.nodes) expect(n.segs.length).toBeGreaterThan(0);
  });

  it("paints a dragged run of tiles as one segment", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    for (let x = 3; x < 15; x++) expect(applyTool(s, "road", x, ey).ok).toBe(true);
    // The entry road plus one painted segment, not twelve.
    expect(s.world.segments.length).toBe(2);
    for (let x = 3; x < 15; x++) expect(s.world.road[idx(s.world, x, ey)]).toBe(1);
  });

  it("rasterises straight roads exactly like before and keeps curved corridors", () => {
    const s = newCity(3);
    const ey = flat(s);
    const straight = [{ x: 5.5, z: ey + 0.5 }, { x: 18.5, z: ey + 0.5 }];
    road(s, 1, [[5.5, ey + 0.5], [18.5, ey + 0.5]]);
    const expected = new Set(rasterizeRoad(s.world, 1, straight).tiles);
    const actual = new Set(
      s.world.segments.filter((sg) => !sg.fixed).flatMap((sg) => sg.tiles),
    );
    expect(sortedTiles([...actual])).toEqual(sortedTiles([...expected]));

    // A crossed curve: every piece tile stays next to the old full-length raster.
    const t = newCity(3);
    flat(t);
    // The curve starts on the entry node so the whole mesh stays connected.
    const curve = [{ x: 2.5, z: ey + 0.5 }, { x: 12, z: ey - 8 }, { x: 24.5, z: ey + 3.5 }];
    const cross = [{ x: 14.5, z: ey - 8 }, { x: 14.5, z: ey + 6 }];
    const oldTiles = new Set([
      ...rasterizeRoad(t.world, 1, curve).tiles,
      ...rasterizeRoad(t.world, 1, cross).tiles,
    ]);
    road(t, 1, [[2.5, ey + 0.5], [12, ey - 8], [24.5, ey + 3.5]]);
    road(t, 1, [[14.5, ey - 8], [14.5, ey + 6]]);
    const near = (tile: number): boolean => {
      const x = tile % t.world.size, y = (tile / t.world.size) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= t.world.size || ny >= t.world.size) continue;
          if (oldTiles.has(ny * t.world.size + nx)) return true;
        }
      return false;
    };
    const pieces = t.world.segments.filter((sg) => !sg.fixed).flatMap((sg) => sg.tiles);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every(near)).toBe(true);
    step(t);
    for (const tile of pieces) expect(t.world.connected[tile]).toBe(1);
  });

  it("round-trips the graph through a save", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    road(s, 2, [[4.5, ey + 6.5], [30.5, ey + 6.5]]);
    road(s, 1, [[12.5, ey - 2], [12.5, ey + 6.5]]);
    road(s, 1, [[20.5, ey + 6.5], [28.5, ey + 6.5]]);
    const json = serialize(s);
    const b = deserialize(json);
    expect(b.world.segments).toEqual(s.world.segments);
    expect(b.world.nodes.length).toBe(s.world.nodes.length);
    expect(b.world.nextSegmentId).toBe(s.world.nextSegmentId);
    expect([...b.world.road]).toEqual([...s.world.road]);
  });

  it("loads saves from before nodes existed", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    road(s, 2, [[4.5, ey + 6.5], [30.5, ey + 6.5]]);
    road(s, 1, [[12.5, ey - 2], [12.5, ey + 6.5]]);
    step(s);
    const f = JSON.parse(serialize(s)) as { segments: { a?: number; b?: number }[] };
    for (const seg of f.segments) {
      delete seg.a;
      delete seg.b;
    }
    const b = deserialize(JSON.stringify(f));
    const w = b.world;
    expect(w.nodes.length).toBeGreaterThan(0);
    for (const sg of w.segments) {
      expect(Number.isInteger(sg.a) && sg.a > 0).toBe(true);
      expect(Number.isInteger(sg.b) && sg.b > 0).toBe(true);
    }
    expect([...w.road]).toEqual([...s.world.road]);
    expect([...w.connected]).toEqual([...s.world.connected]);
    // A junction healed where the stem meets the avenue.
    expect(w.nodes.some((n) => nodeArms(w, n.id).length === 3)).toBe(true);
  });

  it("lays out junction trims for the renderer", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(s, 1, [[12.5, ey - 5], [12.5, ey + 5]]);
    const w = s.world;
    const cross = w.nodes.find((n) => n.segs.length === 4)!;
    const l = nodeLayout(w, cross.id)!;
    expect(l.arms.length).toBe(4);
    expect(l.corners.length).toBe(4);
    for (const a of l.arms) {
      expect(a.trimA.neg).toBeGreaterThan(0.3);
      expect(a.trimA.pos).toBeGreaterThan(0.3);
    }
    // Straight-through pairs keep a butt joint at the centre.
    const h = newCity(3);
    flat(h);
    road(h, 1, [[2.5, h.world.entry.y + 0.5], [12.5, h.world.entry.y + 0.5]]);
    const joint = h.world.nodes.find((n) => n.segs.length === 2)!;
    const jl = nodeLayout(h.world, joint.id)!;
    expect(jl.arms.length).toBe(2);
    expect(jl.corners.length).toBe(0);
    for (const a of jl.arms) {
      expect(a.trimA.neg).toBe(0);
      expect(a.trimA.pos).toBe(0);
    }
  });
});

describe("traffic signals", () => {
  const cross = (): { s: CityState; node: number } => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    // Both avenues touch the entry row, so the mesh stays connected.
    road(s, 2, [[3.5, ey + 0.5], [28.5, ey + 0.5]]);
    road(s, 2, [[15.5, ey - 8], [15.5, ey + 8]]);
    const w = s.world;
    const node = w.nodes.find((n) => n.segs.length === 4)!.id;
    return { s, node };
  };

  it("signals a 4-arm node but not a street T", () => {
    const { s, node } = cross();
    expect(hasSignal(s.world, node)).toBe(true);
    expect(signalNodes(s.world).length).toBe(1);
    const t = newCity(3);
    flat(t);
    const ey = t.world.entry.y;
    road(t, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(t, 1, [[12.5, ey - 6], [12.5, ey + 0.5]]);
    const tee = t.world.nodes.find((n) => n.segs.length === 3)!.id;
    expect(hasSignal(t.world, tee)).toBe(false);
  });

  it("signals a 3-arm node when an avenue meets it", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    road(s, 2, [[3.5, ey + 0.5], [28.5, ey + 0.5]]);
    road(s, 1, [[12.5, ey - 6], [12.5, ey + 0.5]]);
    const tee = s.world.nodes.find((n) => n.segs.length === 3)!.id;
    expect(hasSignal(s.world, tee)).toBe(true);
  });

  it("runs a deterministic two-phase cycle", () => {
    expect(signalPhase(0)).toBe(0);
    expect(signalPhase(7.9)).toBe(0);
    expect(signalPhase(8)).toBe(1);
    expect(signalPhase(16)).toBe(0);
    const { s, node } = cross();
    const arms = nodeArms(s.world, node);
    const ns = arms.findIndex((a) => Math.abs(a.dx) <= Math.abs(a.dz));
    const ew = arms.findIndex((a) => Math.abs(a.dx) > Math.abs(a.dz));
    expect(armHasGreen(s.world, node, ns, 0)).toBe(true);
    expect(armHasGreen(s.world, node, ns, 8)).toBe(false);
    expect(armHasGreen(s.world, node, ew, 0)).toBe(false);
    expect(armHasGreen(s.world, node, ew, 8)).toBe(true);
  });

  it("holds traffic on red and releases on green", () => {
    const { s } = cross();
    const w = s.world;
    const ey = w.entry.y;
    // South of the node on the vertical avenue, heading north into it.
    const tile = idx(w, 15, ey + 1);
    expect(w.road[tile]).toBeGreaterThan(0);
    expect(redHold(w, 0, tile, 0, -1)).toBe(false);
    expect(redHold(w, 9, tile, 0, -1)).toBe(true);
    // Driving away from the node is never held.
    expect(redHold(w, 9, tile, 0, 1)).toBe(false);
  });

  it("lets traffic through a signalised crossing without deadlock", () => {
    const { s } = cross();
    const w = s.world;
    const ey = w.entry.y;
    for (let x = 4; x < 14; x++) {
      applyTool(s, "res", x, ey - 1);
      applyTool(s, "com", x + 14, ey + 2);
    }
    for (let i = 0; i < w.zone.length; i++) if (w.zone[i]) w.level[i] = 2;
    s.population = 600;
    s.capacity = { res: 600, com: 120, ind: 0 };
    w.revision++;
    updateConnectivity(w);
    const t = newTraffic(w.size);
    for (let i = 0; i < 800; i++) tickTraffic(s, t, 0.1);
    expect(t.completed).toBeGreaterThan(0);
  });
});

describe("graph endurance", () => {
  it("rebuilds identical nodes from its own segments", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    road(s, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(s, 1, [[12.5, ey - 5], [12.5, ey + 5]]);
    const w = s.world;
    const nodes = JSON.stringify(w.nodes);
    const segs = JSON.stringify(w.segments);
    rebuildNodes(w);
    expect(JSON.stringify(w.nodes)).toBe(nodes);
    expect(JSON.stringify(w.segments)).toBe(segs);
  });

  it("adds crossing avenues without dropping tiles", () => {
    const s = newCity(11);
    flat(s);
    const ey = s.world.entry.y;
    s.money = 1e7;
    const t0 = performance.now();
    for (let k = 0; k < 12; k++) {
      road(s, 1, [[4.5 + k, ey - 10], [4.5 + k, ey + 10]]);
      road(s, 1, [[2.5, ey - 10 + k], [24.5, ey - 10 + k]]);
    }
    const ms = performance.now() - t0;
    expect(s.world.segments.length).toBeGreaterThan(24);
    expect(ms).toBeLessThan(2000);
    // Every segment end is wired to a real node.
    for (const sg of s.world.segments) {
      expect(nodeById(s.world, sg.a)).toBeDefined();
      expect(nodeById(s.world, sg.b)).toBeDefined();
    }
    // The tile A* still routes across the mesh.
    const t = newTraffic(s.world.size);
    const p = findPath(s.world, t.load, idx(s.world, 0, ey), idx(s.world, 10, ey));
    expect(p).not.toBeNull();
  });

  it("upgrades a street in place when paved over as an avenue", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    road(s, 1, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    const n = s.world.segments.length;
    road(s, 2, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    // No doubled geometry: the same segment was widened.
    expect(s.world.segments.length).toBe(n);
    expect(s.world.road[idx(s.world, 8, ey)]).toBe(2);
  });
});
