// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): buildings/renderer.js Pool / BuildingRenderer.
import * as THREE from "three";
import { geometryFor, type ProcShape } from "./procgeo";
import { constructionParts, proceduralBuilding, type ProcPart } from "./procbuildings";
import { createFacadeMaterial } from "./facade-material";
import { bucketOrder } from "./lod";
import type { OrientedLot } from "../sim/zonecells";

type Mat = ProcPart["material"];
const SHAPES: ProcShape[] = ["box", "gable", "hip", "wedge"];
const MATS: Mat[] = ["wall", "roof", "glass", "metal"];
const CAPACITY = 4096;
export interface ProcPlacedLot extends OrientedLot { groundY: number }

/** Static instanced pools, one for each geometry/material pair (16 draw calls maximum). */
export class ProcBuildingsRenderer {
  readonly group = new THREE.Group();
  private pools = new Map<string, THREE.InstancedMesh>();
  private counts = new Map<string, number>();
  private dummy = new THREE.Object3D();
  private xs = new Float32Array(CAPACITY);
  private zs = new Float32Array(CAPACITY);
  constructor() {
    for (const shape of SHAPES) for (const mat of MATS) {
      const style = mat === "glass" ? "curtain" : mat === "metal" ? "industrial" : "retail";
      const mesh = new THREE.InstancedMesh(geometryFor(shape).geometry, createFacadeMaterial(style), CAPACITY);
      mesh.count = 0; mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.pools.set(`${shape}:${mat}`, mesh); this.group.add(mesh);
    }
  }
  rebuild(lots: readonly ProcPlacedLot[]): void {
    this.counts.clear();
    for (const lot of lots) {
      if (lot.w * lot.d < 4 || lot.level <= 0) continue;
      const building = proceduralBuilding(lot); if (!building) continue;
      const parts = (lot.build ?? 1) < 1 ? constructionParts(building, lot, lot.build ?? 0) : building.parts;
      for (const part of parts) this.add(lot, part);
    }
    for (const [key, mesh] of this.pools) { mesh.count = this.counts.get(key) ?? 0; mesh.instanceMatrix.needsUpdate = true; }
  }
  /** Camera-only detail ordering; all matrices live in preallocated mesh buffers. */
  update(cx: number, cz: number): void {
    let n = 0;
    for (const mesh of this.pools.values()) for (let i = 0; i < mesh.count && n < CAPACITY; i++, n++) { const a = mesh.instanceMatrix.array as Float32Array; this.xs[n] = a[i * 16 + 12]; this.zs[n] = a[i * 16 + 14]; }
    bucketOrder(this.xs, this.zs, n, cx, cz, 70); // pure ordering probe; static tier never reallocates.
  }
  poolCount(): number { return this.pools.size; }
  instanceCount(): number { let n = 0; for (const m of this.pools.values()) n += m.count; return n; }
  private add(lot: ProcPlacedLot, p: ProcPart): void {
    const key = `${p.shape}:${p.material}`, mesh = this.pools.get(key)!;
    const i = this.counts.get(key) ?? 0; if (i >= CAPACITY) return;
    const s = Math.sin(lot.yaw), c = Math.cos(lot.yaw);
    this.dummy.position.set(lot.cx + p.x * c + p.z * s, lot.groundY + p.y, lot.cz - p.x * s + p.z * c);
    this.dummy.rotation.set(0, lot.yaw, 0); this.dummy.scale.set(p.w, p.h, p.d); this.dummy.updateMatrix();
    mesh.setMatrixAt(i, this.dummy.matrix); this.counts.set(key, i + 1);
  }
}
