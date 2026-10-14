import { describe, expect, it } from "vitest";
import { constructionDuration, constructionPhase, lotDemographics, newCity, step } from "./sim";
import { ZONE } from "./world";

describe("construction and demographics", () => {
  it("has deterministic independent construction phases and size-based durations", () => {
    const small = { id: 1, x: 1, y: 1, w: 1, h: 1, facing: { dx: 0 as const, dy: 1 as const }, zone: ZONE.RES, level: 1, depthFromRoad: 0 };
    const large = { ...small, id: 2, w: 4, h: 4, level: 3 };
    expect(constructionDuration(large)).toBeGreaterThan(constructionDuration(small));
    expect(constructionPhase(.05)).toBe("planned");
    expect(constructionPhase(.2)).toBe("excavation");
    expect(constructionPhase(.5)).toBe("structure");
    expect(constructionPhase(.9)).toBe("finishing");
    expect(constructionPhase(1)).toBe("complete");
  });

  it("keeps population, labour and job totals on one ledger", () => {
    const s = newCity();
    s.population = 100;
    s.world.zone[0] = ZONE.RES; s.world.level[0] = 1;
    s.world.zone[1] = ZONE.COM; s.world.level[1] = 1;
    step(s);
    expect(s.ages.children + s.ages.working + s.ages.seniors).toBe(Math.round(s.population));
    expect(s.jobsFilled).toBe(s.employed);
    expect(s.jobsAvailable).toBe(s.capacity.com + s.capacity.ind);
    const d = lotDemographics(s, { id: 1, x: 0, y: 0, w: 1, h: 1, facing: { dx: 0, dy: 1 }, zone: ZONE.RES, level: 1, depthFromRoad: 0 });
    expect(d.residents.working).toBeGreaterThanOrEqual(0);
  });
});
