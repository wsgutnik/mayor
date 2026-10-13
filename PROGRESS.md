# PROGRESS — Mayor

Updated on 2026-10-12. Live status with screenshots: status artifact (source in [docs/mayor-status.html](docs/mayor-status.html)).

## State

| Milestone | State | Notes |
|---|---|---|
| M1 to M14 | done | core, services, freeform roads, traffic, transit, saves, packaging, identity, visual kit, models, maps, building kit, Blender |
| M15 Detail | done | textures, AO, lane markings, clouds, smoke, 12 redesigned buildings |
| M16 Node road network | done | node graph, corners, crosswalks, traffic-light data; roads only by Line and Curve |
| M17 Blocks and lots | done | persistent lots, one building per lot, empty lots rendered |
| M18 Networks and underground | done | water, sewage, and power by flow; Underground view; warnings |
| M19 Water | done | continuous shoreline, normals, reflection, foam, quality tiers |
| M20 Rendering | done | layered terrain, HD textures, shadows, tone mapping, LOD, quality tiers |
| M21 Roads and signals | done | one-way, roundabout, traffic lights with phases, sidewalk props |
| Vehicle fleet | done | 23 parametric variants: cars (taxi, police, minivan, pickup...), vans, trucks (box, garbage, utility, mixer, flatbed, tanker), semis (box, container), buses (city, articulated, school, double-decker, coach, mini) |
| M22 Polish | pending | pedestrians, polish, real Windows and iPad hardware |
| M23 Bridges and tunnels | done | 3× and 4× cost, deck, pillars, portals |
| M26 CS1 zoning-grid rules | partial | winner by distance and oldest segment, slope limit, row cut behind obstacle; per-segment blocks not done |
| M25 Crossing detection and textured roads | done | automatic highway rules, marker preview, interchange; Blender/Python road atlas |
| M24 Level separation | done | overpass and underpass without a node, Ground / Elevated / Underground buttons and E key, traffic by layer |

Tests: 299 passing (`npx vitest run`). Mac build verified; real Windows and iPad hardware not tested yet.

## Who Did What

- **Claude (lead):** architecture, junctions, water v1, Underground view v1, shadows, merges, review fixes, documentation, and artifact.
- **Muse:** M16 nodes, M17 lot linkage, M18 networks, M19 water, M23 bridges and tunnels; Blender assets (HD textures, props, kits); Kenney props.
- **Codex:** blocks and lots module, maps, building models, code reviews.
- **Fable:** research and plan (`docs/process/`).

## Codex Review Findings (2026-10-12)

Fixed: demolishing a road did not invalidate lots; duplicate segment IDs and stale counters; water was not rebuilt when switching to a same-size city; water texture leak; invalid base64 and NaN heights; overlapping lots in saves.
Open: linear searches in the road graph (O(S²) during rebuild), traffic-light checks per vehicle (vehicles × junctions), lots validated only at the anchor tile during synchronization.

## Known Limitations

- Muse stopped because quota was exhausted (renews on 2026-10-13 04:17 UTC); the per-segment block part of M26 is deferred.
- Level separation only through the Elevated/Underground buttons; no automatic crossing detection.
- Avenue median stops before the corner on tight curves.
- Areas reachable only by bridge or tunnel need local power and water.
- The utility network uses one pool per network ordered by proximity, not per-facility budgeting.
- No pedestrians, no per-lane directional lanes; traffic is still on the tile grid.

## Process

CI and packaging are local: `npm run ci` (types, tests, build) before each merge and `npm run package` for the app. The GitHub Actions workflow was removed.

## Mac Distribution

- Consistent ad hoc signing is ready (`npm run package:adhoc`); Developer ID signing and notarization are scripted (`npm run package:signed`) but **depend on Apple certificate and credentials**, which do not exist on this Mac (no keychain identity). Step-by-step instructions are in `docs/SIGNING.md`.

## Asset Backlog

- Underground GLB kit (pipes, pumps, valves) and lot pieces (yard, parking, plaza, corner sidewalk): `muse-world` did not finish; the game uses procedural geometry.
- Props from Kenney City Kit Roads (traffic lights, poles, signs, barriers): sources in `third_party/`, conversion not done.
- Furniture converted from the transport pack (shelters, bench, planter, pole, kiosk, ticket machine, sign) is in `blender/props_fleet.py`, but not yet connected to sidewalk props.
- Entries 31 (bus station) and 33 (cargo terminal) have models but no gameplay function; 32 (train station) is the metro-station model.

## Applicable Research (docs/process/04-*)

- CS1 zoning grid: partly implemented (M26): closest cell to road wins, tie goes to the oldest segment, invalid above the slope limit (1.0), row cut behind an invalid cell. Missing: per-segment block up to 8 tiles in segment coordinates (requires zoning outside the tile grid).
- Crossing decision by interpolated height difference (≥ 6 m separates) and maximum slope of 12.5%: Mayor currently decides by chosen level and highway rules.
- SDF markings and KTX2/ASTC: currently PNG; possible memory gain.

## Next Steps

1. Per-lane traffic (reference: `third_party/mayor-road-kit/docs/ROAD_NETWORK_ARCHITECTURE.md`, phases C and E).
2. Road graph and traffic-light performance (open findings).
3. M22: moving pedestrians, polish, validation on Windows and iPad.
4. Per-lane traffic (reference: `third_party/mayor-road-kit/docs/ROAD_NETWORK_ARCHITECTURE.md`, phases C and E).
