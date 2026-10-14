import { describe, expect, it } from "vitest";
import { EventBus } from "./events";
import { ONBOARDING_STEPS, OnboardingModel, OnboardingSnapshot, memoryDismissal } from "./onboarding";

const snap = (over: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot => ({
  roads: 1, zoned: 0, speed: 1, tool: "road", buildings: 0, ...over,
});

describe("OnboardingModel", () => {
  it("completes steps on check (wired to events), never on its own", () => {
    const m = new OnboardingModel(memoryDismissal());
    expect(m.start(snap())).toBe(true);
    expect(m.step).toBe("road");
    // no timer inside: the step sits until check() runs with a satisfied world
    expect(m.check(snap())).toBe(false);
    expect(m.step).toBe("road");
    expect(m.check(snap({ roads: 2 }))).toBe(true);
    expect(m.step).toBe("zone");
  });

  it("advances through events to the closing card", () => {
    const bus = new EventBus();
    const m = new OnboardingModel(memoryDismissal());
    m.start(snap());
    let now = snap();
    for (const s of ONBOARDING_STEPS) bus.on(s.event, () => { m.check(now); });
    now = snap({ roads: 3 });
    bus.emit("roads:changed");
    expect(m.step).toBe("zone");
    now = snap({ roads: 3, zoned: 4 });
    bus.emit("zones:changed");
    expect(m.step).toBe("speed");
    now = snap({ roads: 3, zoned: 4, speed: 2 });
    bus.emit("time:speed");
    expect(m.step).toBe("grow");
    now = snap({ roads: 3, zoned: 4, speed: 2, buildings: 5 });
    bus.emit("building:added");
    expect(m.step).toBe("done");
    expect(m.finished).toBe(true);
  });

  it("skips already-satisfied steps at start", () => {
    const m = new OnboardingModel(memoryDismissal());
    expect(m.start(snap({ speed: 4 }))).toBe(true);
    // road/zone still pending; speed will be skipped when reached, not sat on
    expect(m.step).toBe("road");
    expect(m.check(snap({ roads: 2, zoned: 1, speed: 4 }))).toBe(true);
    expect(m.step).toBe("grow");
  });

  it("never starts over an existing city or after dismissal", () => {
    const store = memoryDismissal();
    expect(new OnboardingModel(store).start(snap({ buildings: 3 }))).toBe(false);
    expect(new OnboardingModel(store).start(snap({ roads: 9 }))).toBe(false);
    const m = new OnboardingModel(store);
    expect(m.start(snap())).toBe(true);
    m.dismiss();
    expect(new OnboardingModel(store).start(snap())).toBe(false);
  });
});
