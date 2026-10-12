import * as THREE from "three";
import { World, curvePoints, idx, inBounds } from "../sim/world";
import { NET, NetKind, facilityLinks } from "../sim/networks";

/** Draw style per utility net: schematic colours shared with the infoviews. */
export interface NetStyle {
  color: string;
  /** Sideways offset from the road centreline, so the three runs sit side by side. */
  lateral: number;
  /** How far below the ground the run sits. */
  depth: number;
  halfWidth: number;
}

export const NET_STYLE: Record<NetKind, NetStyle> = {
  water: { color: "#2ea8e8", lateral: -0.16, depth: 0.22, halfWidth: 0.075 },
  sewage: { color: "#a07848", lateral: 0, depth: 0.34, halfWidth: 0.095 },
  power: { color: "#f2c230", lateral: 0.16, depth: 0.16, halfWidth: 0.05 },
};

const NET_BIT: Record<NetKind, number> = { water: NET.WATER, sewage: NET.SEWAGE, power: NET.POWER };
const KIND_ORDER: NetKind[] = ["water", "sewage", "power"];

export type GroundY = (x: number, z: number) => number;

/** One merged ribbon soup; water additionally carries arclength for the flow dashes. */
class Ribbons {
  pos: number[] = [];
  col: number[] = [];
  dist: number[] = [];
  ind: number[] = [];
  private palette = new Map<string, THREE.Color>();

  vert(x: number, y: number, z: number, color: string, d: number): number {
    let c = this.palette.get(color);
    if (!c) {
      c = new THREE.Color(color);
      this.palette.set(color, c);
    }
    const vi = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    this.dist.push(d);
    return vi;
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.ind.push(a, b, c, a, c, d);
  }

  build(withDist: boolean): THREE.BufferGeometry {
    // No normals: both pipe materials are unlit, so computeVertexNormals would be pure overhead.
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    if (withDist) g.setAttribute("aDist", new THREE.Float32BufferAttribute(this.dist, 1));
    g.setIndex(this.ind);
    return g;
  }

  get empty(): boolean {
    return this.ind.length === 0;
  }
}

/** Flat band along a polyline, hugging the terrain at a fixed depth. */
function strip(
  r: Ribbons, pts: { x: number; z: number }[], style: NetStyle, groundY: GroundY, solid: boolean,
): void {
  if (pts.length < 2) return;
  let run: number[] | null = null;
  let d = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[Math.min(pts.length - 1, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    let dx = q.x - o.x, dz = q.z - o.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    if (i > 0) d += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const nx = -dz, nz = dx;
    const cx = p.x + nx * style.lateral, cz = p.z + nz * style.lateral;
    // One height sample per station: the band is at most 0.2 wide, so the
    // ground barely moves across it.
    const gy = groundY(cx, cz) - style.depth;
    const v0 = r.vert(
      cx + nx * style.halfWidth, gy, cz + nz * style.halfWidth, style.color, solid ? -1 : d,
    );
    const v1 = r.vert(
      cx - nx * style.halfWidth, gy, cz - nz * style.halfWidth, style.color, solid ? -1 : d,
    );
    if (run) r.quad(run[0], run[1], v0, v1);
    run = [v0, v1];
  }
}

/** Pipes along every live stretch of road centreline, plus facility stubs. */
function buildRibbons(w: World, groundY: GroundY): { water: Ribbons; util: Ribbons } {
  const water = new Ribbons();
  const util = new Ribbons();
  for (const seg of w.segments) {
    const a = seg.pts[0], b = seg.pts[seg.pts.length - 1];
    const pad = seg.pts.length === 2 && Math.hypot(b.x - a.x, b.z - a.z) < 1e-6;
    // Sampled once per segment: each net then filters the same centreline. Step 1
    // still lands a sample in every tile, so dry stretches keep showing no pipe.
    const samples = pad ? [] : curvePoints(seg.pts, 1);
    const flags = samples.map((p) => {
      const tx = Math.floor(p.x), tz = Math.floor(p.z);
      return inBounds(w, tx, tz) ? w.nets[idx(w, tx, tz)] : 0;
    });
    for (const kind of KIND_ORDER) {
      const style = NET_STYLE[kind];
      const bit = NET_BIT[kind];
      const target = kind === "water" ? water : util;
      if (pad) {
        // A lone painted tile: a solid patch, so it never shimmers against a segment run.
        const t = seg.tiles[0];
        if (t === undefined || !(w.nets[t] & bit)) continue;
        const cx = (t % w.size) + 0.5, cz = ((t / w.size) | 0) + 0.5;
        const s = 0.3;
        strip(target, [{ x: cx - s, z: cz }, { x: cx + s, z: cz }], style, groundY, true);
        continue;
      }
      // Quads only where both ends sit on a live tile: dry stretches show no pipe.
      let run: { x: number; z: number }[] = [];
      const flush = () => {
        if (run.length >= 2) strip(target, run, style, groundY, false);
        run = [];
      };
      for (let i = 0; i < samples.length; i++) {
        if (flags[i] & bit) run.push(samples[i]);
        else flush();
      }
      flush();
    }
  }
  for (const link of facilityLinks(w)) {
    if (!(w.nets[link.entry] & NET_BIT[link.net])) continue; // dead entry, no stub
    const style = NET_STYLE[link.net];
    const target = link.net === "water" ? water : util;
    const fx = (link.facility % w.size) + 0.5, fz = ((link.facility / w.size) | 0) + 0.5;
    const ex = (link.entry % w.size) + 0.5, ez = ((link.entry / w.size) | 0) + 0.5;
    const n = Math.max(1, Math.ceil(Math.hypot(ex - fx, ez - fz) / 0.5));
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i <= n; i++) pts.push({ x: fx + ((ex - fx) * i) / n, z: fz + ((ez - fz) * i) / n });
    strip(target, pts, style, groundY, false);
  }
  return { water, util };
}

export interface ValveSpot {
  x: number;
  y: number;
  z: number;
  kind: NetKind;
}

/** One valve per live net at every junction, plus one where each facility stub lands. */
export function valveSpots(w: World, groundY: GroundY): ValveSpot[] {
  const out: ValveSpot[] = [];
  const liveNear = (x: number, z: number, bit: number): boolean => {
    const tx = Math.floor(x), tz = Math.floor(z);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx, nz = tz + dy;
        if (inBounds(w, nx, nz) && (w.nets[idx(w, nx, nz)] & bit)) return true;
      }
    }
    return false;
  };
  for (const node of w.nodes) {
    for (const kind of KIND_ORDER) {
      if (!liveNear(node.x, node.z, NET_BIT[kind])) continue;
      out.push({ x: node.x, y: groundY(node.x, node.z) - NET_STYLE[kind].depth + 0.02, z: node.z, kind });
    }
  }
  for (const link of facilityLinks(w)) {
    if (!(w.nets[link.entry] & NET_BIT[link.net])) continue;
    const ex = (link.entry % w.size) + 0.5, ez = ((link.entry / w.size) | 0) + 0.5;
    out.push({ x: ex, y: groundY(ex, ez) - NET_STYLE[link.net].depth + 0.02, z: ez, kind: link.net });
  }
  return out;
}

/**
 * The underground layer: merged pipe ribbons along the road centrelines
 * (water with marching flow dashes), instanced valves at the junctions and
 * a dark soil plane behind it all. Rebuilt on demand, animated by one uniform.
 */
export class UndergroundView {
  private soil: THREE.Mesh;
  private waterMesh: THREE.Mesh;
  private utilMesh: THREE.Mesh;
  private valveMesh: THREE.InstancedMesh;
  private waterTime = { value: 0 };
  private soilSize = -1;
  private dummy = new THREE.Object3D();
  /** Every object this view owns, for shadow flags and visibility. */
  readonly objects: THREE.Object3D[] = [];

  constructor(private scene: THREE.Scene) {
    const none = new THREE.BufferGeometry();
    this.waterMesh = new THREE.Mesh(none, new THREE.ShaderMaterial({
      uniforms: { uTime: this.waterTime },
      vertexShader: `
        attribute float aDist;
        varying float vDist;
        void main() {
          vDist = aDist;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        varying float vDist;
        void main() {
          if (vDist < -0.5) {
            gl_FragColor = vec4(0.18, 0.66, 0.91, 1.0);
            return;
          }
          float dash = step(0.5, fract(vDist * 0.9 - uTime * 1.2));
          gl_FragColor = vec4(mix(vec3(0.10, 0.42, 0.68), vec3(0.45, 0.85, 1.0), dash), 1.0);
        }`,
    }));
    this.utilMesh = new THREE.Mesh(
      none, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    );
    this.soil = new THREE.Mesh(
      none, new THREE.MeshBasicMaterial({ color: "#161c28", toneMapped: false }),
    );
    this.valveMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.13, 0.15, 0.08, 10),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      256,
    );
    this.valveMesh.count = 0;
    for (const o of [this.soil, this.waterMesh, this.utilMesh, this.valveMesh]) {
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
      o.visible = false;
      this.scene.add(o);
      this.objects.push(o);
    }
  }

  get visible(): boolean {
    return this.waterMesh.visible;
  }

  setVisible(v: boolean): void {
    for (const o of this.objects) o.visible = v;
  }

  /** March the water dashes. No allocation; call every frame while visible. */
  update(timeSec: number): void {
    this.waterTime.value = timeSec;
  }

  rebuild(w: World, groundY: GroundY): void {
    const { water, util } = buildRibbons(w, groundY);
    this.waterMesh.geometry.dispose();
    this.waterMesh.geometry = water.empty ? new THREE.BufferGeometry() : water.build(true);
    this.utilMesh.geometry.dispose();
    this.utilMesh.geometry = util.empty ? new THREE.BufferGeometry() : util.build(false);
    if (w.size !== this.soilSize) {
      this.soilSize = w.size;
      this.soil.geometry.dispose();
      const g = new THREE.PlaneGeometry(w.size, w.size);
      g.rotateX(-Math.PI / 2);
      g.translate(w.size / 2, -2.2, w.size / 2);
      this.soil.geometry = g;
    }
    const spots = valveSpots(w, groundY);
    if (spots.length > this.valveMesh.instanceMatrix.count) {
      const grown = new THREE.InstancedMesh(
        this.valveMesh.geometry, this.valveMesh.material, Math.max(256, spots.length),
      );
      grown.frustumCulled = false;
      grown.castShadow = false;
      grown.receiveShadow = false;
      grown.visible = this.visible;
      const old = this.valveMesh;
      this.scene.remove(old);
      old.dispose();
      this.objects[this.objects.indexOf(old)] = grown;
      this.valveMesh = grown;
      this.scene.add(grown);
    }
    const tint = new THREE.Color();
    spots.forEach((s, i) => {
      this.dummy.position.set(s.x, s.y, s.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.valveMesh.setMatrixAt(i, this.dummy.matrix);
      this.valveMesh.setColorAt(i, tint.set(NET_STYLE[s.kind].color));
    });
    this.valveMesh.count = spots.length;
    this.valveMesh.instanceMatrix.needsUpdate = true;
    if (this.valveMesh.instanceColor) this.valveMesh.instanceColor.needsUpdate = true;
  }
}
