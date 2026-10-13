/**
 * Snapshot-based undo/redo for player actions. Pure module: snapshots are the
 * opaque strings produced by `serialize` in save.ts, restored with `deserialize`.
 * The simulation itself stays deterministic and untouched.
 *
 * Protocol (see main.ts): push the pre-action snapshot immediately BEFORE a
 * player mutation; if the action reports failure, pop it back off. A whole
 * paint/drag stroke is ONE entry (push on stroke start). Only player actions
 * touch this — never the frame loop, so there is no per-frame allocation.
 */
export class History {
  /** Maximum undo depth; older entries drop off the bottom. */
  static readonly CAP = 30;

  /** Pre-action snapshots, oldest first. */
  private past: string[] = [];
  /** Post-undo snapshots available to redo, oldest first. */
  private future: string[] = [];

  /** Record a pre-action snapshot; clears the redo stack. */
  push(snapshot: string): void {
    this.past.push(snapshot);
    if (this.past.length > History.CAP) this.past.shift();
    this.future.length = 0;
  }

  /**
   * Discard the most recent undo entry: the speculative push whose action
   * failed (ok:false), so failed actions leave no trace. No-op when empty.
   */
  pop(): void {
    this.past.pop();
  }

  /**
   * Undo: stash `current` for redo and return the snapshot to restore,
   * or null when there is nothing to undo (stacks untouched).
   */
  undo(current: string): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  /**
   * Redo: stash `current` for undo and return the snapshot to restore,
   * or null when there is nothing to redo (stacks untouched).
   */
  redo(current: string): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    if (this.past.length > History.CAP) this.past.shift();
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Forget everything (new city / load). */
  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}
