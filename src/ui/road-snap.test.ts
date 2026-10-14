import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROAD_SNAP,
  exitAngle,
  loadRoadSnap,
  normalizeRoadSnap,
  saveRoadSnap,
  snapPoint,
  snapToRoadTile,
  type RoadSnapOptions,
} from "./road-snap";

const prev = { x: 0, z: 0 };
const snap = (raw: { x: number; z: number }, opts: Partial<RoadSnapOptions>, ref: number | null = null) =>
  snapPoint(prev, raw, { ...DEFAULT_ROAD_SNAP, ...opts }, ref);
const dirOf = (p: { x: number; z: number }) => (Math.atan2(p.z - prev.z, p.x - prev.x) * 180) / Math.PI;
const lenOf = (p: { x: number; z: number }) => Math.hypot(p.x - prev.x, p.z - prev.z);

describe("snapPoint", () => {
  it("returns the raw point for the draft's first point (no anchor)", () => {
    const raw = { x: 3.2, z: 7.9 };
    expect(snapPoint(null, raw, { angle: 45, length: 4, roads: true, guides: true })).toBe(raw);
  });

  it("leaves the point alone when everything is off", () => {
    expect(snap({ x: 10.4, z: 3.1 }, { angle: 0, length: 0 })).toEqual({ x: 10.4, z: 3.1 });
  });

  it("snaps the angle to 45° steps from the map axes", () => {
    expect(dirOf(snap({ x: 10, z: 1 }, { angle: 45 }))).toBeCloseTo(0, 6);
    expect(dirOf(snap({ x: 10, z: 9 }, { angle: 45 }))).toBeCloseTo(45, 6);
    expect(dirOf(snap({ x: 1, z: 10 }, { angle: 45 }))).toBeCloseTo(90, 6);
    expect(dirOf(snap({ x: -9, z: 10 }, { angle: 45 }))).toBeCloseTo(135, 6);
  });

  it("snaps the angle to 15° steps", () => {
    const raw = { x: 10 * Math.cos((10 * Math.PI) / 180), z: 10 * Math.sin((10 * Math.PI) / 180) };
    expect(dirOf(snap(raw, { angle: 15 }))).toBeCloseTo(15, 6);
  });

  it("measures the angle from the previous segment when continuing a road", () => {
    // Raw point at 60° from the anchor.
    const raw = { x: 10 * Math.cos(Math.PI / 3), z: 10 * Math.sin(Math.PI / 3) };
    // From the map axes it snaps to the 45° diagonal...
    expect(dirOf(snap(raw, { angle: 45 }, null))).toBeCloseTo(45, 6);
    // ...but continuing a 30° road it snaps to that road's 75° line.
    expect(dirOf(snap(raw, { angle: 45 }, Math.PI / 6))).toBeCloseTo(75, 6);
  });

  it("snaps the length to whole steps, keeping the direction", () => {
    expect(snap({ x: 10.6, z: 0 }, { length: 1 })).toEqual({ x: 11, z: 0 });
    expect(snap({ x: 10.6, z: 0 }, { length: 2 })).toEqual({ x: 10, z: 0 });
    expect(snap({ x: 10.6, z: 0 }, { length: 4 })).toEqual({ x: 12, z: 0 });
    const p = snap({ x: 7, z: 7 }, { length: 2 });
    expect(lenOf(p)).toBeCloseTo(10, 6);
    expect(dirOf(p)).toBeCloseTo(45, 6);
  });

  it("combines angle and length snapping", () => {
    const p = snap({ x: 10.6, z: 1 }, { angle: 45, length: 2 });
    expect(p.x).toBeCloseTo(10, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it("collapses onto the anchor when the raw point is on it", () => {
    expect(snap({ x: 0, z: 0 }, { angle: 45, length: 4 })).toEqual({ x: 0, z: 0 });
  });
});

describe("exitAngle", () => {
  it("reads the exit direction of lines and curves", () => {
    expect(exitAngle([{ x: 0, z: 0 }, { x: 5, z: 0 }])).toBeCloseTo(0, 9);
    expect(exitAngle([{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }])).toBeCloseTo(Math.PI / 2, 9);
  });

  it("is null for degenerate drafts", () => {
    expect(exitAngle([{ x: 1, z: 1 }])).toBeNull();
    expect(exitAngle([{ x: 1, z: 1 }, { x: 1, z: 1 }])).toBeNull();
  });
});

describe("snapToRoadTile", () => {
  const isRoad = (x: number, y: number) => x === 4 && y === 7;
  it("moves onto the centre of a road tile", () => {
    expect(snapToRoadTile(isRoad, { x: 4.1, z: 7.8 })).toEqual({ x: 4.5, z: 7.5 });
  });

  it("leaves free ground alone", () => {
    const p = { x: 2.3, z: 3.7 };
    expect(snapToRoadTile(isRoad, p)).toBe(p);
  });
});

describe("snap options", () => {
  it("defaults to road snap only, like before UI-2", () => {
    expect(DEFAULT_ROAD_SNAP).toEqual({ angle: 0, length: 0, roads: true, guides: true });
  });

  it("repairs stored garbage field by field", () => {
    expect(normalizeRoadSnap(null)).toEqual(DEFAULT_ROAD_SNAP);
    expect(normalizeRoadSnap("45")).toEqual(DEFAULT_ROAD_SNAP);
    expect(normalizeRoadSnap({ angle: 30, length: 2, roads: "yes" })).toEqual({ angle: 0, length: 2, roads: true, guides: true });
    expect(normalizeRoadSnap({ angle: 15, length: 4, roads: false, guides: false })).toEqual({ angle: 15, length: 4, roads: false, guides: false });
  });

  it("round-trips through storage and survives blocked storage", () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
    expect(loadRoadSnap()).toEqual(DEFAULT_ROAD_SNAP);
    saveRoadSnap({ angle: 45, length: 2, roads: false, guides: false });
    expect(loadRoadSnap()).toEqual({ angle: 45, length: 2, roads: false, guides: false });
    store.set("mayor:road-snap", "{oops");
    expect(loadRoadSnap()).toEqual(DEFAULT_ROAD_SNAP);
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(loadRoadSnap()).toEqual(DEFAULT_ROAD_SNAP);
    expect(() => saveRoadSnap({ angle: 45, length: 1, roads: true, guides: true })).not.toThrow();
  });
});

describe("snap radius", () => {
  it("converts a pixel radius to tiles through the camera distance and clamps it", async () => {
    const { worldPerPixel, snapRadiusTiles, SNAP_MIN_TILES, SNAP_MAX_TILES } = await import("./road-snap");
    const wpp = worldPerPixel(38, 45, 800);
    expect(wpp).toBeCloseTo((2 * Math.tan(Math.PI / 8) * 38) / 800, 12);
    expect(snapRadiusTiles(true, wpp)).toBeCloseTo(36 * wpp, 12);
    expect(snapRadiusTiles(false, wpp)).toBeCloseTo(16 * wpp, 12);
    expect(snapRadiusTiles(false, 1e-4)).toBe(SNAP_MIN_TILES);
    expect(snapRadiusTiles(true, 1)).toBe(SNAP_MAX_TILES);
  });
});
