import type { Builder, Maker } from "./models";
import type { FacilityKind } from "../sim/world";

/**
 * Models faithful to the Basic Buildings Kit, keyed by kit number (1-40, see src/sim/catalog.ts).
 * An entry here replaces the generic placeholder for that building. Keep every model inside the tile
 * footprint (|x|,|z| <= 0.5), base at y = 0, front facing +z, and within the triangle budget in models.test.ts.
 */
export const KIT_MAKERS: Partial<Record<number, Maker>> = {};

/** Overrides for player-placed facilities, keyed by facility kind (see FAC in src/sim/world.ts). */
export const KIT_FACILITY_MAKERS: Partial<Record<FacilityKind, Maker>> = {};

export type { Builder };
