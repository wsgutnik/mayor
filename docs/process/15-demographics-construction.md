# 15 — Per-building construction and demographics

## Design twice

**A: city-wide counters with a single construction timer.** This is cheap but makes every building change phase together,
cannot explain an inspected building, and makes a save/replay depend on update ordering.

**B: persisted schedules and deterministic household composition per lot.** Each lot owns a small schedule; household
figures are derived from the lot footprint, level and the city population/capacity ratio. This adds no random stream and
therefore remains stable after save/load. **Chosen.**

## Construction recipe

`construction = { state, progress, duration, upgrading? }` is optional in saves. Missing means a completed pre-feature
building. A new or upgraded lot starts at 0. Duration is `12 + 4*area + 6*level` simulation days. The display phases are
0–12% planned, 12–32% excavation, 32–78% structure, 78–100% finishing, then complete. A disconnected power/water site
or negative city balance is `paused`; progress does not move. Oriented lots mirror progress to `build`, the existing
procedural construction renderer input. The schedule is simulation-time only and hence deterministic.

## Demographic recipe

The city population remains the existing gradual occupancy model. Its deterministic split is 20% children (0–14), 65%
working age (15–64), and the remainder seniors (65+); preserving the prior 65% worker assumption deliberately keeps RCI
and income balance unchanged. Labour force is working age; filled jobs are `min(labourForce, commercial + industrial
capacity)`. Dependency ratio is `(children+seniors)/working age`. Residential lot figures proportionally allocate city
occupancy to its level/area capacity; worker education is a deterministic level-weighted split. No commuter flow is
modelled.

## Geometry and validation

Construction changes no lot footprint. Segment-frame placement remains authoritative: `nearestCell` maps painting to a
valid street-frame cell; `planOrientedLots` plus `checkLots`/SAT invariants reject overlapping lots. Existing diagonal,
curve, junction and no-overlap tests are retained. Visual inspection is a lead responsibility under AGENTS.md because no
Vite/browser session is run in this task.
