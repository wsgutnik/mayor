# Mayor

![Mayor](public/ui/brand-banner.png)

Mayor is an original city builder inspired by Cities: Skylines. It runs on Mac and Windows through Tauri, on iPad as a PWA, and has native iPad/iPhone packaging prepared through Tauri 2. The game ships in pt-BR by default with an English option.

Mayor focuses on the playable city-building loop: terrain, roads, zoning, lots, utilities, traffic, transit, water, saves, and local packaging. It is not a feature-parity clone of Cities: Skylines II; it is its own small, inspectable city builder built with TypeScript, Three.js, Vite, and a pure TypeScript simulation.

## Features

| Area | What is in the game |
|---|---|
| Roads and junctions | Line and Curve road drawing, streets/avenues/highways, node-based junctions with sidewalks that wrap corners, crosswalks and stop bars on asphalt, centre guide dashes, lane arrows, closed dead ends, one-way streets, roundabouts, bridges, tunnels, overpasses, underpasses, and automatic highway crossing rules. Junction geometry uses a lane graph with connectors. |
| Traffic signals | Phases by approach angle (skewed and 5-arm junctions); an adaptive controller (3-8 s green, 2 s yellow, 1 s all-red) runs from live approach queues |
| Zoning and lots | R/C/I zoning up to 4 lots from a road, persistent lots facing the street, 1×1 to 2×2 compound lots, empty-lot rendering, and lot validation for old saves. Street-aligned oriented lots are the default: zone cells are trapezoids on curves, overlaps are resolved by priority, and a dynamic-programming packer places the lots. The classic tile grid stays available by turning off the "Street-aligned lots" preference. Lit windows at night are per window. |
| Procedural buildings (experimental) | Facade, recipe and roof generation, off by default. Enable with `?procBuildings=1`. Not accepted visually yet. |
| Utilities and underground view | Water, sewage, and power flow through the road network with capacity limits; facilities connect to the nearest road; Underground view (`U`) shows pipes, valves, and flow |
| Traffic and transit | A* traffic for residents and trucks snapped to road centrelines, IDM car-following with red lights as virtual leaders, congestion, buses, metro stations, circular bus lines, fares, transit share, and line management. Vehicles do not follow lane connectors yet. |
| Vehicles and lighting | Single baked vehicle geometry with per-car paint and lamps, vehicle light pools and shadows at night, an HDRI environment with day-faded image-based lighting, and atmosphere |
| Water and terrain | Heightmap terrain, selectable map types, official Map Kit maps, continuous water shoreline, wave normals, sky reflection, sun glint, foam, and quality tiers |
| Info views and UI | Coverage overlay (served strength, gaps, rings), traffic tint on roads, bell toasts, onboarding card, tooltips, and a legend |
| Art pipeline | Scripted Blender models exported as GLB, instanced buildings/props/vehicles/boats, shared textures, CC0 textures (ambientCG via Fable Cities, Poly Haven, Kenney), road texture atlas, previews, and asset tests |
| Saves | Three local save slots, monthly autosave, import/export, structural save validation, and compatibility migration for older saves |
| Packaging | Offline PWA with service worker, Tauri desktop builds, local Mac packaging, ad hoc signing, and Developer ID signing with notarization (used for the 0.1.0 M34 release) |

## Quick Start

```bash
npm install
npm run dev     # http://localhost:5173 (also on the local network for iPad testing)
npm test        # simulation rules
npm run build   # types + bundle in dist/
```

Useful local checks:

```bash
npx tsc --noEmit
npx vitest run
npx vitest run src/sim/showcase-gate.test.ts   # headless junction gate
npm run ci
```

Junction showcase (dev server only): `http://localhost:5173/?showcase=1`. Procedural buildings (experimental): add `?procBuildings=1`.

Build Blender assets:

```bash
blender -b --factory-startup --python blender/build_all.py -- --out public/models --previews docs/img/models
```

## Controls

| Action | Mouse | Touch |
|---|---|---|
| Use tool | left button (zones: drag to paint; roads: click start and end, or start, curve, and end) | one finger (roads: tap) |
| Cancel road | Esc | Finish road button |
| Move camera | right button, WASD/arrows | Move tool, or two fingers |
| Rotate | middle button, Q/E | two fingers (twist) |
| Zoom | wheel | pinch |
| Underground view | `U` (or Maps → Underground) | Maps → Underground |
| Undo / Redo | `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` | ↩ ↪ buttons in the top bar |
| Hide HUD panels | `H` | Hide panels button |
| Skip road snapping | hold `Alt`/`Option` while drawing | - |

## Project Layout

| Path | Purpose |
|---|---|
| `src/sim/` | Pure simulation logic: world state, rules, road graph, lots, utilities, traffic, transit, saves, and tests |
| `src/render/` | Three.js renderer: terrain, roads, lots, water, underground view, GLB models, materials, picking, and camera |
| `src/ui/` | DOM/CSS HUD, menus, inspector, panels, and localized UI strings through `src/i18n.ts` |
| `blender/` | Procedural model and texture pipeline, preview generation, and GLB export scripts |
| `public/` | Runtime assets: models, textures, maps, icons, service worker, and manifest |
| `third_party/` | CC0 sources and project-internal art packs used as conversion sources |
| `docs/` | Install/signing docs, process research, review notes, status artifact, and reference images |

## Documentation

- [PLAN.md](PLAN.md): roadmap and architecture notes.
- [PROGRESS.md](PROGRESS.md): live milestone status and known limitations.
- [docs/GROWTH-PLAN.md](docs/GROWTH-PLAN.md): prioritised growth roadmap (by Muse wonder), horizons, bets and open product decisions.
- [docs/UI-V2-PLAN.md](docs/UI-V2-PLAN.md): UI audit verified against the code and the UI cycles.
- [docs/ASSET-ARCHITECTURE-V2.md](docs/ASSET-ARCHITECTURE-V2.md), [docs/VISUAL-UPGRADE-ROADMAP.md](docs/VISUAL-UPGRADE-ROADMAP.md), [docs/BUILDING-QUALITY-REPORT.md](docs/BUILDING-QUALITY-REPORT.md), [docs/VISUAL-ASSET-AUDIT.md](docs/VISUAL-ASSET-AUDIT.md): asset pipeline, audit and roadmap.
- [docs/INSTALL.md](docs/INSTALL.md): iPad, Mac, Windows, and native iOS installation notes.
- [docs/IOS.md](docs/IOS.md): native iPad/iPhone build prerequisites, signing, TestFlight, and troubleshooting.
- [docs/SIGNING.md](docs/SIGNING.md): Mac signing and notarization.
- [docs/process/01-research.md](docs/process/01-research.md), [02-gaps.md](docs/process/02-gaps.md), [03-plan.md](docs/process/03-plan.md), [04-grids-crossings-drawing.md](docs/process/04-grids-crossings-drawing.md): research, gaps, and implementation planning.
- [docs/process/07-junction-builder.md](docs/process/07-junction-builder.md) and [07a-junction-review.md](docs/process/07a-junction-review.md): junction builder contract and review. [docs/process/junction-gate.md](docs/process/junction-gate.md): the junction quality gate.
- [docs/process/08-fable-cities-port.md](docs/process/08-fable-cities-port.md), [09-fable-buildings-port.md](docs/process/09-fable-buildings-port.md), [10-fable-render-port.md](docs/process/10-fable-render-port.md): MIT study and port plans from Fable Cities.
- [docs/process/11-gm-infoview-ui.md](docs/process/11-gm-infoview-ui.md): info views v2 and UI patterns. [11-junction-renderer-status.md](docs/process/11-junction-renderer-status.md): junction renderer handoff.
- [docs/process/12-github-road-tools-research.md](docs/process/12-github-road-tools-research.md) and [12b-github-research-muse.md](docs/process/12b-github-research-muse.md): road and traffic tool research (licence-checked).
- [NOTICE.md](NOTICE.md): licensing, trademarks, and third-party material notices.
- [third_party/README.md](third_party/README.md): source asset inventory.

## Status

| Milestone | Status | Summary |
|---|---|---|
| M1-M8 | done | Playable core, civic services, freeform roads, traffic, transit, saves, PWA, and Tauri packaging |
| M9-M15 | done | Visual identity, UI kit, 3D models, Map Kit maps, building kit, Blender pipeline, water v1, textures, AO, crossings, clouds, smoke |
| M16-M18 | done | Node road network, junction geometry, blocks and lots, road-flow utilities, and Underground view |
| M19-M21 | done | Continuous shoreline water, lighting/material/LOD quality tiers, one-way roads, roundabouts, traffic lights, and sidewalk props |
| M23-M25 | done | Bridges and tunnels, level separation, automatic crossing detection, interchange preview, diamond ramps, and texture-based roads |
| Vehicle fleet | done | 23 parametric vehicle variants: cars, vans, trucks, semis, and buses |
| M26-M27 | done | CS1-style zone-cell rules; oriented (street-aligned) zoning behind a preference |
| M28 | done | Asset audit, strict Blender export, manifests, rear facades, detailed fleet, v2 reference buildings (opt-in `?visualV2=1`) |
| UI-1 to UI-3 (part) | done | UI scale/opacity, collapsible panels, road-build readout, Undo/Redo, snapping, road upgrade, parallel roads, zoning Marquee and Fill |
| M27 | done | Oriented (street-aligned) zoning is the default |
| Junction builder | in progress | Sidewalks, crosswalks, guide dashes, arrows, and the lane graph are in; unsignalised priority is pending |
| Fable Cities ports (MIT) | done | Signals by angle, IDM car-following, zoning cells and packer, vehicle baking, HDRI environment, info views v2 and UI patterns |
| Procedural buildings | experimental | Behind `?procBuildings=1`, off by default; rejected visually, rework pending |
| 0.1.0 (M34) | released (pre-release tag) | macOS Apple Silicon, Developer ID signed and notarized, with an iPad PWA bundle. See the GitHub release `v0.1.0-m34` |
| M22 | pending | Pedestrians, polish, and validation on real Windows and iPad hardware |

Tests: 714 passing (2 todo, 85 files) with `npx vitest run`, as of 2026-10-14. Mac build is verified; real Windows and iPad hardware are still unverified.

## License and Trademarks

Mayor is original work inspired by city-builder conventions. It is not affiliated with, sponsored by, or endorsed by Paradox Interactive or Colossal Order. Cities: Skylines and Cities: Skylines II names belong to their owners. See [NOTICE.md](NOTICE.md) for the current code-license status, third-party materials, and trademark notice.
