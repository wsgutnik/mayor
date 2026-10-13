import { describe, expect, it } from "vitest";
import { textureName } from "./kit-materials";

describe("kit material texture names", () => {
  it("selects HD names when present and falls back to SD when absent", () => {
    expect(textureName("brick", "hd", (name) => name === "brick_hd")).toBe("brick_hd");
    expect(textureName("brick", "hd", () => false)).toBe("brick");
    expect(textureName("brick", "sd", () => true)).toBe("brick");
  });
});
