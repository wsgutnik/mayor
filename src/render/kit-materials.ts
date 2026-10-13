import * as THREE from "three";
import type { LoadedModel } from "./glb-models";
import type { TextureTier } from "../prefs";

/**
 * The Blender GLBs carry geometry, UVs, ambient-occlusion vertex colours and material names; the textures
 * are shared here (public/textures) so a hundred buildings do not each embed their own copy.
 * public/models/patterns.json maps a material name to its texture and the world size of one repeat.
 */
type Patterns = Record<string, [string | null, number | null, string]>;

let patterns: Patterns | null = null;
let patternsPromise: Promise<Patterns> | null = null;
const textures = new Map<string, THREE.Texture>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
let textureTier: TextureTier = "sd";
let textureAniso = 4;
let maxTextureAniso = 4;

/** Load the pattern table once; resolves to an empty table when it is missing, so models still show. */
export function loadPatterns(): Promise<Patterns> {
  if (patterns) return Promise.resolve(patterns);
  patternsPromise ??= fetch("/models/patterns.json")
    .then((r) => (r.ok ? (r.json() as Promise<Patterns>) : {}))
    .catch(() => ({}))
    .then((p) => (patterns = p));
  return patternsPromise;
}

export type TextureExists = (name: string) => boolean;

/** Texture base name for a quality tier; `exists` is injectable for tests and manifests. */
export function textureName(name: string, tier: TextureTier, exists: TextureExists = () => true): string {
  if (tier !== "hd") return name;
  const hd = `${name}_hd`;
  return exists(hd) ? hd : name;
}

export function configureKitTextures(tier: TextureTier, aniso: number, maxAniso: number): void {
  textureTier = tier;
  textureAniso = aniso;
  maxTextureAniso = maxAniso;
  for (const t of textures.values()) t.anisotropy = Math.min(textureAniso, maxTextureAniso);
}

function texture(name: string): THREE.Texture | null {
  if (typeof document === "undefined") return null; // tests and other non-browser hosts
  const resolved = textureName(name, textureTier);
  let t = textures.get(resolved);
  if (!t) {
    const prep = (tex: THREE.Texture) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(textureAniso, maxTextureAniso);
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      return tex;
    };
    const loader = new THREE.TextureLoader();
    t = loader.load(`/textures/${resolved}.png`, undefined, undefined, () => {
      if (resolved === name) return;
      const target = t!;
      loader.load(`/textures/${name}.png`, (fallback) => {
        prep(fallback);
        target.image = fallback.image;
        target.needsUpdate = true;
      });
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(textureAniso, maxTextureAniso);
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    textures.set(resolved, t);
  }
  return t;
}

/** A shared textured material for one palette name, built from the colour the GLB gave it. */
function kitMaterial(src: THREE.Material, table: Patterns): THREE.Material {
  const base = src as THREE.MeshStandardMaterial;
  const name = src.name;
  const pat = table[name];
  if (!pat || !base.isMeshStandardMaterial) {
    if ((base as THREE.MeshStandardMaterial).isMeshStandardMaterial) base.vertexColors = true;
    return src;
  }
  const hit = materials.get(name);
  if (hit) return hit;
  const [texName, , hex] = pat;
  const isWindow = texName === "window";
  const mat = new THREE.MeshStandardMaterial({
    name,
    map: texName ? texture(texName) : null,
    // window panes carry their own colour; everything else is a grey pattern tinted by the palette colour
    color: isWindow ? new THREE.Color("#ffffff") : new THREE.Color(hex),
    roughness: base.roughness,
    metalness: 0,
    vertexColors: true,
  });
  if (name === "glow_window") {
    mat.emissive = new THREE.Color("#ffffff");
    mat.emissiveMap = texture("window_glow");
    mat.emissiveIntensity = 0;
  }
  materials.set(name, mat);
  return mat;
}

/** Swap the loader's flat materials for the shared textured ones. Safe to call before textures exist. */
export function upgradeMaterials(model: LoadedModel): LoadedModel {
  const table = patterns ?? {};
  const mats = model.materials.map((m) => kitMaterial(m, table));
  const glow = mats.filter(
    (m, i): m is THREE.MeshStandardMaterial => m.name.startsWith("glow") && mats.indexOf(m) === i && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial,
  );
  return { geometry: model.geometry, materials: mats, glow };
}
