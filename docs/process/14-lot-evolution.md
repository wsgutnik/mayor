# 14 — Growable lot evolution

## Chosen design: atomic segment-block merge

Three designs were considered: (1) resize one lot across arbitrary tile-grid neighbours, (2) tear down every lot in a block and re-plan it at each upgrade, and (3) atomically merge an eligible oriented lot with rectangle-aligned neighbours in its own segment block. We choose (3). It preserves road-facing frames and IDs, avoids city-wide reshuffles, and makes the obstruction boundary explicit.

The evolution step is pure with respect to its candidate scan and mutates only after every cell of the chosen rectangle passes validation. A replacement retains the anchor lot ID; absorbed IDs are retired and `nextOLotId` is never decremented or reused. Thus old saves need no fields or migration and start participating only in later simulation ticks.

## Recipe

Footprint targets are frontage × depth cells. Residential: L1 `1×1..1×2`, L2 `2×2`, L3 `3×3`, L4 `4×3`, L5 `4×4`. Commercial lags: L1 `1×1`, L2 `1×2`, L3 `2×2`, L4 `3×3`, L5 `4×4`. Industrial: L1 `1×2`, L2 `2×3`, L3 `3×3`, L4 `4×3`, L5 `4×4`.

Mean mirrored land value thresholds for L2–L5 are `24, 42, 61, 78`; zone demand must exceed the existing upgrade gate. The candidate rectangle is at most `4×4`, remains in one `(segment, side, block)`, and includes the upgrading lot. Every cell must be valid, exactly the same zone, and either empty or owned by a lot at no higher level. Invalid cells encode road surface, junction clearance, facilities, water and conflict keep-outs, so no separate renderer exception may bypass this test. Candidates sort by area, then a deterministic integer position hash.

On success every merged cell receives the new owner ID and level, absorbed lot objects are removed, the lot begins at `build = 0`, and the tile mirror is rebuilt. Capacity is counted per mirror tile, so `recount()` immediately reflects the new footprint. Levels 4–5 borrow the existing level-3 kit visuals until dedicated models exist.

## Invariants and budgets

- `lotCoverage` has no holes and `checkLots` reports no lot/road overlap after every merge.
- Only same block/zone valid cells may be absorbed; higher-level lots are never replaced.
- Equal world, lots and seed select the same rectangle; IDs remain unique and counters only increase.
- The scan considers at most 16 cells and at most 256 candidate rectangles per upgrade. No allocations occur in render frames.
- Renderer uses a footprint variant declared by the model manifest when loaded; absent variants retain the existing kit-cluster fallback.

