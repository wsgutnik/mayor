import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { mergeScene } from "./glb-models";

const red = new THREE.MeshStandardMaterial({ name: "red" });
const blue = new THREE.MeshStandardMaterial({ name: "blue" });

function twoTriangles(indexed: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    2, 0, 0, 3, 0, 0, 2, 1, 0,
  ], 3));
  if (indexed) geometry.setIndex([0, 1, 2, 3, 4, 5]);
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  return geometry;
}

describe("GLB mesh merge for V2 materials", () => {
  for (const indexed of [false, true]) {
    it(`preserves two distinct material groups on ${indexed ? "indexed" : "non-indexed"} input`, () => {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(twoTriangles(indexed), [red, blue]));
      const merged = mergeScene(scene);
      expect(merged).not.toBeNull();
      expect(merged!.materials.map(m => m.name)).toEqual(["red", "blue"]);
      expect(merged!.geometry.index?.count).toBe(6);
      expect(merged!.geometry.groups).toHaveLength(2);
      expect(merged!.geometry.groups.map(g => g.count)).toEqual([3, 3]);
      expect(merged!.geometry.getAttribute("uv").count).toBe(12);
      expect(merged!.geometry.getAttribute("color").count).toBe(12);
    });
  }

  it("merges indexed and non-indexed objects into one renderable geometry", () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(twoTriangles(false), [red, blue]));
    const second = new THREE.Mesh(twoTriangles(true), [red, blue]);
    second.position.x = 5;
    scene.add(second);
    const merged = mergeScene(scene);
    expect(merged).not.toBeNull();
    expect(merged!.geometry.index?.count).toBe(12);
    expect(merged!.materials).toHaveLength(4);
    merged!.geometry.computeBoundingBox();
    expect(merged!.geometry.boundingBox!.max.x).toBe(8);
  });
});
