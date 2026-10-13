import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { packHeights, unpackHeights } from "./maps";
// The converter is deliberately plain ESM JavaScript so it can run directly under Node.
// @ts-expect-error no declaration file is needed for the offline script
import { bakeHeights, bakeMask, decodePng, encodePng, pickEntry } from "../../scripts/lib/heightmap.mjs";

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); out.write(type, 4, "ascii"); data.copy(out, 8);
  // decodePng does not need CRC validation; the field still has the required four bytes.
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function synthetic16BitPng(width: number, rows: number[][]): Buffer {
  const stride = width * 2;
  const unfiltered = rows.map(row => Buffer.from(row.flatMap(value => [value >>> 8, value & 255])));
  const scanlines: Buffer[] = [];
  for (let y = 0; y < rows.length; y++) {
    const filter = y % 5, encoded = Buffer.alloc(stride + 1); encoded[0] = filter;
    for (let x = 0; x < stride; x++) {
      const left = x >= 2 ? unfiltered[y][x - 2] : 0;
      const up = y ? unfiltered[y - 1][x] : 0;
      const upperLeft = y && x >= 2 ? unfiltered[y - 1][x - 2] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
      encoded[x + 1] = (unfiltered[y][x] - predictor) & 255;
    }
    scanlines.push(encoded);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(rows.length, 4); ihdr[8] = 16;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(scanlines))), chunk("IEND", Buffer.alloc(0))]);
}

describe("offline map baking", () => {
  it("decodes big-endian 16-bit grayscale scanlines with all five filters", () => {
    const rows = Array.from({ length: 5 }, (_, y) => [y * 1000 + 1, y * 1000 + 511]);
    const decoded = decodePng(synthetic16BitPng(2, rows));
    expect({ width: decoded.width, height: decoded.height, bitDepth: decoded.bitDepth, channels: decoded.channels })
      .toEqual({ width: 2, height: 5, bitDepth: 16, channels: 1 });
    expect(Array.from(decoded.data)).toEqual(rows.flat());
  });

  it("area-averages a known height gradient and maps sea level to zero", () => {
    const data = new Uint16Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) data[y * 8 + x] = (x + y * 8) * 1000;
    const baked = bakeHeights({ width: 8, height: 8, bitDepth: 16, channels: 1, data }, 2, 0, 1);
    expect(baked[0]).toBeCloseTo(4500 / 65535, 6); // mean of the 2x2 corner block
    expect(baked[4]).toBeCloseTo(31500 / 65535, 6); // mean of the central 4x4 block
    const sea = bakeHeights({ width: 2, height: 2, bitDepth: 16, channels: 1, data: new Uint16Array(4).fill(32768) }, 1, 32768 / 65535);
    expect(Array.from(sea)).toEqual([0, 0, 0, 0]);
  });

  it("round-trips an encoded 8-bit grayscale PNG and majority-bakes its mask", () => {
    const pixels = new Uint8Array([
      255, 255, 0, 0,
      255, 0, 0, 0,
      0, 0, 255, 255,
      0, 0, 255, 0,
    ]);
    const decoded = decodePng(encodePng({ width: 4, height: 4, channels: 1, data: pixels }));
    expect(Array.from(decoded.data)).toEqual(Array.from(pixels));
    expect(Array.from(bakeMask(decoded, 2))).toEqual([1, 0, 0, 1]);
  });

  it("selects an open edge and falls back when the left edge is water", () => {
    const size = 8, stride = size + 1;
    const land = new Float32Array(stride * stride).fill(1);
    const buildable = new Uint8Array(size * size).fill(1);
    expect(pickEntry(land, buildable, size)).toEqual({ x: 0, y: 4, dx: 1, dy: 0 });
    for (let y = 0; y <= size; y++) land[y * stride] = 0;
    expect(pickEntry(land, buildable, size)).toEqual({ x: 7, y: 4, dx: -1, dy: 0 });
  });
});

describe("MapData contract", () => {
  it("round-trips packed heights to centi-unit precision", () => {
    const values = new Float32Array([-4, -0.125, 1.234, 14]);
    const unpacked = unpackHeights(packHeights(values), 1);
    values.forEach((value, i) => expect(Math.abs(unpacked[i] - value)).toBeLessThanOrEqual(0.0051));
  });

  const expectedWater: Record<string, number> = {
    "baia-metropolitana": 40.6433, "vale-verde": 5.6929,
    "arquipelago-azul": 67.9107, "planicie-central": 4.1014,
  };
  for (const [id, sourceWaterPercent] of Object.entries(expectedWater)) {
    it(`validates generated ${id}`, () => {
      const filename = path.resolve("public/maps", `${id}.json`);
      const map = JSON.parse(readFileSync(filename, "utf8"));
      expect(map.size).toBe(128);
      const heights = unpackHeights(map.heightsB64, map.size);
      const water = Buffer.from(map.waterB64, "base64");
      const buildable = Buffer.from(map.buildableB64, "base64");
      expect(heights).toHaveLength(129 * 129);
      expect(water).toHaveLength(128 * 128);
      expect(buildable).toHaveLength(128 * 128);
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(-4);
      expect(Math.max(...heights)).toBeLessThanOrEqual(14);
      const { x, y, dx, dy } = map.entry, stride = 129;
      for (let step = 0; step < 3; step++) {
        const tx = x + dx * step, ty = y + dy * step;
        const corners = [heights[ty * stride + tx], heights[ty * stride + tx + 1], heights[(ty + 1) * stride + tx], heights[(ty + 1) * stride + tx + 1]];
        expect(Math.min(...corners)).toBeGreaterThanOrEqual(0.05);
      }
      const waterPercent = water.reduce((sum, value) => sum + value, 0) / water.length * 100;
      expect(Math.abs(waterPercent - sourceWaterPercent)).toBeLessThanOrEqual(3);
    });
  }
});
