import { describe, expect, it } from "vitest";
import { armRank } from "./priority";

describe("ramp priority", () => {
  it("a ramp yields to every city road and to the highway at a junction", () => {
    for (const t of [1, 2, 3, 4, 5] as const) expect(armRank(6)).toBeLessThan(armRank(t));
  });
});
