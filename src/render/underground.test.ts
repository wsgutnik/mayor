import { describe, expect, it } from "vitest";
import { applyTool, newCity } from "../sim/sim";
import { cidx, idx, updateCoverage } from "../sim/world";
import { facilityLinks } from "../sim/networks";
import { valveSpots } from "./underground";

function flatCity() {
  const s = newCity(11);
  const ey = s.world.entry.y;
  for (let y = ey - 6; y <= ey + 6; y++)
    for (let x = 0; x <= 20; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  s.money = 1e6;
  return { s, ey };
}

describe("valveSpots", () => {
  it("puts a valve at each live junction and where each facility stub lands", () => {
    const { s, ey } = flatCity();
    for (let x = 3; x <= 10; x++) applyTool(s, "road", x, ey);
    expect(applyTool(s, "power", 5, ey + 2).ok).toBe(true);
    updateCoverage(s.world);
    const spots = valveSpots(s.world, () => 0.35);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.every((v) => v.kind === "power")).toBe(true);
    // The stub landing reads slightly above the cable run.
    const link = facilityLinks(s.world).find((l) => l.net === "power")!;
    const landing = spots.find((v) => v.x === (link.entry % s.world.size) + 0.5);
    expect(landing).toBeDefined();
    expect(landing!.y).toBeCloseTo(0.35 - 0.16 + 0.02);
  });

  it("shows no valves without a live network", () => {
    const { s } = flatCity();
    updateCoverage(s.world);
    expect(valveSpots(s.world, () => 0)).toHaveLength(0);
    const { s: t, ey } = flatCity();
    for (let x = 3; x <= 10; x++) applyTool(t, "road", x, ey);
    expect(applyTool(t, "substation", 5, ey + 2).ok).toBe(true); // relay, no plant
    updateCoverage(t.world);
    expect(valveSpots(t.world, () => 0)).toHaveLength(0);
  });

  it("ignores dry branches: valves only where the flood reached", () => {
    const { s, ey } = flatCity();
    for (let x = 3; x <= 10; x++) applyTool(s, "road", x, ey);
    for (let x = 3; x <= 10; x++) applyTool(s, "road", x, ey + 5); // island
    expect(applyTool(s, "power", 5, ey + 2).ok).toBe(true);
    updateCoverage(s.world);
    const w = s.world;
    expect(valveSpots(w, () => 0).every((v) => Math.abs(v.z - (ey + 0.5)) < 2)).toBe(true);
    expect(w.nets[idx(w, 5, ey + 5)]).toBe(0);
  });
});
