import * as THREE from "three";

/** P1-C material targets, expressed in Mayor tiles (1 tile = 8 metres). */
export const MATERIAL_TARGETS = Object.freeze({
  environmentIntensityDay: 0.6,
  environmentIntensityNight: 0.3,
  roadWetRoughness: 0.32,
  roadDryRoughness: 0.9,
  roadWetAlbedoScale: 0.82,
  vehicleEnvBoostCap: 1.3,
  vehicleMetresToTiles: 0.0875,
});

export function applyMaterialTargets(material: THREE.MeshStandardMaterial, wet: number, environmentIntensity: number): void {
  material.roughness = THREE.MathUtils.lerp(MATERIAL_TARGETS.roadDryRoughness, MATERIAL_TARGETS.roadWetRoughness, wet);
  material.envMapIntensity = Math.min(0.6, Math.max(0, environmentIntensity));
}
