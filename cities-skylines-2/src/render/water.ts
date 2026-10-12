import * as THREE from "three";
import { World, isLand, tileHeight } from "../sim/world";

/**
 * M19 — water with a continuous shoreline, normals and reflection.
 *
 * The shoreline no longer comes from a per-tile wet mask. The bed height is
 * uploaded as a (size+1)^2 corner field and sampled bilinearly in the shader,
 * so `depth = level - h(x,z)` follows the real terrain contour at sub-tile
 * resolution. The per-tile `buildWaterInfo` texture survives only as a flow
 * field (scroll direction for normals/foam) plus a coarse depth hint.
 */

export const WATER_LEVEL = 0;
/** Bed depth over which the shore alpha fades in (soft waterline). */
export const SHORE_FADE = 0.12;
/** Bed depth of the foam fringe band along the coast. */
export const FOAM_BAND = 0.2;
/** Depth that reads as fully deep water in the absorption gradient. */
export const DEEP_AT = 2.2;
/** Corner-height range packed into the RG bed texture. */
export const HEIGHT_MIN = -16;
export const HEIGHT_MAX = 16;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const sstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Bilinear sample of the (size+1)^2 corner heights at tile-space (x, z). */
export function sampleHeightBilinear(heights: Float32Array, size: number, x: number, z: number): number {
  const cx = Math.max(0, Math.min(size - 1e-6, x));
  const cz = Math.max(0, Math.min(size - 1e-6, z));
  const x0 = Math.floor(cx), z0 = Math.floor(cz);
  const fx = cx - x0, fz = cz - z0;
  const s = size + 1;
  const a = heights[z0 * s + x0], b = heights[z0 * s + x0 + 1];
  const c = heights[(z0 + 1) * s + x0], d = heights[(z0 + 1) * s + x0 + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Signed bed depth below the water level (positive = water). */
export function waterDepthAt(
  heights: Float32Array, size: number, x: number, z: number, level = WATER_LEVEL,
): number {
  return level - sampleHeightBilinear(heights, size, x, z);
}

/** Soft alpha fade at the waterline: 0 on dry bed, 1 past SHORE_FADE depth. */
export function shoreAlpha(depth: number): number {
  return sstep(0, SHORE_FADE, depth);
}

/** Shallow (0) to deep (1) grade driving the absorption colours and alpha. */
export function depthGrade(depth: number): number {
  return sstep(0, DEEP_AT, depth);
}

/** Pack a corner height into two bytes (RG) for a filterable byte texture. */
export function packHeight(h: number): [number, number] {
  const q = Math.round(clamp01((h - HEIGHT_MIN) / (HEIGHT_MAX - HEIGHT_MIN)) * 65535);
  return [Math.floor(q / 256), q % 256];
}

/** Inverse of packHeight. */
export function unpackHeight(hi: number, lo: number): number {
  return ((hi * 256 + lo) / 65535) * (HEIGHT_MAX - HEIGHT_MIN) + HEIGHT_MIN;
}

/**
 * (size+1)^2 RGBA bytes holding the corner heights in R/G; sampled bilinearly
 * by the GPU. RGBA (not RG) keeps every row 4-aligned for texture upload.
 */
export function buildHeightField(w: World): Uint8Array {
  const s = w.size + 1;
  const out = new Uint8Array(s * s * 4);
  for (let i = 0; i < s * s; i++) {
    const [hi, lo] = packHeight(w.heights[i]);
    out[i * 4] = hi;
    out[i * 4 + 1] = lo;
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Per-tile data the water shader reads: coarse depth plus the flow field.
 * Flow follows the local downhill direction of a smoothed bed; broad lakes
 * and the open sea barely move, so foam stays on coasts and rapids.
 */
export function buildWaterInfo(w: World): Uint8Array {
  const n = w.size;
  // One 5x5 smoothing pass over the bed, then central differences: O(n^2).
  const bed = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let s = 0, c = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = Math.min(n - 1, Math.max(0, x + dx)), ny = Math.min(n - 1, Math.max(0, y + dy));
          s += tileHeight(w, nx, ny);
          c++;
        }
      }
      bed[y * n + x] = s / c;
    }
  }
  const at = (x: number, y: number) => bed[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))];
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const gx = at(x + 2, y) - at(x - 2, y);
      const gy = at(x, y + 2) - at(x, y - 2);
      const mag = Math.hypot(gx, gy);
      // Direction of descent; strength saturates for clear slopes and fades for flat water.
      const k = mag > 1e-4 ? Math.min(1, mag * 3.5) / mag : 0;
      const fx = -gx * k, fy = -gy * k;
      out[i * 4] = Math.round(clamp01(Math.max(0, -tileHeight(w, x, y)) / 2.5) * 255);
      out[i * 4 + 1] = Math.round((fx * 0.5 + 0.5) * 255);
      out[i * 4 + 2] = Math.round((fy * 0.5 + 0.5) * 255);
      out[i * 4 + 3] = isLand(w, x, y) ? 0 : 255;
    }
  }
  return out;
}

/**
 * A tiling tangent-space normal map generated procedurally in JS (the HD
 * texture work happens in another worktree and is not available here).
 * Deterministic: the same size always yields the same bytes. Each octave has
 * its own wrapping lattice, so the map tiles seamlessly.
 */
export function makeWaterNormalTexture(size = 256): THREE.DataTexture {
  const cells = 32;
  let seed = 20261012;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const layers: { m: number; lat: Float32Array }[] = [];
  for (let o = 0; o < 3; o++) {
    const m = cells * 2 ** o;
    const lat = new Float32Array(m * m);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    layers.push({ m, lat });
  }
  const data = new Uint8Array(size * size * 4);
  const hgt = (x: number, y: number) => {
    const xx = ((x % size) + size) % size, yy = ((y % size) + size) % size;
    let v = 0, amp = 0.5;
    for (const { m, lat } of layers) {
      const gx = (xx / size) * m, gy = (yy / size) * m;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const tx = gx - x0, ty = gy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const ix = (a: number) => ((a % m) + m) % m;
      const A = lat[ix(y0) * m + ix(x0)];
      const B = lat[ix(y0) * m + ix(x0 + 1)];
      const C = lat[ix(y0 + 1) * m + ix(x0)];
      const D = lat[ix(y0 + 1) * m + ix(x0 + 1)];
      v += amp * (A + (B - A) * sx + (C - A) * sy + (A - B - C + D) * sx * sy);
      amp *= 0.5;
    }
    return v;
  };
  const amp = 2.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * amp;
      const dz = (hgt(x, y + 1) - hgt(x, y - 1)) * amp;
      const inv = 1 / Math.hypot(dx, 1, dz);
      const j = (y * size + x) * 4;
      data[j] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      data[j + 1] = Math.round((-dz * inv * 0.5 + 0.5) * 255);
      data[j + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[j + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** A tiling value-noise texture, 128 × 128, used for ripples and foam. */
export function makeNoiseTexture(size = 128): THREE.DataTexture {
  const cells = 16;
  const lat = new Float32Array(cells * cells);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const at = (x: number, y: number) => lat[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, f = 1;
      for (let o = 0; o < 3; o++) {
        const gx = (x / size) * cells * f, gy = (y / size) * cells * f;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const tx = gx - x0, ty = gy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
        v += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
        amp *= 0.5;
        f *= 2;
      }
      const j = (y * size + x) * 4;
      data[j] = data[j + 1] = data[j + 2] = Math.round(Math.min(1, v) * 255);
      data[j + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const VERT = /* glsl */ `
  varying vec2 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uBed;
  uniform sampler2D uInfo;
  uniform sampler2D uNoise;
  uniform sampler2D uNormals;
  uniform float uSize;
  uniform float uTime;
  uniform float uSun;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform float uUseNormals;
  uniform float uUseFoam;
  varying vec2 vWorld;
  #include <fog_pars_fragment>

  float unpackH(vec2 rg) {
    return (rg.x * 65280.0 + rg.y * 255.0) / 65535.0 * 32.0 - 16.0;
  }

  void main() {
    vec2 uv = vWorld / uSize;
    bool inside = uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0;
    vec2 cuv = clamp(uv, 0.0, 1.0);
    // Bilinear bed height at sub-tile resolution: the waterline follows the
    // terrain contour instead of stepping per tile.
    float h = unpackH(texture2D(uBed, (vWorld + 0.5) / (uSize + 1.0)).rg);
    float depth = inside ? (0.0 - h) : 0.9;
    float shoreA = smoothstep(0.0, 0.12, depth);
    if (shoreA < 0.015) discard;
    vec2 flow = inside ? (texture2D(uInfo, (clamp(vWorld, 0.0, uSize) + 0.5) / uSize).gb - 0.5) * 2.0 : vec2(0.0);
    float strength = length(flow);

    // Two scrolling normal taps advected by the flow, crossfaded over a
    // two-phase cycle so the scroll never visibly resets.
    float t = uTime * 0.14;
    float p0 = fract(t), p1 = fract(t + 0.5);
    vec2 suv = vWorld * 0.07;
    vec2 adv = flow * 0.45;
    vec3 n0 = texture2D(uNormals, suv - adv * p0).rgb * 2.0 - 1.0;
    vec3 n1 = texture2D(uNormals, suv * 2.63 + 0.37 - adv * p1).rgb * 2.0 - 1.0;
    vec2 slope = mix(n0.xy, n1.xy, abs(2.0 * p0 - 1.0));
    vec3 N = normalize(vec3(slope.x * 0.65 * uUseNormals, 1.0, slope.y * 0.65 * uUseNormals));
    float foamN = texture2D(uNoise, vWorld * 0.33 + flow * uTime * 0.06).r;

    // Depth-based absorption: shallow turquoise to deep blue.
    vec3 col = mix(vec3(0.25, 0.72, 0.74), vec3(0.10, 0.47, 0.62), smoothstep(0.0, 0.5, depth));
    col = mix(col, vec3(0.02, 0.16, 0.34), smoothstep(0.4, 2.2, depth));

    // Fresnel sky reflection plus Blinn-Phong sun glint off the real sun.
    vec3 V = normalize(cameraPosition - vec3(vWorld.x, 0.0, vWorld.y));
    vec3 L = normalize(uSunDir);
    float spec = pow(max(dot(N, normalize(L + V)), 0.0), 160.0) * uSun * uUseNormals;
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(V, N), 0.0), 5.0);
    col = mix(col, uSky, clamp(fres * 1.2, 0.0, 1.0) * mix(0.25, 1.0, uUseNormals));
    col += (foamN - 0.5) * mix(0.10, 0.05, uUseNormals);
    col += vec3(1.0, 0.95, 0.82) * spec * 1.2;

    // Foam: a slow lapping fringe only in the shallow band, plus a crest
    // trail where the flow runs fast; calm open water stays clean.
    float fringe = 1.0 - smoothstep(0.0, 0.2, depth);
    float lap = 0.5 + 0.5 * sin(uTime * 0.9 + foamN * 6.0 + vWorld.x * 0.7 + vWorld.y * 0.5);
    float crest = smoothstep(0.62, 0.85, foamN + length(slope) * 0.35) * smoothstep(0.45, 0.9, strength);
    float foam = (fringe * (0.45 + 0.55 * lap) * smoothstep(0.35, 0.7, foamN + fringe * 0.3) + crest * 0.8) * uUseFoam;
    col = mix(col, vec3(0.95, 0.98, 1.0), clamp(foam, 0.0, 1.0) * 0.85);

    // Follow the sky: dusk and night darken and cool the water; rain arrives
    // via the dimmed sun level and the greyed sky colour.
    col *= 0.35 + 0.65 * uSun;
    col = mix(col, uSky * 0.5, 0.1);
    // The bed shows through shallow water; the shore fades out softly.
    float alpha = shoreA * mix(0.55, 0.95, smoothstep(0.0, 1.5, depth));
    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }
`;

/** Quality tier for the water: 0 = flat + ripple, 1 = + normals, 2 = + foam. */
export type WaterTier = 0 | 1 | 2;

/** Map the scene pixel-ratio cap onto a water tier (mirrors setQualityCap). */
export function tierForPixelCap(cap: number): WaterTier {
  return cap <= 1 ? 0 : cap < 2 ? 1 : 2;
}

export class WaterSurface {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private info: THREE.DataTexture;
  private bed: THREE.DataTexture;

  constructor(world: World, noise: THREE.DataTexture) {
    const n = world.size;
    this.info = new THREE.DataTexture(buildWaterInfo(world), n, n, THREE.RGBAFormat);
    this.info.magFilter = this.info.minFilter = THREE.LinearFilter;
    this.info.wrapS = this.info.wrapT = THREE.ClampToEdgeWrapping;
    this.info.needsUpdate = true;
    this.bed = new THREE.DataTexture(buildHeightField(world), n + 1, n + 1, THREE.RGBAFormat);
    this.bed.magFilter = this.bed.minFilter = THREE.LinearFilter;
    this.bed.wrapS = this.bed.wrapT = THREE.ClampToEdgeWrapping;
    this.bed.needsUpdate = true;
    const normals = makeWaterNormalTexture(256);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uBed: { value: this.bed },
          uInfo: { value: this.info },
          uNoise: { value: noise },
          uNormals: { value: normals },
          uSize: { value: n },
          uTime: { value: 0 },
          uSun: { value: 1 },
          uSky: { value: new THREE.Color("#a9c8e8") },
          uSunDir: { value: new THREE.Vector3(-40, 70, 30) },
          uUseNormals: { value: 1 },
          uUseFoam: { value: 1 },
        },
      ]),
    });
    // One plane, centred on the camera focus every frame: no visible edges at any zoom.
    const geo = new THREE.PlaneGeometry(n * 3, n * 3).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(n / 2, WATER_LEVEL, n / 2);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  /** Quality tier from the scene quality cap: flat, normals, then foam. */
  setTier(tier: WaterTier): void {
    const u = this.material.uniforms;
    u.uUseNormals.value = tier >= 1 ? 1 : 0;
    u.uUseFoam.value = tier >= 2 ? 1 : 0;
  }

  /**
   * Per-frame feed from the scene: time, day level, sky colour, the real sun
   * direction and the camera focus the plane recentres on. Allocates nothing.
   */
  update(timeSeconds: number, sun: number, sky: THREE.Color, sunDir: THREE.Vector3, focusX: number, focusZ: number): void {
    const u = this.material.uniforms;
    u.uTime.value = timeSeconds;
    u.uSun.value = sun;
    (u.uSky.value as THREE.Color).copy(sky);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    this.mesh.position.x = focusX;
    this.mesh.position.z = focusZ;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.material.uniforms.uNormals.value as THREE.DataTexture).dispose();
    this.material.dispose();
    this.info.dispose();
    this.bed.dispose();
  }
}
