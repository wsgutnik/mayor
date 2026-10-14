import { describe, expect, it } from "vitest";
import { MAX_VISIBLE_TOASTS, TOAST_LIFE, TOAST_LOG_MAX, ToastQueue } from "./toasts";

describe("ToastQueue", () => {
  it("resolves life by tone, defaulting unknown kinds to info", () => {
    const q = new ToastQueue();
    expect(q.push({ title: "a" }).life).toBe(TOAST_LIFE.info);
    expect(q.push({ kind: "success", title: "b" }).life).toBe(TOAST_LIFE.success);
    expect(q.push({ kind: "warning", title: "c" }).life).toBe(TOAST_LIFE.warning);
    expect(q.push({ kind: "error", title: "d" }).life).toBe(TOAST_LIFE.error);
    expect(q.push({ kind: "milestone", title: "e" }).life).toBe(TOAST_LIFE.milestone);
    expect(q.push({ kind: "bogus" as never, title: "f" }).kind).toBe("info");
  });

  it("keeps at most 3 visible; overflow slides into the bell log", () => {
    const q = new ToastQueue();
    for (let i = 0; i < 5; i++) q.push({ title: `t${i}` });
    expect(q.live).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(q.live.map((t) => t.title)).toEqual(["t2", "t3", "t4"]);
    expect(q.log).toHaveLength(5);
    expect(q.unread).toBe(5);
  });

  it("caps the log at 40, newest first", () => {
    const q = new ToastQueue();
    for (let i = 0; i < 45; i++) q.push({ title: `t${i}` });
    expect(q.log).toHaveLength(TOAST_LOG_MAX);
    expect(q.log[0].title).toBe("t44");
  });

  it("clears the badge when the centre opens", () => {
    const q = new ToastQueue();
    q.push({ title: "a" });
    q.push({ title: "b" });
    let seen = { unread: -1, total: -1 };
    q.onChange((c) => { seen = c; });
    expect(seen).toEqual({ unread: 2, total: 2 });
    q.markAllRead();
    expect(q.unread).toBe(0);
    expect(q.log.every((e) => e.read)).toBe(true);
    expect(seen).toEqual({ unread: 0, total: 2 });
  });

  it("dismisses live toasts but keeps the log", () => {
    const q = new ToastQueue();
    const a = q.push({ title: "a" });
    expect(q.dismiss(a.id)).toBe(true);
    expect(q.dismiss(a.id)).toBe(false);
    expect(q.live).toHaveLength(0);
    expect(q.log).toHaveLength(1);
  });

  it("supports sticky toasts (life 0)", () => {
    const q = new ToastQueue();
    expect(q.push({ title: "s", life: 0 }).life).toBe(0);
  });
});
