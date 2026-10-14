import * as THREE from "three";
import { SURF } from "../sim/lotground";

/**
 * Instance tints for the V3 ground-plan surfaces over the shared plot
 * texture (PAVE matches the old PLOT_TINT; LAWN greens the mown strips and
 * beds). NONE rects emit no instance: the terrain grass shows through.
 */
export const GROUND_SURFACE_TINT: Record<number, string> = {
  [SURF.PAVE]: "#b9b3a6",
  [SURF.ASPH]: "#55575e",
  [SURF.CONC]: "#d8dbde",
  [SURF.LAWN]: "#79a657",
};

export interface PlotMaterialOpts {
  texture: THREE.Texture | null;
  anisotropy: number;
  maxAnisotropy: number;
  enabled: boolean;
}

/** Lot pad material with world-space XZ UVs, so scaled or rotated plots keep one repeat per tile. */
export function createPlotMaterial(opts: PlotMaterialOpts): THREE.MeshLambertMaterial {
  if (opts.texture) {
    opts.texture.wrapS = opts.texture.wrapT = THREE.RepeatWrapping;
    opts.texture.colorSpace = THREE.SRGBColorSpace;
    opts.texture.anisotropy = Math.min(opts.anisotropy, opts.maxAnisotropy);
    opts.texture.generateMipmaps = true;
    opts.texture.minFilter = THREE.LinearMipmapLinearFilter;
  }
  const material = new THREE.MeshLambertMaterial({ color: "#ffffff", map: opts.enabled ? opts.texture : null });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPlotUv;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>
        vec4 plotWorld = instanceMatrix * vec4(position, 1.0);
        vPlotUv = plotWorld.xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPlotUv;")
      .replace("vec4 sampledDiffuseColor = texture2D( map, vMapUv );", "vec4 sampledDiffuseColor = texture2D( map, vPlotUv );");
  };
  material.customProgramCacheKey = () => "plot-world-uv-v1";
  return material;
}
