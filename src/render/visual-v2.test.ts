import { describe, expect, it, vi } from "vitest";
import {
  VISUAL_V2_REFERENCE_IDS,
  buildingModelCandidates,
  firstLoadableModel,
  legacyBuildingUrl,
  visualV2PreviewEnabled,
  visualV2Url,
} from "./visual-v2";

describe("Visual V2 reference asset resolver", () => {
  it("declares only the five approved reference catalog IDs", () => {
    expect(VISUAL_V2_REFERENCE_IDS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 30, 31, 33, 35, 36, 37, 38, 39]);
  });

  it("keeps all existing building paths when the preview flag is off", () => {
    for (let id = 1; id <= 40; id++) {
      expect(buildingModelCandidates(id, false)).toEqual([legacyBuildingUrl(id)]);
    }
  });

  it("resolves three LODs for each reference without affecting other buildings", () => {
    for (const id of VISUAL_V2_REFERENCE_IDS) {
      expect(visualV2Url(id, 0)).toBe(`/models/v2/${String(id).padStart(2, "0")}_lod0.glb`);
      expect(visualV2Url(id, 1)).toBe(`/models/v2/${String(id).padStart(2, "0")}_lod1.glb`);
      expect(visualV2Url(id, 2)).toBe(`/models/v2/${String(id).padStart(2, "0")}_lod2.glb`);
      expect(buildingModelCandidates(id, true)).toEqual([
        visualV2Url(id, 0), legacyBuildingUrl(id),
      ]);
    }
    expect(buildingModelCandidates(27, true)).toEqual(["/models/27.glb"]);
    expect(visualV2Url(27, 0)).toBeNull();
  });

  it("rejects invalid catalog IDs rather than fetching fabricated paths", () => {
    expect(() => legacyBuildingUrl(0)).toThrow(RangeError);
    expect(() => legacyBuildingUrl(85)).toThrow(RangeError);
    expect(() => legacyBuildingUrl(1.5)).toThrow(RangeError);
  });

  it("is on by default and only disabled with visualV2=0", () => {
    expect(visualV2PreviewEnabled("")).toBe(true);
    expect(visualV2PreviewEnabled("?visualV2=1")).toBe(true);
    expect(visualV2PreviewEnabled("?visualV2=0")).toBe(false);
  });

  it("returns the legacy GLB if a reference asset does not load", async () => {
    const load = vi.fn(async (url: string) => url.includes("/v2/") ? null : { url });
    await expect(firstLoadableModel(buildingModelCandidates(21, true), load))
      .resolves.toEqual({ url: "/models/21.glb" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("handles a thrown preview load and stops after a successful reference load", async () => {
    const load = vi.fn(async (url: string) => {
      if (url.includes("/v2/")) throw new Error("preview file unavailable");
      return { url };
    });
    await expect(firstLoadableModel(buildingModelCandidates(1, true), load))
      .resolves.toEqual({ url: "/models/01.glb" });
    const success = vi.fn(async (url: string) => ({ url }));
    await expect(firstLoadableModel(buildingModelCandidates(10, true), success))
      .resolves.toEqual({ url: "/models/v2/10_lod0.glb" });
    expect(success).toHaveBeenCalledTimes(1);
  });

  it("returns null only when every candidate fails", async () => {
    expect(await firstLoadableModel(["a", "b"], async () => null)).toBeNull();
  });
});
