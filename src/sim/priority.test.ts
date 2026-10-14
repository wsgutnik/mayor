import { describe, expect, it } from "vitest";
import { CityState, newCity, placeRoad } from "./sim";
import { TrafficState, Vehicle, findPath, halfLength, newTraffic, pointAtRouteArc, routeArcLengths, routeMovesOf, routePath, tickTraffic, vmaxAt } from "./traffic";
import { JunctionLayout, junctionsOf } from "./junction";
import { hasSignal } from "./roads";
import { ROAD, World, cidx, idx } from "./world";
import {
  PriorityTable, buildPriorityTable, newClaimSet, polylineDistance, priorityTableOf, resolveClaims, upsertClaim,
} from "./priority";
import type { LaneConnector } from "./lanes";

/**
 * Throughput of the pre-priority model on `stressFixture(7)`: vehicles
 * completed in 600 simulated seconds at 20 spawns/s, measured on commit
 * 0e938cf (before this change: no right of way, cars drove through each
 * other in the box, and straight routes repeated their connector three times).
 */
const BASELINE_COMPLETED_600S = 1077;

function flat(s: CityState, x1 = 70): number {
  const ey = s.world.entry.y;
  for (let y = ey - 16; y <= ey + 16; y++) for (let x = 0; x <= x1; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e7;
  return ey;
}
const line = (s: CityState, type: number, x0: number, y0: number, x1: number, y1: number): boolean =>
  placeRoad(s, type as 1, [{ x: x0 + 0.5, z: y0 + 0.5 }, { x: x1 + 0.5, z: y1 + 0.5 }]).ok;

function layoutAt(w: World, x: number, y: number): JunctionLayout {
  for (const l of junctionsOf(w).byNode.values()) if (Math.hypot(l.centre.x - x - 0.5, l.centre.z - y - 0.5) < 0.6) return l;
  throw new Error(`no junction at ${x},${y}`);
}
/** Arm index whose outward direction best matches (dx, dz). */
const armToward = (l: JunctionLayout, dx: number, dz: number): number =>
  l.arms.reduce((b, a, i) => (a.dx * dx + a.dz * dz > l.arms[b].dx * dx + l.arms[b].dz * dz ? i : b), 0);
const connOf = (l: JunctionLayout, inArm: number, outArm: number): number =>
  l.connectors.findIndex((c) => c.inArm === inArm && c.outArm === outArm);

/** An arc-driven car on a known route, front bumper `before` tiles ahead of its first connector. */
function car(s: CityState, id: number, from: number, to: number, v = 2, before = 3): Vehicle {
  const w = s.world;
  const tiles = findPath(w, new Uint16Array(w.size * w.size), from, to)!;
  const pts = routePath(w, tiles);
  const arcs = routeArcLengths(pts);
  const mv = routeMovesOf(pts)!;
  const arc = Math.max(0, arcs[mv.i0[0]] - before - halfLength(0));
  return {
    id, kind: 0, tiles, pts, progress: 0, arc, arcs, speedFactor: 1, v, vf: 1,
    vmax: vmaxAt(pts), brake: 0, blink: 0, seed: 0, stuck: false,
  };
}

interface Occ { node: number; conn: number; id: number; skip: boolean }
/** Vehicles whose body overlaps a priority junction connector right now. */
function occupancy(t: TrafficState): Occ[] {
  const out: Occ[] = [];
  for (const v of t.vehicles) {
    const m = routeMovesOf(v.pts);
    if (!m || !v.arcs) continue;
    const s = v.arc ?? 0, half = halfLength(v.kind);
    for (let j = 0; j < m.n; j++) {
      const cs = t.prioNodes.get(m.node[j]);
      if (!cs || cs.layout !== m.layouts[j]) continue;
      if (s + half > v.arcs[m.i0[j]] && s - half < v.arcs[m.i1[j]]) {
        out.push({ node: m.node[j], conn: m.conn[j], id: v.id, skip: v.prioSkip === j });
      }
    }
  }
  return out;
}
/** Conflicting pairs inside the same box (claims that timed out are reported apart). */
function violations(t: TrafficState): { hard: number; timedOut: number } {
  const occ = occupancy(t);
  let hard = 0, timedOut = 0;
  for (let a = 0; a < occ.length; a++) for (let b = a + 1; b < occ.length; b++) {
    const A = occ[a], B = occ[b];
    if (A.node !== B.node || A.id === B.id) continue;
    const tab = t.prioNodes.get(A.node)!.table;
    if (!tab.conflict[A.conn * tab.k + B.conn]) continue;
    if (A.skip || B.skip) timedOut++; else hard++;
  }
  return { hard, timedOut };
}

/** Run until every car finishes; record first box entry time per car and conflicting overlaps. */
function drive(s: CityState, t: TrafficState, seconds: number): { enter: Map<number, number>; hard: number } {
  const enter = new Map<number, number>();
  let hard = 0;
  for (let i = 0; i < seconds * 20 && t.vehicles.length; i++) {
    tickTraffic(s, t, 0.05);
    for (const o of occupancy(t)) if (!enter.has(o.id)) enter.set(o.id, t.time);
    hard += violations(t).hard;
  }
  return { enter, hard };
}

describe("conflict table", () => {
  function tee() {
    const s = newCity(11);
    const ey = flat(s);
    expect(line(s, ROAD.STREET, 4, ey, 30, ey)).toBe(true);
    expect(line(s, ROAD.STREET, 16, ey, 16, ey + 12)).toBe(true);
    return { s, ey, l: layoutAt(s.world, 16, ey) };
  }

  it("is symmetric, never self-conflicting, and flags every crossing or shared exit", () => {
    const { s, l } = tee();
    expect(hasSignal(s.world, l.nodeId)).toBe(false);
    expect(l.arms).toHaveLength(3);
    expect(l.connectors).toHaveLength(6);
    const t = priorityTableOf(l);
    expect(priorityTableOf(l)).toBe(t); // cached per layout object
    const k = t.k, C = l.connectors;
    for (let i = 0; i < k; i++) {
      expect(t.conflict[i * k + i]).toBe(0);
      for (let j = 0; j < k; j++) {
        expect(t.conflict[i * k + j]).toBe(t.conflict[j * k + i]);
        if (i === j) continue;
        const sameIn = C[i].inArm === C[j].inArm && C[i].inLane === C[j].inLane;
        const sameOut = C[i].outArm === C[j].outArm && C[i].outLane === C[j].outLane;
        if (sameIn) expect(t.conflict[i * k + j]).toBe(0);
        else if (sameOut || polylineDistance(C[i].points, C[j].points) === 0) expect(t.conflict[i * k + j]).toBe(1);
        // Never mark a pair that stays a full lane apart.
        if (!sameOut && polylineDistance(C[i].points, C[j].points) > 0.38) expect(t.conflict[i * k + j]).toBe(0);
      }
    }
    // Opposing straights on the through road pass side by side.
    const e = armToward(l, 1, 0), wst = armToward(l, -1, 0);
    expect(t.conflict[connOf(l, e, wst) * k + connOf(l, wst, e)]).toBe(0);
  });

  it("reads handedness from the lanes: the far turn crosses the oncoming straight", () => {
    const { l } = tee();
    const t = priorityTableOf(l);
    const e = armToward(l, 1, 0), wst = armToward(l, -1, 0), stem = armToward(l, 0, 1);
    // The through-road turn into the stem that conflicts with the oncoming straight is the far turn.
    const fromE = connOf(l, e, stem), fromW = connOf(l, wst, stem);
    const farFrom = l.connectors[fromE].turn === t.farTurn ? fromE : fromW;
    const oncoming = farFrom === fromE ? connOf(l, wst, e) : connOf(l, e, wst);
    expect(l.connectors[farFrom].turn).toBe(t.farTurn);
    expect(t.conflict[farFrom * t.k + oncoming]).toBe(1);
    // ... and the near turn does not.
    const near = farFrom === fromE ? fromW : fromE;
    const nearOncoming = near === fromE ? connOf(l, wst, e) : connOf(l, e, wst);
    expect(t.conflict[near * t.k + nearOncoming]).toBe(0);
    // Mirroring the junction flips the hand and with it both rules.
    const mirror = (p: { x: number; z: number }) => ({ x: 2 * l.centre.x - p.x, z: p.z });
    const arms = l.arms.map((a) => ({ dx: -a.dx, dz: a.dz, type: a.type }));
    const flip = { left: "right", right: "left", straight: "straight", uturn: "uturn" } as const;
    const conns: LaneConnector[] = l.connectors.map((c) => ({ ...c, turn: flip[c.turn], points: c.points.map(mirror) }));
    const m = buildPriorityTable(l.nodeId, l.centre, arms, conns);
    expect(m.hand).toBe(-t.hand as 1 | -1);
    expect(m.farTurn).toBe(flip[t.farTurn]);
    expect(m.prioritySide).toBe(flip[t.prioritySide]);
    expect([...m.conflict]).toEqual([...t.conflict]);
  });

  it("equal T: the far turn yields to oncoming straight; the priority side wins among the rest", () => {
    const { l } = tee();
    const t = priorityTableOf(l);
    const k = t.k;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      if (t.yields[i * k + j]) expect(t.conflict[i * k + j]).toBe(1); // only conflicting pairs yield
      expect(t.yields[i * k + j] && t.yields[j * k + i]).toBeFalsy();  // never both ways
    }
    const e = armToward(l, 1, 0), wst = armToward(l, -1, 0), stem = armToward(l, 0, 1);
    const far = [connOf(l, e, stem), connOf(l, wst, stem)].find((c) => l.connectors[c].turn === t.farTurn)!;
    const oncoming = l.connectors[far].inArm === e ? connOf(l, wst, e) : connOf(l, e, wst);
    expect(t.yields[far * k + oncoming]).toBe(1);
    expect(t.yields[oncoming * k + far]).toBe(0);
  });
});

describe("main road wins", () => {
  // Every unequal at-grade junction the game can build is signalised today
  // (an avenue arm signalises a T; highways need interchanges), so these run
  // the avenue nodes through the forcePriority hook.
  function avenueNode(cross: boolean) {
    const s = newCity(6);
    const ey = flat(s);
    expect(line(s, ROAD.AVENUE, 4, ey, 40, ey)).toBe(true);
    expect(line(s, ROAD.STREET, 22, cross ? ey - 12 : ey, 22, ey + 12)).toBe(true);
    const w = s.world;
    const l = layoutAt(w, 22, ey);
    expect(l.arms).toHaveLength(cross ? 4 : 3);
    expect(hasSignal(w, l.nodeId)).toBe(true); // the game signalises this node
    const t = newTraffic(w.size);
    t.forcePriority = new Set([l.nodeId]);
    tickTraffic(s, t, 0);
    expect(t.sigNodes.some((sn) => sn.id === l.nodeId)).toBe(false);
    expect(t.prioNodes.has(l.nodeId)).toBe(true);
    return { s, ey, l, t, w };
  }
  function streetYieldsToAvenue(l: JunctionLayout, tab: PriorityTable): number {
    let checked = 0;
    for (let i = 0; i < tab.k; i++) for (let j = 0; j < tab.k; j++) {
      if (!tab.conflict[i * tab.k + j]) continue;
      const iMinor = l.arms[tab.inArm[i]].type === ROAD.STREET, jMinor = l.arms[tab.inArm[j]].type === ROAD.STREET;
      if (iMinor && !jMinor) { expect(tab.yields[i * tab.k + j]).toBe(1); checked++; }
      if (!iMinor && jMinor) expect(tab.yields[i * tab.k + j]).toBe(0);
    }
    return checked;
  }

  it("T: every street movement yields to the avenue, never the reverse; the stem car waits", () => {
    const { s, ey, l, t, w } = avenueNode(false);
    const tab = t.prioNodes.get(l.nodeId)!.table;
    expect(streetYieldsToAvenue(l, tab)).toBeGreaterThan(0);
    // Right-hand lanes: avenue eastbound straight vs the stem turning left across it.
    const av = car(s, 1, idx(w, 6, ey), idx(w, 36, ey), 3.5, 3.5);
    const st = car(s, 2, idx(w, 22, ey + 10), idx(w, 6, ey), 2, 1.2);
    expect(tab.conflict[routeMovesOf(av.pts)!.conn[0] * tab.k + routeMovesOf(st.pts)!.conn[0]]).toBe(1);
    t.vehicles.push(av, st);
    let minStem = Infinity;
    const enter = new Map<number, number>();
    let hard = 0;
    for (let i = 0; i < 600 && t.vehicles.length; i++) {
      tickTraffic(s, t, 0.05);
      const stem = t.vehicles.find((v) => v.id === 2);
      for (const o of occupancy(t)) if (!enter.has(o.id)) enter.set(o.id, t.time);
      if (stem && !enter.has(2)) minStem = Math.min(minStem, stem.v);
      hard += violations(t).hard;
    }
    expect(t.completed).toBe(2);
    expect(hard).toBe(0);
    expect(enter.get(1)!).toBeLessThan(enter.get(2)!);
    expect(minStem).toBeLessThan(0.2); // it stopped and gave way
    expect(t.prioOverruns).toBe(0);
  });

  it("avenue + street cross: the street gives way to avenue traffic", () => {
    const { s, ey, l, t, w } = avenueNode(true);
    const tab = t.prioNodes.get(l.nodeId)!.table;
    expect(streetYieldsToAvenue(l, tab)).toBeGreaterThan(0);
    const av = car(s, 1, idx(w, 36, ey), idx(w, 6, ey), 3.5, 3.5);
    const st = car(s, 2, idx(w, 22, ey + 10), idx(w, 22, ey - 10), 2, 1.2);
    expect(tab.conflict[routeMovesOf(av.pts)!.conn[0] * tab.k + routeMovesOf(st.pts)!.conn[0]]).toBe(1);
    t.vehicles.push(av, st);
    const r = drive(s, t, 30);
    expect(t.completed).toBe(2);
    expect(r.hard).toBe(0);
    expect(r.enter.get(1)!).toBeLessThan(r.enter.get(2)!);
  });
});

describe("equal 4-way (forced unsignalised)", () => {
  function cross() {
    const s = newCity(9);
    const ey = flat(s);
    expect(line(s, ROAD.STREET, 4, ey, 40, ey)).toBe(true);
    expect(line(s, ROAD.STREET, 22, ey - 12, 22, ey + 12)).toBe(true);
    const l = layoutAt(s.world, 22, ey);
    expect(l.arms).toHaveLength(4);
    const t = newTraffic(s.world.size);
    t.forcePriority = new Set([l.nodeId]);
    tickTraffic(s, t, 0);
    return { s, ey, l, t, w: s.world };
  }

  it("far turn waits for the oncoming straight", () => {
    const { s, ey, l, t, w } = cross();
    const tab = t.prioNodes.get(l.nodeId)!.table;
    // Pick the through pair W→E and its oncoming far turn from E.
    const straight = car(s, 1, idx(w, 6, ey), idx(w, 38, ey), 2.5, 2);
    // From the east arm, the far turn goes north or south depending on hand.
    const e = armToward(l, 1, 0);
    const farConn = l.connectors.findIndex((c) => c.inArm === e && c.turn === tab.farTurn);
    expect(farConn).toBeGreaterThanOrEqual(0);
    const out = l.arms[l.connectors[farConn].outArm];
    const turner = car(s, 2, idx(w, 38, ey), idx(w, 22, ey + Math.round(out.dz) * 10), 2.5, 2);
    expect(routeMovesOf(turner.pts)!.conn[0]).toBe(farConn);
    const sc = routeMovesOf(straight.pts)!.conn[0];
    expect(tab.conflict[farConn * tab.k + sc]).toBe(1);
    expect(tab.yields[farConn * tab.k + sc]).toBe(1);
    t.vehicles.push(straight, turner);
    const r = drive(s, t, 30);
    expect(t.completed).toBe(2);
    expect(r.hard).toBe(0);
    expect(r.enter.get(1)!).toBeLessThan(r.enter.get(2)!);
  });

  it("an all-way tie resolves by arm order and age, without deadlock", () => {
    const { s, ey, l, t, w } = cross();
    // Four straight cars, same distance and speed: they claim in the same substep.
    t.vehicles.push(
      car(s, 1, idx(w, 6, ey), idx(w, 38, ey), 2, 2),
      car(s, 2, idx(w, 38, ey), idx(w, 6, ey), 2, 2),
      car(s, 3, idx(w, 22, ey - 10), idx(w, 22, ey + 10), 2, 2),
      car(s, 4, idx(w, 22, ey + 10), idx(w, 22, ey - 10), 2, 2),
    );
    const r = drive(s, t, 60);
    expect(t.completed).toBe(4);
    expect(r.hard).toBe(0);
    expect(t.prioTimeouts).toBe(0);
    // Straights from all four arms yield in a cycle (each to its priority
    // side); the exact tie goes to the lowest inbound arm index.
    const north = armToward(l, 0, -1);
    const firstCar = [...r.enter].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0];
    const startArm: Record<number, number> = { 1: armToward(l, -1, 0), 2: armToward(l, 1, 0), 3: north, 4: armToward(l, 0, 1) };
    expect(startArm[firstCar]).toBe(Math.min(...Object.values(startArm)));
  });

  it("resolveClaims: a 4-cycle of mutual yields still grants exactly one ordering head", () => {
    const { l, t } = cross();
    const tab = t.prioNodes.get(l.nodeId)!.table;
    const cs = newClaimSet(tab, l);
    const straights = [0, 1, 2, 3].map((a) => l.connectors.findIndex((c) => c.inArm === a && c.turn === "straight"));
    straights.forEach((c, a) => upsertClaim(cs, 10 + a, c, 5, 1));
    resolveClaims(cs);
    const granted = [...Array(cs.n).keys()].filter((s2) => cs.go[s2]);
    expect(granted.length).toBeGreaterThanOrEqual(1);
    for (const a of granted) for (const b of granted) if (a !== b) expect(tab.conflict[cs.conn[a] * tab.k + cs.conn[b]]).toBe(0);
    // Exact tie: arm 0's claim heads the order.
    expect(cs.go[0]).toBe(1);
    // Age beats arm order.
    const cs2 = newClaimSet(tab, l);
    straights.forEach((c, a) => upsertClaim(cs2, 10 + a, c, a === 3 ? 4 : 5, 1));
    resolveClaims(cs2);
    expect(cs2.go[3]).toBe(1);
  });
});

describe("one-way arm", () => {
  it("only legal movements exist and the one-way stem gives way to the priority side", () => {
    const s = newCity(4);
    const ey = flat(s);
    expect(line(s, ROAD.STREET, 4, ey, 40, ey)).toBe(true);
    // One-way stem drawn toward the junction: traffic may only enter from it.
    expect(line(s, ROAD.ONEWAY_STREET, 22, ey + 12, 22, ey)).toBe(true);
    const w = s.world;
    const l = layoutAt(w, 22, ey);
    expect(hasSignal(w, l.nodeId)).toBe(false);
    const stem = armToward(l, 0, 1);
    const tab = priorityTableOf(l);
    expect(l.connectors.some((c) => c.inArm === stem)).toBe(true);
    expect(l.connectors.some((c) => c.outArm === stem)).toBe(false);
    const t = newTraffic(w.size);
    tickTraffic(s, t, 0);
    // Right-hand lanes: the stem car turns left across the eastbound lane and
    // merges into the westbound through car's lane: a merge conflict.
    const through = car(s, 1, idx(w, 38, ey), idx(w, 6, ey), 2.5, 2);
    const st = car(s, 2, idx(w, 22, ey + 10), idx(w, 6, ey), 2, 1.5);
    const a = routeMovesOf(through.pts)!.conn[0], b = routeMovesOf(st.pts)!.conn[0];
    expect(l.connectors[b].inArm).toBe(stem);
    expect(tab.conflict[a * tab.k + b]).toBe(1);
    // The through car approaches from the stem's priority side.
    expect(tab.yields[b * tab.k + a]).toBe(1);
    t.vehicles.push(through, st);
    const r = drive(s, t, 30);
    expect(t.completed).toBe(2);
    expect(r.hard).toBe(0);
    expect(r.enter.get(1)!).toBeLessThan(r.enter.get(2)!);
  });
});

/** Street grid with six unsignalised T junctions; spawn demand 20 vehicles/s. */
function stressFixture(seed: number) {
  const s = newCity(11);
  const ey = flat(s);
  const ok = [
    line(s, ROAD.STREET, 2, ey, 40, ey),
    ...[10, 18, 26, 34].map((x) => line(s, ROAD.STREET, x, ey, x, ey + 8)),
    line(s, ROAD.STREET, 10, ey + 8, 18, ey + 8), line(s, ROAD.STREET, 18, ey + 8, 26, ey + 8), line(s, ROAD.STREET, 26, ey + 8, 34, ey + 8),
  ];
  expect(ok.every(Boolean)).toBe(true);
  const w = s.world;
  const t = newTraffic(w.size, seed);
  tickTraffic(s, t, 0);
  t.homes = []; t.jobs = [];
  for (let x = 4; x <= 40; x++) t.homes.push(idx(w, x, ey - 1));
  for (let x = 10; x <= 34; x++) t.jobs.push(idx(w, x, ey + 9));
  for (let y = ey + 2; y <= ey + 6; y++) for (const x of [11, 17, 19, 25, 27, 33]) t.jobs.push(idx(w, x, y));
  s.population = 3000; // population / 150 = 20 spawn attempts per second
  s.capacity.ind = 0;
  return { s, t, w };
}

describe("stress: 600 s at 20 spawns/s", () => {
  it("has six unsignalised T junctions", () => {
    const { t } = stressFixture(7);
    expect(t.prioNodes.size).toBe(6);
  });

  it("never deadlocks, keeps >= 70% of baseline throughput, and never overlaps conflicting movements", () => {
    const { s, t } = stressFixture(7);
    let hard = 0, soft = 0, worstStep = 0;
    const perMinute: number[] = [];
    let last = 0;
    const t0 = performance.now();
    for (let i = 0; i < 6000; i++) {
      const a = performance.now();
      tickTraffic(s, t, 0.1);
      worstStep = Math.max(worstStep, performance.now() - a);
      const v = violations(t);
      hard += v.hard; soft += v.timedOut;
      if (i % 600 === 599) { perMinute.push(t.completed - last); last = t.completed; }
    }
    const ms = performance.now() - t0;
    console.info(`PRIO completed=${t.completed} baseline=${BASELINE_COMPLETED_600S} ratio=${(t.completed / BASELINE_COMPLETED_600S).toFixed(3)} perMinute=${perMinute.join(",")} alive=${t.vehicles.length} timeouts=${t.prioTimeouts} overruns=${t.prioOverruns} hard=${hard} timedOutOverlap=${soft} ms=${ms.toFixed(0)} worstTick=${worstStep.toFixed(2)}`);
    expect(hard).toBe(0);
    expect(t.completed).toBeGreaterThanOrEqual(0.7 * BASELINE_COMPLETED_600S);
    for (const n of perMinute) expect(n).toBeGreaterThan(0); // flow in every minute: no gridlock
  }, 60000);

  it("is deterministic: same seed, same positions", () => {
    const run = () => {
      const { s, t } = stressFixture(3);
      for (let i = 0; i < 1200; i++) tickTraffic(s, t, 0.1);
      return { done: t.completed, ids: t.vehicles.map((v) => v.id), arc: t.vehicles.map((v) => v.arc), v: t.vehicles.map((v) => v.v) };
    };
    const a = run(), b = run();
    expect(a.done).toBeGreaterThan(0);
    expect(b).toEqual(a);
  }, 30000);
});

describe("signalised nodes are unchanged", () => {
  it("a signalised cross gets no claims and no right-of-way stops", () => {
    const s = newCity(13);
    const ey = flat(s);
    expect(line(s, ROAD.STREET, 4, ey, 24, ey)).toBe(true);
    expect(line(s, ROAD.STREET, 14, ey - 8, 14, ey + 8)).toBe(true);
    const w = s.world;
    const l = layoutAt(w, 14, ey);
    expect(hasSignal(w, l.nodeId)).toBe(true);
    const t = newTraffic(w.size);
    tickTraffic(s, t, 0);
    expect(t.prioNodes.has(l.nodeId)).toBe(false);
    expect(t.sigNodes.some((sn) => sn.id === l.nodeId)).toBe(true);
    t.vehicles.push(car(s, 1, idx(w, 4, ey), idx(w, 24, ey), 2, 2), car(s, 2, idx(w, 14, ey - 7), idx(w, 14, ey + 7), 2, 2));
    for (let i = 0; i < 400 && t.vehicles.length; i++) {
      tickTraffic(s, t, 0.05);
      for (const v of t.vehicles) expect(v.prioStop ?? Infinity).toBe(Infinity);
    }
    expect(t.completed).toBe(2);
  });

  it("never overlaps conflicting movements in a signal box", () => {
    const s = newCity(13);
    const ey = flat(s);
    expect(line(s, ROAD.STREET, 4, ey, 24, ey)).toBe(true);
    expect(line(s, ROAD.STREET, 14, ey - 8, 14, ey + 8)).toBe(true);
    const w = s.world, l = layoutAt(w, 14, ey), tab = priorityTableOf(l);
    const t = newTraffic(w.size); tickTraffic(s, t, 0);
    const signal = t.sigNodes.find((sn) => sn.id === l.nodeId)!;
    const phaseOf = (arm: number) => signal.arms.reduce((best, a, i) =>
      a.dx * l.arms[arm].dx + a.dz * l.arms[arm].dz > signal.arms[best].dx * l.arms[arm].dx + signal.arms[best].dz * l.arms[arm].dz ? i : best, 0);
    let a = -1, b = -1;
    // Pick two geometrically conflicting movements released in the same phase.
    for (let i = 0; i < tab.k && a < 0; i++) for (let j = i + 1; j < tab.k; j++) {
      const ai = phaseOf(l.connectors[i].inArm), aj = phaseOf(l.connectors[j].inArm);
      if (tab.conflict[i * tab.k + j] && signal.arms[ai].ns === signal.arms[aj].ns) { a = i; b = j; break; }
    }
    expect(a).toBeGreaterThanOrEqual(0);
    const end = (c: number, inbound: boolean) => {
      const arm = l.arms[inbound ? l.connectors[c].inArm : l.connectors[c].outArm];
      return idx(w, Math.round(l.centre.x + arm.dx * 7 - 0.5), Math.round(l.centre.z + arm.dz * 7 - 0.5));
    };
    t.vehicles.push(car(s, 1, end(a, true), end(a, false), 2, 2), car(s, 2, end(b, true), end(b, false), 2, 2));
    for (let i = 0; i < 600 && t.vehicles.length > 1; i++) {
      tickTraffic(s, t, 0.05);
      if (t.vehicles.length < 2) break;
      const x = pointAtRouteArc(t.vehicles[0].pts, t.vehicles[0].arcs!, t.vehicles[0].arc!).x - pointAtRouteArc(t.vehicles[1].pts, t.vehicles[1].arcs!, t.vehicles[1].arc!).x;
      const z = pointAtRouteArc(t.vehicles[0].pts, t.vehicles[0].arcs!, t.vehicles[0].arc!).z - pointAtRouteArc(t.vehicles[1].pts, t.vehicles[1].arcs!, t.vehicles[1].arc!).z;
      expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(halfLength(0) * 2);
    }
  });
});

describe("route movements", () => {
  it("splice each junction once, monotonic along travel", () => {
    const s = newCity(11);
    const ey = flat(s);
    expect(line(s, ROAD.STREET, 4, ey, 30, ey)).toBe(true);
    expect(line(s, ROAD.STREET, 16, ey, 16, ey + 12)).toBe(true);
    const w = s.world;
    for (const [a, b] of [[idx(w, 6, ey), idx(w, 28, ey)], [idx(w, 6, ey), idx(w, 16, ey + 10)], [idx(w, 16, ey + 10), idx(w, 6, ey)]]) {
      const pts = routePath(w, findPath(w, new Uint16Array(w.size * w.size), a, b)!);
      const m = routeMovesOf(pts)!;
      expect(m.n).toBe(1);
      expect(m.i1[0]).toBeGreaterThan(m.i0[0]);
      // Never doubles back: no step turns by more than 100 degrees from the last.
      let backs = 0;
      for (let i = 2; i + 3 < pts.length; i += 2) {
        const ax = pts[i] - pts[i - 2], az = pts[i + 1] - pts[i - 1];
        const bx = pts[i + 2] - pts[i], bz = pts[i + 3] - pts[i + 1];
        if (ax * bx + az * bz < -0.17 * Math.hypot(ax, az) * Math.hypot(bx, bz)) backs++;
      }
      expect(backs).toBe(0);
    }
  });
});
