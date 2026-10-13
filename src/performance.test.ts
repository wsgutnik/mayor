import { describe, expect, it } from "vitest";
import { buildRoadNetworkGeometry } from "./render/roads";
import { addSegment, signalNodes } from "./sim/roads";
import { indexSignals, newTraffic, redCrawl } from "./sim/traffic";
import { generateWorld, ROAD, idx } from "./sim/world";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

describe("road hot-path performance", () => {
  it("rebuilds geometry and checks signals within the 128x128 budgets", () => {
    const w = generateWorld(128, 7); w.heights.fill(.35);
    for (let y = 10; y <= 91; y += 9) addSegment(w, ROAD.AVENUE, [{ x: 6.5, z: y + .5 }, { x: 120.5, z: y + .5 }]);
    for (let x = 10; x <= 109; x += 9) addSegment(w, ROAD.STREET, [{ x: x + .5, z: 6.5 }, { x: x + .5, z: 120.5 }]);
    expect(w.segments.length).toBeGreaterThan(250);
    const geometryMs: number[] = [];
    for (let r = 0; r < 7; r++) {
      const start = performance.now();
      buildRoadNetworkGeometry(w, () => .35).dispose();
      geometryMs.push(performance.now() - start);
    }
    const traffic = newTraffic(w.size);
    traffic.sigNodes = signalNodes(w); traffic.sigByTile = indexSignals(w, traffic.sigNodes);
    const checksMs: number[] = [];
    for (let r = 0; r < 7; r++) {
      const start = performance.now();
      for (let n = 0; n < 260; n++) {
        const x = 10 + n % 100, y = 10 + (n * 17) % 100;
        redCrawl(w, traffic, idx(w, x, y), idx(w, x + 1, y), (r & 1) as 0 | 1);
      }
      checksMs.push(performance.now() - start);
    }
    console.info(`PERF geometry=${median(geometryMs).toFixed(3)}ms signals=${median(checksMs).toFixed(3)}ms segments=${w.segments.length}`);
    expect(median(geometryMs)).toBeLessThan(60); // ~13 ms idle; generous so a busy machine does not flake
    expect(median(checksMs)).toBeLessThan(8);
  });
});
