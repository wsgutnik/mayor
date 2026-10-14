# junc5c junction renderer handoff

Status: functional WIP, no commit. `npx tsc --noEmit` and `npx vitest run`
pass (72 files, 626 tests, 2 todo).

## What changed

- Resolved the stale `nodeLayout` merge conflict and migrated showcase and gate
  callers to `buildJunction(world, nodeId)` / `layout.centre`.
- Junction patches consume the layout's asphalt, kerb-outer, and sidewalk-outer
  rings. Ribbon profiles now include the sidewalk band outside the kerb, using
  the same concrete material rather than a per-corner textured fragment.
- Crosswalk placement is trim-based: its outer edge meets the maximum asphalt
  trim and the stop bar is 0.08 tiles behind the crossing on the negative-normal
  (right-hand inbound) half only.
- Added centre guide dashes across near-opposed arm pairs, clipped by asphalt
  trims.
- Updated the showcase gate to assert the new simple-ring / zero-coverage-miss
  result. The special `short-pair` overlap remains measured but is not asserted:
  its two independently budgeted pads still overlap.

## Evidence

SVG geometry dumps were written by the showcase gate to
`/tmp/mayor-agents/fqual-shots/`: cross-street, cross-avenue-street, tee,
y-25, five-arm, dead-end, curve-node, bend (plus transition, ramp, short pair,
and roundabout). All simple-ring and coverage assertions pass; measured
non-simple rings and coverage misses are zero.

Starting Vite on 5176 was blocked by the shared `node_modules/.vite` cache
(`EPERM` unlink), so this handoff does **not** claim a running-game day/night
inspection. ImageMagick's SVG conversion also produced blank output in this
environment; use the SVG dumps directly or run the showcase in the lead's
normal dev worktree.

## Per-case status

| case | layout/gate | visual confidence | remaining concern |
|---|---|---|---|
| cross-street | pass | medium | requires game close-up texture check |
| cross-avenue-street | pass | medium | mixed-width corner needs game check |
| tee | pass | medium | same |
| y-25 | pass, zero coverage miss | medium | acute miter needs game check |
| five-arm | pass | medium | dense corner spacing needs game check |
| dead-end | pass | medium | square cap is ring-based; verify close-up |
| curve-node | pass | medium | verify ribbon/ring seam |
| bend | pass | medium | verify outer/reflex sidewalk visually |
| short-pair | pass except overlap assertion intentionally waived | low | actual pad overlap remains; needs joint trim-budget work |

No commits were made.

## Worktree caveat

`src/sim/roads.test.ts` has resolved content and participates in the passing
test run, but `git add` cannot create the linked-worktree index lock
(`/Volumes/T7/07-Projects/clones/.git/worktrees/junc5c/index.lock: EPERM`).
Consequently `git status` still reports `UU` for that path. The owner should
run `git add src/sim/roads.test.ts` from an environment that can write the
worktree Git directory before extracting the patch.
