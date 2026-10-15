import * as THREE from "three";

export interface AtmosphereState { day: number; dusk: number; wet: number; exposure: number; }

/** Reusable colour scratch state; callers update existing objects, never allocate per tick. */
export function updateAtmosphereState(out: AtmosphereState, sky: THREE.Color, tod: number, raining: boolean, background: THREE.Color): void {
  const elev = Math.sin((tod - 0.25) * Math.PI * 2);
  out.day = Math.max(0, Math.min(1, elev * 1.3 + 0.25));
  out.wet = raining ? 0.6 : 1;
  out.dusk = Math.max(0, Math.min(1, 1 - Math.abs(elev) * 3.2)) * (elev > -0.3 ? 1 : 0);
  sky.set("#0a1224").lerp(_daySky, out.day).lerp(_duskSky, out.dusk * 0.45);
  if (raining) sky.lerp(_rainSky, 0.55);
  background.copy(sky);
  out.exposure = 0.9 + out.day * 0.25 - out.dusk * 0.05;
}
const _daySky = new THREE.Color("#a9c8e8");
const _duskSky = new THREE.Color("#f0a070");
const _rainSky = new THREE.Color("#6f7d8c");
