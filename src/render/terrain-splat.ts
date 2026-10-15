import * as THREE from "three";
import type { Biome } from "../sim/world";

/**
 * M20 — splat-mapped terrain material, with per-biome detail layer sets (docs/process/23-flora-assets.md).
 *
 * Five slots (grass, sand, rock, dirt, accent) mix by height, slope and two noise fields. Each slot holds one
 * texture chosen per biome and world seed (`terrainLayerSet`): the grey M20 detail maps or the owner-supplied
 * flora photos (grass fur, hedge, limestone, grey soil, red earth). The sampler count is FIXED at five whatever
 * the biome — a city swaps which textures fill the slots instead of adding samplers (iPad texture-unit budget).
 *
 * Every sample is normalised by its texture's average colour, so the biome tint baked in the vertex colours
 * survives. A slot's `look` may instead show the texture's own hue at the biome colour's luminance (so the
 * brightness never steps at a layer border, only the hue changes) and softens the photo's contrast around its
 * mean. The grey M20 layers use hue 0, contrast 1: exactly the old blend. Rock uses triplanar projection; flora
 * slots blend two rotated scales of the same sampler to hide the repeat. Until the first set for the current tier
 * finishes loading the material renders flat vertex colours (a later world swap keeps the previous set bound
 * until the new one is ready), falling back to the old 128 px grass texture if a file fails to load.
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

/** Where the accent slot grows: noise patches over the grass, or a band along the shore. */
export type AccentMode = "patch" | "shore";

export interface AccentParams {
  mode: AccentMode;
  /** 0..1 strength: the most grass the accent may take inside a patch or the shore band. */
  amount: number;
}

/** No accent: the five-slot blend reduces exactly to splatWeights(). */
export const NO_ACCENT: AccentParams = { mode: "patch", amount: 0 };

/** Shore band of the accent, above the sand: full just above the sand line, gone 0.7 higher. */
export function accentBand(h: number, mode: AccentMode, p: SplatParams = DEFAULT_SPLAT): number {
  return mode === "shore" ? 1 - sstep(p.sandAt + 0.1, p.sandAt + 0.8, h) : 1;
}

/**
 * Flora fade below the rock line. The vertex colours switch from grass to rock at `rockAt` while the rock
 * weight only starts there, so a tinted flora sample just under it would paint grey rock and snow red or green.
 * Accent weight and the dirt slot's hue keep fade to zero over the last 0.35 below `rockAt`.
 */
export function floraFade(h: number, p: SplatParams = DEFAULT_SPLAT): number {
  return 1 - sstep(p.rockAt - 0.35, p.rockAt, h);
}

/**
 * CPU mirror of the five-slot shader blend: [grass, sand, rock, dirt, accent], summing to 1. The accent only
 * takes a share of the grass weight (never sand, rock or dirt), driven by its own noise field `accentNoise`.
 */
export function splatWeightsEx(
  h: number, slope: number, noise: number, accentNoise: number,
  p: SplatParams = DEFAULT_SPLAT, a: AccentParams = NO_ACCENT,
): [number, number, number, number, number] {
  const [g, s, r, d] = splatWeights(h, slope, noise, p);
  const patch = a.mode === "shore" ? sstep(0.3, 0.6, accentNoise) : sstep(0.5, 0.72, accentNoise);
  const acc = g * Math.max(0, Math.min(1, a.amount)) * patch * accentBand(h, a.mode, p) * floraFade(h, p);
  return [g - acc, s, r, d, acc];
}

/** Rec. 709 luminance of a linear colour. */
export const luma = (c: readonly [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * How a slot's texture colours the ground. `hue` 0 = the biome colour with the texture's grain (M20), 1 = the
 * texture's own hue at the biome colour's luminance. `contrast` scales the texel's spread around its mean.
 */
export interface SlotLook { hue: number; contrast: number }
export const GREY_LOOK: SlotLook = { hue: 0, contrast: 1 };

type RGB = readonly [number, number, number];

/**
 * CPU mirror of the shader's per-slot colour for one texel `t` of a texture whose average colour is `avg`, over
 * the biome vertex colour `base` (all linear). Averaged over the texture, its luminance equals luma(base) for
 * any look: layer borders never step in brightness.
 */
export function slotColor(t: RGB, avg: RGB, look: SlotLook, base: RGB): [number, number, number] {
  const la = Math.max(luma(avg), 0.05);
  const lb = luma(base);
  return [0, 1, 2].map((i) => {
    const tp = avg[i] + (t[i] - avg[i]) * look.contrast;
    const grain = base[i] * tp / Math.max(avg[i], 0.05);
    const own = lb * tp / la;
    return grain + (own - grain) * look.hue;
  }) as [number, number, number];
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
export const SPLAT_SLOTS = ["grass", "sand", "rock", "dirt", "accent"] as const;
export type SplatSlot = (typeof SPLAT_SLOTS)[number];
/** Samplers the splat shader binds: one per slot, the same for every biome (iPad budget, see header). */
export const SPLAT_SAMPLERS = SPLAT_SLOTS.length;

/** Texture files (without tier suffix) under public/textures/. */
export const GREY_LAYERS = ["grass", "sand", "rock", "dirt"] as const;
export const FLORA_LAYERS = ["flora/grass_fur", "flora/hedge", "flora/limestone", "flora/soil_grey", "flora/earth_red"] as const;
export type LayerFile = (typeof GREY_LAYERS)[number] | (typeof FLORA_LAYERS)[number];

export interface SlotDef {
  file: LayerFile;
  look: SlotLook;
  /** World-space UV scale (1 = one repeat per 6 tiles). */
  scale: number;
  /** Blend a second, rotated sample of the same sampler to hide the repeat (flora photos). */
  antiTile: boolean;
}

export interface TerrainLayerSet {
  /** Stable id (biome + variant): the renderer reloads only when it changes. */
  id: string;
  slots: Record<SplatSlot, SlotDef>;
  accent: AccentParams;
  /** Offset of the accent noise field, from the world seed: patches differ per city but never per load. */
  accentOffset: [number, number];
}

const grey = (file: (typeof GREY_LAYERS)[number], scale: number): SlotDef => ({ file, look: GREY_LOOK, scale, antiTile: false });
const flora = (file: (typeof FLORA_LAYERS)[number], hue: number, contrast: number, scale: number): SlotDef =>
  ({ file, look: { hue, contrast }, scale, antiTile: true });

/** Flora looks, tuned in the running game (docs/img/terrain/): partial hue, softened photo contrast. */
const GRASS_FUR = flora("flora/grass_fur", 0.5, 0.55, 1.6);
const HEDGE = flora("flora/hedge", 0.45, 0.55, 1.8);
const LIMESTONE = flora("flora/limestone", 0.55, 0.55, 1.2);
const SOIL_GREY = flora("flora/soil_grey", 0.25, 0.8, 1.0);
const EARTH_RED = flora("flora/earth_red", 0.3, 0.8, 1.0);
/** Desert ground is already tan: red earth may show more of its own hue there. */
const EARTH_RED_DESERT = flora("flora/earth_red", 0.4, 0.7, 1.0);

const BASE: Record<"grass" | "sand" | "rock" | "dirt", SlotDef> = {
  grass: grey("grass", 1), sand: grey("sand", 1.3), rock: grey("rock", 1), dirt: grey("dirt", 0.8),
};

type Variant = { slots: Partial<Record<SplatSlot, SlotDef>> & { accent: SlotDef }; accent: AccentParams };

/**
 * Per-biome variants. A world picks one by seed; every variant fills all five slots, so the sampler count
 * never changes. Plains: grass fur meadows over grey soil; forest: hedge undergrowth; river and coast:
 * limestone along the shore and beach transition; mountain: red earth dirt and hedge scrub; desert: red earth
 * dirt and red rock cliffs with pale limestone flats.
 */
const VARIANTS: Record<Biome, Variant[]> = {
  plains: [
    { slots: { dirt: SOIL_GREY, accent: GRASS_FUR }, accent: { mode: "patch", amount: 0.6 } },
    { slots: { dirt: SOIL_GREY, accent: HEDGE }, accent: { mode: "patch", amount: 0.45 } },
  ],
  forest: [
    { slots: { accent: HEDGE }, accent: { mode: "patch", amount: 0.65 } },
    { slots: { dirt: SOIL_GREY, accent: HEDGE }, accent: { mode: "patch", amount: 0.55 } },
  ],
  river: [
    { slots: { dirt: SOIL_GREY, accent: LIMESTONE }, accent: { mode: "shore", amount: 0.65 } },
  ],
  coast: [
    { slots: { accent: LIMESTONE }, accent: { mode: "shore", amount: 0.7 } },
  ],
  mountain: [
    { slots: { dirt: EARTH_RED, accent: HEDGE }, accent: { mode: "patch", amount: 0.45 } },
    { slots: { dirt: EARTH_RED, accent: GRASS_FUR }, accent: { mode: "patch", amount: 0.5 } },
  ],
  desert: [
    { slots: { dirt: EARTH_RED_DESERT, rock: flora("flora/earth_red", 0.45, 0.55, 1.0), accent: LIMESTONE }, accent: { mode: "patch", amount: 0.5 } },
  ],
};

/** 32-bit integer hash (deterministic across platforms). */
function hash32(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The detail layer set of a world: biome first, then the seed picks a variant and the accent noise offset. */
export function terrainLayerSet(biome: Biome, seed = 0): TerrainLayerSet {
  const list = VARIANTS[biome] ?? VARIANTS.plains;
  const h = hash32(seed);
  const vi = h % list.length;
  const v = list[vi];
  const slots = { ...BASE, ...v.slots } as Record<SplatSlot, SlotDef>;
  const accentOffset: [number, number] = [((h >>> 8) & 1023) / 37, ((h >>> 18) & 1023) / 41];
  return { id: `${biome}-${vi}`, slots, accent: v.accent, accentOffset };
}

/** Runtime URL of a layer file for a tier. */
export const layerUrl = (file: LayerFile, tier: SplatTier): string => `/textures/${file}_${tier}.png`;

export interface SplatMaps {
  set: TerrainLayerSet;
  tex: Record<SplatSlot, THREE.Texture>;
  avg: Record<SplatSlot, [number, number, number]>;
}

/** Loaded textures and their averages per tier and file, shared by every layer set. */
const cache = new Map<string, { tex: THREE.Texture; avg: [number, number, number] } | Promise<{ tex: THREE.Texture; avg: [number, number, number] }>>();

function prep(tex: THREE.Texture, maxAniso: number, aniso: number): THREE.Texture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(aniso, maxAniso);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
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
    // The sampler returns linear values for these sRGB textures, so the divisor must be linear too.
    const a = averageOfPixels(ctx.getImageData(0, 0, 8, 8).data);
    return [Math.pow(a[0], 2.2), Math.pow(a[1], 2.2), Math.pow(a[2], 2.2)];
  } catch {
    return [0.55, 0.55, 0.55];
  }
}

function loadLayer(
  file: LayerFile, tier: SplatTier, fallback: THREE.Texture, maxAniso: number, aniso: number,
): Promise<{ tex: THREE.Texture; avg: [number, number, number] }> {
  const key = `${tier}:${file}`;
  const hit = cache.get(key);
  if (hit) {
    if (hit instanceof Promise) return hit;
    hit.tex.anisotropy = Math.min(aniso, maxAniso);
    return Promise.resolve(hit);
  }
  const p = new Promise<{ tex: THREE.Texture; avg: [number, number, number] }>((resolve) => {
    new THREE.TextureLoader().load(
      layerUrl(file, tier),
      (t) => resolve({ tex: prep(t, maxAniso, aniso), avg: averageOfTexture(t) }),
      undefined,
      () => resolve({ tex: fallback, avg: averageOfTexture(fallback) }),
    );
  }).then((v) => { cache.set(key, v); return v; });
  cache.set(key, p);
  return p;
}

/**
 * Lazily load the textures of one layer set for a tier; per-texture failures fall back to `fallback`
 * (the old grass texture) so the ground never renders magenta. Files are cached per tier and shared across
 * sets. Calls `onReady` once with the full set.
 */
export function loadSplatMaps(
  tier: SplatTier, set: TerrainLayerSet, fallback: THREE.Texture, maxAniso: number, aniso: number, onReady: (m: SplatMaps) => void,
): void {
  Promise.all(SPLAT_SLOTS.map((slot) => loadLayer(set.slots[slot].file, tier, fallback, maxAniso, aniso))).then((loaded) => {
    const tex = {} as Record<SplatSlot, THREE.Texture>;
    const avg = {} as Record<SplatSlot, [number, number, number]>;
    SPLAT_SLOTS.forEach((slot, i) => { tex[slot] = loaded[i].tex; avg[slot] = loaded[i].avg; });
    onReady({ set, tex, avg });
  });
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
  const vec3 = () => new THREE.Vector3(0.55, 0.55, 0.55);
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  const uniforms = {
    uSplat: { value: 0 },
    uGrass: { value: white as THREE.Texture },
    uSand: { value: white as THREE.Texture },
    uRock: { value: white as THREE.Texture },
    uDirt: { value: white as THREE.Texture },
    uAccent: { value: white as THREE.Texture },
    uAvgGrass: { value: vec3() },
    uAvgSand: { value: vec3() },
    uAvgRock: { value: vec3() },
    uAvgDirt: { value: vec3() },
    uAvgAccent: { value: vec3() },
    // Per slot: x = hue keep, y = contrast, z = UV scale, w = anti-tiling (0/1).
    uLookGrass: { value: new THREE.Vector4(0, 1, 1, 0) },
    uLookSand: { value: new THREE.Vector4(0, 1, 1.3, 0) },
    uLookRock: { value: new THREE.Vector4(0, 1, 1, 0) },
    uLookDirt: { value: new THREE.Vector4(0, 1, 0.8, 0) },
    uLookAccent: { value: new THREE.Vector4(0, 1, 1, 0) },
    // x = amount, y = shore mode (0/1), zw = noise offset.
    uAccentCfg: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSandAt: { value: DEFAULT_SPLAT.sandAt },
    uRockAt: { value: DEFAULT_SPLAT.rockAt },
    uSlopeRock: { value: DEFAULT_SPLAT.slopeRock },
  };

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
        uniform sampler2D uGrass, uSand, uRock, uDirt, uAccent;
        uniform vec3 uAvgGrass, uAvgSand, uAvgRock, uAvgDirt, uAvgAccent;
        uniform vec4 uLookGrass, uLookSand, uLookRock, uLookDirt, uLookAccent;
        uniform vec4 uAccentCfg;
        uniform float uSandAt, uRockAt, uSlopeRock;
        float m20hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float m20noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(m20hash(i), m20hash(i + vec2(1.0, 0.0)), u.x),
                     mix(m20hash(i + vec2(0.0, 1.0)), m20hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        // Same as slotColor() on the CPU: biome colour with the texture grain, mixed toward the texture's own hue
        // at the biome colour's luminance; contrast squeezes the texel toward its texture's mean first.
        vec3 m20look(vec3 t, vec3 avg, vec4 lk, vec3 base) {
          vec3 tp = mix(avg, t, lk.y);
          vec3 grain = base * tp / max(avg, vec3(0.05));
          vec3 own = dot(base, vec3(0.2126, 0.7152, 0.0722)) * tp / max(dot(avg, vec3(0.2126, 0.7152, 0.0722)), 0.05);
          return mix(grain, own, lk.x);
        }
        // Flora photos: a second sample, rotated and rescaled, breaks the visible repeat (same sampler, no extra unit).
        vec3 m20sample(sampler2D tex, vec2 uv, vec4 lk) {
          vec3 a = texture2D(tex, uv * lk.z).rgb;
          if (lk.w < 0.5) return a;
          vec2 r = mat2(0.8, -0.6, 0.6, 0.8) * uv * lk.z * 0.43 + vec2(0.31, 0.57);
          return mix(a, texture2D(tex, r).rgb, 0.45);
        }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        {
          vec3 wn = normalize(vSplatNormal);
          float slope = 1.0 - wn.y;
          vec2 wuv = vSplatPos.xz / 6.0;
          // Same blend as splatWeightsEx() on the CPU.
          float sandW = 1.0 - smoothstep(uSandAt, uSandAt + 0.4, vSplatPos.y);
          float rockW = max(smoothstep(uSlopeRock, uSlopeRock + 0.25, slope),
                            smoothstep(uRockAt, uRockAt + 1.5, vSplatPos.y));
          float dirtW = (1.0 - sandW) * (1.0 - rockW) * smoothstep(0.55, 0.8, m20noise(wuv * 3.0));
          float grassW = max(0.0, 1.0 - sandW - rockW - dirtW);
          float tot = max(grassW + sandW + rockW + dirtW, 1e-4);
          grassW /= tot; sandW /= tot; rockW /= tot; dirtW /= tot;
          float an = m20noise(wuv * 1.7 + uAccentCfg.zw);
          float shore = uAccentCfg.y;
          float patchW = mix(smoothstep(0.5, 0.72, an), smoothstep(0.3, 0.6, an), shore);
          float band = mix(1.0, 1.0 - smoothstep(uSandAt + 0.1, uSandAt + 0.8, vSplatPos.y), shore);
          float fade = 1.0 - smoothstep(uRockAt - 0.35, uRockAt, vSplatPos.y);
          float accW = grassW * clamp(uAccentCfg.x, 0.0, 1.0) * patchW * band * fade;
          grassW -= accW;
          vec3 base = diffuseColor.rgb;
          vec3 g = m20look(m20sample(uGrass, wuv, uLookGrass), uAvgGrass, uLookGrass, base);
          vec3 s = m20look(m20sample(uSand, wuv, uLookSand), uAvgSand, uLookSand, base);
          // Triplanar rock: no stretching on cliffs whatever their facing.
          vec3 blend = pow(abs(wn), vec3(3.0));
          blend /= (blend.x + blend.y + blend.z);
          vec3 rt = texture2D(uRock, vSplatPos.zy / 6.0 * uLookRock.z).rgb * blend.x
                  + texture2D(uRock, vSplatPos.xz / 6.0 * uLookRock.z).rgb * blend.y
                  + texture2D(uRock, vSplatPos.xy / 6.0 * uLookRock.z).rgb * blend.z;
          vec3 r = m20look(rt, uAvgRock, uLookRock, base);
          vec3 d = m20look(m20sample(uDirt, wuv, uLookDirt), uAvgDirt, uLookDirt * vec4(fade, 1.0, 1.0, 1.0), base);
          vec3 ac = accW > 0.001 ? m20look(m20sample(uAccent, wuv, uLookAccent), uAvgAccent, uLookAccent, base) : base;
          vec3 ground = g * grassW + s * sandW + r * rockW + d * dirtW + ac * accW;
          // Snow reads as flat white, not textured rock (vColor is linear: snow ~0.9, sand ~0.5).
          float snowM = smoothstep(0.7, 0.85, dot(vColor.rgb, vec3(0.3333)));
          ground = mix(ground, base, snowM);
          diffuseColor.rgb = mix(base, ground, uSplat);
          // Cheap AO: low sun-facing gets full light, steep faces sit darker.
          diffuseColor.rgb *= mix(0.72, 1.0, wn.y);
        }`);
  };
  material.customProgramCacheKey = () => "m20-terrain-splat-5";
  const look = (u: THREE.Vector4, d: SlotDef) => u.set(d.look.hue, d.look.contrast, d.scale, d.antiTile ? 1 : 0);
  return {
    material,
    setEnabled: (on) => { uniforms.uSplat.value = on ? 1 : 0; },
    setMaps: (m) => {
      // Called once per finished load (never per frame): vectors are updated in place.
      uniforms.uGrass.value = m.tex.grass;
      uniforms.uSand.value = m.tex.sand;
      uniforms.uRock.value = m.tex.rock;
      uniforms.uDirt.value = m.tex.dirt;
      uniforms.uAccent.value = m.tex.accent;
      uniforms.uAvgGrass.value.set(...m.avg.grass);
      uniforms.uAvgSand.value.set(...m.avg.sand);
      uniforms.uAvgRock.value.set(...m.avg.rock);
      uniforms.uAvgDirt.value.set(...m.avg.dirt);
      uniforms.uAvgAccent.value.set(...m.avg.accent);
      look(uniforms.uLookGrass.value, m.set.slots.grass);
      look(uniforms.uLookSand.value, m.set.slots.sand);
      look(uniforms.uLookRock.value, m.set.slots.rock);
      look(uniforms.uLookDirt.value, m.set.slots.dirt);
      look(uniforms.uLookAccent.value, m.set.slots.accent);
      uniforms.uAccentCfg.value.set(m.set.accent.amount, m.set.accent.mode === "shore" ? 1 : 0, ...m.set.accentOffset);
    },
    setParams: (p) => {
      uniforms.uSandAt.value = p.sandAt;
      uniforms.uRockAt.value = p.rockAt;
      uniforms.uSlopeRock.value = p.slopeRock;
    },
  };
}
