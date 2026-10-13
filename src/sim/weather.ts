import { makeRng } from "./rng";

/** Days per weather "front"; rain starts and stops on these boundaries. */
const FRONT_DAYS = 5;
/** Chance a front is rainy. */
const RAIN_CHANCE = 0.25;

/** Rain is a pure function of the day and city seed, so saves and tests agree. */
export function isRaining(day: number, seed: number): boolean {
  const front = Math.floor(day / FRONT_DAYS);
  return makeRng((seed * 2654435761) ^ (front * 40503))() < RAIN_CHANCE;
}

/** Traffic speed multiplier in the current weather. */
export const RAIN_SPEED_FACTOR = 0.85;
