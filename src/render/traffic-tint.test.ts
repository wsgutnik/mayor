import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TrafficTint } from "./traffic-tint";
import { ROAD_CAPACITY } from "../sim/traffic";
import { ROAD } from "../sim/world";

describe("TrafficTint", () => {
  it("writes clamp(load/capacity) on road tiles, 0 elsewhere", () => {
    const tint = new TrafficTint(4);
    const road = new Uint8Array(16);
    const load = new Uint16Array(16);
    road[0] = ROAD.STREET; load[0] = 2; // half of 4
    road[1] = ROAD.AVENUE; load[1] = 40; // jammed
    load[2] = 9; // no road: stays 0
    tint.update({ size: 4, road, load });
    const data = tint.texture.image.data as Uint8Array;
    expect(data[0]).toBe(Math.round((2 / ROAD_CAPACITY[ROAD.STREET]) * 255));
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(0);
    expect(tint.texture.version).toBeGreaterThan(0);
  });

  it("recreates the texture when the map size changes", () => {
    const tint = new TrafficTint(4);
    const before = tint.texture;
    tint.update({ size: 8, road: new Uint8Array(64), load: new Uint16Array(64) });
    expect(tint.texture).not.toBe(before);
    expect((tint.texture.image.data as Uint8Array).length).toBe(64);
  });

  it("uses a nearest-filtered red channel (no GL context needed)", () => {
    const tint = new TrafficTint(4);
    expect(tint.texture.format).toBe(THREE.RedFormat);
    expect(tint.texture.minFilter).toBe(THREE.NearestFilter);
  });
});
