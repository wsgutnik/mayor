# PROGRESS — Mayor

Updated on 2026-10-13. Live status with screenshots: status artifact (source in [docs/mayor-status.html](docs/mayor-status.html)).

## Visual upgrade — Cycle 2 (draft PR, not merged)

- Five original Blender reference models (`01`, `10`, `20`, `21`, `38`) each have LOD0/1/2 source generators under `blender/visual_v2.py`.
- `blender/build_v2.py` exports and checks the 15 prototype GLBs separately from the production kit. Blender export has **not been executed** in this environment.
- `?visualV2=1` optionally loads a validated V2 LOD0 file from `public/models/v2/` when available, otherwise it automatically uses the current GLB. Normal gameplay remains unchanged.
- `src/render/glb-models.ts` fixes non-indexed multi-material splitting, with regression tests.
- Pending release gates: Python syntax, Blender output/screenshots, TypeScript, full local CI, save compatibility, Mac/iPad profiling. Existing far-box runtime LOD remains in place; new LOD1/2 models are not dynamically selected yet.
- Detailed engineering contract: [docs/ASSET-ARCHITECTURE-V2.md](docs/ASSET-ARCHITECTURE-V2.md).



## Visual upgrade — Cycle 2B (stacked draft; not merged)

- Added a standalone structural GLB verifier and deterministic SHA256 asset manifest generator for exactly 5 reference buildings × 3 LODs (15 GLBs).
- Python verifier tests: **7 passed locally using synthetic GLB fixtures** (not actual Blender exports).
- Experimental reference loading now requires a valid packaged manifest; absent, incomplete or invalid assets revert to existing production models.
- V2 Blender exporter now prepares two consistent preview angles per LOD (30 PNGs expected after export).
- Pending: run actual Blender exporter, inspect 30 PNGs, validate exported materials/textures/bounds, copy validated binaries into preview assets, run full npm CI, test Mac and iPad.
- See [docs/VISUAL-V2-VALIDATION.md](docs/VISUAL-V2-VALIDATION.md). The Cycle 2B PR is stacked on Cycle 2A; neither is merged.


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
| M27 Oriented zoning | merged, off by default | segment-frame zone blocks, oriented lots with free yaw, tile mirror, save v2 with v1 migration, oriented rendering and ground-point painting; opt in with "Street-aligned lots (experimental)" in Preferences. P9 (make it the default) is pending a longer play-test |
| M22 Polish | pending | pedestrians, polish, real Windows and iPad hardware |

Tests: 339 passing (`npx vitest run`). Mac build verified; real Windows and iPad hardware not tested yet.

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

## Who Did What

- **Claude (lead):** architecture, junctions, water v1, Underground view v1, shadows, merges, review fixes, interaction wiring (P6), documentation, status artifact.
- **Muse:** M16 nodes, M17 lot linkage, M18 networks, M19 water, M20 rendering, M21 signals, M23 bridges and tunnels, M24 level separation, M25 detection and road atlas; Blender assets.
- **Codex (gpt-5.5):** zone blocks and lots modules, maps, building models, code reviews, performance work, street furniture, oriented zoning P1 to P5, P7, P8.
- **Fable:** research and specs (`docs/process/`, including the oriented-lots architecture).
- **Haiku:** documentation language audit and status sync.

## Known Limitations

- Muse and Codex hit their usage quotas on 2026-10-12 (Muse renews 2026-10-13 04:17 UTC, Codex 2026-10-13 00:05 local).
- Level separation is automatic only for highways; other crossings use the Elevated/Underground buttons.
- Avenue median stops before the corner on tight curves.
- Areas reachable only by bridge or tunnel need local power and water.
- The utility network uses one pool per network ordered by proximity, not per-facility budgeting.
- No pedestrians, no per-lane directional lanes; traffic is still on the tile grid.
- Floating striped patches on open terrain were seen in a user screenshot and could not be reproduced.

## Process

CI and packaging are local: `npm run ci` (types, tests, build) before each merge and `npm run package` for the app. No GitHub Actions. Releases are created locally with `gh release create` from the packaged dmg (see [AGENTS.md](AGENTS.md)).

## Mac Distribution

- Consistent ad hoc signing is ready (`npm run package:adhoc`); Developer ID signing and notarization are scripted (`npm run package:signed`, `scripts/mac-cert-setup.sh`) but **depend on an Apple certificate and notary credentials**, which do not exist on this Mac yet. Step-by-step in [docs/SIGNING.md](docs/SIGNING.md).

## Asset Backlog

- Underground GLB kit (pipes, pumps, valves) and lot pieces (yard, parking, plaza, corner sidewalk): not finished; the game uses procedural geometry.
- Props from Kenney City Kit Roads (traffic lights, poles, signs, barriers): sources in `third_party/`, conversion not done.
- Entries 31 (bus station) and 33 (cargo terminal) have models but no gameplay function; 32 (train station) is the metro-station model.

## Applicable Research (docs/process/04-*, 05-*)

- CS1 zoning grid: implemented behind the oriented-zoning flag (blocks per segment in the segment frame, per-row frames, overlap resolution). Classic mode keeps the tile-grid approximation (M26 rules).
- Crossing decision by interpolated height difference (≥ 6 m separates) and maximum slope of 12.5%: Mayor decides by chosen level and highway rules.
- SDF markings and KTX2/ASTC: currently PNG; possible memory gain.

## Next Steps

1. P9: play-test oriented zoning on diagonal and curved streets, polish kerbs and growth, then make it the default.
2. Per-lane traffic (reference: `third_party/mayor-road-kit/docs/ROAD_NETWORK_ARCHITECTURE.md`, phases C and E).
3. M22: moving pedestrians, polish, validation on Windows and iPad.
4. Public web demo (Vercel + Stripe checkout): package prepared in `~/mayor-site`; waits for Vercel login and Stripe account choice.
