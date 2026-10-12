/**
 * Official maps: a baked, game-sized version of the MAYOR Map Kit heightmaps.
 *
 * The converter (scripts/convert-maps.mjs) turns each 1024×1024 16-bit PNG plus its masks into one
 * `MapData` JSON in public/maps/. This file is the contract between the converter, the loader and the UI.
 */

/** One entry of public/maps/index.json. Strings come in pt-BR (default) and English. */
export interface MapListing {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  difficulty: "beginner" | "medium" | "advanced";
  /** Free tag from the kit: bay, valley, archipelago, plains. */
  terrain: string;
  /** Tiles per side of the baked map. */
  size: number;
  /** URL of the MapData JSON. */
  data: string;
  /** URL of a preview image (JPEG or PNG), about 480 px wide. */
  preview: string;
}

export interface MapIndex { maps: MapListing[] }

/** Where cars (and the road network) enter the city: the first of three road tiles, and the direction inward. */
export interface MapEntry { x: number; y: number; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }

export interface MapData {
  id: string;
  size: number;
  /**
   * Corner heights, (size+1)² values, row-major (y then x), in game units where 0 is the water line.
   * Stored as little-endian Int16 of height×100, base64 encoded.
   */
  heightsB64: string;
  /** size² bytes, 1 where the source water mask says ocean or river, base64 encoded. Informational. */
  waterB64: string;
  /** size² bytes, 1 where the source buildable mask is set, base64 encoded. Informational. */
  buildableB64: string;
  entry: MapEntry;
  /** Source sea level, normalised 0..1, kept for reference. */
  seaLevel: number;
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Pack game-unit heights as Int16 centi-units (the on-disk format). */
export function packHeights(heights: ArrayLike<number>): string {
  const buf = new Int16Array(heights.length);
  for (let i = 0; i < heights.length; i++) buf[i] = Math.max(-32768, Math.min(32767, Math.round(heights[i] * 100)));
  return toB64(new Uint8Array(buf.buffer));
}

export function unpackHeights(b64: string, size: number): Float32Array {
  const bytes = fromB64(b64);
  const n = (size + 1) * (size + 1);
  if (bytes.length !== n * 2) throw new Error("Map height data has the wrong size");
  const view = new Int16Array(bytes.buffer, bytes.byteOffset, n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view[i] / 100;
  return out;
}

export function unpackMask(b64: string, size: number): Uint8Array {
  const bytes = fromB64(b64);
  if (bytes.length !== size * size) throw new Error("Map mask has the wrong size");
  return bytes;
}
