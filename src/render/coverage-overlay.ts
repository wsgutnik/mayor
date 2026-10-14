// Adapted from fable-cities (MIT, (c) 2026 raw):
//   src/modules/simulation/infoview.js — InfoViewOverlay (VS/FS three-stop
//   ramp, hatched gaps, anti-aliased rings + glow, _updateRings fade).
// Mayor differences: units are tiles (hatch x0.44, ring width +0.2, glow
// exp(-d*0.36)); the mesh reuses the terrain geometry (one extra draw, no
// drape copy); colours go through THREE.Color without a second linear
// conversion; the fragment ends in the tone-mapping + output-colour chunks
// so the overlay matches the ACES pipeline.

import * as THREE from "three";
import { CoverageField, CoverageRing, CoverageRamp, MAX_RINGS } from "../sim/coverage-field";

/** Vertical lift of the shared-geometry overlay (Fable drapes +0.45 m = 0.056 tile). */
export const COVERAGE_LIFT = 0.05;

const VS = /* glsl */`
  uniform float uMapSize;
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vUv = wp.xz / uMapSize;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FS = /* glsl */`
  precision highp float;
  uniform sampler2D uTex;
  uniform vec3 uCovered;
  uniform vec3 uWarn;
  uniform vec3 uBad;
  uniform vec3 uRing;
  uniform vec4 uRings[${MAX_RINGS}];   // x, z, radius, weight
  uniform int uRingCount;
  uniform float uDim;
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  void main() {
    vec4 s = texture2D(uTex, vUv);
    float c = s.r;            // coverage 0..1
    float dev = s.b;          // developed-area mask
    float devM = smoothstep(0.05, 0.34, dev);
    float strength = smoothstep(0.02, 0.85, c);

    // Three-stop ramp: crimson (no service) -> amber (thin) -> the service colour (served).
    vec3 col = mix(uBad, uWarn, smoothstep(0.0, 0.34, strength));
    col = mix(col, uCovered, smoothstep(0.30, 0.88, strength));

    // Served land gets a whisper of colour; built land the service cannot
    // reach gets a strong warning wash, hatched so the gap reads as a gap.
    float aServed = (0.040 + 0.080 * strength) * devM;
    float gap = 1.0 - smoothstep(0.02, 0.32, strength);
    float hatch = smoothstep(0.42, 0.58, fract((vWorld.x + vWorld.z) * 0.44));
    float aGap = gap * devM * 0.38 * (0.62 + 0.38 * hatch);
    float a = max(aServed, aGap);

    // One crisp anti-aliased ring per facility, with a soft outer glow.
    float ring = 0.0, glow = 0.0;
    for (int i = 0; i < ${MAX_RINGS}; i++) {
      if (i >= uRingCount) break;
      vec4 r = uRings[i];
      float d = abs(length(vWorld.xz - r.xy) - r.z);
      float w = fwidth(d) * 1.8 + 0.2;
      ring = max(ring, (1.0 - smoothstep(0.0, w, d)) * r.w);
      glow = max(glow, exp(-d * 0.36) * r.w);
    }
    col = mix(col, uRing, max(ring * 0.92, glow * 0.35));
    a = max(a, ring * 0.92 + glow * 0.16);

    gl_FragColor = vec4(col * uDim, a * mix(1.0, 0.6, 1.0 - uDim));
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Ring visibility weight: rings fade when far larger than the view and when
 * far from the camera target (Fable's _updateRings, units already tiles).
 */
export function ringWeight(r: number, camD: number, dist: number): number {
  const d = Math.max(20 / 8, camD);
  let w = 1 - smoothstep(1.6, 3.0, r / d);
  w *= 1 - smoothstep(d * 1.6, d * 3.2, Math.max(0, dist - r));
  return w;
}

export class CoverageOverlay {
  readonly material: THREE.ShaderMaterial;
  readonly texture: THREE.DataTexture;
  private mesh: THREE.Mesh | null = null;
  private scene: THREE.Scene;
  private attachedGeo: THREE.BufferGeometry | null = null;
  private mapSize = 0;
  private rings: CoverageRing[] = [];
  private ringKey = "";

  constructor(scene: THREE.Scene, size: number) {
    this.scene = scene;
    const data = new Uint8Array(size * size * 4);
    this.texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
    this.mapSize = size;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTex: { value: null },
        uMapSize: { value: size },
        uCovered: { value: new THREE.Color("#35d38a") },
        uWarn: { value: new THREE.Color("#e8a33d") },
        uBad: { value: new THREE.Color("#d6392c") },
        uRing: { value: new THREE.Color("#f2f8ff") },
        uRings: { value: Array.from({ length: MAX_RINGS }, () => new THREE.Vector4()) },
        uRingCount: { value: 0 },
        uDim: { value: 1 },
      }]),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    this.material.uniforms.uTex.value = this.texture;
  }

  /**
   * Share the terrain geometry for a zero-copy drape. Re-attaches when the
   * terrain geometry or the map size changes (load / new city).
   */
  attach(terrain: THREE.Mesh, size: number): void {
    if (this.mesh && this.attachedGeo === terrain.geometry && size === this.mapSize) return;
    if (size !== this.mapSize) {
      const data = new Uint8Array(size * size * 4);
      this.texture.image.data = data;
      this.texture.image.width = size;
      this.texture.image.height = size;
      this.mapSize = size;
      this.material.uniforms.uMapSize.value = size;
      this.texture.needsUpdate = true;
    }
    if (this.mesh) this.scene.remove(this.mesh);
    this.mesh = new THREE.Mesh(terrain.geometry, this.material);
    this.mesh.name = "coverage-infoview";
    this.mesh.position.y = COVERAGE_LIFT;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.attachedGeo = terrain.geometry;
    this.scene.add(this.mesh);
  }

  get visible(): boolean { return this.mesh?.visible ?? false; }

  setVisible(v: boolean): void {
    if (this.mesh) this.mesh.visible = v;
  }

  setColors(ramp: CoverageRamp): void {
    const u = this.material.uniforms;
    (u.uCovered.value as THREE.Color).set(ramp.covered);
    (u.uWarn.value as THREE.Color).set(ramp.warn);
    (u.uBad.value as THREE.Color).set(ramp.bad);
    (u.uRing.value as THREE.Color).set(ramp.ring);
  }

  /** Night dims the overlay like Fable (dim = 1 - 0.8 * nightFactor). */
  setDim(d: number): void {
    this.material.uniforms.uDim.value = d;
  }

  /** Upload a baked field; copies bytes into the live texture (no reallocation). */
  setField(field: CoverageField): void {
    (this.texture.image.data as Uint8Array).set(field.data);
    this.texture.needsUpdate = true;
    this.rings = field.rings;
    this.material.uniforms.uRingCount.value = field.rings.length;
    this.ringKey = "";
  }

  /**
   * Refresh ring weights from the camera; call every few frames. Skips work
   * while the rounded camera key is unchanged (no per-frame allocation).
   */
  updateRings(targetX: number, targetZ: number, camDist: number, force = false): void {
    const key = `${Math.round(camDist)}:${Math.round(targetX / 8)}:${Math.round(targetZ / 8)}`;
    if (!force && key === this.ringKey) return;
    this.ringKey = key;
    const ru = this.material.uniforms.uRings.value as THREE.Vector4[];
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const dist = Math.hypot(r.x - targetX, r.z - targetZ);
      ru[i].set(r.x, r.z, r.r, ringWeight(r.r, camDist, dist));
    }
  }

  dispose(): void {
    if (this.mesh) this.scene.remove(this.mesh);
    this.mesh = null;
    this.material.dispose();
    this.texture.dispose();
  }
}
