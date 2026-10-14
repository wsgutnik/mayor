import { describe, expect, it } from "vitest";
import { newCity, placeRoad, CityState } from "./sim";
import {
  IDM_A, IDM_B, IDM_DEC, IDM_LAT, IDM_S0, IDM_SUBSTEP, IDM_T,
  Vehicle, findLayeredPath, findPath, halfLength, idmAccel, newTraffic, pitchFromHeights,
  redCrawl, routeHeightAt, routePath, routePitchAt, tickTraffic, turnSide, vmaxAt,
} from "./traffic";
import { signalOffset } from "./signals";
import { ROAD, cidx, idx, makeDeckSampler, segElevation } from "./world";

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
function mkCar(id: number, s: CityState, tiles: number[], progress: number, v: number, vf: number): Vehicle {
  const pts = routePath(s.world, tiles);
  return {
    id, kind: 0, tiles: [...tiles], pts, progress, speedFactor: 1,
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
