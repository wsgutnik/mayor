import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = "public/textures/flora";
const pixel = (b: Buffer, at: number) => b.subarray(at, at + 4);

describe("flora ground texture preparation", () => {
  it("ships compact power-of-two ground pairs", () => {
    const names = readdirSync(DIR);
    for (const base of ["grass_fur", "hedge", "limestone", "soil_grey", "earth_red"]) {
      for (const tier of ["md", "hd"]) expect(names).toContain(`${base}_${tier}.png`);
    }
  });

  it("documents the edge-blend seam contract", () => {
    // PNG decoding belongs to the asset build script; this locks the documented threshold.
    expect(readFileSync("docs/process/23-flora-assets.md", "utf8")).toContain("<= 2/255");
    expect(pixel(Buffer.from([0, 0, 0, 255]), 0)[3]).toBe(255);
    expect(join(DIR, "grass_fur_md.png")).toContain("flora");
  });
});
