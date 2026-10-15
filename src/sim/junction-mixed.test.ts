/**
 * Mixed-width and near-coincident junction arms (docs/process/07-junction-builder.md,
 * "Mouth assembly" recipe). Reviewer findings F4 (avenue + street corners with a
 * tangent behind the node folded every ring) and F5 (arms under 5 degrees gave
 * bow-tie rings that ear clipping over-covered 3x).
 *
 * Every layout must be simple, CCW and nested (checkJunction), every ring must
 * ear-clip to its own area within 1e-6, no trim may be negative, and every
 * fallback (shrunk radius, chamfer, merged gap) must be diagnosed.
 */
import { describe, expect, it } from "vitest";
import { generateWorld, type Pt, type RoadType, type World } from "./world";
import { addSegment } from "./roads";
import { buildJunction, checkJunction, type JunctionLayout } from "./junction";
import { triangulateRing } from "../render/earclip";

const C = { x: 32.5, z: 32.5 };
const ARM = 20;
const STREET = 1 as RoadType;
const AVENUE = 2 as RoadType;

function blank(): World {
  const w = generateWorld(64, 7);
  w.road.fill(0); w.roadSurface.fill(0); w.roadDeck.fill(0); w.roadTunnel.fill(0); w.deckH.fill(NaN);
  w.zone.fill(0); w.level.fill(0); w.facility.fill(0); w.connected.fill(0);
  w.segments.length = 0; w.nodes.length = 0; w.nextNodeId = 1; w.nextSegmentId = 1; w.heights.fill(1);
  return w;
}

interface ArmSpec { type: RoadType; deg: number }

/** Arms leave C at `deg`; odd arms are drawn toward the node (end "b"). */
function build(arms: ArmSpec[], rotDeg = 0, mirror = false, len = ARM): JunctionLayout {
  const w = blank();
  for (let k = 0; k < arms.length; k++) {
    let deg = mirror ? 180 - arms[k].deg : arms[k].deg;
    deg += rotDeg;
    const r = (deg * Math.PI) / 180;
    const far = { x: C.x + len * Math.cos(r), z: C.z + len * Math.sin(r) };
    addSegment(w, arms[k].type, k % 2 === 0 ? [{ ...C }, far] : [far, { ...C }]);
  }
  const node = w.nodes.find((n) => Math.hypot(n.x - C.x, n.z - C.z) < 1e-6);
  if (!node) throw new Error("centre node missing");
  return buildJunction(w, node.id)!;
}

function area(r: Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p.x * q.z - q.x * p.z; }
  return a / 2;
}

/** All failures of one layout (empty when sound). */
function soundness(l: JunctionLayout, label: string): string[] {
  const out: string[] = [];
  const ck = checkJunction(l);
  for (const e of ck.errors) out.push(`${label}: ${e}`);
  for (const [name, r] of [["asphalt", l.asphalt], ["kerb", l.kerbOuter], ["sidewalk", l.sidewalkOuter], ["boundary", l.boundary]] as const) {
    if (r.length === 0) continue;
    let got = 0;
    for (const t of triangulateRing(r)) got += Math.abs(area(t));
    if (Math.abs(got - area(r)) > 1e-6) out.push(`${label}: ${name} triangulated ${got.toFixed(6)} vs ring ${area(r).toFixed(6)}`);
  }
  for (const a of l.arms) {
    for (const s of [a.trimNeg, a.trimPos]) {
      for (const v of [s.asphalt, s.kerb, s.sidewalk, s.boundary]) {
        if (v < 0) out.push(`${label}: seg ${a.segId} negative trim ${v}`);
      }
    }
  }
  const has = (c: string): boolean => l.diagnostics.some((d) => d.code === c);
  if (l.fillets.some((f) => f.chamfered && f.kind === "convex") && !has("chamfered-corner")) {
    out.push(`${label}: chamfered corner without diagnostic`);
  }
  if (l.fillets.some((f) => f.kind === "convex" && !f.chamfered && f.rEff < f.rNominal - 1e-9) && !has("radius-shrunk")) {
    out.push(`${label}: shrunk radius without diagnostic`);
  }
  if (l.fillets.some((f) => f.kind === "merged") !== has("min-gap-merged")) {
    out.push(`${label}: merged gap and min-gap-merged diagnostic disagree`);
  }
  return out;
}

const SWEEP = [4, 6, 10, 20, 30, 45, 60, 90];

/** Through avenue (west and east arms) with one street at side * theta off the east arm. */
const single = (deg: number, side: number): ArmSpec[] =>
  [{ type: AVENUE, deg: 180 }, { type: AVENUE, deg: 0 }, { type: STREET, deg: side * deg }];
/** Avenue ending from the west, a street straight on and a street at side * theta. */
const pair = (deg: number, side: number): ArmSpec[] =>
  [{ type: AVENUE, deg: 180 }, { type: STREET, deg: side * deg }, { type: STREET, deg: 0 }];

describe("mixed-width mouth assembly", () => {
  it("avenue with one street: simple, nested, CCW rings at every angle, both sides, mirrored", () => {
    const fails: string[] = [];
    for (const deg of SWEEP) for (const side of [1, -1]) for (const mirror of [false, true]) {
      fails.push(...soundness(build(single(deg, side), 0, mirror), `single ${deg} side ${side}${mirror ? " mirrored" : ""}`));
    }
    expect(fails).toEqual([]);
  });

  it("avenue with a pair of streets: simple, nested, CCW rings at every angle, both sides, mirrored", () => {
    const fails: string[] = [];
    for (const deg of SWEEP) for (const side of [1, -1]) for (const mirror of [false, true]) {
      fails.push(...soundness(build(pair(deg, side), 0, mirror), `pair ${deg} side ${side}${mirror ? " mirrored" : ""}`));
    }
    expect(fails).toEqual([]);
  });

  it("keeps tangent fillets on long arms from 10 degrees up", () => {
    for (const deg of [10, 20, 30, 45, 60, 90]) {
      for (const spec of [single(deg, 1), pair(deg, 1)]) {
        const l = build(spec);
        for (const f of l.fillets.filter((x) => x.kind === "convex")) {
          expect(f.chamfered, `${deg}deg ${JSON.stringify(f)}`).toBe(false);
          expect(f.rEff).toBeGreaterThanOrEqual(0.2);
        }
      }
    }
  });

  it("continues the avenue kerb straight past the node toward an obtuse street", () => {
    // Street 10 degrees off the east avenue arm: the west arm's north edge meets
    // the street's fillet 2.35 tiles east of the node (tangent behind the node).
    const l = build(single(10, 1));
    const edgeZ = C.z + 0.81;
    const onEdge = l.asphalt.filter((p) => Math.abs(p.z - edgeZ) < 2e-3 && p.x > C.x + 1);
    expect(onEdge.length).toBeGreaterThan(0);
    expect(l.diagnostics.some((d) => d.code === "trim-clamped" && d.detail?.includes("continued"))).toBe(true);
    // The pair case at 30 degrees (the reviewer's -0.482 trim) is the same corner.
    const p = build(pair(30, 1));
    const ave = p.arms.find((a) => a.type === AVENUE)!;
    expect(Math.min(ave.trimNeg.asphalt, ave.trimPos.asphalt)).toBeGreaterThanOrEqual(0);
  });

  it("keeps the wider arm's kerb continuous at a straight taper", () => {
    const l = build([{ type: AVENUE, deg: 180 }, { type: STREET, deg: 0 }]);
    expect(l.kind).toBe("taper");
    const ave = l.arms.find((a) => a.type === AVENUE)!;
    const mouthX = C.x + ave.dx * l.taper!.length;
    const seam = l.kerbOuter.filter((p) =>
      Math.abs(p.x - mouthX) < 2e-3 && Math.abs(Math.abs(p.z - C.z) - 0.9) < 2e-3);
    expect(seam.length).toBe(2);
  });

  it("wraps the wider arm's kerb around a straight width step", () => {
    // Avenue ends at the node, street continues straight on: the avenue's
    // kerb and sidewalk wrap the step face (kerbOuter is never collinear
    // with the asphalt step on the street side).
    const l = build(pair(30, 1));
    const step = l.kerbOuter.filter((p) => Math.abs(p.x - (C.x + 0.09)) < 2e-3 && p.z < C.z - 0.4);
    expect(step.length).toBeGreaterThanOrEqual(2);
  });
});

describe("arms closer than the minimum gap", () => {
  const types: [RoadType, RoadType, RoadType][] = [
    [STREET, STREET, STREET], [AVENUE, STREET, STREET], [STREET, AVENUE, STREET],
    [STREET, STREET, AVENUE], [AVENUE, AVENUE, AVENUE], [AVENUE, STREET, AVENUE],
  ];
  it("merges 2, 3 and 4 degree arms into one mouth with a diagnostic", () => {
    const fails: string[] = [];
    for (const deg of [2, 3, 4]) {
      for (const [t0, t1, t2] of types) {
        for (const side of [1, -1]) for (const mirror of [false, true]) {
          const three = build([{ type: t0, deg: 180 }, { type: t1, deg: 0 }, { type: t2, deg: side * deg }], 0, mirror);
          const label = `${deg}deg ${t0}/${t1}/${t2} side ${side}${mirror ? " mirrored" : ""}`;
          fails.push(...soundness(three, label));
          if (!three.diagnostics.some((d) => d.code === "min-gap-merged")) fails.push(`${label}: no min-gap-merged`);
          const two = build([{ type: t1, deg: 0 }, { type: t2, deg: side * deg }], 0, mirror);
          fails.push(...soundness(two, `two-arm ${label}`));
          if (!two.diagnostics.some((d) => d.code === "min-gap-merged")) fails.push(`two-arm ${label}: no min-gap-merged`);
        }
      }
    }
    expect(fails).toEqual([]);
  });

  it("starts the narrower arm's ribbon at the merged mouth", () => {
    const l = build([{ type: AVENUE, deg: 180 }, { type: AVENUE, deg: 0 }, { type: STREET, deg: 3 }]);
    const street = l.arms.find((a) => a.type === STREET)!;
    const avenue = l.arms.find((a) => a.type === AVENUE && Math.abs(a.angle) < 0.2)!;
    // Both ribbons start at the same mouth line: positive trims, within the
    // lateral offset of a 3-degree skew of each other.
    for (const t of [street.trimNeg, street.trimPos, avenue.trimNeg, avenue.trimPos]) expect(t.asphalt).toBeGreaterThan(0);
    const ts = Math.max(street.trimNeg.asphalt, street.trimPos.asphalt);
    const ta = Math.max(avenue.trimNeg.asphalt, avenue.trimPos.asphalt);
    expect(Math.abs(ts - ta)).toBeLessThan(0.05);
  });
});

describe("short arms (budget shrink, chamfer and miter paths)", () => {
  it("stays sound on 1.2, 2 and 5 tile arms", () => {
    const fails: string[] = [];
    for (const len of [1.2, 2, 5]) for (const deg of [3, 8, 15, 25, 35, 45, 60, 90, 120, 150, 170]) {
      const specs: [string, ArmSpec[]][] = [
        ["single", single(deg, 1)], ["pair", pair(deg, 1)],
        ["street end + avenue pair", [{ type: STREET, deg: 180 }, { type: AVENUE, deg: deg }, { type: AVENUE, deg: 0 }]],
        ["avenue + street bend", [{ type: AVENUE, deg: 0 }, { type: STREET, deg }]],
        ["street Y", [{ type: STREET, deg: 180 }, { type: STREET, deg: 0 }, { type: STREET, deg }]],
      ];
      for (const [name, spec] of specs) fails.push(...soundness(build(spec, 0, false, len), `${name} ${deg}deg arms ${len}`));
    }
    expect(fails).toEqual([]);
  });
});

describe("skill hard cases at arbitrary rotations", () => {
  it("5 arms, cross, Y 25, avenue T and avenue pair stay sound every 9 degrees", () => {
    const specs: [string, ArmSpec[]][] = [
      ["5-arm", [0, 72, 144, 216, 288].map((deg) => ({ type: STREET, deg }))],
      ["cross", [0, 90, 180, 270].map((deg) => ({ type: STREET, deg }))],
      ["y25", [{ type: STREET, deg: 180 }, { type: STREET, deg: 0 }, { type: STREET, deg: 25 }]],
      ["avenue T", single(90, 1)],
      ["avenue pair 30", pair(30, 1)],
      ["merged 3", single(3, 1)],
    ];
    const fails: string[] = [];
    for (const [name, spec] of specs) for (let rot = 0; rot < 90; rot += 9) {
      fails.push(...soundness(build(spec, rot), `${name} rot ${rot}`));
    }
    expect(fails).toEqual([]);
  });
});

describe("rotation invariance at 30 degrees", () => {
  const rotBack = (p: Pt): Pt => {
    const t = (-30 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const dx = p.x - C.x, dz = p.z - C.z;
    return { x: C.x + dx * c - dz * s, z: C.z + dx * s + dz * c };
  };
  const hausdorff = (a: Pt[], b: Pt[]): number => {
    let h = 0;
    for (const [p, r] of [[a, b], [b, a]] as const) {
      for (const x of p) {
        let best = Infinity;
        for (const y of r) best = Math.min(best, Math.hypot(x.x - y.x, x.z - y.z));
        h = Math.max(h, best);
      }
    }
    return h;
  };
  for (const [name, spec] of [["pair 30", pair(30, 1)], ["single 20", single(20, -1)], ["merged 3", single(3, 1)]] as const) {
    it(`${name}: same rings and trims once rotated back`, () => {
      const l0 = build(spec);
      const l1 = build(spec, 30);
      expect(soundness(l1, name)).toEqual([]);
      for (const k of ["asphalt", "kerbOuter", "sidewalkOuter", "boundary"] as const) {
        expect(hausdorff(l1[k].map(rotBack), l0[k]), k).toBeLessThan(3e-3);
      }
      const trims = (l: JunctionLayout): number[] =>
        l.arms.flatMap((a) => [a.trimNeg.asphalt, a.trimPos.asphalt]).sort((x, y) => x - y);
      const a = trims(l0), b = trims(l1);
      for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(3e-3);
    });
  }
});
