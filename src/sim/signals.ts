/**
 * Signal phase grouping, turn classification and per-node cycle offsets.
 *
 * Pure TypeScript: no World access, no randomness, no clock reads. Every
 * function returns the same output for the same input, so signals derive
 * identically after a save round-trip and never need a save format change.
 *
 * Grouping pairs arms that oppose each other (within 35 degrees) into one
 * phase group and assigns the rest to the nearest pair's group, so skewed
 * and diagonal junctions get valid two-phase signals where the old
 * `|dx| vs |dz|` axis test put crossing flows on the same green.
 */

const TAU = Math.PI * 2;

/** Opposition tolerance: arms within this of 180 degrees apart pair up. */
export const SIGNAL_OPPOSITION_TOL = (35 * Math.PI) / 180;
/** |relative heading| at or below this is a straight-through movement. */
export const TURN_STRAIGHT_MAX = (30 * Math.PI) / 180;
/** |relative heading| at or above this is a U-turn. */
export const TURN_UTURN_MIN = (150 * Math.PI) / 180;
/** Two-phase cycle: 8 s per phase (the renderer shows the last 1 s as amber). */
export const SIGNAL_HALF = 8;
export const SIGNAL_CYCLE = 2 * SIGNAL_HALF;

/** Movement from an entry arm to an exit arm through a node. */
export type TurnKind = "straight" | "right" | "left" | "uturn";

// Portions adapted from Fable Cities (MIT, (c) 2026 raw,
// github.com/rawprogress/fable-cities @ aea8b10): curves.js#wrapPi.
function wrapPi(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

// Portions adapted from Fable Cities (MIT, (c) 2026 raw,
// github.com/rawprogress/fable-cities @ aea8b10): curves.js#headingOf.
function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, -dz); // 0 = north (-Z), clockwise positive
}

// Portions adapted from Fable Cities (MIT, (c) 2026 raw,
// github.com/rawprogress/fable-cities @ aea8b10): LaneNetwork.js#_buildJunctions
// (FNV-1a over the node id, used there to desync signal cycles).
function fnv1a32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Classify the movement from travel direction (into the node) to an exit
 * arm (out of the node). Thresholds are 30 and 150 degrees.
 */
// Portions adapted from Fable Cities (MIT, (c) 2026 raw,
// github.com/rawprogress/fable-cities @ aea8b10): Junctions.js#computeJunction
// (turn-arrow flags: |rel| <= 30 degrees straight, else left/right by sign)
// and LaneNetwork.js (the U-turn class).
export function classifyTurn(travelDx: number, travelDz: number, outDx: number, outDz: number): TurnKind {
  const rel = wrapPi(headingOf(outDx, outDz) - headingOf(travelDx, travelDz));
  const a = Math.abs(rel);
  if (a <= TURN_STRAIGHT_MAX) return "straight";
  if (a >= TURN_UTURN_MIN) return "uturn";
  return rel > 0 ? "right" : "left";
}

/**
 * Split arms into two phase groups (`true` = group A, green on phase 0).
 *
 * Arms within 35 degrees of opposition pair into one group; the pairing is
 * greedy best-first with index tie-breaks, so it is deterministic. Each
 * remaining arm joins the group whose pair axis it is angularly nearest to.
 * Group A is the pair closest to the N-S axis, so grid layouts keep their
 * historical labels; on skewed junctions the choice of label is arbitrary
 * but deterministic. With no pair inside the tolerance (a Y junction), the
 * most-opposite pair seeds group A and the rest splits by angle.
 */
// Phase pairing adapted from Fable Cities (MIT, (c) 2026 raw,
// github.com/rawprogress/fable-cities @ aea8b10): LaneNetwork.js#_buildJunctions
// (opposite approaches share a green). Fable cycles one phase per pair; here
// pairs are folded into Mayor's fixed two-phase cycle.
export function signalGroups(arms: readonly { dx: number; dz: number }[]): boolean[] {
  const n = arms.length;
  if (n === 0) return [];
  if (n === 1) return [true];
  const ang = arms.map((a) => Math.atan2(a.dz, a.dx));
  const between = (i: number, j: number): number => Math.abs(wrapPi(ang[j] - ang[i])); // 0..pi
  const oppErr = (i: number, j: number): number => Math.PI - between(i, j); // 0 = opposite
  // Nanoradian quantisation: symmetric junctions resolve by arm index, not libm noise.
  const q9 = (x: number): number => Math.round(x * 1e9) / 1e9;
  const cands: { i: number; j: number; e: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const e = oppErr(i, j);
      if (e <= SIGNAL_OPPOSITION_TOL + 1e-9) cands.push({ i, j, e }); // 1e-9 absorbs atan2 dust
    }
  }
  cands.sort((a, b) => q9(a.e) - q9(b.e) || a.i - b.i || a.j - b.j);
  const mate = new Array<number>(n).fill(-1);
  const pairs: [number, number][] = [];
  for (const c of cands) {
    if (mate[c.i] >= 0 || mate[c.j] >= 0) continue;
    mate[c.i] = c.j;
    mate[c.j] = c.i;
    pairs.push([c.i, c.j]);
  }
  if (pairs.length === 0) {
    let bi = 0, bj = 1, be = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const e = oppErr(i, j);
        if (e < be - 1e-12 || (Math.abs(e - be) <= 1e-12 && (i < bi || (i === bi && j < bj)))) {
          bi = i;
          bj = j;
          be = e;
        }
      }
    }
    mate[bi] = bj;
    mate[bj] = bi;
    pairs.push([bi, bj]);
  }
  // An axis is a direction modulo 180 degrees, in [0, pi).
  const axisOf = (k: number): number => {
    const a = ang[k] % Math.PI;
    return a < 0 ? a + Math.PI : a;
  };
  const axisDist = (armAngle: number, axisAngle: number): number => {
    const w = Math.abs(wrapPi(armAngle - axisAngle));
    return Math.min(w, Math.PI - w); // 0..pi/2
  };
  const nsDist = (p: [number, number]): number =>
    Math.abs(axisOf(p[0]) - Math.PI / 2) + Math.abs(axisOf(p[1]) - Math.PI / 2);
  pairs.sort((p, q) => q9(nsDist(p)) - q9(nsDist(q)) || p[0] - q[0] || p[1] - q[1]);
  const group = new Array<boolean>(n).fill(false);
  const assigned = new Array<boolean>(n).fill(false);
  const seedA = pairs[0];
  group[seedA[0]] = true;
  group[seedA[1]] = true;
  assigned[seedA[0]] = true;
  assigned[seedA[1]] = true;
  const axisA = axisOf(seedA[0]);
  let axisB: number;
  if (pairs.length >= 2) {
    const seedB = pairs[1];
    assigned[seedB[0]] = true;
    assigned[seedB[1]] = true;
    axisB = axisOf(seedB[0]);
    for (let k = 2; k < pairs.length; k++) {
      const p = pairs[k];
      const inA = axisDist(axisOf(p[0]), axisA) <= axisDist(axisOf(p[0]), axisB) + 1e-9;
      group[p[0]] = inA;
      group[p[1]] = inA;
      assigned[p[0]] = true;
      assigned[p[1]] = true;
    }
  } else {
    // One pair: the leftover farthest from its axis seeds group B (the T stem).
    let seed = -1, seedD = -1;
    for (let k = 0; k < n; k++) {
      if (assigned[k]) continue;
      const d = axisDist(ang[k], axisA);
      if (d > seedD + 1e-9) {
        seed = k;
        seedD = d;
      }
    }
    axisB = seed >= 0 ? axisOf(seed) : axisA;
    if (seed >= 0) {
      group[seed] = false;
      assigned[seed] = true;
    }
  }
  for (let k = 0; k < n; k++) {
    if (assigned[k]) continue;
    group[k] = axisDist(ang[k], axisA) <= axisDist(ang[k], axisB) + 1e-9; // tie -> A
  }
  return group;
}

/**
 * Per-node cycle offset in seconds, in [0, 16): a deterministic hash of the
 * node id, so neighbouring lights do not blink in unison.
 */
// Portions adapted from Fable Cities (MIT, (c) 2026 raw,
// github.com/rawprogress/fable-cities @ aea8b10): LaneNetwork.js#_buildJunctions
// (deterministic desync from the FNV-1a hash of the node id).
export function signalOffset(nodeId: number): number {
  return (fnv1a32(String(nodeId)) % 160) / 10;
}

/** Global two-phase cycle, deterministic in `tick` (game seconds): 8 s per phase. */
export function signalPhase(tick: number): 0 | 1 {
  return (Math.floor(tick / SIGNAL_HALF) % 2) as 0 | 1;
}

/** Phase at one node: the global cycle shifted by that node's offset. */
export function signalPhaseAt(nodeId: number, tick: number): 0 | 1 {
  return signalPhase(tick + signalOffset(nodeId));
}
