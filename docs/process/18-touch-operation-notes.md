# 18 - Touch operation notes (iPad simulator, 2026-10-14)

Method: iPad Pro 11" (M5) simulator, dev scenario `?scenario=upgrade&lockcam=1[&built=1]`
(`src/dev/scenario.ts`: angled street, residential zoning both sides, paused, camera frozen).
Driven with single-finger taps and paths through the simulator control tool.

## Verified

- Street -> Avenue upgrade in one tap on the road (Roads panel: Avenue + Upgrade road). Cost $1,895 for 12 tiles,
  median drawn, zoned cells re-seated against the new kerb on both sides, undo enabled.
- With `built=1` the upgrade is refused with a reason (built lots), as designed.

## Difficulties found (open)

| # | Where | Problem | Proposed fix |
|---|---|---|---|
| 1 | Roads panel | Panel covers ~40% of the map, including the road being edited; it stays open after picking a type | Auto-close on type pick, or dock it to the toolbar edge |
| 2 | Upgrade mode | Hint keeps saying "tap a start point" while Upgrade road is on; no on-map cue of which road will upgrade | Hint "Tap a road to upgrade to Avenue" and highlight the segment under the finger |
| 3 | Camera | One finger with no anchor pans/rotates; a stray drag zoomed out until the map was a small island, no way back | Home/reset-camera button; clamp max zoom to the map |
| 4 | Toolbar | Taps with a held duration were ignored or opened the wrong submenu; submenu animation hides state for ~1 s | Larger hit boxes, state shown immediately |
| 5 | Zones submenu | Opens over the Roads tool without switching the highlighted tool (Roads stays lit) | Highlight follows the open submenu |
| 6 | Clock | Unpaused, the game ran years in minutes at 1x on the simulator | Check tick pacing against real time on device |
| 7 | Simulator | Portrait device frame shows the landscape UI rotated 90 deg; Safari chrome takes a strip | Test in a landscape-locked build or rotate the simulator |
