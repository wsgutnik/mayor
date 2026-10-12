import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { loadPatterns, upgradeMaterials } from "./kit-materials";

/** One kit model ready for instancing: a single merged geometry and one material per merged part. */
export interface LoadedModel {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  /** Materials whose name starts with "glow": the renderer raises their emission at night. */
  glow: THREE.MeshStandardMaterial[];
}

const loader = new GLTFLoader();

/**
 * Merge every mesh of a loaded glTF scene into one geometry (world transforms baked in), keeping a
 * material group per mesh so the result can feed an InstancedMesh.
 */
export function mergeScene(root: THREE.Object3D): LoadedModel | null {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    // Only the attributes every part shares; mergeGeometries needs them identical.
    const keep = new Set(["position", "normal", "uv", "color"]);
    for (const name of Object.keys(g.attributes)) if (!keep.has(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    const count = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    if (!g.attributes.color) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    else {
      // Blender writes RGBA vertex colours, often as normalised integers; read them through the accessor
      // so they come out as 0..1 floats, and keep RGB only.
      const src = g.attributes.color as THREE.BufferAttribute;
      const rgb = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        rgb[i * 3] = src.getX(i);
        rgb[i * 3 + 1] = src.getY(i);
        rgb[i * 3 + 2] = src.getZ(i);
      }
      g.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // A multi-material mesh keeps its draw groups; otherwise the whole geometry takes its single material.
    if (g.groups.length && mats.length > 1) {
      for (const gr of g.groups) {
        const sub = g.clone();
        sub.clearGroups();
        const idx = g.index ? Array.from(g.index.array).slice(gr.start, gr.start + gr.count) : null;
        if (idx) sub.setIndex(idx);
        parts.push(sub);
        materials.push(mats[gr.materialIndex ?? 0]);
      }
    } else {
      g.clearGroups();
      parts.push(g);
      materials.push(mats[0]);
    }
  });
  if (!parts.length) return null;
  const geometry = mergeGeometries(parts, true);
  if (!geometry) return null;
  const glow = materials.filter(
    (m, i): m is THREE.MeshStandardMaterial => m.name.startsWith("glow") && materials.indexOf(m) === i,
  );
  return { geometry, materials, glow };
}

export async function loadGlb(url: string): Promise<LoadedModel | null> {
  await loadPatterns();
  return new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => {
        const model = mergeScene(gltf.scene);
        resolve(model ? upgradeMaterials(model) : null);
      },
      undefined,
      () => resolve(null), // missing file: the procedural model stays
    );
  });
}
