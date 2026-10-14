// Adapted from fable-cities (MIT, (c) 2026 raw):
//   src/modules/roads/RoadMaterials.js — the 4096x1 uInfoTex segment-load
//   texture sampled in the road fragment shader.
// Mayor difference: the texture is size x size R8 indexed by world tile
// (one texel per tile) instead of per-segment slots, so no segment-slot
// table is needed; the road shader samples it at world xz.

import * as THREE from "three";
import { ROAD_CAPACITY } from "../sim/traffic";
import { trafficByte } from "../sim/coverage-field";

/** The slice of World + TrafficState the tint upload reads. */
export interface TrafficTintSource {
  size: number;
  road: Uint8Array;
  load: Uint16Array;
}

export class TrafficTint {
  texture: THREE.DataTexture;
  private size = 0;

  constructor(size: number) {
    this.texture = makeTexture(size);
    this.size = size;
  }

  private ensure(size: number): void {
    if (size === this.size) return;
    this.texture.dispose();
    this.texture = makeTexture(size);
    this.size = size;
  }

  /**
   * Rewrite the load-ratio texels (road tiles only, 0 elsewhere) and flag
   * one 9 KB upload. Call every 10 frames while the traffic view is open —
   * no instance-matrix rebuild (F11).
   */
  update(src: TrafficTintSource): void {
    this.ensure(src.size);
    const data = this.texture.image.data as Uint8Array;
    const n = src.size * src.size;
    for (let i = 0; i < n; i++) {
      const cls = src.road[i];
      data[i] = cls ? trafficByte(src.load[i], ROAD_CAPACITY[cls] ?? 0) : 0;
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

function makeTexture(size: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(size * size), size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
