/** Facts the road menu shows per class (one source: world.ts costs, corridor.ts profiles, traffic.ts capacity). */
import { profileOf } from "../sim/corridor";
import { ROAD_CAPACITY } from "../sim/traffic";
import { isOneWayType, ROAD_COST, ROAD_NAME, ROAD_TILE_WIDTH, ROAD_UPKEEP, type RoadType } from "../sim/world";
import type { RoadLevel, RoadMode, ToolState } from "./tool-state";

export interface RoadFacts {
  type: RoadType;
  /** i18n key. */
  name: string;
  costPerTile: number;
  upkeepPerTile: number;
  lanes: number;
  oneWay: boolean;
  /** Tiles of width on the grid. */
  widthTiles: number;
  /** Cars a tile carries at free flow (traffic.ts ROAD_CAPACITY). */
  capacity: number;
}

export function roadFacts(type: RoadType): RoadFacts {
  return {
    type, name: ROAD_NAME[type], costPerTile: ROAD_COST[type], upkeepPerTile: ROAD_UPKEEP[type],
    lanes: profileOf(type).lanes, oneWay: isOneWayType(type), widthTiles: ROAD_TILE_WIDTH[type], capacity: ROAD_CAPACITY[type],
  };
}

export const ROAD_MODE_LABEL: Record<RoadMode, string> = { line: "Line", curve: "Curve" };
export const ROAD_LEVEL_LABEL: Record<RoadLevel, string> = { ground: "Ground", elevated: "Elevated", tunnel: "Underground" };

/**
 * One-line summary of the current road selection for the flyout header, e.g. "Avenue · Curve · Ground · $45/tile",
 * with " · Upgrade" or " · Interchange" appended while those modes are armed.
 */
export function roadSummary(s: Pick<ToolState, "roadType" | "roadMode" | "roadLevel" | "upgradeMode" | "pendingInterchange">, tr: (k: string) => string): string {
  const f = roadFacts(s.roadType);
  const parts = [tr(f.name), tr(ROAD_MODE_LABEL[s.roadMode]), tr(ROAD_LEVEL_LABEL[s.roadLevel]), `$${f.costPerTile}/${tr("tile")}`];
  if (s.pendingInterchange) parts.push(tr("Interchange"));
  else if (s.upgradeMode) parts.push(tr("Upgrade road"));
  return parts.join(" · ");
}
