import { describe, expect, it } from "vitest";
import { MapListing } from "../sim/maps";
import { difficultyKey, localizedDescription, localizedName, sortMapsByDifficulty } from "./maps-list";

const stub = (id: string, difficulty: MapListing["difficulty"]): MapListing => ({
  id,
  name: `Nome ${id}`,
  nameEn: `Name ${id}`,
  description: `Desc ${id}`,
  descriptionEn: `DescEn ${id}`,
  difficulty,
  terrain: "plains",
  size: 128,
  data: `/maps/${id}.json`,
  preview: `/maps/${id}.jpg`,
});

describe("maps-list", () => {
  it("sorts beginner before medium before advanced without mutating the input", () => {
    const input = [stub("c", "advanced"), stub("a", "beginner"), stub("b", "medium")];
    const sorted = sortMapsByDifficulty(input);
    expect(sorted.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(input.map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  it("maps difficulty to the English i18n key", () => {
    expect(difficultyKey("beginner")).toBe("Beginner");
    expect(difficultyKey("medium")).toBe("Medium");
    expect(difficultyKey("advanced")).toBe("Advanced");
  });

  it("picks name and description in the current language", () => {
    const m = stub("x", "medium");
    expect(localizedName(m, "pt")).toBe("Nome x");
    expect(localizedName(m, "en")).toBe("Name x");
    expect(localizedDescription(m, "pt")).toBe("Desc x");
    expect(localizedDescription(m, "en")).toBe("DescEn x");
  });
});
