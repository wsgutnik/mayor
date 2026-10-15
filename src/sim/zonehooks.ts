/**
 * The zone pipeline entry points sim.ts and save.ts call. A plain object so the differential test
 * (zone-perf.diff.test.ts) can swap in the frozen pre-zperf implementation (src/sim/zone-oracle/) and assert that the
 * incremental pipeline produces byte-identical zones, levels, lots and mirror. Game code never reassigns it.
 */
import { buildZoneBlocks, nearestCell } from "./zoneblocks";
import { planOrientedLots } from "./orientedlots";
import { rasterizeMirror } from "./mirror";
import { lotRectOnRoad, roadSurface } from "./roadsurface";

export const zoneHooks = { buildZoneBlocks, nearestCell, planOrientedLots, rasterizeMirror, lotRectOnRoad, roadSurface };
export type ZoneHooks = typeof zoneHooks;
