// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): buildings/renderer.js Pool / BuildingRenderer.
import * as THREE from "three";
import { geometryFor } from "./procgeo";
import { constructionParts, proceduralBuilding, type ProcPart } from "./procbuildings";
import { createFacadeMaterial } from "./facade-material";
import { bucketOrder } from "./lod";
import { setWindowNight } from "./window-light";
import type { OrientedLot } from "../sim/zonecells";

const CAPACITY = 4096;
export interface ProcPlacedLot extends OrientedLot { groundY: number }

/** Static instanced pools. Style-specific wall/window pools preserve the kit
 * palette and V1's per-window night family without per-building materials. */
export class ProcBuildingsRenderer {
  readonly group = new THREE.Group();
  private pools = new Map<string, THREE.InstancedMesh>();
  private counts = new Map<string, number>();
  private dummy = new THREE.Object3D();
  private xs = new Float32Array(CAPACITY);
  private zs = new Float32Array(CAPACITY);
  constructor() { /* pools are lazy: unused facade variants cost no draw calls */ }
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
  setNight(night: number): void {
    for (const mesh of this.pools.values()) setWindowNight(mesh.material as THREE.MeshStandardMaterial, night);
  }
  private add(lot: ProcPlacedLot, p: ProcPart): void {
    // Wall and glass pools retain their authored facade family. Roof/metal
    // stay shared, avoiding an unnecessary draw-call multiplier.
    const key = `${p.shape}:${p.material}:${p.material === "wall" || p.material === "glass" ? p.style : "shared"}`;
    let mesh = this.pools.get(key);
    if (!mesh) {
      const style = p.material === "glass" || p.material === "wall" ? p.style : p.material === "metal" ? "industrial" : "retail";
      mesh = new THREE.InstancedMesh(geometryFor(p.shape).geometry, createFacadeMaterial(style, p.material === "glass"), CAPACITY);
      mesh.count = 0; mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.pools.set(key, mesh); this.group.add(mesh);
    }
    const i = this.counts.get(key) ?? 0; if (i >= CAPACITY) return;
    const s = Math.sin(lot.yaw), c = Math.cos(lot.yaw);
    this.dummy.position.set(lot.cx + p.x * c + p.z * s, lot.groundY + p.y, lot.cz - p.x * s + p.z * c);
    this.dummy.rotation.set(0, lot.yaw, 0); this.dummy.scale.set(p.w, p.h, p.d); this.dummy.updateMatrix();
    mesh.setMatrixAt(i, this.dummy.matrix); this.counts.set(key, i + 1);
  }
}
