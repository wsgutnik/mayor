// Adapted from fable-cities (MIT, (c) 2026 raw):
// PAINT_COLOURS / BOX_COLOURS / weightedTable from src/modules/traffic/VehicleModels.js,
// paintOf / boxOf from src/modules/traffic/Renderer.js. Hex values port verbatim; the
// pastels in scene.ts CAR were the "1950s pastel" set Fable's critic rejected.
import * as THREE from "three";

/** [weight, sRGB hex]: 62 % neutrals, 38 % saturated minority. */
export const PAINT_COLOURS: [number, number][] = [
  [0.15, 0xe9ecef], [0.055, 0xf6f7f8], [0.12, 0x9aa1a8], [0.07, 0x5b6169],
  [0.13, 0x0e1013], [0.045, 0x373d44], [0.05, 0xc3c7c9],
  [0.065, 0x122a5e], [0.045, 0x14589e], [0.026, 0x2a86cc], [0.06, 0x8e1015],
  [0.038, 0xc4291d], [0.022, 0x5a0f19], [0.038, 0x123f27], [0.022, 0x0d7150],
  [0.024, 0xc38f07], [0.02, 0x7d3d0f], [0.014, 0xc4531a], [0.01, 0x452063],
  [0.012, 0x1f7a6d], [0.01, 0x365f7d], [0.01, 0x6d7d2a], [0.008, 0x8a5a12], [0.008, 0x4a4e57],
];

/** Van bodies, truck cargo boxes, bus roofs: mostly white fleet livery. */
export const BOX_COLOURS: number[] = [
  0xeceded, 0xd9dcda, 0xbcc1c3, 0xe3e6e3, 0xc6ced4, 0xe5e0d3,
  0xcbd2cf, 0x8ea4b6, 0x14508f, 0x9a2b26, 0x1f6440, 0xd09a12,
  0x2a7d6d, 0xe07a3f, 0x53677d,
];

export interface WeightedPalette {
  /** Linear RGB triplets, precomputed once. */
  cols: [number, number, number][];
  table: Uint8Array;
}

function toLinear(hex: number): [number, number, number] {
  const c = new THREE.Color();
  c.setHex(hex, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}

/** 256-entry weighted lookup so a vehicle's paint is a single array index. */
export function weightedTable(pairs: [number, number][]): WeightedPalette {
  const cols = pairs.map((p) => toLinear(p[1]));
  const table = new Uint8Array(256);
  let acc = 0, k = 0;
  const total = pairs.reduce((s, p) => s + p[0], 0);
  for (let i = 0; i < 256; i++) {
    const t = ((i + 0.5) / 256) * total;
    while (k < pairs.length - 1 && t > acc + pairs[k][0]) { acc += pairs[k][0]; k++; }
    table[i] = k;
  }
  return { cols, table };
}

const paint = weightedTable(PAINT_COLOURS);
const boxCols = BOX_COLOURS.map(toLinear);

/** Deterministic body paint for a vehicle seed. Returns a shared triplet: do not mutate. */
export function paintOf(seed: number): [number, number, number] {
  const t = paint;
  return t.cols[t.table[seed & 255]];
}

/** Deterministic cargo-box / livery colour. Returns a shared triplet: do not mutate. */
export function boxOf(seed: number): [number, number, number] {
  return boxCols[(seed >> 3) % boxCols.length];
}
