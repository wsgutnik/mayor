import { describe, expect, it } from "vitest";
import { History } from "./history";
import { newCity, placeRoad } from "./sim";
import { deserialize, serialize } from "./save";
import { cidx, ROAD } from "./world";

describe("History", () => {
  it("starts empty", () => {
    const h = new History();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo("cur")).toBeNull();
    expect(h.redo("cur")).toBeNull();
  });

  it("undoes and redoes a round trip", () => {
    const h = new History();
    h.push("a");
    h.push("b");
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
    expect(h.undo("c")).toBe("b");
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(true);
    expect(h.undo("b")).toBe("a");
    expect(h.canUndo).toBe(false);
    expect(h.undo("a")).toBeNull();
    expect(h.redo("a")).toBe("b");
    expect(h.redo("b")).toBe("c");
    expect(h.canRedo).toBe(false);
    expect(h.redo("c")).toBeNull();
  });

  it("clears the redo stack on push", () => {
    const h = new History();
    h.push("a");
    h.push("b");
    expect(h.undo("c")).toBe("b");
    expect(h.canRedo).toBe(true);
    h.push("d");
    expect(h.canRedo).toBe(false);
    expect(h.redo("d")).toBeNull();
    expect(h.undo("d")).toBe("d");
    expect(h.undo("d")).toBe("a");
  });

  it("caps the undo depth at 30 entries", () => {
    const h = new History();
    expect(History.CAP).toBe(30);
    for (let i = 0; i < 35; i++) h.push(`s${i}`);
    // Only s5..s34 survive; the five oldest dropped off.
    let cur = "cur";
    for (let i = 34; i >= 5; i--) {
      expect(h.canUndo).toBe(true);
      cur = h.undo(cur)!;
      expect(cur).toBe(`s${i}`);
    }
    expect(h.canUndo).toBe(false);
    expect(h.undo(cur)).toBeNull();
  });

  it("pops a speculative push whose action failed", () => {
    const h = new History();
    h.push("a");
    h.push("b"); // action then reports ok:false
    h.pop();
    expect(h.canUndo).toBe(true);
    expect(h.undo("cur")).toBe("a");
    expect(h.canUndo).toBe(false);
    h.pop(); // no-op on an empty stack, never throws
    expect(h.canUndo).toBe(false);
  });

  it("clears both stacks", () => {
    const h = new History();
    h.push("a");
    h.undo("b");
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("keeps stacks untouched when there is nothing to undo or redo", () => {
    const h = new History();
    h.push("a");
    expect(h.redo("x")).toBeNull();
    expect(h.canUndo).toBe(true);
    expect(h.undo("x")).toBe("a");
    expect(h.undo("a")).toBeNull();
    expect(h.canRedo).toBe(true);
  });
});

describe("history restore round trip", () => {
  it("serializes, applies placeRoad, restores and matches the serialized state", () => {
    const s = newCity(7);
    const ey = s.world.entry.y;
    for (let y = ey - 4; y <= ey + 4; y++) for (let x = 0; x <= 30; x++) s.world.heights[cidx(s.world, x, y)] = 0.35;
    s.money = 1e6;

    const h = new History();
    const before = serialize(s);
    h.push(before);
    const res = placeRoad(s, ROAD.STREET, [
      { x: 3.5, z: ey + 0.5 },
      { x: 20.5, z: ey + 0.5 },
    ]);
    expect(res.ok).toBe(true);
    const after = serialize(s);
    expect(after).not.toBe(before);

    // Undo: restoring the pre-action snapshot reproduces it exactly, money included.
    const undone = h.undo(after);
    expect(undone).toBe(before);
    const restored = deserialize(undone!);
    expect(serialize(restored)).toBe(before);
    expect(restored.money).toBe((JSON.parse(before) as { money: number }).money);

    // Redo: restoring the post-action snapshot reproduces that exactly too.
    const redone = h.redo(serialize(restored));
    expect(redone).toBe(after);
    expect(serialize(deserialize(redone!))).toBe(after);
  });
});
