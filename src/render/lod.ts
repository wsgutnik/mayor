import * as THREE from "three";

/**
 * M20 — cheapest effective LOD: per-InstancedMesh distance buckets.
 *
 * Each registered mesh keeps its instances ordered near-first around the
 * camera target; rendering only needs `mesh.count` updates:
 * - small props (young trees, lamps, vehicles) beyond `lodDist` are hidden
 *   by shrinking the count,
 * - far buildings are re-drawn as one shared cheap box mesh (12 tris each).
 *
 * Reordering reuses scratch buffers, runs at most ~1/s or after a rebuild,
 * and never allocates per frame.
 */

/** Pure split: indices of `pts` ordered near-first, with the near count. */
export function bucketOrder(
  xs: ArrayLike<number>, zs: ArrayLike<number>, n: number,
  cx: number, cz: number, dist: number,
): { order: number[]; near: number } {
  const d2 = dist * dist;
  const order: number[] = new Array(n);
  let lo = 0;
  // Stable two-pass partition: near first, far after.
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx, dz = zs[i] - cz;
    if (dx * dx + dz * dz <= d2) order[lo++] = i;
  }
  const near = lo;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx, dz = zs[i] - cz;
    if (dx * dx + dz * dz > d2) order[lo++] = i;
  }
  return { order, near };
}

export interface LodMeshOpts {
  /** Far instances to keep (big trees); default keeps none. */
  farKeep?: (scale: number) => boolean;
}

export class LodSorter {
  private mat = new Float32Array(0);
  private col = new Float32Array(0);
  private seen = new Uint8Array(0);
  private idx: number[] = [];

  private ensure(n: number): void {
    if (this.mat.length < n * 16) this.mat = new Float32Array(n * 16);
    if (this.col.length < n * 3) this.col = new Float32Array(n * 3);
    if (this.seen.length < n) this.seen = new Uint8Array(n);
    if (this.idx.length < n) this.idx = new Array(n);
  }

  /**
   * Reorder `mesh` instances to [near…, far-kept…, far-culled…] around
   * (cx, cz). Returns the near count and the kept count (near + far-kept);
   * the caller sets `mesh.count = kept` (props) or copies [near, n) into a
   * cheap mesh (buildings). Reads the live instanceMatrix, so no copy of
   * instance data is stored.
   */
  partition(
    mesh: THREE.InstancedMesh, cx: number, cz: number, dist: number, opts: LodMeshOpts = {},
  ): { near: number; kept: number; total: number } {
    const n = mesh.count;
    if (n === 0) return { near: 0, kept: 0, total: 0 };
    this.ensure(n);
    const m = mesh.instanceMatrix.array as Float32Array;
    const c = mesh.instanceColor?.array as Float32Array | undefined;
    const d2 = dist * dist;
    let lo = 0, mid = 0;
    // First pass: classify; second: far-kept; everything else stays last.
    for (let i = 0; i < n; i++) {
      const dx = m[i * 16 + 12] - cx, dz = m[i * 16 + 14] - cz;
      if (dx * dx + dz * dz <= d2) this.idx[lo++] = i;
    }
    const near = lo;
    const farKeep = opts.farKeep;
    if (farKeep) {
      for (let i = 0; i < n; i++) {
        const dx = m[i * 16 + 12] - cx, dz = m[i * 16 + 14] - cz;
        if (dx * dx + dz * dz > d2) {
          const sx = m[i * 16], sy = m[i * 16 + 1], sz = m[i * 16 + 2];
          if (farKeep(Math.hypot(sx, sy, sz))) this.idx[lo++] = i;
        }
      }
    }
    mid = lo;
    // Unclassified (far, culled) fill the tail so no instance is lost.
    this.seen.fill(0, 0, n);
    for (let k = 0; k < mid; k++) this.seen[this.idx[k]] = 1;
    for (let i = 0; i < n; i++) if (!this.seen[i]) this.idx[lo++] = i;
    // Permute matrices (and colours) through the scratch buffers.
    for (let k = 0; k < n; k++) {
      const i = this.idx[k];
      this.mat.set(m.subarray(i * 16, i * 16 + 16), k * 16);
      if (c) this.col.set(c.subarray(i * 3, i * 3 + 3), k * 3);
    }
    (m as Float32Array).set(this.mat.subarray(0, n * 16));
    if (c) (c as Float32Array).set(this.col.subarray(0, n * 3));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return { near, kept: mid, total: n };
  }
}
