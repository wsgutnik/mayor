# Mayor

![Mayor](public/ui/brand-banner.png)

Mayor is an original city builder inspired by Cities: Skylines. It runs on Mac and Windows through Tauri, and on iPad as a PWA. The game ships in pt-BR by default with an English option.

Mayor focuses on the playable city-building loop: terrain, roads, zoning, lots, utilities, traffic, transit, water, saves, and local packaging. It is not a feature-parity clone of Cities: Skylines II; it is its own small, inspectable city builder built with TypeScript, Three.js, Vite, and a pure TypeScript simulation.

## Features

| Area | What is in the game |
|---|---|
| Roads and junctions | Line and Curve road drawing, streets/avenues/highways, node-based junctions, curbs, crosswalks, stop lines, one-way streets, roundabouts, traffic-light phases, bridges, tunnels, overpasses, underpasses, and automatic highway crossing rules |
| Zoning and lots | R/C/I zoning up to 4 lots from a road, persistent lots facing the street, 1×1 to 2×2 compound lots, empty-lot rendering, and lot validation for old saves. Street-aligned oriented lots (zone cells and lots in each road's frame, free yaw, so diagonal and curved streets get properly aligned buildings) are the default; the classic tile grid stays available by turning off the "Street-aligned lots" preference. |
| Utilities and underground view | Water, sewage, and power flow through the road network with capacity limits; facilities connect to the nearest road; Underground view (`U`) shows pipes, valves, and flow |
| Traffic and transit | A* traffic for residents and trucks, congestion, buses, metro stations, circular bus lines, fares, transit share, and line management |
| Water and terrain | Heightmap terrain, selectable map types, official Map Kit maps, continuous water shoreline, wave normals, sky reflection, sun glint, foam, and quality tiers |
| Art pipeline | Scripted Blender models exported as GLB, instanced buildings/props/vehicles/boats, shared textures, road texture atlas, previews, and asset tests |
| Saves | Three local save slots, monthly autosave, import/export, structural save validation, and compatibility migration for older saves |
| Packaging | Offline PWA with service worker, Tauri desktop builds, local Mac packaging, ad hoc signing, and optional Developer ID notarization scripts |

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
npm run ci
```

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
- [docs/INSTALL.md](docs/INSTALL.md): iPad, Mac, and Windows installation notes.
- [docs/SIGNING.md](docs/SIGNING.md): Mac signing and notarization.
- [docs/process/01-research.md](docs/process/01-research.md), [02-gaps.md](docs/process/02-gaps.md), [03-plan.md](docs/process/03-plan.md), [04-grids-crossings-drawing.md](docs/process/04-grids-crossings-drawing.md): research, gaps, and implementation planning.
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
| M22 | pending | Pedestrians, polish, and validation on real Windows and iPad hardware |

Tests: 474 passing with `npx vitest run`. Mac build is verified; real Windows and iPad hardware are still unverified.

## License and Trademarks

Mayor is original work inspired by city-builder conventions. It is not affiliated with, sponsored by, or endorsed by Paradox Interactive or Colossal Order. Cities: Skylines and Cities: Skylines II names belong to their owners. See [NOTICE.md](NOTICE.md) for the current code-license status, third-party materials, and trademark notice.
