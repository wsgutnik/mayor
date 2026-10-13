import { afterEach, describe, expect, it } from "vitest";
import {
  METERS_PER_TILE,
  formatRoadReadout,
  maxSlopePercent,
  resolveReadoutMode,
  type RoadReadoutI18n,
} from "./road-readout";
import { setLang, tr, trReason } from "../i18n";

afterEach(() => setLang("pt"));

const stub: RoadReadoutI18n = {
  tr: (key, vars) => {
    let s = `T:${key}`;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  },
  trReason: (reason) => `R:${reason}`,
};

describe("maxSlopePercent", () => {
  it("is zero on flat ground", () => {
    expect(maxSlopePercent([{ x: 1, z: 1 }, { x: 11, z: 1 }], () => 2.5)).toBe(0);
  });

  it("measures a steady ramp as rise over run", () => {
    // 0.1 height per tile -> 10%.
    const pct = maxSlopePercent([{ x: 0, z: 0 }, { x: 10, z: 0 }], (x) => x * 0.1);
    expect(pct).toBeCloseTo(10, 6);
  });

  it("reports the steepest pitch, uphill or down", () => {
    // Gentle climb, then a sharp drop.
    const h = (x: number) => (x < 5 ? x * 0.05 : 0.25 - (x - 5) * 0.5);
    const pct = maxSlopePercent([{ x: 0, z: 0 }, { x: 10, z: 0 }], (x) => h(x));
    expect(pct).toBeCloseTo(50, 3);
  });

  it("samples along curves, not just the endpoints", () => {
    // A hump in the middle of an otherwise flat line.
    const h = (x: number, z: number) => (Math.abs(x - 5) < 1 && Math.abs(z) < 1 ? 1 : 0);
    const pct = maxSlopePercent([{ x: 0, z: 0 }, { x: 10, z: 0 }], h);
    expect(pct).toBeGreaterThan(0);
  });

  it("is zero for a degenerate single-point draft", () => {
    expect(maxSlopePercent([{ x: 3, z: 3 }, { x: 3, z: 3 }], (x) => x)).toBe(0);
  });
});

describe("resolveReadoutMode", () => {
  it("prefers the plan span", () => {
    expect(resolveReadoutMode("bridge", "ground", true)).toBe("bridge");
    expect(resolveReadoutMode("tunnel", "elevated", true)).toBe("tunnel");
  });

  it("shows ground for a valid span-less plan even when a deck was requested", () => {
    expect(resolveReadoutMode(undefined, "elevated", true)).toBe("ground");
  });

  it("shows the requested level while the plan is invalid", () => {
    expect(resolveReadoutMode(undefined, "ground", false)).toBe("ground");
    expect(resolveReadoutMode(undefined, "elevated", false)).toBe("bridge");
    expect(resolveReadoutMode(undefined, "tunnel", false)).toBe("tunnel");
  });
});

describe("formatRoadReadout", () => {
  const base = { cost: 1234, lengthTiles: 12.4, maxSlopePct: 4.6, mode: "ground" as const, ok: true };

  it("formats cost, length in tiles and metres, slope and mode", () => {
    expect(METERS_PER_TILE).toBe(8);
    const rows = formatRoadReadout(base, stub);
    expect(rows).toEqual([
      { label: "T:Cost", value: "$1,234" },
      { label: "T:Length", value: `12 T:tiles · 99 m` },
      { label: "T:Slope", value: "5%" },
      { label: "T:Level", value: "T:Ground" },
    ]);
  });

  it("labels bridge and tunnel modes", () => {
    expect(formatRoadReadout({ ...base, mode: "bridge" }, stub)[3]).toMatchObject({ value: "T:Bridge" });
    expect(formatRoadReadout({ ...base, mode: "tunnel" }, stub)[3]).toMatchObject({ value: "T:Tunnel" });
  });

  it("appends the translated plan reason when invalid", () => {
    const rows = formatRoadReadout({ ...base, ok: false, reason: "Not enough money" }, stub);
    expect(rows).toHaveLength(5);
    expect(rows[4]).toEqual({ label: "", value: "R:Not enough money", bad: true });
  });

  it("omits the reason row when invalid without a reason", () => {
    expect(formatRoadReadout({ ...base, ok: false }, stub)).toHaveLength(4);
  });

  it("localizes labels and reasons through the real i18n", () => {
    setLang("pt");
    const pt = formatRoadReadout({ ...base, mode: "bridge", ok: false, reason: "Not enough money" }, { tr, trReason });
    expect(pt.map((r) => r.label)).toEqual(["Custo", "Comprimento", "Inclinação", "Nível", ""]);
    expect(pt[1].value).toContain("trechos");
    expect(pt[3].value).toBe("Ponte");
    expect(pt[4].value).toBe("Dinheiro insuficiente");
    setLang("en");
    const en = formatRoadReadout({ ...base, mode: "tunnel", ok: false, reason: "Road would cross water" }, { tr, trReason });
    expect(en.map((r) => r.label)).toEqual(["Cost", "Length", "Slope", "Level", ""]);
    expect(en[3].value).toBe("Tunnel");
    expect(en[4].value).toBe("Road would cross water");
  });
});
