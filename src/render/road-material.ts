import * as THREE from "three";
import { applyMaterialTargets } from "./material-targets";

/**
 * M20 — textured road material.
 *
 * Geometry is untouched (same ribbons, same vertex colours, same uv at
 * world/0.6): the HD detail only multiplies the existing colours as tint.
 * The fragment picks its detail layer from the vertex colour — asphalt grain
 * on carriageways, a kerb/sidewalk mix on the kerb band — so one material
 * serves the whole network. Detail samples are normalised by their texture
 * average, keeping markings and tints hue-stable. Until the HD set loads the
 * old 128 px asphalt map carries the detail alone.
 */

export type RoadLayer = "asphalt" | "kerb" | "flat";

/** Which detail layer a road vertex colour belongs to (mirrors src/render/roads.ts palette). */
export function roadLayerForColor(hex: string): RoadLayer {
  switch (hex.toLowerCase()) {
    case "#c4c7cc": case "#ccd0d6": return "kerb"; // KERB band (kerb + sidewalk)
    case "#3b3f46": case "#31353c": // ASPHALT
    case "#4a4f57": case "#41464e": return "asphalt"; // HW_ASPHALT
    default: return "flat"; // markings, median, zebra, highway edge: tint only
  }
}

export interface RoadDetailMaps {
  asphalt: THREE.Texture;
  kerb: THREE.Texture;
  sidewalk: THREE.Texture;
  avgAsphalt: [number, number, number];
  avgKerb: [number, number, number];
  avgSidewalk: [number, number, number];
}

let cached: RoadDetailMaps | null = null;

function prep(tex: THREE.Texture, maxAniso: number, aniso: number): THREE.Texture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(aniso, maxAniso);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Mean colour of a loaded texture via a tiny canvas readout. */
export function averageOfTexture(tex: THREE.Texture): [number, number, number] {
  try {
    const img = tex.image as HTMLImageElement | undefined;
    if (!img || !img.width) return [0.55, 0.55, 0.55];
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const ctx = c.getContext("2d");
    if (!ctx) return [0.55, 0.55, 0.55];
    // Draw first: without it the canvas is blank, the average reads 0 and the detail pass over-brightens 20x.
    ctx.drawImage(img, 0, 0, 8, 8);
    const px = ctx.getImageData(0, 0, 8, 8).data;
    // The sampler returns linear values for an sRGB texture, so average in linear space too.
    const lin = (v: number): number => Math.pow(v / 255, 2.2);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < 64; i++) {
      r += lin(px[i * 4]); g += lin(px[i * 4 + 1]); b += lin(px[i * 4 + 2]);
    }
    return [r / 64, g / 64, b / 64];
  } catch {
    return [0.55, 0.55, 0.55];
  }
}

/**
 * Lazily load the HD road set; any failure keeps `fallback` for that layer
 * (asphalt) or a neutral 1 px detail (kerb/sidewalk). Cached process-wide.
 */
export function loadRoadDetailMaps(
  fallbackAsphalt: THREE.Texture, maxAniso: number, aniso: number, onReady: (m: RoadDetailMaps) => void,
): void {
  if (cached) {
    for (const t of [cached.asphalt, cached.kerb, cached.sidewalk]) t.anisotropy = Math.min(aniso, maxAniso);
    onReady(cached);
    return;
  }
  const loader = new THREE.TextureLoader();
  const files: [keyof Pick<RoadDetailMaps, "asphalt" | "kerb" | "sidewalk">, string][] = [
    ["asphalt", "/textures/asphalt_hd.png"],
    ["kerb", "/textures/kerb_hd.png"],
    ["sidewalk", "/textures/sidewalk_hd.png"],
  ];
  const out = {} as RoadDetailMaps;
  let pending = files.length;
  const neutral = new THREE.DataTexture(new Uint8Array([140, 140, 140, 255]), 1, 1);
  neutral.needsUpdate = true;
  const avgOf = (t: THREE.Texture): [number, number, number] =>
    t === neutral ? [140 / 255, 140 / 255, 140 / 255] : averageOfTexture(t);
  const avgKey = { asphalt: "avgAsphalt", kerb: "avgKerb", sidewalk: "avgSidewalk" } as const;
  const done = (key: (typeof files)[number][0], t: THREE.Texture) => {
    out[key] = t;
    out[avgKey[key]] = avgOf(t);
    if (--pending === 0) {
      cached = out;
      onReady(out);
    }
  };
  for (const [key, url] of files) {
    loader.load(
      url,
      (t) => done(key, prep(t, maxAniso, aniso)),
      undefined,
      () => done(key, key === "asphalt" ? fallbackAsphalt : neutral),
    );
  }
}

/** Cross-section atlas set (public/textures/road/, see blender/make_road_atlas.py). */
export interface RoadAtlasMaps {
  street: THREE.Texture;
  avenue: THREE.Texture;
  onewayStreet: THREE.Texture;
  onewayAvenue: THREE.Texture;
  highway: THREE.Texture;
  junction: THREE.Texture;
  crosswalk: THREE.Texture;
  stopBar: THREE.Texture;
  arrow: THREE.Texture;
}

let atlasCache: RoadAtlasMaps | null = null;

/**
 * Lazily load the road atlas; any failure calls `onFallback` so the caller
 * keeps the vertex-colour path. Anisotropy is capped at 8.
 */
export function loadRoadAtlas(
  maxAniso: number,
  aniso: number,
  onReady: (m: RoadAtlasMaps) => void,
  onFallback: () => void,
): void {
  if (atlasCache) {
    for (const t of Object.values(atlasCache)) t.anisotropy = Math.min(aniso, maxAniso);
    onReady(atlasCache);
    return;
  }
  const loader = new THREE.TextureLoader();
  const files: [keyof RoadAtlasMaps, string][] = [
    ["street", "/textures/road/road_street.png"],
    ["avenue", "/textures/road/road_avenue.png"],
    ["onewayStreet", "/textures/road/road_oneway_street.png"],
    ["onewayAvenue", "/textures/road/road_oneway_avenue.png"],
    ["highway", "/textures/road/road_highway.png"],
    ["junction", "/textures/road/junction_asphalt.png"],
    ["crosswalk", "/textures/road/crosswalk.png"],
    ["stopBar", "/textures/road/stop_bar.png"],
    ["arrow", "/textures/road/arrow_oneway.png"],
  ];
  const out = {} as RoadAtlasMaps;
  let pending = files.length;
  let failed = false;
  const done = () => {
    if (--pending !== 0) return;
    if (failed) { onFallback(); return; }
    atlasCache = out;
    onReady(out);
  };
  for (const [key, url] of files) {
    loader.load(url, (t) => { out[key] = prep(t, maxAniso, aniso); done(); }, undefined, () => { failed = true; done(); });
  }
}

export interface RoadDetail {
  material: THREE.MeshStandardMaterial;
  setMaps(m: RoadDetailMaps): void;
  setAtlas(m: RoadAtlasMaps): void;
  /** Day factor 0..1 and wetness 0..1; writes existing uniforms only. */
  setDayWet(day: number, wet: number): void;
  /** Traffic infoview tint: load-ratio texture (R8, one texel per tile) and map size. */
  setTrafficMap(tex: THREE.Texture, mapSize: number): void;
  /** Toggle the traffic tint without touching the texture binding. */
  setTrafficOn(on: boolean): void;
}

/**
 * Standard-material road surface. `fallbackAsphalt` is the current 128 px map
 * (also the `map` until the HD asphalt arrives); the kerb band swaps to the
 * kerb/sidewalk mix once loaded. Vertex colours stay as tint throughout.
 */
export function createRoadDetailMaterial(fallbackAsphalt: THREE.Texture): RoadDetail {
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  const uniforms = {
    uKerbMap: { value: white as THREE.Texture },
    uSidewalkMap: { value: white as THREE.Texture },
    uAvgBase: { value: new THREE.Vector3(0.55, 0.55, 0.55) },
    uAvgKerb: { value: new THREE.Vector3(0.55, 0.55, 0.55) },
    uAvgSidewalk: { value: new THREE.Vector3(0.55, 0.55, 0.55) },
    uDetailOn: { value: 0 },
    // Kerb palette colour converted to the working (linear) space, matching vColor.
    uKerbColor: { value: new THREE.Color("#c4c7cc") },
    uAtlasOn: { value: 0 },
    uDayFactor: { value: 1 },
    uWet: { value: 0 },
    uTexStreet: { value: white as THREE.Texture },
    uTexAvenue: { value: white as THREE.Texture },
    uTexOnewayStreet: { value: white as THREE.Texture },
    uTexOnewayAvenue: { value: white as THREE.Texture },
    uTexHighway: { value: white as THREE.Texture },
    uTexJunction: { value: white as THREE.Texture },
    uTexCrosswalk: { value: white as THREE.Texture },
    uTexStopBar: { value: white as THREE.Texture },
    uTexArrow: { value: white as THREE.Texture },
    // Traffic infoview (F11): R8 load-ratio texture sampled at world xz.
    uTrafficTex: { value: white as THREE.Texture },
    uTrafficOn: { value: 0 },
    uMapSize: { value: 96 },
  };

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide, map: fallbackAsphalt,
    roughness: 0.9, metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        attribute float aClass;
        varying float vRoadClass;
        varying vec2 vRoadUv;
        varying vec2 vWorldXz;`)
      .replace("#include <uv_vertex>", `#include <uv_vertex>
        vRoadClass = aClass;
        vRoadUv = uv;
        vWorldXz = (modelMatrix * vec4(position, 1.0)).xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D uKerbMap, uSidewalkMap;
        uniform sampler2D uTexStreet, uTexAvenue, uTexOnewayStreet, uTexOnewayAvenue;
        uniform sampler2D uTexHighway, uTexJunction, uTexCrosswalk, uTexStopBar, uTexArrow;
        uniform vec3 uAvgBase, uAvgKerb, uAvgSidewalk;
        uniform vec3 uKerbColor;
        uniform float uDetailOn, uAtlasOn, uDayFactor, uWet;
        uniform sampler2D uTrafficTex;
        uniform float uTrafficOn, uMapSize;
        varying float vRoadClass;
        varying vec2 vRoadUv;
        varying vec2 vWorldXz;`)
      .replace("#include <map_fragment>", `
        if (uAtlasOn > 0.5 && vRoadClass > 0.5) {
          vec3 roadCol;
          if (vRoadClass < 1.5) roadCol = texture2D(uTexStreet, vRoadUv).rgb;
          else if (vRoadClass < 2.5) roadCol = texture2D(uTexAvenue, vRoadUv).rgb;
          else if (vRoadClass < 3.5) roadCol = texture2D(uTexOnewayStreet, vRoadUv).rgb;
          else if (vRoadClass < 4.5) roadCol = texture2D(uTexOnewayAvenue, vRoadUv).rgb;
          else if (vRoadClass < 5.5) roadCol = texture2D(uTexHighway, vRoadUv).rgb;
          else if (vRoadClass < 6.5) roadCol = texture2D(uTexJunction, vRoadUv).rgb;
          else if (vRoadClass < 7.5) { vec4 m = texture2D(uTexCrosswalk, vRoadUv); roadCol = mix(vec3(0.16, 0.17, 0.19), m.rgb, m.a); }
          else if (vRoadClass < 8.5) { vec4 m = texture2D(uTexStopBar, vRoadUv); roadCol = mix(vec3(0.16, 0.17, 0.19), m.rgb, m.a); }
          else { vec4 m = texture2D(uTexArrow, vRoadUv); roadCol = mix(vec3(0.16, 0.17, 0.19), m.rgb, m.a); }
          roadCol *= 0.55 + 0.45 * uDayFactor;
          roadCol *= 1.0 - 0.18 * uWet;
          diffuseColor.rgb = roadCol;
        } else {
          vec3 baseDet = texture2D(map, vMapUv).rgb / max(uAvgBase, vec3(0.05));
          float kerbness = (1.0 - smoothstep(0.03, 0.12, distance(vColor.rgb, uKerbColor)))
            * uDetailOn;
          vec3 kerbDet = mix(texture2D(uKerbMap, vMapUv).rgb / max(uAvgKerb, vec3(0.05)),
                             texture2D(uSidewalkMap, vMapUv).rgb / max(uAvgSidewalk, vec3(0.05)), 0.6);
          diffuseColor.rgb *= mix(baseDet, kerbDet, kerbness);
        }
        if (uTrafficOn > 0.5 && vRoadClass > 0.5) {
          float tLoad = texture2D(uTrafficTex, vWorldXz / uMapSize).r;
          diffuseColor.rgb = mix(vec3(0.13, 0.62, 0.20), vec3(0.85, 0.10, 0.07), smoothstep(0.0, 1.0, tLoad));
        }`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.32,
          uWet * uAtlasOn * step(0.5, vRoadClass) * step(vRoadClass, 6.5));`);
  };
  material.customProgramCacheKey = () => "road-atlas-v2";
  const v3 = (a: [number, number, number]) => new THREE.Vector3(...a);
  return {
    material,
    setMaps: (m) => {
      material.map = m.asphalt;
      uniforms.uKerbMap.value = m.kerb;
      uniforms.uSidewalkMap.value = m.sidewalk;
      uniforms.uAvgBase.value = v3(m.avgAsphalt);
      uniforms.uAvgKerb.value = v3(m.avgKerb);
      uniforms.uAvgSidewalk.value = v3(m.avgSidewalk);
      uniforms.uDetailOn.value = 1;
      material.needsUpdate = true;
    },
    setAtlas: (m) => {
      uniforms.uTexStreet.value = m.street;
      uniforms.uTexAvenue.value = m.avenue;
      uniforms.uTexOnewayStreet.value = m.onewayStreet;
      uniforms.uTexOnewayAvenue.value = m.onewayAvenue;
      uniforms.uTexHighway.value = m.highway;
      uniforms.uTexJunction.value = m.junction;
      uniforms.uTexCrosswalk.value = m.crosswalk;
      uniforms.uTexStopBar.value = m.stopBar;
      uniforms.uTexArrow.value = m.arrow;
      uniforms.uAtlasOn.value = 1;
      material.needsUpdate = true;
    },
    setDayWet: (day, wet) => {
      uniforms.uDayFactor.value = day;
      uniforms.uWet.value = wet;
      applyMaterialTargets(material, wet, 0.6);
    },
    setTrafficMap: (tex, mapSize) => {
      uniforms.uTrafficTex.value = tex;
      uniforms.uMapSize.value = mapSize;
    },
    setTrafficOn: (on) => {
      uniforms.uTrafficOn.value = on ? 1 : 0;
    },
  };
}
