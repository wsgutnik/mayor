import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = "public/textures";
const PORTED = new Set([
  "asphalt_hd.png", "kerb_hd.png", "sidewalk_hd.png", "brick_hd.png", "plaster_hd.png",
  "roof_tile_hd.png", "grass_hd.png", "sand_hd.png", "rock_hd.png", "dirt_hd.png",
]);
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

describe("texture provenance and budgets", () => {
  it("credits every texture file and keeps the port below 12 MB", () => {
    const files = walk(ROOT).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
    const credits = `${readFileSync("third_party/README.md", "utf8")}\n${readFileSync("NOTICE.md", "utf8")}`;
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const name = relative(ROOT, file).replaceAll("\\", "/");
      expect(credits.includes(name) || credits.includes("public/textures/**"), name).toBe(true);
      if (name.endsWith("_hd.png")) expect(statSync(file).size, name).toBeLessThanOrEqual(1_500_000);
    }
    const bytes = files.filter((f) => PORTED.has(relative(ROOT, f).replaceAll("\\", "/")))
      .reduce((n, f) => n + statSync(f).size, 0);
    expect(bytes).toBeLessThanOrEqual(12_000_000);
  });
});
