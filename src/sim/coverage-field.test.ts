import { describe, expect, it } from "vitest";
import {
  BUS_STOP_RADIUS, COVER, FAC, FACILITY_INFO, LAND_VALUE_LAYER, TRAFFIC_LAYER, UNDERGROUND_LAYER,
  ZONE, generateWorld, idx,
} from "./world";
import { MAX_RINGS, buildCoverageField, isCoverageLayer } from "./coverage-field";

/** Fresh all-land world with cover and roads cleared so tests control developed/covered exactly. */
function bare(size = 16) {
  const w = generateWorld(size, 7);
  w.heights.fill(0.35);
  w.cover.fill(0);
  w.road.fill(0);
  w.roadSurface.fill(0);
  return w;
}

const at = (f: { size: number; data: Uint8Array }, x: number, y: number) => {
  const k = (y * f.size + x) * 4;
  return { r: f.data[k], g: f.data[k + 1], b: f.data[k + 2] };
};

describe("coverage-field", () => {
  it("routes only single service bits to the coverage plane", () => {
    for (const bit of Object.values(COVER)) expect(isCoverageLayer(bit)).toBe(true);
    expect(isCoverageLayer(0)).toBe(false);
    expect(isCoverageLayer(LAND_VALUE_LAYER)).toBe(false);
    expect(isCoverageLayer(TRAFFIC_LAYER)).toBe(false);
    expect(isCoverageLayer(UNDERGROUND_LAYER)).toBe(false);
    expect(isCoverageLayer(COVER.POWER | COVER.WATER)).toBe(false);
  });

  it("marks a gap district: developed, uncovered, G below the edge", () => {
    const w = bare();
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) w.zone[idx(w, x, y)] = ZONE.RES;
    const f = buildCoverageField(w, COVER.POLICE);
    expect(f.developed).toBe(16);
    expect(f.servedFrac).toBe(0);
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) {
      const t = at(f, x, y);
      expect(t.r).toBe(0);
      expect(t.b).toBe(255);
      expect(t.g).toBeLessThan(128);
    }
  });

  it("ramps strength from the edge to the interior over 3 tiles", () => {
    const w = bare();
    for (let y = 3; y <= 11; y++) for (let x = 3; x <= 11; x++) {
      w.zone[idx(w, x, y)] = ZONE.RES;
      w.cover[idx(w, x, y)] = COVER.POLICE;
    }
    const f = buildCoverageField(w, COVER.POLICE);
    // distance 1 / 2 / 3 / 4 tiles from the uncovered edge
    expect(at(f, 3, 7).r).toBe(85);
    expect(at(f, 4, 7).r).toBe(170);
    expect(at(f, 5, 7).r).toBe(255);
    expect(at(f, 7, 7).r).toBe(255);
    expect(f.servedFrac).toBe(1);
  });

  it("encodes 0.5 at the boundary, rising inside and falling outside", () => {
    const w = bare();
    for (let y = 3; y <= 11; y++) for (let x = 3; x <= 11; x++) w.cover[idx(w, x, y)] = COVER.FIRE;
    const f = buildCoverageField(w, COVER.FIRE);
    expect(at(f, 3, 7).g).toBe(132); // 1 tile inside: 0.5 + 1/60
    expect(at(f, 2, 7).g).toBe(123); // 1 tile outside: 0.5 - 1/60
    expect(at(f, 7, 7).g).toBeGreaterThan(at(f, 3, 7).g);
    expect(at(f, 0, 7).g).toBeLessThan(at(f, 2, 7).g);
  });

  it("leaves undeveloped land out of the mask", () => {
    const w = bare();
    const t = at(buildCoverageField(w, COVER.PARK), 4, 8); // flattened entry strip: guaranteed land
    expect(t.b).toBe(0);
    expect(t.r).toBe(0);
  });

  it("treats roads as developed (the utility network reads on them)", () => {
    const w = generateWorld(16, 7);
    w.cover.fill(0);
    const f = buildCoverageField(w, COVER.POWER);
    // entry road tiles (0..2, 8) are road and land
    expect(at(f, 1, 8).b).toBe(255);
    expect(at(f, 1, 8).r).toBe(0);
  });

  it("rings one facility each, with the facility radius", () => {
    const w = bare();
    w.facility[idx(w, 2, 2)] = FAC.POLICE;
    w.facility[idx(w, 5, 5)] = FAC.POLICE;
    w.facility[idx(w, 9, 9)] = FAC.FIRE;
    const f = buildCoverageField(w, COVER.POLICE);
    expect(f.facilities).toBe(2);
    expect(f.rings).toHaveLength(2);
    expect(f.rings[0]).toEqual({ x: 2.5, z: 2.5, r: FACILITY_INFO[FAC.POLICE].radius });
    expect(buildCoverageField(w, COVER.FIRE).rings).toHaveLength(1);
  });

  it("counts a 2x2 facility once, at its anchor centre", () => {
    const w = bare();
    for (let y = 4; y < 6; y++) for (let x = 4; x < 6; x++) w.facility[idx(w, x, y)] = FAC.POWER;
    w.facilityAnchors = [{ x: 4, y: 4, kind: FAC.POWER, w: 2, h: 2 }];
    const f = buildCoverageField(w, COVER.POWER);
    expect(f.facilities).toBe(1);
    expect(f.rings).toEqual([{ x: 5, z: 5, r: FACILITY_INFO[FAC.POWER].radius }]);
  });

  it("caps rings at 48 but counts every facility", () => {
    const w = generateWorld(16, 7);
    w.cover.fill(0);
    let n = 0;
    for (let y = 0; y < 16 && n < 60; y++) for (let x = 0; x < 16 && n < 60; x++, n++) {
      w.facility[idx(w, x, y)] = FAC.POLICE;
    }
    const f = buildCoverageField(w, COVER.POLICE);
    expect(f.facilities).toBe(60);
    expect(f.rings).toHaveLength(MAX_RINGS);
  });

  it("rings bus stops (not metro stops) on the transit view", () => {
    const w = bare();
    w.stops.push({ id: 1, kind: "bus", tile: idx(w, 3, 3) });
    w.stops.push({ id: 2, kind: "metro", tile: idx(w, 6, 6) });
    const f = buildCoverageField(w, COVER.TRANSIT);
    expect(f.facilities).toBe(1);
    expect(f.rings).toEqual([{ x: 3.5, z: 3.5, r: BUS_STOP_RADIUS }]);
  });

  it("reports the served share of developed tiles", () => {
    const w = bare();
    const tiles = [[4, 8], [5, 8], [4, 9], [5, 9]];
    for (const [x, y] of tiles) w.zone[idx(w, x, y)] = ZONE.COM;
    w.cover[idx(w, 4, 8)] = COVER.EDU;
    w.cover[idx(w, 5, 8)] = COVER.EDU;
    const f = buildCoverageField(w, COVER.EDU);
    expect(f.developed).toBe(4);
    expect(f.servedFrac).toBe(0.5);
  });

  it("reuses a fitting caller buffer and is deterministic", () => {
    const w = bare();
    w.zone[idx(w, 4, 8)] = ZONE.RES;
    w.cover[idx(w, 4, 8)] = COVER.PARK;
    const buf = new Uint8Array(16 * 16 * 4);
    const a = buildCoverageField(w, COVER.PARK, buf);
    expect(a.data).toBe(buf);
    const b = buildCoverageField(w, COVER.PARK, new Uint8Array(4)); // wrong size: fresh buffer
    expect(b.data).not.toBe(buf);
    expect(b.data).toEqual(a.data);
  });

  it("bakes a 96x96 field in well under a frame", () => {
    const w = generateWorld(96, 11);
    for (let y = 40; y < 56; y++) for (let x = 40; x < 56; x++) {
      w.zone[idx(w, x, y)] = ZONE.RES;
      if ((x + y) % 2 === 0) w.cover[idx(w, x, y)] = COVER.POLICE;
    }
    w.facility[idx(w, 48, 48)] = FAC.POLICE;
    let best = Infinity;
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      buildCoverageField(w, COVER.POLICE);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(25);
  });
});
