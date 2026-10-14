# PROGRESS — Mayor

Updated on 2026-10-14 (after the M34 release and the junction, traffic, zoning and render ports; see the 2026-10-14 section at the end). Live status with screenshots: status artifact (source in [docs/mayor-status.html](docs/mayor-status.html)).

## State

| Milestone | State | Notes |
|---|---|---|
| M1 to M14 | done | core, services, freeform roads, traffic, transit, saves, packaging, identity, visual kit, models, maps, building kit, Blender |
| M15 Detail | done | textures, AO, lane markings, clouds, smoke, 12 redesigned buildings |
| M16 Node road network | done | node graph, corners, crosswalks, traffic-light data; roads only by Line and Curve |
| M17 Blocks and lots | done | persistent lots, one building per lot, empty lots rendered |
| M18 Networks and underground | done | water, sewage, and power by flow; Underground view (`U`); warnings |
| M19 Water | done | continuous shoreline, normals, reflection, foam, quality tiers |
| M20 Rendering | done | layered terrain, HD textures, shadows, tone mapping, LOD, quality tiers |
| M21 Roads and signals | done | one-way, roundabout, traffic lights with phases, sidewalk props |
| Vehicle fleet | done | 23 parametric variants: cars, vans, trucks, semis, buses (articulated, school, double-decker, coach, mini) |
| M23 Bridges and tunnels | done | 3× and 4× cost, deck, pillars, portals |
| M24 Level separation | done | overpass and underpass without a node, Ground / Elevated / Underground buttons and `E` key, traffic by layer |
| M25 Crossing detection and textured roads | done | automatic highway rules, marker preview, interchange; Blender/Python road atlas |
| Street furniture | done | shelters, bus-stop signs, kiosks, ticket machines, benches, planters, alternating street lights (GLB with procedural fallback) |
| Graph and signal performance | done | segment/node indices, per-tile signal lookup, full-footprint lot sync |
| M26 CS1 zone-cell rules | done | nearer road wins, oldest segment on ties, slope limit, row cut behind obstacles |
| M27 Oriented zoning | merged, **default since P9** | segment-frame zone blocks, oriented lots with free yaw, tile mirror, save v2 with v1 migration, oriented rendering and ground-point painting; "Street-aligned lots" in Preferences turns it off; old prefs without a stored choice move to the new default; kerb strips fixed to the front edge |
| M28 Visual assets | done | audit script and strict Blender export, manifest, base/variant registry, rear/side facades for the kit (#05-#37, #39, #40), per-building budget 700 triangles, detailed vehicles, five v2 reference buildings with 3 LODs behind `?visualV2=1` and a manifest gate |
| Utilities over bridges | done | layer-aware flood: power, water and sewage cross bridges and tunnels at ramps |
| UI-1 Interface | done | UI scale and panel opacity prefs, collapsible persistent panels (key H), road-build readout (cost, length, slope, level, reason) |
| UI-2 Road builder | partial | Undo/Redo (snapshot history, 30 steps), snapping (angle, length, road snap, Alt bypass), upgrade a road in place (explicit toggle), parallel road helper |
| Zone/road invariant (zinv) | done (agent, unmerged) | single `reconcileZones` after every road/zone/obstacle edit and load; physical road surface module; exact ring/road validity; lot footprint gate on curves; migration only along the same road direction; lot id remap and landmark/construction fixes; property test (200 random ops, both modes) |
| UI-3 Zoning tools | partial | Marquee and Fill (classic and oriented, one undo entry each) |
| 2x2 services | done | `facilityAnchors` in the world and save (optional field), placement/bulldoze/coverage/utility links from the footprint centre, one model per anchor with `/models/x2/NN.glb` or a 1.8x scaled 1x1 fallback; hospital, city hall, secondary school, thermal plant, water, metro. 2x2 models built and loaded from `models/x2/` for #21, #27, #29, #32, #34, #40 (640-940 triangles each) |
| v2 buildings batch | done | 35 buildings have `v2` variants with `v2_lod1`/`v2_lod2` (`?visualV2=1`, manifest-gated); runtime LOD switching still open |
| Corridor model | steps 1-2 of ADR 06, junction rendering (part of step 3) | `src/sim/corridor.ts` (RoadProfile, SegmentCorridor); junction asphalt polygon from arm edges, miter-limited acute corners, trimmed arms, kerbs wrapping corners without inner arcs; lots are not yet clipped against junction polygons |
| Junction builder | in progress | sidewalks wrapping corners, crosswalks and stop bars, guide dashes, arrows, lane graph; unsignalised priority pending (design in `docs/process/07-junction-builder.md`) |
| Procedural buildings | experimental, off by default | `?procBuildings=1`; rejected visually, rework pending gb3 |
| Native iPad app | prepared | `tauri.conf.json` iOS section, `Info.ios.plist`, `scripts/ios-prereq-check.sh`, `docs/IOS.md`; needs full Xcode 26.1.1 and an iOS provisioning profile (not available here); rust iOS targets installed |
| M22 Polish | pending | pedestrians, polish, real Windows and iPad hardware |

Tests: 714 passing, 2 todo, 85 files (`npx vitest run`, 2026-10-14). Mac build verified; real Windows and iPad hardware not tested yet.

## Oriented zoning (M27) phases

| Phase | State | Files |
|---|---|---|
| P0 contracts and flag | merged | `src/sim/zonecells.ts`, `prefs.zoning`, menu toggle |
| P1 zone blocks | merged | `src/sim/zoneblocks.ts` |
| P2 oriented lots | merged | `src/sim/orientedlots.ts`, oriented helpers in `src/render/lots.ts` |
| P3 mirror and sim wiring | merged | `src/sim/mirror.ts`, oriented branches in `src/sim/sim.ts` |
| P4 save v2 | merged | `src/sim/save.ts` (v1 -> cells migration, rollback through the mirror) |
| P5 oriented rendering | merged | `src/render/lots.ts` (`lotInstances`), `src/render/scene.ts` (`pickCell`, `setHoverCell`) |
| P6 interaction | merged | `src/input.ts` (`strokePoints`), `src/main.ts` (cell painting, bulldoze, hover) |
| P7 resolution upgrade | merged | quality profile, 256 px windows, plot material, lot LOD |
| P8 HD textures | merged | `blender/make_textures.py`, `_hd` kit textures, `plot.png` |
| P9 cutover and cleanup | pending | make `oriented` the default, convert tests, remove dead tile-only code |

Known gaps in the oriented path: neighbour-zone inheritance when painting single cells (CS1 `G-INHERIT`) is not implemented; kerb strips in the middle of some blocks need a polish pass; growth is slow in sparse blocks because only front-row lots (column 0) are build candidates.

## Visual asset upgrade (M28)

| Item | State |
|---|---|
| Audit script (`scripts/audit-visual-assets.mjs`) | Done: 40 buildings + 67 props, 0 errors, 0 warnings; writes `docs/asset-audit.json` and `docs/asset-inventory.md` |
| Strict Blender export (`--strict`, `MAYOR_BUILDING_TRI_LIMIT`, default 700) | Done; fails on tile/height/triangle/unregistered/undeclared override |
| Registry: base/variant, version, footprint, declared overrides | Done; variants export to `variants/<variant>/NN.glb` and `models/v2/NN_lod{0,1,2}.glb`, never replace base |
| `public/models/manifest.json`, `public/models/v2/asset-manifest.json` + tests | Done (`scripts/verify_v2_assets.py --check`) |
| Detail redesign (budget 1400) | Done for #02-#09, #11-#19, #22-#37, #39, #40: richer roofs, frames, trims, paving and rear/side facades (max 1170 triangles); vehicles got more detail plus 6 new car looks (38 vehicle models) |
| AI-generated HD textures | Done: plaster, brick, concrete, roof tile, wood, metal, paving, gravel, grass, dirt, rock, sand, asphalt, foliage, sidewalk, kerb, plot (`blender/apply_ai_textures.py`, provenance in NOTICE.md) |
| v2 reference buildings (#01, #10, #20, #21, #38) | Merged, opt-in `?visualV2=1`; LOD1/LOD2 not switched at runtime yet |
| Asset architecture V2, roadmap | Documented (`docs/ASSET-ARCHITECTURE-V2.md`, `docs/VISUAL-UPGRADE-ROADMAP.md`); PBR/KTX2/multi-tile not implemented |
| Hardware performance (Mac/Windows/iPad) | **Not measured** |

## Who Did What

- **Claude (lead):** architecture, junctions, water v1, Underground view v1, shadows, merges, review fixes, interaction wiring (P6), documentation, status artifact.
- **Muse:** M16 nodes, M17 lot linkage, M18 networks, M19 water, M20 rendering, M21 signals, M23 bridges and tunnels, M24 level separation, M25 detection and road atlas; Blender assets.
- **Codex (gpt-5.5):** zone blocks and lots modules, maps, building models, code reviews, performance work, street furniture, oriented zoning P1 to P5, P7, P8.
- **Fable:** research and specs (`docs/process/`, including the oriented-lots architecture).
- **Haiku:** documentation language audit and status sync.

## Known Limitations

- Agent quotas: Muse spark stalls on some prompts (no file changes after 30+ min); Codex gpt-5.5 works but cannot run Blender in its sandbox, so the lead builds and reviews.
- Level separation is automatic only for highways; other crossings use the Elevated/Underground buttons.
- Avenue median stops before the corner on tight curves.
- Utilities cross bridges and tunnels (layer-aware flood), but a deck never feeds the road it crosses over; only ramps link layers.
- The utility network uses one pool per network ordered by proximity, not per-facility budgeting.
- No pedestrians, no per-lane directional lanes; traffic is still on the tile grid.
- Undo/Redo does not record tax-rate changes; upgrade-to-highway often needs de-zoning first; Marquee/Fill density and lot visualisation are not implemented.
- UI: at scale 1.4 on a 1024 px viewport the toolbar scrolls horizontally; settings sliders apply on Apply, not live.
- Floating striped patches on open terrain were seen in a user screenshot and could not be reproduced.

## Process

CI and packaging are local: `npm run ci` (types, tests, build) before each merge and `npm run package` for the app. No GitHub Actions. Releases are created locally with `gh release create` from the packaged dmg (see [AGENTS.md](AGENTS.md)).

## Mac Distribution

- The M34 release (`v0.1.0-m34`) ships `Mayor-m34-mac-arm64-signed-notarized.dmg`, Developer ID signed and notarized, built with `scripts/release-mac.sh` (commit 22f7b35). Step-by-step in [docs/SIGNING.md](docs/SIGNING.md).
- Consistent ad hoc signing remains the fallback (`npm run package:adhoc`); the dmg is then not notarized.

## Asset Backlog

- Underground GLB kit (pipes, pumps, valves) and lot pieces (yard, parking, plaza, corner sidewalk): not finished; the game uses procedural geometry.
- Props from Kenney City Kit Roads (traffic lights, poles, signs, barriers): sources in `third_party/`, conversion not done.
- Entries 31 (bus station) and 33 (cargo terminal) have models but no gameplay function; 32 (train station) is the metro-station model.

## Applicable Research (docs/process/04-*, 05-*)

- CS1 zoning grid: implemented behind the oriented-zoning flag (blocks per segment in the segment frame, per-row frames, overlap resolution). Classic mode keeps the tile-grid approximation (M26 rules).
- Crossing decision by interpolated height difference (≥ 6 m separates) and maximum slope of 12.5%: Mayor decides by chosen level and highway rules.
- SDF markings and KTX2/ASTC: currently PNG; possible memory gain.

## Next Steps

1. Oriented zoning polish: ragged block edges where rows are cut off, growth in deeper rows, pad thickness (it is the default now).
2. UI-2/UI-3 remainder: whole-road upgrade stroke, density and lot visualisation, inspector diagnostics, economy dashboard (numbers from the real sim).
3. Assets: runtime LOD1/LOD2 for the v2 references, rear facades for the few remaining plain models, multi-tile footprints for #27/#21/#31-#33/#34/#40 (needs a save-version bump), then real Mac/iPad profiling.
4. Vehicles follow lane connectors (in flight, gt3); per-lane traffic (reference: `third_party/mayor-road-kit/docs/ROAD_NETWORK_ARCHITECTURE.md`, phases C and E).
5. M22: moving pedestrians, polish, validation on Windows and iPad.
6. Distribution: public web demo (Vercel + Stripe, package in `~/mayor-site`) waits on Vercel login and Stripe account choice; App Store release is blocked until full Xcode 26.1.1 is installed (`docs/IOS.md`).

## 2026-10-14

Landed on 2026-10-13 and 2026-10-14, grouped by area (commit short hashes from `git log`):

- **Release:** `v0.1.0-m34` (macOS Apple Silicon, signed and notarized dmg, iPad PWA zip, SHA256SUMS). Signing script `22f7b35`.
- **Junction builder and renderer:** `bcfc67a`, `1d6345a`, `f635f78`, `2a9ec06` (lane arrows on asphalt, adaptive signal controller as a pure module), `7b601b6` (no guide dashes on roundabout ring nodes), `3160b2d` (short-segment trim budget), `a0d7717` (layout-driven bands, crosswalks, stop bars, guide dashes), `4aa6ca1` and `8bd6df2` (miter-limited acute corners, kerbs wrapping corners), `955362c` (junction showcase and gate, signals by angle), `4d843ae` (sidewalk profile, junction.ts P0-P2), `eb7dfa6` (design and visual-quality skill), `c3d4b21` (AGENTS.md rule 11).
- **Lane graph and procedural buildings:** `13d1b5e` (procedural building core and lane graph with connectors), `80fbc47` (procedural building renderer and construction state, behind `?procBuildings=1`).
- **Traffic:** `59e169d` (IDM car-following; red lights as virtual leaders).
- **Zoning:** `ef1c8f2` (9-point cell validity, trapezoid cells, priority overlap resolution, DP lot packer, per-window night lights, lot ground plans).
- **Vehicles, render and environment:** `26f962b` (single baked vehicle geometry, per-car paint and lamps, shadow proxies, PCF bias), `5b97698` (night vehicle and street-light pools, HDRI environment with day-faded IBL, CC0 texture set), `e6bb792` (Blender facade and roof pass).
- **Info views v2 and UI patterns:** `bcfc67a` (coverage field texture, traffic road tint, bell toasts, onboarding card, tooltip, legend).
- **Research:** `5e920e1` (GitHub road and traffic tools, licence-checked), plus the Fable Cities port studies in `docs/process/08` to `10`.

Gaps, stated plainly:

- Vehicles do not follow lane connectors yet. The lane graph is used by junction geometry only (gt3 in flight).
- Unsignalised priority (yield and stop rules) is pending.
- The adaptive signal controller in `src/sim/signals.ts` is held in `TrafficState` and drives running lights from live queues; unsignalised priority rules (yield-to-right, main road) are still missing.
- Procedural buildings are rejected visually and stay behind `?procBuildings=1`, off by default, until gb3 is done.
- The junction showcase `?showcase=1` is dev-only (`import.meta.env.DEV`); the headless gate is `src/sim/showcase-gate.test.ts`.
- App Store release is blocked on full Xcode 26.1.1 (see `docs/IOS.md`).
- `NOTICE.md` attributes only the signal and IDM code to Fable Cities. The zoning, vehicle, render and buildings ports carry MIT headers in code but are not yet listed there.
- Hardware performance on Mac, Windows and iPad is still not measured.
