import { describe, expect, it } from "vitest";
import {
  applyTool, applyZoneAt, CityState, findUpgradeTarget, newCity, placeRoad, planRoadUpgrade,
  syncLots, upgradeRoad,
} from "./sim";
import { upgradeRoad as upgradeRoadByPath } from "./roadupgrade";
import { History } from "./history";
import { deserialize, serialize } from "./save";
import { placeBusStop } from "./transit";
import { cidx, idx, ROAD, rasterizeRoad, ZONE } from "./world";

/** Dry, flat ground for a wide band around the entry row. */
function flat(s: CityState) {
  const ey = s.world.entry.y;
  for (let y = ey - 14; y <= ey + 14; y++)
    for (let x = 0; x <= 60; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  return ey;
}

const road = (s: CityState, type: 1 | 2 | 3 | 4 | 5, pts: [number, number][]) => {
  const r = placeRoad(s, type, pts.map(([x, y]) => ({ x, z: y })));
  expect(r.ok).toBe(true);
  return r;
};

/** The player-built segment covering tile (x, y). */
const segAt = (s: CityState, x: number, y: number) =>
  s.world.segments.find((sg) => !sg.fixed && sg.tiles.includes(idx(s.world, x, y)))!;

describe("road upgrade", () => {
  it("upgrades a street to an avenue in place, charging the class difference", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    const seg = segAt(s, 8, ey);
    const pts = JSON.stringify(seg.pts);
    const nodes = JSON.stringify(s.world.nodes);
    const nSegs = s.world.segments.length;
    const graphRev = s.world.graphRevision;
    const plan = planRoadUpgrade(s, seg.id, 2);
    expect(plan.ok).toBe(true);
    // 10 street tiles step 20->45, 12 fresh tiles at full price.
    expect(plan.cost).toBe(25 * 10 + 45 * 12);
    const money = s.money;
    expect(upgradeRoad(s, seg.id, 2)).toEqual({ ok: true });
    expect(seg.type).toBe(2);
    expect(s.money).toBe(money - plan.cost);
    expect(s.world.road[idx(s.world, 8, ey)]).toBe(2);
    expect(s.world.road[idx(s.world, 8, ey + 1)]).toBe(2);
    // Geometry, node graph and segment count are untouched; caches invalidate.
    expect(JSON.stringify(seg.pts)).toBe(pts);
    expect(JSON.stringify(s.world.nodes)).toBe(nodes);
    expect(s.world.segments.length).toBe(nSegs);
    expect(s.world.graphRevision).toBeGreaterThan(graphRev);
    expect(seg.tiles).toEqual(rasterizeRoad(s.world, 2, seg.pts).tiles);
  });

  it("is deterministic for a given city", () => {
    const a = newCity(3), b = newCity(3);
    const ey = flat(a);
    flat(b);
    road(a, 1, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    road(b, 1, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    const pa = planRoadUpgrade(a, segAt(a, 8, ey).id, 2);
    const pb = planRoadUpgrade(b, segAt(b, 8, ey).id, 2);
    expect(pa).toEqual(pb);
  });

  it("refuses when money is short, leaving the road and money alone", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    const seg = segAt(s, 8, ey);
    const plan = planRoadUpgrade(s, seg.id, 2);
    expect(plan.ok).toBe(true);
    s.money = plan.cost - 1;
    const res = upgradeRoad(s, seg.id, 2);
    expect(res).toEqual({ ok: false, reason: "Not enough money" });
    expect(seg.type).toBe(1);
    expect(s.money).toBe(plan.cost - 1);
    // The broke plan still prices the work, for the readout.
    const broke = planRoadUpgrade(s, seg.id, 2);
    expect(broke.ok).toBe(false);
    expect(broke.cost).toBe(plan.cost);
  });

  it("refuses widening onto zones, buildings and facilities", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    const id = segAt(s, 8, ey).id;
    expect(applyTool(s, "res", 6, ey + 1).ok).toBe(true);
    expect(upgradeRoad(s, id, 2)).toEqual({ ok: false, reason: "Road would crush lots" });
    expect(applyTool(s, "bulldoze", 6, ey + 1).ok).toBe(true);

    s.world.zone[idx(s.world, 7, ey + 1)] = ZONE.COM;
    s.world.level[idx(s.world, 7, ey + 1)] = 2;
    expect(upgradeRoad(s, id, 2)).toEqual({ ok: false, reason: "Road would crush lots" });
    s.world.zone[idx(s.world, 7, ey + 1)] = 0;
    s.world.level[idx(s.world, 7, ey + 1)] = 0;

    expect(applyTool(s, "power", 8, ey + 1).ok).toBe(true);
    expect(upgradeRoad(s, id, 2)).toEqual({ ok: false, reason: "Road would cross a building" });
    expect(segAt(s, 8, ey).type).toBe(1);
  });

  it("refuses a highway upgrade that meets streets or strands lots", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    road(s, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(s, 1, [[12.5, ey - 6], [12.5, ey + 0.5]]);
    const left = segAt(s, 8, ey);
    expect(planRoadUpgrade(s, left.id, 3)).toMatchObject({ ok: false, reason: "Highways need an interchange" });
    expect(upgradeRoad(s, left.id, 3).ok).toBe(false);
    expect(left.type).toBe(1);

    // No junction, but a zoned strip beside the new footprint: stranded, not served.
    const t = newCity(3);
    flat(t);
    t.money = 1e7;
    road(t, 1, [[10.5, ey + 0.5], [19.5, ey + 0.5]]);
    expect(applyTool(t, "res", 14, ey - 2).ok).toBe(true);
    expect(upgradeRoad(t, segAt(t, 14, ey).id, 3))
      .toEqual({ ok: false, reason: "Highway would strand lots" });
  });

  it("refuses a downgrade that leaves a highway ending in a street", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    road(s, 3, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    road(s, 3, [[12.5, ey + 0.5], [21.5, ey + 0.5]]);
    const first = segAt(s, 8, ey);
    expect(first.type).toBe(3);
    expect(upgradeRoad(s, first.id, 1)).toEqual({ ok: false, reason: "Highways need an interchange" });
    expect(first.type).toBe(3);
  });

  it("converts one-way flags with the class and downgrades narrower roads for free", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    const seg = segAt(s, 8, ey);
    const plan = planRoadUpgrade(s, seg.id, 4);
    expect(plan.ok).toBe(true);
    expect(plan.cost).toBe(2 * 10); // same asphalt, one-way street stamp
    const money = s.money;
    expect(upgradeRoad(s, seg.id, 4).ok).toBe(true);
    expect(seg.oneWay).toBe(true);
    expect(seg.dir).toBe(1);
    expect(s.money).toBe(money - plan.cost);
    // Back to two-way: flags cleared, downgrades free.
    expect(upgradeRoad(s, seg.id, 1)).toEqual({ ok: true });
    expect(seg.oneWay).toBeUndefined();
    expect(seg.dir).toBeUndefined();

    road(s, 2, [[3.5, ey + 5.5], [12.5, ey + 5.5]]);
    const av = segAt(s, 8, ey + 5);
    const down = planRoadUpgrade(s, av.id, 1);
    expect(down).toMatchObject({ ok: true, cost: 0 });
    const m2 = s.money;
    expect(upgradeRoad(s, av.id, 1).ok).toBe(true);
    expect(s.money).toBe(m2);
    expect(s.world.road[idx(s.world, 8, ey + 5)]).toBe(1);
    expect(s.world.road[idx(s.world, 8, ey + 6)]).toBe(0);
  });

  it("treats the same class as a free no-op and unknown roads as a refusal", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    const seg = segAt(s, 8, ey);
    const money = s.money, rev = s.world.revision;
    expect(upgradeRoad(s, seg.id, 1)).toEqual({ ok: true });
    expect(s.money).toBe(money);
    expect(s.world.revision).toBe(rev);
    expect(upgradeRoad(s, 9999, 2)).toEqual({ ok: false, reason: "Unknown road" });
  });

  it("keeps elevation and charges the span rate on a bridge", () => {
    const s = newCity(3);
    const ey = flat(s);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]])
      s.world.heights[cidx(s.world, 10 + dx, ey + 4 + dy)] = -1;
    const r = placeRoad(s, ROAD.STREET, [{ x: 10.5, z: ey + 2 }, { x: 10.5, z: ey + 8 }]);
    expect(r.ok).toBe(true);
    const deck = s.world.segments.find((sg) => sg.elevation === "bridge")!;
    expect(deck).toBeDefined();
    const plan = planRoadUpgrade(s, deck.id, 2);
    expect(plan.ok).toBe(true);
    const money = s.money;
    expect(upgradeRoad(s, deck.id, 2).ok).toBe(true);
    expect(deck.type).toBe(2);
    expect(deck.elevation).toBe("bridge");
    expect(s.money).toBe(money - plan.cost);
    expect(plan.cost).toBeGreaterThan(0);
  });

  it("drops bus stops left on pure highway, like bulldoze", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    road(s, 1, [[10.5, ey + 5.5], [19.5, ey + 5.5]]);
    expect(placeBusStop(s, 12, ey + 5).ok).toBe(true);
    expect(placeBusStop(s, 16, ey + 5).ok).toBe(true);
    expect(upgradeRoad(s, segAt(s, 12, ey + 5).id, 3).ok).toBe(true);
    expect(s.world.stops.length).toBe(0);
  });

  it("round-trips an upgraded road through a save", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    expect(upgradeRoad(s, segAt(s, 8, ey).id, 2).ok).toBe(true);
    const b = deserialize(serialize(s));
    const seg = b.world.segments.find((sg) => !sg.fixed)!;
    expect(seg.type).toBe(2);
    expect(seg.pts).toEqual(segAt(s, 8, ey).pts);
    expect([...b.world.road]).toEqual([...s.world.road]);
    expect(b.world.nextSegmentId).toBe(s.world.nextSegmentId);
    expect(b.money).toBe(s.money);
  });

  it("undoes an upgrade through the history protocol", () => {
    const s = newCity(3);
    const ey = flat(s);
    road(s, 1, [[3.5, ey + 0.5], [12.5, ey + 0.5]]);
    const id = segAt(s, 8, ey).id;
    const h = new History();
    h.push(serialize(s));
    expect(upgradeRoad(s, id, 2).ok).toBe(true);
    expect(segAt(s, 8, ey).type).toBe(2);
    const snap = h.undo(serialize(s))!;
    const back = deserialize(snap);
    expect(back.world.segments.find((sg) => sg.id === id)!.type).toBe(1);
    expect(back.money).toBeGreaterThan(s.money);
    // Redo replays the upgrade.
    const fwd = deserialize(h.redo(serialize(back))!);
    expect(fwd.world.segments.find((sg) => sg.id === id)!.type).toBe(2);
    expect(fwd.money).toBe(s.money);
  });

  it("keeps oriented zoning consistent", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.world.zoning = "oriented";
    s.money = 1e7;
    road(s, 1, [[3.5, ey + 0.5], [20.5, ey + 0.5]]);
    // Kerb cells crush under the widening: refused through the tile mirror.
    expect(applyZoneAt(s, ZONE.RES, 10.5, ey + 1.5, { radius: 0 }).ok).toBe(true);
    const id = segAt(s, 8, ey).id;
    expect(upgradeRoad(s, id, 2)).toEqual({ ok: false, reason: "Road would crush lots" });

    const t = newCity(3);
    flat(t);
    t.world.zoning = "oriented";
    t.money = 1e7;
    road(t, 1, [[3.5, ey + 0.5], [20.5, ey + 0.5]]);
    // Far cells survive the widening.
    expect(applyZoneAt(t, ZONE.RES, 10.5, ey + 3.5, { radius: 0 }).ok).toBe(true);
    expect(upgradeRoad(t, segAt(t, 8, ey).id, 2).ok).toBe(true);
    syncLots(t);
    expect(t.world.olots).toBeDefined();
    const b = deserialize(serialize(t));
    expect(b.world.segments.find((sg) => !sg.fixed)!.type).toBe(2);
    expect(b.world.olots!.length).toBe(t.world.olots!.length);
  });

  it("finds the tap target on tarmac only, preferring the nearer centreline", () => {
    const s = newCity(3);
    const ey = flat(s);
    s.money = 1e7;
    road(s, 1, [[4.5, ey + 0.5], [20.5, ey + 0.5]]);
    road(s, 1, [[12.5, ey - 5], [12.5, ey + 5]]);
    const w = s.world;
    const horiz = segAt(s, 8, ey);
    expect(findUpgradeTarget(w, 8.5, ey + 0.5, 2)).toBe(horiz);
    // Same class chosen: no offer, the tap starts a draft instead.
    expect(findUpgradeTarget(w, 8.5, ey + 0.5, 1)).toBeUndefined();
    // Off the tarmac: nothing.
    expect(findUpgradeTarget(w, 8.5, ey + 3.5, 2)).toBeUndefined();
    // At the crossing the nearer centreline wins.
    const cross = findUpgradeTarget(w, 12.5, ey + 2.5, 2)!;
    expect(cross).toBeDefined();
    expect(cross.tiles).toContain(idx(w, 12, ey + 2));
  });

  it("resolves upgradeRoad under both import paths", () => {
    expect(upgradeRoadByPath).toBe(upgradeRoad);
  });
});
