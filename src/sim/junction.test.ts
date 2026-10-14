import { describe, expect, it } from "vitest";
import { generateWorld, type Pt, type RoadType, type World } from "./world";
import { addSegment, nodeById } from "./roads";
import { buildJunction, checkJunction, junctionsOf, type JunctionLayout } from "./junction";

function blank(size = 40): World {
  const w = generateWorld(size, 7);
  w.road.fill(0);
  w.roadSurface.fill(0);
  w.roadDeck.fill(0);
  w.roadTunnel.fill(0);
  w.deckH.fill(NaN);
  w.zone.fill(0);
  w.level.fill(0);
  w.facility.fill(0);
  w.connected.fill(0);
  w.segments.length = 0;
  w.nodes.length = 0;
  w.nextNodeId = 1;
  w.nextSegmentId = 1;
  w.heights.fill(1);
  return w;
}

function near(w: World, x: number, z: number): number {
  let best = -1, bd = Infinity;
  for (const n of w.nodes) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}

function expectClean(l: JunctionLayout): void {
  const c = checkJunction(l);
  expect(c.errors, JSON.stringify(c.errors)).toEqual([]);
  expect(c.ok).toBe(true);
}

/** Independent CCW check (does not reuse the checker's area code path). */
function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], r = ring[(i + 1) % ring.length];
    a += p.x * r.z - r.x * p.z;
  }
  return a / 2;
}

function expectCCW(l: JunctionLayout): void {
  for (const r of [l.asphalt, l.kerbOuter, l.sidewalkOuter, l.boundary]) {
    if (r.length === 0) continue;
    expect(signedArea(r)).toBeGreaterThan(1e-6);
  }
}

function crossWorld(): { w: World; node: number } {
  const w = blank();
  addSegment(w, 1, [{ x: 4.5, z: 20.5 }, { x: 36.5, z: 20.5 }]);
  addSegment(w, 1, [{ x: 20.5, z: 4.5 }, { x: 20.5, z: 36.5 }]);
  return { w, node: near(w, 20.5, 20.5) };
}

describe("junction builder P2", () => {
  function pairedJunctions(distance: number, trunkType: RoadType = 1, branchType: RoadType = 1, y = false): { w: World; a: number; b: number; seg: number } {
    const w = blank(64), x = 28.5, z = 28.5, end = x + distance;
    const branch = (cx: number, sign: number): Pt => y
      ? { x: cx + Math.cos((25 * Math.PI / 180) * sign) * 5, z: z + Math.sin((25 * Math.PI / 180) * sign) * 5 }
      : { x: cx, z: z + sign * 5 };
    addSegment(w, trunkType, [{ x, z }, { x: end, z }]);
    for (const cx of [x, end]) {
      addSegment(w, branchType, [{ x: cx, z }, branch(cx, 1)]);
      addSegment(w, branchType, [{ x: cx, z }, branch(cx, -1)]);
    }
    const a = near(w, x, z), b = near(w, end, z);
    const seg = w.segments.find((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a))!.id;
    return { w, a, b, seg };
  }

  function expectJointBudget(w: World, a: number, b: number, seg: number): void {
    const la = buildJunction(w, a)!, lb = buildJunction(w, b)!;
    const aa = la.arms.find((arm) => arm.segId === seg)!;
    const bb = lb.arms.find((arm) => arm.segId === seg)!;
    const ta = Math.max(aa.trimNeg.asphalt, aa.trimPos.asphalt);
    const tb = Math.max(bb.trimNeg.asphalt, bb.trimPos.asphalt);
    expect(ta + tb + 0.12).toBeLessThanOrEqual(Math.hypot(lb.centre.x - la.centre.x, lb.centre.z - la.centre.z) + 1e-3);
    expect(aa.markingsSuppressed).toBe(true);
    expect(bb.markingsSuppressed).toBe(true);
    expect(la.diagnostics.some((d) => d.code === "short-segment")).toBe(true);
    expect(lb.diagnostics.some((d) => d.code === "short-segment")).toBe(true);
    // At 1.0 tile the outer sidewalk mitres intentionally meet at the
    // shared boundary; the pad budget is asserted above on asphalt trims.
  }

  it("jointly budgets 1.0 and 1.66-tile cross pairs, including avenue + street", () => {
    for (const [distance, trunk, branch] of [[1.0, 1, 1], [1.66, 2, 1]] as const) {
      const p = pairedJunctions(distance, trunk, branch);
      expectJointBudget(p.w, p.a, p.b, p.seg);
    }
  });

  it("jointly budgets a 25-degree Y pair without independent pad marks", () => {
    const p = pairedJunctions(1.66, 1, 1, true);
    expectJointBudget(p.w, p.a, p.b, p.seg);
  });

  it("builds a 4-way street cross with four equal returns and 0.83 trims", () => {
    const { w, node } = crossWorld();
    const l = buildJunction(w, node)!;
    expect(l.kind).toBe("junction");
    expect(l.template).toBe("cross");
    expect(l.arms).toHaveLength(4);
    for (const a of l.arms) {
      expect(a.trimNeg.asphalt).toBeCloseTo(0.83, 3);
      expect(a.trimPos.asphalt).toBeCloseTo(0.83, 3);
    }
    expect(l.fillets).toHaveLength(4);
    for (const f of l.fillets) {
      expect(f.kind).toBe("convex");
      expect(f.rNominal).toBeCloseTo(0.45, 3);
      expect(f.rEff).toBeCloseTo(0.45, 3);
      expect(f.chamfered).toBe(false);
    }
    expect(l.diagnostics).toEqual([]);
    expectClean(l);
    expectCCW(l);
  });

  it("builds a T with straight through sides at trim 0", () => {
    const w = blank();
    addSegment(w, 1, [{ x: 4.5, z: 20.5 }, { x: 36.5, z: 20.5 }]);
    addSegment(w, 1, [{ x: 20.5, z: 20.5 }, { x: 20.5, z: 36.5 }]);
    const l = buildJunction(w, near(w, 20.5, 20.5))!;
    expect(l.kind).toBe("junction");
    expect(l.template).toBe("tee");
    expect(l.fillets.filter((f) => f.kind === "convex")).toHaveLength(2);
    expect(l.fillets.filter((f) => f.kind === "straight")).toHaveLength(1);
    const trims = l.arms.flatMap((a) => [a.trimNeg.asphalt, a.trimPos.asphalt]).sort();
    expect(trims.slice(0, 2)).toEqual([0, 0]);
    for (const t of trims.slice(2)) expect(t).toBeCloseTo(0.83, 3);
    expectClean(l);
    expectCCW(l);
  });

  it("builds a bend with an inner arc tangent at the ray starts", () => {
    const w = blank();
    addSegment(w, 1, [{ x: 4.5, z: 20.5 }, { x: 20.5, z: 20.5 }]);
    addSegment(w, 1, [{ x: 20.5, z: 20.5 }, { x: 20.5, z: 36.5 }]);
    const l = buildJunction(w, near(w, 20.5, 20.5))!;
    expect(l.kind).toBe("bend");
    const convex = l.fillets.filter((f) => f.kind === "convex");
    const reflex = l.fillets.filter((f) => f.kind === "reflex");
    expect(convex).toHaveLength(1);
    expect(reflex).toHaveLength(1);
    expect(convex[0].rEff).toBeCloseTo(0.45, 3);
    // Inner arc: radius = asphalt half-width, centre on the node, trims 0.
    expect(reflex[0].rEff).toBeCloseTo(0.38, 3);
    expect(reflex[0].chamfered).toBe(false);
    expect(reflex[0].centre).toEqual(l.centre);
    const trims = l.arms.flatMap((a) => [a.trimNeg.asphalt, a.trimPos.asphalt]).sort((x, y) => x - y);
    expect(trims[0]).toBe(0);
    expect(trims[1]).toBe(0);
    expect(trims[2]).toBeCloseTo(0.83, 3);
    expect(trims[3]).toBeCloseTo(0.83, 3);
    expectClean(l);
    expectCCW(l);
  });

  it("caps a dead end with a sharp square and trims +B", () => {
    const w = blank();
    addSegment(w, 1, [{ x: 4.5, z: 20.5 }, { x: 20.5, z: 20.5 }]);
    const l = buildJunction(w, near(w, 4.5, 20.5))!;
    expect(l.kind).toBe("end");
    expect(l.template).toBe("end-square");
    // B = kerb + sidewalk = 0.19 for streets.
    expect(l.arms[0].trimNeg.asphalt).toBeCloseTo(0.19, 3);
    expect(l.arms[0].trimPos.asphalt).toBeCloseTo(0.19, 3);
    // Asphalt is exactly the sharp rectangle: no arc inside the road. The cap
    // spans s ∈ [0, B] INTO the segment (east of the node here), so the
    // ribbon starting at trim B butts against it with no gap.
    expect(l.asphalt).toHaveLength(4);
    const got = new Set(l.asphalt.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`));
    expect(got).toEqual(new Set(["4.500,20.120", "4.690,20.120", "4.690,20.880", "4.500,20.880"]));
    for (const p of l.asphalt) expect(p.x).toBeGreaterThanOrEqual(4.5);
    // Kerb and sidewalk wrap the tip as a U with outer arcs.
    expect(l.kerbOuter.length).toBeGreaterThan(8);
    expect(l.sidewalkOuter.length).toBeGreaterThan(8);
    expectClean(l);
    expectCCW(l);
  });

  it("leaves middle nodes and straight transitions without geometry", () => {
    const w = blank();
    addSegment(w, 1, [{ x: 4.5, z: 20.5 }, { x: 20.5, z: 20.5 }]);
    addSegment(w, 1, [{ x: 20.5, z: 20.5 }, { x: 36.5, z: 20.5 }]);
    const m = buildJunction(w, near(w, 20.5, 20.5))!;
    expect(m.kind).toBe("middle");
    expect(m.asphalt).toEqual([]);
    expect(m.lotAnchors).toEqual([]);
    expectClean(m);

    const t = blank();
    addSegment(t, 1, [{ x: 4.5, z: 20.5 }, { x: 20.5, z: 20.5 }]);
    addSegment(t, 2, [{ x: 20.5, z: 20.5 }, { x: 36.5, z: 20.5 }]);
    const tr = buildJunction(t, near(t, 20.5, 20.5))!;
    expect(tr.kind).toBe("transition");
    expect(tr.template).toBe("straight");
    expect(tr.asphalt).toEqual([]);
    expectClean(tr);
  });

  it("builds a bent transition with a chamfered asymmetric reflex", () => {
    const w = blank();
    addSegment(w, 1, [{ x: 4.5, z: 20.5 }, { x: 20.5, z: 20.5 }]);
    addSegment(w, 2, [{ x: 20.5, z: 20.5 }, { x: 20.5, z: 36.5 }]);
    const l = buildJunction(w, near(w, 20.5, 20.5))!;
    expect(l.kind).toBe("transition");
    expect(l.template).toBe("bend");
    const reflex = l.fillets.filter((f) => f.kind === "reflex");
    expect(reflex).toHaveLength(1);
    expect(reflex[0].chamfered).toBe(true);
    expect(l.diagnostics.some((d) => d.detail === "asymmetric reflex")).toBe(true);
    expectClean(l);
    expectCCW(l);
  });

  it("nests mixed-profile rings on an avenue+street T", () => {
    const w = blank();
    addSegment(w, 2, [{ x: 4.5, z: 20.5 }, { x: 36.5, z: 20.5 }]);
    addSegment(w, 1, [{ x: 20.5, z: 20.5 }, { x: 20.5, z: 36.5 }]);
    const l = buildJunction(w, near(w, 20.5, 20.5))!;
    expect(l.template).toBe("tee");
    // Asymmetric corner: each arm's trim comes from the OTHER arm's offset.
    const ave = l.arms.find((a) => a.type === 2)!;
    const stem = l.arms.find((a) => a.type === 1)!;
    expect(Math.max(ave.trimNeg.asphalt, ave.trimPos.asphalt)).toBeCloseTo(0.98, 3);
    expect(Math.min(stem.trimNeg.asphalt, stem.trimPos.asphalt)).toBeCloseTo(1.41, 3);
    expectClean(l);
    expectCCW(l);
  });

  it("shrinks the radius on a 25-degree Y with long arms", () => {
    const w = blank();
    const cx = 20.5, cz = 20.5, L = 3;
    const a1 = (25 * Math.PI) / 180;
    addSegment(w, 1, [{ x: cx, z: cz }, { x: cx + L, z: cz }]);
    addSegment(w, 1, [{ x: cx, z: cz }, { x: cx + Math.cos(a1) * L, z: cz + Math.sin(a1) * L }]);
    addSegment(w, 1, [{ x: cx, z: cz }, { x: cx - L, z: cz }]);
    const l = buildJunction(w, near(w, cx, cz))!;
    expect(l.kind).toBe("junction");
    expect(l.template).toBe("general");
    expect(l.diagnostics.some((d) => d.code === "radius-shrunk")).toBe(true);
    expect(l.diagnostics.some((d) => d.detail?.includes("miter rho"))).toBe(true);
    expectClean(l);
    expectCCW(l);
  });

  it("miters the wedge on a 25-degree Y with short arms and flags the overlap", () => {
    const w = blank();
    const cx = 20.5, cz = 20.5, L = 1.5;
    const a1 = (25 * Math.PI) / 180;
    addSegment(w, 1, [{ x: cx, z: cz }, { x: cx + L, z: cz }]);
    addSegment(w, 1, [{ x: cx, z: cz }, { x: cx + Math.cos(a1) * L, z: cz + Math.sin(a1) * L }]);
    addSegment(w, 1, [{ x: cx, z: cz }, { x: cx - L, z: cz }]);
    const l = buildJunction(w, near(w, cx, cz))!;
    expect(l.kind).toBe("junction");
    const wedge = l.fillets.filter((f) => f.kind === "convex")[0];
    expect(wedge.chamfered).toBe(true);
    expect(wedge.centre).toBeNull();
    expect(l.diagnostics.some((d) => d.detail?.includes("miter unfittable mouths"))).toBe(true);
    expect(l.diagnostics.some((d) => d.detail?.includes("over allowance"))).toBe(true);
    expectClean(l);
    expectCCW(l);
  });

  it("is deterministic and arm-order invariant", () => {
    const { w, node } = crossWorld();
    const a = buildJunction(w, node)!;
    const b = buildJunction(w, node)!;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const n = nodeById(w, node)!;
    n.segs.reverse();
    const c = buildJunction(w, node)!;
    expect(c.hash).toBe(a.hash);
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });

  it("is insertion-order invariant", () => {
    const w1 = blank();
    addSegment(w1, 1, [{ x: 4.5, z: 20.5 }, { x: 36.5, z: 20.5 }]);
    addSegment(w1, 1, [{ x: 20.5, z: 4.5 }, { x: 20.5, z: 36.5 }]);
    const w2 = blank();
    addSegment(w2, 1, [{ x: 20.5, z: 36.5 }, { x: 20.5, z: 4.5 }]);
    addSegment(w2, 1, [{ x: 36.5, z: 20.5 }, { x: 4.5, z: 20.5 }]);
    const l1 = buildJunction(w1, near(w1, 20.5, 20.5))!;
    const l2 = buildJunction(w2, near(w2, 20.5, 20.5))!;
    expect(l2.hash).toBe(l1.hash);
  });

  it("is rotation invariant at 30 degrees", () => {
    const rot = (x: number, z: number): Pt => {
      const t = (30 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      const dx = x - 20.5, dz = z - 20.5;
      return { x: 20.5 + dx * c - dz * s, z: 20.5 + dx * s + dz * c };
    };
    const w = blank(64);
    const h0 = { x: 4.5, z: 20.5 }, h1 = { x: 36.5, z: 20.5 };
    const v0 = { x: 20.5, z: 4.5 }, v1 = { x: 20.5, z: 36.5 };
    addSegment(w, 1, [rot(h0.x, h0.z), rot(h1.x, h1.z)]);
    addSegment(w, 1, [rot(v0.x, v0.z), rot(v1.x, v1.z)]);
    const l = buildJunction(w, near(w, 20.5, 20.5))!;
    expect(l.kind).toBe("junction");
    expect(l.template).toBe("cross");
    for (const a of l.arms) {
      expect(a.trimNeg.asphalt).toBeCloseTo(0.83, 3);
      expect(a.trimPos.asphalt).toBeCloseTo(0.83, 3);
    }
    expectClean(l);
    // Same shape as the axis-aligned cross once rotated back.
    const { w: w0, node: n0 } = crossWorld();
    const l0 = buildJunction(w0, n0)!;
    expect(l.asphalt.length).toBe(l0.asphalt.length);
    const back = (p: Pt): Pt => {
      const t = (-30 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      const dx = p.x - 20.5, dz = p.z - 20.5;
      return { x: 20.5 + dx * c - dz * s, z: 20.5 + dx * s + dz * c };
    };
    let hausdorff = 0;
    for (const p of l.asphalt.map(back)) {
      let best = Infinity;
      for (const r of l0.asphalt) best = Math.min(best, Math.hypot(p.x - r.x, p.z - r.z));
      hausdorff = Math.max(hausdorff, best);
    }
    expect(hausdorff).toBeLessThan(2e-3);
  });

  it("caches full rebuilds in junctionsOf", () => {
    const { w } = crossWorld();
    const first = junctionsOf(w);
    expect(first.byNode.size).toBe(w.nodes.length);
    expect(junctionsOf(w).byNode).toBe(first.byNode);
    addSegment(w, 1, [{ x: 4.5, z: 30.5 }, { x: 10.5, z: 30.5 }]);
    const second = junctionsOf(w);
    expect(second.byNode).not.toBe(first.byNode);
    expect(second.byNode.size).toBe(w.nodes.length);
    for (const l of second.byNode.values()) {
      const c = checkJunction(l);
      expect(c.errors, JSON.stringify(c.errors)).toEqual([]);
    }
  });

  it("excludes bridge arms from ground layouts", () => {
    const w = blank();
    addSegment(w, 1, [{ x: 4.5, z: 20.5 }, { x: 20.5, z: 20.5 }]);
    addSegment(w, 1, [{ x: 20.5, z: 20.5 }, { x: 20.5, z: 36.5 }], { elevation: "bridge" });
    const l = buildJunction(w, near(w, 20.5, 20.5))!;
    expect(l.kind).toBe("end");
    expect(l.excludedArms).toHaveLength(1);
    expect(l.excludedArms[0].layer).toBe("bridge");
    expect(l.diagnostics.some((d) => d.code === "layer-excluded")).toBe(true);
    expectClean(l);

    const wb = blank();
    addSegment(wb, 1, [{ x: 4.5, z: 20.5 }, { x: 20.5, z: 20.5 }], { elevation: "bridge" });
    const nb = buildJunction(wb, near(wb, 4.5, 20.5))!;
    expect(nb.kind).toBe("non-ground");
    expect(nb.asphalt).toEqual([]);
    expect(nb.diagnostics.some((d) => d.code === "non-ground-node")).toBe(true);
    expectClean(nb);
  });

  it("checkJunction catches corrupted layouts", () => {
    const { w, node } = crossWorld();
    const good = buildJunction(w, node)!;
    expectClean(good);
    const badCCW: JunctionLayout = { ...good, asphalt: [...good.asphalt].reverse() };
    expect(checkJunction(badCCW).errors.some((e) => e.includes("not CCW"))).toBe(true);
    const badTrim: JunctionLayout = {
      ...good,
      arms: good.arms.map((a, i) => (i === 0 ? { ...a, trimNeg: { ...a.trimNeg, asphalt: 0.1 } } : a)),
    };
    expect(checkJunction(badTrim).errors.some((e) => e.includes("mouth"))).toBe(true);
    const badHash: JunctionLayout = { ...good, hash: "deadbeef" };
    expect(checkJunction(badHash).errors.some((e) => e.includes("hash"))).toBe(true);
  });
});
