// Adapted from fable-cities (MIT, (c) 2026 raw):
// createContactShadowMaterial from src/modules/traffic/materials.js and the
// contact-decal placement in TrafficRenderer.sync (src/modules/traffic/Renderer.js).
// One multiply-blended footprint decal per visible vehicle: tight and dark under the
// body, soft past the sills. Multiply means it dims whatever radiance is there, so it
// is invisible inside an already-dark shadow and strongest on sunlit tarmac. This is
// the only grounding on the iPad low tier, which has no shadow map.
import * as THREE from "three";

/** Multiply blend (Zero / SrcColor): the decal darkens, never adds light. */
export function createContactShadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aDark;
      varying vec2 vUvS; varying float vD;
      void main() {
        vUvS = uv; vD = aDark;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uStrength;
      varying vec2 vUvS; varying float vD;
      void main() {
        vec2 q = vUvS * 2.0 - 1.0;
        // rounded-rectangle distance: flat and dark under the footprint, soft past the sills
        float r = length(vec2(max(abs(q.x) - 0.42, 0.0) / 0.58,
                              max(abs(q.y) - 0.62, 0.0) / 0.38));
        float a = 1.0 - smoothstep(0.0, 1.0, r);
        a = a * (0.30 + 0.70 * a);
        float k = clamp(a * vD * uStrength, 0.0, 0.96);
        if (k < 0.004) discard;
        gl_FragColor = vec4(vec3(1.0 - k), 1.0);
      }`,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    blendEquation: THREE.AddEquation,
    depthWrite: false, depthTest: true,
    toneMapped: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });
}

/** Quad footprint relative to the vehicle body (Fable ratios). */
export const CONTACT_WIDTH = 1.7;
export const CONTACT_LENGTH = 1.26;
/** Contact darkness for cars (ambient occlusion, independent of the sun). */
export const CONTACT_DARK = 0.95;

// Adapted from fable-cities (MIT, (c) 2026 raw): createBeamMaterial and the
// camera-facing lamp glare from src/modules/traffic/materials.js. Fable uses
// metres; Mayor uses tiles, so the beam dimensions below are already ÷8 and
// additionally scaled by the existing 0.70 vehicle presentation factor.
const BEAM_CAP = 520;
function beamMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: 0 } },
    vertexShader: `attribute float aStrength; varying float vStrength; varying vec2 vUv; void main(){vStrength=aStrength;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform vec3 uColor; varying float vStrength; varying vec2 vUv; void main(){vec2 q=vUv*2.0-1.0; float a=pow(max(0.0,1.0-length(q)),2.0)*vStrength; if(a<0.002) discard; gl_FragColor=vec4(uColor*a,a);}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false,
  });
}

/** Fixed-cap additive ground washes; one draw per light colour, no per-frame allocation. */
export class VehicleLightPools {
  readonly head: THREE.InstancedMesh;
  readonly tail: THREE.InstancedMesh;
  private readonly ha: THREE.InstancedBufferAttribute;
  private readonly ta: THREE.InstancedBufferAttribute;
  private hn = 0; private tn = 0;
  private readonly hm: THREE.ShaderMaterial; private readonly tm: THREE.ShaderMaterial;
  constructor() {
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    this.ha = new THREE.InstancedBufferAttribute(new Float32Array(BEAM_CAP), 1); this.ta = new THREE.InstancedBufferAttribute(new Float32Array(BEAM_CAP), 1);
    this.ha.setUsage(THREE.DynamicDrawUsage); this.ta.setUsage(THREE.DynamicDrawUsage);
    const hg = g.clone(); hg.setAttribute("aStrength", this.ha); const tg = g.clone(); tg.setAttribute("aStrength", this.ta);
    this.hm = beamMaterial("#ffe0ad"); this.tm = beamMaterial("#ff2412");
    this.head = new THREE.InstancedMesh(hg, this.hm, BEAM_CAP); this.tail = new THREE.InstancedMesh(tg, this.tm, BEAM_CAP);
    for (const m of [this.head, this.tail]) { m.count = 0; m.frustumCulled = false; m.renderOrder = 7; }
  }
  begin(): void { this.hn = 0; this.tn = 0; }
  addHead(matrix: THREE.Matrix4, strength: number): void { if (this.hn >= BEAM_CAP) return; this.head.setMatrixAt(this.hn, matrix); this.ha.array[this.hn++] = strength; }
  addTail(matrix: THREE.Matrix4, strength: number): void { if (this.tn >= BEAM_CAP) return; this.tail.setMatrixAt(this.tn, matrix); this.ta.array[this.tn++] = strength; }
  end(): void { this.head.count = this.hn; this.tail.count = this.tn; this.head.visible = this.hn > 0; this.tail.visible = this.tn > 0; this.head.instanceMatrix.needsUpdate = this.tail.instanceMatrix.needsUpdate = true; this.ha.needsUpdate = this.ta.needsUpdate = true; }
  setStrength(lightsOn: number): void { this.hm.uniforms.uStrength.value = lightsOn * 0.15; this.tm.uniforms.uStrength.value = lightsOn * 0.17; }
}

/**
 * One instanced draw of grounding decals. The caller brackets a frame with
 * begin()/end() and adds one decal per visible ground vehicle (tunnel vehicles
 * excluded). Preallocated: add() writes into reused buffers, no per-frame work.
 */
export class ContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private dark: THREE.InstancedBufferAttribute;
  private n = 0;
  private cap: number;

  constructor(capacity: number) {
    const geom = new THREE.PlaneGeometry(1, 1);
    const arr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    arr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute("aDark", arr);
    this.dark = arr;
    this.cap = capacity;
    this.mesh = new THREE.InstancedMesh(geom, createContactShadowMaterial(), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 8;
    this.mesh.name = "vehicle-contact-shadows";
  }

  begin(): void {
    this.n = 0;
  }

  /** Queue a decal; silently drops when the cap binds. Returns false when dropped. */
  add(m: THREE.Matrix4, darkness: number): boolean {
    if (this.n >= this.cap) return false;
    this.mesh.setMatrixAt(this.n, m);
    this.dark.array[this.n] = darkness;
    this.n++;
    return true;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dark.needsUpdate = true;
    }
  }

  get count(): number {
    return this.n;
  }
}
