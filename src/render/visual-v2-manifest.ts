import { firstLoadableModel, legacyBuildingUrl, visualV2Url } from "./visual-v2";

/**
 * V2 assets are considered previewable only when accompanied by the manifest
 * written by scripts/verify_v2_assets.py. Production never requires this file.
 *
 * This is a packaging/quality gate, not a cryptographic runtime hash check.
 */
export const VISUAL_V2_MANIFEST_URL = "/models/v2/asset-manifest.json";
const REFERENCE_IDS = [1, 10, 20, 21, 38] as const;
const SHA256 = /^[0-9a-f]{64}$/;

interface V2Variant {
  lod: 0 | 1 | 2;
  url: string;
  bytes: number;
  triangles: number;
  sha256: string;
}

interface V2Asset {
  catalogId: number;
  variants: V2Variant[];
}

export interface ValidVisualV2Manifest {
  schemaVersion: 1;
  assets: V2Asset[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Return null for stale/malformed manifests; never let them override production. */
export function parseVisualV2Manifest(data: unknown): ValidVisualV2Manifest | null {
  if (!isRecord(data) || data.schemaVersion !== 1 || !Array.isArray(data.assets)) return null;
  if (data.assets.length !== REFERENCE_IDS.length) return null;
  const seen = new Set<number>();
  const assets: V2Asset[] = [];
  for (const item of data.assets) {
    if (!isRecord(item) || typeof item.catalogId !== "number" || !REFERENCE_IDS.some(n => n === item.catalogId)) return null;
    const id = item.catalogId;
    if (seen.has(id) || !Array.isArray(item.variants) || item.variants.length !== 3) return null;
    seen.add(id);
    const variants: V2Variant[] = [];
    for (const [lod, raw] of item.variants.entries()) {
      if (!isRecord(raw) || raw.lod !== lod ||
          raw.url !== visualV2Url(id, lod as 0 | 1 | 2) ||
          typeof raw.sha256 !== "string" || !SHA256.test(raw.sha256) ||
          typeof raw.bytes !== "number" || !Number.isSafeInteger(raw.bytes) || raw.bytes <= 0 ||
          typeof raw.triangles !== "number" || !Number.isSafeInteger(raw.triangles) || raw.triangles <= 0) return null;
      variants.push({ lod: lod as 0 | 1 | 2, url: raw.url as string, bytes: raw.bytes, triangles: raw.triangles, sha256: raw.sha256 });
    }
    if (!(variants[0].triangles >= variants[1].triangles &&
          variants[1].triangles >= variants[2].triangles &&
          variants[0].triangles > variants[2].triangles)) return null;
    assets.push({ catalogId: id, variants });
  }
  if (REFERENCE_IDS.some(n => !seen.has(n))) return null;
  return { schemaVersion: 1, assets };
}

let pendingManifest: Promise<ValidVisualV2Manifest | null> | null = null;

async function requestManifest(fetcher: typeof fetch): Promise<ValidVisualV2Manifest | null> {
  try {
    const response = await fetcher(VISUAL_V2_MANIFEST_URL);
    if (!response.ok) return null;
    return parseVisualV2Manifest(await response.json() as unknown);
  } catch {
    return null;
  }
}

/** Memoized manifest loading prevents per-building network requests. */
export function loadVisualV2Manifest(): Promise<ValidVisualV2Manifest | null> {
  pendingManifest ??= requestManifest(fetch);
  return pendingManifest;
}

/**
 * Uses a validated reference only with the explicit visualV2 preview option.
 * Without a manifest, with broken prototype GLBs, or for non-reference IDs,
 * always return the existing NN.glb or null (procedural fallback in scene.ts).
 */
export async function loadManifestGatedModel<T>(
  id: number,
  previewEnabled: boolean,
  loader: (url: string) => Promise<T | null>,
  manifestProvider: () => Promise<ValidVisualV2Manifest | null> = loadVisualV2Manifest,
): Promise<T | null> {
  const legacy = legacyBuildingUrl(id);
  if (!previewEnabled || visualV2Url(id, 0) === null) return loader(legacy);
  const manifest = await manifestProvider();
  const url = manifest?.assets.find(a => a.catalogId === id)?.variants[0]?.url;
  return url ? firstLoadableModel([url, legacy], loader) : loader(legacy);
}
