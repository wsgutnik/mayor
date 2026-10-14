import type { Pt } from "../sim/world";

/**
 * Ear-clipping triangulation for junction polygons (docs/process/07-junction-builder.md P0.6:
 * earcut/constrained over the ring; centre fans are banned).
 *
 * Pure 2-D helpers over `{x, z}` points. `triangulateRing` clips one simple ring;
 * `triangulateBand` stitches the band between two nested rings by resampling
 * both at a common arclength step and advancing two fronts around them
 * (greedy strip; slit clip as fallback). Zero-area pinch degenerates are
 * dropped from the output. Callers sample heights per emitted vertex.
 */

const EPS = 1e-12;

type Tri = [Pt, Pt, Pt];

/** Deduplicated corners plus triangle indices into them. */
export type IndexedTris = { pts: Pt[]; idx: number[] };
const indexedCache = new WeakMap<Tri[], IndexedTris>();

/**
 * Share corner objects across triangles (one vertex per unique point).
 * Cached by output identity: triangulation caches return the same array on
 * every warm build, so the dedup map runs once per distinct output.
 */
export function asIndexed(tris: Tri[]): IndexedTris {
  let e = indexedCache.get(tris);
  if (e === undefined) {
    const pts: Pt[] = [];
    const idx: number[] = [];
    const seen = new Map<Pt, number>();
    for (const t of tris) {
      for (const p of t) {
        let i = seen.get(p);
        if (i === undefined) {
          i = pts.length;
          pts.push(p);
          seen.set(p, i);
        }
        idx.push(i);
      }
    }
    e = { pts, idx };
    indexedCache.set(tris, e);
  }
  return e;
}

function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], r = ring[(i + 1) % ring.length];
    a += p.x * r.z - r.x * p.z;
  }
  return a / 2;
}

function triArea2(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
}

function dist2(a: Pt, b: Pt): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

/**
 * Longest-side-squared over twice the area: pure arithmetic, no sqrt/acos.
 * Orders triangles by thinness almost exactly like min-angle (min-angle ≤5°
 * implies thinness ≥10); the march compares with it and refines near-ties
 * by acos, and the flip pass runs only when a kept tri exceeds 9.
 */
function thinness(a: Pt, b: Pt, c: Pt): number {
  const a2 = Math.abs(triArea2(a, b, c));
  if (a2 < 1e-12) return Infinity;
  return Math.max(dist2(a, b), dist2(b, c), dist2(c, a)) / a2;
}

/**
 * Content-validated triangulation cache. Rebuilds on an unchanged world reuse
 * the same ring arrays (layouts are cached by graph revision), and
 * interactive edits only change nearby junctions, so strips and rings repeat
 * across builds. Entries are keyed by array identity (auto-GC, no size cap
 * needed) and validated O(1) by length plus three sample coordinates, so
 * in-place mutation recomputes instead of reading stale output. Invariant
 * (shared with the layout revision cache): rings mutate by replacement, not
 * by same-length interior edits; a mutation preserving length and the three
 * samples would read stale, and no builder does that.
 * Outputs are shared: treat returned triangle arrays as immutable.
 */
export type RingSample = { n: number; ax: number; az: number; mx: number; mz: number; lx: number; lz: number };
export function sampleRing(r: Pt[]): RingSample {
  const mid = r[(r.length / 2) | 0] ?? r[0];
  const last = r[r.length - 1];
  return { n: r.length, ax: r[0].x, az: r[0].z, mx: mid.x, mz: mid.z, lx: last.x, lz: last.z };
}
export function sameSample(a: RingSample, b: RingSample): boolean {
  return a.n === b.n && a.ax === b.ax && a.az === b.az && a.mx === b.mx &&
    a.mz === b.mz && a.lx === b.lx && a.lz === b.lz;
}
type StripEntry = {
  outer: Pt[]; si: RingSample; so: RingSample; step: number; out: Tri[] | null;
};
const stripCache = new WeakMap<Pt[], StripEntry>();
type RingEntry = { s: RingSample; out: Tri[] };
const ringCache = new WeakMap<Pt[], RingEntry>();

function worstAngle(a: Pt, b: Pt, c: Pt): number {
  if (Math.abs(triArea2(a, b, c)) < 1e-12) return 0;
  const la = Math.hypot(b.x - c.x, b.z - c.z);
  const lb = Math.hypot(a.x - c.x, a.z - c.z);
  const lc = Math.hypot(a.x - b.x, a.z - b.z);
  if (la < 1e-12 || lb < 1e-12 || lc < 1e-12) return 0;
  const ang = (opp: number, s1: number, s2: number): number => {
    const v = (s1 * s1 + s2 * s2 - opp * opp) / (2 * s1 * s2);
    return (Math.acos(Math.max(-1, Math.min(1, v))) * 180) / Math.PI;
  };
  return Math.min(ang(la, lb, lc), ang(lb, la, lc), ang(lc, la, lb));
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function onSeg(a: Pt, b: Pt, c: Pt, eps: number): boolean {
  return Math.min(a.x, c.x) - eps <= b.x && b.x <= Math.max(a.x, c.x) + eps &&
    Math.min(a.z, c.z) - eps <= b.z && b.z <= Math.max(a.z, c.z) + eps;
}

/** True when segments p1p2 and p3p4 intersect or touch (tolerance eps). */
function segsTouch(p1: Pt, p2: Pt, p3: Pt, p4: Pt, eps: number): boolean {
  const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
  if (Math.abs(d1) <= eps && onSeg(p3, p1, p4, eps)) return true;
  if (Math.abs(d2) <= eps && onSeg(p3, p2, p4, eps)) return true;
  if (Math.abs(d3) <= eps && onSeg(p1, p3, p2, eps)) return true;
  if (Math.abs(d4) <= eps && onSeg(p1, p4, p2, eps)) return true;
  return false;
}

function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > p.z) !== (b.z > p.z) &&
      p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Inside or ON the boundary (inclusive, like mapbox earcut): an ear whose
 * diagonal carries another polygon vertex would leave a weakly-simple
 * remainder and mis-cover, so any contact blocks the ear. Slit-duplicate
 * vertices (same coordinates as a triangle corner) are excluded by the caller.
 */
function pointInTri(p: Pt, a: Pt, b: Pt, c: Pt, eps: number): boolean {
  const d1 = orient(a, b, p), d2 = orient(b, c, p), d3 = orient(c, a, p);
  const pos = d1 >= -eps && d2 >= -eps && d3 >= -eps;
  const neg = d1 <= eps && d2 <= eps && d3 <= eps;
  return pos || neg;
}

function samePoint(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.z === b.z;
}

/**
 * Clip one simple ring (open vertex list, no duplicated closure point) into
 * triangles. Returns an empty list for fewer than 3 distinct vertices.
 */
function ringCompute(ring: Pt[]): Tri[] {
  const pts = ring.filter((p, k) => k === 0 || !samePoint(p, ring[k - 1]));
  if (pts.length > 1 && samePoint(pts[0], pts[pts.length - 1])) pts.pop();
  if (pts.length < 3) return [];
  const ccw = signedArea(pts) > 0;
  // Work on a CCW copy; map indices back at the end.
  const order = pts.map((_, i) => i);
  if (!ccw) order.reverse();
  const n = order.length;
  const P = (k: number): Pt => pts[order[k]];
  // Live doubly-linked list over order slots + cached ear flags. Clipping a
  // vertex only reshapes its two neighbours' ears, so only those two need
  // retesting (blocker sets only shrink, hence flags never go stale-valid).
  const nx = new Int32Array(n), pv = new Int32Array(n);
  for (let k = 0; k < n; k++) { nx[k] = (k + 1) % n; pv[k] = (k - 1 + n) % n; }
  const alive = new Uint8Array(n).fill(1);
  let left = n;
  const isEar = (k: number): boolean => {
    const a = P(pv[k]), b = P(k), c = P(nx[k]);
    if (triArea2(a, b, c) <= EPS) return false;
    for (let s2 = 0; s2 < n; s2++) {
      if (!alive[s2]) continue;
      if (s2 === pv[k] || s2 === k || s2 === nx[k]) continue;
      // Slit duplicates share corner coordinates exactly; they are the ear's
      // own corners, not blockers.
      const q = P(s2);
      if (samePoint(q, a) || samePoint(q, b) || samePoint(q, c)) continue;
      if (pointInTri(q, a, b, c, 1e-9)) return false;
    }
    return true;
  };
  const minAngle2 = (a: Pt, b: Pt, c: Pt): number => {
    // Squared sine of the minimum angle (monotone on (0, 60°], no trig).
    const ab = dist2(a, b), bc = dist2(b, c), ca = dist2(c, a);
    const m = Math.min(ab, bc, ca), m2 = Math.max(ab, bc, ca);
    return m2 > 0 ? m / m2 : 0;
  };
  const ear = new Uint8Array(n);
  for (let k = 0; k < n; k++) ear[k] = isEar(k) ? 1 : 0;
  const unlink = (k: number): void => {
    alive[k] = 0; ear[k] = 0;
    nx[pv[k]] = nx[k]; pv[nx[k]] = pv[k];
    left--;
  };
  const retest = (k: number): void => { ear[k] = isEar(k) ? 1 : 0; };
  const out: Tri[] = [];
  let guard = n * n + 1;
  let sinceClip = 0;
  let i = 0;
  while (left > 3 && guard-- > 0) {
    // Best-of-8 over live ears: clip the widest minimum angle, so dense arc
    // vertices triangulate locally instead of fanning across the ring.
    let cand = i, best = -1, bestQ = -1;
    for (let k = 0; k < 8; k++) {
      if (ear[cand]) {
        const q = minAngle2(P(pv[cand]), P(cand), P(nx[cand]));
        if (q > bestQ) { bestQ = q; best = cand; }
      }
      cand = nx[cand];
    }
    if (best < 0) {
      // Nothing flagged in the window: look anywhere before concluding.
      for (let k = 0, c = i; k < left; k++, c = nx[c]) {
        if (ear[c]) { best = c; break; }
      }
    }
    if (best >= 0) {
      const a = P(pv[best]), b = P(best), c = P(nx[best]);
      if (Math.abs(triArea2(a, b, c)) > 1e-9) out.push([a, b, c]);
      i = nx[best];
      const p = pv[best], q = nx[best];
      unlink(best);
      retest(p); retest(q);
      sinceClip = 0;
    } else {
      i = nx[i];
      sinceClip++;
    }
    // Full pass without progress: flags may be stale-invalid (a clip
    // unblocked a distant ear), so refresh them all before concluding that
    // only a degenerate spike can explain the stall.
    if (sinceClip >= left) {
      sinceClip = 0;
      let anyEar = false;
      for (let k = 0; k < n; k++) {
        if (!alive[k]) continue;
        retest(k);
        anyEar = anyEar || ear[k] === 1;
      }
      if (anyEar) continue;
      let spike = -1, spikeArea = Infinity;
      for (let k = 0; k < n; k++) {
        if (!alive[k]) continue;
        const ar = Math.abs(triArea2(P(pv[k]), P(k), P(nx[k])));
        if (ar < spikeArea) { spikeArea = ar; spike = k; }
      }
      if (spikeArea <= 1e-9 && spike >= 0) {
        i = nx[spike];
        const p = pv[spike], q = nx[spike];
        unlink(spike);
        retest(p); retest(q);
      } else {
        break;
      }
    }
  }
  if (left === 3) {
    const live: Pt[] = [];
    for (let k = 0; k < n && live.length < 3; k++) {
      if (alive[k]) live.push(P(k));
    }
    if (live.length === 3 && Math.abs(triArea2(live[0], live[1], live[2])) > 1e-9) {
      out.push([live[0], live[1], live[2]]);
    }
  }
  return out;
}

export function triangulateRing(ring: Pt[]): Tri[] {
  const e = ringCache.get(ring);
  if (e !== undefined && sameSample(sampleRing(ring), e.s)) return e.out;
  const out = ringCompute(ring);
  ringCache.set(ring, { s: sampleRing(ring), out });
  return out;
}

/**
 * Resample a ring (open vertex list) at arclength steps of at most `h`,
 * keeping every original vertex and dropping near-duplicates below h/4 (so
 * quantized neighbours cannot seed needle quads downstream).
 */

function resample(ring: Pt[], h: number): Pt[] {
  const out: Pt[] = [];
  const push = (p: Pt): void => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) >= h / 4) out.push(p);
  };
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    push(a);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    // Round (not ceil): segments near h stay whole instead of pointlessly
    // doubling the march length; spans up to 1.5h still quad honestly.
    const n = Math.max(1, Math.round(len / h));
    for (let s2 = 1; s2 < n; s2++) {
      push({ x: a.x + ((b.x - a.x) * s2) / n, z: a.z + ((b.z - a.z) * s2) / n });
    }
  }
  return out;
}

/**
 * Triangles covering the band between two nested rings by greedy stitching:
 * both rings are resampled at a common arclength step (matched densities, so
 * no grazing skew) and two fronts advance around them, always stepping the
 * front that is behind in fractional progress and emitting one triangle per
 * step. Pinched spans (collinear-overlapping mouth across-edges) stitch into
 * zero-area quads that are dropped. Returns null when the fronts stall or the
 * area guard fails (caller falls back to the slit clip).
 */
function stripCompute(inner: Pt[], outer: Pt[], step: number): Tri[] | null {
  if (inner.length < 3 || outer.length < 3) return null;
  const want = Math.abs(signedArea(outer)) - Math.abs(signedArea(inner));
  if (want <= 1e-9) return null;
  let peri = 0;
  for (let k = 0; k < outer.length; k++) {
    const p = outer[k], q = outer[(k + 1) % outer.length];
    peri += Math.hypot(q.x - p.x, q.z - p.z);
  }
  if (peri < 1e-9) return null;
  // Step tracks the mean width: quads stay ~1:1 on thin and wide bands
  // alike instead of base<<height slivers, and point counts stay low.
  const h = Math.max(step, want / peri);
  // Both fronts stay CCW: concentric rings advance in the same direction
  // along the band, so consecutive pairs stitch into untwisted quads.
  const A = resample(inner, h);
  const B = resample(outer, h);
  const N = A.length, M = B.length;
  if (N < 3 || M < 3) return null;
  // Start pair: nearest cross-ring pair whose open segment lies in the band.
  // Coarse-to-fine stride: any valid slit anchors the closed march, and the
  // full N·M scan dominates strip cost, so scan ≤64 samples per ring first
  // and refine only when no valid slit turns up.
  let i0 = -1, j0 = -1;
  for (let stride = Math.max(1, Math.ceil(Math.max(N, M) / 64)); ; stride = Math.floor(stride / 2)) {
    let bd = Infinity;
    for (let i = 0; i < N; i += stride) {
      for (let j = 0; j < M; j += stride) {
        const d = dist2(A[i], B[j]);
        if (d < bd && slitOk(A, B, i, j)) { bd = d; i0 = i; j0 = j; }
      }
    }
    if (i0 >= 0 || stride <= 1) break;
  }
  if (i0 < 0) return null;
  const tris: Tri[] = [];
  let dropped = 0;
  let thinKept = 0;
  const emit = (a: Pt, b: Pt, c: Pt): void => {
    // Pinch needles (coincident spans with staggered vertices triangulate
    // into slivers covering ~no area) are dropped: anything thinner than
    // ~3° at this step scale cannot be an honest quad (honest altitudes are
    // ~h/2). The area guard below arbitrates any real coverage loss.
    const a2 = Math.abs(triArea2(a, b, c));
    if (a2 < 1e-9) { dropped++; return; }
    const maxD2 = Math.max(dist2(a, b), dist2(b, c), dist2(c, a));
    const longest = Math.sqrt(maxD2);
    if (longest > 1e-12 && a2 / longest < h * 0.05) { dropped++; return; }
    const th = maxD2 / a2;
    if (th > thinKept) thinKept = th;
    tris.push([a, b, c]);
  };
  // Hoisted out of the march loop (no per-step closure allocs).
  const diagOk = (d2: number, cur: number): boolean => d2 < (6 * cur + 2 * h) * (6 * cur + 2 * h);
  // Lazy containment: honest quad diagonals are ~2h; anything beyond 4h is
  // a dephased fan candidate, so verify it stays in the band (midpoint +
  // edge crossings, skipping edges incident to its endpoints). Rare path.
  const inBand = (p: Pt, q: Pt, ai: number, bj: number): boolean => {
    if (dist2(p, q) <= 16 * h * h) return true;
    const mid = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
    if (!pointInRing(mid, B) || pointInRing(mid, A)) return false;
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      if (k === ai || k2 === ai) continue;
      if (segsTouch(p, q, A[k], A[k2], 1e-9)) return false;
    }
    for (let k = 0; k < M; k++) {
      const k2 = (k + 1) % M;
      if (k === bj || k2 === bj) continue;
      if (segsTouch(p, q, B[k], B[k2], 1e-9)) return false;
    }
    return true;
  };
  let i = i0, j = j0, doneA = 0, doneB = 0;
  let guard = N + M + 8;
  while ((doneA < N || doneB < M) && guard-- > 0) {
    const aNext = A[(i + 1) % N], bNext = B[(j + 1) % M];
    const cur = Math.sqrt(dist2(A[i], B[j]));
    const canA = doneA < N && diagOk(dist2(aNext, B[j]), cur) && inBand(aNext, B[j], (i + 1) % N, j);
    const canB = doneB < M && diagOk(dist2(A[i], bNext), cur) && inBand(A[i], bNext, i, (j + 1) % M);
    if (!canA && !canB) return null;
    // Max-min-angle choice via thinness (lower wins; degenerate scores
    // Infinity so pinched spans still step but any honest triangle wins).
    // Pairing slips show up immediately as needle candidates and lose, so
    // the fronts stay phased through corners. Nearly identical thinness
    // (paired straights) skips trig entirely and steps the
    // fractionally-behind front so both fronts lap together; the 1-5% band
    // refines by exact acos angle. A fractional slack guard (a few steps of
    // corner-arc catch-up) backstops run-ahead.
    const tA = canA ? thinness(A[i], aNext, B[j]) : -1;
    const tB = canB ? thinness(A[i], B[j], bNext) : -1;
    const slack = 4 / Math.min(N, M);
    const okA = tA >= 0 && (doneA + 1) / N - doneB / M <= slack;
    const okB = tB >= 0 && (doneB + 1) / M - doneA / N <= slack;
    if (!okA && !okB) return null;
    let stepA: boolean;
    if (okA && okB) {
      // Degenerate span (pinch): fractions are meaningless (zero width
      // consumes lap without consuming band), so keep the pair tight by
      // stepping toward the shorter cross-edge. Both fronts then exit
      // the pinch together instead of fanning across corners.
      if (!isFinite(tA) && !isFinite(tB)) {
        stepA = dist2(aNext, B[j]) <= dist2(A[i], bNext);
      } else {
      const spread = Math.abs(tA - tB) / Math.max(tA, tB, 1e-300);
      if (spread <= 0.01) {
        if (tA > 100 && tB > 100) {
          stepA = dist2(aNext, B[j]) <= dist2(A[i], bNext);
        } else {
          const fracA = doneA / N, fracB = doneB / M;
          stepA = Math.abs(fracA - fracB) < 1e-12
            ? dist2(aNext, B[j]) <= dist2(A[i], bNext)
            : fracA < fracB;
        }
      } else if (spread <= 0.05) {
        const wA = worstAngle(A[i], aNext, B[j]);
        const wB = worstAngle(A[i], B[j], bNext);
        if (Math.abs(wA - wB) < 1e-9) {
          const fracA = doneA / N, fracB = doneB / M;
          stepA = Math.abs(fracA - fracB) < 1e-12
            ? dist2(aNext, B[j]) <= dist2(A[i], bNext)
            : fracA < fracB;
        } else stepA = wA > wB;
      } else {
        stepA = tA < tB;
      }
      }
    } else {
      stepA = okA;
    }
    if (stepA) {
      emit(A[i], aNext, B[j]);
      i = (i + 1) % N;
      doneA++;
    } else {
      emit(A[i], B[j], bNext);
      j = (j + 1) % M;
      doneB++;
    }
  }
  if (doneA < N || doneB < M) return null;
  void dropped;
  // Delaunay improvement: the greedy march pairs corners myopically, so flip
  // shared diagonals of thin (<5°) tris whenever the flip strictly improves
  // the quad's worst angle. Convex quads only, so the covered union (and the
  // area guard below) never changes. Runs only when the march kept something
  // thinner than the spec allows (thinness > 9); most bands skip it entirely.
  if (thinKept > 9) {
  const byVert = new Map<Pt, number[]>();
  for (let k = 0; k < tris.length; k++) {
    for (const v of tris[k]) {
      const l = byVert.get(v);
      if (l) l.push(k); else byVert.set(v, [k]);
    }
  }
  const dropAdj = (v: Pt, k: number): void => {
    const l = byVert.get(v);
    if (!l) return;
    const at = l.indexOf(k);
    if (at >= 0) l.splice(at, 1);
  };
  const addAdj = (v: Pt, k: number): void => {
    const l = byVert.get(v);
    if (l) { if (!l.includes(k)) l.push(k); } else byVert.set(v, [k]);
  };
  const findN = (k: number, p: Pt, q: Pt): number => {
    for (const c of byVert.get(p) ?? []) {
      if (c === k) continue;
      const u = tris[c];
      if (u[0] === q || u[1] === q || u[2] === q) return c;
    }
    return -1;
  };
  // Scan by cheap thinness; acos verifies only flagged tris (thinness ≤ 9
  // implies min-angle > 5°). Recomputed for the two tris each flip rewrites.
  const thin = tris.map((t) => thinness(t[0], t[1], t[2]));
  // No cycles: every flip strictly raises its quad minimum, so the mesh
  // must settle; the flip budget (generous) backstops only pathological runs.
  let flipped = true, budget = 4 * tris.length + 16;
  while (flipped && budget > 0) {
    flipped = false;
    for (let k = 0; k < tris.length; k++) {
      if (thin[k] <= 9) continue;
      const t = tris[k];
      const w0 = worstAngle(t[0], t[1], t[2]);
      if (w0 >= 5) { thin[k] = 0; continue; }
      for (let e = 0; e < 3; e++) {
        const p = t[e], q = t[(e + 1) % 3], r = t[(e + 2) % 3];
        const n = findN(k, p, q);
        if (n < 0) continue;
        const u = tris[n];
        const s = u[0] !== p && u[0] !== q ? u[0] : (u[1] !== p && u[1] !== q ? u[1] : u[2]);
        if (orient(p, q, r) * orient(p, q, s) >= 0) continue;
        if (orient(r, s, p) * orient(r, s, q) >= 0) continue;
        const wOld = Math.min(w0, worstAngle(u[0], u[1], u[2]));
        const wNew = Math.min(worstAngle(r, s, p), worstAngle(r, s, q));
        if (wNew > wOld + 1e-9) {
          tris[k] = [r, s, p];
          tris[n] = [r, s, q];
          thin[k] = thinness(r, s, p);
          thin[n] = thinness(r, s, q);
          dropAdj(q, k); addAdj(s, k);
          dropAdj(p, n); addAdj(r, n);
          flipped = true;
          budget--;
          break;
        }
      }
    }
  }
  // Taper stubs: a thin tri bordering a pinch hole (no neighbor across one
  // edge) is unflippable, so drop it when it is small, slightly extending the
  // pinch gap (invisible: the rings coincide there). Bounded total area; the
  // area guard below arbitrates any real coverage loss.
  {
    const kept: Tri[] = [];
    let stubArea = 0;
    for (let k = 0; k < tris.length; k++) {
      const t = tris[k];
      const a = Math.abs(triArea2(t[0], t[1], t[2])) / 2;
      let hole = false;
      for (let e = 0; e < 3 && !hole; e++) {
        if (findN(k, t[e], t[(e + 1) % 3]) < 0) hole = true;
      }
      if (hole && a < 5e-3 && stubArea + a <= 5e-3 && thin[k] > 9 && worstAngle(t[0], t[1], t[2]) < 5) {
        stubArea += a;
        continue;
      }
      kept.push(t);
    }
    tris.length = 0;
    tris.push(...kept);
  }
  } // thinKept > 9
  // Area guard: the strip must cover the band annulus (chord sagitta aside).
  let got = 0;
  for (const t of tris) got += Math.abs(triArea2(t[0], t[1], t[2])) / 2;
  if (Math.abs(got - want) > Math.max(0.02, want * 0.05)) return null;
  return tris;
}

export function triangulateStrip(inner: Pt[], outer: Pt[], step = 0.05): Tri[] | null {
  const e = stripCache.get(inner);
  if (e !== undefined && e.outer === outer && e.step === step &&
    sameSample(sampleRing(inner), e.si) && sameSample(sampleRing(outer), e.so)) return e.out;
  const out = stripCompute(inner, outer, step);
  stripCache.set(inner, { outer, si: sampleRing(inner), so: sampleRing(outer), step, out });
  return out;
}

/**
 * Triangles covering the band between two nested rings (inner ⊂ outer), both
 * open vertex lists: greedy strip first (squarish local quads), slit clip as
 * fallback. Returns null only when no valid slit exists either (caller falls
 * back to stacking the full outer ring under the inner one).
 */
function bandCompute(ringA: Pt[], ringB: Pt[]): Tri[] | null {
  if (ringA.length < 3 || ringB.length < 3) return null;
  // Work CCW throughout (fronts and slit both assume it).
  const inner = signedArea(ringA) >= 0 ? ringA : [...ringA].reverse();
  const outer = signedArea(ringB) >= 0 ? ringB : [...ringB].reverse();
  const wantedArea = Math.abs(signedArea(outer)) - Math.abs(signedArea(inner));
  const areaOK = (tris: Tri[]): boolean => {
    let got = 0;
    for (const [a, b, c] of tris) got += Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
    return wantedArea >= 0 && Math.abs(got - wantedArea) <= Math.max(0.02, wantedArea * 0.05);
  };
  const strip = triangulateStrip(inner, outer);
  // Fast accept: thinness ≤ 1/sin(5°) proves every angle exceeds 5°.
  if (strip) {
    let maxThin = 0;
    for (const t of strip) {
      const th = thinness(t[0], t[1], t[2]);
      if (th > maxThin) maxThin = th;
    }
    if (maxThin <= 11.47 && areaOK(strip)) return strip;
  }
  // The strip stalled or settled thin: try slit clips (a different
  // triangulation of the same band) and keep whichever shapes best by exact
  // minimum angle. Capped: defects are rare and cold-cached, but slits cost
  // an earclip each.
  const minAngleOf = (tris: Tri[]): number => {
    let m = Infinity;
    for (const t of tris) {
      const w = worstAngle(t[0], t[1], t[2]);
      if (w < m) m = w;
    }
    return m;
  };
  const cands: { i: number; j: number; d: number }[] = inner.map((p, i) => {
    let j = 0, bd = Infinity;
    for (let k = 0; k < outer.length; k++) {
      const d = dist2(p, outer[k]);
      if (d < bd) { bd = d; j = k; }
    }
    return { i, j, d: bd };
  }).sort((a, b) => a.d - b.d);
  let best: Tri[] | null = strip;
  let bestW = strip ? minAngleOf(strip) : -1;
  let tried = 0;
  for (const { i, j } of cands) {
    if (tried >= 4) break;
    if (!slitOk(inner, outer, i, j)) continue;
    tried++;
    const clip = clipBand(inner, outer, i, j);
    if (!areaOK(clip)) continue;
    const w = minAngleOf(clip);
    if (w > bestW) { best = clip; bestW = w; }
    if (bestW >= 5) break;
  }
  return best && areaOK(best) ? best : null;
}

type BandEntry = { outer: Pt[]; sa: RingSample; sb: RingSample; out: Tri[] | null };
const bandCache = new WeakMap<Pt[], BandEntry>();

export function triangulateBand(ringA: Pt[], ringB: Pt[]): Tri[] | null {
  const e = bandCache.get(ringA);
  if (e !== undefined && e.outer === ringB &&
    sameSample(sampleRing(ringA), e.sa) && sameSample(sampleRing(ringB), e.sb)) return e.out;
  const out = bandCompute(ringA, ringB);
  bandCache.set(ringA, { outer: ringB, sa: sampleRing(ringA), sb: sampleRing(ringB), out });
  return out;
}

/** The open slit segment must lie strictly inside the band. */
function slitOk(inner: Pt[], outer: Pt[], i: number, j: number): boolean {
  const a = inner[i], b = outer[j];
  if (dist2(a, b) < 1e-12) return false;
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  if (!pointInRing(mid, outer) || pointInRing(mid, inner)) return false;
  const touches = (ring: Pt[], skip: number): boolean => {
    for (let k = 0; k < ring.length; k++) {
      const k2 = (k + 1) % ring.length;
      if (k === skip || k2 === skip) continue;
      if (segsTouch(a, b, ring[k], ring[k2], 1e-9)) return true;
    }
    return false;
  };
  return !touches(inner, i) && !touches(outer, j);
}

/**
 * Join outer (CCW) and inner (reversed to CW) with the slit i→j traversed
 * twice, then clip. The two slit edges coincide geometrically; the ~0-area
 * triangles along them are dropped.
 */
function clipBand(inner: Pt[], outer: Pt[], i: number, j: number): Tri[] {
  const poly: Pt[] = [];
  for (let k = 0; k <= outer.length; k++) poly.push(outer[(j + k) % outer.length]);
  for (let k = 0; k <= inner.length; k++) poly.push(inner[(i - k + inner.length * 2) % inner.length]);
  // Drop the duplicated joint vertices (outer[j] and inner[i] repeat once).
  const clean: Pt[] = [];
  for (const p of poly) {
    if (clean.length === 0 || !samePoint(clean[clean.length - 1], p)) clean.push(p);
  }
  if (clean.length > 1 && samePoint(clean[0], clean[clean.length - 1])) clean.pop();
  return triangulateRing(clean);
}
