/**
 * Visual V2 prototype selection.
 * Production remains on /models/NN.glb unless explicitly opted in with
 * ?visualV2=1 AND the prototype has been exported to public/models/v2/.
 *
 * Deliberately separate from sim/catalog.ts: saves store functional IDs,
 * not visual model paths or detail levels.
 */
export const VISUAL_V2_REFERENCE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 30, 31, 33, 35, 36, 37, 38, 39] as const;
export type VisualV2ReferenceId = (typeof VISUAL_V2_REFERENCE_IDS)[number];
export type VisualLod = 0 | 1 | 2;

export function legacyBuildingUrl(id: number): string {
  if (!Number.isInteger(id) || id < 1 || id > 84) {
    throw new RangeError(`Invalid Mayor catalog building ID: ${id}`);
  }
  return `/models/${String(id).padStart(2, "0")}.glb`;
}

export function visualV2Url(id: number, lod: VisualLod): string | null {
  if (!VISUAL_V2_REFERENCE_IDS.some(candidate => candidate === id)) return null;
  return `/models/v2/${String(id).padStart(2, "0")}_lod${lod}.glb`;
}

export function visualV2PreviewEnabled(search?: string): boolean {
  const query = search ?? (typeof window !== "undefined" ? window.location.search : "");
  return new URLSearchParams(query).get("visualV2") === "1";
}

/** Explicit candidate chain, so missing/unexported V2 GLBs cannot erase buildings. */
export function buildingModelCandidates(id: number, optIn: boolean, lod: VisualLod = 0): string[] {
  const legacy = legacyBuildingUrl(id);
  const proposed = optIn ? visualV2Url(id, lod) : null;
  return proposed ? [proposed, legacy] : [legacy];
}

/** Failed previews are nonfatal. Used by the game and tested without network access. */
export async function firstLoadableModel<T>(
  candidates: readonly string[], load: (url: string) => Promise<T | null>,
): Promise<T | null> {
  for (const url of candidates) {
    try {
      const value = await load(url);
      if (value !== null) return value;
    } catch {
      // Continue to the established production fallback.
    }
  }
  return null;
}
