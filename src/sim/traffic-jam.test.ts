import { describe, expect, it } from "vitest";
import { newCity, placeRoad } from "./sim";
import { newTraffic, tickTraffic } from "./traffic";
import { cidx, idx } from "./world";

/**
 * Regression for the permanent gridlock: a 5x5 signalised street grid at city-scale demand must keep flowing.
 * Before the signal-box watchdog every car froze within ~10 simulated minutes (all 260 alive cars stopped).
 */
function fixture(avenue: boolean) {
  const s = newCity(21);
  const w = s.world, ey = w.entry.y;
  for (let y = ey - 30; y <= ey + 30; y++) for (let x = 0; x <= 70; x++) w.heights[cidx(w, x, y)] = 0.35;
  s.money = 1e7;
  const seg = (type: 1 | 2, x0: number, y0: number, x1: number, y1: number) =>
    placeRoad(s, type, [{ x: x0 + 0.5, z: y0 + 0.5 }, { x: x1 + 0.5, z: y1 + 0.5 }]).ok;
  const cols = [10, 20, 30, 40, 50], rows = [ey - 14, ey - 7, ey, ey + 7, ey + 14];
  const ok = [seg(1, 2, ey, 6, ey)];
  for (const y of rows) ok.push(seg(avenue && y === ey ? 2 : 1, 6, y, 54, y));
  for (const x of cols) ok.push(seg(avenue && x === 30 ? 2 : 1, x, rows[0], x, rows[4]));
  expect(ok.every(Boolean)).toBe(true);
  const t = newTraffic(w.size, 5);
  tickTraffic(s, t, 0);
  t.homes = []; t.jobs = [];
  for (let x = 12; x <= 52; x += 2) { t.homes.push(idx(w, x, rows[2] - 1)); t.jobs.push(idx(w, x, rows[3] + 1)); }
  for (const y of rows) { t.homes.push(idx(w, 8, y)); t.jobs.push(idx(w, 52, y)); }
  s.population = 6000;
  s.capacity.ind = 0;
  return { s, t };
}

describe("signalised grid never gridlocks", () => {
  it("keeps completing trips every minute for 8 simulated minutes (street grid)", () => {
    const { s, t } = fixture(false);
    const perMinute: number[] = [];
    let last = 0;
    for (let i = 0; i < 4800; i++) {
      tickTraffic(s, t, 0.1);
      if (i % 600 === 599) { perMinute.push(t.completed - last); last = t.completed; }
    }
    for (const n of perMinute) expect(n).toBeGreaterThan(40);
  }, 120000);

  it("is deterministic", () => {
    const run = () => {
      const { s, t } = fixture(false);
      for (let i = 0; i < 1500; i++) tickTraffic(s, t, 0.1);
      return { c: t.completed, a: t.vehicles.map((v) => v.arc), n: t.boxTimeouts ?? 0 };
    };
    expect(run()).toEqual(run());
  }, 120000);
});
