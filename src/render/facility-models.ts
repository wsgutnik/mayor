import { facilityEntry } from "../sim/catalog";
import { FacilityKind, facilityFootprint } from "../sim/world";

/**
 * Which Blender model a service building wears (docs/process/24-service-usage.md, item 3).
 *
 * - 2x2 kinds: the footprint-filling `models/x2/NN.glb`; until it loads (or if it is missing) the 1x1
 *   procedural model is scaled by FACILITY_FALLBACK_SCALE.
 * - 1x1 kit kinds (catalog 1-40): `models/NN.glb` through the Visual V2 manifest gate.
 * - 1x1 expansion kinds (catalog 41-84): `models/x1/NN.glb`, kept out of the 40-file kit directory.
 */
export interface FacilityModelPlan {
  /** Catalog number, or undefined when the kit has no entry for the kind. */
  n: number | undefined;
  /** Runtime URL of the model, or null when there is none to load. */
  url: string | null;
  /** "x2": footprint-filling 2x2 model; "kit": manifest-gated 1x1 kit model; "x1": 1x1 expansion model. */
  dir: "x2" | "kit" | "x1" | null;
}

/** Scale of the 1x1 procedural stand-in on a 2x2 footprint while its x2 model loads. */
export const FACILITY_FALLBACK_SCALE = 1.8;

const pad = (n: number) => String(n).padStart(2, "0");

export function facilityModelPlan(kind: FacilityKind): FacilityModelPlan {
  const n = facilityEntry(kind)?.n;
  if (n === undefined) return { n, url: null, dir: null };
  if (facilityFootprint(kind) === 2) return { n, url: `/models/x2/${pad(n)}.glb`, dir: "x2" };
  if (n <= 40) return { n, url: `/models/${pad(n)}.glb`, dir: "kit" };
  return { n, url: `/models/x1/${pad(n)}.glb`, dir: "x1" };
}

/** Render scale of a facility model: the 2x2 stand-in is enlarged until its x2 model arrives; 1x1 kinds never are. */
export function facilityFallbackScale(kind: FacilityKind, x2Loaded: boolean): number {
  return facilityFootprint(kind) === 2 && !x2Loaded ? FACILITY_FALLBACK_SCALE : 1;
}
