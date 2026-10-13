import { describe, expect, it } from "vitest";
import { roadLayerForColor } from "./road-material";

describe("roadLayerForColor", () => {
  it("sends carriageways to the asphalt detail", () => {
    expect(roadLayerForColor("#3b3f46")).toBe("asphalt");
    expect(roadLayerForColor("#4a4f57")).toBe("asphalt");
  });

  it("sends the kerb band to the kerb/sidewalk mix", () => {
    expect(roadLayerForColor("#c4c7cc")).toBe("kerb");
  });

  it("keeps markings, median and edges flat", () => {
    for (const c of ["#d8d4b0", "#e8e4c8", "#5f8a4a", "#f1f1ea", "#b8bec6"]) {
      expect(roadLayerForColor(c)).toBe("flat");
    }
  });

  it("is case-insensitive", () => {
    expect(roadLayerForColor("#C4C7CC")).toBe("kerb");
  });
});
