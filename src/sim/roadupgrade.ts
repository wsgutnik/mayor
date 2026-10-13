/**
 * Road class replacement in place (UI-2), importable under the task's path.
 *
 * The implementation lives in sim.ts beside planRoad/placeRoad so the executor
 * shares their refresh path (dirtyRoads, refreshOrientedLots) without an
 * import cycle; this module re-exports it so both `./sim` and `./roadupgrade`
 * resolve `upgradeRoad`.
 */
export { findUpgradeTarget, planRoadUpgrade, upgradeRoad } from "./sim";
export type { RoadUpgradePlan } from "./sim";
