# PROGRESS — Mayor

Updated on 2026-10-15 (head `6c0ec5a`: App Store build 3 in review, TestFlight build 4, web demo live). One-page
state: [docs/STATUS-2026-10-15.md](docs/STATUS-2026-10-15.md). Every change since M35 with hashes and tests:
[docs/CHANGELOG.md](docs/CHANGELOG.md). Status page source: [docs/mayor-status.html](docs/mayor-status.html).

## State

| Milestone | State | Notes |
|---|---|---|
| M1 to M14 | done | core, services, freeform roads, traffic, transit, saves, packaging, identity, visual kit, models, maps, building kit, Blender |
| M15 Detail | done | textures, AO, lane markings, clouds, smoke, 12 redesigned buildings |
| M16 Node road network | done | node graph, corners, crosswalks, traffic-light data; roads only by Line and Curve |
| M17 Blocks and lots | done | persistent lots, one building per lot, empty lots rendered |
| M18 Networks and underground | done | water, sewage, and power by flow; Underground view (`U`); warnings |
| M19 Water | done | continuous shoreline, normals, reflection, foam, quality tiers |
| M20 Rendering | done | layered terrain, HD textures, shadows, tone mapping, LOD, quality tiers; per-biome ground layers (2026-10-15) |
| M21 Roads and signals | done | one-way, roundabout, traffic lights with phases, sidewalk props |
| Vehicle fleet | done | 23 parametric variants; single baked geometry with per-car paint and lamps |
| M23 Bridges and tunnels | done | 3× and 4× cost, deck, pillars, portals |
| M24 Level separation | done | overpass and underpass without a node, Ground / Elevated / Underground, traffic by layer |
| M25 Crossing detection and textured roads | done | automatic highway rules, marker preview, interchange; road atlas |
| M26 CS1 zone-cell rules | done | nearer road wins, oldest segment on ties, slope limit, row cut behind obstacles |
| M27 Oriented zoning | done, **only mode** | street-aligned zoning is the only selectable model since `13812a1` (tile code still in the repo, unreachable) |
| Roads cycle 1A | done on branch `agent/roads-render` | road profile table, honest junctions, tapers, one-way full width, highway 3+3 texture, bridges; design `docs/process/26-roads-cycle1.md` |
| Roads cycle 1B | done on branch `agent/r1b-int` (visual-gate re-check open) | highway barrier + lamps, ramp class + Trevo diamond, traffic lanes, markings atlas; facts + numbers in `docs/process/26-roads-cycle1.md` §12 and `docs/CHANGELOG.md` |
| M28 Visual assets | done | audit, strict export, manifests, rear facades, detailed fleet, v2 references behind `?visualV2=1` |
| Junction builder | done | sidewalks wrapping corners, crosswalks, stop bars, guide dashes, arrows, lane graph; vehicles follow connectors; unsignalised priority (`816cc01`) |
| Zone integrity (zinv) | done | single `reconcileZones`, physical road-surface oracle, zones never invade roads (`8afbab1`); frontage fill (`da3e75d`); incremental pipeline, 46-188 ms down to under 8 ms per edit (`cf1d484`) |
| Road tool v4 | done | pixel-radius snapping, refusals with reasons, angle guides, touch anchor/tether/long-press, widening clears empty zoned cells |
| Lot evolution, demographics, landmarks | done | 1x1 to 4x4 lots, construction stages, age groups, employment, 8 landmarks |
| Catalog expansion 41-84 and rail | done (models partial) | train station and rail transit, service tiers; 7 new service GLBs; most 41-84 zoned buildings use the procedural fallback |
| Facility street-frame snapping | done | `src/sim/facilityplace.ts`, oriented anchors, old saves unchanged |
| Service usage numbers | done | `facilityUsage` in tooltip and inspector, tier balance table |
| Traffic gridlock fix | done | box reach, 8 s box watchdog, exit-room check, leader cycle breaker, 90 s idle despawn |
| Flora and clouds | done | four pack trees (194-234 tris), five ground textures, volumetric cloud banks |
| Tool state and menus | done | `src/ui/tool-state.ts` reducer, sectioned flyouts with costs and disabled reasons |
| UI-2 Road builder | done | Undo/Redo, snapping, upgrade in place, parallel roads, guides; whole-road upgrade stroke still open |
| UI-3 Zoning tools | partial | Marquee and Fill; densities and lot visualisation open |
| Procedural buildings | off | rejected visually; behind `?procBuildings=1` |
| Mac release | done | `v0.1.0-m35`, signed and notarized dmg |
| Native iPad app | **in App Store review** | `com.gutnik.mayor`, iPad only; build 3 submitted 2026-10-15 03:05 PDT, build 4 in TestFlight |
| Web demo | live | https://mayor-demo.vercel.app, $4.99 Stripe Checkout ([docs/WEB-DEMO.md](docs/WEB-DEMO.md)) |
| M22 Polish | pending | pedestrians walking, real Windows and iPad hardware validation |

## Measured Numbers

| Measure | Value | Source |
|---|---|---|
| Tests | **968 passed, 3 skipped, 2 todo, 117 files** at `db6c2d9` (714 at M34) | `npx vitest run --exclude '.claude/**'`, 2026-10-15 |
| Types | clean | `npx tsc --noEmit`, 2026-10-15 |
| Zone reconcile, 96x96 fixture | road edit 7.3 ms, bulldoze 6.0 ms, 2000-tile repaint 2.7 ms (was 46-188 ms per edit) | `src/sim/zone-perf.bench.test.ts` guard on the Mac, 2026-10-15 |
| Gridlock matrix | pop 3000/6000/9000 x street grid/avenue spines: all six complete trips every minute (before: all 260 cars frozen within ~10 min) | `src/sim/traffic-jam.test.ts`, `5ae4fb3` |
| Traffic throughput (earlier) | 1657 trips in 600 s at 20 spawns/s, no gridlock | status page, M35 |
| Pack trees | 194-234 triangles each (sources 30k-51k) | `docs/process/23-flora-assets.md` |
| Hardware frame times (Mac, Windows, iPad) | **not measured** | - |

## Decisions and Rationale (since M35)

| Decision | Why |
|---|---|
| Tile zoning removed from the menu; street-aligned zoning always | The owner's iPad kept tile zoning after the cutover; one model avoids two code paths in play. |
| Painting a deep cell zones the cells between it and the road | A zone that floats detached from the street is a visual defect (rule 11). |
| Widening a road clears empty zoned cells, refuses only over built lots | Upgrading must not be blocked by paint the player can redo; buildings are the player's investment. |
| Gridlock handled by watchdogs (8 s box, 90 s idle despawn) | A deterministic winner alone did not clear spillback; the city must never freeze. Structural prevention is still open. |
| Facilities snap to the street frame; no pose = legacy placement | Same frame as lots; optional fields keep old saves loading (rule 3). |
| Service tiers: small < base < large in every family (solar 80, water tower 60) | The expansion had inverted families (solar 180 > coal 120). |
| Clouds as procedural point-sprite banks | The supplied cloud photos were mislabelled tree images. |
| One tool-state reducer; picks keep the draft; opening Zones selects Residential (owner, 2026-10-15) | Five hooks updating separate copies produced the "return / way back" road-tool bugs. |
| iOS bundle id `com.gutnik.mayor` | `com.mayor.game` is registered to another developer team. |
| iPad only, free, manual release, non-trader | iPhone would need its own UI review and screenshots; no monetisation in the app. |
| Web demo paid ($4.99) and never mentioned in the app | Funds the project without breaking App Store guideline 3.1. |

## Who Did What

- **Claude (lead, Opus/Sonnet):** architecture, junctions, zone integrity, merges, touch fixes, traffic watchdogs, App Store package, iOS builds and uploads, documentation, status artifact.
- **Muse:** M16-M25 networks and roads, catalog expansion 41-84 and rail, invariance tests, Blender assets.
- **Codex:** zone blocks and lots, oriented zoning phases, facility snapping, traffic diagnostics, reviews.
- **Fable:** research and specs (`docs/process/`), tool-state reducer and menu rework.
- **Haiku:** documentation language audit and status sync.

## Known Limitations

- Real-iPad performance, Windows and Mac frame times are not measured; touch was tested with synthetic events on the simulator.
- Export save on iPad is untested (may be a dead button inside WKWebView).
- Avenue gridlock is cleared by despawning cars idle for 90 s, not prevented.
- Per-station riders are an estimate (fleet share). Parks and the sewage outlet use placeholder models; most 41-84 GLBs are missing.
- Browser tab crash after about 10 world swaps (possible leak), not investigated.
- Utilities: one pool per network ordered by proximity; a bridge deck never feeds the road under it.
- No walking pedestrians; UI at scale 1.4 on 1024 px scrolls the toolbar.
- Full list with owners and priorities: [docs/STATUS-2026-10-15.md](docs/STATUS-2026-10-15.md).

## Process

CI and packaging are local: `npm run ci` (types, tests, build) before each merge, `npm run release:mac` for the
notarized dmg, `npm run ios:build -- --export-method app-store-connect` for the IPA. No GitHub Actions. See
[AGENTS.md](AGENTS.md).

## Next Steps

1. App Review for build 3; on approval, manual release. Test Export save and play 15 minutes on a real iPad with build 4.
2. Fix `scripts/appstore-prereq-check.sh` (reads the iOS id/build number from the wrong file) and the RGBA Tauri icon source; version the App Store screenshots.
3. Web demo: verify restore by email, write the refund policy, decide on a magic link.
4. Models for catalog 41-84 and the placeholder services (parks, sewage outlet).
5. Traffic: structural spillback prevention; count per-stop riders.
6. Memory: investigate the crash after repeated world swaps.
7. M22: walking pedestrians, Windows build, hardware profiling.

## Earlier Log

The 2026-10-14 log (M34 release, junction builder, Fable Cities ports, IDM, zoning cells, vehicle baking, info views
v2) is preserved in git history (`git show 8afbab1:PROGRESS.md`) and summarised in README and PLAN.
