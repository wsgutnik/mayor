// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): facadeShader.js night-light block.

/**
 * Per-window night lights (docs/process/09-fable-buildings-port.md §3.2, task V1).
 *
 * Fable's rule: each window has stable hashes (hCell, hCell2); a window is lit
 * when hCell falls below `litBias · 0.68 · nightOn`, with a warm/cool colour
 * table and per-window brightness. Offices share 70 % of their lit state per
 * floor. Previously every glow_window quad switched on together at one
 * brightness and one colour.
 *
 * This module holds the CPU mirror (`windowLight`, unit-tested), the GLSL
 * chunk patched onto the shared `glow_window*` materials, and the
 * material-suffix → family contract V2 will emit (`glow_window_res`,
 * `_office`, `_shop`, `_ind`; bare `glow_window` defaults to litBias 0.6).
 */
import type * as THREE from "three";

/** nightOn = smoothstep(NIGHT_ON_LO, NIGHT_ON_HI, uNight); 0 % lit below 0.06. */
export const NIGHT_ON_LO = 0.06;
export const NIGHT_ON_HI = 0.42;
/** Lit fraction at full night = litBias · LIT_FRACTION. */
export const LIT_FRACTION = 0.68;
/** smoothstep half-width around the lit threshold (fable: frac ± 0.06). */
export const LIT_BAND = 0.06;
export const BRIGHT_LO = 0.22;
export const BRIGHT_HI = 0.85;
/** Final emissive gain (fable: emissive · 0.86). */
export const EMISSIVE_GAIN = 0.86;
/** Office lit state = mix(hCell, floorLamp, OFFICE_MIX). */
export const OFFICE_MIX = 0.7;
/** hCell2 above this → cool pane (8 % of homes/shops). */
export const COOL_CUT = 0.92;
/** hCell2 above this → cool pane in offices (65 %). */
export const OFFICE_COOL_CUT = 0.35;
/** Per-window id quantisation in tiles (local position floor). */
export const WINDOW_CELL = 0.02;
/** Office floor id = floor(localY / KIT_STOREY_TILE). */
export const KIT_STOREY_TILE = 0.25;

export type RGB = [number, number, number];
/** Warm ramp endpoints, cool home pane, cool office pane (fable §3.2). */
export const WARM_LO: RGB = [1.0, 0.56, 0.24];
export const WARM_HI: RGB = [1.0, 0.79, 0.53];
export const COOL_HOME: RGB = [0.62, 0.76, 1.0];
export const COOL_OFFICE: RGB = [0.84, 0.9, 1.0];
/** Blinds cut brightness to 42 % (fable: mix(1.0, 0.42, blinds)). */
export const BLINDS_DIM = 0.42;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export interface WindowLight {
  /** 0..1 lit amount (already includes nightOn; doors would force 0). */
  lit: number;
  color: RGB;
  bright: number;
}

/**
 * CPU mirror of the GLSL below. `h`/`h2` are the per-window hashes in [0,1);
 * for offices `floorLamp` is the shared per-floor hash (defaults to `h2` so
 * the pinned 5-argument call still shows floor coherence).
 */
export function windowLight(
  h: number, h2: number, night: number, litBias: number,
  office = false, floorLamp = h2, blinds = false,
): WindowLight {
  const nightOn = smoothstep(NIGHT_ON_LO, NIGHT_ON_HI, night);
  const cell = office ? h + (floorLamp - h) * OFFICE_MIX : h;
  const frac = clamp01(litBias * LIT_FRACTION * nightOn);
  // Fable writes smoothstep(frac + 0.06, frac − 0.06, cell) with reversed
  // edges (undefined in strict GLSL); 1 − smoothstep(frac − band, frac + band)
  // is the well-defined equivalent, used here and in the chunk.
  const lit = (1 - smoothstep(frac - LIT_BAND, frac + LIT_BAND, cell)) * nightOn;
  let color: RGB = [
    WARM_LO[0] + (WARM_HI[0] - WARM_LO[0]) * h2,
    WARM_LO[1] + (WARM_HI[1] - WARM_LO[1]) * h2,
    WARM_LO[2] + (WARM_HI[2] - WARM_LO[2]) * h2,
  ];
  if (h2 > COOL_CUT) color = [...COOL_HOME];
  if (office && h2 > OFFICE_COOL_CUT) color = [...COOL_OFFICE];
  const bright = (BRIGHT_LO + (BRIGHT_HI - BRIGHT_LO) * frac01(h * 17)) * (blinds ? BLINDS_DIM : 1);
  return { lit, color, bright };
}

function frac01(x: number): number {
  return x - Math.floor(x);
}

/** Final emissive RGB for a window (pane mask already applied by the caller). */
export function windowEmissive(w: WindowLight): RGB {
  return [w.color[0] * w.lit * w.bright * EMISSIVE_GAIN, w.color[1] * w.lit * w.bright * EMISSIVE_GAIN, w.color[2] * w.lit * w.bright * EMISSIVE_GAIN];
}

export interface WindowFamily {
  litBias: number;
  office: boolean;
}

/**
 * litBias per generator family (fable §3.2 table: house 0.70, apartment 0.60,
 * shop 0.75, office 0.55, industrial 0.35; `_res` covers houses and apartments
 * at the midpoint). Bare `glow_window` keeps the old default 0.6.
 */
export const WINDOW_FAMILIES: Record<string, WindowFamily> = {
  glow_window: { litBias: 0.6, office: false },
  glow_window_res: { litBias: 0.65, office: false },
  glow_window_shop: { litBias: 0.75, office: false },
  glow_window_office: { litBias: 0.55, office: true },
  glow_window_ind: { litBias: 0.35, office: false },
};

/** Family for a kit material name, or null when it is not a lit-window material. */
export function familyFor(materialName: string): WindowFamily | null {
  if (!materialName.startsWith("glow_window")) return null;
  return WINDOW_FAMILIES[materialName] ?? WINDOW_FAMILIES.glow_window;
}

/** GLSL float literal (1 → "1.0"; strict compilers reject bare ints). */
function g(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

/** Vertex declarations: instance translation + quantised local id per window. */
export const WINDOW_LIGHT_VERT_PARS = /* glsl */`
varying vec3 vWinInstance;
varying vec3 vWinLocal;
`;

/** After `#include <begin_vertex>` (`position` is the pre-instance local). */
export const WINDOW_LIGHT_VERT = /* glsl */`
vWinLocal = floor(position / ${WINDOW_CELL}) * ${WINDOW_CELL};
#ifdef USE_INSTANCING
vWinInstance = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
vWinInstance = vec3(0.0);
#endif
`;

export const WINDOW_LIGHT_FRAG_PARS = /* glsl */`
varying vec3 vWinInstance;
varying vec3 vWinLocal;
uniform float uNight;
uniform float uLitBias;
uniform float uOffice;
float wHash(vec3 a, vec3 b) {
  return fract(sin(dot(a, vec3(12.9898, 78.233, 37.719)) + dot(b, vec3(26.651, 51.257, 73.395))) * 43758.5453);
}
`;

/**
 * After `#include <emissivemap_fragment>`. The stock chunk leaves
 * totalEmissiveRadiance = emissive · intensity · pane mask; this multiplies
 * the per-window colour, lit state and brightness on top. The scene keeps
 * driving emissiveIntensity as the master night level and writes uNight
 * through `setWindowNight` in the same loop.
 */
export const WINDOW_LIGHT_FRAG = /* glsl */`
{
  float hCell = wHash(vWinInstance, vWinLocal);
  float hCell2 = wHash(vWinLocal + 7.3, vWinInstance + 3.1);
  float nightOn = smoothstep(${NIGHT_ON_LO}, ${NIGHT_ON_HI}, uNight);
  float fi = floor(vWinLocal.y / ${KIT_STOREY_TILE});
  float iseed = wHash(vWinInstance, vec3(1.0));
  float floorLamp = fract(sin(fi * 19.0 + iseed * 53.0 + 3.0) * 43758.5453);
  float cell = mix(hCell, mix(hCell, floorLamp, ${OFFICE_MIX}), uOffice);
  float frac = clamp(uLitBias * ${LIT_FRACTION} * nightOn, 0.0, 1.0);
  float lit = (1.0 - smoothstep(frac - ${LIT_BAND}, frac + ${LIT_BAND}, cell)) * nightOn;
  vec3 lc = mix(vec3(${g(WARM_LO[0])}, ${g(WARM_LO[1])}, ${g(WARM_LO[2])}), vec3(${g(WARM_HI[0])}, ${g(WARM_HI[1])}, ${g(WARM_HI[2])}), hCell2);
  lc = mix(lc, vec3(${g(COOL_HOME[0])}, ${g(COOL_HOME[1])}, ${g(COOL_HOME[2])}), step(${g(COOL_CUT)}, hCell2));
  lc = mix(lc, vec3(${g(COOL_OFFICE[0])}, ${g(COOL_OFFICE[1])}, ${g(COOL_OFFICE[2])}), uOffice * step(${g(OFFICE_COOL_CUT)}, hCell2));
  float bright = mix(${BRIGHT_LO}, ${BRIGHT_HI}, fract(hCell * 17.0));
  totalEmissiveRadiance *= lc * lit * bright * ${EMISSIVE_GAIN};
}
`;

interface WindowShader {
  uniforms: Record<string, { value: number }>;
  vertexShader: string;
  fragmentShader: string;
}

/** Patch a shared `glow_window*` material once, at creation in kit-materials. */
export function patchWindowMaterial(mat: THREE.MeshStandardMaterial, family: WindowFamily): void {
  mat.emissive.set("#ffffff");
  mat.onBeforeCompile = (shader) => {
    const s = shader as unknown as WindowShader;
    s.uniforms.uNight = { value: 0 };
    s.uniforms.uLitBias = { value: family.litBias };
    s.uniforms.uOffice = { value: family.office ? 1 : 0 };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\n${WINDOW_LIGHT_VERT_PARS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${WINDOW_LIGHT_VERT}`);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\n${WINDOW_LIGHT_FRAG_PARS}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${WINDOW_LIGHT_FRAG}`);
    (mat.userData as Record<string, unknown>).windowLightShader = s;
  };
  mat.customProgramCacheKey = () => `window-light-v1:${family.litBias}:${family.office ? 1 : 0}`;
}

/** Per-frame night level for a patched material; a no-op for anything else. */
export function setWindowNight(mat: THREE.MeshStandardMaterial, night: number): void {
  const s = (mat.userData as Record<string, unknown>).windowLightShader as WindowShader | undefined;
  if (s?.uniforms.uNight) s.uniforms.uNight.value = night;
}
