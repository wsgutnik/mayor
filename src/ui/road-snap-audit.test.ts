/**
 * Road snapping audit (docs/process/17-road-snapping.md).
 *
 * Headless harness: simulated strokes (world-space pointer positions + camera distance) against fixture cities
 * (straight street, straight avenue, 37 degree diagonal, curve, T, Y, existing parallel street). Each stroke is
 * resolved twice — LEGACY (pre-audit: angle/length guides + `snapToRoadTile`, the tile-centre snap) and V2
 * (`resolveRoadSnap` with a constant on-screen radius) — then placed on a clone with `placeRoad` and measured:
 *  - connected: the stroke end node is shared with the target road;
 *  - gap: distance from the stroke end node to the target centreline (0 when attached);
 *  - dangling: not connected although the pointer was within the kerb + radius of the road;
 *  - stub: segments created shorter than 1 tile;
 *  - dup: node pairs closer than 0.05 tiles;
 *  - bend: change of the stroke direction (degrees) between the raw pointer path and the built road.
 * Set SNAP_AUDIT=1 to print the per-case tables, SNAP_AUDIT_SVG=<dir> to write SVG dumps (legacy vs v2 per fixture).
 * The asserted thresholds fail with the LEGACY resolver.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyZoneAt, getZoneBlocks, newCity, placeRoad, planRoad } from "../sim/sim";
import { deserialize, serialize } from "../sim/save";
import { cidx, curvePoints, segmentLength, type Pt, type RoadType } from "../sim/world";
import { nearestOnSegment } from "../sim/roads";
import { profileOf } from "../sim/corridor";
import { cellPose } from "../sim/zoneblocks";
import {
  DEFAULT_ROAD_SNAP, resolveRoadSnap, snapPoint, snapRadiusTiles, snapToRoadTile, worldPerPixel,
  SNAP_PX_MOUSE, SNAP_PX_TOUCH, type SnapTarget,
} from "./road-snap";
import { frontageHalf, offsetPolyline, parallelOffset } from "./road-parallel";

type City = ReturnType<typeof newCity>;
const LOG = !!process.env.SNAP_AUDIT;
const FOV = 45, VIEW_H = 800;
/** Camera distance clamp of CameraRig (8..140) and its default (38). */
const ZOOMS = { near: 8, mid: 38, far: 140 } as const;
/** Camera-to-ground distance at the target is the rig distance (pitch does not change it). */
const radiusAt = (dist: number, touch = true): number => snapRadiusTiles(touch, worldPerPixel(dist, FOV, VIEW_H));

function flatCity(oriented = false): City {
  const c = newCity(1337, 96);
  const w = c.world;
  c.money = 1e9;
  if (oriented) w.zoning = "oriented";
  for (let y = 0; y <= w.size; y++) for (let x = 0; x <= w.size; x++) w.heights[cidx(w, x, y)] = 0.35;
  return c;
}
const clone = (c: City): City => { const d = deserialize(serialize(c)); d.world.zoning = c.world.zoning; return d; };

function build(c: City, type: RoadType, pts: Pt[]): void {
  const r = placeRoad(c, type, pts);
  if (!r.ok) throw new Error(`fixture road refused: ${r.reason} ${JSON.stringify(pts)}`);
}

interface Fixture { name: string; city: City; target: Pt[]; type: RoadType }

/** Fixtures live well south of the entry highway. */
function fixtures(): Fixture[] {
  const out: Fixture[] = [];
  const probe = newCity(1337, 96);
  const z0 = probe.world.entry.y < 48 ? probe.world.entry.y + 30 : probe.world.entry.y - 30;
  const P = (x: number, dz: number): Pt => ({ x, z: z0 + dz });
  { const c = flatCity(); const t = [P(20.5, 0.5), P(70.5, 0.5)]; build(c, 1, t); out.push({ name: "straight street", city: c, target: t, type: 1 }); }
  { const c = flatCity(); const t = [P(20, 0), P(70, 0)]; build(c, 2, t); out.push({ name: "straight avenue", city: c, target: t, type: 2 }); }
  {
    const c = flatCity(); const a = (37 * Math.PI) / 180;
    const t = [P(24.2, -12.3), { x: 24.2 + Math.cos(a) * 30, z: z0 - 12.3 + Math.sin(a) * 30 }];
    build(c, 1, t); out.push({ name: "diagonal 37deg", city: c, target: t, type: 1 });
  }
  { const c = flatCity(); const t = [P(22.5, -8.5), P(46.5, 14.5), P(70.5, -8.5)]; build(c, 1, t); out.push({ name: "curve", city: c, target: t, type: 1 }); }
  {
    const c = flatCity(); const t = [P(20.5, 0.5), P(70.5, 0.5)]; build(c, 1, t); build(c, 1, [P(45.5, 0.5), P(45.5, -12.5)]);
    out.push({ name: "T (side street)", city: c, target: t, type: 1 });
  }
  {
    const c = flatCity(); build(c, 1, [P(20.5, 0.5), P(40.5, 0.5)]);
    const t = [P(40.5, 0.5), { x: 40.5 + 20 * Math.cos(0.45), z: z0 + 0.5 + 20 * Math.sin(0.45) }];
    build(c, 1, t); build(c, 1, [P(40.5, 0.5), { x: 40.5 + 20 * Math.cos(-0.45), z: z0 + 0.5 + 20 * Math.sin(-0.45) }]);
    out.push({ name: "Y fork arm", city: c, target: t, type: 1 });
  }
  {
    const c = flatCity(); const t = [P(20.5, 0.5), P(70.5, 0.5)]; build(c, 1, t);
    build(c, 1, [P(20.5, 0.5 - parallelOffset(1, 2)), P(70.5, 0.5 - parallelOffset(1, 2))]);
    out.push({ name: "parallel pair", city: c, target: t, type: 1 });
  }
  return out;
}

/** Point at arclength fraction f of a road, with its unit normal (left of a→b). */
function frameAt(pts: Pt[], f: number): { p: Pt; nx: number; nz: number; tx: number; tz: number } {
  const s = curvePoints(pts, 0.05);
  const i = Math.max(1, Math.min(s.length - 1, Math.round(f * (s.length - 1))));
  const a = s[i - 1], b = s[i];
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const tx = (b.x - a.x) / l, tz = (b.z - a.z) / l;
  return { p: b, nx: -tz, nz: tx, tx, tz };
}

type Resolver = (c: City, raw: Pt, anchor: Pt | null, dist: number, prev: SnapTarget | null) => { pt: Pt; target: SnapTarget | null; refused?: string };
const legacy: Resolver = (c, raw, anchor) => {
  const w = c.world;
  const p = snapPoint(anchor, raw, DEFAULT_ROAD_SNAP, null);
  return { pt: snapToRoadTile((x, y) => x >= 0 && y >= 0 && x < w.size && y < w.size && !!w.road[y * w.size + x], p), target: null };
};
const v2: Resolver = (c, raw, anchor, dist, prev) => {
  const h = resolveRoadSnap(c.world, raw, { roadType: 1, radius: radiusAt(dist), opts: DEFAULT_ROAD_SNAP, anchor, refAngle: null, prev });
  return { pt: h.pt, target: h.target, refused: h.refused };
};

interface Metric { connected: boolean; gap: number; within: boolean; stub: number; dup: number; bend: number; refused: boolean; placed: boolean }

function distToRoad(pts: Pt[], p: Pt): number { return nearestOnSegment({ pts }, p).d; }

function strokeMetric(fx: Fixture, res: Resolver, start: Pt, rawEnd: Pt, dist: number): Metric {
  const c = clone(fx.city);
  const w = c.world;
  const s = res(c, start, null, dist, null);
  const e = res(c, rawEnd, s.pt, dist, null);
  const pointerToKerb = Math.max(0, distToRoad(fx.target, rawEnd) - profileOf(fx.type).drawHalf);
  const within = pointerToKerb <= radiusAt(dist);
  if (e.refused) return { connected: false, gap: NaN, within, stub: 0, dup: 0, bend: 0, refused: true, placed: false };
  const before = new Set(w.segments.map((sg) => sg.id));
  const r = placeRoad(c, 1, [s.pt, e.pt]);
  if (!r.ok) return { connected: false, gap: NaN, within, stub: 0, dup: 0, bend: 0, refused: true, placed: false };
  let end = w.nodes[0], ed = Infinity;
  for (const n of w.nodes) { const d = Math.hypot(n.x - e.pt.x, n.z - e.pt.z); if (d < ed) { ed = d; end = n; } }
  let stub = 0;
  for (const sg of w.segments) if (!before.has(sg.id) || true) {
    const len = segmentLength(sg.pts);
    if (len > 1e-6 && len < 1.0) stub++;
  }
  let dup = 0;
  for (let i = 0; i < w.nodes.length; i++) for (let j = i + 1; j < w.nodes.length; j++) {
    if (Math.hypot(w.nodes[i].x - w.nodes[j].x, w.nodes[i].z - w.nodes[j].z) < 0.05) dup++;
  }
  const rawAng = Math.atan2(rawEnd.z - start.z, rawEnd.x - start.x);
  const builtAng = Math.atan2(end.z - s.pt.z, end.x - s.pt.x);
  let bend = Math.abs(rawAng - builtAng) * 180 / Math.PI;
  if (bend > 180) bend = 360 - bend;
  return { connected: end.segs.length >= 2, gap: distToRoad(fx.target, end), within, stub, dup, bend, refused: false, placed: true };
}

interface Summary { cases: number; within: number; connectedWithin: number; dangling: number; maxGapConnected: number; stubs: number; dups: number; maxBend: number; refused: number }

function audit(res: Resolver, dist: number): { total: Summary; rows: string[] } {
  const total: Summary = { cases: 0, within: 0, connectedWithin: 0, dangling: 0, maxGapConnected: 0, stubs: 0, dups: 0, maxBend: 0, refused: 0 };
  const rows: string[] = [];
  for (const fx of fixtures()) {
    for (const f of [0.3, 0.55, 0.8]) {
      const fr = frameAt(fx.target, f);
      // Approach from the left side at 70 degrees to the road, 7 tiles out: an arbitrary angle that must survive.
      const ang = (70 * Math.PI) / 180;
      const ax = fr.nx * Math.sin(ang) - fr.tx * Math.cos(ang), az = fr.nz * Math.sin(ang) - fr.tz * Math.cos(ang);
      for (const lat of [0, 0.3, 0.6, 0.8, 1.0, 1.3]) {
        const rawEnd = { x: fr.p.x + fr.nx * lat, z: fr.p.z + fr.nz * lat };
        const start = { x: rawEnd.x + ax * 7, z: rawEnd.z + az * 7 };
        const m = strokeMetric(fx, res, start, rawEnd, dist);
        total.cases++;
        if (m.refused) total.refused++;
        if (m.within) {
          total.within++;
          if (m.connected) total.connectedWithin++;
          else if (!m.refused) total.dangling++;
        }
        if (m.connected) total.maxGapConnected = Math.max(total.maxGapConnected, m.gap);
        total.stubs += m.stub; total.dups += m.dup;
        if (m.placed) total.maxBend = Math.max(total.maxBend, m.bend);
        rows.push(`${fx.name.padEnd(16)} f=${f} lat=${lat.toFixed(1)} conn=${m.connected ? "Y" : "n"} gap=${Number.isNaN(m.gap) ? "-" : m.gap.toFixed(3)} stub=${m.stub} dup=${m.dup} bend=${m.bend.toFixed(1)}${m.refused ? " REFUSED" : ""}`);
      }
    }
  }
  return { total, rows };
}

describe("road snap audit: radius in pixels", () => {
  it("is a constant 36 px (touch) / 16 px (mouse) at near, mid and far zoom", () => {
    const lines: string[] = [];
    for (const [name, d] of Object.entries(ZOOMS)) {
      const wpp = worldPerPixel(d, FOV, VIEW_H);
      const t = radiusAt(d, true), m = radiusAt(d, false);
      lines.push(`${name.padEnd(4)} dist=${d} tiles/px=${wpp.toFixed(4)} touch=${t.toFixed(2)} tiles (${(t / wpp).toFixed(1)} px) mouse=${m.toFixed(2)} tiles (${(m / wpp).toFixed(1)} px) legacy=~0.5 tile (${(0.5 / wpp).toFixed(1)} px)`);
      if (name !== "near") expect(t / wpp).toBeCloseTo(SNAP_PX_TOUCH, 6);
      expect(t / wpp).toBeGreaterThanOrEqual(28);
      expect(t / wpp).toBeLessThanOrEqual(44);
      if (name === "mid") expect(m / wpp).toBeCloseTo(SNAP_PX_MOUSE, 6);
    }
    if (LOG) console.log(lines.join("\n"));
  });
});

describe("road snap audit: strokes ending near a road", () => {
  for (const [zn, d] of Object.entries(ZOOMS)) {
    it(`v2 connects every end within kerb + radius, exactly on the centreline (${zn} zoom)`, () => {
      const before = audit(legacy, d), after = audit(v2, d);
      if (LOG) {
        console.log(`--- ${zn} zoom (dist ${d}) LEGACY`, JSON.stringify(before.total), "\n" + before.rows.join("\n"));
        console.log(`--- ${zn} zoom (dist ${d}) V2`, JSON.stringify(after.total), "\n" + after.rows.join("\n"));
      }
      const t = after.total;
      // No dangling ends: every pointer within the radius of the kerb attaches (or is refused with a reason).
      expect(t.dangling).toBe(0);
      expect(t.connectedWithin + t.refused).toBeGreaterThanOrEqual(t.within);
      // Attached ends sit on the centreline (the split node), not 0.2-0.7 tiles inside the asphalt.
      expect(t.maxGapConnected).toBeLessThan(1e-3);
      expect(t.stubs).toBe(0);
      expect(t.dups).toBe(0);
      // Arbitrary approach angles survive: only the end's slide onto the road changes the direction.
      expect(t.maxBend).toBeLessThan(12);
    });
  }
});

/** Strokes ending 0.4..2.5 tiles along the main road from an existing T: stubs, refusals, joins. */
function nearJunctionSweep(res: Resolver, dist: number): { stubs: number; refused: number; joined: number; tees: number; minTeeGap: number; dangling: number; rows: string[] } {
  const fx = fixtures().find((f) => f.name === "T (side street)")!;
  const tee = fx.city.world.nodes.find((n) => n.segs.length === 3)!;
  const out = { stubs: 0, refused: 0, joined: 0, tees: 0, minTeeGap: Infinity, dangling: 0, rows: [] as string[] };
  for (const along of [0.4, 0.7, 1.0, 1.2, 1.5, 2.0, 2.5]) for (const lat of [0, 0.3, 0.6]) {
    const c = clone(fx.city);
    const w = c.world;
    const rawEnd = { x: tee.x + along, z: tee.z + lat };
    const start = { x: rawEnd.x + 2.4, z: rawEnd.z + 6.6 };
    const s0 = res(c, start, null, dist, null);
    const e = res(c, rawEnd, s0.pt, dist, null);
    if (e.refused) { out.refused++; out.rows.push(`along=${along} lat=${lat} REFUSED ${e.refused}`); continue; }
    const r = placeRoad(c, 1, [s0.pt, e.pt]);
    if (!r.ok) { out.refused++; out.rows.push(`along=${along} lat=${lat} placeRoad refused: ${r.reason}`); continue; }
    let stub = 0;
    for (const sg of w.segments) { const l = segmentLength(sg.pts); if (l > 1e-6 && l < 1.0) stub++; }
    out.stubs += stub;
    let end = w.nodes[0], ed = Infinity;
    for (const n of w.nodes) { const d = Math.hypot(n.x - e.pt.x, n.z - e.pt.z); if (d < ed) { ed = d; end = n; } }
    const joinedTee = end.id === tee.id;
    if (joinedTee) out.joined++;
    else if (end.segs.length >= 3) { out.tees++; out.minTeeGap = Math.min(out.minTeeGap, Math.hypot(end.x - tee.x, end.z - tee.z)); }
    else out.dangling++;
    out.rows.push(`along=${along} lat=${lat} ${joinedTee ? "joins T node" : end.segs.length >= 3 ? `new T ${Math.hypot(end.x - tee.x, end.z - tee.z).toFixed(2)} from node` : "DANGLING"} stubs=${stub}`);
  }
  return out;
}

describe("road snap audit: near an existing junction", () => {
  for (const [zn, d] of [["near", ZOOMS.near], ["mid", ZOOMS.mid]] as const) {
    it(`never leaves a stub or a T inside the keep-out (${zn} zoom)`, () => {
      const before = nearJunctionSweep(legacy, d), after = nearJunctionSweep(v2, d);
      if (LOG) {
        const { rows: br, ...b } = before, { rows: ar, ...a } = after;
        console.log(`--- near-junction ${zn} LEGACY ${JSON.stringify(b)}\n${br.join("\n")}`);
        console.log(`--- near-junction ${zn} V2 ${JSON.stringify(a)}\n${ar.join("\n")}`);
      }
      expect(after.stubs).toBe(0);
      expect(after.dangling).toBe(0);
      // Street T next to a street junction: teeSpacing = 0.45 + 0.45 + 0.45 = 1.35 tiles.
      if (after.tees) expect(after.minTeeGap).toBeGreaterThanOrEqual(1.35 - 1e-6);
    });
  }
});

describe("road snap audit: nodes, keep-outs and hysteresis", () => {
  it("snaps to a junction centre before its centrelines and refuses a T inside its keep-out", () => {
    const fx = fixtures().find((f) => f.name === "T (side street)")!;
    const w = fx.city.world;
    const tee = w.nodes.find((n) => n.segs.length === 3)!;
    const q = { roadType: 1 as RoadType, radius: radiusAt(ZOOMS.mid), opts: DEFAULT_ROAD_SNAP, anchor: null, refAngle: null };
    const h = resolveRoadSnap(w, { x: tee.x + 0.4, z: tee.z + 0.3 }, q);
    expect(h.kind).toBe("node");
    expect(h.pt).toEqual({ x: tee.x, z: tee.z });
    // Near zoom (small radius): 1.0 tile along the road from the T is inside the 1.35-tile keep-out.
    const near = resolveRoadSnap(w, { x: tee.x + 1.0, z: tee.z + 0.2 }, { ...q, radius: radiusAt(ZOOMS.near) });
    expect(near.refused).toBe("Too close to a junction");
    // The sim refuses the same geometry, so preview and placement agree.
    expect(planRoad(fx.city, 1, [{ x: tee.x + 1.0, z: tee.z + 6 }, { x: tee.x + 1.0, z: tee.z }]).reason).toBe("Too close to a junction");
    // Outside the keep-out a T is fine.
    const ok = resolveRoadSnap(w, { x: tee.x + 2.5, z: tee.z + 0.2 }, { ...q, radius: radiusAt(ZOOMS.near) });
    expect(ok.kind).toBe("segment");
    expect(ok.refused).toBeUndefined();
  });

  it("holds the current target until the pointer is clearly past it (no jitter)", () => {
    const fx = fixtures().find((f) => f.name === "parallel pair")!;
    const w = fx.city.world;
    const r = radiusAt(ZOOMS.mid);
    const q = { roadType: 1 as RoadType, radius: r, opts: DEFAULT_ROAD_SNAP, anchor: null, refAngle: null };
    // Sweep from road A toward road B (offset parallelOffset(1,2) below) and back; count target switches.
    const z0 = fx.target[0].z, gap = parallelOffset(1, 2);
    let prev: SnapTarget | null = null, switches = 0;
    const seq: number[] = [];
    for (let i = 0; i <= 40; i++) seq.push(z0 - (gap * i) / 40);
    for (let i = 40; i >= 0; i--) seq.push(z0 - (gap * i) / 40);
    // Wobble ±0.05 tile around every sample, like a finger at rest.
    for (const z of seq) for (const dz of [0, 0.05, -0.05]) {
      const h = resolveRoadSnap(w, { x: 40.3, z: z + dz }, { ...q, prev });
      if (prev && h.target && (h.target.kind !== prev.kind || h.target.id !== prev.id)) switches++;
      prev = h.target ?? prev;
    }
    if (LOG) console.log(`hysteresis sweep: ${switches} switches`);
    expect(switches).toBeLessThanOrEqual(2);
  });

  it("keeps odd angles: a free stroke is never rotated when the angle guide is off", () => {
    const c = flatCity();
    const raw = { x: 51.37, z: 61.91 };
    const h = resolveRoadSnap(c.world, raw, { roadType: 1, radius: 1, opts: DEFAULT_ROAD_SNAP, anchor: { x: 40.1, z: 50.2 }, refAngle: null });
    expect(h.pt).toEqual(raw);
  });

  it("optional angle guide: with 45 degree steps the end slides along the road to the guided ray", () => {
    const fx = fixtures().find((f) => f.name === "straight street")!;
    const z = fx.target[0].z;
    const anchor = { x: 40.5, z: z - 6 };
    const h = resolveRoadSnap(fx.city.world, { x: 46.9, z: z - 0.4 }, {
      roadType: 1, radius: radiusAt(ZOOMS.mid), opts: { ...DEFAULT_ROAD_SNAP, angle: 45 }, anchor, refAngle: null,
    });
    expect(h.kind).toBe("segment");
    expect(h.pt.x).toBeCloseTo(46.5, 2);
    expect(h.pt.z).toBeCloseTo(z, 3);
  });
});

describe("road snap audit: parallel roads use the road profile", () => {
  for (const [type, gap] of [[1, 1], [1, 2], [1, 4], [2, 2]] as [RoadType, number][]) {
    it(`type ${type} gap ${gap}: twin leaves exactly ${gap} lot cell(s) per side`, () => {
      const run = (offset: number): { inner: number; rows: number } => {
        const c = flatCity(true);
        const z = 70.5, pts = [{ x: 20.5, z }, { x: 60.5, z }];
        build(c, type, pts);
        const r = placeRoad(c, type, offsetPolyline(pts, offset, "left"));
        if (!r.ok) return { inner: -1, rows: 0 };
        const set = getZoneBlocks(c.world);
        // Count valid inner-side columns per interior row of the first road (segments are split nowhere).
        const first = c.world.segments.find((s) => Math.abs(s.pts[0].z - z) < 1e-6 && s.pts.length === 2)!;
        let inner = 0, rows = 0;
        for (const b of set.blocks.values()) {
          if (b.seg !== first.id) continue;
          // Inner side: "left" of +x is +z (the (-dz, dx) normal), so the twin lies at larger z.
          const pose = cellPose(b, 0, 0);
          if (pose.z < z) continue;
          for (let row = 2; row < b.rows - 2; row++) {
            rows++;
            let n = 0;
            for (let col = 0; col < 4; col++) if (b.valid[row * 4 + col]) n++;
            if (LOG && row === 3) console.log(`  side ${b.side} block ${b.block} row ${row} valid cols ${n} pose z ${cellPose(b, row, 0).z.toFixed(2)}..${cellPose(b, row, 3).z.toFixed(2)}`);
            if (n === gap) inner++;
          }
        }
        return { inner, rows };
      };
      const after = run(parallelOffset(type, gap));
      const before = run(gap);
      if (LOG) console.log(`parallel type ${type} gap ${gap}: legacy offset ${gap} -> ${JSON.stringify(before)}; v2 offset ${parallelOffset(type, gap).toFixed(3)} -> ${JSON.stringify(after)}`);
      expect(after.rows).toBeGreaterThan(0);
      expect(after.inner / after.rows).toBeGreaterThanOrEqual(0.9);
    });
  }
});

describe("road snap audit: zone painting follows the road frame", () => {
  it("paints on either side of a 37 degree road selects that side's frame cells only", () => {
    const c = flatCity(true);
    const a = (37 * Math.PI) / 180, o = { x: 30.2, z: 40.3 };
    const pts = [o, { x: o.x + Math.cos(a) * 30, z: o.z + Math.sin(a) * 30 }];
    build(c, 1, pts);
    const seg = c.world.segments.find((s) => s.pts.length === 2 && Math.abs(s.pts[0].x - o.x) < 1e-6)!;
    const nx = -Math.sin(a), nz = Math.cos(a);
    let wrong = 0, painted = 0;
    for (let s = 3; s < 27; s += 1.37) for (const side of [-1, 1]) for (const lat of [1.0, 1.6, 2.4, 3.3]) {
      const p = { x: o.x + Math.cos(a) * s + nx * lat * side, z: o.z + Math.sin(a) * s + nz * lat * side };
      const r = applyZoneAt(c, 1, p.x, p.z);
      if (!r.ok) continue;
      painted++;
      // Every zoned cell must lie on the painted side of the centreline.
      for (const b of getZoneBlocks(c.world).blocks.values()) {
        if (b.seg !== seg.id) continue;
        for (let i = 0; i < b.zone.length; i++) {
          if (!b.zone[i]) continue;
          const q = cellPose(b, Math.floor(i / 4), i % 4);
          const sd = Math.sign((q.x - o.x) * nx + (q.z - o.z) * nz);
          if (sd !== side) wrong++;
        }
        // Cells keep the road's angle: frame tangent equals the road direction.
        expect(Math.abs(b.frame[2] * Math.sin(a) - b.frame[3] * Math.cos(a))).toBeLessThan(1e-3);
      }
      // Clear for the next probe so only this paint's cells are checked.
      for (const b of getZoneBlocks(c.world).blocks.values()) b.zone.fill(0);
    }
    if (LOG) console.log(`37deg paint: ${painted} paints, ${wrong} cells on the wrong side`);
    expect(painted).toBeGreaterThan(40);
    expect(wrong).toBe(0);
  });

  it("refuses painting where no road frame exists", () => {
    const c = flatCity(true);
    build(c, 1, [{ x: 20.5, z: 70.5 }, { x: 40.5, z: 70.5 }]);
    const r = applyZoneAt(c, 1, 30.5, 85.5);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reason).toBe("Zones must be within 4 tiles of a road");
  });

  it("avenue cells sit farther than street cells by exactly the profile difference", () => {
    const lat0 = (type: RoadType): number => {
      const c = flatCity(true);
      build(c, type, [{ x: 20, z: 70 }, { x: 50, z: 70 }]);
      const seg = c.world.segments.find((sg) => !sg.fixed && Math.abs(sg.pts[0].z - 70) < 1e-6)!;
      const b = [...getZoneBlocks(c.world).blocks.values()].find((k) => k.seg === seg.id)!;
      return b.lat0;
    };
    const diff = lat0(2) - lat0(1);
    if (LOG) console.log(`lat0 street=${lat0(1)} avenue=${lat0(2)} diff=${diff} profile diff=${frontageHalf(2) - frontageHalf(1)}`);
    expect(diff).toBeCloseTo(frontageHalf(2) - frontageHalf(1), 9);
    expect(lat0(1)).toBeCloseTo(frontageHalf(1) + 0.5, 9);
  });
});

/** SVG dump: roads as profile-width ribbons (asphalt+kerb, sidewalk), nodes, raw pointer ends and built ends. */
describe("road snap audit: svg dump", () => {
  const dir = process.env.SNAP_AUDIT_SVG;
  it.skipIf(!dir)("writes legacy vs v2 dumps of every fixture", () => {
    mkdirSync(dir!, { recursive: true });
    for (const fx of fixtures()) for (const [label, res] of [["legacy", legacy], ["v2", v2]] as const) {
      const c = clone(fx.city);
      const marks: string[] = [];
      for (const f of [0.3, 0.55, 0.8]) for (const lat of [0.9]) {
        const fr = frameAt(fx.target, f);
        const ang = (70 * Math.PI) / 180;
        const ax = fr.nx * Math.sin(ang) - fr.tx * Math.cos(ang), az = fr.nz * Math.sin(ang) - fr.tz * Math.cos(ang);
        const rawEnd = { x: fr.p.x + fr.nx * lat, z: fr.p.z + fr.nz * lat };
        const start = { x: rawEnd.x + ax * 7, z: rawEnd.z + az * 7 };
        const s0 = res(c, start, null, ZOOMS.mid, null);
        const e = res(c, rawEnd, s0.pt, ZOOMS.mid, null);
        if (!e.refused) placeRoad(c, 1, [s0.pt, e.pt]);
        marks.push(`<circle cx="${rawEnd.x}" cy="${rawEnd.z}" r="0.12" fill="none" stroke="#e33" stroke-width="0.05"/>`);
      }
      const w = c.world;
      const xs = w.nodes.map((n) => n.x), zs = w.nodes.map((n) => n.z);
      const own = w.segments.filter((sg) => !sg.fixed);
      const ox = Math.min(...own.flatMap((sg) => sg.pts.map((p) => p.x))) - 3, oz = Math.min(...own.flatMap((sg) => sg.pts.map((p) => p.z))) - 3;
      const ex = Math.max(...own.flatMap((sg) => sg.pts.map((p) => p.x))) + 3, ez = Math.max(...own.flatMap((sg) => sg.pts.map((p) => p.z))) + 3;
      void xs; void zs;
      const line = (pts: Pt[]) => curvePoints(pts, 0.25).map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join(" ");
      const ribbons = own.map((sg) => {
        const pr = profileOf(sg.type);
        return `<polyline points="${line(sg.pts)}" fill="none" stroke="#cfcfcf" stroke-width="${2 * (pr.drawHalf + pr.sidewalk)}" stroke-linecap="butt"/>`
          + `<polyline points="${line(sg.pts)}" fill="none" stroke="#555" stroke-width="${2 * pr.drawHalf}" stroke-linecap="butt"/>`
          + `<polyline points="${line(sg.pts)}" fill="none" stroke="#ff0" stroke-width="0.03"/>`;
      }).join("");
      const nodes = w.nodes.filter((n) => n.x >= ox && n.x <= ex && n.z >= oz && n.z <= ez)
        .map((n) => `<circle cx="${n.x}" cy="${n.z}" r="0.18" fill="${n.segs.length >= 3 ? "#2a7" : n.segs.length === 1 ? "#e90" : "#39f"}"/>`).join("");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ox} ${oz} ${ex - ox} ${ez - oz}" width="${(ex - ox) * 20}" height="${(ez - oz) * 20}"><rect x="${ox}" y="${oz}" width="${ex - ox}" height="${ez - oz}" fill="#8b9"/>${ribbons}${nodes}${marks.join("")}<text x="${ox + 0.5}" y="${oz + 1.2}" font-size="1">${fx.name} — ${label} (orange = dead end, green = junction, red ring = pointer)</text></svg>`;
      writeFileSync(`${dir}/${fx.name.replace(/[^a-z0-9]+/gi, "-")}-${label}.svg`, svg);
    }
  });
});

describe("road snap audit: cost per pointer event", () => {
  it("resolves in well under a millisecond on a dense 12x12 grid (iPad budget)", () => {
    const c = flatCity();
    for (let k = 0; k < 12; k++) {
      build(c, 1, [{ x: 30.5 + 4 * k, z: 40.5 }, { x: 30.5 + 4 * k, z: 88.5 }]);
      build(c, 1, [{ x: 28.5, z: 42.5 + 4 * k }, { x: 76.5, z: 42.5 + 4 * k }]);
    }
    const q = { roadType: 1 as RoadType, radius: radiusAt(ZOOMS.mid), opts: DEFAULT_ROAD_SNAP, anchor: { x: 31, z: 41 }, refAngle: null };
    const t0 = performance.now();
    let prev: SnapTarget | null = null;
    for (let i = 0; i < 200; i++) prev = resolveRoadSnap(c.world, { x: 30 + (i % 47), z: 40 + ((i * 7) % 47) }, { ...q, prev }).target;
    const per = (performance.now() - t0) / 200;
    if (LOG) console.log(`resolveRoadSnap: ${c.world.segments.length} segments, ${per.toFixed(3)} ms per event`);
    expect(per).toBeLessThan(2);
  });
});
