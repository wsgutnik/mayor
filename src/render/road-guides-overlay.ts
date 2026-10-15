import * as THREE from "three";
import type { Pt } from "../sim/world";
import type { RoadGuide } from "../ui/road-guides";

/** Guide ray extent in tiles; kept short enough to read as a construction aid. */
export const GUIDE_RAY_LENGTH = 6;
const LIFT = 0.18;
const MAX_VERTICES = 1800;

export interface RoadGuideOverlayInput {
  anchor: Pt;
  guides: readonly RoadGuide[];
  activeGuide: RoadGuide | null;
  cursor: Pt;
  snapKind: "node" | "segment" | "free";
  /** Direction of the preceding leg, when a chained road has one. */
  prevDir: number | null;
  /** Touch anchor remains visible even before a draft has a meaningful length. */
  anchorPending?: boolean;
  /** World-space snap radius, rendered as a faint touch affordance. */
  snapRadius?: number;
  /** Screen-offset draft endpoint, joined back to the finger's true world pick. */
  tether?: Pt | null;
}

/** Pure endpoint recipe, shared by the renderer tests. */
export function guideRayEndpoint(anchor: Pt, angle: number, length = GUIDE_RAY_LENGTH): Pt {
  return { x: anchor.x + Math.cos(angle) * length, z: anchor.z + Math.sin(angle) * length };
}

/** Points along the shortest signed angle from `from` to `to`, including both ends. */
export function guideArcPoints(anchor: Pt, from: number, to: number, radius = 1.05, steps = 12): Pt[] {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + delta * (i / steps);
    out.push({ x: anchor.x + Math.cos(a) * radius, z: anchor.z + Math.sin(a) * radius });
  }
  return out;
}

/**
 * One dynamic LineSegments draw call for all road-construction guides.  The
 * backing stores are allocated once; pointer updates only overwrite a prefix.
 */
export class GuideOverlay {
  readonly lines: THREE.LineSegments;
  private readonly pos = new Float32Array(MAX_VERTICES * 3);
  private readonly color = new Float32Array(MAX_VERTICES * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private count = 0;

  constructor(private readonly groundY: (x: number, z: number) => number) {
    const p = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    const c = new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", p);
    this.geometry.setAttribute("color", c);
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.94, depthTest: false, depthWrite: false });
    this.lines = new THREE.LineSegments(this.geometry, material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 24;
    this.lines.visible = false;
  }

  clear(): void {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
    this.lines.visible = false;
  }

  update(input: RoadGuideOverlayInput | null): void {
    this.count = 0;
    if (!input) { this.clear(); return; }
    const { anchor, guides, activeGuide, cursor, snapKind, prevDir } = input;
    // Road-kit cyan is legible against grass, asphalt and water; active is near-white.
    for (const guide of guides) {
      const active = guide === activeGuide || (!!activeGuide && Math.abs(guide.angle - activeGuide.angle) < 1e-7);
      const cr = active ? 0.95 : 0.20, cg = active ? 0.98 : 0.78, cb = active ? 1.0 : 0.95;
      for (let d = 0; d < GUIDE_RAY_LENGTH; d += 0.58) {
        const e = Math.min(GUIDE_RAY_LENGTH, d + 0.32);
        this.segment(anchor.x + Math.cos(guide.angle) * d, anchor.z + Math.sin(guide.angle) * d,
          anchor.x + Math.cos(guide.angle) * e, anchor.z + Math.sin(guide.angle) * e, cr, cg, cb);
      }
    }
    // The relative turn arc is deliberately short, avoiding a stray arc across a junction.
    if (prevDir !== null) {
      const next = Math.atan2(cursor.z - anchor.z, cursor.x - anchor.x);
      const d = Math.atan2(Math.sin(next - prevDir), Math.cos(next - prevDir));
      const steps = 12;
      let px = anchor.x + Math.cos(prevDir) * 1.05, pz = anchor.z + Math.sin(prevDir) * 1.05;
      for (let i = 1; i <= steps; i++) {
        const a = prevDir + d * (i / steps), x = anchor.x + Math.cos(a) * 1.05, z = anchor.z + Math.sin(a) * 1.05;
        this.segment(px, pz, x, z, 1.0, 0.78, 0.24); px = x; pz = z;
      }
    }
    // Attach marker: white for node, blue for a T on a segment, muted cursor cross otherwise.
    const mr = snapKind === "node" ? 1 : snapKind === "segment" ? 0.25 : 0.65;
    const mg = snapKind === "node" ? 1 : snapKind === "segment" ? 0.75 : 0.85;
    const mb = snapKind === "node" ? 1 : snapKind === "segment" ? 1 : 0.95;
    const s = 0.22;
    this.segment(cursor.x - s, cursor.z, cursor.x + s, cursor.z, mr, mg, mb);
    this.segment(cursor.x, cursor.z - s, cursor.x, cursor.z + s, mr, mg, mb);
    if (input.anchorPending) {
      // 12 chords are visually round while staying safely inside the preallocated store.
      const r = input.snapRadius ?? 0.5;
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI * 2 / 12, b = (i + 1) * Math.PI * 2 / 12;
        this.segment(anchor.x + Math.cos(a) * r, anchor.z + Math.sin(a) * r,
          anchor.x + Math.cos(b) * r, anchor.z + Math.sin(b) * r, .72, .86, 1);
      }
      const q = .3;
      this.segment(anchor.x - q, anchor.z, anchor.x + q, anchor.z, 1, 1, 1);
      this.segment(anchor.x, anchor.z - q, anchor.x, anchor.z + q, 1, 1, 1);
    }
    if (input.tether) this.segment(cursor.x, cursor.z, input.tether.x, input.tether.z, .75, .88, 1);
    // Direction chevrons make the pending carriageway's intended travel explicit.
    const dx = cursor.x - anchor.x, dz = cursor.z - anchor.z, len = Math.hypot(dx, dz);
    if (len > 0.7) {
      const tx = dx / len, tz = dz / len, nx = -tz, nz = tx;
      for (let d = 1.15; d < len - 0.3; d += 1.35) {
        const x = anchor.x + tx * d, z = anchor.z + tz * d;
        this.segment(x - tx * .18 + nx * .13, z - tz * .18 + nz * .13, x, z, .95, .98, 1);
        this.segment(x - tx * .18 - nx * .13, z - tz * .18 - nz * .13, x, z, .95, .98, 1);
      }
    }
    const p = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const c = this.geometry.getAttribute("color") as THREE.BufferAttribute;
    p.addUpdateRange(0, this.count * 3); c.addUpdateRange(0, this.count * 3);
    p.needsUpdate = true; c.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count);
    this.lines.visible = this.count > 0;
  }

  private segment(ax: number, az: number, bx: number, bz: number, r: number, g: number, b: number): void {
    if (this.count + 2 > MAX_VERTICES) return;
    this.vertex(ax, az, r, g, b); this.vertex(bx, bz, r, g, b);
  }

  private vertex(x: number, z: number, r: number, g: number, b: number): void {
    const i = this.count++ * 3;
    this.pos[i] = x; this.pos[i + 1] = Math.max(this.groundY(x, z), 0.12) + LIFT; this.pos[i + 2] = z;
    this.color[i] = r; this.color[i + 1] = g; this.color[i + 2] = b;
  }
}
