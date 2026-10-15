import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildRoadNetworkGeometry, ROAD_CLASS } from "./roads";
import { blankShowcaseCity } from "../sim/showcase-cases";
import { placeRoad } from "../sim/sim";
import { heightAt, makeDeckSampler, segElevation, type World } from "../sim/world";
import { sidewalkEdge } from "../sim/corridor";

/**
 * Task 7.5: bridges read as a slab with a 1.1 m barrier, open at grade, and
 * their concrete never samples the road atlas or the asphalt detail map.
 * Scenario = dev `?scenario=roads` shot "bridge" (avenue elevated over a
 * street) plus the "tunnel" shot for the portal.
 */

/** Road-surface palette (roads.ts); any other vertex colour is structure. */
const SURFACE = ["#ffffff", "#31353c", "#41464e", "#ccd0d6", "#b8bec6", "#d8d4b0", "#e8e4c8", "#5f8a4a", "#f1f1ea", "#6f9b4e"]
  .map((h) => new THREE.Color(h));

function scene(): { w: World; gy: (x: number, z: number) => number } {
  const s = blankShowcaseCity(), w = s.world;
  expect(placeRoad(s, 1, [{ x: 22.5, z: 30.5 }, { x: 38.5, z: 30.5 }]).ok).toBe(true);
  expect(placeRoad(s, 2, [{ x: 30.5, z: 21.5 }, { x: 30.5, z: 39.5 }], "elevated").ok).toBe(true);
  expect(placeRoad(s, 1, [{ x: 52.5, z: 60.5 }, { x: 68.5, z: 60.5 }]).ok).toBe(true);
  expect(placeRoad(s, 2, [{ x: 60.5, z: 51.5 }, { x: 60.5, z: 69.5 }], "tunnel").ok).toBe(true);
  return { w, gy: (x, z) => heightAt(w, x, z) };
}

type V = { x: number; y: number; z: number; cls: number; structure: boolean };

function verts(g: THREE.BufferGeometry): V[] {
  const pos = g.getAttribute("position"), col = g.getAttribute("color"), cls = g.getAttribute("aClass");
  const out: V[] = [];
  for (let i = 0; i < pos.count; i++) {
    const r = col.getX(i), gg = col.getY(i), b = col.getZ(i);
    const surface = SURFACE.some((c) => Math.abs(c.r - r) < 1e-6 && Math.abs(c.g - gg) < 1e-6 && Math.abs(c.b - b) < 1e-6);
    out.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i), cls: cls.getX(i), structure: !surface });
  }
  return out;
}

function deckOf(w: World) {
  const seg = w.segments.find((sg) => segElevation(sg) === "bridge")!;
  expect(seg).toBeTruthy();
  const deck = makeDeckSampler(w, seg.pts);
  /** Arclength and lateral distance of (x, z) from the deck centreline. */
  const frame = (x: number, z: number): { s: number; d: number } => {
    let s = deck.sAt(x, z), best = Infinity;
    for (let t = s - 0.3; t <= s + 0.3; t += 0.005) {
      const c = Math.max(0, Math.min(deck.length, t)), p = deck.pos(c);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < best) { best = d; s = c; }
    }
    return { s, d: best };
  };
  return { deck, frame, edge: sidewalkEdge(seg.type) };
}

describe("bridges: open barrier, slab, non-atlas concrete", () => {
  for (const atlas of [true, false]) {
    const tier = atlas ? "atlas" : "low";

    it(`${tier}: (a) barrier is 0.14 visible above the deck surface and within deck + 0.20`, () => {
      const { w, gy } = scene();
      const { deck, frame, edge } = deckOf(w);
      let n = 0, worst = -Infinity;
      for (const v of verts(buildRoadNetworkGeometry(w, gy, { atlas }))) {
        if (!v.structure) continue;
        const { s, d } = frame(v.x, v.z);
        if (d > edge + 0.1 || s <= 0 || s >= deck.length) continue;
        if (v.y < deck.yAt(s) - 1e-3) continue; // fascia / underside / shadow below the deck
        n++;
        worst = Math.max(worst, v.y - deck.yAt(s));
      }
      expect(n).toBeGreaterThan(0);
      // Lead ruling: 0.14 tile (≈1.1 m) visible above the carriageway (deck + ROAD_LIFT).
      expect(worst).toBeLessThanOrEqual(0.20 + 1e-5);
      expect(worst).toBeGreaterThanOrEqual(0.20 - 1e-3);
    });

    it(`${tier}: (b) the ramp mouth is open at grade`, () => {
      const { w, gy } = scene();
      const { deck, frame, edge } = deckOf(w);
      let n = 0, surface = 0, worst = -Infinity;
      for (const v of verts(buildRoadNetworkGeometry(w, gy, { atlas }))) {
        const { s, d } = frame(v.x, v.z);
        if (d > edge + 0.1) continue;
        const p = deck.pos(s);
        if (deck.yAt(s) - gy(p.x, p.z) >= 0.05) continue;
        if (!v.structure) { surface++; continue; }
        // The ramp's retaining face may reach the deck edge (deck + 0.03,
        // under the sidewalk); nothing may stand above it (no barrier).
        if (v.y <= deck.yAt(s) + 0.03 + 1e-3) continue;
        n++;
        worst = Math.max(worst, v.y - gy(v.x, v.z));
      }
      expect(surface).toBeGreaterThan(0); // the ramp-foot band is really sampled
      expect(n, `barrier vertex ${worst.toFixed(3)} above ground`).toBe(0);
    });

    it(`${tier}: (c) barrier, slab, piers, portal and shadow use the plain concrete class`, () => {
      const { w, gy } = scene();
      const all = verts(buildRoadNetworkGeometry(w, gy, { atlas }));
      const structure = all.filter((v) => v.structure);
      // Piers (bridge) and the portal (tunnel, around x=60.5) are both present.
      expect(structure.some((v) => Math.abs(v.x - 60.5) < 3)).toBe(true);
      expect(structure.some((v) => Math.abs(v.x - 30.5) < 3)).toBe(true);
      const bad = structure.filter((v) => v.cls !== ROAD_CLASS.PLAIN);
      expect(bad.length, `first: ${JSON.stringify(bad[0])}`).toBe(0);
    });

    it(`${tier}: (d) slab underside and fascia exist under the span`, () => {
      const { w, gy } = scene();
      const { deck, frame, edge } = deckOf(w);
      let under = 0, fasciaFoot = 0;
      for (const v of verts(buildRoadNetworkGeometry(w, gy, { atlas }))) {
        if (!v.structure) continue;
        const { s, d } = frame(v.x, v.z);
        if (Math.abs(s - deck.length / 2) > 1.5 || d > edge + 0.01) continue;
        if (Math.abs(v.y - (deck.yAt(s) - 0.12)) < 1e-3) under++;
        if (Math.abs(d - edge) < 1e-3 && Math.abs(v.y - (deck.yAt(s) - 0.12)) < 1e-3) fasciaFoot++;
      }
      expect(under).toBeGreaterThanOrEqual(4);
      expect(fasciaFoot).toBeGreaterThanOrEqual(2);
    });

    it(`${tier}: (e) the ramp below slab clearance is closed by a retaining face down to the ground`, () => {
      const { w, gy } = scene();
      const { deck, frame, edge } = deckOf(w);
      const vs = verts(buildRoadNetworkGeometry(w, gy, { atlas })).filter((v) => v.structure).map((v) => ({ v, f: frame(v.x, v.z) }));
      let probes = 0;
      for (let s = 0.1; s < deck.length - 0.1; s += 0.1) {
        const p = deck.pos(s), clear = deck.yAt(s) - gy(p.x, p.z);
        if (clear < 0.08 || clear > 0.18) continue;
        probes++;
        for (const side of [-1, 1]) {
          const hit = vs.some(({ v, f }) => Math.abs(f.s - s) < 0.45 && Math.abs(f.d - edge) < 1e-3
            && Math.abs(v.y - gy(v.x, v.z)) < 0.03
            && sideOf(deck, f.s, v) === side);
          expect(hit, `station ${s.toFixed(2)} side ${side}`).toBe(true);
        }
      }
      expect(probes).toBeGreaterThan(0);
    });

    it(`${tier}: (f) no deck shadow over the street below (markings stay visible)`, () => {
      const { w, gy } = scene();
      // Street below: z = 30.5, x 22.5..38.5, asphaltHalf 0.38; its own dead-end
      // pads (atlas pad bands are PLAIN too) are excluded by keeping to x 24..37.
      const over = verts(buildRoadNetworkGeometry(w, gy, { atlas })).filter((v) =>
        v.cls === ROAD_CLASS.PLAIN && v.x > 24 && v.x < 37 && Math.abs(v.z - 30.5) < 0.38
        && v.y < gy(v.x, v.z) + 0.2);
      expect(over.length, JSON.stringify(over[0])).toBe(0);
    });
  }
});

/** -1 / +1: which side of the deck centreline v lies on, at station s. */
function sideOf(deck: ReturnType<typeof makeDeckSampler>, s: number, v: { x: number; z: number }): number {
  const p = deck.pos(s), q = deck.pos(Math.min(deck.length, s + 0.05)), r = deck.pos(Math.max(0, s - 0.05));
  const dx = q.x - r.x, dz = q.z - r.z;
  return Math.sign(-(v.x - p.x) * dz + (v.z - p.z) * dx) || 1;
}
