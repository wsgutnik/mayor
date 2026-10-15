import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildRoadNetworkGeometry, ROAD_LIFT } from "./roads";
import { buildRoadsScenario } from "../dev/scenario";
import { profileOf } from "../sim/corridor";
import { junctionsOf } from "../sim/junction";
import { curvePoints, heightAt, makeDeckSampler, segElevation, type Pt } from "../sim/world";

/**
 * Polish item 3 / rereview Unit A: no kerb- or sidewalk-band geometry crosses a
 * carriageway. Every band triangle (low tier: KERB vertex colour, same
 * surface() as the atlas tier; pad bands are identical in both tiers) is
 * sampled at its centroid and at the midpoints between the centroid and each
 * corner; no sample may lie strictly inside any segment's carriageway
 * (|lateral| < asphaltHalf - 1e-3, station strictly between the segment's two
 * asphalt mouth edges, or the node when it has no layout arm) at that
 * segment's surface height. Covers every case of the roads scenario
 * (?scenario=roads), bridges and dead ends next to bridges included.
 */
const KERB = new THREE.Color("#ccd0d6");
const KERB_LIFT = ROAD_LIFT + 0.006;

describe("no band geometry across a carriageway", () => {
  // The scenario is built once for both tests (CI runs the default 5 s timeout).
  let state: ReturnType<typeof buildRoadsScenario>["state"];
  beforeAll(() => { state = buildRoadsScenario().state; }, 20000);

  it("roads scenario: every mouth, both band layers", () => {
    const w = state.world;
    const gy = (x: number, z: number): number => heightAt(w, x, z);
    const geo = buildRoadNetworkGeometry(w, gy, { atlas: false });
    const pos = geo.getAttribute("position"), col = geo.getAttribute("color"), idx = geo.getIndex()!;
    const layouts = junctionsOf(w);
    const segs = w.segments.filter((sg) => segElevation(sg) !== "tunnel").map((sg) => {
      const poly = curvePoints(sg.pts, 0.1);
      const deck = segElevation(sg) === "bridge" ? makeDeckSampler(w, sg.pts) : null;
      let len = 0;
      const cum = [0];
      for (let i = 1; i < poly.length; i++) cum.push(len += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].z - poly[i - 1].z));
      // Carriageway region = the ribbon between the two asphalt mouth edges
      // (junction pads may legitimately narrow the road inside them, e.g. tapers).
      const startAt = (end: "a" | "b"): number => {
        const l = layouts.byNode.get(end === "a" ? sg.a : sg.b);
        const arm = l?.arms.find((x) => x.segId === sg.id && x.end === end);
        const m = arm?.mouth?.asphalt;
        return m ? Math.min(m.neg.s, m.pos.s) : 0;
      };
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of poly) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
      const hw = profileOf(sg.type).asphaltHalf;
      return { sg, poly, cum, len, deck, hw, s0: startAt("a"), s1: len - startAt("b"), box: [x0 - hw, z0 - hw, x1 + hw, z1 + hw] };
    });
    /** Station, signed lateral and surface y of p against one segment. */
    const frame = (s: (typeof segs)[number], p: Pt): { st: number; lat: number; y: number } => {
      let best = { d: Infinity, st: 0, lat: 0 };
      for (let i = 1; i < s.poly.length; i++) {
        const a = s.poly[i - 1], b = s.poly[i];
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
        if (l < 1e-12) continue;
        const t = Math.max(0, Math.min(l, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l));
        const fx = a.x + (dx / l) * t, fz = a.z + (dz / l) * t;
        const d = Math.hypot(p.x - fx, p.z - fz);
        if (d < best.d) best = { d, st: s.cum[i - 1] + t, lat: (-(p.x - fx) * dz + (p.z - fz) * dx) / l };
      }
      const y = s.deck ? s.deck.yAt(best.st) : gy(p.x, p.z);
      return { st: best.st, lat: best.lat, y };
    };
    let bands = 0;
    const bad: string[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      const v = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
      if (!v.every((k) => Math.abs(col.getX(k) - KERB.r) < 1e-6 && Math.abs(col.getY(k) - KERB.g) < 1e-6 && Math.abs(col.getZ(k) - KERB.b) < 1e-6)) continue;
      bands++;
      const P = v.map((k) => ({ x: pos.getX(k), y: pos.getY(k), z: pos.getZ(k) }));
      const c = { x: (P[0].x + P[1].x + P[2].x) / 3, y: (P[0].y + P[1].y + P[2].y) / 3, z: (P[0].z + P[1].z + P[2].z) / 3 };
      const samples = [c, ...P.map((q) => ({ x: (q.x + c.x) / 2, y: (q.y + c.y) / 2, z: (q.z + c.z) / 2 }))];
      for (const p of samples) {
        // Case E (cell 4) is today's diamond interchange: its addSegment ramps
        // (replaced in Roads 1B) run alongside the avenue's sidewalk ribbon,
        // a legacy ribbon/ribbon overlap rather than a mouth.
        if (Math.floor((p.x - 2) / 22) + 3 * Math.floor((p.z - 2) / 22) === 4) continue;
        for (const s of segs) {
          // Only a carriageway's own box can contain the sample.
          if (p.x < s.box[0] || p.x > s.box[2] || p.z < s.box[1] || p.z > s.box[3]) continue;
          const f = frame(s, p);
          if (f.st <= s.s0 + 1e-3 || f.st >= s.s1 - 1e-3) continue;
          if (Math.abs(p.y - (f.y + KERB_LIFT)) > 0.03) continue; // another level (bridge over street)
          if (Math.abs(f.lat) < s.hw - 1e-3) {
            bad.push(`case ${Math.floor((p.x - 2) / 22) + 3 * Math.floor((p.z - 2) / 22)} seg ${s.sg.id} st ${f.st.toFixed(3)} lat ${f.lat.toFixed(3)} at (${p.x.toFixed(3)},${p.z.toFixed(3)})`);
          }
        }
      }
    }
    expect(bands).toBeGreaterThan(0);
    expect(bad.length, bad.slice(0, 5).join("\n")).toBe(0);
  });

  it("every arm's asphalt, kerb and sidewalk rings cross it at one station per side", () => {
    let checked = 0;
    for (const l of junctionsOf(state.world).byNode.values()) {
      for (const arm of l.arms) {
        const m = arm.mouth;
        if (!m?.asphalt || !m.kerb || !m.sidewalk) continue;
        checked++;
        for (const side of ["neg", "pos"] as const) {
          expect(m.kerb[side].s, `node ${l.nodeId} seg ${arm.segId} ${side}`).toBeCloseTo(m.asphalt[side].s, 9);
          expect(m.sidewalk[side].s, `node ${l.nodeId} seg ${arm.segId} ${side}`).toBeCloseTo(m.asphalt[side].s, 9);
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
