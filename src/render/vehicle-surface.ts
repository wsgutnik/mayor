// Adapted from fable-cities (MIT, (c) 2026 raw):
// the aClass / aSurf / aLight vertex contract from src/modules/traffic/Geometry.js
// (MeshBuilder), buildShadowProxyGeometry from src/modules/traffic/VehicleModels.js,
// and the lampAnchors idea from lampOffsets() there. Mayor's vehicle forward axis is
// +X (Fable +Z), so the proxy's cabin box shifts toward -X instead of -Z.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LoadedModel } from "./glb-models";

/** Surface classes, read `flat` so a triangle is never half glass and half paint. */
export const CLS = { GENERIC: 0, PAINT: 1, GLASS: 2, GLASS_BUS: 3, METAL: 4, RUBBER: 5, LAMP: 6 } as const;

/** Emissive kinds for aLight: 0 none, 1 head, 2 tail, 3 brake-only, 7 cabin/sign, 10 lit glazing. */
export const LIGHT = { NONE: 0, HEAD: 1, TAIL: 2, BRAKE: 3, CABIN: 7, GLAZING: 10 } as const;

export interface SurfaceSpec {
  cls: number;
  light: number;
  /** Mask into the per-instance aPaint / aPaint2 colours. */
  paint: number;
  paint2: number;
  metal: number;
  rough: number;
  /** Pattern hex (sRGB), baked × the AO vertex colour into `color`. */
  color: string;
}

const GENERIC = (color: string, rough: number, metal = 0): SurfaceSpec => (
  { cls: CLS.GENERIC, light: LIGHT.NONE, paint: 0, paint2: 0, metal, rough, color }
);

/**
 * Blender material name → surface class. Every name in every fleet GLB must be
 * here; an unknown name degrades to white generic (and the coverage test fails).
 * Lens albedos stay dark so day emission never clips to salmon under ACES.
 */
const CLASS_MAP: Record<string, SurfaceSpec> = {
  car_body: { cls: CLS.PAINT, light: LIGHT.NONE, paint: 1, paint2: 0, metal: 0, rough: 0.3, color: "#ffffff" },
  car_body2: { cls: CLS.PAINT, light: LIGHT.NONE, paint: 0, paint2: 1, metal: 0, rough: 0.3, color: "#ffffff" },
  glass_dark: { cls: CLS.GLASS, light: LIGHT.NONE, paint: 0, paint2: 0, metal: 0, rough: 0.06, color: "#3d5a82" },
  car_glass: { cls: CLS.GLASS, light: LIGHT.NONE, paint: 0, paint2: 0, metal: 0, rough: 0.06, color: "#26323f" },
  rim: { cls: CLS.METAL, light: LIGHT.NONE, paint: 0, paint2: 0, metal: 1, rough: 0.15, color: "#b9bfc7" },
  metal: { cls: CLS.METAL, light: LIGHT.NONE, paint: 0, paint2: 0, metal: 1, rough: 0.15, color: "#a9b0b8" },
  tire: { cls: CLS.RUBBER, light: LIGHT.NONE, paint: 0, paint2: 0, metal: 0, rough: 0.9, color: "#17181b" },
  black: { cls: CLS.RUBBER, light: LIGHT.NONE, paint: 0, paint2: 0, metal: 0, rough: 0.9, color: "#1b1d22" },
  glow_head: { cls: CLS.LAMP, light: LIGHT.HEAD, paint: 0, paint2: 0, metal: 0.1, rough: 0.1, color: "#d4dde6" },
  glow_tail: { cls: CLS.LAMP, light: LIGHT.TAIL, paint: 0, paint2: 0, metal: 0.05, rough: 0.1, color: "#520a07" },
  glow_sign: { cls: CLS.GENERIC, light: LIGHT.CABIN, paint: 0, paint2: 0, metal: 0, rough: 0.5, color: "#f5c04a" },
  metal_dark: GENERIC("#59616b", 0.5, 0.5),
  white: GENERIC("#f1eee6", 0.8),
  sign_blue: GENERIC("#2f6fd0", 0.5),
  sign_red: GENERIC("#d63a3a", 0.5),
  sign_orange: GENERIC("#ee8a2c", 0.5),
  bark: GENERIC("#6e4e34", 0.95),
  wall_green: GENERIC("#2f8a55", 0.88),
  wall_wood: GENERIC("#a8683a", 0.88),
};

const FALLBACK: SurfaceSpec = GENERIC("#ffffff", 0.8);

export function classOf(materialName: string): SurfaceSpec {
  return CLASS_MAP[materialName] ?? FALLBACK;
}

/** Material names with an explicit mapping (the coverage test enumerates the GLBs). */
export function knownMaterialNames(): Set<string> {
  return new Set(Object.keys(CLASS_MAP));
}

export interface BakedVehicle {
  geometry: THREE.BufferGeometry;
  /** Per-instance paint / paint2 / lamp-state arrays, sized to capacity. */
  aPaint: THREE.InstancedBufferAttribute;
  aPaint2: THREE.InstancedBufferAttribute;
  aState: THREE.InstancedBufferAttribute;
}

/**
 * Turn a merged multi-group fleet model into one single-material geometry: per
 * group, write aClass / aLight / aSurf, bake pattern hex × AO into `color`,
 * then clearGroups(). The returned geometry feeds the shared vehicle material.
 */
export function bakeVehicleSurface(model: LoadedModel, capacity: number): BakedVehicle {
  const src = model.geometry;
  const g = src.clone();
  const vCount = g.attributes.position.count;
  const aClass = new Float32Array(vCount);
  const aLight = new Float32Array(vCount);
  const aSurf = new Float32Array(vCount * 4);
  const color = g.attributes.color as THREE.BufferAttribute | undefined;
  const ao = new Float32Array(vCount * 3).fill(1);
  if (color) {
    for (let i = 0; i < vCount; i++) {
      ao[i * 3] = color.getX(i);
      ao[i * 3 + 1] = color.getY(i);
      ao[i * 3 + 2] = color.getZ(i);
    }
  }
  const baked = new Float32Array(vCount * 3).fill(1);
  const tint = new THREE.Color();
  const index = g.index ? g.index.array : null;
  const groups = g.groups.length ? g.groups : [{ start: 0, count: index ? index.length : vCount, materialIndex: 0 }];
  groups.forEach((gr, gi) => {
    const mat = model.materials[Math.min(gr.materialIndex ?? gi, model.materials.length - 1)];
    const spec = classOf(mat?.name ?? "");
    tint.set(spec.color);
    const end = gr.start + gr.count;
    for (let k = gr.start; k < end; k++) {
      const v = index ? index[k] : k;
      if (v < 0 || v >= vCount) continue;
      aClass[v] = spec.cls;
      aLight[v] = spec.light;
      aSurf[v * 4] = spec.paint;
      aSurf[v * 4 + 1] = spec.paint2;
      aSurf[v * 4 + 2] = spec.metal;
      aSurf[v * 4 + 3] = spec.rough;
      baked[v * 3] = tint.r * ao[v * 3];
      baked[v * 3 + 1] = tint.g * ao[v * 3 + 1];
      baked[v * 3 + 2] = tint.b * ao[v * 3 + 2];
    }
  });
  g.setAttribute("color", new THREE.BufferAttribute(baked, 3));
  g.setAttribute("aClass", new THREE.BufferAttribute(aClass, 1));
  g.setAttribute("aLight", new THREE.BufferAttribute(aLight, 1));
  g.setAttribute("aSurf", new THREE.BufferAttribute(aSurf, 4));
  g.clearGroups();
  const inst = (size: number): THREE.InstancedBufferAttribute => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(size * capacity), size);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  const aPaint = inst(3), aPaint2 = inst(3), aState = inst(3);
  g.setAttribute("aPaint", aPaint);
  g.setAttribute("aPaint2", aPaint2);
  g.setAttribute("aState", aState);
  return { geometry: g, aPaint, aPaint2, aState };
}

/**
 * 24-triangle shadow stand-in: a lower body box (×1.06 wide) plus a cabin box
 * (+12 % tall, shifted toward the rear at -X). Deliberately fatter than the
 * shell so the shadow survives the normal-bias erosion at distance.
 */
export function shadowProxy(source: THREE.BufferGeometry): THREE.BufferGeometry {
  source.computeBoundingBox();
  const bb = source.boundingBox!;
  const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, l = bb.max.z - bb.min.z;
  const cx = (bb.max.x + bb.min.x) * 0.5, cz = (bb.max.z + bb.min.z) * 0.5;
  const belt = bb.min.y + h * 0.56;
  const top = bb.max.y + h * 0.12;
  const lower = new THREE.BoxGeometry(w * 1.06, belt - bb.min.y, l * 1.02);
  lower.translate(cx, (bb.min.y + belt) * 0.5, cz);
  const cabin = new THREE.BoxGeometry(w * 0.9, top - belt, l * 0.58);
  cabin.translate(cx - w * 0.06, (belt + top) * 0.5, cz);
  const g = mergeGeometries([lower, cabin])!;
  lower.dispose();
  cabin.dispose();
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  return g;
}

/** Head / tail lamp centroids from the baked aLight vertices (robust to Blender edits). */
export function lampAnchors(baked: THREE.BufferGeometry): { head: [number, number, number]; tail: [number, number, number] } {
  const pos = baked.attributes.position;
  const light = baked.attributes.aLight as THREE.BufferAttribute | undefined;
  const acc = (kind: number): [number, number, number] => {
    let x = 0, y = 0, z = 0, n = 0;
    if (light) {
      for (let i = 0; i < pos.count; i++) {
        if (light.getX(i) !== kind) continue;
        x += pos.getX(i); y += pos.getY(i); z += pos.getZ(i); n++;
      }
    }
    if (!n) {
      baked.computeBoundingBox();
      const bb = baked.boundingBox!;
      const fx = kind === LIGHT.HEAD ? bb.max.x : bb.min.x;
      return [fx, (bb.min.y + bb.max.y) * 0.5, (bb.min.z + bb.max.z) * 0.5];
    }
    return [x / n, y / n, z / n];
  };
  return { head: acc(LIGHT.HEAD), tail: acc(LIGHT.TAIL) };
}

/** Nose-up-positive pitch from the ground heights under the front / rear axle. */
export function pitchFor(yFront: number, yRear: number, axleSpan: number): number {
  const p = Math.atan2(yFront - yRear, Math.max(1e-6, axleSpan));
  return Math.max(-0.5, Math.min(0.5, p));
}
