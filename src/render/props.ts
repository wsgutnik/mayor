import * as THREE from "three";
import { PropKind } from "../sim/props";

/** Merge indexed geometries (position/normal/uv) into one; part transforms are pre-baked by `placed()`. */
function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0, indices = 0;
  for (const g of geos) {
    verts += g.attributes.position.count;
    indices += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
  const ind = new Uint32Array(indices);
  let vo = 0, io = 0;
  for (const g of geos) {
    // `placed()` already baked each part's translation into its attributes.
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], (vo + i) * 3);
      nor.set(n ? [n.getX(i), n.getY(i), n.getZ(i)] : [0, 1, 0], (vo + i) * 3);
      uv.set(u ? [u.getX(i), u.getY(i)] : [0, 0], (vo + i) * 2);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) ind[io + i] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) ind[io + i] = vo + i;
    io += g.index ? g.index.count : p.count;
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  return out;
}

const placed = (g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry => {
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  return g;
};

/**
 * Procedural street furniture, used until (or unless) the matching Blender
 * prop (`public/models/props/<kind>.glb`) is available; scene.ts swaps the
 * instanced geometry when a GLB loads, exactly like lamps and vehicles.
 */
export function propGeometry(kind: PropKind | "traffic_light"): THREE.BufferGeometry {
  switch (kind) {
    case "hydrant":
      return merge([
        placed(new THREE.CylinderGeometry(0.05, 0.065, 0.24, 8), 0, 0.12, 0),
        placed(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 6), 0, 0.27, 0),
      ]);
    case "trash_bin":
      return merge([placed(new THREE.CylinderGeometry(0.075, 0.06, 0.26, 8), 0, 0.13, 0)]);
    case "bench":
      return merge([
        placed(new THREE.BoxGeometry(0.55, 0.05, 0.2), 0, 0.22, 0),
        placed(new THREE.BoxGeometry(0.55, 0.24, 0.04), 0, 0.36, -0.09),
        placed(new THREE.BoxGeometry(0.05, 0.22, 0.18), -0.2, 0.11, 0),
        placed(new THREE.BoxGeometry(0.05, 0.22, 0.18), 0.2, 0.11, 0),
      ]);
    case "bus_shelter":
      return merge([
        placed(new THREE.BoxGeometry(0.85, 0.04, 0.38), 0, 0.58, 0),
        placed(new THREE.BoxGeometry(0.04, 0.58, 0.04), -0.38, 0.29, -0.13),
        placed(new THREE.BoxGeometry(0.04, 0.58, 0.04), 0.38, 0.29, -0.13),
        placed(new THREE.BoxGeometry(0.7, 0.04, 0.16), 0, 0.24, -0.05),
      ]);
    case "planter_tree":
      return merge([
        placed(new THREE.BoxGeometry(0.36, 0.18, 0.36), 0, 0.09, 0),
        placed(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 6), 0, 0.32, 0),
        placed(new THREE.IcosahedronGeometry(0.26, 0), 0, 0.68, 0),
      ]);
    case "shelter_small":
    case "shelter_glass":
      return merge([
        placed(new THREE.BoxGeometry(0.24, 0.025, 0.36), 0, 0.21, 0),
        placed(new THREE.BoxGeometry(0.025, 0.21, 0.025), -0.1, 0.105, 0.14),
        placed(new THREE.BoxGeometry(0.025, 0.21, 0.025), 0.1, 0.105, 0.14),
        placed(new THREE.BoxGeometry(0.2, 0.025, 0.08), 0, 0.09, 0.08),
      ]);
    case "bench_road":
      return merge([
        placed(new THREE.BoxGeometry(0.06, 0.035, 0.2), 0, 0.09, 0),
        placed(new THREE.BoxGeometry(0.025, 0.13, 0.2), 0.025, 0.14, 0),
        placed(new THREE.BoxGeometry(0.035, 0.08, 0.035), 0, 0.04, -0.07),
        placed(new THREE.BoxGeometry(0.035, 0.08, 0.035), 0, 0.04, 0.07),
      ]);
    case "planter_street":
      return merge([
        placed(new THREE.CylinderGeometry(0.05, 0.07, 0.08, 8), 0, 0.04, 0),
        placed(new THREE.SphereGeometry(0.075, 8, 5), 0, 0.13, 0),
      ]);
    case "streetlight_b":
      return merge([
        placed(new THREE.CylinderGeometry(0.009, 0.013, 0.3, 6), 0, 0.15, 0),
        placed(new THREE.BoxGeometry(0.018, 0.018, 0.1), 0, 0.3, -0.04),
      ]);
    case "kiosk_route":
      return merge([placed(new THREE.BoxGeometry(0.035, 0.22, 0.08), 0, 0.11, 0)]);
    case "ticket_machine":
      return merge([placed(new THREE.BoxGeometry(0.06, 0.18, 0.07), 0, 0.09, 0)]);
    case "stop_sign_bus":
      return merge([
        placed(new THREE.CylinderGeometry(0.008, 0.01, 0.24, 6), 0, 0.12, 0),
        placed(new THREE.BoxGeometry(0.05, 0.07, 0.012), 0, 0.245, 0),
      ]);
    case "traffic_light":
      // Pole with a vertical three-lamp head; the lit lamp itself is a
      // separate instanced sphere in scene.ts so its colour can follow phase.
      return merge([
        placed(new THREE.CylinderGeometry(0.03, 0.045, 0.95, 6), 0, 0.475, 0),
        placed(new THREE.BoxGeometry(0.13, 0.36, 0.11), 0, 1.1, 0),
      ]);
  }
}

/** Instance tint per kind (the GLB materials carry their own colours when loaded). */
export const PROP_TINT: Record<PropKind | "traffic_light", string> = {
  hydrant: "#c23b2e",
  trash_bin: "#3d5a44",
  bench: "#8a6b4a",
  bus_shelter: "#5a7d9a",
  planter_tree: "#4f8a43",
  shelter_small: "#5a7d9a",
  shelter_glass: "#81a9b8",
  bench_road: "#87694c",
  planter_street: "#4f8a43",
  streetlight_b: "#343a42",
  kiosk_route: "#3776a8",
  ticket_machine: "#707985",
  stop_sign_bus: "#2f6c9f",
  traffic_light: "#2e3238",
};
