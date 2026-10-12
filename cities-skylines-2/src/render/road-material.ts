import * as THREE from "three";

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
    case "#c4c7cc": return "kerb"; // KERB band (kerb + sidewalk)
    case "#3b3f46": // ASPHALT
    case "#4a4f57": return "asphalt"; // HW_ASPHALT
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

function prep(tex: THREE.Texture, maxAniso: number): THREE.Texture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAniso);
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
  fallbackAsphalt: THREE.Texture, maxAniso: number, onReady: (m: RoadDetailMaps) => void,
): void {
  if (cached) { onReady(cached); return; }
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
      (t) => done(key, prep(t, maxAniso)),
      undefined,
      () => done(key, key === "asphalt" ? fallbackAsphalt : neutral),
    );
  }
}

export interface RoadDetail {
  material: THREE.MeshStandardMaterial;
  setMaps(m: RoadDetailMaps): void;
}

/**
 * Standard-material road surface. `fallbackAsphalt` is the current 128 px map
 * (also the `map` until the HD asphalt arrives); the kerb band swaps to the
 * kerb/sidewalk mix once loaded. Vertex colours stay as tint throughout.
 */
export function createRoadDetailMaterial(fallbackAsphalt: THREE.Texture): RoadDetail {
  const uniforms = {
    uKerbMap: { value: null as THREE.Texture | null },
    uSidewalkMap: { value: null as THREE.Texture | null },
    uAvgBase: { value: new THREE.Vector3(0.55, 0.55, 0.55) },
    uAvgKerb: { value: new THREE.Vector3(0.55, 0.55, 0.55) },
    uAvgSidewalk: { value: new THREE.Vector3(0.55, 0.55, 0.55) },
    uDetailOn: { value: 0 },
    // Kerb palette colour converted to the working (linear) space, matching vColor.
    uKerbColor: { value: new THREE.Color("#c4c7cc") },
  };
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  uniforms.uKerbMap.value = white;
  uniforms.uSidewalkMap.value = white;

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide, map: fallbackAsphalt,
    roughness: 0.9, metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D uKerbMap, uSidewalkMap;
        uniform vec3 uAvgBase, uAvgKerb, uAvgSidewalk;
        uniform vec3 uKerbColor;
        uniform float uDetailOn;`)
      .replace("#include <map_fragment>", `
        vec3 baseDet = texture2D(map, vMapUv).rgb / max(uAvgBase, vec3(0.05));
        float kerbness = (1.0 - smoothstep(0.03, 0.12, distance(vColor.rgb, uKerbColor)))
          * uDetailOn;
        vec3 kerbDet = mix(texture2D(uKerbMap, vMapUv).rgb / max(uAvgKerb, vec3(0.05)),
                           texture2D(uSidewalkMap, vMapUv).rgb / max(uAvgSidewalk, vec3(0.05)), 0.6);
        diffuseColor.rgb *= mix(baseDet, kerbDet, kerbness);`);
  };
  material.customProgramCacheKey = () => "m20-road-detail";
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
  };
}
