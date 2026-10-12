import * as THREE from "three";

/**
 * M20 — splat-mapped terrain material.
 *
 * Four HD layers (grass, sand, rock, dirt) mix by height, slope and a noise
 * field; each sample is normalised by its texture's average colour so the
 * biome tint already baked in the vertex colours survives (the detail only
 * adds grain, never shifts the hue). Rock uses triplanar projection so steep
 * slopes don't smear; the rest use world-space XZ UVs. Until the HD set for
 * the current tier finishes loading the material renders flat vertex colours
 * (with the cheap slope-AO term), falling back to the old 128 px grass
 * texture if a file fails to load.
 */

export interface SplatParams {
  /** Height below which the ground is sand (waterline margin). */
  sandAt: number;
  /** Height above which altitude alone turns the ground rocky. */
  rockAt: number;
  /** Slope (1 - normal.y) above which the ground turns rocky. */
  slopeRock: number;
}

export const DEFAULT_SPLAT: SplatParams = { sandAt: 0.3, rockAt: 2.6, slopeRock: 0.32 };

const sstep = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * CPU mirror of the shader blend: [grass, sand, rock, dirt] weights summing
 * to ~1. `slope` is 1 - normal.y, `noise` a 0..1 patch field for dirt.
 */
export function splatWeights(
  h: number, slope: number, noise: number, p: SplatParams = DEFAULT_SPLAT,
): [number, number, number, number] {
  const sand = 1 - sstep(p.sandAt, p.sandAt + 0.4, h);
  const rock = Math.max(
    sstep(p.slopeRock, p.slopeRock + 0.25, slope),
    sstep(p.rockAt, p.rockAt + 1.5, h),
  );
  const dirt = (1 - sand) * (1 - rock) * sstep(0.55, 0.8, noise);
  const grass = Math.max(0, 1 - sand - rock - dirt);
  const tot = grass + sand + rock + dirt || 1;
  return [grass / tot, sand / tot, rock / tot, dirt / tot];
}

/** Mean colour of raw RGBA bytes (canvas 2d readout); guards empty input. */
export function averageOfPixels(data: Uint8ClampedArray): [number, number, number] {
  const count = Math.floor(data.length / 4);
  const n = Math.max(1, count);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < count; i++) {
    r += data[i * 4] / 255; g += data[i * 4 + 1] / 255; b += data[i * 4 + 2] / 255;
  }
  return [r / n, g / n, b / n];
}

export type SplatTier = "md" | "hd";
const LAYERS = ["grass", "sand", "rock", "dirt"] as const;
export type SplatLayer = (typeof LAYERS)[number];

export interface SplatMaps {
  tex: Record<SplatLayer, THREE.Texture>;
  avg: Record<SplatLayer, [number, number, number]>;
}

const cache = new Map<SplatTier, SplatMaps>();

function prep(tex: THREE.Texture, maxAniso: number): THREE.Texture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAniso);
  return tex;
}

function averageOfTexture(tex: THREE.Texture): [number, number, number] {
  try {
    const img = tex.image as HTMLImageElement | undefined;
    if (!img || !img.width) return [0.55, 0.55, 0.55];
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const ctx = c.getContext("2d");
    if (!ctx) return [0.55, 0.55, 0.55];
    ctx.drawImage(img, 0, 0, 8, 8);
    return averageOfPixels(ctx.getImageData(0, 0, 8, 8).data);
  } catch {
    return [0.55, 0.55, 0.55];
  }
}

/**
 * Lazily load one splat set; per-texture failures fall back to `fallback`
 * (the old grass texture) so the ground never renders magenta. Results are
 * cached per tier. Calls `onReady` once with the full set.
 */
export function loadSplatMaps(
  tier: SplatTier, fallback: THREE.Texture, maxAniso: number, onReady: (m: SplatMaps) => void,
): void {
  const hit = cache.get(tier);
  if (hit) { onReady(hit); return; }
  const loader = new THREE.TextureLoader();
  const tex = {} as Record<SplatLayer, THREE.Texture>;
  const avg = {} as Record<SplatLayer, [number, number, number]>;
  let pending = LAYERS.length;
  const done = (layer: SplatLayer, t: THREE.Texture) => {
    tex[layer] = t;
    avg[layer] = averageOfTexture(t);
    if (--pending === 0) {
      const maps = { tex, avg };
      cache.set(tier, maps);
      onReady(maps);
    }
  };
  for (const layer of LAYERS) {
    loader.load(
      `/textures/${layer}_${tier}.png`,
      (t) => done(layer, prep(t, maxAniso)),
      undefined,
      () => done(layer, fallback),
    );
  }
}

export interface TerrainSplat {
  material: THREE.MeshStandardMaterial;
  /** 0 = flat vertex colours (low tier / still loading), 1 = full splat. */
  setEnabled(on: boolean): void;
  setMaps(m: SplatMaps): void;
  setParams(p: SplatParams): void;
}

/** Standard-material terrain with the splat blend injected (no `map`: world-space UVs). */
export function createTerrainSplatMaterial(): TerrainSplat {
  const uniforms = {
    uSplat: { value: 0 },
    uGrass: { value: null as THREE.Texture | null },
    uSand: { value: null as THREE.Texture | null },
    uRock: { value: null as THREE.Texture | null },
    uDirt: { value: null as THREE.Texture | null },
    uAvgGrass: { value: new THREE.Vector3(0.55, 0.55, 0.55) },
    uAvgSand: { value: new THREE.Vector3(0.55, 0.55, 0.55) },
    uAvgRock: { value: new THREE.Vector3(0.55, 0.55, 0.55) },
    uAvgDirt: { value: new THREE.Vector3(0.55, 0.55, 0.55) },
    uSandAt: { value: DEFAULT_SPLAT.sandAt },
    uRockAt: { value: DEFAULT_SPLAT.rockAt },
    uSlopeRock: { value: DEFAULT_SPLAT.slopeRock },
  };
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  uniforms.uGrass.value = white;
  uniforms.uSand.value = white;
  uniforms.uRock.value = white;
  uniforms.uDirt.value = white;

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSplatPos;\nvarying vec3 vSplatNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSplatPos = position;\nvSplatNormal = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vSplatPos;
        varying vec3 vSplatNormal;
        uniform float uSplat;
        uniform sampler2D uGrass, uSand, uRock, uDirt;
        uniform vec3 uAvgGrass, uAvgSand, uAvgRock, uAvgDirt;
        uniform float uSandAt, uRockAt, uSlopeRock;
        float m20hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float m20noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(m20hash(i), m20hash(i + vec2(1.0, 0.0)), u.x),
                     mix(m20hash(i + vec2(0.0, 1.0)), m20hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        {
          vec3 wn = normalize(vSplatNormal);
          float slope = 1.0 - wn.y;
          vec2 wuv = vSplatPos.xz / 6.0;
          // Same blend as splatWeights() on the CPU.
          float sandW = 1.0 - smoothstep(uSandAt, uSandAt + 0.4, vSplatPos.y);
          float rockW = max(smoothstep(uSlopeRock, uSlopeRock + 0.25, slope),
                            smoothstep(uRockAt, uRockAt + 1.5, vSplatPos.y));
          float dirtW = (1.0 - sandW) * (1.0 - rockW) * smoothstep(0.55, 0.8, m20noise(wuv * 3.0));
          float grassW = max(0.0, 1.0 - sandW - rockW - dirtW);
          vec3 g = texture2D(uGrass, wuv).rgb / max(uAvgGrass, vec3(0.05));
          vec3 s = texture2D(uSand, wuv * 1.3).rgb / max(uAvgSand, vec3(0.05));
          // Triplanar rock: no stretching on cliffs whatever their facing.
          vec3 blend = pow(abs(wn), vec3(3.0));
          blend /= (blend.x + blend.y + blend.z);
          vec3 r = (texture2D(uRock, vSplatPos.zy / 6.0).rgb * blend.x
                  + texture2D(uRock, vSplatPos.xz / 6.0).rgb * blend.y
                  + texture2D(uRock, vSplatPos.xy / 6.0).rgb * blend.z)
                 / max(uAvgRock, vec3(0.05));
          vec3 d = texture2D(uDirt, wuv * 0.8).rgb / max(uAvgDirt, vec3(0.05));
          vec3 detail = (g * grassW + s * sandW + r * rockW + d * dirtW)
                      / max(grassW + sandW + rockW + dirtW, 1e-4);
          // Snow reads as flat white, not textured rock (vColor is linear: snow ~0.9, sand ~0.5).
          float snowM = smoothstep(0.7, 0.85, dot(vColor, vec3(0.3333)));
          detail = mix(detail, vec3(1.0), snowM);
          diffuseColor.rgb *= mix(vec3(1.0), detail, uSplat);
          // Cheap AO: low sun-facing gets full light, steep faces sit darker.
          diffuseColor.rgb *= mix(0.72, 1.0, wn.y);
        }`);
  };
  material.customProgramCacheKey = () => "m20-terrain-splat";
  const v3 = (a: [number, number, number]) => new THREE.Vector3(...a);
  return {
    material,
    setEnabled: (on) => { uniforms.uSplat.value = on ? 1 : 0; },
    setMaps: (m) => {
      uniforms.uGrass.value = m.tex.grass;
      uniforms.uSand.value = m.tex.sand;
      uniforms.uRock.value = m.tex.rock;
      uniforms.uDirt.value = m.tex.dirt;
      uniforms.uAvgGrass.value = v3(m.avg.grass);
      uniforms.uAvgSand.value = v3(m.avg.sand);
      uniforms.uAvgRock.value = v3(m.avg.rock);
      uniforms.uAvgDirt.value = v3(m.avg.dirt);
    },
    setParams: (p) => {
      uniforms.uSandAt.value = p.sandAt;
      uniforms.uRockAt.value = p.rockAt;
      uniforms.uSlopeRock.value = p.slopeRock;
    },
  };
}
