/**
 * Why a build button is greyed out right now, before the player taps the map. Only facts that do not depend on
 * where the building goes are judged here: the sim still refuses placement-dependent cases (water, roads, lots)
 * with the usual reason toast. Mayor has no unlock tree, so there is no "not unlocked" case.
 */
import { COST, type CityState, type ToolId } from "../sim/sim";
import { FAC } from "../sim/world";

/** i18n key of the reason, or null when the tool can be used. */
export function toolAvailability(tool: ToolId, s: Pick<CityState, "money"> & { world: Pick<CityState["world"], "facility"> }): string | null {
  if (tool === "pan" || tool === "road") return null;
  if (tool === "cityhall" && s.world.facility.includes(FAC.CITYHALL)) return "There is already a city hall";
  if (COST[tool] > s.money) return "Not enough money";
  return null;
}
