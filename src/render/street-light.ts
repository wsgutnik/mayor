import * as THREE from "three";

// Adapted from fable-cities (MIT, (c) 2026 raw): PropAssets lightpool/halo
// materials in src/modules/props/PropAssets.js. Fable metres are ÷8 in Mayor.
const CAP = 700;
function mat(): THREE.ShaderMaterial { return new THREE.ShaderMaterial({ uniforms: { uNight: { value: 0 } }, vertexShader: "varying vec2 v; void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}", fragmentShader: "uniform float uNight; varying vec2 v; void main(){float d=length(v*2.-1.);float a=pow(max(0.,1.-d),1.7)*uNight; if(a<.002) discard; gl_FragColor=vec4(1.,.72,.42,a*.11);}", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }); }
export class StreetLightFx {
  readonly pools: THREE.InstancedMesh; readonly halos: THREE.InstancedMesh;
  private readonly pm: THREE.ShaderMaterial; private readonly hm: THREE.ShaderMaterial; private n = 0;
  constructor() { const p = new THREE.PlaneGeometry(2.2, 2.2); p.rotateX(-Math.PI / 2); this.pm = mat(); this.pools = new THREE.InstancedMesh(p, this.pm, CAP); const h = new THREE.PlaneGeometry(.38, .38); this.hm = mat(); this.halos = new THREE.InstancedMesh(h, this.hm, CAP); for (const m of [this.pools, this.halos]) { m.count = 0; m.frustumCulled = false; m.renderOrder = 6; } }
  begin(): void { this.n = 0; }
  private readonly scratch = new THREE.Matrix4();
  add(x: number, y: number, z: number): void { if (this.n >= CAP) return; this.pools.setMatrixAt(this.n, this.scratch.makeTranslation(x, y + .006, z)); this.halos.setMatrixAt(this.n, this.scratch.makeTranslation(x, y + 1.55, z)); this.n++; }
  end(): void { this.pools.count = this.halos.count = this.n; this.pools.instanceMatrix.needsUpdate = this.halos.instanceMatrix.needsUpdate = true; }
  setNight(night: number): void { this.pm.uniforms.uNight.value = night; this.hm.uniforms.uNight.value = night; this.pools.visible = this.halos.visible = night > .001; }
}
