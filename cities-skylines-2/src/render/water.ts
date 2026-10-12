import * as THREE from "three";
import { World, isLand, tileHeight } from "../sim/world";

/** Per-tile data the water shader reads: depth, flow direction and a water mask. */
export function buildWaterInfo(w: World): Uint8Array {
  const n = w.size;
  const depth = new Float32Array(n * n);
  const wet = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const h = tileHeight(w, x, y);
      wet[i] = isLand(w, x, y) ? 0 : 1;
      depth[i] = Math.max(0, -h);
    }
  }
  // Distance to the nearest shore (in tiles) by a two-pass chamfer transform: this, not bed height, drives colour and foam,
  // so water turns turquoise at the coast and deepens smoothly offshore instead of going flat navy.
  const dist = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) dist[i] = wet[i] ? 1e4 : 0;
  const relax = (i: number, j: number, c: number) => { if (dist[j] + c < dist[i]) dist[i] = dist[j] + c; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (x > 0) relax(i, i - 1, 1);
    if (y > 0) relax(i, i - n, 1);
    if (x > 0 && y > 0) relax(i, i - n - 1, 1.414);
    if (x < n - 1 && y > 0) relax(i, i - n + 1, 1.414);
  }
  for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
    const i = y * n + x;
    if (x < n - 1) relax(i, i + 1, 1);
    if (y < n - 1) relax(i, i + n, 1);
    if (x < n - 1 && y < n - 1) relax(i, i + n + 1, 1.414);
    if (x > 0 && y < n - 1) relax(i, i + n - 1, 1.414);
  }
  for (let pass = 0; pass < 2; pass++) {
    const copy = dist.slice();
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      let a = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += copy[(y + dy) * n + x + dx];
      dist[y * n + x] = Math.min(copy[y * n + x] + 1, a / 9);
    }
  }
  // Flow follows the local downhill direction of a smoothed bed; broad lakes and the open sea barely move.
  const smooth = (x: number, y: number) => {
    let s = 0, c = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = Math.min(n - 1, Math.max(0, x + dx)), ny = Math.min(n - 1, Math.max(0, y + dy));
        s += tileHeight(w, nx, ny);
        c++;
      }
    }
    return s / c;
  };
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const gx = smooth(Math.min(n - 1, x + 2), y) - smooth(Math.max(0, x - 2), y);
      const gy = smooth(x, Math.min(n - 1, y + 2)) - smooth(x, Math.max(0, y - 2));
      const mag = Math.hypot(gx, gy);
      // Direction of descent; strength saturates for clear slopes and fades for flat water.
      const k = mag > 1e-4 ? Math.min(1, mag * 3.5) / mag : 0;
      const fx = -gx * k, fy = -gy * k;
      out[i * 4] = Math.round(Math.min(1, Math.max(depth[i] / 2.5 * 0.4, dist[i] / 12)) * 255);
      out[i * 4 + 1] = Math.round((fx * 0.5 + 0.5) * 255);
      out[i * 4 + 2] = Math.round((fy * 0.5 + 0.5) * 255);
      out[i * 4 + 3] = wet[i] ? 255 : 0;
    }
  }
  return out;
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
  uniform sampler2D uInfo;
  uniform sampler2D uNoise;
  uniform float uSize;
  uniform float uTime;
  uniform float uSun;
  uniform vec3 uSky;
  varying vec2 vWorld;
  #include <fog_pars_fragment>

  void main() {
    vec2 uv = vWorld / uSize;
    bool inside = uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0;
    vec4 info = inside ? texture2D(uInfo, uv) : vec4(1.0, 0.5, 0.5, 1.0);
    float wet = smoothstep(0.2, 0.6, info.a);
    if (wet < 0.02) discard;
    float depth = info.r;
    vec2 flow = (info.gb - 0.5) * 2.0;
    float strength = length(flow);

    // Two-phase flow map: noise scrolls along the flow, crossfading so it never visibly resets.
    float t = uTime * 0.18;
    float p0 = fract(t), p1 = fract(t + 0.5);
    vec2 base = vWorld * 0.16;
    vec2 d0 = flow * p0 * 0.9, d1 = flow * p1 * 0.9;
    float n0 = texture2D(uNoise, base - d0 + vec2(0.0, uTime * 0.01)).r;
    float n1 = texture2D(uNoise, base - d1 + 0.37 + vec2(uTime * 0.012, 0.0)).r;
    float w = abs(2.0 * p0 - 1.0);
    float ripple = mix(n0, n1, w);
    float fine = texture2D(uNoise, vWorld * 0.55 + vec2(uTime * 0.04, -uTime * 0.03)).r;

    // Colour by distance from shore (info.r): turquoise at the coast to deep blue offshore.
    vec3 shore = vec3(0.42, 0.80, 0.78);
    vec3 shallow = vec3(0.16, 0.58, 0.70);
    vec3 deep = vec3(0.04, 0.22, 0.42);
    vec3 col = mix(shore, shallow, smoothstep(0.0, 0.18, depth));
    col = mix(col, deep, smoothstep(0.15, 0.85, depth));

    // Wave normal from the ripple noise, for a sun glint and a sky reflection that grows at grazing angles.
    float e = 0.01;
    float rx = texture2D(uNoise, base - d0 + vec2(e, uTime * 0.01)).r;
    float rz = texture2D(uNoise, base - d0 + vec2(0.0, uTime * 0.01 + e)).r;
    vec3 nrm = normalize(vec3((n0 - rx) * 5.0, 1.0, (n0 - rz) * 5.0));
    vec3 V = normalize(cameraPosition - vec3(vWorld.x, 0.0, vWorld.y));
    vec3 L = normalize(vec3(0.45, 0.75, 0.35));
    float spec = pow(max(dot(reflect(-V, nrm), L), 0.0), 70.0) * uSun;
    float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
    col = mix(col, uSky, fres * 0.55);
    col += (ripple - 0.5) * 0.08 + (fine - 0.5) * 0.04;
    col += vec3(1.0, 0.95, 0.82) * spec * 0.9;

    // Foam: a thin animated fringe along the shore and a trace on fast water; nothing across open lakes.
    float fringe = 1.0 - smoothstep(0.0, 0.05, depth);
    float lap = 0.5 + 0.5 * sin(uTime * 0.9 + ripple * 6.0 + vWorld.x * 0.7 + vWorld.y * 0.5);
    float foam = smoothstep(0.52, 0.72, ripple + fine * 0.3) * (fringe * (0.55 + 0.45 * lap) + strength * 0.12);
    col = mix(col, vec3(0.96, 0.99, 1.0), clamp(foam, 0.0, 1.0) * 0.85);

    // Follow the sky: dusk and night darken and cool the water.
    float lum = 0.35 + 0.65 * uSun;
    col *= lum;
    col = mix(col, uSky * 0.5, 0.1);
    gl_FragColor = vec4(col, mix(0.72, 0.94, smoothstep(0.0, 0.3, depth)) * wet);
    #include <fog_fragment>
  }
`;

export class WaterSurface {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private info: THREE.DataTexture;

  constructor(world: World, noise: THREE.DataTexture) {
    const n = world.size;
    this.info = new THREE.DataTexture(buildWaterInfo(world), n, n, THREE.RGBAFormat);
    this.info.magFilter = this.info.minFilter = THREE.LinearFilter;
    this.info.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uInfo: { value: this.info },
          uNoise: { value: noise },
          uSize: { value: n },
          uTime: { value: 0 },
          uSun: { value: 1 },
          uSky: { value: new THREE.Color("#a9c8e8") },
        },
      ]),
    });
    const geo = new THREE.PlaneGeometry(n * 3, n * 3).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(n / 2, -0.02, n / 2);
    this.mesh.renderOrder = 1;
  }

  update(timeSeconds: number, sun: number, sky: THREE.Color): void {
    const u = this.material.uniforms;
    u.uTime.value = timeSeconds;
    u.uSun.value = sun;
    (u.uSky.value as THREE.Color).copy(sky);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.info.dispose();
  }
}
