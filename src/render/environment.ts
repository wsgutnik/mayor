import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

export const ENVIRONMENT_URL = "/env/kloofendal_48d_partly_cloudy_puresky_1k.hdr";

/** Load the P1 HDRI without making environment art a hard dependency. */
export function loadEnvironment(renderer: THREE.WebGLRenderer, onReady?: (texture: THREE.Texture) => void): void {
  new RGBELoader().load(ENVIRONMENT_URL, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(texture).texture;
    texture.dispose();
    pmrem.dispose();
    onReady?.(env);
  }, undefined, () => { /* Optional asset: the authored sky remains the fallback. */ });
}
