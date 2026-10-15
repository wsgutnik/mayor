import { describe, expect, it } from "vitest";
import { applyTool, bulldozeAt, newCity, placeRoad } from "./sim";
import { deserialize, serialize } from "./save";
import { FAC, FACILITY_INFO, cidx, facilityAnchorAt, type FacilityKind } from "./world";
import { planFacilityPlacement } from "./facilityplace";
import { rectOnRoad, roadSurface, setbackGap } from "./roadsurface";

function city() {
  const s = newCity(41, 48); s.money = 1e9;
  for (let z = 0; z <= 48; z++) for (let x = 0; x <= 48; x++) s.world.heights[cidx(s.world, x, z)] = .35;
  return s;
}

function straight(angle: number) {
  const s = city(), dx = Math.sin(angle), dz = Math.cos(angle);
  expect(placeRoad(s, 1, [{ x: 24 - dx * 15, z: 24 - dz * 15 }, { x: 24 + dx * 15, z: 24 + dz * 15 }]).ok).toBe(true);
  // Linking is exercised separately; this isolated geometry fixture has no
  // highway connection, so make its painted street available to the service net.
  for (let i = 0; i < s.world.roadSurface.length; i++) if (s.world.roadSurface[i]) s.world.connected[i] = 1;
  return { s, dx, dz };
}

describe("facility street-frame planner", () => {
  it.each([0, 15, 30, 45, 60, 90, 135])("clears the complete physical street at %i°", (deg) => {
    const a = deg * Math.PI / 180, { s, dx, dz } = straight(a);
    const nx = -dz, nz = dx;
    const p = planFacilityPlacement(s.world, FAC.PARK, 24 + nx * 2, 24 + nz * 2);
    expect(p.ok, p.reason).toBe(true);
    expect(rectOnRoad(roadSurface(s.world), p.cx, p.cz, 1, 1, p.yaw)).toBe(false);
    if (deg !== 0 && deg !== 90) expect(setbackGap(roadSurface(s.world), p.cx + Math.sin(p.yaw) * .5, p.cz + Math.cos(p.yaw) * .5)).toBeLessThanOrEqual(.051);
    // Local +z faces the road. Its street direction is therefore perpendicular
    // to the segment; both parallel/anti-parallel frames are equivalent.
    const frame = p.yaw + Math.PI / 2;
    expect(Math.abs(Math.sin(2 * (frame - a)))).toBeLessThan(1e-6);
    expect(p.tiles.length).toBeGreaterThan(0);
    for (const tile of p.tiles) expect(facilityAnchorAt({ ...s.world, facilityAnchors: [{ x: Math.min(...p.tiles.map(i => i % s.world.size)), y: Math.min(...p.tiles.map(i => (i / s.world.size) | 0)), w: s.world.size, h: s.world.size, kind: FAC.PARK, cx: p.cx, cz: p.cz, yaw: p.yaw }] }, tile)).toBeTruthy();
  });

  it("is deterministic and plans every catalogue kind, including x2 tiers", () => {
    const { s } = straight(Math.PI / 6);
    for (const kind of Object.keys(FACILITY_INFO).map(Number) as FacilityKind[]) {
      const a = planFacilityPlacement(s.world, kind, 23, 26), b = planFacilityPlacement(s.world, kind, 23, 26);
      expect(a).toEqual(b);
      expect(a.tiles.length).toBeGreaterThan(0);
    }
  });

  it("uses the local frame on a curve and keeps clear at a square dead end", () => {
    const s = city();
    expect(placeRoad(s, 1, [{ x: 8, z: 12 }, { x: 24, z: 12 }, { x: 34, z: 28 }]).ok).toBe(true);
    const curve = planFacilityPlacement(s.world, FAC.PARK, 24, 15);
    expect(curve.ok, curve.reason).toBe(true);
    expect(rectOnRoad(roadSurface(s.world), curve.cx, curve.cz, 1, 1, curve.yaw)).toBe(false);
    const end = planFacilityPlacement(s.world, FAC.PARK, 34, 30);
    expect(end.ok, end.reason).toBe(true);
    expect(rectOnRoad(roadSurface(s.world), end.cx, end.cz, 1, 1, end.yaw)).toBe(false);
  });

  it("round-trips a posed anchor, keeps old anchors grid-aligned, and bulldozes its whole mirror", () => {
    const { s, dx, dz } = straight(Math.PI / 4), nx = -dz, nz = dx;
    const p = planFacilityPlacement(s.world, FAC.FIRE_POST, 24 + nx * 2, 24 + nz * 2);
    expect(p.ok).toBe(true);
    const tile = p.tiles[0], x = tile % s.world.size, z = (tile / s.world.size) | 0;
    expect(applyTool(s, "firepost", x, z).ok).toBe(true);
    const saved = deserialize(serialize(s));
    const a = saved.world.facilityAnchors![0];
    expect(a.cx).toBeCloseTo(p.cx); expect(a.cz).toBeCloseTo(p.cz); expect(a.yaw).toBeCloseTo(p.yaw);
    const mirror = [...saved.world.facility].filter(v => v === FAC.FIRE_POST).length;
    expect(bulldozeAt(saved, a.cx!, a.cz!).ok).toBe(true);
    expect([...saved.world.facility].filter(v => v === FAC.FIRE_POST)).toHaveLength(0);
    expect(mirror).toBeGreaterThan(0);
    const old = JSON.parse(serialize(s)); delete old.facilityAnchors[0].cx; delete old.facilityAnchors[0].cz; delete old.facilityAnchors[0].yaw;
    const legacy = deserialize(JSON.stringify(old)).world.facilityAnchors![0];
    expect(legacy.cx).toBeUndefined(); expect(legacy.yaw).toBeUndefined();
  });

  it("returns a localizable refusal when its legacy footprint is outside the map", () => {
    const s = city();
    const p = planFacilityPlacement(s.world, FAC.POWER, -1, -1);
    expect(p.ok).toBe(false); expect(p.reason).toBe("Facility footprint is outside the map");
  });
});
