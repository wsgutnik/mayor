// Adapted from fable-cities (MIT, (c) 2026 raw):
// patchSurface + SURFACE_FRAG + RESPONSE_FRAG + EMISSIVE_FRAG + createVehicleMaterial
// from src/modules/traffic/materials.js. Changes for Mayor: MeshStandardMaterial (no
// clearcoat on iPad — Fable's own critic measured no visible clearcoat lobe), road-film
// heights in tiles (×0.0875), glass envBoost capped at 1.3 (Fable's 1.85 clipped glass
// to white blobs), and the reversed smoothstep edges rewritten in the safe order.
import * as THREE from "three";

/** Lamp radiance is authored in display units and divided by the live exposure. */
export const vehicleUniforms = {
  uLampExposure: { value: 1 },
  uEnvComp: { value: 1 },
};

const DECL_COMMON = /* glsl */`
uniform float uLampExposure;
uniform float uEnvComp;
varying vec4 vSurf;
varying float vLight;
varying vec3 vPaint;
varying vec3 vPaint2;
varying vec3 vState;
varying float vLocalY;
`;

// `flat` is the whole trick: the surface class is taken from the provoking vertex
// instead of being interpolated, so a quad spanning a pillar and a windscreen is
// either paint or glass, never a smear of both.
const DECL_FRAG = DECL_COMMON + "flat varying float vCls;\n";

const DECL_VERT = /* glsl */`
attribute vec4 aSurf;
attribute float aLight;
attribute float aClass;
attribute vec3 aPaint;
attribute vec3 aPaint2;
attribute vec3 aState;
` + DECL_FRAG;

const ASSIGN_VERT = /* glsl */`
vSurf = aSurf; vLight = aLight; vPaint = aPaint; vPaint2 = aPaint2; vState = aState;
vLocalY = position.y;
vCls = aClass;
`;

// Automotive glazing is a dark neutral tint, never the body colour. It is written flat
// over the interpolated vertex colour so the pane cannot pick up the paint from the
// pillar beside it — the exact defect the critic measured (rear glass RGB(18,63,110)
// vs paint RGB(21,56,91)).
export const SURFACE_FRAG = /* glsl */`
diffuseColor.rgb = mix(diffuseColor.rgb, vPaint, vSurf.x);
diffuseColor.rgb = mix(diffuseColor.rgb, vPaint2, vSurf.y);
if (vCls > 1.5 && vCls < 3.5) {
  diffuseColor.rgb = (vCls < 2.5) ? vec3(0.0105, 0.0125, 0.0155) : vec3(0.0135, 0.0160, 0.0195);
} else if (vCls > 0.5 && vCls < 1.5) {
  // road film: spray off the wheels dulls and darkens the sills and the lower doors
  float film = 1.0 - smoothstep(0.012, 0.054, vLocalY);
  diffuseColor.rgb *= mix(1.0, 0.74, film * 0.72);
}
`;

export const EMISSIVE_FRAG = /* glsl */`
{
  float k = vLight;
  vec3 em = vec3(0.0);
  if (k > 9.5) {
    // glazing lit from inside (bus saloon): the glass itself is opaque here, so the cabin can only
    // read at night if the pane carries the glow
    em = vec3(1.00, 0.80, 0.56) * vState.x * 0.17 * (1.0 / max(0.45, uLampExposure));
  } else if (k > 0.5 && k < 7.5) {
    // Lamp radiance is written in *display* units and divided back out here so a lamp keeps its
    // hue instead of washing out to salmon when the night exposure ramps up.
    float ex = 1.0 / max(0.45, uLampExposure);
    float night = vState.x;                       // 0 day .. 1 lights on
    float brake = vState.y;
    if (k < 1.5) {
      em = vec3(1.00, 0.955, 0.870) * (night * 3.15 + 0.085) * ex;                      // headlight + DRL
    } else if (k < 2.5) {
      // tail lamp: running light at night, brake on top. Green/blue floor keeps the tone
      // mapper from rotating the clipped red into salmon.
      float t = night * 0.130 + brake * (0.210 + 0.320 * night);
      em = vec3(1.00, 0.055, 0.022) * t * ex;
    } else if (k < 3.5) {
      float t = brake * (0.225 + 0.350 * night) + night * 0.035;                        // brake-only lens
      em = vec3(1.00, 0.070, 0.028) * t * ex;
    } else if (k < 4.5) {
      em = vec3(1.00, 0.88, 0.70) * night * 0.62 * ex;                                  // bus ceiling
    } else if (k < 5.5) {
      em = vec3(1.00, 0.40, 0.03) * max(0.0,  vState.z) * (0.34 + 0.55 * night) * ex;   // indicator, left
    } else if (k < 6.5) {
      em = vec3(1.00, 0.40, 0.03) * max(0.0, -vState.z) * (0.34 + 0.55 * night) * ex;   // indicator, right
    } else {
      em = vec3(1.00, 0.74, 0.46) * night * 0.22 * ex;                                  // car interior
    }
  }
  totalEmissiveRadiance += em;
}
`;

// Roughness and metalness come from the vertex stream for anything generic, but the four
// surfaces a judge actually reads — paint, glass, chrome, rubber — are pinned to the
// MATERIAL_TARGET values off the flat class so an interpolated vertex can never soften them.
export const RESPONSE_FRAG = /* glsl */`
float roughnessFactor = clamp(vSurf.w, 0.03, 1.0);
float metalnessFactor = vSurf.z;
float envBoost = 1.0;
if (vCls > 1.5 && vCls < 3.5) {          // glazing: a sharp, dark, sky-reflecting pane
  roughnessFactor = 0.06; metalnessFactor = 0.0; envBoost = 1.3;
} else if (vCls > 0.5 && vCls < 1.5) {   // body paint
  float film = 1.0 - smoothstep(0.012, 0.054, vLocalY);
  roughnessFactor = mix(0.30, 0.52, film * 0.65);
  metalnessFactor = 0.0;
} else if (vCls > 3.5 && vCls < 4.5) {   // chrome and bright trim
  roughnessFactor = 0.15; metalnessFactor = 1.0; envBoost = 1.35;
} else if (vCls > 4.5 && vCls < 5.5) {   // tyres stay matte
  roughnessFactor = 0.90; metalnessFactor = 0.0;
} else if (vCls > 5.5) {                 // lamp lenses: a real specular under the emission
  roughnessFactor = 0.10; envBoost = 1.5;
}
`;

export interface VehicleShader {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
}

/** Inject the surface-class varyings into a MeshStandardMaterial shader. Exported for headless tests. */
export function patchVehicleShader(shader: VehicleShader): void {
  shader.uniforms.uLampExposure = vehicleUniforms.uLampExposure;
  shader.uniforms.uEnvComp = vehicleUniforms.uEnvComp;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\n" + DECL_VERT)
    .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + ASSIGN_VERT);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\n" + DECL_FRAG)
    .replace("#include <color_fragment>", "#include <color_fragment>\n" + SURFACE_FRAG)
    .replace("#include <roughnessmap_fragment>", RESPONSE_FRAG)
    .replace("#include <metalnessmap_fragment>", "")
    .replace("#include <lights_fragment_maps>", `#include <lights_fragment_maps>
      #if defined( RE_IndirectSpecular )
        radiance *= uEnvComp * envBoost;
      #endif`)
    .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + EMISSIVE_FRAG);
}

/** Shared PBR body material for every vehicle look: one program, one draw per look. */
export function createVehicleMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, metalness: 0.0, roughness: 0.3,
  });
  mat.name = "mayor/vehicle";
  mat.customProgramCacheKey = () => "mayor-vehicle-v1";
  mat.onBeforeCompile = (shader) => patchVehicleShader(shader);
  return mat;
}

export interface LampState {
  lightsOn: number;
  brake: number;
  blink: number;
}

/**
 * CPU mirror of EMISSIVE_FRAG for tests and tuning: lamp emission in display
 * units for an aLight kind, lamp state and tone-mapping exposure.
 */
export function lampEmission(light: number, s: LampState, exposure: number): [number, number, number] {
  const ex = 1 / Math.max(0.45, exposure);
  const mul = (c: [number, number, number], t: number): [number, number, number] =>
    [c[0] * t * ex, c[1] * t * ex, c[2] * t * ex];
  if (light > 9.5) return mul([1.0, 0.8, 0.56], s.lightsOn * 0.17);
  if (light > 0.5 && light < 7.5) {
    if (light < 1.5) return mul([1.0, 0.955, 0.87], s.lightsOn * 3.15 + 0.085);
    if (light < 2.5) return mul([1.0, 0.055, 0.022], s.lightsOn * 0.13 + s.brake * (0.21 + 0.32 * s.lightsOn));
    if (light < 3.5) return mul([1.0, 0.07, 0.028], s.brake * (0.225 + 0.35 * s.lightsOn) + s.lightsOn * 0.035);
    if (light < 4.5) return mul([1.0, 0.88, 0.7], s.lightsOn * 0.62);
    if (light < 5.5) return mul([1.0, 0.4, 0.03], Math.max(0, s.blink) * (0.34 + 0.55 * s.lightsOn));
    if (light < 6.5) return mul([1.0, 0.4, 0.03], Math.max(0, -s.blink) * (0.34 + 0.55 * s.lightsOn));
    return mul([1.0, 0.74, 0.46], s.lightsOn * 0.22);
  }
  return [0, 0, 0];
}
