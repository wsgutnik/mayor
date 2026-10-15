import { describe, expect, it } from "vitest";
import { getLang, hasTranslation, setLang } from "../i18n";
import { facilityUsage } from "../sim/facility-usage";
import { FAC, FACILITY_INFO, FacilityKind } from "../sim/world";
import { USAGE_STRING_KEYS, usageRows } from "./facility-usage-view";
import { FLYOUT_I18N_KEYS, TOOL_I18N_KEYS } from "./hud";

const KINDS = Object.keys(FACILITY_INFO).map(Number) as FacilityKind[];

describe("usage rows", () => {
  it("give every facility kind at least one row before placing", () => {
    const prev = getLang();
    setLang("en");
    try {
      for (const kind of KINDS) {
        const rows = usageRows(facilityUsage(kind));
        expect(rows.length, `kind ${kind}`).toBeGreaterThan(0);
        for (const r of rows) { expect(r.k.length).toBeGreaterThan(0); expect(r.v.length).toBeGreaterThan(0); }
      }
    } finally { setLang(prev); }
  });

  it("shows capacity and homes for a utility, radius for a coverage service", () => {
    const prev = getLang();
    setLang("en");
    try {
      const solar = usageRows(facilityUsage(FAC.POWER_SOLAR));
      expect(solar.find((r) => r.k === "Capacity")?.v).toBe(`${FACILITY_INFO[FAC.POWER_SOLAR].capacity} units`);
      expect(solar.find((r) => r.k === "At full capacity")?.v).toMatch(/^~\d+ homes · ~[\d,]+ residents$/);
      const post = usageRows(facilityUsage(FAC.FIRE_POST));
      expect(post.find((r) => r.k === "Radius")?.v).toBe("8 tiles");
      expect(post.find((r) => r.k === "At full coverage")).toBeDefined();
      expect(usageRows(facilityUsage(FAC.CITYHALL)).find((r) => r.k === "Reach")?.v).toBe("Whole city");
    } finally { setLang(prev); }
  });

  it("has pt-BR for every usage string, every tool label and hint, and every flyout label", () => {
    for (const k of [...USAGE_STRING_KEYS, ...TOOL_I18N_KEYS, ...FLYOUT_I18N_KEYS]) expect(hasTranslation(k), k).toBe(true);
  });
});
