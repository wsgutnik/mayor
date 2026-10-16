import { describe, expect, it } from "vitest";
import { MARKING_SLICES, MARKINGS_ATLAS_SIZE, markingAtlasUv } from "./road-material";
import { ROAD_CLASS } from "./roads";
import { decodePng, type DecodedPng } from "./test-png";

const TEX = "public/textures/road";

/** ROAD_CLASS ids are geometry ABI: the atlas pack must not renumber them. */
describe("marking class ids", () => {
  it("keeps CROSSWALK/STOP_BAR/ARROW at 7/8/9", () => {
    expect(ROAD_CLASS.CROSSWALK).toBe(7);
    expect(ROAD_CLASS.STOP_BAR).toBe(8);
    expect(ROAD_CLASS.ARROW).toBe(9);
  });
});

describe("markingAtlasUv", () => {
  const cases = [
    { cls: ROAD_CLASS.CROSSWALK, slice: MARKING_SLICES.crosswalk },
    { cls: ROAD_CLASS.STOP_BAR, slice: MARKING_SLICES.stopBar },
    { cls: ROAD_CLASS.ARROW, slice: MARKING_SLICES.arrow },
  ] as const;

  it("maps every quad uv into its own slice (v range inside the slice)", () => {
    for (const { cls, slice } of cases) {
      for (const u of [0, 0.13, 0.5, 0.87, 1]) {
        for (const v of [0, 0.13, 0.5, 0.87, 1]) {
          const [ua, va] = markingAtlasUv(cls, u, v);
          expect(ua).toBeGreaterThanOrEqual(slice.u0);
          expect(ua).toBeLessThanOrEqual(slice.u1);
          expect(va).toBeGreaterThanOrEqual(slice.v0);
          expect(va).toBeLessThanOrEqual(slice.v1);
        }
      }
      // Corners land exactly on the slice bounds.
      expect(markingAtlasUv(cls, 0, 0)).toEqual([slice.u0, slice.v0]);
      expect(markingAtlasUv(cls, 1, 1)).toEqual([slice.u1, slice.v1]);
    }
  });

  it("slices do not overlap", () => {
    const boxes = cases.map(({ slice: s }) => s);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlapU = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0);
        const overlapV = Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0);
        expect(Math.min(overlapU, overlapV)).toBeLessThanOrEqual(0);
      }
    }
  });

  it("rejects non-marking classes", () => {
    expect(() => markingAtlasUv(ROAD_CLASS.STREET, 0.5, 0.5)).toThrow();
  });
});

const px = (img: DecodedPng, x: number, yTop: number): number[] => {
  const i = (yTop * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};

describe("markings.png texel parity", () => {
  const atlas = () => decodePng(`${TEX}/markings.png`);

  it("is the expected 512x896 RGBA atlas", () => {
    const img = atlas();
    expect(img.width).toBe(MARKINGS_ATLAS_SIZE.width);
    expect(img.height).toBe(MARKINGS_ATLAS_SIZE.height);
    expect(img.channels).toBe(4);
  });

  it("each slice is byte-identical to the source marking PNG", () => {
    const img = atlas();
    const { width: W, height: H } = MARKINGS_ATLAS_SIZE;
    const slices = [
      { file: "crosswalk.png", slice: MARKING_SLICES.crosswalk },
      { file: "stop_bar.png", slice: MARKING_SLICES.stopBar },
      { file: "arrow_oneway.png", slice: MARKING_SLICES.arrow },
    ] as const;
    for (const { file, slice } of slices) {
      const src = decodePng(`${TEX}/${file}`);
      expect(src.channels).toBe(4);
      // Slice bounds in top-down PNG pixels (v=1 is the PNG top row after flipY).
      const c0 = Math.round(slice.u0 * W);
      const r0 = Math.round((1 - slice.v1) * H);
      expect(Math.round((slice.u1 - slice.u0) * W)).toBe(src.width);
      expect(Math.round((slice.v1 - slice.v0) * H)).toBe(src.height);
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          expect(px(img, c0 + x, r0 + y), `${file} texel (${x},${y})`).toEqual(px(src, x, y));
        }
      }
    }
  });

  it("remapped quad uvs sample exactly the source texels", () => {
    const img = atlas();
    const { width: W, height: H } = MARKINGS_ATLAS_SIZE;
    const cases = [
      { cls: ROAD_CLASS.CROSSWALK, file: "crosswalk.png" },
      { cls: ROAD_CLASS.STOP_BAR, file: "stop_bar.png" },
      { cls: ROAD_CLASS.ARROW, file: "arrow_oneway.png" },
    ] as const;
    for (const { cls, file } of cases) {
      const src = decodePng(`${TEX}/${file}`);
      // Off-boundary samples: exact quarters/halves sit on texel edges where
      // a 1-ulp float error flips floor() to the neighbour texel.
      for (const u of [0.001, 0.273, 0.517, 0.729, 0.999]) {
        for (const v of [0.001, 0.273, 0.517, 0.729, 0.999]) {
          // flipY cancels out: both textures load flipped, so compare in
          // top-down PNG space on both sides.
          const sx = Math.min(Math.floor(u * src.width), src.width - 1);
          const sy = Math.min(Math.floor((1 - v) * src.height), src.height - 1);
          const [ua, va] = markingAtlasUv(cls, u, v);
          const ax = Math.min(Math.floor(ua * W), W - 1);
          const ay = Math.min(Math.floor((1 - va) * H), H - 1);
          expect(px(img, ax, ay), `${file} quad uv (${u},${v})`).toEqual(px(src, sx, sy));
        }
      }
    }
  });
});
