// Adapted from fable-cities (MIT, (c) 2026 raw):
// the texel-footprint bias in Engine._applyCascadeShadow
// (src/modules/core/Engine.js). Mayor's shadow frustum span runs 8→60 tiles with
// zoom, so a constant bias peter-pans up close and acnes far out; derive it here.
export interface ShadowTune {
  bias: number;
  normalBias: number;
  radius: number;
}

/**
 * Shadow bias from the texel footprint. Mayor units: span in tiles, mapSize in
 * texels, near/far in world units. normalBias is capped at 0.11 tile (0.9 m).
 */
export function shadowBias(span: number, mapSize: number, near: number, far: number): ShadowTune {
  const texel = (2 * span) / Math.max(1, mapSize);
  const normalBias = Math.min(0.11, texel * 1.9);
  const bias = -(0.005 + texel * 0.55) / Math.max(1e-6, far - near);
  const radius = Math.max(1.15, Math.min(4.2, 0.0625 / Math.max(1e-9, texel)));
  return { bias, normalBias, radius };
}
