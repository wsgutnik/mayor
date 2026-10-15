import { describe, expect, it } from "vitest";
import { getLang, hasTranslation, setLang, tr } from "../i18n";
import { ROAD_COST, ROAD_UPKEEP, type RoadType } from "../sim/world";
import { ROAD_LEVEL_LABEL, ROAD_MODE_LABEL, roadFacts, roadSummary } from "./road-facts";
import { initialToolState } from "./tool-state";

describe("road facts", () => {
  it("mirror the simulation constants for every class", () => {
    for (const t of [1, 2, 3, 4, 5] as RoadType[]) {
      const f = roadFacts(t);
      expect(f.costPerTile).toBe(ROAD_COST[t]);
      expect(f.upkeepPerTile).toBe(ROAD_UPKEEP[t]);
      expect(f.lanes).toBeGreaterThanOrEqual(2);
      expect(f.capacity).toBeGreaterThan(0);
      expect(f.widthTiles).toBeGreaterThanOrEqual(1);
      expect(hasTranslation(f.name), f.name).toBe(true);
    }
    expect(roadFacts(4).oneWay).toBe(true);
    expect(roadFacts(1).oneWay).toBe(false);
    expect(roadFacts(2).lanes).toBe(4);
  });

  it("summary names the selection and the armed mode in both languages", () => {
    const prev = getLang();
    try {
      setLang("en");
      expect(roadSummary(initialToolState(), tr)).toBe("Street · Line · Ground · $20/tile");
      expect(roadSummary({ ...initialToolState(), roadType: 2, roadMode: "curve", upgradeMode: true }, tr)).toBe("Avenue · Curve · Ground · $45/tile · Upgrade road");
      expect(roadSummary({ ...initialToolState(), roadLevel: "tunnel", upgradeMode: true, pendingInterchange: true }, tr)).toBe("Street · Line · Underground · $20/tile · Interchange");
      setLang("pt");
      expect(roadSummary({ ...initialToolState(), roadType: 2, roadMode: "curve" }, tr)).toBe("Avenida · Curva · Solo · $45/trecho");
    } finally { setLang(prev); }
    for (const k of [...Object.values(ROAD_MODE_LABEL), ...Object.values(ROAD_LEVEL_LABEL)]) expect(hasTranslation(k), k).toBe(true);
  });
});
