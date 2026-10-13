import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  SHORE_FADE,
  DEEP_AT,
  sampleHeightBilinear,
  waterDepthAt,
  shoreAlpha,
  depthGrade,
  packHeight,
  unpackHeight,
  buildHeightField,
  buildWaterInfo,
  makeWaterNormalTexture,
  makeNoiseTexture,
  tierForPixelCap,
  WaterSurface,
} from "./water";
import { generateWorld } from "../sim/world";

const cornerHeights = (size: number, fn: (x: number, y: number) => number): Float32Array => {
  const s = size + 1;
  const h = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) h[y * s + x] = fn(x, y);
  return h;
};

describe("shoreline distance field", () => {
  it("samples exact corners and blends inside a cell", () => {
    const h = cornerHeights(2, (x, y) => x + y * 10);
    expect(sampleHeightBilinear(h, 2, 0, 0)).toBe(0);
    expect(sampleHeightBilinear(h, 2, 2, 2)).toBeCloseTo(22, 4);
    expect(sampleHeightBilinear(h, 2, 1, 0)).toBe(1);
    expect(sampleHeightBilinear(h, 2, 0.5, 0.5)).toBeCloseTo((0 + 1 + 10 + 11) / 4, 6);
    expect(sampleHeightBilinear(h, 2, 1.5, 0)).toBeCloseTo(1.5, 6);
  });

  it("clamps outside the map instead of reading out of bounds", () => {
    const h = cornerHeights(2, (x, y) => x + y * 10);
    expect(sampleHeightBilinear(h, 2, -5, -5)).toBe(0);
    expect(sampleHeightBilinear(h, 2, 99, 99)).toBeCloseTo(22, 4);
  });

  it("derives signed depth from the level", () => {
    const h = cornerHeights(1, () => -1.5);
    expect(waterDepthAt(h, 1, 0.5, 0.5)).toBeCloseTo(1.5, 6);
    const dry = cornerHeights(1, () => 0.4);
    expect(waterDepthAt(dry, 1, 0.2, 0.7)).toBeCloseTo(-0.4, 6);
  });

  it("fades alpha in over the shore band only", () => {
    expect(shoreAlpha(-0.5)).toBe(0);
    expect(shoreAlpha(0)).toBe(0);
    const mid = shoreAlpha(SHORE_FADE / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(shoreAlpha(SHORE_FADE)).toBe(1);
    expect(shoreAlpha(3)).toBe(1);
    expect(shoreAlpha(SHORE_FADE * 0.75)).toBeGreaterThan(shoreAlpha(SHORE_FADE * 0.25));
  });

  it("grades shallow to deep monotonically", () => {
    expect(depthGrade(-1)).toBe(0);
    expect(depthGrade(0)).toBe(0);
    expect(depthGrade(DEEP_AT)).toBe(1);
    expect(depthGrade(9)).toBe(1);
    expect(depthGrade(1.5)).toBeGreaterThan(depthGrade(0.5));
  });
});

describe("bed height packing", () => {
  it("round-trips the full terrain range within half a millimetre", () => {
    for (const h of [-16, -8, -2.5, -0.02, 0, 0.35, 2.5, 8, 16]) {
      const [hi, lo] = packHeight(h);
      expect(unpackHeight(hi, lo)).toBeCloseTo(h, 3);
    }
  });

  it("clamps outside the range", () => {
    const [hi, lo] = packHeight(-100);
    expect(unpackHeight(hi, lo)).toBeCloseTo(-16, 3);
  });

  it("builds a corner field that decodes back to the terrain", () => {
    const w = generateWorld(4, 11, "plains");
    const field = buildHeightField(w);
    expect(field.length).toBe(5 * 5 * 4);
    const s = 5;
    for (const [x, y] of [[0, 0], [2, 3], [4, 4], [1, 4]] as const) {
      const i = (y * s + x) * 4;
      expect(unpackHeight(field[i], field[i + 1])).toBeCloseTo(w.heights[y * s + x], 3);
    }
  });
});

describe("flow field", () => {
  it("encodes coarse depth per tile", () => {
    const w = generateWorld(8, 3, "plains");
    const s = 9;
    for (let y = 3; y <= 4; y++) for (let x = 3; x <= 4; x++) {
      w.heights[y * s + x] = -2;
      w.heights[y * s + x + 1] = -2;
      w.heights[(y + 1) * s + x] = -2;
      w.heights[(y + 1) * s + x + 1] = -2;
    }
    const info = buildWaterInfo(w);
    expect(info[(3 * 8 + 3) * 4]).toBe(Math.round(0.8 * 255));
  });

  it("points downhill on a slope and rests on flat water", () => {
    const slope = generateWorld(8, 3, "plains");
    const s = 9;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) slope.heights[y * s + x] = (x - 4) * 0.5;
    const info = buildWaterInfo(slope);
    const gx = (info[(4 * 8 + 4) * 4 + 1] / 255 - 0.5) * 2;
    const gy = (info[(4 * 8 + 4) * 4 + 2] / 255 - 0.5) * 2;
    expect(gx).toBeLessThan(-0.5);
    expect(Math.abs(gy)).toBeLessThan(0.05);

    const flat = generateWorld(8, 3, "plains");
    for (let i = 0; i < flat.heights.length; i++) flat.heights[i] = -1;
    const calm = buildWaterInfo(flat);
    const fx = (calm[(4 * 8 + 4) * 4 + 1] / 255 - 0.5) * 2;
    expect(Math.abs(fx)).toBeLessThan(0.05);
  });

  it("marks the wet alpha per tile", () => {
    const w = generateWorld(8, 3, "plains");
    const info = buildWaterInfo(w);
    const s = 9;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const corners = [w.heights[y * s + x], w.heights[y * s + x + 1], w.heights[(y + 1) * s + x], w.heights[(y + 1) * s + x + 1]];
        const land = corners.every((h) => h >= 0.05);
        expect(info[(y * 8 + x) * 4 + 3]).toBe(land ? 0 : 255);
      }
    }
  });
});

describe("procedural water normal map", () => {
  it("is deterministic and carries unit-ish normals", () => {
    const a = makeWaterNormalTexture(64);
    const b = makeWaterNormalTexture(64);
    const da = a.image.data as Uint8Array, db = b.image.data as Uint8Array;
    expect(da).toEqual(db);
    let len = 0;
    for (let i = 0; i < 64 * 64; i += 7) {
      const nx = (da[i * 4] / 255) * 2 - 1;
      const ny = (da[i * 4 + 1] / 255) * 2 - 1;
      const nz = (da[i * 4 + 2] / 255) * 2 - 1;
      len += Math.hypot(nx, ny, nz);
      expect(da[i * 4 + 3]).toBe(255);
    }
    expect(len / Math.ceil(64 * 64 / 7)).toBeCloseTo(1, 1);
    a.dispose();
    b.dispose();
  });

  it("tiles seamlessly: seam neighbours agree more than far columns", () => {
    const t = makeWaterNormalTexture(64);
    const d = t.image.data as Uint8Array;
    const col = (x: number, y: number) => [d[(y * 64 + x) * 4], d[(y * 64 + x) * 4 + 1], d[(y * 64 + x) * 4 + 2]];
    let seam = 0, far = 0;
    for (let y = 0; y < 64; y++) {
      const c0 = col(0, y), cs = col(63, y), cm = col(32, y);
      seam += Math.abs(c0[0] - cs[0]) + Math.abs(c0[1] - cs[1]);
      far += Math.abs(c0[0] - cm[0]) + Math.abs(c0[1] - cm[1]);
    }
    expect(seam).toBeLessThan(far);
    t.dispose();
  });
});

describe("quality tiers", () => {
  it("maps the scene pixel cap onto flat, normals and foam tiers", () => {
    expect(tierForPixelCap(1)).toBe(0);
    expect(tierForPixelCap(1.5)).toBe(1);
    expect(tierForPixelCap(2)).toBe(2);
  });
});

describe("WaterSurface", () => {
  it("builds one plane, follows the camera focus and takes sun updates", () => {
    const w = generateWorld(16, 7, "coast");
    const surface = new WaterSurface(w, makeNoiseTexture(32));
    expect(surface.mesh.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(surface.mesh.frustumCulled).toBe(false);
    const sun = new THREE.Vector3(10, 20, 30);
    surface.update(1.2, 0.8, new THREE.Color("#a9c8e8"), sun, 8, 5);
    expect(surface.mesh.position.x).toBe(8);
    expect(surface.mesh.position.z).toBe(5);
    expect(surface.mesh.position.y).toBe(0);
    for (const tier of [0, 1, 2] as const) expect(() => surface.setTier(tier)).not.toThrow();
    surface.dispose();
  });

  it("rebuilds the fields for a 96x96 map well inside the frame budget", () => {
    const w = generateWorld(96, 7, "coast");
    const t0 = performance.now();
    buildWaterInfo(w);
    buildHeightField(w);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});
