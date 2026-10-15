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
  private size = 96;
  constructor(scene: THREE.Scene) {
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
    this.makeBanks(scene);
  }

  /** Volumetric cloud banks: soft shaded puffs (see makeCloudBanks), three drift layers, one draw call each. */
  private banks: { points: THREE.Points; speed: number; wrap: number }[] = [];
  private bankMat?: THREE.ShaderMaterial;
  private bankLayout: { speed: number; n: number }[] = [];


  /** Soft cloud puff alpha map: radial falloff broken up by fractal noise (canvas, 128 px, no asset). */
  private puffTexture(): THREE.Texture | null {
    if (typeof document === "undefined") return null;
    const n = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = n;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(n, n);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const g = 9, grid = new Float32Array((g + 1) * (g + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    const val = (x: number, y: number, f: number) => {
      const gx = (x * f) % g, gy = (y * f) % g, x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = grid[y0 * (g + 1) + x0], b = grid[y0 * (g + 1) + x0 + 1], c = grid[(y0 + 1) * (g + 1) + x0], d = grid[(y0 + 1) * (g + 1) + x0 + 1];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const u = x / n, v = y / n, dx = u - 0.5, dy = v - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const noise = 0.55 * val(u, v, 2) + 0.3 * val(u, v, 4) + 0.15 * val(u, v, 8);
        let a = Math.max(0, 1 - r) * (0.55 + 0.9 * noise);
        a = Math.min(1, a * 1.6);
        a = a * a * (3 - 2 * a);
        const i = (y * n + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Cumulus banks: each cloud is ~24 overlapping soft puffs in a flattened-bottom ellipsoid, lit from above
   * (white crown, blue-grey base), drawn as point sprites with per-puff size. Three layers drift at three speeds.
   */
  private makeBanks(scene: THREE.Scene): void {
    const tex = this.puffTexture();
    if (!tex) return; // headless: low-poly blobs remain
    this.bankMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uViewH: { value: 800 }, uTint: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0.9 } },
      transparent: true, depthWrite: false,
      vertexShader: `
        attribute float aSize; attribute vec3 aColor; varying vec3 vColor;
        uniform float uViewH;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * projectionMatrix[1][1] * uViewH * 0.5 / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; uniform vec3 uTint; uniform float uOpacity; varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor * uTint, t.a * uOpacity);
        }`,
    });
    const layers = [{ speed: 0.18, n: 7 }, { speed: 0.3, n: 7 }, { speed: 0.45, n: 6 }];
    this.bankLayout = layers.map((l) => ({ ...l }));
    for (let li = 0; li < layers.length; li++) {
      const geo = new THREE.BufferGeometry();
      const pts = new THREE.Points(geo, this.bankMat);
      pts.frustumCulled = false;
      pts.renderOrder = 4;
      scene.add(pts);
      this.banks.push({ points: pts, speed: layers[li].speed, wrap: 0 });
    }
  }

  private layoutBanks(): void {
    if (!this.bankMat) return;
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
    const span = this.size * 1.6;
    for (let li = 0; li < this.banks.length; li++) {
      const bank = this.banks[li];
      const clouds = Math.max(3, Math.round((this.bankLayout[li].n * this.size) / 96));
      const per = 44;
      const pos = new Float32Array(clouds * per * 3), size = new Float32Array(clouds * per), col = new Float32Array(clouds * per * 3);
      let k = 0;
      for (let c = 0; c < clouds; c++) {
        const cx = rnd() * span - span * 0.3, cz = rnd() * this.size * 1.4 - this.size * 0.2, cy = 26 + li * 4 + rnd() * 8;
        const w = 5 + rnd() * 7, d = 3 + rnd() * 4, h = 1.8 + rnd() * 2.4;
        for (let p = 0; p < per; p++) {
          const gx = gauss(), gz = gauss(), gy = Math.abs(gauss());
          // taller toward the middle: a cumulus dome on a flat base
          const dome = 1 - Math.min(1, (gx * gx + gz * gz) * 0.8);
          const y = gy * h * (0.4 + dome);
          pos[k * 3] = cx + gx * w; pos[k * 3 + 1] = cy + y - h * 0.3; pos[k * 3 + 2] = cz + gz * d;
          size[k] = (2.2 + rnd() * 3.0) * (0.7 + 0.6 * dome);
          const lit = Math.min(1, 0.62 + (y / (h * 1.4)) * 0.5 + rnd() * 0.06);
          col[k * 3] = 0.78 + 0.28 * lit; col[k * 3 + 1] = 0.82 + 0.22 * lit; col[k * 3 + 2] = 0.92 + 0.12 * lit;
          k++;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
      geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
      bank.points.geometry.dispose();
      bank.points.geometry = geo;
      bank.wrap = span;
      bank.points.position.x = 0;
    }
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
    this.clouds.count = this.bankMat ? 0 : this.cloudData.length;
    this.layoutBanks();
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
    if (this.bankMat) {
      const u = this.bankMat.uniforms;
      u.uViewH.value = (typeof window !== "undefined" ? window.innerHeight * Math.min(window.devicePixelRatio || 1, 2) : 800);
      (u.uTint.value as THREE.Color).setScalar(0.2 + 0.8 * day);
      u.uOpacity.value = 0.45 + 0.35 * day;
      for (const b of this.banks) {
        b.points.position.x += b.speed * dt;
        if (b.points.position.x > b.wrap * 0.5) b.points.position.x -= b.wrap;
      }
    }
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
