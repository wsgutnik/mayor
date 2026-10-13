import { describe, expect, it, vi } from "vitest";
import {
  loadManifestGatedModel,
  parseVisualV2Manifest,
  VISUAL_V2_MANIFEST_URL,
} from "./visual-v2-manifest";

function goodManifest() {
  return {
    schemaVersion: 1,
    assets: [1, 10, 20, 21, 38].map(id => ({
      catalogId: id,
      variants: [0, 1, 2].map((lod) => ({
        lod,
        url: "/models/v2/" + String(id).padStart(2, "0") + "_lod" + lod + ".glb",
        bytes: 800 - lod * 100,
        triangles: 300 - lod * 100,
        sha256: "a".repeat(64),
      })),
    })),
  };
}

describe("Visual V2 manifest quality gate", () => {
  it("checks all five buildings and their three ordered LODs", () => {
    const parsed = parseVisualV2Manifest(goodManifest());
    expect(parsed?.assets).toHaveLength(5);
    expect(parsed?.assets[2].variants.map(v => v.triangles)).toEqual([300, 200, 100]);
  });

  it("refuses incomplete, duplicated or tampered manifests", () => {
    const incomplete = goodManifest();
    incomplete.assets.pop();
    expect(parseVisualV2Manifest(incomplete)).toBeNull();

    const duplicated = goodManifest();
    duplicated.assets[1].catalogId = 1;
    expect(parseVisualV2Manifest(duplicated)).toBeNull();

    const badHash = goodManifest();
    badHash.assets[0].variants[0].sha256 = "bogus";
    expect(parseVisualV2Manifest(badHash)).toBeNull();

    const invalidUrl = goodManifest();
    invalidUrl.assets[0].variants[0].url = "/wrong-path.glb";
    expect(parseVisualV2Manifest(invalidUrl)).toBeNull();

    const wrongOrder = goodManifest();
    wrongOrder.assets[0].variants[2].triangles = 1000;
    expect(parseVisualV2Manifest(wrongOrder)).toBeNull();
  });

  it("preserves production loading with preview off without consulting the manifest", async () => {
    const loader = vi.fn(async (url: string) => ({ url }));
    const provider = vi.fn(async () => parseVisualV2Manifest(goodManifest()));
    await expect(loadManifestGatedModel(21, false, loader, provider))
      .resolves.toEqual({ url: "/models/21.glb" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("does not fetch a manifest for a non-reference catalog building", async () => {
    const provider = vi.fn(async () => parseVisualV2Manifest(goodManifest()));
    const loader = vi.fn(async (url: string) => ({ url }));
    await expect(loadManifestGatedModel(4, true, loader, provider))
      .resolves.toEqual({ url: "/models/04.glb" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("falls back when the manifest is unavailable", async () => {
    const loader = vi.fn(async (url: string) => ({ url }));
    await expect(loadManifestGatedModel(21, true, loader, async () => null))
      .resolves.toEqual({ url: "/models/21.glb" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("loads the verified opt-in model, then recovers if its GLB is missing", async () => {
    const provider = async () => parseVisualV2Manifest(goodManifest());
    const ready = vi.fn(async (url: string) => ({ url }));
    await expect(loadManifestGatedModel(21, true, ready, provider))
      .resolves.toEqual({ url: "/models/v2/21_lod0.glb" });
    expect(ready).toHaveBeenCalledTimes(1);

    const unavailable = vi.fn(async (url: string) => url.includes("/v2/") ? null : { url });
    await expect(loadManifestGatedModel(38, true, unavailable, provider))
      .resolves.toEqual({ url: "/models/38.glb" });
    expect(unavailable).toHaveBeenCalledTimes(2);
  });

  it("uses the stable asset-manifest endpoint", () => {
    expect(VISUAL_V2_MANIFEST_URL).toBe("/models/v2/asset-manifest.json");
  });
});
