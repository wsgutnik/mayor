import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// AGENTS rule 4: no per-frame allocation. The vehicle hot path (updateVehicles +
// its helpers) must contain no `new` and no closures; everything is preallocated.
function methodBody(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const rest = src.slice(start + marker.length);
  const next = rest.search(/\n  (?:private |async )?\w+\(/);
  const body = next >= 0 ? rest.slice(0, next) : rest;
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

describe("updateVehicles hot path", () => {
  const src = readFileSync("src/render/scene.ts", "utf8");
  for (const marker of ["private updateVehicles(): void {", "private placeVehicle(", "private vehicleSampleY("]) {
    it(`${marker} allocates nothing (no new, no closures)`, () => {
      const body = methodBody(src, marker);
      expect(body).not.toMatch(/\bnew\b/);
      expect(body).not.toContain("=>");
    });
  }

  it("tints baked looks through aPaint, never through setColorAt", () => {
    const body = methodBody(src, "private placeVehicle(");
    // The only setColorAt left is the pre-GLB fallback box (a plain untextured box).
    const uses = body.split("setColorAt").length - 1;
    expect(uses).toBe(1);
    expect(body).toContain("aPaint");
  });

  it("skips tunnel vehicles before placing (no body, no decal underground)", () => {
    const body = methodBody(src, "private updateVehicles(): void {");
    expect(body).toContain("if (layer === 2) continue;");
  });
});
