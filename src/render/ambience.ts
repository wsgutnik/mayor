import * as THREE from "three";

export interface SmokeSource { x: number; y: number; z: number; strength: number }

/** Drifting clouds and chimney smoke: cheap instanced shapes that make the city feel alive. */
export class Ambience {
  private clouds: THREE.InstancedMesh;
  private smoke: THREE.InstancedMesh;
  private cloudData: { x: number; z: number; y: number; sx: number; sy: number; sz: number; speed: number }[] = [];
  private sources: SmokeSource[] = [];
  private readonly maxPuffs = 720;
  private d = new THREE.Object3D();
  private c = new THREE.Color();
  private scene: THREE.Scene;
  private size = 96;
  /** Photo cloud sprites (public/textures/flora/cloud_N.png): flat cards high above the city, one pool per image. */
  private sprites: { mesh: THREE.InstancedMesh; mat: THREE.MeshBasicMaterial; data: { x: number; z: number; y: number; s: number; yaw: number; speed: number }[] }[] = [];
  private spritesReady = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const blob = new THREE.IcosahedronGeometry(1, 1);
    this.clouds = new THREE.InstancedMesh(
      blob,
      new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.88, depthWrite: false, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.25 }),
      72,
    );
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 3;
    scene.add(this.clouds);
    this.smoke = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.7, depthWrite: false }),
      this.maxPuffs,
    );
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 2;
    scene.add(this.smoke);
    this.loadSprites();
  }

  private loadSprites(): void {
    if (typeof document === "undefined") return; // headless tests keep the low-poly clouds
    const loader = new THREE.TextureLoader();
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    let pending = 4;
    for (let n = 1; n <= 4; n++) {
      loader.load(`/textures/flora/cloud_${n}.png`, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.92, fog: false });
        const mesh = new THREE.InstancedMesh(geo, mat, 24);
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        mesh.count = 0;
        this.scene.add(mesh);
        this.sprites.push({ mesh, mat, data: [] });
        if (--pending === 0) { this.spritesReady = true; this.layoutSprites(); }
      }, undefined, () => { pending--; });
    }
  }

  private layoutSprites(): void {
    if (!this.sprites.length) return;
    let seed = 313;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const total = Math.max(8, Math.round(this.size / 8));
    for (const sp of this.sprites) sp.data = [];
    for (let i = 0; i < total; i++) {
      const sp = this.sprites[i % this.sprites.length];
      sp.data.push({ x: rnd() * this.size * 1.5 - this.size * 0.25, z: rnd() * this.size * 1.5 - this.size * 0.25, y: 30 + rnd() * 10, s: 14 + rnd() * 14, yaw: rnd() * Math.PI * 2, speed: 0.25 + rnd() * 0.25 });
    }
    // the low-poly puffs thin out once photo clouds exist
    this.clouds.count = Math.floor(this.cloudData.length * 0.3);
  }

  /** Lay out a cloud field over a map of the given size. */
  setMapSize(size: number): void {
    this.size = size;
    this.cloudData = [];
    let seed = 91;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const groups = Math.max(6, Math.round(size / 10));
    for (let g = 0; g < groups; g++) {
      const bx = rnd() * size * 1.4 - size * 0.2, bz = rnd() * size * 1.4 - size * 0.2, y = 24 + rnd() * 10;
      const speed = 0.35 + rnd() * 0.3;
      const parts = 3 + Math.floor(rnd() * 3);
      for (let p = 0; p < parts && this.cloudData.length < 72; p++) {
        this.cloudData.push({
          x: bx + (rnd() - 0.5) * 7, z: bz + (rnd() - 0.5) * 3.5, y: y + (rnd() - 0.5) * 1.2,
          sx: 2.6 + rnd() * 2.4, sy: 0.9 + rnd() * 0.5, sz: 1.5 + rnd() * 1.4, speed,
        });
      }
    }
    this.clouds.count = this.cloudData.length;
    if (this.spritesReady) this.layoutSprites();
  }

  setSources(sources: SmokeSource[]): void {
    this.sources = sources.slice(0, Math.floor(this.maxPuffs / 3));
  }

  update(time: number, dt: number, day: number, sky: THREE.Color): void {
    const d = this.d, c = this.c;
    const span = this.size * 1.6;
    // clouds slide along +x and wrap around the map; they dim at night and fade away in the evening
    const tint = 0.25 + 0.75 * day;
    (this.clouds.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.1 + 0.25 * day;
    for (let i = 0; i < this.cloudData.length; i++) {
      const k = this.cloudData[i];
      k.x += k.speed * dt;
      if (k.x > this.size * 1.2) k.x -= span;
      d.position.set(k.x, k.y, k.z);
      d.scale.set(k.sx, k.sy, k.sz);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      this.clouds.setMatrixAt(i, d.matrix);
      this.clouds.setColorAt(i, c.setScalar(tint));
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    if (this.clouds.instanceColor) this.clouds.instanceColor.needsUpdate = true;
    for (const sp of this.sprites) {
      sp.mat.color.setScalar(0.18 + 0.82 * day);
      sp.mesh.count = sp.data.length;
      for (let i = 0; i < sp.data.length; i++) {
        const k = sp.data[i];
        k.x += k.speed * dt;
        if (k.x > this.size * 1.3) k.x -= span;
        d.position.set(k.x, k.y, k.z);
        d.rotation.set(0, k.yaw, 0);
        d.scale.set(k.s, 1, k.s * 0.7);
        d.updateMatrix();
        sp.mesh.setMatrixAt(i, d.matrix);
      }
      sp.mesh.instanceMatrix.needsUpdate = true;
    }

    // smoke: each source sends three puffs that rise, widen and blend into the sky
    let n = 0;
    for (let s = 0; s < this.sources.length; s++) {
      const src = this.sources[s];
      for (let p = 0; p < 3; p++) {
        const age = (time * 0.32 + p / 3 + s * 0.173) % 1;
        const rise = age * (0.7 + src.strength * 0.4);
        d.position.set(src.x + age * 0.18 + Math.sin(age * 6 + s) * 0.03, src.y + rise, src.z + Math.cos(age * 5 + s) * 0.03);
        const sc = (0.05 + age * 0.17) * (0.8 + src.strength * 0.3);
        d.scale.setScalar(sc);
        d.rotation.set(age * 3, age * 2, 0);
        d.updateMatrix();
        this.smoke.setMatrixAt(n, d.matrix);
        // fresh smoke is dark grey, ageing smoke fades toward the sky colour
        c.setScalar(0.34 + 0.2 * day).lerp(sky, age * 0.75);
        this.smoke.setColorAt(n, c);
        n++;
      }
    }
    this.smoke.count = n;
    this.smoke.instanceMatrix.needsUpdate = true;
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
  }
}
