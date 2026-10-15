import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { roadProfilesJson } from "../../scripts/export-road-profiles";

const FILE = "public/textures/road/profiles.json";

describe("road atlas profiles", () => {
  it("public/textures/road/profiles.json is fresh (ROAD_PROFILES_WRITE=1 regenerates it)", () => {
    if (process.env.ROAD_PROFILES_WRITE === "1") writeFileSync(FILE, JSON.stringify(roadProfilesJson(), null, 2) + "\n");
    const disk = JSON.parse(readFileSync(FILE, "utf8"));
    expect(disk).toEqual(roadProfilesJson());
  });
});
