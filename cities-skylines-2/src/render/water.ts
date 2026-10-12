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
      out[i * 4] = Math.round(Math.min(1, depth[i] / 2.5) * 255);
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

    vec3 shallow = vec3(0.30, 0.66, 0.74);
    vec3 deep = vec3(0.07, 0.25, 0.46);
    vec3 col = mix(shallow, deep, smoothstep(0.0, 0.85, depth));
    col += (ripple - 0.5) * 0.18 + (fine - 0.5) * 0.06;

    // Sun glints and foam on the shallows and along fast water.
    float glint = smoothstep(0.72, 0.9, ripple * 0.6 + fine * 0.5) * uSun;
    col += vec3(1.0, 0.96, 0.85) * glint * 0.55;
    float foamZone = (1.0 - smoothstep(0.0, 0.16, depth)) + strength * 0.25;
    float foam = smoothstep(0.55, 0.75, ripple + fine * 0.25) * clamp(foamZone, 0.0, 1.0);
    col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.7);

    // Follow the sky: dusk and night darken and cool the water; the sky colour bleeds in at grazing light.
    float lum = 0.35 + 0.65 * uSun;
    col *= lum;
    col = mix(col, uSky * 0.55, 0.18);
    gl_FragColor = vec4(col, 0.9 * wet);
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
