import { describe, expect, it } from "vitest";
import { applyTool, newCity, placeRoad, planRoad, refreshLots, CityState } from "./sim";
import { ROAD, cidx, hasDeck, hasTunnel, idx, isBridgeTile, segElevation, updateConnectivity } from "./world";
import { addSegment } from "./roads";
import { findLayeredPath, findPath } from "./traffic";
import { signalNodes } from "./roads";
import { getFrontage } from "./blocks";
import { deserialize, serialize } from "./save";

function flat(s: CityState): number {
  const ey = s.world.entry.y;
  for (let y = ey - 16; y <= ey + 16; y++)
    for (let x = 0; x <= 60; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e7;
  return ey;
}
const H = (ey: number, x0: number, x1: number) => [{ x: x0 + 0.5, z: ey + 0.5 }, { x: x1 + 0.5, z: ey + 0.5 }];
const V = (x: number, y0: number, y1: number) => [{ x: x + 0.5, z: y0 + 0.5 }, { x: x + 0.5, z: y1 + 0.5 }];

/** Ground street E-W plus an elevated street N-S crossing at x=12. */
function overpassCity() {
  const s = newCity(3);
  const ey = flat(s);
  expect(placeRoad(s, ROAD.STREET, H(ey, 4, 20)).ok).toBe(true);
  const plan = planRoad(s, ROAD.STREET, V(12, ey - 8, ey + 8), "elevated");
  expect(plan.ok).toBe(true);
  expect(placeRoad(s, ROAD.STREET, V(12, ey - 8, ey + 8), "elevated").ok).toBe(true);
  return { s, ey };
}

describe("grade separation: model", () => {
  it("bridge over street creates no crossing node and does not split either road", () => {
    const { s, ey } = overpassCity();
    const w = s.world;
    const planPieces = w.segments.filter((sg) => !sg.fixed);
    // 1 ground street + 3 overpass pieces (ground, bridge, ground)
    expect(planPieces.length).toBe(4);
    expect(w.segments.filter((sg) => segElevation(sg) === "bridge").length).toBe(1);
    expect(w.segments.filter((sg) => segElevation(sg) === "ground").length).toBe(4); // entry + street + 2 ramps
    const crossNode = w.nodes.find((n) => Math.abs(n.x - 12.5) < 0.1 && Math.abs(n.z - (ey + 0.5)) < 0.1);
    expect(crossNode).toBeUndefined();
    expect(w.nodes.some((n) => n.segs.length >= 4)).toBe(false);
    // Shared tile: ground road stays surface, deck sits above it.
    const t = idx(w, 12, ey);
    expect(w.roadSurface[t]).toBe(ROAD.STREET);
    expect(w.roadDeck[t]).toBe(ROAD.STREET);
    expect(hasDeck(w, t)).toBe(true);
    expect(w.road[t]).toBe(ROAD.STREET);
    expect(Number.isNaN(w.deckH[t])).toBe(false);
    expect(w.roadLink[t]).toBe(0);
    // Ramp links are marked where ground pieces meet the deck.
    expect(w.segments.some((sg) => segElevation(sg) === "bridge")).toBe(true);
  });

  it("tunnel under avenue creates no crossing node", () => {
    const s = newCity(3);
    const ey = flat(s);
    expect(placeRoad(s, ROAD.AVENUE, H(ey, 4, 24)).ok).toBe(true);
    const plan = planRoad(s, ROAD.STREET, V(12, ey - 6, ey + 8), "tunnel");
    expect(plan.ok).toBe(true);
    expect(plan.span).toBe("tunnel");
    expect(plan.pieces!.map((p) => p.elevation)).toEqual(["ground", "tunnel", "ground"]);
    expect(placeRoad(s, ROAD.STREET, V(12, ey - 6, ey + 8), "tunnel").ok).toBe(true);
    const w = s.world;
    expect(w.segments.filter((sg) => segElevation(sg) === "tunnel").length).toBe(1);
    const crossNode = w.nodes.find((n) => Math.abs(n.x - 12.5) < 0.1 && Math.abs(n.z - (ey + 0.5)) < 0.6);
    expect(crossNode).toBeUndefined();
    const t = idx(w, 12, ey);
    expect(w.roadSurface[t]).toBe(ROAD.AVENUE);
    expect(hasTunnel(w, t)).toBe(true);
    // Portals sit at the ramps (tunnel ends), not at the crossed road: tunnel segment exists.
    const tun = w.segments.find((sg) => segElevation(sg) === "tunnel")!;
    expect(tun.tiles).toContain(t);
  });

  it("ground road drawn under an existing deck also gets no node", () => {
    const s = newCity(3);
    const ey = flat(s);
    expect(placeRoad(s, ROAD.STREET, V(12, ey - 8, ey + 8), "elevated").ok).toBe(false); // nothing to cross yet
    expect(placeRoad(s, ROAD.STREET, H(ey, 4, 20)).ok).toBe(true);
    expect(placeRoad(s, ROAD.STREET, V(12, ey - 8, ey + 8), "elevated").ok).toBe(true);
    const w = s.world;
    const deckSegs = w.segments.filter((sg) => segElevation(sg) === "bridge");
    expect(deckSegs.length).toBe(1);
    // A fresh ground street crossing the deck gets no node either.
    expect(placeRoad(s, ROAD.STREET, H(ey - 3, 4, 20)).ok).toBe(true);
    expect(w.nodes.some((n) => Math.abs(n.x - 12.5) < 0.1 && Math.abs(n.z - (ey - 2.5)) < 0.1)).toBe(false);
    expect(hasDeck(w, idx(w, 12, ey - 3))).toBe(true);
    expect(w.roadSurface[idx(w, 12, ey - 3)]).toBe(ROAD.STREET);
  });

  it("same-elevation crossing still makes a junction", () => {
    const s = newCity(3);
    const ey = flat(s);
    expect(placeRoad(s, ROAD.STREET, H(ey, 4, 20)).ok).toBe(true);
    expect(placeRoad(s, ROAD.STREET, V(12, ey - 5, ey + 5)).ok).toBe(true);
    expect(s.world.nodes.some((n) => n.segs.length === 4)).toBe(true);
    // Two bridges crossing at the same level also join.
    const t2 = newCity(3);
    flat(t2);
    const ey2 = t2.world.entry.y;
    addSegment(t2.world, ROAD.STREET, V(12, ey2 - 6, ey2 + 6), { elevation: "bridge" });
    addSegment(t2.world, ROAD.STREET, H(ey2, 4, 20), { elevation: "bridge" });
    expect(t2.world.nodes.some((n) => n.segs.length === 4)).toBe(true);
  });
});

describe("grade separation: planner", () => {
  it("refuses Elevado/Subterrâneo with Nothing to cross and short tunnels", () => {
    const s = newCity(3);
    const ey = flat(s);
    expect(planRoad(s, ROAD.STREET, H(ey, 4, 20), "elevated")).toMatchObject({ ok: false, reason: "Nothing to cross" });
    expect(planRoad(s, ROAD.STREET, H(ey, 4, 20), "tunnel")).toMatchObject({ ok: false, reason: "Nothing to cross" });
    expect(placeRoad(s, ROAD.STREET, H(ey, 4, 20), "elevated").ok).toBe(false);
    // Crossing exists but the bore is too short.
    expect(placeRoad(s, ROAD.STREET, H(ey, 4, 20)).ok).toBe(true);
    expect(planRoad(s, ROAD.STREET, V(12, ey - 1, ey + 1), "tunnel")).toMatchObject({ ok: false, reason: "Tunnel too short" });
  });

  it("Elevado ramps are ground pieces at both ends, cost is multiplied", () => {
    const s = newCity(3);
    const ey = flat(s);
    expect(placeRoad(s, ROAD.STREET, H(ey, 4, 20)).ok).toBe(true);
    const plan = planRoad(s, ROAD.STREET, V(12, ey - 8, ey + 8), "elevated");
    expect(plan.ok).toBe(true);
    expect(plan.span).toBe("bridge");
    expect(plan.pieces!.map((p) => p.elevation)).toEqual(["ground", "bridge", "ground"]);
    expect(plan.pieces![0].tiles.length).toBeGreaterThanOrEqual(2);
    expect(plan.pieces![2].tiles.length).toBeGreaterThanOrEqual(2);
    expect(plan.cost).toBeGreaterThan(plan.newTiles * 20);
  });
});

describe("grade separation: traffic and raster", () => {
  it("keeps ground frontage, ignores deck for lots/stops/signals", () => {
    const { s, ey } = overpassCity();
    const w = s.world;
    const deckTile = idx(w, 12, ey - 3);
    expect(isBridgeTile(w, deckTile)).toBe(true);
    expect(w.roadSurface[deckTile]).toBe(0);
    expect(getFrontage(w).road[deckTile]).toBe(-1);
    expect(applyTool(s, "res", 12, ey - 3)).toEqual({ ok: false, reason: "Tile is a road" });
    expect(applyTool(s, "busstop", 12, ey - 3)).toEqual({ ok: false, reason: "Bus stops go on a road" });
    refreshLots(s);
    expect(s.world.lots.some((l) => 12 >= l.x && 12 < l.x + l.w && ey - 3 >= l.y && ey - 3 < l.y + l.h)).toBe(false);
    // Ground road under the deck still serves lots and stops.
    expect(w.roadSurface[idx(w, 12, ey)]).toBe(ROAD.STREET);
    expect(applyTool(s, "busstop", 8, ey).ok).toBe(true);
    // No signal is created at the overpass crossing.
    expect(signalNodes(w).length).toBe(0);
  });

  it("traffic cannot turn between deck and ground except via ramps", () => {
    const { s, ey } = overpassCity();
    const w = s.world;
    updateConnectivity(w);
    const load = new Uint16Array(w.size * w.size);
    const west = idx(w, 4, ey), east = idx(w, 20, ey);
    const groundPath = findLayeredPath(w, load, west, east)!;
    expect(groundPath).not.toBeNull();
    expect([...groundPath.layers].every((l) => l === 0)).toBe(true);
    const north = idx(w, 12, ey - 8), south = idx(w, 12, ey + 8);
    const deckPath = findLayeredPath(w, load, north, south)!;
    expect(deckPath).not.toBeNull();
    expect([...deckPath.layers].some((l) => l === 1)).toBe(true);
    // The ground street and the isolated ramps have no connection at the crossing.
    expect(findPath(w, load, west, north)).toBeNull();
    expect(findPath(w, load, west, south)).toBeNull();
  });

  it("tunnel traffic stays in its layer and stops ignore tunnel tiles", () => {
    const s = newCity(3);
    const ey = flat(s);
    expect(placeRoad(s, ROAD.AVENUE, H(ey, 4, 24)).ok).toBe(true);
    expect(placeRoad(s, ROAD.STREET, V(12, ey - 6, ey + 8), "tunnel").ok).toBe(true);
    const w = s.world;
    const load = new Uint16Array(w.size * w.size);
    const p = findLayeredPath(w, load, idx(w, 12, ey - 6), idx(w, 12, ey + 8))!;
    expect(p).not.toBeNull();
    expect([...p.layers].some((l) => l === 2)).toBe(true);
    expect(findPath(w, load, idx(w, 4, ey), idx(w, 12, ey - 6))).toBeNull();
    expect(applyTool(s, "busstop", 12, ey + 3)).toEqual({ ok: false, reason: "Bus stops go on a road" });
  });
});

describe("grade separation: bulldoze and save", () => {
  it("bulldozing a deck tile removes the whole deck but keeps the ground road", () => {
    const { s, ey } = overpassCity();
    expect(applyTool(s, "bulldoze", 12, ey - 3).ok).toBe(true);
    expect(s.world.segments.some((sg) => segElevation(sg) === "bridge")).toBe(false);
    expect(s.world.roadSurface[idx(s.world, 12, ey)]).toBe(ROAD.STREET);
    expect(s.world.road[idx(s.world, 4, ey)]).toBe(ROAD.STREET);
  });

  it("bulldozing the ground road away from the crossing keeps the deck", () => {
    const { s, ey } = overpassCity();
    expect(applyTool(s, "bulldoze", 6, ey).ok).toBe(true);
    expect(s.world.segments.some((sg) => segElevation(sg) === "bridge")).toBe(true);
    expect(hasDeck(s.world, idx(s.world, 12, ey))).toBe(true);
  });

  it("bulldozing at the shared crossing tile removes only the deck", () => {
    const { s, ey } = overpassCity();
    expect(applyTool(s, "bulldoze", 12, ey).ok).toBe(true);
    expect(s.world.segments.some((sg) => segElevation(sg) === "bridge")).toBe(false);
    expect(s.world.roadSurface[idx(s.world, 12, ey)]).toBe(ROAD.STREET);
  });

  it("save round-trip preserves the separation", () => {
    const { s, ey } = overpassCity();
    const b = deserialize(serialize(s));
    expect(b.world.segments.filter((sg) => segElevation(sg) === "bridge").length).toBe(1);
    const t = idx(b.world, 12, ey);
    expect(b.world.roadSurface[t]).toBe(ROAD.STREET);
    expect(b.world.roadDeck[t]).toBe(ROAD.STREET);
    expect(b.world.nodes.some((n) => Math.abs(n.x - 12.5) < 0.1 && Math.abs(n.z - (ey + 0.5)) < 0.1)).toBe(false);
    expect([...b.world.roadDeck]).toEqual([...s.world.roadDeck]);
  });
});
