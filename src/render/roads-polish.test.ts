import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ATLAS_MEDIAN, ATLAS_SIDEWALK, buildRoadNetworkGeometry, JUNCTION_TILE, JUNCTION_TILE_V, MARK_LIFT_FOR_TESTS,
  padBandTriangles, ROAD_CLASS, ROAD_LIFT,
} from "./roads";
import { createRoadDetailMaterial, JUNCTION_TONE } from "./road-material";
import { junctionsOf, type JunctionLayout } from "../sim/junction";
import { pointInPolygon } from "../sim/lanes";
import { blankShowcaseCity } from "../sim/showcase-cases";
import { placeRoad } from "../sim/sim";
import { cidx, heightAt } from "../sim/world";
import { profileOf, sidewalkEdge } from "../sim/corridor";
import { decodePng, meanColumns } from "./test-png";

/** Task 8b polish (lead's in-game gate): items 1, 2, 4, 5, 6. */

const TEX = "public/textures/road";
const lum = (c: number[]): number => (c[0] + c[1] + c[2]) / 3;

function vertsOf(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute("position"), cls = geo.getAttribute("aClass"), col = geo.getAttribute("color");
  return Array.from({ length: pos.count }, (_, i) => ({
    x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i), cls: cls.getX(i), r: col.getX(i), g: col.getY(i), b: col.getZ(i),
  }));
}
const armFrame = (l: JunctionLayout, armIdx: number) => {
  const arm = l.arms[armIdx];
  return (x: number, z: number) => {
    const rx = x - l.centre.x, rz = z - l.centre.z;
    return { s: rx * arm.dx + rz * arm.dz, lat: -rx * arm.dz + rz * arm.dx };
  };
};

describe("1. taper pad carries lane lines", () => {
  const taperCase = (wide: 2 | 5, narrow: 1 | 4) => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, wide, [{ x: 20.5, z: 30.5 }, { x: 30.5, z: 30.5 }]);
    placeRoad(s, narrow, [{ x: 30.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    const l = [...junctionsOf(w).byNode.values()].find((x) => x.kind === "taper")!;
    const marks = vertsOf(buildRoadNetworkGeometry(w, () => 0, { atlas: true }))
      .filter((v) => v.cls === ROAD_CLASS.FLAT && Math.abs(v.y - MARK_LIFT_FOR_TESTS) < 1e-4);
    return { l, marks, f: armFrame(l, l.taper!.wideArm) };
  };

  it("5->4: the kept-lane boundary runs from the wide boundary (0.405) to the narrow one (0), inside the ring", () => {
    const { l, marks, f } = taperCase(5, 4);
    const L = l.taper!.length;
    const near = marks.filter((v) => {
      const { s, lat } = f(v.x, v.z);
      return s > 0.35 * L && s < 0.65 * L && Math.abs(lat - 0.405 * (s / L)) < 0.03;
    });
    expect(near.length).toBeGreaterThan(0);
    for (const v of marks) if (Math.hypot(v.x - l.centre.x, v.z - l.centre.z) < L + 0.5) expect(pointInPolygon(v, l.asphalt)).toBe(true);
  });

  it("2->1: the direction separator continues through the pad from the median nose", () => {
    const { l, marks, f } = taperCase(2, 1);
    const L = l.taper!.length;
    const centre = marks.filter((v) => { const { s, lat } = f(v.x, v.z); return s > 0.2 * L && s < 0.6 * L && Math.abs(lat) < 0.03; });
    expect(centre.length).toBeGreaterThan(0);
  });
});

describe("2. planted median ends in a rounded nose", () => {
  it("avenue x avenue: each arm's median has nose vertices beyond its square cut", () => {
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    placeRoad(s, 2, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 40.5 }]);
    const l = [...junctionsOf(w).byNode.values()].find((x) => x.kind === "junction")!;
    const r = profileOf(2).medianHalf;
    for (const atlas of [true, false]) {
      const green = new THREE.Color(atlas ? ATLAS_MEDIAN : "#5f8a4a");
      const vs = vertsOf(buildRoadNetworkGeometry(w, () => 0, { atlas }))
        .filter((v) => Math.abs(v.r - green.r) < 1e-6 && Math.abs(v.g - green.g) < 1e-6 && Math.abs(v.b - green.b) < 1e-6);
      l.arms.forEach((arm, ai) => {
        const M = arm.mouth!.asphalt!.centre, f = armFrame(l, ai);
        const tip = vs.filter((v) => { const p = f(v.x, v.z); return p.s < M - 0.9 * r && p.s > M - r - 1e-3 && Math.abs(p.lat) < 0.03; });
        const arc = vs.filter((v) => { const p = f(v.x, v.z); return p.s < M - 1e-3 && Math.abs(Math.hypot(p.s - M, p.lat) - r) < 1e-3; });
        expect(tip.length, `${atlas ? "atlas" : "low"} arm ${ai}`).toBeGreaterThan(0);
        expect(arc.length).toBeGreaterThanOrEqual(7); // >= 6 segments
      });
    }
  });
});

describe("4. one-way arrow decal is transparent outside the arrow", () => {
  it("the arrow branch discards transparent texels instead of painting a background", () => {
    const fallback = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    createRoadDetailMaterial(fallback).material.onBeforeCompile!(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    const f = shader.fragmentShader;
    const arrow = f.slice(f.indexOf("texture2D(uTexArrow"));
    expect(arrow.slice(0, 120)).toContain("discard");
    const img = decodePng(`${TEX}/arrow_oneway.png`);
    expect(img.channels).toBe(4);
    expect(img.data[3]).toBe(0); // corner texel is transparent
  });
});

describe("1b/5. pad asphalt and bands match the ribbon atlas", () => {
  it("junction asphalt tone and texel density match the ribbon lanes", () => {
    const lanes = ([["road_street", 1], ["road_avenue", 2]] as const).map(([f, t]) => {
      const img = decodePng(`${TEX}/${f}.png`), p = profileOf(t), E = sidewalkEdge(t);
      const c = p.laneCentres[p.laneCentres.length - 1], u = (o: number) => 0.5 + o / (2 * E);
      return lum(meanColumns(img, u(c - 0.06), u(c + 0.06)));
    });
    const lane = (lanes[0] + lanes[1]) / 2;
    const j = decodePng(`${TEX}/junction_asphalt.png`);
    const pad = lum(meanColumns(j, 0, 1)) * JUNCTION_TONE;
    expect(Math.abs(pad - lane) / lane).toBeLessThan(0.02);
    // World UV keeps square texels on the 512x1024 junction texture.
    expect(JUNCTION_TILE_V / JUNCTION_TILE).toBeCloseTo(j.height / j.width, 6);
  });

  it("pad kerb/sidewalk bands use the ribbon atlas sidewalk colour, flat class, in the atlas tier", () => {
    const want = new THREE.Color(ATLAS_SIDEWALK);
    for (const [f, t] of [["road_street", 1], ["road_avenue", 2], ["road_oneway_street", 4], ["road_oneway_avenue", 5]] as const) {
      const img = decodePng(`${TEX}/${f}.png`), p = profileOf(t), E = sidewalkEdge(t), u = (o: number) => 0.5 + o / (2 * E);
      const walk = meanColumns(img, u(p.asphaltHalf + 0.01), u(E - 0.01));
      const hex = new THREE.Color().setRGB(walk[0], walk[1], walk[2], THREE.SRGBColorSpace);
      expect(Math.abs(hex.r - want.r) + Math.abs(hex.g - want.g) + Math.abs(hex.b - want.b)).toBeLessThan(0.02);
    }
    const s = blankShowcaseCity(), w = s.world;
    placeRoad(s, 2, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }]);
    placeRoad(s, 1, [{ x: 30.5, z: 20.5 }, { x: 30.5, z: 30.5 }]);
    const l = [...junctionsOf(w).byNode.values()].find((x) => x.kind === "junction")!;
    const band = padBandTriangles(l);
    const corners = [...(band.kerb ?? []), ...(band.walk ?? [])].flat();
    const vs = vertsOf(buildRoadNetworkGeometry(w, () => 0, { atlas: true }))
      .filter((v) => Math.abs(v.y - (ROAD_LIFT + 0.006)) < 1e-4 && corners.some((c) => Math.hypot(c.x - v.x, c.z - v.z) < 1e-4));
    const padVs = vs.filter((v) => v.cls === ROAD_CLASS.PLAIN || v.cls === ROAD_CLASS.FLAT);
    expect(padVs.length).toBeGreaterThan(0);
    for (const v of padVs) {
      expect(v.cls).toBe(ROAD_CLASS.PLAIN);
      expect(Math.abs(v.r - want.r) + Math.abs(v.g - want.g) + Math.abs(v.b - want.b)).toBeLessThan(1e-5);
    }
  });
});

describe("6. deck shadow over water is a neutral dark tint", () => {
  it("no blue cast", () => {
    const s = blankShowcaseCity(), w = s.world;
    for (let z = 20; z <= 41; z++) for (let x = 28; x <= 33; x++) w.heights[cidx(w, x, z)] = 0;
    expect(placeRoad(s, 1, [{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }], "elevated").ok).toBe(true);
    const vs = vertsOf(buildRoadNetworkGeometry(w, (x, z) => heightAt(w, x, z), { atlas: true }))
      .filter((v) => v.cls === ROAD_CLASS.PLAIN && Math.abs(v.y - 0.05) < 1e-4);
    expect(vs.length).toBeGreaterThan(0);
    for (const v of vs) {
      expect(Math.max(v.r, v.g, v.b) - Math.min(v.r, v.g, v.b)).toBeLessThan(0.01);
    }
  });
});
