import { writeFileSync } from "node:fs";
import { ROAD_SPECS, derive } from "../src/sim/roadprofile";

const STEM: Record<number, string> = {
  1: "road_street",
  2: "road_avenue",
  3: "road_highway",
  4: "road_oneway_street",
  5: "road_oneway_avenue",
  6: "road_ramp",
};

export function roadProfilesJson(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of Object.values(ROAD_SPECS)) {
    const stem = STEM[s.type];
    if (!stem) continue;
    const d = derive(s.type);
    out[stem] = {
      type: s.type, sidewalkEdge: d.sidewalkEdge, drawHalf: d.drawHalf, asphaltHalf: d.asphaltHalf,
      kerb: s.kerb, sidewalk: s.sidewalk, medianHalf: s.medianHalf, median: s.median, shoulder: s.shoulder,
      laneCentres: d.laneCentres, laneWidth: s.laneWidth, oneWay: s.oneWay,
    };
  }
  return out;
}

if (process.argv[1]?.endsWith("export-road-profiles.ts")) {
  writeFileSync("public/textures/road/profiles.json", JSON.stringify(roadProfilesJson(), null, 2) + "\n");
  console.log("wrote public/textures/road/profiles.json");
}
