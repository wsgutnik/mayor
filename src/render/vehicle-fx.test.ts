import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CONTACT_DARK, ContactShadows, createContactShadowMaterial } from "./vehicle-fx";

describe("contact shadows", () => {
  it("multiply-blends below the markings (darken-only, polygon-offset)", () => {
    const mat = createContactShadowMaterial();
    expect(mat.blending).toBe(THREE.CustomBlending);
    expect(mat.blendSrc).toBe(THREE.ZeroFactor);
    expect(mat.blendDst).toBe(THREE.SrcColorFactor);
    expect(mat.blendEquation).toBe(THREE.AddEquation);
    expect(mat.depthWrite).toBe(false);
    expect(mat.polygonOffset).toBe(true);
    expect(mat.polygonOffsetFactor).toBe(-6);
  });

  it("draws exactly one decal per added vehicle and caps without crashing", () => {
    const fx = new ContactShadows(3);
    const m = new THREE.Matrix4();
    fx.begin();
    expect(fx.add(m, CONTACT_DARK)).toBe(true);
    expect(fx.add(m, CONTACT_DARK)).toBe(true);
    expect(fx.add(m, CONTACT_DARK)).toBe(true);
    expect(fx.add(m, CONTACT_DARK)).toBe(false);
    fx.end();
    expect(fx.count).toBe(3);
    expect(fx.mesh.count).toBe(3);
    expect(fx.mesh.visible).toBe(true);
    fx.begin();
    fx.end();
    expect(fx.mesh.count).toBe(0);
    expect(fx.mesh.visible).toBe(false);
  });
});
