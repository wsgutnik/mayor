import { describe, expect, it } from "vitest";
import type { TileInfo } from "../sim/inspect";
import {
  clampLandValue,
  isCompact,
  levelDots,
  localizedName,
  localizedUse,
  peopleLabelKey,
  serviceChips,
} from "./inspector-model";

const services = (over: Partial<TileInfo["services"]> = {}): TileInfo["services"] => ({
  power: false,
  water: false,
  sewage: false,
  garbage: false,
  police: false,
  fire: false,
  health: false,
  education: false,
  culture: false,
  transit: false,
  ...over,
});

describe("inspector-model", () => {
  it("builds the chip list in order with present flags", () => {
    const chips = serviceChips(services({ power: true, fire: true }));
    expect(chips.map((c) => c.key)).toEqual([
      "power",
      "water",
      "sewage",
      "garbage",
      "police",
      "fire",
      "health",
      "education",
      "culture",
      "transit",
    ]);
    expect(chips.find((c) => c.key === "power")!.present).toBe(true);
    expect(chips.find((c) => c.key === "fire")!.present).toBe(true);
    expect(chips.find((c) => c.key === "water")!.present).toBe(false);
    expect(chips.every((c) => typeof c.labelKey === "string" && c.labelKey.length > 0)).toBe(true);
  });

  it("renders level as three dots", () => {
    expect(levelDots(1)).toEqual([true, false, false]);
    expect(levelDots(2)).toEqual([true, true, false]);
    expect(levelDots(3)).toEqual([true, true, true]);
    expect(levelDots(0)).toEqual([false, false, false]);
    expect(levelDots(9)).toEqual([true, true, true]);
  });

  it("picks name and use line by language", () => {
    const info = { name: "Delegacia", nameEn: "Police Station", use: "polícia", useEn: "police" };
    expect(localizedName(info, "pt")).toBe("Delegacia");
    expect(localizedName(info, "en")).toBe("Police Station");
    expect(localizedUse(info, "pt")).toBe("polícia");
    expect(localizedUse(info, "en")).toBe("police");
  });

  it("maps people kind to its label key", () => {
    expect(peopleLabelKey({ peopleKind: "residents" })).toBe("Residents");
    expect(peopleLabelKey({ peopleKind: "jobs" })).toBe("Jobs");
    expect(peopleLabelKey({ peopleKind: "none" })).toBeNull();
  });

  it("marks only roads and open ground as compact", () => {
    expect(isCompact({ kind: "road" })).toBe(true);
    expect(isCompact({ kind: "empty" })).toBe(true);
    expect(isCompact({ kind: "building" })).toBe(false);
    expect(isCompact({ kind: "facility" })).toBe(false);
    expect(isCompact({ kind: "zone" })).toBe(false);
  });

  it("clamps land value to the 0..100 bar", () => {
    expect(clampLandValue(42)).toBe(42);
    expect(clampLandValue(-5)).toBe(0);
    expect(clampLandValue(140)).toBe(100);
  });
});
