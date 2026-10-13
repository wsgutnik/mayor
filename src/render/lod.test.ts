import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { bucketOrder, LodSorter } from "./lod";

describe("bucketOrder", () => {
  it("splits near and far around the target", () => {
    const { order, near } = bucketOrder([0, 10, 1, 50], [0, 0, 1, 50], 4, 0, 0, 5);
    expect(near).toBe(2);
    expect(order.slice(0, 2).sort()).toEqual([0, 2]);
    expect(order.slice(2).sort()).toEqual([1, 3]);
  });

  it("keeps every index exactly once", () => {
    const xs = [3, 40, 7, 100, 1, 30, 60, 2];
    const zs = [9, 1, 44, 4, 8, 30, 2, 70];
    const { order, near } = bucketOrder(xs, zs, xs.length, 0, 0, 45);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let k = 0; k < near; k++) {
      expect(Math.hypot(xs[order[k]], zs[order[k]])).toBeLessThanOrEqual(45);
    }
    for (let k = near; k < order.length; k++) {
      expect(Math.hypot(xs[order[k]], zs[order[k]])).toBeGreaterThan(45);
    }
  });

  it("handles all-near and all-far", () => {
    expect(bucketOrder([1], [1], 1, 0, 0, 45).near).toBe(1);
    expect(bucketOrder([100], [100], 1, 0, 0, 45).near).toBe(0);
  });
});

describe("LodSorter.partition", () => {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();

  function meshAt(pts: [number, number, number][]): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(box, mat, pts.length);
    const d = new THREE.Object3D();
    pts.forEach(([x, z, s], i) => {
      d.position.set(x, 0, z);
      d.scale.setScalar(s);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      m.setColorAt(i, new THREE.Color(1, 1, 1));
    });
    m.count = pts.length;
    m.instanceMatrix.needsUpdate = true;
    return m;
  }

  const px = (m: THREE.InstancedMesh, i: number) => (m.instanceMatrix.array as Float32Array)[i * 16 + 12];

  it("orders near-first and reports the split", () => {
    const m = meshAt([[0, 0, 1], [100, 100, 1], [2, 0, 1]]);
    const r = new LodSorter().partition(m, 0, 0, 45);
    expect(r).toEqual({ near: 2, kept: 2, total: 3 });
    expect([px(m, 0), px(m, 1), px(m, 2)]).toEqual([0, 2, 100]);
  });

  it("keeps far instances selected by farKeep", () => {
    const m = meshAt([[0, 0, 1], [100, 100, 2], [200, 200, 0.5]]);
    const r = new LodSorter().partition(m, 0, 0, 45, { farKeep: (s) => s >= 1 });
    expect(r).toEqual({ near: 1, kept: 2, total: 3 });
    expect([px(m, 0), px(m, 1), px(m, 2)]).toEqual([0, 100, 200]);
  });

  it("is a no-op on an empty mesh", () => {
    const m = new THREE.InstancedMesh(box, mat, 4);
    m.count = 0;
    expect(new LodSorter().partition(m, 0, 0, 45)).toEqual({ near: 0, kept: 0, total: 0 });
  });
});
