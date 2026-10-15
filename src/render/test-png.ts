import * as fs from "node:fs";
import * as zlib from "node:zlib";

/**
 * Minimal 8-bit RGB/RGBA PNG decoder for headless texture checks in tests
 * (no image dependency in the project). Non-interlaced only.
 */
export interface DecodedPng { width: number; height: number; channels: number; data: Uint8Array }

export function decodePng(path: string): DecodedPng {
  const buf = fs.readFileSync(path);
  let off = 8, width = 0, height = 0, channels = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      const depth = body[8], color = body[9], interlace = body[12];
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) throw new Error(`unsupported PNG ${path}`);
      channels = color === 2 ? 3 : 4;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels, data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[dst + x - channels] : 0;
      const b = y > 0 ? data[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? data[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      data[dst + x] = v & 255;
    }
  }
  return { width, height, channels, data };
}

/** Mean colour (0..1, sRGB-encoded as stored) of columns [u0, u1) over the full height. */
export function meanColumns(img: DecodedPng, u0: number, u1: number): [number, number, number] {
  const x0 = Math.max(0, Math.floor(u0 * img.width)), x1 = Math.min(img.width, Math.ceil(u1 * img.width));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < img.height; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.width + x) * img.channels;
    r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
  }
  return [r / n / 255, g / n / 255, b / n / 255];
}
