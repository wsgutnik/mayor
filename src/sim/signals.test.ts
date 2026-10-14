import { describe, expect, it } from "vitest";
import { newCity } from "./sim";
import { deserialize, serialize } from "./save";
import {
  addSegment, armHasGreen, classifyTurn, hasSignal, nodeArms, redHold,
  signalGroups, signalNodes, signalOffset, signalPhase, signalPhaseAt,
  SIGNAL_OPPOSITION_TOL, TURN_STRAIGHT_MAX, TURN_UTURN_MIN,
} from "./roads";
import { chooseAdaptivePhase, newAdaptiveSignal, SIGNAL_ALL_RED, SIGNAL_MAX_GREEN, SIGNAL_MIN_GREEN, SIGNAL_YELLOW, stepAdaptiveSignal } from "./signals";
import { indexSignals, newTraffic, redCrawl } from "./traffic";
import { generateWorld, idx, rebuildRoadRaster, ROAD } from "./world";

const dir = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { dx: Math.cos(a), dz: Math.sin(a) };
};
/** Direction with compass heading h (0 = north/-Z, clockwise). */
const headDir = (hDeg: number) => {
  const h = (hDeg * Math.PI) / 180;
  return { dx: Math.sin(h), dz: -Math.cos(h) };
};
/** Ticks in each half of one node's own cycle. */
const cycleTicks = (nodeId: number): { green: number; red: number } => {
  const scans = Array.from({ length: 33 }, (_, k) => k * 0.5);
  return {
    green: scans.find((t) => signalPhaseAt(nodeId, t) === 0)!,
    red: scans.find((t) => signalPhaseAt(nodeId, t) === 1)!,
  };
};

/** Diagonal cross over (20, 20): arms at 45/135/225/315 deg. */
function diagonalCross(oneWay = false) {
  const w = generateWorld(64, 7);
  w.heights.fill(0.35);
  const type = oneWay ? ROAD.ONEWAY_STREET : ROAD.STREET;
  addSegment(w, type, [{ x: 10, z: 10 }, { x: 30, z: 30 }]);
  addSegment(w, type, [{ x: 10, z: 30 }, { x: 30, z: 10 }]);
  rebuildRoadRaster(w);
  const node = w.nodes.find((n) => n.segs.length === 4)!;
  return { w, node };
}

describe("signalGroups (angle-based phase assignment)", () => {
  it("keeps the N-S pair on group A for an axis-aligned cross", () => {
    // nodeArms order is atan2 ascending: N, E, S, W.
    expect(signalGroups([dir(-90), dir(0), dir(90), dir(180)])).toEqual([true, false, true, false]);
  });

  it("pairs opposites on a diagonal cross", () => {
    expect(signalGroups([dir(-135), dir(-45), dir(45), dir(135)])).toEqual([true, false, true, false]);
  });

  it("skewed 4-way: 50-degree crossing rotated 60 degrees", () => {
    // nodeArms order: 240, 290, 60, 110. The old |dx| vs |dz| test puts all
    // four in one group (|dx| <= |dz| for each); opposites must still pair.
    const arms = [dir(240), dir(290), dir(60), dir(110)];
    expect(arms.every((a) => Math.abs(a.dx) <= Math.abs(a.dz))).toBe(true);
    expect(signalGroups(arms)).toEqual([false, true, false, true]);
  });

  it("skewed 4-way: 40-degree crossing", () => {
    // nodeArms order: 250, 290, 70, 110. Old rule: all four ns (one group).
    const arms = [dir(250), dir(290), dir(70), dir(110)];
    expect(arms.every((a) => Math.abs(a.dx) <= Math.abs(a.dz))).toBe(true);
    expect(signalGroups(arms)).toEqual([true, false, true, false]);
  });

  it("T junction: the bar shares a group, the stem takes the other", () => {
    expect(signalGroups([dir(0), dir(90), dir(180)])).toEqual([true, false, true]); // bar E-W
    expect(signalGroups([dir(-90), dir(0), dir(90)])).toEqual([true, false, true]); // bar N-S
  });

  it("5-arm: two pairs plus the leftover joins the nearest pair", () => {
    // nodeArms order: N, E, 30-deg, S, W. The 30-deg arm is nearer the E-W
    // pair axis (30 deg) than the N-S one (60 deg).
    expect(signalGroups([dir(-90), dir(0), dir(30), dir(90), dir(180)])).toEqual(
      [true, false, false, true, false],
    );
  });

  it("Y junction with no pair inside the tolerance still splits in two", () => {
    const arms = [dir(0), dir(120), dir(240)];
    expect(signalGroups(arms)).toEqual([true, true, false]);
    expect(signalGroups(arms)).toEqual(signalGroups(arms));
  });

  it("pairs at 35 degrees of opposition but not at 36", () => {
    // Fourth arm at 235 deg opposes the 90-deg arm by exactly 35 deg.
    expect(signalGroups([dir(0), dir(90), dir(180), dir(235)])).toEqual([false, true, false, true]);
    // At 234 deg the pair falls outside the tolerance: different split.
    expect(signalGroups([dir(0), dir(90), dir(180), dir(234)])).toEqual([true, false, true, false]);
  });

  it("handles empty, singleton and duplicate arms deterministically", () => {
    expect(signalGroups([])).toEqual([]);
    expect(signalGroups([dir(10)])).toEqual([true]);
    const dup = [dir(0), dir(0), dir(180)];
    expect(signalGroups(dup)).toEqual(signalGroups(dup));
    expect(signalGroups(dup)).toEqual([true, false, true]);
  });

  it("pins the ported angle thresholds", () => {
    expect(SIGNAL_OPPOSITION_TOL).toBeCloseTo((35 * Math.PI) / 180, 12);
    expect(TURN_STRAIGHT_MAX).toBeCloseTo((30 * Math.PI) / 180, 12);
    expect(TURN_UTURN_MIN).toBeCloseTo((150 * Math.PI) / 180, 12);
  });
});

describe("classifyTurn", () => {
  it("classifies the four cardinal movements", () => {
    const north = { dx: 0, dz: -1 };
    expect(classifyTurn(north.dx, north.dz, 0, -1)).toBe("straight");
    expect(classifyTurn(north.dx, north.dz, 1, 0)).toBe("right");
    expect(classifyTurn(north.dx, north.dz, -1, 0)).toBe("left");
    expect(classifyTurn(north.dx, north.dz, 0, 1)).toBe("uturn");
  });

  it("classifies diagonal travel the same way", () => {
    const ne = headDir(45);
    expect(classifyTurn(ne.dx, ne.dz, headDir(45).dx, headDir(45).dz)).toBe("straight");
    expect(classifyTurn(ne.dx, ne.dz, headDir(90).dx, headDir(90).dz)).toBe("right");
    expect(classifyTurn(ne.dx, ne.dz, headDir(0).dx, headDir(0).dz)).toBe("left");
    expect(classifyTurn(ne.dx, ne.dz, headDir(225).dx, headDir(225).dz)).toBe("uturn");
  });

  it("turns at 30 and 150 degrees", () => {
    const east = headDir(90);
    const at = (rel: number) => {
      const o = headDir(90 + rel);
      return classifyTurn(east.dx, east.dz, o.dx, o.dz);
    };
    expect(at(29)).toBe("straight");
    expect(at(-29)).toBe("straight");
    expect(at(31)).toBe("right");
    expect(at(-31)).toBe("left");
    expect(at(149)).toBe("right");
    expect(at(-149)).toBe("left");
    expect(at(151)).toBe("uturn");
    expect(at(-151)).toBe("uturn");
    expect(at(180)).toBe("uturn");
  });
});

describe("signal offsets and cycle", () => {
  it("keeps the 8 s two-phase cycle on every node's own offset", () => {
    expect(signalPhase(0)).toBe(0);
    expect(signalPhase(7.9)).toBe(0);
    expect(signalPhase(8)).toBe(1);
    expect(signalPhase(16)).toBe(0);
    for (const id of [1, 2, 7, 42]) {
      for (const t of [0, 1.3, 7.7, 15.9]) {
        expect(signalPhaseAt(id, t + 8)).not.toBe(signalPhaseAt(id, t));
        expect(signalPhaseAt(id, t + 16)).toBe(signalPhaseAt(id, t));
      }
    }
  });

  it("derives deterministic offsets in [0, 16) from the node id", () => {
    for (const id of [1, 2, 3, 42, 999]) {
      const o = signalOffset(id);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(16);
      expect(o).toBe(signalOffset(id));
    }
    // Golden vectors: the hash is stable (change only with the hash itself).
    expect(signalOffset(1)).toBe(12.4);
    expect(signalOffset(2)).toBe(2.1);
    expect(signalOffset(3)).toBe(0.2);
  });

  it("gives adjacent junctions different phases at some tick", () => {
    const w = generateWorld(64, 7);
    w.heights.fill(0.35);
    addSegment(w, ROAD.AVENUE, [{ x: 10.5, z: 20.5 }, { x: 40.5, z: 20.5 }]);
    addSegment(w, ROAD.STREET, [{ x: 18.5, z: 10.5 }, { x: 18.5, z: 30.5 }]);
    addSegment(w, ROAD.STREET, [{ x: 26.5, z: 10.5 }, { x: 26.5, z: 30.5 }]);
    const crosses = w.nodes.filter((n) => n.segs.length === 4);
    expect(crosses.length).toBe(2);
    const scans = Array.from({ length: 33 }, (_, k) => k * 0.5);
    expect(scans.some((t) => signalPhaseAt(crosses[0].id, t) !== signalPhaseAt(crosses[1].id, t))).toBe(true);
  });
});

describe("adaptive signal controller", () => {
  it("keeps green for 3..8 s, then yellow 2 s and all-red 1 s", () => {
    let s = newAdaptiveSignal(2, 0);
    s = stepAdaptiveSignal(s, SIGNAL_MIN_GREEN - 0.01, [0, 10]);
    expect(s.stage).toBe("green");
    s = stepAdaptiveSignal(s, 0.02, [0, 10]);
    expect(s.stage).toBe("yellow");
    s = stepAdaptiveSignal(s, SIGNAL_YELLOW, [0, 10]);
    expect(s.stage).toBe("allRed");
    s = stepAdaptiveSignal(s, SIGNAL_ALL_RED, [0, 10]);
    expect(s.stage).toBe("green");
    expect(s.phase).toBe(1);
    // With no competing demand a green reaches its hard max deterministically.
    s = stepAdaptiveSignal(newAdaptiveSignal(), SIGNAL_MAX_GREEN, [1, 0]);
    expect(s.stage).toBe("yellow");
  });

  it("chooses queue plus wait deterministically", () => {
    expect(chooseAdaptivePhase([1, 1, 1], [0, 0, 0], 2)).toBe(0);
    expect(chooseAdaptivePhase([1, 2, 1], [20, 0, 0], 1)).toBe(0);
  });
});

describe("built skewed junctions", () => {
  it("pairs opposite arms on a diagonal cross", () => {
    const { w, node } = diagonalCross();
    expect(nodeArms(w, node.id).length).toBe(4);
    const sn = signalNodes(w).find((s) => s.id === node.id)!;
    expect(sn).toBeDefined();
    // nodeArms order: -135, -45, +45, +135 deg; opposites are (0, 2), (1, 3).
    expect(sn.arms[0].ns).toBe(sn.arms[2].ns);
    expect(sn.arms[1].ns).toBe(sn.arms[3].ns);
    expect(sn.arms[0].ns).not.toBe(sn.arms[1].ns);
    // The old rule put all four (|dx| == |dz|) in one group.
    expect(nodeArms(w, node.id).every((a) => Math.abs(a.dx) <= Math.abs(a.dz))).toBe(true);
  });

  it("pairs opposite arms on a skewed 50-degree crossing", () => {
    const w = generateWorld(64, 7);
    w.heights.fill(0.35);
    addSegment(w, ROAD.STREET, [{ x: 15, z: 11.34 }, { x: 25, z: 28.66 }]); // along 60 deg
    addSegment(w, ROAD.STREET, [{ x: 23.42, z: 10.6 }, { x: 16.58, z: 29.4 }]); // along 110 deg
    const node = w.nodes.find((n) => n.segs.length === 4)!;
    expect(nodeArms(w, node.id).length).toBe(4);
    const sn = signalNodes(w).find((s) => s.id === node.id)!;
    // nodeArms order: 240, 290, 60, 110 deg; opposites are (0, 2), (1, 3).
    expect(sn.arms[0].ns).toBe(sn.arms[2].ns);
    expect(sn.arms[1].ns).toBe(sn.arms[3].ns);
    expect(sn.arms[0].ns).not.toBe(sn.arms[1].ns);
  });

  it("holds entering traffic on red at a skewed cross", () => {
    const { w, node } = diagonalCross();
    const t = newTraffic(w.size);
    t.sigNodes = signalNodes(w);
    t.sigByTile = indexSignals(w, t.sigNodes);
    const { green, red } = cycleTicks(node.id);
    // Some entering move near the node must be held on red...
    let held: { tile: number; next: number } | null = null;
    for (let y = 17; y <= 23 && !held; y++) {
      for (let x = 17; x <= 23 && !held; x++) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const tile = idx(w, x, y), next = idx(w, x + dx, y + dy);
          if (!w.road[tile] || !w.road[next]) continue;
          if (redCrawl(w, t, tile, next, red) === 0.3) held = { tile, next };
        }
      }
    }
    expect(held).not.toBeNull();
    // ...and the same move proceeds on green.
    expect(redCrawl(w, t, held!.tile, held!.next, green)).toBe(1);
  });

  it("signals a T with the bar together and the stem opposite", () => {
    const w = generateWorld(64, 7);
    w.heights.fill(0.35);
    addSegment(w, ROAD.AVENUE, [{ x: 10.5, z: 20.5 }, { x: 30.5, z: 20.5 }]);
    addSegment(w, ROAD.STREET, [{ x: 20.5, z: 10.5 }, { x: 20.5, z: 20.5 }]);
    rebuildRoadRaster(w);
    const node = w.nodes.find((n) => n.segs.length === 3)!;
    expect(hasSignal(w, node.id)).toBe(true);
    // nodeArms order: stem N, bar E, bar W.
    const sn = signalNodes(w).find((s) => s.id === node.id)!;
    expect(sn.arms[1].ns).toBe(sn.arms[2].ns);
    expect(sn.arms[0].ns).not.toBe(sn.arms[1].ns);
    // The stem (group B) is held exactly when the bar has green.
    const tile = idx(w, 20, 19);
    expect(w.road[tile]).toBeGreaterThan(0);
    const { green, red } = cycleTicks(node.id);
    expect(redHold(w, green, tile, 0, 1)).toBe(!armHasGreen(w, node.id, 0, green));
    expect(redHold(w, red, tile, 0, 1)).toBe(!armHasGreen(w, node.id, 0, red));
    expect(redHold(w, green, tile, 0, 1)).not.toBe(redHold(w, red, tile, 0, 1));
  });

  it("groups a 5-arm junction as two pairs plus the nearest leftover", () => {
    const w = generateWorld(64, 7);
    w.heights.fill(0.35);
    const cx = 20.5, cz = 20.5, c = { x: cx, z: cz };
    addSegment(w, ROAD.STREET, [c, { x: 28.5, z: 20.5 }]);
    addSegment(w, ROAD.STREET, [c, { x: 20.5, z: 12.5 }]);
    addSegment(w, ROAD.STREET, [c, { x: 12.5, z: 20.5 }]);
    addSegment(w, ROAD.STREET, [c, { x: 20.5, z: 28.5 }]);
    addSegment(w, ROAD.STREET, [c, { x: 27.43, z: 24.5 }]); // 30-deg arm
    const node = w.nodes.find((n) => n.segs.length === 5)!;
    expect(hasSignal(w, node.id)).toBe(true);
    // nodeArms order: N, E, 30-deg, S, W.
    const sn = signalNodes(w).find((s) => s.id === node.id)!;
    expect(sn.arms.map((a) => a.ns)).toEqual([true, false, false, true, false]);
  });

  it("groups one-way arms by geometry like two-way arms", () => {
    const twoWay = diagonalCross(false);
    const oneWay = diagonalCross(true);
    const nsOf = (w: typeof twoWay.w, id: number) =>
      signalNodes(w).find((s) => s.id === id)!.arms.map((a) => a.ns);
    expect(nsOf(oneWay.w, oneWay.node.id)).toEqual(nsOf(twoWay.w, twoWay.node.id));
    // The two entries (NW arm 0, SW arm 3) cross: they oppose each other.
    const groups = nsOf(oneWay.w, oneWay.node.id);
    expect(groups[0]).not.toBe(groups[3]);
  });

  it("derives identical signals for identical builds", () => {
    const a = diagonalCross();
    const b = diagonalCross();
    expect(JSON.stringify(signalNodes(b.w))).toBe(JSON.stringify(signalNodes(a.w)));
    expect(signalOffset(a.node.id)).toBe(signalOffset(b.node.id));
  });

  it("round-trips a city with a skewed signalised junction (no format change)", () => {
    const s = newCity(3);
    const w = s.world;
    addSegment(w, ROAD.AVENUE, [{ x: 30.5, z: 30.5 }, { x: 46.5, z: 30.5 }]);
    addSegment(w, ROAD.STREET, [{ x: 45.64, z: 24.37 }, { x: 35.36, z: 36.63 }]); // 130 deg
    const d2 = (n: { x: number; z: number }) => (n.x - 40.5) ** 2 + (n.z - 30.5) ** 2;
    const node = [...w.nodes].sort((a, b) => d2(a) - d2(b))[0];
    expect(node.segs.length).toBe(4);
    expect(hasSignal(w, node.id)).toBe(true);
    const before = JSON.stringify(signalNodes(w));
    // Signals leave no trace in the save: they derive from the graph.
    expect(serialize(s)).not.toContain("sigNodes");
    const back = deserialize(serialize(s));
    expect(JSON.stringify(signalNodes(back.world))).toBe(before);
    expect(hasSignal(back.world, node.id)).toBe(true);
    expect(armHasGreen(back.world, node.id, 0, 3.7)).toBe(armHasGreen(w, node.id, 0, 3.7));
  });
});
