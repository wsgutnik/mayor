import { describe, expect, it } from "vitest";
import { newCity, placeRoad } from "./sim";
import { cidx, ROAD_DRAW_WIDTH, ROAD_TILE_WIDTH, type Pt, type RoadType } from "./world";
import { halfAsphalt, kerbWidth } from "./roads";
import { corridorsOf, profileOf, profileOffset, type CorridorOffsetName } from "./corridor";
import { planProps } from "./props";

const TYPES: RoadType[] = [1, 2, 3, 4, 5];

function flat(s: ReturnType<typeof newCity>): void {
  for (let y = 0; y <= s.world.size; y++) {
    for (let x = 0; x <= s.world.size; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
  }
}

function road(s: ReturnType<typeof newCity>, type: RoadType, pts: [number, number][]): void {
  const r = placeRoad(s, type, pts.map(([x, z]) => ({ x, z })));
  expect(r.ok).toBe(true);
}

function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

function distToPolyline(p: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distPointToSegment(p, line[i - 1], line[i]));
  return best;
}

describe("road corridor profiles", () => {
  it("matches the existing road constants exactly", () => {
    for (const type of TYPES) {
      const p = profileOf(type);
      const sidewalkEdge = p.drawHalf + p.sidewalk;
      expect(p.drawHalf).toBe(ROAD_DRAW_WIDTH[type] / 2);
      expect(p.asphaltHalf).toBe(halfAsphalt(type));
      expect(p.kerb).toBe(kerbWidth(type));
      // P0: sidewalk lives outside drawHalf; setback floors at 0 and the
      // setback line overflows the tile for street (0.57) and avenue (1.06).
      expect(p.setback).toBe(Math.max(0, ROAD_TILE_WIDTH[type] / 2 - sidewalkEdge));
      expect(p.drawHalf + p.sidewalk + p.setback).toBe(Math.max(ROAD_TILE_WIDTH[type] / 2, sidewalkEdge));
      expect(p.propOffsets.hydrant).toBe(sidewalkEdge + 0.14);
      expect(p.propOffsets.bench).toBe(sidewalkEdge + 0.2);
      expect(p.propOffsets.planter).toBe(sidewalkEdge + 0.2);
      expect(p.propOffsets.streetlight).toBe(sidewalkEdge + 0.2);
      expect(p.propOffsets.signal).toBe(sidewalkEdge + 0.08);
    }
  });

  it("carries the P0 sidewalk widths per class", () => {
    expect(profileOf(1).sidewalk).toBe(0.12);
    expect(profileOf(4).sidewalk).toBe(0.12);
    expect(profileOf(2).sidewalk).toBe(0.16);
    expect(profileOf(5).sidewalk).toBe(0.16);
    expect(profileOf(3).sidewalk).toBe(0);
    expect(profileOf(1).setback).toBe(0);
    expect(profileOf(2).setback).toBe(0);
    expect(profileOf(3).setback).toBeCloseTo(0.1, 9);
  });

  it("places lane centres symmetrically inside the asphalt, clear of the median", () => {
    for (const type of TYPES) {
      const p = profileOf(type);
      expect(p.laneCentres).toHaveLength(p.lanes);
      expect(p.laneWidth).toBeCloseTo((2 * (p.asphaltHalf - p.medianHalf)) / p.lanes, 9);
      for (let i = 0; i < p.laneCentres.length; i++) {
        expect(p.laneCentres[i]).toBeCloseTo(-p.laneCentres[p.laneCentres.length - 1 - i], 9);
        expect(Math.abs(p.laneCentres[i]) + p.laneWidth / 2).toBeLessThanOrEqual(p.asphaltHalf + 1e-9);
        expect(Math.abs(p.laneCentres[i]) - p.laneWidth / 2).toBeGreaterThanOrEqual(p.medianHalf - 1e-9);
      }
    }
    for (const [type, want] of [[1, [-0.19, 0.19]], [2, [-0.6475, -0.3225, 0.3225, 0.6475]], [3, [-1.05, -0.35, 0.35, 1.05]]] as const) {
      const got = profileOf(type).laneCentres;
      expect(got).toHaveLength(want.length);
      for (let i = 0; i < want.length; i++) expect(got[i]).toBeCloseTo(want[i], 9);
    }
    expect(profileOf(2).medianHalf).toBe(0.16);
  });
});

describe("segment corridors", () => {
  it("builds deterministic offset lines at declared distances", () => {
    const s = newCity(7, 48);
    flat(s);
    road(s, 1, [[8.5, 20.5], [24.5, 20.5]]);
    road(s, 2, [[24.5, 20.5], [32.5, 24.5], [38.5, 36.5]]);
    const a = corridorsOf(s.world);
    const b = corridorsOf(s.world);
    expect(JSON.stringify([...a.bySeg])).toEqual(JSON.stringify([...b.bySeg]));
    for (const c of a.bySeg.values()) {
      for (const name of ["asphaltEdge", "kerbEdge", "sidewalkEdge", "setbackLine"] as CorridorOffsetName[]) {
        const want = profileOffset(c.type, name);
        for (const side of ["left", "right"] as const) {
          const line = c.offsets[name][side];
          for (let i = 0; i < line.length; i++) {
            const d = Math.hypot(line[i].x - c.centre[i].x, line[i].z - c.centre[i].z);
            expect(Math.abs(d - want), `${c.segId} ${name} ${side} sample ${i}`).toBeLessThanOrEqual(1e-3);
          }
        }
      }
    }
  });

  it("keeps tight curves finite", () => {
    const s = newCity(9, 48);
    flat(s);
    road(s, 1, [[18.5, 18.5], [26.5, 8.5], [19.0, 18.7]]);
    const c = [...corridorsOf(s.world).bySeg.values()].at(-1)!;
    for (const sample of c.centre) {
      expect(Number.isFinite(sample.x)).toBe(true);
      expect(Number.isFinite(sample.z)).toBe(true);
    }
    for (const lines of Object.values(c.offsets)) {
      for (const line of [lines.left, lines.right]) {
        for (const p of line) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.z)).toBe(true);
        }
      }
    }
  });

  it("places street-side props on their declared offset lines", () => {
    const s = newCity(13, 64);
    flat(s);
    road(s, 2, [[6.5, 30.5], [50.5, 30.5]]);
    road(s, 1, [[20.5, 10.5], [20.5, 52.5]]);
    const corridors = [...corridorsOf(s.world).bySeg.values()];
    const props = planProps(s.world, 1).filter((p) =>
      p.kind === "hydrant" || p.kind === "streetlight_b" || p.kind === "planter_street");
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) {
      const want = p.kind === "hydrant" ? "hydrant" : p.kind === "streetlight_b" ? "streetlight" : p.kind === "bench_road" ? "bench" : "planter";
      let best = Infinity;
      for (const c of corridors) {
        const off = profileOf(c.type).propOffsets[want];
        const edge = profileOffset(c.type, "kerbEdge");
        for (const side of ["left", "right"] as const) {
          const shifted = c.offsets.kerbEdge[side].map((q, i) => {
            const centre = c.centre[i];
            const dx = q.x - centre.x, dz = q.z - centre.z;
            const len = Math.hypot(dx, dz) || 1;
            return { x: q.x + (dx / len) * (off - edge), z: q.z + (dz / len) * (off - edge) };
          });
          best = Math.min(best, distToPolyline(p, shifted));
        }
      }
      expect(best, `${p.kind} at ${p.x},${p.z}`).toBeLessThanOrEqual(1e-3);
    }
  });
});
