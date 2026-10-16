# Changelog

All changes since the `v0.1.0-m35` tag (commit `8dc351e`, 2026-10-14 11:13 PDT), oldest first, grouped by date and
theme. Hashes are short commit ids on `main`. Test files listed are the ones added (A) or changed (M) by the commit.
Earlier history: [PROGRESS.md](../PROGRESS.md) (2026-10-14 section) and the GitHub releases `v0.1.0-m24` to `v0.1.0-m35`.

Suite size: 714 tests at M34 (2026-10-14 morning) -> **968 passed, 3 skipped, 2 todo in 117 files** at `db6c2d9`
(`npx vitest run --exclude '.claude/**'`, re-run on 2026-10-15).

## Release `v0.1.0-m35` (2026-10-14)

GitHub pre-release "Mayor 0.1.0 (M35) — macOS Apple Silicon": `Mayor-m35-mac-arm64-signed-notarized.dmg` (Developer
ID, notarized, stapled), `Mayor-m35-ipad-pwa.zip`, `SHA256SUMS-m35`. Tagged at `8dc351e` (performance test retries
batches with a pause so a loaded parallel suite does not fail a healthy build).

## 2026-10-14 — after M35

### Traffic at signalised junctions
- `7a563dc` Conflicting connector claims keep a signalised junction box clear (first jam fix). Tests: M `src/sim/priority.test.ts`, M `src/sim/blocks.test.ts` (timing test retries under load).

### City simulation: construction, demographics, lot evolution, landmarks
- `281ef50` Per-lot construction schedules, city demographics (children/adults/seniors), employment rate, statistics panel; street-frame paint test. Design: `docs/process/15-demographics-construction.md`. Tests: A `src/sim/demographics.test.ts`, M `src/sim/oriented-overlap.test.ts`.
- `b609a05` Lot evolution from 1x1 to 2x2..4x4 (merge of valid neighbours, land-value thresholds, construction restart) with dedicated x2/x4 Blender models and pools. Design: `docs/process/14-lot-evolution.md`, `14b-evolved-buildings.md`. Tests: A `src/sim/lot-evolution.test.ts`, A `src/render/x4-assets.test.ts`, M `src/render/x2-assets.test.ts`.
- `73c3f98` Landmarks: 8 rare "sumptuous" buildings with regional effects, bell toast and staged construction; refined x2/x4 evolved buildings, models regenerated. Design: `docs/process/16-landmarks.md`, `16b-landmark-models.md`. Tests: A `src/sim/landmarks.test.ts`, A `src/render/landmark-assets.test.ts`, M `src/sim/save.test.ts`.

### iOS toolchain
- `eff021b` Generated Xcode project committed under `src-tauri/gen/apple`, prereq script fixes, `libc` pinned to 0.2.189 (0.2.190 breaks `num_threads` on `aarch64-apple-ios`; see `docs/IOS.md`).

### UI
- `a3fdf4c` The R/C/I demand bar legend no longer reuses the infoview legend class (bars had collapsed to zero height).

### Zoning hugs the road
- `d0b8e69` Zone cells validated against the physical asphalt, sidewalk and junction shapes; nearest-road overlap resolution; no phantom reservations; save load restores nodes before blocks. Tests: A `src/sim/zone-attach.test.ts`, M `src/sim/zoneblocks.test.ts`.
- `8afbab1` Zones never invade roads: a single `reconcileZones` point after every road/zone/obstacle edit and load, road-surface oracle (`src/sim/roadsurface.ts`), migration only between parallel roads, lot id remap fix, curve footprint gate, save crash fixes (Opus) plus Muse invariance tests. Tests: A `src/sim/zone-invariant.test.ts`, A `src/sim/zone-invariance.test.ts`, M roads/sim/save/mirror/traffic/lots tests.
- `cf1d484` Zone grid performance: cached and incremental validity, overlap and mirror; spatial road-surface queries; junction rebuild without whole-city corridors. Output is bit-identical to the old pipeline (differential oracle). Why: the old whole-city recompute cost 46-188 ms per edit. Measured 2026-10-15 on the 96x96 fixture (Mac, reconcile phase): road 7.3 ms, bulldoze 6.0 ms, 2000-tile repaint 2.7 ms. Tests: A `src/sim/zone-perf.diff.test.ts`, A `src/sim/zone-perf.bench.test.ts` (always-on guard < 40 ms; full benchmark with `ZPERF=1`).
- `8e7e996`, `13812a1` Tile zoning is no longer selectable: prefs always load street-aligned zoning and the menu toggle is gone. Why: the owner's iPad kept tile zoning after the cutover. Tests: M `src/prefs.test.ts`.
- `da3e75d` Zone painting hangs off the road: painting a deep cell also zones the valid cells between it and the street (brush and bulk), so no zone floats detached. Tests: A `src/sim/zone-frontage.test.ts`, M `src/sim/roadupgrade.test.ts`.
- `c781e6c` The boot city adopts the player's zoning model (it skipped `swapCity` and stayed on tile zoning until a load or new game).
- `a4af3be` Building models stay inside their lot: 1xN lots get one column of models instead of a two-wide pair spilling onto neighbours. Tests: M `src/render/lots.test.ts`.

### Road tool
- `6d62a42` Snapping with a constant pixel radius (36 px touch, 16 px mouse); priority node > centreline > free point with hysteresis; unbuildable junctions refused with reasons; parallel offset from road profiles; guides optional. Design: `docs/process/17-road-snapping.md`. Tests: A `src/ui/road-snap-audit.test.ts`, M road-snap, road-parallel, roads tests.
- `70a4aec` Headlight/tail-light pool shader fix (undeclared `uv` in the fragment shader) and no per-add `Matrix4` allocation in street-light pools.
- `6a71dfe` Duplicate, overlapping and sharply crossing ground roads are refused with reasons (minimum crossing 20 degrees); roads are cut through existing nodes. Tests: A `src/sim/road-overlap.test.ts`, A `src/sim/road-overlap-svg.test.ts`, M i18n, render/roads, roads tests.
- `d669875` Road guides v4: world and road-relative angle guides with 4-degree soft capture, hysteresis, a Guides toggle, Shift to suspend. Tests: A `src/ui/road-guides.test.ts`.
- `23f41da` Guides rendering: single-draw overlay with dashed rays, active ray, turn arc, snap ticks and chevrons; angle row in the readout. Tests: A `src/render/road-guides-overlay.test.ts`.
- `7f64794` Road widening (street -> avenue) clears empty zoned cells under the new width and refuses only when built lots are in the way. Touch road tool (`src/ui/touch-road.ts`): anchor marker with radius ring, draft point offset 56 px above the finger with a tether, 450 ms long-press cancel. Tests: A `src/ui/touch-road.test.ts`, M `src/sim/roadupgrade.test.ts`, `src/ui/road-snap.test.ts`.

### Touch operation (iPad simulator)
- `a39f160` Dev scenario `?scenario=upgrade[&built=1][&lockcam=1]` (`src/dev/scenario.ts`, dev builds only) and a camera lock for scripted touch tests; touch operation notes `docs/process/18-touch-operation-notes.md`.
- `dae85ff` Flyouts close on a map tap, upgrade-mode hint ("tap a road to upgrade it"), reset-view button, maximum zoom distance 90; avenue upgrade sweep over 16 headings. Tests: A `src/sim/avenue-angles.test.ts`.
- `98a29a3` Status page: touch operation section, updated open items.

### Catalog expansion and rail (Muse)
- `a9311d8` Catalog 41-84 (new houses, shops, industry, rail, civic and utility buildings), train station and rail transit, solar plant, large power plant, water tower, large water plant, fire post and fire HQ, service tiers. GLB models for most of 41-84 do not exist yet (procedural fallback). Tests: A `src/sim/catalog-expansion.test.ts`, A `src/sim/service-tiers.test.ts`, M transit, inspect, building-inventory, visual-v2 tests.

### Facility street-frame snapping
- `bd10419`, `183b285`, `8cf3f6e` Service buildings snap to the nearest ground road within five tiles, face it, and sit flush with the profile setback line on either side (`src/sim/facilityplace.ts`; optional `cx`/`cz`/`yaw` on `FacilityAnchor`, so old saves load unchanged). Exact road-surface oracle refuses asphalt, kerbs, sidewalks and junction rings ("No room beside the street here"). SVG dumps in `docs/img/facility/` (curve, 30 and 45 degree diagonals, dead end). Design: `docs/process/19-facility-snapping.md`. Tests: A `src/sim/facilityplace.test.ts`, A `src/render/facility-transform.test.ts`, M `src/sim/save.test.ts`.

### Flora
- `226b142` Four trees from the owner's `trees_blender_pack` (30k-51k triangles each) reduced to 194-234 triangle low-poly species `tree_maple`, `tree_maple_dense`, `tree_birch`, `tree_autumn_maple` (`blender/make_pack_trees.py`; previews `docs/img/flora/tree_pack_*.png`); seamless ground textures grass fur, hedge, limestone, grey soil and red earth (owner-supplied, AI-generated; credits in `NOTICE.md`); photo cloud sprites (replaced the next day, see `3e524cf`). Design: `docs/process/23-flora-assets.md`. Tests: A `src/render/flora-textures.test.ts`.

### Traffic gridlock
Root cause: two conflicting approach cars inside the expanded connector interval each saw the other as occupying the
signal box (mutual reservation, no deterministic winner); after that was reduced, spillback on short links froze
the grid. Before: a 5x5 signalised grid at city demand froze within about 10 simulated minutes (all 260 live cars
stopped).
- `1e5518a` `BOX_REACH` 0.1, an 8 s signal-box watchdog (`BOX_TIMEOUT`: a car held longer crosses without the reservation), and an exit-room check before entering a signalised box. Five of six matrix cells (population 3000/6000/9000 x street grid / avenue spines) flowed for all 15 minutes; pop 9000 avenue still jammed late. Tests: A `src/sim/traffic-jam.test.ts`.
- `5ae4fb3` Overlapped-turn leader cycle breaker (the lower vehicle id ignores the higher id as a leader) and a 90 s idle watchdog (`IDLE_DESPAWN`: a car that has not moved for 90 s leaves the road, counted as abandoned). All six matrix cells complete trips every minute. Tests: M `src/sim/traffic-jam.test.ts` (street grid, avenue spines at city demand, determinism).

## 2026-10-15

### Clouds and terrain
- `3e524cf` Clouds are volumetric soft-puff cumulus banks (point sprites, lit white on top and blue-grey underneath, three drift layers, one draw call each) in `src/render/ambience.ts`. Why: the supplied "cloud" photos were mislabelled and rendered as trees on black. `cloud_N.png` removed.
- `80ada4f` Flora texture test updated for the removed cloud cards. Tests: M `src/render/flora-textures.test.ts`.
- `773fdbc` (Opus pass) Terrain ground textures per biome (five-slot splat, `terrainLayerSet` in `src/render/terrain-splat.ts`); `facilityUsage` shared function (`src/sim/facility-usage.ts`) with usage numbers for every service kind in the build tooltip and the inspector (`src/ui/facility-usage-view.ts`); supply and network fixes for solar, large power, water tower and large water; tier capacities rebalanced (solar 80, water tower 60, so small < base < large holds in every family); no 1.8x enlargement for 1x1 services; seven new service models (`blender/buildings_services_tiers.py`: `models/x2/61, 73, 81, 82, 83`, `models/x1/76, 84`). Design: `docs/process/24-service-usage.md`, `23-flora-assets.md`. Screenshots: `docs/img/terrain/`, `docs/img/services/`. Tests: A `src/sim/facility-usage.test.ts`, A `src/ui/facility-usage-view.test.ts`, A `src/render/facility-models.test.ts`, M terrain-splat, x2-assets, service-tiers tests.

### App Store
- `7daa467` iOS bundle id `com.gutnik.mayor` in `src-tauri/tauri.ios.conf.json` (`com.mayor.game` is registered to another developer team); Xcode project and docs updated; App Store IPAs signed with Apple Distribution. The Mac app keeps `com.mayor.game`.
- `3028c3e` iPad-only target (`TARGETED_DEVICE_FAMILY = 2`), build 2, app icon from the MAYOR logo (opaque, full-bleed, all iOS sizes), regenerated Mac and Windows icons.
- `1b3408c` App Store package in `docs/appstore/`: owner runbook, metadata pt-BR and en, privacy answers and policy text, review notes and rejection risks, 10 iPad screenshots (local only, see below), `scripts/appstore-prereq-check.sh`, in-app "About and credits" screen (`src/ui/credits.ts`). Build 3 (submitted for review 2026-10-15 03:05 PDT). Tests: A `src/ui/credits.test.ts` (keeps credits in sync with `NOTICE.md`, Fable MIT notice verbatim, pt-BR strings).

### Tool state and menus (Fable pass)
- `db6c2d9` Tool state reducer `src/ui/tool-state.ts`: one writer (`dispatch`) for tool, road choice, flyouts, draft, upgrade and interchange; fixes the road-tool "return / way back" bugs. Roads, Services, Zones and Transit flyouts are sectioned, with a live summary, costs, usage numbers and disabled reasons (`src/ui/tool-availability.ts`, `src/ui/road-facts.ts`); flyouts capped at 40 percent of the screen. Owner decisions recorded 2026-10-15: picking a road class/mode/level keeps the draft; opening Zones selects Residential. Design: `docs/process/25-tool-state.md`. Screenshots: `docs/img/menus/` (before/after, day/night, 1180 and 1366 px). Tests: A `src/ui/tool-state.test.ts`, A `src/ui/tool-availability.test.ts`, A `src/ui/road-facts.test.ts`, M `src/ui/facility-usage-view.test.ts`.
- `6c0ec5a` iOS build number 4 (`bundle.iOS.bundleVersion` in `src-tauri/tauri.ios.conf.json`), TestFlight only.

### Docs (this pass, uncommitted)
- `docs/process/18-facility-snapping.md` renamed to `docs/process/19-facility-snapping.md` (two docs shared the number 18; `src/dev/scenario.ts` links the touch notes, so the touch notes keep 18).
- New: this changelog, `docs/STATUS-2026-10-15.md`, `docs/WEB-DEMO.md`, `docs/process/README.md`. Updated: README, PROGRESS, PLAN, AGENTS, IOS, SIGNING, App Store runbook, status page source, NOTICE flora paragraph.

## 2026-10-15 — Roads cycle 1A (branch `agent/roads-render`, not yet on `main`)

Design: `docs/process/26-roads-cycle1.md` (section 11 has the observed result). Plan: `docs/superpowers/plans/2026-10-15-roads-1a-profiles-junctions.md`.
- Single road profile table `src/sim/roadprofile.ts`; every road table is a view of it; tile class by rank. Tests: A `src/sim/roadprofile.test.ts`, A `src/sim/roadprofile-consumers.test.ts`, M `src/sim/corridor.test.ts`.
- One-way lanes over the full width, lanes ordered left to right of travel, direction carried into junctions. Tests: A `src/sim/lanes-oneway.test.ts`.
- Taper junctions with left-aligned lanes, merge/added lanes, direction conflict, connector-missing diagnostics, narrower-arm corner radius. Tests: A `src/sim/junction-taper.test.ts`, A `src/sim/junction-reasons.test.ts`, A `src/sim/junction-missing-wiring.test.ts`, M `src/sim/junction.test.ts`, `junction-mixed.test.ts`, `showcase-gate.test.ts` (taper pads checked by ear-clip, min angle 2°).
- Road atlas generated from `public/textures/road/profiles.json` (`npm run roads:profiles`). Tests: A `src/render/road-profiles-json.test.ts`.
- Atlas ribbons honour junction trims at one shared across-mouth station; pad and ribbon one surface; pad refinement to ≥ 2°; taper marks; full-width one-way stop bars; no marks on highways. Tests: A `src/render/roads-atlas.test.ts`, `roads-taper.test.ts`, `roads-polish.test.ts`, M `src/render/roads.test.ts`.
- Bridges: 1.1 m barriers open at grade, retaining faces, slab edge and underside, plain concrete. Tests: A `src/render/roads-bridges.test.ts`, M `src/render/road-material.test.ts`.
- Dev: `?scenario=roads` regression scene with fixed cameras. Tests: A `src/dev/scenario-roads.test.ts`.

## 2026-10-15 — Roads cycle 1B (branch `agent/r1b-int`, not yet on `main`)

Design: `docs/process/26-roads-cycle1.md` (§6 aligned, §12 has the observed result). Plan: `docs/superpowers/plans/2026-10-15-roads-1b-highway-ramps-interchange.md`.
- Highway render: concrete Jersey barrier mesh reusing the ribbon's end stations, lamps every 3 tiles on the barrier (twins) plus singles on ramp outer sides; pads share the ribbon's asphalt tone. Tests: A `src/render/roads-highway.test.ts`, A `src/render/street-light.test.ts`, M `src/render/roads-polish.test.ts`, M `src/render/road-material.test.ts`.
- Ramp class (type 6, `src/sim/roadprofile.ts`): one lane, shoulders, no sidewalk, `junctionMarkings` rendered only at terminals; joins only straight 2-point highway segments at 10–30° in the carriageway direction; merge/diverge gores with chevrons and a dashed merge line (not curve-aware); at-grade, climbing deferred; local-span (~11 tiles) auto grade separation; one-way raster never overrides two-way tiles. Tests: A `src/sim/ramp-type.test.ts`, A `src/sim/ramp-rules.test.ts`, A `src/sim/junction-gore.test.ts`, A `src/sim/ramp-priority.test.ts`, A `src/sim/grade-local-span.test.ts`, A `src/sim/world-oneway.test.ts`, M `src/sim/corridor.test.ts`, M `src/sim/roadprofile.test.ts`, M `src/sim/roadprofile-consumers.test.ts`, M `src/i18n.test.ts`.
- Trevo diamond interchange (`src/sim/interchange.ts`) through `planRoad`: four at-grade ramps, perpendicular terminals, atomic refusal with reasons. Dev: `?scenario=interchange` scene with fixed cameras. Tests: A `src/sim/interchange.test.ts`, M `src/dev/scenario-roads.test.ts`, M `src/ui/tool-state.test.ts`.
- Markings packed into one 512×896 atlas (`public/textures/road/markings.png`): 11 custom samplers, under the 16 texture-unit limit. Source `crosswalk.png`/`stop_bar.png`/`arrow_oneway.png` still ship (the atlas test verifies them pixel-exact). Tests: A `src/render/road-markings-atlas.test.ts`, A `src/render/road-sampler-budget.test.ts`, M `src/render/roads.test.ts`, M `src/render/roads-atlas.test.ts`.
- Traffic in lanes (`id % n`, trucks/buses rightmost), lane-aware leaders with speed-dependent lookahead, monotone routes, red-light queues on every lane. Behaviour change on the saturated avenue-spine fixture: tick +31% (2.04 ms at 260 cars), completed trips 623 → 440 (ghost overlaps removed), abandoned 66 → 102; knob: spawn demand/capacity. Tests: A `src/sim/traffic-lanes.test.ts`, M `src/sim/traffic-idm.test.ts`, M `src/sim/traffic-corners.test.ts`, M `src/sim/priority.test.ts`.
- RangeError fix (pre-existing crash, not a 1B regression): `findLayeredPath` compares `Math.fround` g-values (g is float32); diagonal avenues re-relaxed forever. Tests: A `src/sim/traffic-avenue-route.test.ts` (fails without the fix).
- Saves: type 6 accepted by `save.ts`; `SAVE_VERSION` stays 2, so saves containing road type 6 do not open in builds older than this change (older builds reject them as invalid).
- Report-only perf (`MAYOR_PERF=1`, writes under `os.tmpdir()`): dense 96×96 baseline → 1B road rebuild atlas 6.48 → 8.30 ms, low tier 7.72 → 9.84 ms (both < 10 ms), one-segment-edit `junctionsOf` 1.10 → 1.11 ms, `tickTraffic(0.1)` at 260 vehicles 2.83 → 3.98 ms; layouts +4 diverge +4 merge. FPS, iPad and Windows: unmeasured. Tests: A `src/sim/traffic-perf.test.ts`, A `src/perf/roads-city-perf.test.ts`, M `src/performance.test.ts`.
- Test hygiene: report-only timing tests opt-in behind `MAYOR_PERF=1`; no file writes or console output from road tests by default (`agent-report/` gitignored). Tests: M `src/render/roads-highway.test.ts`, M `src/render/roads-atlas.test.ts`, M `src/render/roads.test.ts`, M `src/sim/showcase-gate.test.ts`, M `src/sim/zone-attach.test.ts`, M `src/sim/acute-junction.test.ts`, M `src/sim/zone-perf.bench.test.ts`.

