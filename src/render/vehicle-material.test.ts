import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createVehicleMaterial, lampEmission, patchVehicleShader, vehicleUniforms } from "./vehicle-material";
import { LIGHT } from "./vehicle-surface";

describe("vehicle material", () => {
  it("patches every anchor of the stock standard shader", () => {
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    patchVehicleShader(shader);
    expect(shader.uniforms.uLampExposure).toBe(vehicleUniforms.uLampExposure);
    expect(shader.uniforms.uEnvComp).toBe(vehicleUniforms.uEnvComp);
    expect(shader.vertexShader).toContain("attribute vec3 aPaint;");
    expect(shader.vertexShader).toContain("flat varying float vCls;");
    expect(shader.vertexShader).toContain("vCls = aClass;");
    expect(shader.fragmentShader).toContain("flat varying float vCls;");
    expect(shader.fragmentShader).toContain("vPaint");
    expect(shader.fragmentShader).toContain("totalEmissiveRadiance += em;");
    expect(shader.fragmentShader).toContain("radiance *= uEnvComp * envBoost;");
    // no leftover include is swallowed silently: the patch must consume each anchor
    for (const anchor of ["roughnessmap_fragment", "metalnessmap_fragment"]) {
      expect(shader.fragmentShader).not.toContain(`#include <${anchor}>`);
    }
  });

  it("carries its own program cache key so stock materials never reuse it", () => {
    const mat = createVehicleMaterial();
    expect(mat.customProgramCacheKey()).toBe("mayor-vehicle-v1");
    expect(mat.name).toBe("mayor/vehicle");
  });

  it("caps the glass environment boost at 1.3 (Fable's 1.85 blew out to white)", () => {
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    patchVehicleShader(shader);
    expect(shader.fragmentShader).toContain("envBoost = 1.3;");
    expect(shader.fragmentShader).not.toContain("envBoost = 1.85;");
  });

  it("lights headlamps only at night (plus a small day DRL) and keeps tails red", () => {
    const day = { lightsOn: 0, brake: 0, blink: 0 };
    const night = { lightsOn: 1, brake: 0, blink: 0 };
    const headDay = lampEmission(LIGHT.HEAD, day, 1);
    // DRL only: tiny, neutral-warm
    expect(headDay[0]).toBeCloseTo(0.085, 6);
    expect(headDay[1] / headDay[0]).toBeGreaterThan(0.9);
    const headNight = lampEmission(LIGHT.HEAD, night, 1);
    expect(headNight[0]).toBeGreaterThan(headDay[0] * 10);
    // tail at night with brake dwarfs the day headlamp, and stays saturated red
    const tailNight = lampEmission(LIGHT.TAIL, { ...night, brake: 1 }, 1);
    expect(tailNight[0]).toBeGreaterThan(headDay[0]);
    expect(tailNight[0] / tailNight[1]).toBeGreaterThan(5);
    expect(tailNight[0] / tailNight[2]).toBeGreaterThan(5);
    expect(lampEmission(LIGHT.NONE, night, 1)).toEqual([0, 0, 0]);
  });

  it("compensates exposure so lamps hold their hue when nights get brighter", () => {
    const night = { lightsOn: 1, brake: 1, blink: 0 };
    const low = lampEmission(LIGHT.TAIL, night, 0.85);
    const high = lampEmission(LIGHT.TAIL, night, 1.05);
    expect(low[0] / high[0]).toBeCloseTo(1.05 / 0.85, 6);
  });
});
