/**
 * Vehicle and street-furniture variants available as Blender props (blender/props_fleet*.py).
 * Traffic picks looks by vehicle id so a vehicle never changes shape between frames.
 */
export const CAR_LOOKS = [
  "car_sedan", "car_hatch", "car_suv", "van", "car_midsize", "car_compact", "car_crossover", "car_minivan",
  "car_electric", "car_pickup", "car_taxi",
] as const;

/** Freight: weighted toward small box trucks; semis are the minority. */
export const TRUCK_LOOKS = [
  "truck", "truck_box", "van_cargo", "truck_box", "truck", "truck_flatbed", "semi_box", "truck_tanker",
  "truck_cement", "semi_container",
] as const;

/** Buses for the public lines: mostly the city bus, a few doubles and articulated ones. */
export const BUS_LOOKS = [
  "bus", "bus_city", "bus_city", "bus_double", "bus_articulated", "bus_city", "bus_mini", "bus_school", "bus_coach",
] as const;

/** Looks for service vehicles the simulation does not spawn yet (kept ready for later use). */
export const FLEET_BY_ROLE = {
  police: ["car_police"],
  garbage: ["truck_garbage"],
  utility: ["truck_utility"],
  taxi: ["car_taxi"],
  school: ["bus_school"],
  coach: ["bus_coach"],
  cement: ["truck_cement"],
} as const;

export const ALL_FLEET_PROPS: string[] = [
  ...new Set<string>([
    ...CAR_LOOKS, ...TRUCK_LOOKS, ...BUS_LOOKS, ...Object.values(FLEET_BY_ROLE).flat(),
  ]),
];

/** Deterministic pick from a table by vehicle id. */
export function pickLook<T extends string>(table: readonly T[], id: number): T {
  return table[Math.abs(Math.trunc(id)) % table.length];
}
