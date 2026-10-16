import { describe, expect, it } from "vitest";
import { blankShowcaseCity } from "./showcase-cases";
import { applyTool, placeRoad } from "./sim";
import { planInterchange, placeInterchange } from "./interchange";
import { junctionsOf } from "./junction";
import { findLayeredPath } from "./traffic";
import { serialize, deserialize } from "./save";
import { diamondRamps } from "./crossings";
import { addSegment, groundArms } from "./roads";
import { rebuildRoadRaster, type Pt } from "./world";

const P = (x: number, z: number) => ({ x, z });
function crossing() {
  const s = blankShowcaseCity();
  // The public road tool has a 60-tile stroke cap, so this is the same 80-tile
  // highway as the task recipe in two legal player strokes.
  placeRoad(s, 3, [P(8.5, 48.5), P(48.5, 48.5)]);
  placeRoad(s, 3, [P(48.5, 48.5), P(88.5, 48.5)]);
  // A plain long avenue drawn across the highway: auto grade separation lifts a local span, the
  // road continues past both future ramp terminals.
  placeRoad(s, 2, [P(48.5, 18.5), P(48.5, 78.5)]);
  return s;
}

const angle = (a: Pt, b: Pt): number => {
  const d = Math.abs(a.x * b.x + a.z * b.z) / (Math.hypot(a.x, a.z) * Math.hypot(b.x, b.z));
  return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
};

describe("diamond interchange", () => {
  it("plans two exits and two entries, one per side", () => {
    const s = crossing();
    const plan = planInterchange(s, 48.5, 48.5);
    expect(plan.ok).toBe(true);
    expect(plan.ramps.map((r) => `${r.role}${r.side}`).sort()).toEqual(["entry-1", "entry1", "exit-1", "exit1"]);
    expect(plan.ramps.every((r) => r.pts.length === 3)).toBe(true);
    expect(plan.cost).toBeGreaterThan(0);
  });

  it("uses 20 degree highway tangents and perpendicular terminal tangents", () => {
    const plan = planInterchange(crossing(), 48.5, 48.5);
    expect(plan.ok).toBe(true);
    for (const ramp of plan.ramps) {
      const [p0, c, p2] = ramp.pts;
      const highwayTangent = ramp.role === "exit"
        ? { x: c.x - p0.x, z: c.z - p0.z }
        : { x: p2.x - c.x, z: p2.z - c.z };
      const terminalTangent = ramp.role === "exit"
        ? { x: p2.x - c.x, z: p2.z - c.z }
        : { x: c.x - p0.x, z: c.z - p0.z };
      expect(angle(highwayTangent, P(1, 0))).toBeGreaterThanOrEqual(18);
      expect(angle(highwayTangent, P(1, 0))).toBeLessThanOrEqual(22);
      expect(angle(terminalTangent, P(0, 1))).toBeGreaterThanOrEqual(85);
      expect(angle(terminalTangent, P(0, 1))).toBeLessThanOrEqual(95);
    }
  });

  it("builds four single-segment ramps, four-arm terminals, and all 12 movements", () => {
    const s = crossing();
    const money = s.money;
    const plan = planInterchange(s, 48.5, 48.5);
    const placed = placeInterchange(s, plan);
    expect(placed.ok).toBe(true);
    expect(money - s.money).toBe(plan.cost);
    expect(s.world.segments.filter((g) => g.type === 6)).toHaveLength(4);
    const kinds = [...junctionsOf(s.world).byNode.values()].map((l) => l.kind);
    expect(kinds.filter((k) => k === "merge")).toHaveLength(2);
    expect(kinds.filter((k) => k === "diverge")).toHaveLength(2);
    expect(s.money).toBeLessThan(money);
    const terminals = s.world.nodes.filter((node) =>
      Math.abs(node.x - 48.5) < 1e-3 && (Math.abs(node.z - 40.85) < 1e-2 || Math.abs(node.z - 56.15) < 1e-2));
    expect(terminals).toHaveLength(2);
    expect(terminals.map((node) => groundArms(s.world, node.id).length)).toEqual([4, 4]);

    const crossTiles = new Set(s.world.segments.filter((g) => g.type === 2).flatMap((g) => g.tiles));
    for (const ramp of s.world.segments.filter((g) => g.type === 6)) {
      const terminal = ramp.pts.find((p) => Math.abs(p.x - 48.5) < 1e-3)!;
      for (const tile of ramp.tiles.filter((t) => crossTiles.has(t))) {
        const tx = tile % s.world.size + .5, tz = Math.floor(tile / s.world.size) + .5;
        expect(Math.hypot(tx - terminal.x, tz - terminal.z)).toBeLessThanOrEqual(1.5);
      }
    }
    const w = s.world, t = (x: number, z: number) => Math.floor(z) * w.size + Math.floor(x);
    const load = new Uint16Array(w.size * w.size);
    const routes: [number, number, number, number][] = [
      [10.5, 48.5, 86.5, 48.5], [86.5, 48.5, 10.5, 48.5],
      [48.5, 20.5, 48.5, 76.5], [48.5, 76.5, 48.5, 20.5],
      [10.5, 48.5, 48.5, 20.5], [10.5, 48.5, 48.5, 76.5],
      [86.5, 48.5, 48.5, 20.5], [86.5, 48.5, 48.5, 76.5],
      [48.5, 20.5, 86.5, 48.5], [48.5, 20.5, 10.5, 48.5],
      [48.5, 76.5, 86.5, 48.5], [48.5, 76.5, 10.5, 48.5],
    ];
    for (const [ax, az, bx, bz] of routes) expect(findLayeredPath(w, load, t(ax, az), t(bx, bz))).toBeTruthy();
  });

  it("refuses short approaches with the terminal reason and changes nothing", () => {
    const s = blankShowcaseCity();
    placeRoad(s, 3, [P(8.5, 48.5), P(48.5, 48.5)]);
    placeRoad(s, 3, [P(48.5, 48.5), P(88.5, 48.5)]);
    addSegment(s.world, 2, [P(48.5, 18.5), P(48.5, 45.5)]);
    addSegment(s.world, 2, [P(48.5, 45.5), P(48.5, 51.5)], { elevation: "bridge" });
    rebuildRoadRaster(s.world);
    const before = serialize(s);
    const plan = planInterchange(s, 48.5, 48.5);
    expect(plan).toMatchObject({ ok: false, reason: "No room for ramp terminals" });
    expect(serialize(s)).toBe(before);
  });

  it("refuses away from a crossing and builds nothing", () => {
    const s = crossing();
    const before = serialize(s);
    const plan = planInterchange(s, 20.5, 48.5);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("Tap where a road crosses a highway");
    expect(serialize(s)).toBe(before);
  });

  it("snaps every crossing tile to the centreline intersection", () => {
    for (let x = 47.1; x <= 48.9; x += .9) for (let z = 47.1; z <= 49.1; z += .9) {
      expect(planInterchange(crossing(), x, z).ok).toBe(true);
    }
  });

  it("refuses when a terminal would hit water or a building, nothing built", () => {
    const s = crossing();
    s.world.facility[56 * s.world.size + 48] = 1;
    const before = serialize(s);
    const plan = planInterchange(s, 48.5, 48.5);
    expect(plan.ok).toBe(false);
    expect(serialize(s)).toBe(before);
  });

  it("bulldozing one ramp leaves valid junctions", () => {
    const s = crossing();
    placeInterchange(s, planInterchange(s, 48.5, 48.5));
    const ramp = s.world.segments.find((g) => g.type === 6)!;
    const tile = ramp.tiles[Math.floor(ramp.tiles.length / 2)];
    expect(applyTool(s, "bulldoze", tile % s.world.size, (tile / s.world.size) | 0).ok).toBe(true);
    expect(() => junctionsOf(s.world)).not.toThrow();
  });

  it("an old save with the flat type-4 diamond still loads beside a new interchange", () => {
    const s = crossing();
    for (const r of diamondRamps(24.5, 24.5, { dx: 1, dz: 0 }, { dx: 0, dz: 1 })) addSegment(s.world, 4, r);
    rebuildRoadRaster(s.world);
    const loaded = deserialize(serialize(s));
    expect(() => junctionsOf(loaded.world)).not.toThrow();
    expect(placeInterchange(loaded, planInterchange(loaded, 48.5, 48.5)).ok).toBe(true);
  });
});
