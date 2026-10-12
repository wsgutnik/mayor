import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buffer) {
  const png = Buffer.from(buffer);
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Invalid PNG signature");

  let width, height, bitDepth, colorType, interlace;
  const idat = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (offset + 12 + length > png.length) throw new Error("Truncated PNG chunk");
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
      if (body[10] !== 0 || body[11] !== 0) throw new Error("Unsupported PNG compression or filter method");
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  if (!width || !height || bitDepth === undefined) throw new Error("PNG has no IHDR");
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported");
  const channelCounts = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelCounts[colorType];
  if (!channels || (bitDepth !== 8 && !(colorType === 0 && bitDepth === 16))) {
    throw new Error(`Unsupported PNG colour type ${colorType} at ${bitDepth} bits`);
  }

  const bytesPerPixel = channels * (bitDepth / 8);
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== height * (stride + 1)) throw new Error("PNG scanline data has the wrong size");
  const reconstructed = Buffer.alloc(height * stride);
  let input = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[input++];
    if (filter > 4) throw new Error(`Unsupported PNG filter ${filter}`);
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const encoded = raw[input++];
      const left = x >= bytesPerPixel ? reconstructed[row + x - bytesPerPixel] : 0;
      const up = y ? reconstructed[row - stride + x] : 0;
      const upperLeft = y && x >= bytesPerPixel ? reconstructed[row - stride + x - bytesPerPixel] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
      reconstructed[row + x] = (encoded + prediction) & 255;
    }
  }

  if (bitDepth === 16) {
    const data = new Uint16Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = reconstructed.readUInt16BE(i * 2);
    return { width, height, bitDepth, channels, data };
  }
  return { width, height, bitDepth, channels, data: new Uint8Array(reconstructed) };
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const body = Buffer.from(data);
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  name.copy(out, 4);
  body.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, body])), body.length + 8);
  return out;
}

/** Encode an object with width, height, channels (1, 3, or 4), and 8-bit data. */
export function encodePng({ width, height, channels = 4, data }) {
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : channels === 4 ? 6 : -1;
  if (colorType < 0 || data.length !== width * height * channels) throw new Error("Invalid PNG pixel data");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType;
  const scanlines = Buffer.alloc(height * (width * channels + 1));
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * channels, width * channels)
    .copy(scanlines, y * (width * channels + 1) + 1);
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]);
}

function blockBounds(index, sourceLength, targetLength, corners = false) {
  if (!corners) return [Math.floor(index * sourceLength / targetLength), Math.floor((index + 1) * sourceLength / targetLength)];
  const spacing = sourceLength / targetLength;
  return [Math.max(0, Math.ceil((index - 0.5) * spacing)), Math.min(sourceLength, Math.ceil((index + 0.5) * spacing))];
}

export function bakeHeights(decoded, size = 128, seaLevel, unitsPerNormalised = 14) {
  if (decoded.channels !== 1 || decoded.bitDepth !== 16) throw new Error("Heights must be a 16-bit grayscale PNG");
  const out = new Float32Array((size + 1) * (size + 1));
  for (let oy = 0; oy <= size; oy++) {
    const [y0, y1] = blockBounds(oy, decoded.height, size, true);
    for (let ox = 0; ox <= size; ox++) {
      const [x0, x1] = blockBounds(ox, decoded.width, size, true);
      let sum = 0, count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += decoded.data[y * decoded.width + x]; count++; }
      const units = ((sum / count) / 65535 - seaLevel) * unitsPerNormalised;
      out[oy * (size + 1) + ox] = Math.max(-4, Math.min(14, units));
    }
  }
  return out;
}

export function bakeMask(decoded, size) {
  if (decoded.channels !== 1 || decoded.bitDepth !== 8) throw new Error("Masks must be 8-bit grayscale PNGs");
  const out = new Uint8Array(size * size);
  for (let oy = 0; oy < size; oy++) {
    const [y0, y1] = blockBounds(oy, decoded.height, size);
    for (let ox = 0; ox < size; ox++) {
      const [x0, x1] = blockBounds(ox, decoded.width, size);
      let set = 0, count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { set += decoded.data[y * decoded.width + x] > 127 ? 1 : 0; count++; }
      out[oy * size + ox] = set > count / 2 ? 1 : 0;
    }
  }
  return out;
}

function middleOut(size) {
  const result = [];
  const middle = Math.floor(size / 2);
  for (let d = 0; result.length < size; d++) {
    if (middle - d >= 0) result.push(middle - d);
    if (d && middle + d < size) result.push(middle + d);
  }
  return result;
}

export function pickEntry(heights, buildable, size) {
  const stride = size + 1;
  const validTile = (x, y) => {
    const corners = [heights[y * stride + x], heights[y * stride + x + 1], heights[(y + 1) * stride + x], heights[(y + 1) * stride + x + 1]];
    return Math.min(...corners) >= 0.05 && Math.max(...corners) - Math.min(...corners) <= 0.6;
  };
  const candidates = middleOut(size);
  const edges = [
    { dx: 1, dy: 0, at: n => ({ x: 0, y: n }) },
    { dx: -1, dy: 0, at: n => ({ x: size - 1, y: n }) },
    { dx: 0, dy: 1, at: n => ({ x: n, y: 0 }) },
    { dx: 0, dy: -1, at: n => ({ x: n, y: size - 1 }) },
  ];
  const findAtDepth = depth => {
    for (const edge of edges) for (const n of candidates) {
    const edgeTile = edge.at(n);
    const start = { x: edgeTile.x + edge.dx * depth, y: edgeTile.y + edge.dy * depth };
    let buildableCount = 0, valid = true;
    for (let step = 0; step < 3; step++) {
      const x = start.x + edge.dx * step, y = start.y + edge.dy * step;
      valid &&= validTile(x, y);
      buildableCount += buildable[y * size + x] ? 1 : 0;
    }
    if (valid && buildableCount >= 2) return { ...start, dx: edge.dx, dy: edge.dy };
    }
    return undefined;
  };
  // Normally the run starts on the boundary. Fully ocean-ringed island maps have no
  // land boundary tile, so continue each inward ray and choose its first valid run.
  for (let depth = 0; depth <= size - 3; depth++) {
    const entry = findAtDepth(depth);
    if (entry) return entry;
  }
  throw new Error("No suitable map entry found");
}
