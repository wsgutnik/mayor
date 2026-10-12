import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { newCity, placeRoad, CityState } from "../sim/sim";
import { cidx, heightAt, segElevation } from "../sim/world";
import { buildRoadNetworkGeometry } from "./roads";
import { tunnelPolylines } from "./underground";

const tris = (g: THREE.BufferGeometry): number =>
  (g.index ? g.index.count : g.attributes.position.count) / 3;

const finite = (g: THREE.BufferGeometry): void => {
  const pos = g.attributes.position.array as Float32Array;
  expect(pos.length).toBeGreaterThan(0);
  for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i])).toBe(true);
};

function spanTown(): { s: CityState; ey: number } {
  const s = newCity(3);
  const ey = s.world.entry.y;
  for (let y = ey - 14; y <= ey + 16; y++)
    for (let x = 0; x <= 60; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  for (let y = ey - 1; y <= ey + 2; y++)
    for (let x = 30; x <= 36; x++) s.world.heights[cidx(s.world, x, y)] = -1;
  for (let y = ey - 1; y <= ey + 2; y++)
    for (let x = 10; x <= 18; x++) s.world.heights[cidx(s.world, x, y)] = 3;
  s.money = 1e7;
  expect(placeRoad(s, 1, [{ x: 3.5, z: ey + 0.5 }, { x: 24.5, z: ey + 0.5 }]).ok).toBe(true);
  expect(placeRoad(s, 1, [{ x: 26.5, z: ey + 0.5 }, { x: 41.5, z: ey + 0.5 }]).ok).toBe(true);
  expect(s.world.segments.some((seg) => segElevation(seg) === "bridge")).toBe(true);
  expect(s.world.segments.some((seg) => segElevation(seg) === "tunnel")).toBe(true);
  return { s, ey };
}

describe("bridge and tunnel geometry", () => {
  it("merges decks, piers, parapets and portals into the road mesh", () => {
    const { s } = spanTown();
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const g = buildRoadNetworkGeometry(s.world, gy);
    finite(g);
    // Piers, parapets and the shadow roughly double a plain deck ribbon.
    expect(tris(g)).toBeGreaterThan(400);
    const pos = g.attributes.position.array as Float32Array;
    // The deck rides above the water it crosses (canal x=30..35, deck ≈ 0.9).
    let above = 0;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] >= 30 && pos[i] <= 36 && pos[i + 1] > 0.5) above++;
    }
    expect(above).toBeGreaterThan(10);
    // Both tunnel mouths carry a dark opening quad (4 verts each).
    const col = g.attributes.color.array as Float32Array;
    const dark = new THREE.Color("#0b0d12");
    let openings = 0;
    for (let i = 0; i < col.length; i += 3) {
      if (Math.abs(col[i] - dark.r) < 1e-6 && Math.abs(col[i + 1] - dark.g) < 1e-6 && Math.abs(col[i + 2] - dark.b) < 1e-6) openings++;
    }
    expect(openings).toBe(8);
  });

  it("drops the decks for the underground view", () => {
    const { s } = spanTown();
    const gy = (x: number, z: number): number => heightAt(s.world, x, z);
    const full = tris(buildRoadNetworkGeometry(s.world, gy));
    const under = tris(buildRoadNetworkGeometry(s.world, gy, { hideBridges: true }));
    expect(under).toBeLessThan(full);
  });

  it("exposes tunnel centrelines for the underground conduits", () => {
    const { s } = spanTown();
    const lines = tunnelPolylines(s.world);
    expect(lines.length).toBe(1);
    expect(lines[0].pts.length).toBeGreaterThan(4);
  });
});
