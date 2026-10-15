import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * Cinematic post chain: scene -> subtle bloom -> output (tone mapping/sRGB
 * are applied by OutputPass, which reads the renderer's settings).
 * Bloom settings are deliberately restrained: only genuinely bright
 * sources (lit windows, lamps, sun glints) cross the threshold, so the
 * daytime city does not glow. Enabled only on the high quality tier.
 */
export const BLOOM_STRENGTH = 0.35;
export const BLOOM_RADIUS = 0.55;
export const BLOOM_THRESHOLD = 0.82;

export interface PostFx {
  render(): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  setEnabled(enabled: boolean): void;
  /** Bloom strength; the scene lowers it in daylight so sun glints stay calm. */
  setStrength(strength: number): void;
  readonly enabled: boolean;
  dispose(): void;
}

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostFx {
  // MSAA render target so the composer path keeps the direct path's edge quality.
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let enabled = true;
  return {
    get enabled() { return enabled; },
    setEnabled(next: boolean) {
      enabled = next;
      bloom.enabled = next;
    },
    setStrength(strength: number) {
      bloom.strength = strength;
    },
    render() {
      if (enabled) composer.render();
      else renderer.render(scene, camera);
    },
    setSize(width: number, height: number, pixelRatio: number) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    dispose() {
      composer.dispose();
    },
  };
}
