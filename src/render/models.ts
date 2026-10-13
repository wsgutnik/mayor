import * as THREE from "three";
import { FAC, FacilityKind, ZONE } from "../sim/world";
import { zoneEntries } from "../sim/catalog";
import { KIT_MAKERS, KIT_FACILITY_MAKERS } from "./kit-models";

/** One part list per material group: group 0 shows windows, group 1 is plain colour. */
interface Buf { pos: number[]; nrm: number[]; uv: number[]; col: number[]; idx: number[] }
const newBuf = (): Buf => ({ pos: [], nrm: [], uv: [], col: [], idx: [] });

const CELL_W = 0.17;
const CELL_H = 0.19;

/** Builds one merged low-poly model; tile-sized, base at y = 0, front facing +z. */
export class Builder {
  private win = newBuf();
  private plain = newBuf();
  private c = new THREE.Color();

  private quad(b: Buf, p: THREE.Vector3[], n: THREE.Vector3, color: string, uv: number[][]): void {
    this.c.set(color);
    const base = b.pos.length / 3;
    p.forEach((v, i) => {
      b.pos.push(v.x, v.y, v.z);
      b.nrm.push(n.x, n.y, n.z);
      b.col.push(this.c.r, this.c.g, this.c.b);
      b.uv.push(uv[i][0], uv[i][1]);
    });
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  private tri(b: Buf, p: THREE.Vector3[], color: string): void {
    this.c.set(color);
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize();
    const base = b.pos.length / 3;
    p.forEach((v) => {
      b.pos.push(v.x, v.y, v.z);
      b.nrm.push(n.x, n.y, n.z);
      b.col.push(this.c.r, this.c.g, this.c.b);
      b.uv.push(0.5, 0.5);
    });
    b.idx.push(base, base + 1, base + 2);
  }

  /** Axis-aligned box with its centre at (x, z), base at y0. Side faces get windows when asked. */
  box(x: number, z: number, y0: number, w: number, d: number, h: number, color: string, windows = false, roof?: string): this {
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y0 + h;
    const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c);
    const sideBuf = windows ? this.win : this.plain;
    const nu = (len: number) => Math.max(1, Math.round(len / CELL_W));
    const nv = Math.max(1, Math.round(h / CELL_H));
    const full = (len: number) => [[0, 0], [nu(len), 0], [nu(len), nv], [0, nv]];
    // front (+z), back (-z), right (+x), left (-x)
    this.quad(sideBuf, [V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)], V(0, 0, 1), color, full(w));
    this.quad(sideBuf, [V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0)], V(0, 0, -1), color, full(w));
    this.quad(sideBuf, [V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1)], V(1, 0, 0), color, full(d));
    this.quad(sideBuf, [V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0)], V(-1, 0, 0), color, full(d));
    this.quad(this.plain, [V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0)], V(0, 1, 0), roof ?? color, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    return this;
  }

  /** Four-sided pyramid roof sitting on a w×d footprint at y0. */
  pyramid(x: number, z: number, y0: number, w: number, d: number, h: number, color: string): this {
    const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c);
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    const top = V(x, y0 + h, z);
    this.tri(this.plain, [V(x0, y0, z1), V(x1, y0, z1), top], color);
    this.tri(this.plain, [V(x1, y0, z1), V(x1, y0, z0), top], color);
    this.tri(this.plain, [V(x1, y0, z0), V(x0, y0, z0), top], color);
    this.tri(this.plain, [V(x0, y0, z0), V(x0, y0, z1), top], color);
    return this;
  }

  /** Gabled roof: ridge runs along z, so the long slopes face left and right. */
  gable(x: number, z: number, y0: number, w: number, d: number, h: number, color: string, end?: string): this {
    const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c);
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, yr = y0 + h;
    const rn = new THREE.Vector3(1, w / (2 * h), 0).normalize();
    const ln = new THREE.Vector3(-1, w / (2 * h), 0).normalize();
    this.quad(this.plain, [V(x1, y0, z1), V(x1, y0, z0), V(x, yr, z0), V(x, yr, z1)], rn, color, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.quad(this.plain, [V(x0, y0, z0), V(x0, y0, z1), V(x, yr, z1), V(x, yr, z0)], ln, color, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.tri(this.plain, [V(x0, y0, z1), V(x1, y0, z1), V(x, yr, z1)], end ?? color);
    this.tri(this.plain, [V(x1, y0, z0), V(x0, y0, z0), V(x, yr, z0)], end ?? color);
    return this;
  }

  /** Vertical cylinder (chimney, tank, silo). */
  cyl(x: number, z: number, y0: number, r: number, h: number, color: string, seg = 8, rTop = r): this {
    const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const n = V(Math.cos(am), 0, Math.sin(am));
      const p = [
        V(x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r), V(x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r),
        V(x + Math.cos(a1) * rTop, y0 + h, z + Math.sin(a1) * rTop), V(x + Math.cos(a0) * rTop, y0 + h, z + Math.sin(a0) * rTop),
      ];
      this.quad(this.plain, [p[1], p[0], p[3], p[2]], n, color, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      this.tri(this.plain, [V(x, y0 + h, z), V(x + Math.cos(a1) * rTop, y0 + h, z + Math.sin(a1) * rTop), V(x + Math.cos(a0) * rTop, y0 + h, z + Math.sin(a0) * rTop)], color);
    }
    return this;
  }

  /** Low cone, used for mounds and trees. */
  cone(x: number, z: number, y0: number, r: number, h: number, color: string, seg = 7): this {
    return this.cyl(x, z, y0, r, h, color, seg, 0.001);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
    const groups: { start: number; count: number; materialIndex: number }[] = [];
    for (const [gi, b] of [this.win, this.plain].entries()) {
      const off = pos.length / 3;
      const start = idx.length;
      pos.push(...b.pos); nrm.push(...b.nrm); uv.push(...b.uv); col.push(...b.col);
      for (const i of b.idx) idx.push(i + off);
      groups.push({ start, count: idx.length - start, materialIndex: gi });
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    for (const gr of groups) if (gr.count > 0) g.addGroup(gr.start, gr.count, gr.materialIndex);
    return g;
  }
}

// ------------------------------------------------------------ building models

export type Maker = (b: Builder) => void;

const RES_WALL = ["#efe6d6", "#e6d4b4"];
const RES_ROOF = ["#c4553f", "#b9694b", "#5f6e86"];

const RES: Record<number, Maker[]> = {
  1: [
    (b) => b.box(0, 0.02, 0, 0.44, 0.38, 0.3, RES_WALL[0], true, "#d8cdbb").gable(0, 0.02, 0.3, 0.44, 0.38, 0.2, RES_ROOF[0], RES_WALL[0])
      .box(0.1, -0.08, 0.3, 0.07, 0.07, 0.3, "#8a4b3a").box(-0.33, 0.12, 0, 0.2, 0.26, 0.2, "#d9d2c4", false, "#b9b2a4"),
    (b) => b.box(-0.08, 0, 0, 0.4, 0.34, 0.28, RES_WALL[1], true, "#cdbf9f").pyramid(-0.08, 0, 0.28, 0.4, 0.34, 0.2, RES_ROOF[2])
      .box(0.24, 0.1, 0, 0.2, 0.2, 0.2, RES_WALL[0], true, "#d8cdbb").pyramid(0.24, 0.1, 0.2, 0.2, 0.2, 0.14, RES_ROOF[1]),
  ],
  2: [
    (b) => {
      for (const [i, roof] of [RES_ROOF[0], RES_ROOF[1], RES_ROOF[0]].entries()) {
        const x = -0.26 + i * 0.26;
        b.box(x, 0, 0, 0.22, 0.46, 0.38, RES_WALL[i % 2], true, "#d6cbb7").gable(x, 0, 0.38, 0.22, 0.46, 0.18, roof, RES_WALL[i % 2]);
      }
    },
    (b) => b.box(0, 0, 0, 0.6, 0.46, 0.55, RES_WALL[0], true, "#d6cbb7").gable(0, 0, 0.55, 0.6, 0.46, 0.2, RES_ROOF[2], RES_WALL[0])
      .box(0.12, 0.26, 0.45, 0.14, 0.1, 0.18, RES_WALL[1], true).box(-0.35, 0.2, 0, 0.14, 0.14, 0.2, "#d9d2c4"),
  ],
  3: [
    (b) => b.box(0, 0, 0, 0.62, 0.5, 1.35, "#cfd6e0", true, "#a7b0bd").box(0.14, -0.08, 1.35, 0.2, 0.2, 0.16, "#8d97a6")
      .box(0, 0, 1.35, 0.62, 0.5, 0.03, "#8d97a6"),
    (b) => b.box(0, 0, 0, 0.74, 0.52, 0.2, "#c3ccd8", false, "#aab4c2").box(-0.2, 0, 0.2, 0.3, 0.34, 1.4, "#d6dce6", true, "#a7b0bd")
      .box(0.22, 0.02, 0.2, 0.28, 0.3, 1.0, "#c9d1dd", true, "#a7b0bd"),
  ],
};

const COM: Record<number, Maker[]> = {
  1: [
    (b) => b.box(0, 0, 0, 0.72, 0.56, 0.38, "#8fb8dc", true, "#cfd8e3").box(0, 0.34, 0.2, 0.72, 0.16, 0.04, "#e0603a")
      .box(-0.2, 0, 0.38, 0.22, 0.1, 0.1, "#cfd8e3"),
    (b) => b.box(0, 0, 0, 0.66, 0.5, 0.34, "#e8e1d2", true, "#cfc7b6").gable(0, 0, 0.34, 0.66, 0.5, 0.14, "#4f8f78", "#e8e1d2")
      .box(0, 0.3, 0.17, 0.66, 0.14, 0.04, "#2f8f6a"),
  ],
  2: [
    (b) => b.box(0, 0, 0, 0.58, 0.5, 0.95, "#6ea4d8", true, "#bcc7d6").box(0.04, 0, 0.95, 0.38, 0.34, 0.28, "#5f93c8", true, "#bcc7d6")
      .box(-0.1, -0.05, 1.23, 0.12, 0.12, 0.1, "#9aa6b6"),
    (b) => b.box(0, -0.16, 0, 0.7, 0.26, 0.8, "#5fb3b3", true, "#bcc7d6").box(-0.18, 0.12, 0, 0.3, 0.46, 0.8, "#6ea4d8", true, "#bcc7d6")
      .box(0.2, 0.2, 0, 0.26, 0.3, 0.3, "#7fb0dc", true, "#bcc7d6"),
  ],
  3: [
    (b) => b.box(0, 0, 0, 0.78, 0.62, 0.12, "#cfd6df").box(-0.18, -0.12, 0.12, 0.28, 0.28, 1.9, "#5b94d0", true, "#c5ced9")
      .box(0.2, 0.1, 0.12, 0.3, 0.3, 1.35, "#6ea4d8", true, "#c5ced9").box(-0.15, 0.22, 0.12, 0.24, 0.26, 0.95, "#4f8fc8", true, "#c5ced9")
      .cyl(-0.18, -0.12, 2.02, 0.012, 0.3, "#cdd5de", 5),
    (b) => b.box(0, 0.12, 0, 0.74, 0.5, 0.16, "#cfd6df").box(0, -0.05, 0.16, 0.5, 0.46, 1.5, "#5b94d0", true, "#c5ced9")
      .box(0, -0.05, 1.66, 0.36, 0.34, 0.3, "#6ea4d8", true, "#c5ced9").box(0, -0.05, 1.96, 0.2, 0.2, 0.22, "#7fb0dc", true, "#c5ced9")
      .cyl(0, -0.05, 2.18, 0.012, 0.28, "#cdd5de", 5),
  ],
};

const IND: Record<number, Maker[]> = {
  1: [
    (b) => b.box(0, 0, 0, 0.72, 0.5, 0.28, "#b4b8a6", true, "#9ca08c").gable(0, 0, 0.28, 0.72, 0.5, 0.1, "#7c828a", "#b4b8a6")
      .box(0, 0.26, 0, 0.22, 0.04, 0.2, "#4a4f55"),
    (b) => b.box(-0.2, 0, 0, 0.3, 0.6, 0.26, "#a9aeb4", true, "#8f949a").gable(-0.2, 0, 0.26, 0.3, 0.6, 0.12, "#7c828a", "#a9aeb4")
      .box(0.2, 0, 0, 0.3, 0.6, 0.26, "#b4b8a6", true, "#9ca08c").gable(0.2, 0, 0.26, 0.3, 0.6, 0.12, "#6b7078", "#b4b8a6"),
  ],
  2: [
    (b) => b.box(-0.06, 0.04, 0, 0.6, 0.5, 0.42, "#b4b8a6", true, "#9ca08c").gable(-0.06, 0.04, 0.42, 0.6, 0.5, 0.1, "#7c828a", "#b4b8a6")
      .cyl(0.26, -0.18, 0, 0.065, 0.95, "#8a7568", 8, 0.05).cyl(0.26, -0.18, 0.95, 0.07, 0.05, "#3a3a3a", 8)
      .cyl(-0.3, 0.3, 0, 0.1, 0.3, "#aab3bd", 8),
    (b) => b.box(0, 0, 0, 0.7, 0.34, 0.4, "#a9aeb4", true, "#8f949a").box(0, 0.26, 0, 0.5, 0.2, 0.3, "#b4b8a6", true, "#9ca08c")
      .cyl(-0.26, -0.05, 0.4, 0.05, 0.7, "#8a7568", 8, 0.04).cyl(0.2, -0.3, 0, 0.09, 0.4, "#cfd3d6", 8),
  ],
  3: [
    (b) => b.box(-0.08, 0.06, 0, 0.56, 0.44, 0.5, "#a9aeb4", true, "#8f949a").box(0.2, 0.3, 0, 0.3, 0.2, 0.32, "#b4b8a6", true, "#9ca08c")
      .cyl(0.24, -0.26, 0, 0.065, 1.25, "#8a7568", 8, 0.05).cyl(0.06, -0.26, 0, 0.06, 1.0, "#8a7568", 8, 0.045)
      .cyl(-0.3, -0.3, 0, 0.13, 0.7, "#cfd3d6", 10).cyl(0.3, 0.32, 0, 0.1, 0.34, "#aab3bd", 8),
    (b) => b.box(0, 0, 0, 0.72, 0.5, 0.4, "#9fa6a8", true, "#8a9194").box(-0.22, 0, 0.4, 0.28, 0.4, 0.3, "#b4b8a6", true, "#9ca08c")
      .cyl(0.24, -0.2, 0.4, 0.06, 0.9, "#8a7568", 8, 0.045).cyl(0.06, -0.2, 0.4, 0.055, 0.7, "#8a7568", 8, 0.04)
      .cyl(0.28, 0.2, 0, 0.12, 0.6, "#cfd3d6", 10).box(0, 0.35, 0, 0.7, 0.06, 0.1, "#6b7078"),
  ],
};

const BY_ZONE: Record<number, Record<number, Maker[]>> = { [ZONE.RES]: RES, [ZONE.COM]: COM, [ZONE.IND]: IND };

// ------------------------------------------------------------ facility models

const FACILITY: Record<FacilityKind, Maker> = {
  [FAC.POWER]: (b) => b.box(-0.05, 0.05, 0, 0.56, 0.5, 0.34, "#c9ccd0", true, "#a8acb2").cyl(0.22, -0.2, 0, 0.07, 1.4, "#e8e3d4", 8, 0.055)
    .cyl(0.22, -0.2, 1.3, 0.075, 0.1, "#c4553f", 8).cyl(0.02, -0.25, 0, 0.06, 1.1, "#e8e3d4", 8, 0.05).cyl(0.02, -0.25, 1.02, 0.065, 0.08, "#c4553f", 8),
  [FAC.WATER]: (b) => b.cyl(0.05, -0.02, 0, 0.3, 0.55, "#58bfe8", 12).cone(0.05, -0.02, 0.55, 0.3, 0.14, "#b9d9ea", 12).box(-0.3, 0.3, 0, 0.26, 0.24, 0.24, "#cfd8e3", true, "#aab4c0"),
  [FAC.SEWAGE]: (b) => b.box(0, 0.18, 0, 0.7, 0.34, 0.14, "#a89078", false, "#8a7560").cyl(-0.18, -0.2, 0, 0.19, 0.12, "#8a6a4a", 12).cyl(0.2, -0.2, 0, 0.19, 0.12, "#7a5c40", 12)
    .cyl(0.28, 0.2, 0.14, 0.04, 0.2, "#6d6f73", 6),
  [FAC.LANDFILL]: (b) => b.cone(0, 0, 0, 0.44, 0.42, "#8a8478", 9).cone(-0.18, 0.15, 0, 0.22, 0.26, "#7a7468", 7).box(0.3, 0.3, 0, 0.22, 0.2, 0.18, "#4a6f8a", false, "#3d5d75"),
  [FAC.POLICE]: (b) => b.box(0, 0, 0, 0.6, 0.46, 0.4, "#e9edf4", true, "#c7ceda").box(0, 0.24, 0.3, 0.6, 0.06, 0.08, "#2f5fd0")
    .box(0, 0, 0.4, 0.62, 0.48, 0.05, "#2f5fd0").cyl(0.2, -0.1, 0.45, 0.04, 0.1, "#d04040", 6),
  [FAC.FIRE]: (b) => b.box(-0.05, 0.05, 0, 0.6, 0.46, 0.38, "#d9453a", true, "#b83a30").box(-0.05, 0.285, 0.05, 0.34, 0.04, 0.26, "#2f3238")
    .box(0.3, -0.2, 0, 0.15, 0.15, 0.85, "#e8e1d2", true, "#c7bfae").pyramid(0.3, -0.2, 0.85, 0.17, 0.17, 0.12, "#8a2a24"),
  [FAC.CLINIC]: (b) => b.box(0, 0, 0, 0.62, 0.46, 0.46, "#f4f6f9", true, "#d6dce6").box(0, 0, 0.46, 0.22, 0.05, 0.06, "#d63a3a", false)
    .box(0, 0, 0.46, 0.06, 0.05, 0.22, "#d63a3a").box(0.4, 0.3, 0, 0.14, 0.2, 0.18, "#cfd8e3"),
  [FAC.SCHOOL]: (b) => b.box(0, 0.05, 0, 0.74, 0.4, 0.36, "#f0a050", true, "#d68c40").gable(0, 0.05, 0.36, 0.74, 0.4, 0.12, "#a8553a", "#f0a050")
    .box(0, -0.18, 0.36, 0.16, 0.16, 0.34, "#f4e6c8", true).pyramid(0, -0.18, 0.7, 0.18, 0.18, 0.16, "#a8553a"),
  [FAC.PARK]: (b) => b.box(0, 0, 0, 0.92, 0.92, 0.04, "#6fbf6a", false, "#6fbf6a").cyl(-0.22, -0.2, 0.04, 0.025, 0.14, "#7a5a3a", 5)
    .cone(-0.22, -0.2, 0.16, 0.16, 0.38, "#2f8f4a", 7).cyl(0.24, 0.1, 0.04, 0.025, 0.12, "#7a5a3a", 5).cone(0.24, 0.1, 0.14, 0.14, 0.32, "#3a9a52", 7)
    .cyl(-0.05, 0.28, 0.04, 0.025, 0.1, "#7a5a3a", 5).cone(-0.05, 0.28, 0.12, 0.12, 0.28, "#2f8f4a", 7).box(0.2, -0.28, 0.04, 0.24, 0.07, 0.08, "#9a7448"),
  [FAC.HOSPITAL]: (b) => b.box(0, 0, 0, 0.7, 0.5, 0.5, "#f4f6f9", true, "#d6dce6").box(0, 0, 0.5, 0.26, 0.26, 0.3, "#e8eef5", true)
    .box(0, 0.26, 0.6, 0.2, 0.04, 0.06, "#d63a3a").box(0, 0.26, 0.6, 0.06, 0.04, 0.2, "#d63a3a"),
  [FAC.HIGHSCHOOL]: (b) => b.box(-0.1, 0, 0, 0.6, 0.42, 0.34, "#e8a070", true, "#c98860").box(0.26, -0.1, 0, 0.26, 0.4, 0.3, "#d98a55", true, "#c98860")
    .gable(-0.1, 0, 0.34, 0.6, 0.42, 0.1, "#8a4a3a", "#e8a070"),
  [FAC.LIBRARY]: (b) => b.box(0, 0, 0, 0.64, 0.5, 0.38, "#d98a55", true, "#c98860").box(0, 0.1, 0.38, 0.4, 0.3, 0.12, "#7fb0dc", true, "#9ab8d4"),
  [FAC.COMMUNITY]: (b) => b.box(0, 0, 0, 0.66, 0.46, 0.3, "#e6dccb", true, "#cfc3ae").box(0, 0.26, 0.08, 0.5, 0.14, 0.04, "#6a7280"),
  [FAC.MUSEUM]: (b) => b.box(0, 0, 0, 0.7, 0.5, 0.34, "#efe6d2", true, "#d6cbb0").pyramid(0, 0, 0.34, 0.5, 0.36, 0.16, "#8aa8c8")
    .cyl(-0.24, 0.26, 0, 0.04, 0.34, "#e8dfc8", 6).cyl(0.24, 0.26, 0, 0.04, 0.34, "#e8dfc8", 6),
  [FAC.CITYHALL]: (b) => b.box(0, 0, 0, 0.74, 0.46, 0.4, "#efe6d2", true, "#d6cbb0").gable(0, 0, 0.4, 0.74, 0.46, 0.12, "#4f5f86", "#efe6d2")
    .box(0, -0.1, 0.4, 0.2, 0.2, 0.3, "#efe6d2", true).pyramid(0, -0.1, 0.7, 0.22, 0.22, 0.18, "#4f5f86"),
  [FAC.SUBSTATION]: (b) => b.box(-0.2, 0.2, 0, 0.3, 0.26, 0.22, "#cfd3d6", true, "#aab3bd").box(0.14, -0.1, 0, 0.5, 0.4, 0.04, "#9a9a92")
    .box(0.0, -0.1, 0.04, 0.05, 0.05, 0.4, "#6b7078").box(0.28, -0.1, 0.04, 0.05, 0.05, 0.4, "#6b7078").box(0.14, -0.1, 0.44, 0.4, 0.04, 0.04, "#6b7078"),
  [FAC.METRO]: (b) => b.box(0, 0, 0, 0.56, 0.5, 0.3, "#8b6fe0", true, "#6f58c0").box(0, 0, 0.3, 0.7, 0.62, 0.05, "#e8e4f4")
    .box(0, 0.3, 0.05, 0.3, 0.06, 0.18, "#2f2840"),
};

export interface ModelSet {
  /** Key: `${zone}-${level}-${variant}`. */
  buildings: Map<string, THREE.BufferGeometry>;
  facilities: Map<FacilityKind, THREE.BufferGeometry>;
}

export function buildModels(): ModelSet {
  const buildings = new Map<string, THREE.BufferGeometry>();
  for (const zone of [ZONE.RES, ZONE.COM, ZONE.IND]) {
    for (const level of [1, 2, 3]) {
      const pool = BY_ZONE[zone][level];
      // One model per kit entry. Entries without a dedicated model reuse the generic pool for now.
      zoneEntries(zone, level).forEach((entry, i) => {
        const b = new Builder();
        (KIT_MAKERS[entry.n] ?? pool[i % pool.length])(b);
        buildings.set(`${zone}-${level}-${i}`, b.build());
      });
    }
  }
  const facilities = new Map<FacilityKind, THREE.BufferGeometry>();
  for (const [kind, make] of Object.entries(FACILITY)) {
    const b = new Builder();
    (KIT_FACILITY_MAKERS[Number(kind) as FacilityKind] ?? make)(b);
    facilities.set(Number(kind) as FacilityKind, b.build());
  }
  return { buildings, facilities };
}


/** Window texture: a framed pane sheet and the matching glow map. */
export function makeWindowTextures(anisotropy = 2): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const mk = (wall: string, pane: string) => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = wall;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "rgba(20,28,36,0.28)";
    g.fillRect(48, 44, 160, 168);
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillRect(54, 50, 148, 156);
    g.fillStyle = pane;
    g.fillRect(62, 58, 64, 140);
    g.fillStyle = pane === "#ffffff" ? "#e8f0ff" : "#506b90";
    g.fillRect(132, 58, 62, 140);
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.fillRect(74, 68, 16, 110);
    g.fillStyle = "rgba(55,45,30,0.32)";
    g.fillRect(42, 212, 172, 12);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: mk("#ffffff", "#3c5272"), glow: mk("#000000", "#ffffff") };
}
