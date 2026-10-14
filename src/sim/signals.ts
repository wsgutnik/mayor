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

/** Adaptive timings in game seconds (TM:PE-inspired, kept deliberately short). */
export const SIGNAL_MIN_GREEN = 3;
export const SIGNAL_MAX_GREEN = 8;
export const SIGNAL_YELLOW = 2;
export const SIGNAL_ALL_RED = 1;
export type SignalStage = "green" | "yellow" | "allRed";

/**
 * Serializable-free controller state.  It is derived at graph rebuild and is
 * intentionally not saved: old saves restart safely on their deterministic
 * offset phase.  `wait` is accumulated only while a phase has queued traffic.
 */
export interface AdaptiveSignalState {
  phase: number;
  stage: SignalStage;
  elapsed: number;
  wait: number[];
}

export function newAdaptiveSignal(phases = 2, initial = 0): AdaptiveSignalState {
  return { phase: Math.max(0, Math.min(phases - 1, initial | 0)), stage: "green", elapsed: 0, wait: new Array(phases).fill(0) };
}

/** Select a next phase by queue length plus accumulated wait; ties are index-stable. */
export function chooseAdaptivePhase(queues: readonly number[], wait: readonly number[], current: number): number {
  let best = (current + 1) % Math.max(1, queues.length), score = -Infinity;
  for (let i = 0; i < queues.length; i++) {
    if (i === current && queues.length > 1) continue;
    const s = Math.max(0, queues[i] || 0) + Math.max(0, wait[i] || 0) * 0.3;
    if (s > score + 1e-9 || (Math.abs(s - score) <= 1e-9 && i < best)) { best = i; score = s; }
  }
  return best;
}

// TM:PE MIT concept: bounded green plus queue/wait weighted phase choice.
// This is a clean TypeScript implementation, not a source port.
export function stepAdaptiveSignal(state: AdaptiveSignalState, dt: number, queues: readonly number[]): AdaptiveSignalState {
  const n = Math.max(1, queues.length);
  const out: AdaptiveSignalState = { phase: Math.min(n - 1, state.phase), stage: state.stage, elapsed: state.elapsed, wait: Array.from({ length: n }, (_, i) => state.wait[i] || 0) };
  let left = Math.max(0, dt);
  while (left > 1e-9) {
    if (out.stage === "green" && out.elapsed >= SIGNAL_MIN_GREEN) {
      const next = chooseAdaptivePhase(queues, out.wait, out.phase);
      const currentScore = Math.max(0, queues[out.phase] || 0) + Math.max(0, out.wait[out.phase] || 0) * 0.3;
      const nextScore = Math.max(0, queues[next] || 0) + Math.max(0, out.wait[next] || 0) * 0.3;
      if (next !== out.phase && nextScore > currentScore + 1e-9) { out.stage = "yellow"; out.elapsed = 0; continue; }
    }
    const limit = out.stage === "green" ? SIGNAL_MAX_GREEN : out.stage === "yellow" ? SIGNAL_YELLOW : SIGNAL_ALL_RED;
    const use = Math.min(left, Math.max(0, limit - out.elapsed));
    for (let i = 0; i < n; i++) {
      if (i === out.phase && out.stage === "green") out.wait[i] = 0;
      else if ((queues[i] || 0) > 0) out.wait[i] += use;
    }
    out.elapsed += use; left -= use;
    if (out.stage === "green" && out.elapsed >= SIGNAL_MIN_GREEN && out.elapsed < SIGNAL_MAX_GREEN) {
      const next = chooseAdaptivePhase(queues, out.wait, out.phase);
      const currentScore = Math.max(0, queues[out.phase] || 0) + Math.max(0, out.wait[out.phase] || 0) * 0.3;
      const nextScore = Math.max(0, queues[next] || 0) + Math.max(0, out.wait[next] || 0) * 0.3;
      if (next !== out.phase && nextScore > currentScore + 1e-9) { out.stage = "yellow"; out.elapsed = 0; continue; }
    }
    if (out.elapsed < limit - 1e-9) break;
    out.elapsed = 0;
    if (out.stage === "green") {
      // Minimum green protects a just-selected approach; max green guarantees progress.
      out.stage = "yellow";
    } else if (out.stage === "yellow") out.stage = "allRed";
    else { out.phase = chooseAdaptivePhase(queues, out.wait, out.phase); out.stage = "green"; }
    // exact-boundary calls must make progress through zero-length remainder.
    if (use === 0 && left === 0) break;
  }
  return out;
}

/** Allocation-free variant used by the live traffic loop. */
export function stepAdaptiveSignalInPlace(state: AdaptiveSignalState, dt: number, queues: readonly number[]): void {
  const n = Math.max(1, queues.length);
  while (state.wait.length < n) state.wait.push(0);
  if (state.phase >= n) state.phase = 0;
  let left = Math.max(0, dt);
  while (left > 1e-9) {
    if (state.stage === "green" && state.elapsed >= SIGNAL_MIN_GREEN) {
      const next = chooseAdaptivePhase(queues, state.wait, state.phase);
      const cur = Math.max(0, queues[state.phase] || 0) + Math.max(0, state.wait[state.phase] || 0) * 0.3;
      const score = Math.max(0, queues[next] || 0) + Math.max(0, state.wait[next] || 0) * 0.3;
      if (next !== state.phase && score > cur + 1e-9) { state.stage = "yellow"; state.elapsed = 0; continue; }
    }
    const limit = state.stage === "green" ? SIGNAL_MAX_GREEN : state.stage === "yellow" ? SIGNAL_YELLOW : SIGNAL_ALL_RED;
    const use = Math.min(left, Math.max(0, limit - state.elapsed));
    for (let i = 0; i < n; i++) {
      if (i === state.phase && state.stage === "green") state.wait[i] = 0;
      else if ((queues[i] || 0) > 0) state.wait[i] += use;
    }
    state.elapsed += use; left -= use;
    if (state.elapsed < limit - 1e-9) break;
    state.elapsed = 0;
    if (state.stage === "green") state.stage = "yellow";
    else if (state.stage === "yellow") state.stage = "allRed";
    else { state.phase = chooseAdaptivePhase(queues, state.wait, state.phase); state.stage = "green"; }
    if (use === 0 && left === 0) break;
  }
}
