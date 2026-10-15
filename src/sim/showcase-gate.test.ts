import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { CityState } from "./sim";
import { nodeArms, segById } from "./roads";
import { buildJunction } from "./junction";
import { Pt, curvePoints, heightAt, segElevation, segmentLength } from "./world";
import { buildRoadNetworkGeometry, junctionDebugGeometry } from "../render/roads";
import { triangulateRing } from "../render/earclip";
import {
  SHOWCASE_CASES, SHOWCASE_GRID, SHOWCASE_TITLES, Tri, buildCaseWorld, buildShowcaseWorld,
  coveredByTris, fanTris, intersectionArea, minTriAngleDeg, pointInPoly, polyArea,
  ringSelfIntersects, ringsOverlap, triArea2, ShowcaseCaseName,
} from "./showcase-cases";

const SHOT_DIR = "/tmp/mayor-agents/fqual-shots";

/** Asphalt-layer triangles of the built road mesh (ribbon 0.06 + patch 0.08 lifts). */
function asphaltTris(s: CityState): { tris: Tri[]; total: number } {
  const gy = (x: number, z: number): number => heightAt(s.world, x, z);
  const g = buildRoadNetworkGeometry(s.world, gy);
  const pos = g.attributes.position.array as Float32Array;
  expect(pos.length).toBeGreaterThan(0);
  for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i])).toBe(true);
  const idxAttr = g.index!;
  const tris: Tri[] = [];
  for (let t = 0; t < idxAttr.count; t += 3) {
    const vi = [idxAttr.getX(t), idxAttr.getX(t + 1), idxAttr.getX(t + 2)];
    const ax = pos[vi[0] * 3], az = pos[vi[0] * 3 + 2];
    const bx = pos[vi[1] * 3], bz = pos[vi[1] * 3 + 2];
    const cx = pos[vi[2] * 3], cz = pos[vi[2] * 3 + 2];
    const y = (pos[vi[0] * 3 + 1] + pos[vi[1] * 3 + 1] + pos[vi[2] * 3 + 1]) / 3;
    const lift = y - gy((ax + bx + cx) / 3, (az + bz + cz) / 3);
    if (Math.abs(lift - 0.06) > 5e-4 && Math.abs(lift - 0.08) > 5e-4) continue;
    tris.push({ ax, az, bx, bz, cx, cz });
  }
  return { tris, total: idxAttr.count / 3 };
}

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x, vz = b.z - a.z;
  const l2 = vx * vx + vz * vz;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2));
  return Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t));
}

const onBoundary = (poly: Pt[], p: Pt): boolean =>
  poly.some((a, i) => distToSeg(p, a, poly[(i + 1) % poly.length]) < 2e-3);

/** Plan-view SVG: asphalt rings, kerbs, centrelines, nodes, focus. */
function dumpCaseSvg(name: ShowcaseCaseName, s: CityState, focus: Pt): void {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const w = s.world;
  const polys: Pt[][] = [];
  const kerbs: Pt[][] = [];
  for (const node of w.nodes) {
    const l = buildJunction(w, node.id);
    if (!l || l.arms.length < 2) continue;
    const d = junctionDebugGeometry(l);
    if (d.asphalt.length >= 3) polys.push(d.asphalt);
    kerbs.push(...d.kerbs);
  }
  const centres: Pt[][] = w.segments
    .filter((sg) => segElevation(sg) === "ground")
    .map((sg) => curvePoints(sg.pts, 0.25));
  const all = [...polys.flat(), ...kerbs.flat(), ...centres.flat(), focus];
  const minX = Math.min(...all.map((p) => p.x)) - 1, maxX = Math.max(...all.map((p) => p.x)) + 1;
  const minZ = Math.min(...all.map((p) => p.z)) - 1, maxZ = Math.max(...all.map((p) => p.z)) + 1;
  const sc = Math.min(900 / Math.max(1, maxX - minX), 700 / Math.max(1, maxZ - minZ));
  const px = (p: Pt): string => (((p.x - minX) * sc).toFixed(1));
  const pz = (p: Pt): string => (((p.z - minZ) * sc).toFixed(1));
  const pt = (p: Pt): string => `${px(p)},${pz(p)}`;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700">`,
    `<rect width="900" height="700" fill="#f8f8f4"/>`,
    `<text x="12" y="24" font-family="monospace" font-size="16" fill="#111">${name} — ${SHOWCASE_TITLES[name]}</text>`,
  ];
  for (const c of centres) {
    out.push(`<polyline points="${c.map(pt).join(" ")}" fill="none" stroke="#9aa0a6" stroke-width="2"/>`);
  }
  for (const p of polys) {
    out.push(`<polygon points="${p.map(pt).join(" ")}" fill="#3b3f46" stroke="#111" stroke-width="2"/>`);
  }
  for (const l of kerbs) {
    out.push(`<polyline points="${l.map(pt).join(" ")}" fill="none" stroke="#f5f5f0" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const n of w.nodes) {
    out.push(`<circle cx="${px(n)}" cy="${pz(n)}" r="4" fill="#d33"/>`);
  }
  out.push(`<circle cx="${px(focus)}" cy="${pz(focus)}" r="7" fill="none" stroke="#0a0" stroke-width="2"/>`);
  out.push(`</svg>`);
  fs.writeFileSync(`${SHOT_DIR}/${name}.svg`, out.join("\n"));
}

interface CaseMetrics {
  segs: number;
  nodes: number;
  junctions: number;
  rings: number;
  minFanArea: number;
  minFanAngle: number;
  minKerbArea: number;
  minKerbAngle: number;
  coverage: number;
  coverageMiss: number;
  missDetail: string[];
  maxRingOverlap: number;
  nonSimple: number;
}

/**
 * Ratchet pins for the two known-today violations (fqual findings F1/F2).
 * Each pin is the EXACT current count: a regression (more) or a fix (fewer)
 * both fail the gate, forcing an explicit pin update. P2/P3 must drive every
 * pin to 0; the critic rejects any change that raises one.
 */
const EXPECTED_MISSES: Record<ShowcaseCaseName, number> = {
  "cross-street": 0,
  "cross-avenue-street": 0,
  "tee": 0,
  "y-25": 0,
  "five-arm": 0,
  "dead-end": 0,
  "curve-node": 0,
  "bend": 0,
  "avenue-street-transition": 0,
  "bridge-ramp": 0,
  "short-pair": 0,
  "roundabout": 0,
};

const EXPECTED_NONSIMPLE: Record<ShowcaseCaseName, number> = {
  "cross-street": 0,
  "cross-avenue-street": 0,
  "tee": 0,
  "y-25": 0,
  "five-arm": 0,
  "dead-end": 0,
  "curve-node": 0,
  "bend": 0,
  "avenue-street-transition": 0,
  "bridge-ramp": 0,
  "short-pair": 0,
  "roundabout": 0,
};

function checkCase(name: ShowcaseCaseName): CaseMetrics {
  // Every case builds without throwing (buildCaseWorld throws on any failed road).
  const { state: s, focus } = buildCaseWorld(name);
  const w = s.world;
  const m: CaseMetrics = {
    segs: w.segments.length, nodes: w.nodes.length, junctions: 0, rings: 0,
    minFanArea: Infinity, minFanAngle: Infinity, minKerbArea: Infinity, minKerbAngle: Infinity,
    coverage: 0, coverageMiss: 0, missDetail: [], maxRingOverlap: 0, nonSimple: 0,
  };
  const { tris } = asphaltTris(s);
  expect(tris.length).toBeGreaterThan(0);

  // --- per-case structure ------------------------------------------------
  const nearFocus = (r: number) => w.nodes.filter((n) => Math.hypot(n.x - focus.x, n.z - focus.z) < r);
  switch (name) {
    case "cross-street":
      expect(nearFocus(0.6).some((n) => nodeArms(w, n.id).length === 4)).toBe(true);
      break;
    case "cross-avenue-street": {
      const j = nearFocus(0.6).find((n) => nodeArms(w, n.id).length === 4);
      expect(j).toBeDefined();
      expect(nodeArms(w, j!.id).some((a) => a.type === 2)).toBe(true);
      break;
    }
    case "tee":
      expect(nearFocus(0.6).some((n) => nodeArms(w, n.id).length === 3)).toBe(true);
      break;
    case "y-25": {
      const j = nearFocus(0.6).find((n) => nodeArms(w, n.id).length === 3);
      expect(j).toBeDefined();
      const angs = nodeArms(w, j!.id).map((a) => a.angle).sort((a, b) => a - b);
      const gaps = angs.map((a, i) => {
        let g = angs[(i + 1) % angs.length] - a;
        if (g < 0) g += 2 * Math.PI;
        return (g * 180) / Math.PI;
      });
      expect(Math.min(...gaps)).toBeGreaterThan(20);
      expect(Math.min(...gaps)).toBeLessThan(30);
      break;
    }
    case "five-arm":
      expect(nearFocus(0.6).some((n) => nodeArms(w, n.id).length === 5)).toBe(true);
      break;
    case "dead-end":
      expect(nearFocus(0.2).some((n) => nodeArms(w, n.id).length === 1)).toBe(true);
      // The round cap covers the tip.
      expect(coveredByTris(tris, focus.x - 0.2, focus.z)).toBe(true);
      break;
    case "curve-node":
      expect(nearFocus(0.4).some((n) => nodeArms(w, n.id).length === 3)).toBe(true);
      break;
    case "bend":
      expect(nearFocus(0.2).some((n) => nodeArms(w, n.id).length === 2)).toBe(true);
      break;
    case "avenue-street-transition": {
      const j = nearFocus(0.2).find((n) => nodeArms(w, n.id).length === 2);
      expect(j).toBeDefined();
      const types = new Set(nodeArms(w, j!.id).map((a) => a.type));
      expect(types.has(1) && types.has(2)).toBe(true);
      break;
    }
    case "bridge-ramp": {
      expect(w.segments.some((sg) => segElevation(sg) === "bridge")).toBe(true);
      expect(nearFocus(0.6).filter((n) => nodeArms(w, n.id).length === 4).length).toBe(0);
      break;
    }
    case "short-pair": {
      const js = w.nodes.filter((n) => nodeArms(w, n.id).length === 4);
      expect(js.length).toBe(2);
      expect(Math.abs(Math.hypot(js[0].x - js[1].x, js[0].z - js[1].z) - 1.5)).toBeLessThan(0.05);
      break;
    }
    case "roundabout":
      expect(w.roundabouts.length).toBe(1);
      break;
  }

  // --- ring invariants ----------------------------------------------------
  const rings: { node: number; ring: Pt[]; cx: number; cz: number }[] = [];
  for (const node of w.nodes) {
    const l = buildJunction(w, node.id);
    if (!l || l.arms.length < 2) continue;
    m.junctions++;
    const d = junctionDebugGeometry(l);
    if (d.asphalt.length < 3) continue;
    m.rings++;
    rings.push({ node: node.id, ring: d.asphalt, cx: l.centre.x, cz: l.centre.z });
    // KNOWN (fqual finding F1): every corner fillet arc is emitted in reverse
    // order (render/roads.ts arc(): the >PI swap walks pb->pa while the ring
    // walks pa->arc->pb), so each convex corner doubles the ring back over
    // itself. The patch still covers (folds double-cover), but no ring with a
    // corner is simple today. Logged as a metric; P2 (junction builder) must
    // flip this to an assertion (docs/process/junction-gate.md G3).
    if (ringSelfIntersects(d.asphalt)) m.nonSimple++;
    expect(polyArea(d.asphalt), `${name}: node ${node.id} ring has no area`).toBeGreaterThan(1e-6);
    const padTris = l.kind === "taper"
      ? triangulateRing(d.asphalt).map(([a, b, c]): Tri => ({
        ax: a.x, az: a.z, bx: b.x, bz: b.z, cx: c.x, cz: c.z,
      }))
      : fanTris(l.centre.x, l.centre.z, d.asphalt);
    for (const t of padTris) {
      const a = triArea2(t) / 2;
      const angle = minTriAngleDeg(t);
      m.minFanArea = Math.min(m.minFanArea, a);
      m.minFanAngle = Math.min(m.minFanAngle, angle);
      expect(a, `${name}: node ${node.id} pad sliver`).toBeGreaterThan(1e-9);
      if (l.kind === "taper") {
        expect(angle, `${name}: node ${node.id} taper ear-clip angle`).toBeGreaterThanOrEqual(2);
      }
    }
    for (const line of d.kerbs) {
      for (const p of line) {
        expect(pointInPoly(d.asphalt, p) && !onBoundary(d.asphalt, p),
          `${name}: node ${node.id} kerb inside asphalt`).toBe(false);
      }
    }
  }

  // --- no overlaps between distinct junction rings -------------------------
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const hit = ringsOverlap(rings[i].ring, rings[j].ring);
      if (hit) {
        m.maxRingOverlap = Math.max(m.maxRingOverlap,
          intersectionArea(rings[i].ring, rings[j].ring));
      }
      expect(hit, `${name}: rings of nodes ${rings[i].node} and ${rings[j].node} overlap`).toBe(false);
    }
  }

  // --- no gaps: every ground arm mouth is asphalt ---------------------------
  for (const node of w.nodes) {
    const l = buildJunction(w, node.id);
    if (!l || l.arms.length < 2) continue;
    for (const a of l.arms) {
      const seg = segById(w, a.segId)!;
      if (segElevation(seg) !== "ground") continue; // deck rides its own profile
      const len = segmentLength(seg.pts);
      for (const d of [0.4, 0.9, 1.4]) {
        if (d > 0.45 * len) continue;
        const px = l.centre.x + a.dx * d - a.dz * 0.05;
        const pz = l.centre.z + a.dz * d + a.dx * 0.05;
        m.coverage++;
        if (!coveredByTris(tris, px, pz)) {
          m.coverageMiss++;
          m.missDetail.push(`node${node.id}/${a.segId}${a.end}@${d}`);
        }
      }
    }
  }

  // --- determinism: rebuilding gives bit-identical rings --------------------
  const again = buildCaseWorld(name);
  const sig = (st: CityState): string => JSON.stringify(st.world.nodes.map((n) => {
    const l = buildJunction(st.world, n.id);
    return l && l.arms.length >= 2 ? junctionDebugGeometry(l).asphalt : [];
  }));
  expect(sig(again.state)).toBe(sig(s));

  // Ratchet pins (F1/F2): exact-count assertions, see EXPECTED_* above.
  expect(m.coverageMiss, `${name}: coverage misses ${m.missDetail.join(",")} (pin ${EXPECTED_MISSES[name]})`)
    .toBe(EXPECTED_MISSES[name]);
  expect(m.nonSimple, `${name}: non-simple rings (pin ${EXPECTED_NONSIMPLE[name]})`)
    .toBe(EXPECTED_NONSIMPLE[name]);

  dumpCaseSvg(name, s, focus);
  return m;
}

describe("showcase gate: junction/road hard cases", () => {
  for (const name of SHOWCASE_CASES) {
    it(`builds ${name} with overlap/gap/sliver-free geometry`, () => {
      const m = checkCase(name);
      const f = (v: number): string => (v === Infinity ? "n/a" : v.toExponential(1));
      const a = (v: number): string => (v === Infinity ? "n/a" : v.toFixed(1));
      console.log(
        `gate ${name}: segs=${m.segs} nodes=${m.nodes} junctions=${m.junctions} rings=${m.rings} ` +
        `fanArea>=${f(m.minFanArea)} fanAng>=${a(m.minFanAngle)} ` +
        `kerbArea>=${f(m.minKerbArea)} kerbAng>=${a(m.minKerbAngle)} ` +
        `coverage=${m.coverage - m.coverageMiss}/${m.coverage} ` +
        `ringOverlap~${m.maxRingOverlap.toExponential(1)} nonSimple=${m.nonSimple}`,
      );
    });
  }

  it("stages all 12 cases in one world without cross-talk", () => {
    const { state: s, focusOf } = buildShowcaseWorld();
    const w = s.world;
    // Every case keeps its focus junction; no two cases share a node.
    const owners = new Map<number, string>();
    for (const name of SHOWCASE_CASES) {
      const f = focusOf[name];
      const g = SHOWCASE_GRID[name];
      const local = w.nodes.filter((n) =>
        n.x >= g.ox && n.x <= g.ox + 17 && n.z >= g.oz && n.z <= g.oz + 17);
      expect(local.length, `${name}: no nodes in its grid cell`).toBeGreaterThan(0);
      for (const n of local) {
        const prev = owners.get(n.id);
        expect(prev, `${name}: node ${n.id} shared with ${prev}`).toBeUndefined();
        owners.set(n.id, name);
      }
      if (name === "dead-end") {
        expect(local.some((n) => Math.hypot(n.x - f.x, n.z - f.z) < 0.2)).toBe(true);
      } else if (name === "roundabout") {
        // The centre node is consumed; four ring nodes sit at r = 1.5.
        expect(local.filter((n) => nodeArms(w, n.id).length >= 2
          && Math.hypot(n.x - f.x, n.z - f.z) < 2.2).length).toBe(4);
      } else if (name !== "bridge-ramp") {
        expect(local.some((n) => nodeArms(w, n.id).length >= 2
          && Math.hypot(n.x - f.x, n.z - f.z) < 1.0), `${name}: focus junction missing`).toBe(true);
      }
    }
    expect(w.roundabouts.length).toBe(1);
    expect(w.segments.filter((sg) => segElevation(sg) === "bridge").length).toBeGreaterThan(0);
  });
});
