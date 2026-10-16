import { describe, expect, it } from "vitest";
import { newCity, placeRoad, CityState } from "./sim";
import {
  IDM_A, IDM_B, IDM_DEC, IDM_LAT, IDM_S0, IDM_SUBSTEP, IDM_T,
  Vehicle, findLayeredPath, findPath, halfLength, idmAccel, newTraffic, pitchFromHeights,
  pointAtRouteArc, redCrawl, routeArcLengths, routeHeightAt, routePath, routePitchAt, tickTraffic, turnSide, vmaxAt,
  ROAD_SPEED,
} from "./traffic";
import type { TrafficState } from "./traffic";
import { signalOffset } from "./signals";
import { junctionsOf } from "./junction";
import { addSegment } from "./roads";
import { ROAD, cidx, idx, makeDeckSampler, rebuildRoadRaster, segElevation, updateConnectivity } from "./world";

/** Dry flat ground around the entry so layouts do not depend on the seed. */
function flat(s: CityState, x1 = 70) {
  const ey = s.world.entry.y;
  for (let y = ey - 16; y <= ey + 16; y++)
    for (let x = 0; x <= x1; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e7;
  return ey;
}
const line = (s: CityState, type: number, x0: number, y0: number, x1: number, y1: number) =>
  placeRoad(s, type as 1 | 2 | 3, [{ x: x0 + 0.5, z: y0 + 0.5 }, { x: x1 + 0.5, z: y1 + 0.5 }]);

/** A car placed by hand on a known route (no spawning: population stays 0). */
function mkCar(id: number, s: CityState, tiles: number[], progress: number, v: number, vf: number, lane = 0): Vehicle {
  const pts = routePath(s.world, tiles, lane);
  return {
    id, kind: 0, lane, tiles: [...tiles], pts, progress, speedFactor: 1,
    v, vf, vmax: vmaxAt(pts), brake: 0, blink: 0, seed: 0.01 * id, stuck: false,
  };
}

function pose(v: Vehicle): { x: number; z: number; hx: number; hz: number } {
  const len = v.tiles.length;
  const at = Math.max(0, Math.min(len - 2, Math.floor(v.progress)));
  const f = Math.min(1, Math.max(0, v.progress - at));
  const ax = v.pts[at * 2], az = v.pts[at * 2 + 1];
  const bx = v.pts[at * 2 + 2], bz = v.pts[at * 2 + 3];
  const l = Math.hypot(bx - ax, bz - az) || 1;
  return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, hx: (bx - ax) / l, hz: (bz - az) / l };
}

/** Bumper-to-bumper gap with `b` ahead of `a`, in tiles. */
function gap(a: Vehicle, b: Vehicle): number {
  const pa = pose(a), pb = pose(b);
  return (pb.x - pa.x) * pa.hx + (pb.z - pa.z) * pa.hz - halfLength(a.kind) - halfLength(b.kind);
}

type Pose = { x: number; z: number; hx: number; hz: number; s: number };

/** Arc pose matching the sim's convention (progress indexes route points). */
function arcPose(v: Vehicle): Pose {
  const arcs = routeArcLengths(v.pts);
  let s: number;
  if (v.arc !== undefined) s = v.arc;
  else {
    const i = Math.max(0, Math.min(arcs.length - 2, Math.floor(v.progress)));
    const f = Math.max(0, Math.min(1, v.progress - i));
    s = arcs[i] + (arcs[i + 1] - arcs[i]) * f;
  }
  const p = pointAtRouteArc(v.pts, arcs, s);
  const i = Math.max(0, Math.min(arcs.length - 2, p.index));
  const dx = v.pts[i * 2 + 2] - v.pts[i * 2], dz = v.pts[i * 2 + 3] - v.pts[i * 2 + 1];
  const l = Math.hypot(dx, dz) || 1;
  return { x: p.x, z: p.z, hx: dx / l, hz: dz / l, s };
}

/** SAT overlap of two oriented 0.4 x 0.18 car rectangles. */
function carsOverlap(a: Pose, b: Pose): boolean {
  const HL = 0.2, HW = 0.09;
  const dx = b.x - a.x, dz = b.z - a.z;
  const axes = [[a.hx, a.hz], [-a.hz, a.hx], [b.hx, b.hz], [-b.hz, b.hx]];
  for (const [ux, uz] of axes) {
    const d = Math.abs(dx * ux + dz * uz);
    const ra = HL * Math.abs(a.hx * ux + a.hz * uz) + HW * Math.abs(-a.hz * ux + a.hx * uz);
    const rb = HL * Math.abs(b.hx * ux + b.hz * uz) + HW * Math.abs(-b.hz * ux + b.hx * uz);
    if (d > ra + rb) return false;
  }
  return true;
}

describe("IDM constants (Fable §2.3, converted in §1)", () => {
  it("matches the ported values", () => {
    expect(IDM_A).toBe(1.15);
    expect(IDM_B).toBe(1.34);
    expect(IDM_S0).toBe(0.18);
    expect(IDM_T).toBe(0.58);
    expect(IDM_DEC).toBe(-3.08);
    expect(IDM_LAT).toBe(1.38);
    expect(IDM_SUBSTEP).toBe(0.1);
  });

  it("idmAccel: free-road, equilibrium, braking, and total on contact", () => {
    expect(idmAccel(0, 3, 1e9, 0)).toBeCloseTo(IDM_A, 9);  // full accel from a stop
    expect(idmAccel(3, 3, 1e9, 0)).toBeCloseTo(0, 9);      // nothing left at v0
    expect(idmAccel(0, 3, IDM_S0, 0)).toBeCloseTo(0, 9);   // standstill rests at S0
    expect(idmAccel(0, 3, 0.1, 0)).toBeLessThan(0);        // too close pushes back
    expect(idmAccel(0, 3, 0.3, 0)).toBeGreaterThan(0);     // room ahead pulls forward
    expect(idmAccel(3, 3, 0.3, 2)).toBeLessThan(-2);       // closing fast brakes hard
    for (const g of [0, -0.5]) {
      const a = idmAccel(2, 3, g, 1);
      expect(Number.isFinite(a)).toBe(true);               // contact clamps, never NaN
      expect(a).toBeLessThan(0);
    }
  });
});

describe("vmaxAt cornering limits", () => {
  it("leaves straights unlimited and brakes before a right angle", () => {
    const straight = new Float32Array([0, 0, 1, 0, 2, 0, 3, 0]);
    expect([...vmaxAt(straight)].every((x) => x === Infinity)).toBe(true);
    const corner = new Float32Array([0, 0, 1, 0, 2, 0, 2, 1, 2, 2]);
    const v = vmaxAt(corner);
    // κ = 2·sin(45°)/1 = 1.414 → √(1.38/1.414) = 0.988 at the apex.
    expect(v[2]).toBeCloseTo(0.988, 2);
    // Backward pass with 0.65 tile/s² over 1-tile steps.
    expect(v[1]).toBeCloseTo(Math.sqrt(v[2] * v[2] + 2 * 0.65), 6);
    expect(v[0]).toBeCloseTo(Math.sqrt(v[1] * v[1] + 2 * 0.65), 6);
    expect(v[3]).toBe(Infinity); // past the apex is free again
  });
});

describe("turnSide", () => {
  it("reads left, right, straight, and the route end", () => {
    const left = new Float32Array([0, 0, 1, 0, 1, -1]);   // east, then north
    const right = new Float32Array([0, 0, 1, 0, 1, 1]);   // east, then south
    const straight = new Float32Array([0, 0, 1, 0, 2, 0]);
    expect(turnSide(left, 0)).toBe(1);
    expect(turnSide(right, 0)).toBe(-1);
    expect(turnSide(straight, 0)).toBe(0);
    expect(turnSide(left, 1)).toBe(0); // no turn left ahead at the end
  });
});

describe("IDM on a straight street", () => {
  function street() {
    const s = newCity(11);
    const ey = flat(s);
    expect(line(s, ROAD.STREET, 2, ey, 62, ey).ok).toBe(true);
    const t = newTraffic(s.world.size);
    const tiles = findPath(s.world, t.load, idx(s.world, 2, ey), idx(s.world, 62, ey))!;
    expect(tiles.length).toBeGreaterThan(50);
    return { s, t, tiles };
  }

  it("reaches 0.9·v0 on a free road within 5 s", () => {
    const { s, t, tiles } = street();
    t.vehicles.push(mkCar(1, s, tiles, 0, 0, 1));
    for (let i = 0; i < 50; i++) tickTraffic(s, t, 0.1);
    expect(t.vehicles).toHaveLength(1);
    expect(t.vehicles[0].v).toBeGreaterThan(0.9 * 3);
    expect(t.vehicles[0].v).toBeLessThanOrEqual(3.01);
  });

  it("follows at the IDM equilibrium gap without overlap", () => {
    const { s, t, tiles } = street();
    const lead = mkCar(1, s, tiles, 20, 1.5, 0.5);  // slow leader, v0 = 1.5
    const follow = mkCar(2, s, tiles, 5, 0, 1);     // catches up at v0 = 3
    t.vehicles.push(lead, follow);
    let minGap = Infinity;
    for (let i = 0; i < 250; i++) {
      tickTraffic(s, t, 0.1);
      if (t.vehicles.length < 2) break; // leader arrived: following done
      minGap = Math.min(minGap, gap(t.vehicles[1], t.vehicles[0]));
    }
    expect(minGap).toBeGreaterThanOrEqual(0);
    // Equilibrium: S0 + v·T = 0.18 + 1.5·0.58 = 1.05, plus the free-road term.
    const end = gap(t.vehicles[1] ?? follow, t.vehicles[0] ?? lead);
    if (t.vehicles.length === 2) {
      expect(end).toBeGreaterThan(0.7);
      expect(end).toBeLessThan(1.5);
      expect(t.vehicles[1].v).toBeCloseTo(1.5, 0);
      expect(t.vehicles[1].stuck).toBe(true);  // held up by the leader
      expect(t.vehicles[0].stuck).toBe(false); // free at its own pace
    }
  });

  it("a platoon never overlaps and replays exactly", () => {
    const run = () => {
      const { s, t, tiles } = street();
      for (let k = 0; k < 12; k++) {
        const v = mkCar(k + 1, s, tiles, 15 - 1.2 * k, 1, k === 0 ? 0.5 : 1);
        t.vehicles.push(v);
      }
      let minGap = Infinity;
      for (let i = 0; i < 250; i++) {
        tickTraffic(s, t, 0.1);
        const vs = [...t.vehicles].sort((a, b) => a.progress - b.progress);
        for (let k = 1; k < vs.length; k++) minGap = Math.min(minGap, gap(vs[k - 1], vs[k]));
        for (const v of t.vehicles) {
          expect(Number.isFinite(v.v)).toBe(true);
          expect(Number.isFinite(v.progress)).toBe(true);
          expect(v.v).toBeGreaterThanOrEqual(0);
        }
      }
      return { minGap, progress: t.vehicles.map((v) => v.progress), v: t.vehicles.map((v) => v.v) };
    };
    const a = run(), b = run();
    expect(a.minGap).toBeGreaterThanOrEqual(0);
    expect(b.minGap).toBeGreaterThanOrEqual(0);
    expect(a.progress).toEqual(b.progress);
    expect(a.v).toEqual(b.v);
  });

  it("a 1 s tick sub-steps instead of exploding", () => {
    const { s, t, tiles } = street();
    t.vehicles.push(mkCar(1, s, tiles, 10, 3, 1), mkCar(2, s, tiles, 8, 3, 1));
    tickTraffic(s, t, 1); // would be 10 headways in one Euler step
    expect(t.vehicles).toHaveLength(2);
    for (const v of t.vehicles) {
      expect(Number.isFinite(v.v)).toBe(true);
      expect(v.v).toBeGreaterThanOrEqual(0);
      expect(v.v).toBeLessThanOrEqual(3.01);
    }
    expect(gap(t.vehicles[1], t.vehicles[0])).toBeGreaterThan(-0.05);
  });

  it("does not treat a car 0.1 tile behind as a leader", () => {
    const { s, t, tiles } = street();
    const rear = mkCar(1, s, tiles, 3.0, 0, 1);
    const front = mkCar(2, s, tiles, 3.1, 0, 1);
    t.vehicles.push(rear, front);
    for (let i = 0; i < 80; i++) tickTraffic(s, t, 0.1);
    expect(t.vehicles).toHaveLength(2);
    expect(t.vehicles[0].progress).toBeGreaterThan(3.0);
    expect(t.vehicles[1].progress).toBeGreaterThan(3.1);
  });

  it("signals the side of the coming turn", () => {
    const s = newCity(12);
    const ey = flat(s);
    expect(line(s, ROAD.STREET, 2, ey, 30, ey).ok).toBe(true);
    expect(line(s, ROAD.STREET, 30, ey, 30, ey + 20).ok).toBe(true);
    const t = newTraffic(s.world.size);
    const tiles = findPath(s.world, t.load, idx(s.world, 2, ey), idx(s.world, 30, ey + 20))!;
    const car = mkCar(1, s, tiles, 0, 2, 1);
    t.vehicles.push(car);
    let lit = 0, wrongSide = 0;
    for (let i = 0; i < 200 && t.vehicles.length; i++) {
      tickTraffic(s, t, 0.1);
      if (!t.vehicles.length) break;
      const v = t.vehicles[0];
      // Blink was latched from the substep-start tile, up to one tile behind.
      const at = Math.floor(v.progress);
      const sides = new Set([turnSide(v.pts, at), turnSide(v.pts, at - 1)]);
      if (v.blink !== 0) {
        lit++;
        if (!sides.has(Math.sign(v.blink))) wrongSide++;
      }
    }
    expect(lit).toBeGreaterThan(0);
    expect(wrongSide).toBe(0);
  });
});

describe("IDM at a red light", () => {
  it("stops at the line, holds the brake, queues at S0, and clears on green", () => {
    const s = newCity(13);
    const ey = flat(s);
    expect(line(s, ROAD.STREET, 4, ey, 24, ey).ok).toBe(true);
    expect(line(s, ROAD.STREET, 14, ey - 8, 14, ey + 8).ok).toBe(true);
    const w = s.world;
    const t = newTraffic(w.size);
    const tiles = findPath(w, t.load, idx(w, 4, ey), idx(w, 24, ey))!;
    const j = tiles.indexOf(idx(w, 14, ey));
    expect(j).toBeGreaterThan(4); // the route crosses the junction tile
    // Prime the signal index, then pin the phase to red for the eastbound arm.
    tickTraffic(s, t, 0.01);
    const sn = t.sigNodes.find((n) => Math.hypot(n.x - 14.5, n.z - (ey + 0.5)) < 1.5)!;
    expect(sn).toBeDefined();
    const arm = sn.arms.reduce((b, a) => (-(a.dx * 1 + a.dz * 0) > -(b.dx * 1 + b.dz * 0) ? a : b));
    const wantPhase = arm.ns ? 1 : 0;
    const off = signalOffset(sn.id);
    t.time = (((-off) % 16 + 16) % 16) + wantPhase * 8 + 2; // 2 s into a red phase
    expect(redCrawl(w, t, tiles[j - 1], tiles[j], t.time)).toBe(0.3);
    t.vehicles.push(mkCar(1, s, tiles, j - 3, 3, 1), mkCar(2, s, tiles, j - 6, 3, 1));

    let minGap = Infinity, stopped = false, brakeAtStop = 0, frontAtStop = 0;
    for (let i = 0; i < 160; i++) { // 8 s: still red (6 s left) plus margin
      tickTraffic(s, t, 0.05);
      const vs = [...t.vehicles].sort((a, b) => a.progress - b.progress);
      for (let k = 1; k < vs.length; k++) minGap = Math.min(minGap, gap(vs[k - 1], vs[k]));
      const lead = t.vehicles[0];
      if (!stopped && lead.v < 0.05) {
        stopped = true;
        frontAtStop = lead.progress + halfLength(lead.kind);
      }
      if (stopped && t.vehicles.length === 2) break;
    }
    for (let i = 0; i < 10; i++) tickTraffic(s, t, 0.05); // let the lamp settle
    // The hold target is 0.9, approached asymptotically by the lamp smoothing.
    brakeAtStop = t.vehicles[0].brake;
    expect(stopped).toBe(true);
    expect(minGap).toBeGreaterThanOrEqual(0);
    expect(brakeAtStop).toBeGreaterThanOrEqual(0.89);
    expect(t.vehicles[0].stuck).toBe(true); // a red queue reads as congestion
    // Front bumper rests at the stop line: the junction tile entry minus 0.06.
    expect(frontAtStop).toBeGreaterThan(j - 0.5);
    expect(frontAtStop).toBeLessThan(j + 0.15);
    // The queue behind stands at S0 bumper to bumper.
    expect(gap(t.vehicles[1], t.vehicles[0])).toBeGreaterThan(0.05);
    expect(gap(t.vehicles[1], t.vehicles[0])).toBeLessThan(0.45);

    for (let i = 0; i < 400 && t.vehicles.length; i++) tickTraffic(s, t, 0.05);
    expect(t.completed).toBe(2); // green came and both cleared the junction
  });
});

describe("pitchFromHeights", () => {
  it("is zero on the flat, signed on a ramp, and clamped", () => {
    expect(pitchFromHeights(0.35, 0.35, 0.32)).toBe(0);
    expect(pitchFromHeights(0.5, 0.35, 0.32)).toBeCloseTo(Math.atan2(0.15, 0.32), 9);
    expect(pitchFromHeights(0.35, 0.5, 0.32)).toBeLessThan(0);
    expect(pitchFromHeights(10, 0, 0.32)).toBe(0.5);
    expect(pitchFromHeights(0, 10, 0.32)).toBe(-0.5);
  });
});

describe("ramp heights and pitch on a bridge", () => {
  function bridge() {
    const s = newCity(3);
    const ey = flat(s);
    expect(line(s, ROAD.STREET, 4, ey, 24, ey).ok).toBe(true);
    const pts = [{ x: 14.5, z: ey - 8 + 0.5 }, { x: 14.5, z: ey + 8 + 0.5 }];
    expect(placeRoad(s, ROAD.STREET, pts, "elevated").ok).toBe(true);
    const w = s.world;
    const t = newTraffic(w.size);
    const seg = w.segments.find((sg) => segElevation(sg) === "bridge")!;
    expect(seg).toBeDefined();
    return { s, w, t, seg };
  }

  it("rides the deck profile with the ramp sign and no steps", () => {
    const { w, t, seg } = bridge();
    const a = seg.tiles[0], b = seg.tiles[seg.tiles.length - 1];
    const lp = findLayeredPath(w, t.load, a, b) ?? { tiles: [...seg.tiles], layers: new Uint8Array(seg.tiles.length).fill(1) };
    const tiles = lp.tiles.length > 2 ? lp.tiles : [...seg.tiles];
    const layers = lp.layers.length === tiles.length ? lp.layers : new Uint8Array(tiles.length).fill(1);
    const pts = routePath(w, tiles);
    // Tile centres sit exactly on the stamped deck; between them the ride is smooth.
    for (let i = 0; i < tiles.length; i++) {
      if (layers[i] !== 1 || Number.isNaN(w.deckH[tiles[i]])) continue;
      expect(routeHeightAt(w, tiles, layers, pts, i)).toBeCloseTo(w.deckH[tiles[i]], 9);
    }
    let maxStep = 0, up = 0, down = 0, maxAbs = 0;
    for (let p = 0; p < tiles.length - 1.05; p += 0.1) {
      const y0 = routeHeightAt(w, tiles, layers, pts, p);
      const y1 = routeHeightAt(w, tiles, layers, pts, p + 0.1);
      maxStep = Math.max(maxStep, Math.abs(y1 - y0));
      const pitch = routePitchAt(w, tiles, layers, pts, p + 0.05, 0.2);
      maxAbs = Math.max(maxAbs, Math.abs(pitch));
      if (pitch > 0.02) up++;
      if (pitch < -0.02) down++;
    }
    expect(maxStep).toBeLessThan(0.12); // ramps climb gradually, never in steps
    expect(up).toBeGreaterThan(0);      // nose-up on the way up
    expect(down).toBeGreaterThan(0);    // nose-down on the way down
    expect(maxAbs).toBeLessThanOrEqual(0.5);
    // The interpolated ride tracks the true deck profile within 0.01 tile.
    const sampler = makeDeckSampler(w, seg.pts);
    let worst = 0;
    for (let p = 0; p < tiles.length - 1; p += 0.25) {
      const i = Math.min(tiles.length - 2, Math.floor(p)), f = p - i;
      const x = pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * f;
      const z = pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * f;
      worst = Math.max(worst, Math.abs(routeHeightAt(w, tiles, layers, pts, p) - sampler.yAt(sampler.sAt(x, z))));
    }
    expect(worst).toBeLessThan(0.01);
  });

  it("stays level on flat ground", () => {
    const { s, w, t } = bridge();
    const ey = s.world.entry.y;
    const tiles = findPath(w, t.load, idx(w, 4, ey), idx(w, 24, ey))!;
    const pts = routePath(w, tiles);
    for (let p = 0; p < tiles.length - 1; p += 0.5) {
      expect(routePitchAt(w, tiles, undefined, pts, p, 0.2)).toBeCloseTo(0, 9);
    }
  });
});

describe("lane-aware leaders", () => {
  function avenue() {
    const s = newCity(14);
    const ey = flat(s);
    // Start at x=8: the entry stub (x 0..3) would taper-splice the route and skew hand-built progress.
    expect(line(s, ROAD.AVENUE, 8, ey, 62, ey).ok).toBe(true);
    const t = newTraffic(s.world.size);
    const tiles = findPath(s.world, t.load, idx(s.world, 8, ey), idx(s.world, 62, ey))!;
    expect(tiles.length).toBeGreaterThan(50);
    return { s, t, tiles };
  }

  it("a car does not follow a slower car in the adjacent lane", () => {
    const { s, t, tiles } = avenue();
    const slow = mkCar(1, s, tiles, 12, 2.25, 0.5, 1); // lane 1, v0 = 2.25
    const fast = mkCar(2, s, tiles, 10, 4.5, 1, 0);    // lane 0, v0 = 4.5
    t.vehicles.push(slow, fast);
    for (let i = 0; i < 60; i++) tickTraffic(s, t, 0.1);
    expect(t.vehicles).toHaveLength(2);
    expect(t.vehicles[1].v).toBeGreaterThan(0.9 * 4.5); // still at free speed
    expect(t.vehicles[1].progress).toBeGreaterThan(t.vehicles[0].progress + 3); // pulled ahead
    expect(t.vehicles[1].stuck).toBe(false);
  });

  it("a car still follows a slower car in its own lane", () => {
    const { s, t, tiles } = avenue();
    const slow = mkCar(1, s, tiles, 12, 2.25, 0.5, 0);
    const fast = mkCar(2, s, tiles, 10, 4.5, 1, 0);
    t.vehicles.push(slow, fast);
    for (let i = 0; i < 120; i++) tickTraffic(s, t, 0.1);
    expect(t.vehicles).toHaveLength(2);
    expect(t.vehicles[1].v).toBeLessThan(3); // held near leader speed, not free 4.5
    expect(t.vehicles[1].progress).toBeLessThan(t.vehicles[0].progress);
  });
});

describe("same-lane leaders through bends and turns (Task 7 fix round 2)", () => {
  /** 45-degree two-segment avenue bend: east, then south-east. */
  function bend45() {
    const s = newCity(21);
    const ey = flat(s);
    // Widen the flattened apron past the diagonal's far corner (tile water
    // reads the corner below it, past flat()'s ey+16 edge).
    for (let y = ey - 16; y <= ey + 22; y++)
      for (let x = 0; x <= 76; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
    expect(line(s, ROAD.AVENUE, 8, ey, 48, ey).ok).toBe(true);
    expect(placeRoad(s, ROAD.AVENUE, [
      { x: 48.5, z: ey + 0.5 }, { x: 64.5, z: ey + 16.5 },
    ]).ok).toBe(true);
    const t = newTraffic(s.world.size);
    const tiles = findPath(s.world, t.load, idx(s.world, 8, ey), idx(s.world, 64, ey + 16))!;
    expect(tiles.length).toBeGreaterThan(50);
    return { s, t, tiles, apex: { x: 48.5, z: ey + 0.5 } };
  }

  /** Avenue x street tee; the route turns right (from the west) or left (from the east). */
  function tee(kind: "right" | "left") {
    const s = newCity(kind === "right" ? 22 : 23);
    const ey = flat(s);
    expect(line(s, ROAD.AVENUE, 8, ey, 66, ey).ok).toBe(true);
    expect(placeRoad(s, ROAD.STREET, [
      { x: 35.5, z: ey + 0.5 }, { x: 35.5, z: ey + 15.5 },
    ]).ok).toBe(true);
    const t = newTraffic(s.world.size);
    // Priority mode: this tests following through the turn, not the adaptive
    // signal lottery (wall-clock greens decide whether car 8 clears by 40 s).
    t.forcePriority = new Set(junctionsOf(s.world).byNode.keys());
    const from = kind === "right" ? idx(s.world, 8, ey) : idx(s.world, 66, ey);
    const tiles = findPath(s.world, t.load, from, idx(s.world, 35, ey + 15))!;
    expect(tiles.length).toBeGreaterThan(30);
    return { s, t, tiles, apex: { x: 35.5, z: ey + 0.5 } };
  }

  /**
   * 7 followers queue behind a slow leader for 40 simulated seconds. Returns
   * overlap onset/step counts plus whether every car drove through the bend.
   * The queue starts `start` ahead of the route start so it is bunched at the
   * bend entry yet clears the far signal inside the window.
   */
  function runQueue(
    s: CityState, t: TrafficState, tiles: number[], lane: number, apex: { x: number; z: number },
    start: number,
  ): { onsets: number; overlapSteps: number; first: string; traversed: boolean; apexMiss: number } {
    for (let k = 0; k < 8; k++) {
      const lead = k === 0;
      t.vehicles.push(mkCar(k + 1, s, tiles, start - 1.2 * k, lead ? 2.25 : 2, lead ? 0.5 : 1, lane));
    }
    // Bend arc: route point nearest the bend/turn centre.
    const pts0 = t.vehicles[0].pts;
    const arcs0 = routeArcLengths(pts0);
    let ai = 0, ad = Infinity;
    for (let i = 0; i < arcs0.length; i++) {
      const d = (pts0[i * 2] - apex.x) ** 2 + (pts0[i * 2 + 1] - apex.z) ** 2;
      if (d < ad) { ad = d; ai = i; }
    }
    const apexS = arcs0[ai];
    const maxS = new Map<number, number>();
    let prev = new Set<string>();
    let onsets = 0, overlapSteps = 0, first = "";
    for (let step = 0; step < 800; step++) {
      tickTraffic(s, t, 0.05);
      const poses = new Map<number, Pose>();
      for (const v of t.vehicles) {
        const p = arcPose(v);
        poses.set(v.id, p);
        maxS.set(v.id, Math.max(maxS.get(v.id) ?? -Infinity, p.s));
      }
      const ids = [...poses.keys()];
      const cur = new Set<string>();
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        if (!carsOverlap(poses.get(ids[a])!, poses.get(ids[b])!)) continue;
        const key = ids[a] < ids[b] ? `${ids[a]}-${ids[b]}` : `${ids[b]}-${ids[a]}`;
        cur.add(key);
        if (!prev.has(key)) {
          onsets++;
          if (!first) first = `step ${step} t=${(step * 0.05).toFixed(2)}s pair ${key}`;
        }
      }
      if (cur.size) overlapSteps++;
      prev = cur;
    }
    let traversed = true;
    for (let id = 1; id <= 8; id++) {
      if ((maxS.get(id) ?? -Infinity) < apexS + 1) traversed = false;
    }
    return { onsets, overlapSteps, first: first || "none", traversed, apexMiss: Math.sqrt(ad) };
  }

  it.each([0, 1])("a bend45 queue never overlaps (lane %i)", (lane) => {
    const { s, t, tiles, apex } = bend45();
    const r = runQueue(s, t, tiles, lane, apex, 30);
    expect(r.apexMiss, "route must pass the bend").toBeLessThan(1.5);
    expect(r.traversed, "whole queue must drive through the bend").toBe(true);
    expect(r.onsets, `overlap onsets (first: ${r.first}; ${r.overlapSteps} overlap steps)`).toBe(0);
    expect(r.overlapSteps, `overlap steps (first: ${r.first})`).toBe(0);
  });

  it.each([0, 1])("a tee right-turn queue never overlaps (lane %i)", (lane) => {
    const { s, t, tiles, apex } = tee("right");
    const r = runQueue(s, t, tiles, lane, apex, 20);
    expect(r.apexMiss, "route must pass the junction").toBeLessThan(1.5);
    expect(r.traversed, "whole queue must drive through the turn").toBe(true);
    expect(r.onsets, `overlap onsets (first: ${r.first}; ${r.overlapSteps} overlap steps)`).toBe(0);
    expect(r.overlapSteps, `overlap steps (first: ${r.first})`).toBe(0);
  });

  it.each([0, 1])("a tee left-turn queue never overlaps (lane %i)", (lane) => {
    const { s, t, tiles, apex } = tee("left");
    const r = runQueue(s, t, tiles, lane, apex, 20);
    expect(r.apexMiss, "route must pass the junction").toBeLessThan(1.5);
    expect(r.traversed, "whole queue must drive through the turn").toBe(true);
    expect(r.onsets, `overlap onsets (first: ${r.first}; ${r.overlapSteps} overlap steps)`).toBe(0);
    expect(r.overlapSteps, `overlap steps (first: ${r.first})`).toBe(0);
  });

  it("bend control: a car does not follow a slower car in the adjacent lane", () => {
    const { s, t, tiles } = bend45();
    const slow = mkCar(1, s, tiles, 12, 2.25, 0.5, 1);
    const fast = mkCar(2, s, tiles, 10, 4.5, 1, 0);
    t.vehicles.push(slow, fast);
    // 4 s: both cars stay well short of the corner joint (idx ~41) and its signal.
    for (let i = 0; i < 40; i++) tickTraffic(s, t, 0.1);
    expect(t.vehicles).toHaveLength(2);
    expect(t.vehicles[1].v).toBeGreaterThan(0.9 * 4.5); // still at free speed
    expect(t.vehicles[1].progress).toBeGreaterThan(t.vehicles[0].progress + 3); // pulled ahead
    expect(t.vehicles[1].stuck).toBe(false);
  });
});

describe("stopped-leader braking at free-flow speed (Task 7 fix round 4)", () => {
  /** Straight road of `type` from x=8 to x=66; the route row is probed (wide roads raster off-row). */
  function straight(type: number) {
    const s = newCity(21);
    const ey = flat(s);
    expect(line(s, type, 8, ey, 66, ey).ok).toBe(true);
    const t = newTraffic(s.world.size);
    let tiles: number[] | null = null;
    for (let y = ey - 2; y <= ey + 2 && !tiles; y++) {
      if (y < 0 || y >= s.world.size) continue;
      const a = idx(s.world, 8, y), b = idx(s.world, 66, y);
      if (s.world.road[a] && s.world.road[b]) tiles = findPath(s.world, t.load, a, b);
    }
    expect(tiles && tiles.length).toBeGreaterThan(50);
    return { s, t, tiles: tiles! };
  }

  /**
   * A frozen leader (v re-zeroed, position restored every step: a stopped car
   * at a queue tail) with 3 followers at free-flow speed `v0`, `spacing` tiles
   * apart. 600 x 0.05 s; SAT overlap over every pair plus a no-pass-through
   * check of each follower's furthest arc against the leader's frozen arc.
   */
  function runStoppedLeader(
    s: CityState, t: TrafficState, tiles: number[], lane: number, spacing: number, v0: number,
  ): { onsets: number; overlapSteps: number; first: string; endVehicles: number; followV: number; passed: boolean } {
    const leaderStart = 52;
    t.vehicles.push(mkCar(1, s, tiles, leaderStart, 0, 1, lane));
    for (let k = 1; k <= 3; k++) t.vehicles.push(mkCar(k + 1, s, tiles, leaderStart - spacing * k, v0, 1, lane));
    const leaderS = arcPose(t.vehicles[0]).s;
    let prev = new Set<string>();
    let onsets = 0, overlapSteps = 0, first = "";
    let maxFollowS = -Infinity;
    for (let step = 0; step < 600; step++) {
      const lead = t.vehicles[0];
      lead.v = 0;
      tickTraffic(s, t, 0.05);
      lead.v = 0;
      lead.progress = leaderStart;
      const poses = new Map<number, Pose>();
      for (const v of t.vehicles) {
        const p = arcPose(v);
        poses.set(v.id, p);
        if (v.id > 1) maxFollowS = Math.max(maxFollowS, p.s);
      }
      const ids = [...poses.keys()];
      const cur = new Set<string>();
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        if (!carsOverlap(poses.get(ids[a])!, poses.get(ids[b])!)) continue;
        const key = ids[a] < ids[b] ? `${ids[a]}-${ids[b]}` : `${ids[b]}-${ids[a]}`;
        cur.add(key);
        if (!prev.has(key)) {
          onsets++;
          if (!first) first = `step ${step} t=${(step * 0.05).toFixed(2)}s pair ${key}`;
        }
      }
      if (cur.size) overlapSteps++;
      prev = cur;
    }
    const follow = t.vehicles.find((v) => v.id === 2);
    return {
      onsets, overlapSteps, first: first || "none",
      endVehicles: t.vehicles.length, followV: follow?.v ?? -1, passed: maxFollowS > leaderS,
    };
  }

  function expectClean(
    r: { onsets: number; overlapSteps: number; first: string; endVehicles: number; followV: number; passed: boolean },
  ) {
    expect(r.endVehicles, "all 4 cars must stay on the road").toBe(4);
    expect(r.followV, "follower 1 must brake to a stop behind the leader").toBeLessThan(0.5);
    expect(r.passed, "no follower may pass the stopped leader").toBe(false);
    expect(r.onsets, `overlap onsets (first: ${r.first}; ${r.overlapSteps} overlap steps)`).toBe(0);
    expect(r.overlapSteps, `overlap steps (first: ${r.first})`).toBe(0);
  }

  const cells = [5, 8, 12].flatMap((spacing) => [0, 1].map((lane) => ({ spacing, lane })));

  it.each(cells)("street stops from free speed (spacing $spacing, lane $lane)", ({ spacing, lane }) => {
    const { s, t, tiles } = straight(ROAD.STREET);
    expectClean(runStoppedLeader(s, t, tiles, lane, spacing, ROAD_SPEED[ROAD.STREET]));
  });

  it.each(cells)("avenue stops from free speed (spacing $spacing, lane $lane)", ({ spacing, lane }) => {
    const { s, t, tiles } = straight(ROAD.AVENUE);
    expectClean(runStoppedLeader(s, t, tiles, lane, spacing, ROAD_SPEED[ROAD.AVENUE]));
  });

  // Highway at 7 tiles/s needs v^2/(2*|IDM_DEC|) = 7.95 tiles of braking plus
  // half-lengths and the S0 gap (~8.6 total), so spacings 5 and 8 sit below the
  // physical stopping limit: no lookahead fixes them without slowing highway
  // free speed (pre-existing gap, already present in 7905e38). Spacing 12 must
  // stop cleanly inside the clamped 10-tile lookahead.
  it.each([0, 1])("highway stops from free speed (spacing 12, lane %i)", (lane) => {
    const { s, t, tiles } = straight(ROAD.HIGHWAY);
    expectClean(runStoppedLeader(s, t, tiles, lane, 12, ROAD_SPEED[ROAD.HIGHWAY]));
  });
});

describe("red-light queues on every lane (Task 7 fix round 5)", () => {
  /**
   * Signalised east-west crossing of `cls`: street x street and avenue x
   * avenue via placeRoad (the backward hook needs the wide avenue junction,
   * so the avenue queue runs there), highway x street forced at grade with
   * addSegment (placeRoad grade-separates highways, leaving no signal). The
   * forced highway crossing keeps a forward exit-side kink on lanes 0/1
   * whose corner limit slows the 7 tiles/s approach onto the red line; that
   * kink needs a longer signal lookahead before it can be straightened.
   */
  function crossing(cls: number) {
    const s = newCity(cls === ROAD.STREET ? 31 : cls === ROAD.AVENUE ? 32 : 33);
    const ey = flat(s);
    const w = s.world;
    let crossX = 35;
    if (cls === ROAD.HIGHWAY) {
      addSegment(w, ROAD.HIGHWAY, [{ x: 6.5, z: ey + 0.5 }, { x: 60.5, z: ey + 0.5 }]);
      addSegment(w, ROAD.STREET, [{ x: crossX + 0.5, z: ey - 9.5 }, { x: crossX + 0.5, z: ey + 10.5 }]);
      rebuildRoadRaster(w);
      updateConnectivity(w);
    } else {
      const ns = cls === ROAD.AVENUE ? ROAD.AVENUE : ROAD.STREET;
      expect(line(s, cls, 6, ey, 62, ey).ok).toBe(true);
      expect(line(s, ns, crossX, ey - 9, crossX, ey + 9).ok).toBe(true);
    }
    const t = newTraffic(w.size);
    let tiles: number[] | null = null;
    for (let y = ey - 3; y <= ey + 3 && !tiles; y++) {
      if (y < 0 || y >= w.size) continue;
      const a = idx(w, 8, y), b = idx(w, 58, y);
      if (w.road[a] && w.road[b]) tiles = findPath(w, t.load, a, b);
    }
    expect(tiles && tiles.length).toBeGreaterThan(40);
    // Prime the signal index, then hold the eastbound arm red for the run.
    tickTraffic(s, t, 0.01);
    const sn = t.sigNodes.find((n) => Math.hypot(n.x - (crossX + 0.5), n.z - (ey + 0.5)) < 3)!;
    expect(sn).toBeDefined();
    expect(t.adaptiveSignals.get(sn.id)).toBeDefined();
    let ji = 0, jd = Infinity;
    tiles!.forEach((tile, i) => {
      const d = ((tile % w.size) + 0.5 - sn.x) ** 2 + (((tile / w.size) | 0) + 0.5 - sn.z) ** 2;
      if (d < jd) { jd = d; ji = i; }
    });
    expect(ji - 24).toBeGreaterThanOrEqual(2); // room for 5 cars behind the line
    return { s, t, tiles: tiles!, sn, ji };
  }

  /**
   * 5 cars in `lane` at free-flow speed drive at a held red for 30 s.
   * Returns overlap counts plus the worst nose penetration past a bar 0.25
   * before the node centre (the stop line sits ~0.7 before it) and how close
   * the leader's nose got (the queue must actually reach the line).
   */
  function runRedQueue(
    s: CityState, t: TrafficState, tiles: number[], lane: number,
    sn: { id: number; x: number; arms: { dx: number; dz: number; ns: boolean }[] }, ji: number, v0: number,
  ): { onsets: number; overlapSteps: number; first: string; maxPen: number; leaderReach: number } {
    for (let k = 0; k < 5; k++) t.vehicles.push(mkCar(k + 1, s, tiles, ji - 12 - 3 * k, v0, 1, lane));
    const arm = sn.arms.reduce((b, a) => (-(a.dx * 1 + a.dz * 0) > -(b.dx * 1 + b.dz * 0) ? a : b));
    const redPhase = arm.ns ? 1 : 0;
    let prev = new Set<string>();
    let onsets = 0, overlapSteps = 0, first = "";
    let maxPen = -Infinity, leaderReach = Infinity;
    for (let step = 0; step < 600; step++) {
      const c = t.adaptiveSignals.get(sn.id);
      if (c) { c.phase = redPhase; c.stage = "green"; c.elapsed = 0; }
      tickTraffic(s, t, 0.05);
      const poses = new Map<number, Pose>();
      for (const v of t.vehicles) poses.set(v.id, arcPose(v));
      for (const [id, p] of poses) {
        const noseX = p.x + p.hx * 0.2;
        maxPen = Math.max(maxPen, noseX - (sn.x - 0.25));
        if (id === 1) leaderReach = Math.min(leaderReach, sn.x - noseX);
      }
      const ids = [...poses.keys()];
      const cur = new Set<string>();
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        if (!carsOverlap(poses.get(ids[a])!, poses.get(ids[b])!)) continue;
        const key = ids[a] < ids[b] ? `${ids[a]}-${ids[b]}` : `${ids[b]}-${ids[a]}`;
        cur.add(key);
        if (!prev.has(key)) {
          onsets++;
          if (!first) first = `step ${step} t=${(step * 0.05).toFixed(2)}s pair ${key}`;
        }
      }
      if (cur.size) overlapSteps++;
      prev = cur;
    }
    return { onsets, overlapSteps, first: first || "none", maxPen, leaderReach };
  }

  const cells = [
    { cls: ROAD.STREET, name: "street" },
    { cls: ROAD.AVENUE, name: "avenue" },
    { cls: ROAD.HIGHWAY, name: "highway" },
  ].flatMap(({ cls, name }) => [0, 1].map((lane) => ({ cls, name, lane })));

  it.each(cells)("$name red queue holds without overlap (lane $lane)", ({ cls, name, lane }) => {
    const { s, t, tiles, sn, ji } = crossing(cls);
    const r = runRedQueue(s, t, tiles, lane, sn, ji, ROAD_SPEED[cls]);
    expect(t.completed, `${name} lane ${lane}: nobody may run the red`).toBe(0);
    expect(t.vehicles, `${name} lane ${lane}: all 5 cars stay queued`).toHaveLength(5);
    for (const v of t.vehicles) expect(v.v, `${name} lane ${lane}: car ${v.id} stopped`).toBeLessThan(0.5);
    expect(r.leaderReach, `${name} lane ${lane}: leader must reach the line`).toBeLessThan(3.0);
    expect(r.maxPen, `${name} lane ${lane}: every nose stays before the line`).toBeLessThanOrEqual(1e-9);
    expect(r.onsets, `${name} lane ${lane}: overlap onsets (first: ${r.first}; ${r.overlapSteps} overlap steps)`).toBe(0);
    expect(r.overlapSteps, `${name} lane ${lane}: overlap steps (first: ${r.first})`).toBe(0);
  }, 60000);
});
