// src/sim/roadprofile.ts
/**
 * The single source of road numbers (docs/process/26-roads-cycle1.md section 4). Every other table
 * (world.ts ROAD_*, corridor.ts profiles, traffic.ts speed/capacity, junction.ts radius/clearance,
 * road-facts.ts, the atlas generator via profiles.json) is a view of ROAD_SPECS. 1 tile = 8 m.
 */
import type { RoadType } from "./world";

export type MedianKind = "none" | "paint" | "planted" | "barrier";

export interface RoadSpec {
  type: RoadType;
  nameKey: string;
  descKey: string;
  thumb: string;
  tileWidth: number;
  drawWidth: number;
  oneWay: boolean;
  /** [forward (a→b or the one-way direction), back]. */
  lanesPerDir: [number, number];
  laneWidth: number;
  medianHalf: number;
  median: MedianKind;
  shoulder: number;
  kerb: number;
  sidewalk: number;
  speed: number;
  capacityPerLane: number;
  cornerRadius: number;
  clearance: number;
  rank: number;
  cost: number;
  upkeep: number;
  junctionMarkings: boolean;
}

export interface DerivedProfile {
  asphaltHalf: number;
  drawHalf: number;
  sidewalkEdge: number;
  totalLanes: number;
  /** Signed offsets, ascending; +offset is the right of a→b (world z points south). */
  laneCentres: number[];
  capacity: number;
}

export const ROAD_SPECS: Record<RoadType, RoadSpec> = {
  1: { type: 1, nameKey: "Street", descKey: "Two-way, 1 lane each way, sidewalks.", thumb: "/ui/thumbs/rd-two.jpg",
    tileWidth: 1, drawWidth: 0.9, oneWay: false, lanesPerDir: [1, 1], laneWidth: 0.38, medianHalf: 0, median: "paint",
    shoulder: 0, kerb: 0.07, sidewalk: 0.12, speed: 3, capacityPerLane: 2, cornerRadius: 0.45, clearance: 0.1,
    rank: 1, cost: 20, upkeep: 3, junctionMarkings: true },
  2: { type: 2, nameKey: "Avenue", descKey: "Two-way, 2 lanes each way, planted median.", thumb: "/ui/thumbs/rd-four.jpg",
    tileWidth: 2, drawWidth: 1.8, oneWay: false, lanesPerDir: [2, 2], laneWidth: 0.325, medianHalf: 0.16, median: "planted",
    shoulder: 0, kerb: 0.09, sidewalk: 0.16, speed: 4.5, capacityPerLane: 2.5, cornerRadius: 0.6, clearance: 0.1,
    rank: 3, cost: 45, upkeep: 7, junctionMarkings: true },
  3: { type: 3, nameKey: "Highway", descKey: "Highway, 3 lanes each way, central barrier and shoulders. Joins only through an interchange.", thumb: "/ui/thumbs/rd-highway.jpg",
    tileWidth: 3, drawWidth: 2.8, oneWay: false, lanesPerDir: [3, 3], laneWidth: 0.4, medianHalf: 0.1, median: "barrier",
    shoulder: 0.1, kerb: 0, sidewalk: 0, speed: 7, capacityPerLane: 5, cornerRadius: 1.2, clearance: 0.25,
    rank: 6, cost: 90, upkeep: 14, junctionMarkings: false },
  4: { type: 4, nameKey: "One-way street", descKey: "One-way, 2 lanes in the drawn direction.", thumb: "/ui/thumbs/rd-two.jpg",
    tileWidth: 1, drawWidth: 0.9, oneWay: true, lanesPerDir: [2, 0], laneWidth: 0.38, medianHalf: 0, median: "none",
    shoulder: 0, kerb: 0.07, sidewalk: 0.12, speed: 3, capacityPerLane: 2, cornerRadius: 0.25, clearance: 0.1,
    rank: 2, cost: 22, upkeep: 3, junctionMarkings: true },
  5: { type: 5, nameKey: "One-way avenue", descKey: "One-way, 4 lanes in the drawn direction.", thumb: "/ui/thumbs/rd-four.jpg",
    tileWidth: 2, drawWidth: 1.8, oneWay: true, lanesPerDir: [4, 0], laneWidth: 0.405, medianHalf: 0, median: "none",
    shoulder: 0, kerb: 0.09, sidewalk: 0.16, speed: 4.5, capacityPerLane: 2.5, cornerRadius: 0.35, clearance: 0.1,
    rank: 4, cost: 48, upkeep: 7, junctionMarkings: true },
  6: { type: 6, nameKey: "Ramp", descKey: "Ramp, 1 lane with shoulders. Joins a highway at a shallow angle.",
    thumb: "/ui/thumbs/rd-ramp.jpg", tileWidth: 1, drawWidth: 0.85, oneWay: true, lanesPerDir: [1, 0],
    laneWidth: 0.45, medianHalf: 0, median: "none", shoulder: 0.2, kerb: 0, sidewalk: 0, speed: 5,
    capacityPerLane: 5, cornerRadius: 0.45, clearance: 0.25, rank: 5, cost: 60, upkeep: 9, junctionMarkings: true },
};

export const specOf = (t: RoadType): RoadSpec => ROAD_SPECS[t];

export function rankOf(t: number): number {
  return (ROAD_SPECS as Record<number, RoadSpec | undefined>)[t]?.rank ?? 0;
}

const derivedCache = new Map<RoadType, DerivedProfile>();
/** Round derived widths to 1e-9 so sums like 0.1 + 1.2 + 0.1 compare equal to the declared table values. */
const r9 = (x: number): number => Math.round(x * 1e9) / 1e9;

export function derive(t: RoadType): DerivedProfile {
  const hit = derivedCache.get(t);
  if (hit) return hit;
  const s = ROAD_SPECS[t];
  const [fwd, back] = s.lanesPerDir;
  const total = fwd + back;
  const asphaltHalf = r9(s.oneWay
    ? (total * s.laneWidth) / 2 + s.shoulder
    : s.medianHalf + fwd * s.laneWidth + s.shoulder);
  const drawHalf = r9(asphaltHalf + s.kerb);
  const centres: number[] = [];
  if (s.oneWay) {
    for (let i = 0; i < total; i++) centres.push(r9((i - (total - 1) / 2) * s.laneWidth));
  } else {
    // Back lanes (b→a) on the negative side, forward lanes on the positive side.
    for (let i = back - 1; i >= 0; i--) centres.push(r9(-(s.medianHalf + (i + 0.5) * s.laneWidth)));
    for (let i = 0; i < fwd; i++) centres.push(r9(s.medianHalf + (i + 0.5) * s.laneWidth));
  }
  const d: DerivedProfile = {
    asphaltHalf, drawHalf, sidewalkEdge: r9(drawHalf + s.sidewalk), totalLanes: total,
    laneCentres: centres, capacity: s.capacityPerLane * total,
  };
  derivedCache.set(t, d);
  return d;
}
