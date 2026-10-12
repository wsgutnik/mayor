import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad, planRoad, refreshLots, CityState } from "./sim";
import {
  ROAD, blocksBuilding, bridgeProfile, cidx, deckYAt, idx, isBridgeTile, isLand, isTunnelTile,
  makeDeckSampler, segElevation, tileHeight, updateConnectivity,
} from "./world";
import { detectSpan, splitPtsAt } from "./elevation";
import { findPath } from "./traffic";
import { floodRoads } from "./networks";
import { getFrontage } from "./blocks";
import { deserialize, serialize } from "./save";

type City = ReturnType<typeof newCity>;

/** Dry flat building ground around the entry. */
function flat(s: City, x1 = 60): number {
  const ey = s.world.entry.y;
  for (let y = ey - 14; y <= ey + 16; y++)
    for (let x = 0; x <= x1; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e7;
  return ey;
}

/** A water canal x0..x1 (inclusive tiles) across rows ey-1..ey+1. */
function carveCanal(s: City, ey: number, x0: number, x1: number): void {
  for (let y = ey - 1; y <= ey + 2; y++)
    for (let x = x0; x <= x1 + 1; x++) s.world.heights[cidx(s.world, x, y)] = -1;
}

/** A hill x0..x1 (inclusive) rising to `top`, rows ey-1..ey+1. */
function raiseHill(s: City, ey: number, x0: number, x1: number, top = 3): void {
  for (let y = ey - 1; y <= ey + 2; y++)
    for (let x = x0; x <= x1 + 1; x++) s.world.heights[cidx(s.world, x, y)] = top;
}

const across = (ey: number, x0: number, x1: number) => [{ x: x0 + 0.5, z: ey + 0.5 }, { x: x1 + 0.5, z: ey + 0.5 }];

describe("bridges", () => {
  it("spans a 6-tile water gap with ground approaches", () => {
    const s = newCity(3);
    const ey = flat(s);
    carveCanal(s, ey, 10, 15);
    const plan = planRoad(s, ROAD.STREET, across(ey, 2, 21));
    expect(plan.ok).toBe(true);
    expect(plan.span).toBe("bridge");
    expect(plan.pieces!.map((p) => p.elevation)).toEqual(["ground", "bridge", "ground"]);
    // Elevated tiles cost more than the same tiles at grade.
    expect(plan.cost).toBeGreaterThan(plan.newTiles * 20);
    expect(placeRoad(s, ROAD.STREET, across(ey, 2, 21)).ok).toBe(true);
    const bridges = s.world.segments.filter((seg) => segElevation(seg) === "bridge");
    expect(bridges.length).toBe(1);
    const deck = bridges[0];
    expect(deck.tiles.length).toBeGreaterThanOrEqual(6);
    // Mid-span tiles (shore joints may overlap the approaches) are deck-only.
    for (let x = 11; x <= 14; x++) {
      const t = idx(s.world, x, ey);
      expect(s.world.road[t]).toBe(ROAD.STREET);
      expect(s.world.roadSurface[t]).toBe(0);
      expect(isBridgeTile(s.world, t)).toBe(true);
      expect(Number.isNaN(s.world.deckH[t])).toBe(false);
    }
    // The approaches are ordinary surface road.
    expect(s.world.roadSurface[idx(s.world, 4, ey)]).toBe(ROAD.STREET);
    expect(s.world.roadSurface[idx(s.world, 21, ey)]).toBe(ROAD.STREET);
    // Traffic stays connected across the deck.
    updateConnectivity(s.world);
    expect(s.world.connected[idx(s.world, 21, ey)]).toBe(1);
    const path = findPath(s.world, new Uint16Array(s.world.size * s.world.size), idx(s.world, 4, ey), idx(s.world, 21, ey));
    expect(path).not.toBeNull();
    expect(path!.some((t) => isBridgeTile(s.world, t))).toBe(true);
  });

  it("refuses a 30-tile gap", () => {
    const s = newCity(3);
    const ey = flat(s);
    carveCanal(s, ey, 5, 34);
    const plan = planRoad(s, ROAD.STREET, across(ey, 3, 36));
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("Bridge span too long");
  });

  it("lets avenues span wider gaps than streets", () => {
    const s = newCity(3);
    const ey = flat(s);
    carveCanal(s, ey, 10, 24); // 15 tiles of water
    expect(planRoad(s, ROAD.STREET, across(ey, 4, 30))).toMatchObject({ ok: false });
    const avenue = planRoad(s, ROAD.AVENUE, across(ey, 4, 30));
    expect(avenue.ok).toBe(true);
    expect(avenue.span).toBe("bridge");
    expect(placeRoad(s, ROAD.AVENUE, across(ey, 4, 30)).ok).toBe(true);
    expect(s.world.segments.some((seg) => segElevation(seg) === "bridge" && seg.type === ROAD.AVENUE)).toBe(true);
  });

  it("bridges a land valley without levelling it", () => {
    const s = newCity(3);
    const ey = flat(s);
    for (let y = ey - 1; y <= ey + 2; y++)
      for (let x = 0; x <= 40; x++) s.world.heights[cidx(s.world, x, y)] = 2;
    for (let y = ey - 1; y <= ey + 2; y++)
      for (let x = 10; x <= 16; x++) s.world.heights[cidx(s.world, x, y)] = 0.1;
    s.money = 1e7;
    // Deep-valley corners (the transition slopes may level with the approaches).
    const before = [12, 13, 14].map((x) => s.world.heights[cidx(s.world, x, ey)]);
    const plan = planRoad(s, ROAD.STREET, across(ey, 4, 21));
    expect(plan.ok).toBe(true);
    expect(plan.span).toBe("bridge");
    expect(placeRoad(s, ROAD.STREET, across(ey, 4, 21)).ok).toBe(true);
    // The valley floor is untouched, and no lot is planned on the deck.
    expect([12, 13, 14].map((x) => s.world.heights[cidx(s.world, x, ey)])).toEqual(before);
    const deckTile = idx(s.world, 12, ey);
    expect(isBridgeTile(s.world, deckTile)).toBe(true);
    expect(applyTool(s, "res", 12, ey)).toEqual({ ok: false, reason: "Tile is a road" });
    refreshLots(s);
    expect(s.world.lots.some((l) => 12 >= l.x && 12 < l.x + l.w && ey >= l.y && ey < l.y + l.h)).toBe(false);
  });

  it("bridges curves drawn with the curve tool", () => {
    const s = newCity(3);
    const ey = flat(s);
    carveCanal(s, ey, 12, 15);
    const pts = [{ x: 4.5, z: ey + 0.5 }, { x: 13.5, z: ey - 1.5 }, { x: 24.5, z: ey + 0.5 }];
    const plan = planRoad(s, ROAD.STREET, pts);
    expect(plan.ok).toBe(true);
    expect(plan.span).toBe("bridge");
    expect(placeRoad(s, ROAD.STREET, pts).ok).toBe(true);
    expect(s.world.segments.some((seg) => segElevation(seg) === "bridge")).toBe(true);
  });

  it("leaves water and heights under the deck untouched, so boats pass", () => {
    const s = newCity(3);
    const ey = flat(s);
    carveCanal(s, ey, 10, 15);
    const before = Array.from(s.world.heights);
    expect(placeRoad(s, ROAD.STREET, across(ey, 4, 21)).ok).toBe(true);
    expect(Array.from(s.world.heights)).toEqual(before);
    for (let x = 10; x <= 15; x++) expect(isLand(s.world, x, ey)).toBe(false);
  });

  it("gives decks no frontage and no pipes", () => {
    const s = newCity(3);
    const ey = flat(s);
    carveCanal(s, ey, 10, 15);
    expect(placeRoad(s, ROAD.STREET, across(ey, 4, 21)).ok).toBe(true);
    // Water under the deck has no street frontage.
    expect(getFrontage(s.world).road[idx(s.world, 12, ey)]).toBe(-1);
    // The utility flood stops at the shore: it never crosses the deck.
    const dist = floodRoads(s.world, [idx(s.world, 4, ey)]);
    expect(dist[idx(s.world, 4, ey)]).toBe(0);
    expect(dist[idx(s.world, 21, ey)]).toBe(-1);
  });

  it("refuses bus stops on the deck", () => {
    const s = newCity(3);
    const ey = flat(s);
    carveCanal(s, ey, 10, 15);
    expect(placeRoad(s, ROAD.STREET, across(ey, 4, 21)).ok).toBe(true);
    expect(applyTool(s, "busstop", 12, ey)).toEqual({ ok: false, reason: "Bus stops go on a road" });
  });

  it("bulldozing the deck removes the whole bridge but keeps the approaches", () => {
    const s = newCity(3);
    const ey = flat(s);
    carveCanal(s, ey, 10, 15);
    expect(placeRoad(s, ROAD.STREET, across(ey, 4, 21)).ok).toBe(true);
    expect(applyTool(s, "bulldoze", 12, ey).ok).toBe(true);
    expect(s.world.segments.some((seg) => segElevation(seg) === "bridge")).toBe(false);
    expect(s.world.road[idx(s.world, 12, ey)]).toBe(0);
    expect(s.world.road[idx(s.world, 4, ey)]).toBe(ROAD.STREET);
    expect(s.world.road[idx(s.world, 21, ey)]).toBe(ROAD.STREET);
  });
});

describe("tunnels", () => {
  it("bores through a hill, leaving the ground above untouched and buildable", () => {
    const s = newCity(3);
    const ey = flat(s);
    raiseHill(s, ey, 10, 17);
    const before = Array.from(s.world.heights);
    const plan = planRoad(s, ROAD.STREET, across(ey, 3, 24));
    expect(plan.ok).toBe(true);
    expect(plan.span).toBe("tunnel");
    expect(placeRoad(s, ROAD.STREET, across(ey, 3, 24)).ok).toBe(true);
    expect(Array.from(s.world.heights)).toEqual(before);
    const tunnels = s.world.segments.filter((seg) => segElevation(seg) === "tunnel");
    expect(tunnels.length).toBe(1);
    const mid = idx(s.world, 13, ey);
    expect(s.world.road[mid]).toBe(ROAD.STREET);
    expect(s.world.roadSurface[mid]).toBe(0);
    expect(isTunnelTile(s.world, mid)).toBe(true);
    expect(blocksBuilding(s.world, mid)).toBe(false);
    // Traffic crosses under the hill.
    updateConnectivity(s.world);
    expect(s.world.connected[idx(s.world, 24, ey)]).toBe(1);
    const path = findPath(s.world, new Uint16Array(s.world.size * s.world.size), idx(s.world, 3, ey), idx(s.world, 24, ey));
    expect(path).not.toBeNull();
    // Zones and lots sit above the bore, and pipes ignore it.
    expect(applyTool(s, "res", 11, ey).ok).toBe(true);
    refreshLots(s);
    expect(s.world.lots.some((l) => 11 >= l.x && 11 < l.x + l.w && ey >= l.y && ey < l.y + l.h)).toBe(true);
    const dist = floodRoads(s.world, [idx(s.world, 3, ey)]);
    expect(dist[idx(s.world, 24, ey)]).toBe(-1);
    expect(applyTool(s, "busstop", 13, ey)).toEqual({ ok: false, reason: "Bus stops go on a road" });
  });

  it("levels small bumps as ground road and refuses very long bores", () => {
    const s = newCity(3);
    const ey = flat(s);
    raiseHill(s, ey, 10, 10, 2); // 1 tile over the rise: too short for a tunnel
    const small = planRoad(s, ROAD.STREET, across(ey, 3, 20));
    expect(small.ok).toBe(true);
    expect(small.span).toBeUndefined();
    expect(placeRoad(s, ROAD.STREET, across(ey, 3, 20)).ok).toBe(true);
    expect(tileHeight(s.world, 10, ey)).toBeLessThan(2);
    const t = newCity(3);
    const ey2 = flat(t);
    raiseHill(t, ey2, 6, 29); // 24 tiles: too long
    expect(planRoad(t, ROAD.STREET, across(ey2, 2, 36))).toMatchObject({ ok: false, reason: "Tunnel span too long" });
  });

  it("bulldozing a bore removes the whole tunnel", () => {
    const s = newCity(3);
    const ey = flat(s);
    raiseHill(s, ey, 10, 17);
    expect(placeRoad(s, ROAD.STREET, across(ey, 3, 24)).ok).toBe(true);
    expect(applyTool(s, "bulldoze", 13, ey).ok).toBe(true);
    expect(s.world.segments.some((seg) => segElevation(seg) === "tunnel")).toBe(false);
    expect(s.world.road[idx(s.world, 13, ey)]).toBe(0);
    expect(s.world.road[idx(s.world, 3, ey)]).toBe(ROAD.STREET);
  });
});

describe("saves with elevation", () => {
  const cityWithSpans = (): CityState => {
    const s = newCity(3);
    const ey = flat(s);
    carveCanal(s, ey, 30, 35);
    raiseHill(s, ey, 10, 17);
    expect(placeRoad(s, ROAD.STREET, across(ey, 3, 24)).ok).toBe(true);
    expect(placeRoad(s, ROAD.STREET, across(ey, 26, 41)).ok).toBe(true);
    return s;
  };

  it("round-trips bridge and tunnel segments", () => {
    const a = cityWithSpans();
    const b = deserialize(serialize(a));
    const elev = (s: CityState) => s.world.segments.map((seg) => seg.elevation ?? "ground").sort();
    expect(elev(b)).toEqual(elev(a));
    expect(b.world.segments.some((seg) => seg.elevation === "bridge")).toBe(true);
    expect(b.world.segments.some((seg) => seg.elevation === "tunnel")).toBe(true);
    // Derived masks rebuild: the deck keeps its height, the bore stays off the surface.
    expect(isBridgeTile(b.world, idx(b.world, 32, b.world.entry.y))).toBe(true);
    expect(isTunnelTile(b.world, idx(b.world, 13, b.world.entry.y))).toBe(true);
    expect(Array.from(b.world.road)).toEqual(Array.from(a.world.road));
  });

  it("loads old saves without elevation as ground", () => {
    const a = cityWithSpans();
    const json = JSON.parse(serialize(a)) as { segments: { elevation?: string }[] };
    for (const seg of json.segments) delete seg.elevation;
    const b = deserialize(JSON.stringify(json));
    expect(b.world.segments.every((seg) => segElevation(seg) === "ground")).toBe(true);
    const bad = JSON.parse(serialize(a)) as { segments: { elevation?: string }[] };
    bad.segments[1].elevation = "sky";
    expect(() => deserialize(JSON.stringify(bad))).toThrow();
  });
});

describe("deck profile", () => {
  it("ramps from each shore to max(shores)+0.5 with a gentle slope", () => {
    const p = bridgeProfile(10, 0.3, 0.3);
    expect(p.deck).toBeCloseTo(0.8);
    expect(deckYAt(p, 0)).toBeCloseTo(0.3);
    expect(deckYAt(p, 10)).toBeCloseTo(0.3);
    expect(deckYAt(p, 5)).toBeCloseTo(0.8);
    let maxSlope = 0;
    for (let s = 0; s < 10; s += 0.25) {
      maxSlope = Math.max(maxSlope, Math.abs(deckYAt(p, s + 0.25) - deckYAt(p, s)) / 0.25);
    }
    expect(maxSlope).toBeLessThan(0.45);
    // Uneven shores lengthen the low-side ramp instead of steepening it.
    const q = bridgeProfile(20, 0.3, 2);
    expect(q.deck).toBeCloseTo(2.5);
    expect(q.ramp0).toBeGreaterThan(q.ramp1);
    let qMax = 0;
    for (let s = 0; s < 20; s += 0.25) {
      qMax = Math.max(qMax, Math.abs(deckYAt(q, s + 0.25) - deckYAt(q, s)) / 0.25);
    }
    expect(qMax).toBeLessThan(0.5);
  });

  it("samples deck height along a real span", () => {
    const s = newCity(3);
    const ey = flat(s);
    carveCanal(s, ey, 10, 15);
    expect(placeRoad(s, ROAD.STREET, across(ey, 4, 21)).ok).toBe(true);
    const deck = s.world.segments.find((seg) => segElevation(seg) === "bridge")!;
    const sampler = makeDeckSampler(s.world, deck.pts);
    const y0 = sampler.yAt(0), y1 = sampler.yAt(sampler.length);
    expect(y0).toBeGreaterThan(0);
    expect(y1).toBeGreaterThan(0);
    expect(sampler.yAt(sampler.length / 2)).toBeCloseTo(Math.max(y0, y1) + 0.5, 6);
    // Every stamped tile matches the sampler at its centre.
    for (const t of deck.tiles) {
      const y = sampler.yAt(sampler.sAt((t % s.world.size) + 0.5, ((t / s.world.size) | 0) + 0.5));
      expect(s.world.deckH[t]).toBeCloseTo(y, 6);
    }
  });

  it("splits lines and curves into three exact-jointed pieces", () => {
    const [b, m, a] = splitPtsAt([{ x: 0, z: 0 }, { x: 10, z: 0 }], 0.25, 0.75);
    expect(b[b.length - 1]).toEqual(m[0]);
    expect(m[m.length - 1]).toEqual(a[0]);
    expect(m[0].x).toBeCloseTo(2.5);
    expect(m[m.length - 1].x).toBeCloseTo(7.5);
    const [cb, cm, ca] = splitPtsAt([{ x: 0, z: 0 }, { x: 5, z: 10 }, { x: 10, z: 0 }], 0.2, 0.8);
    expect(cb[cb.length - 1]).toEqual(cm[0]);
    expect(cm[cm.length - 1]).toEqual(ca[0]);
  });

  it("detects no span on plain ground", () => {
    const s = newCity(3);
    const ey = flat(s);
    expect(detectSpan(s.world, ROAD.STREET, across(ey, 4, 20))).toEqual({ ok: true, span: null });
  });
});
