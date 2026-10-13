# Mayor — Plan (city builder inspired by Cities: Skylines II; Mac, Windows, iPad)

Visual reference: `screenshots/` (local, outside git). Sources in `SOURCES.md`.

## Stack Decision

**TypeScript + Three.js (WebGL) + Vite**, with a pure, testable TypeScript simulation.

| Platform | Delivery |
|---|---|
| iPad | PWA (Add to Home Screen, fullscreen) → later Capacitor/App Store if desired |
| Mac | Tauri (Rust already installed) or the browser itself |
| Windows | Tauri (`.msi`/`.exe` build; needs Windows or CI to compile) |

Why: one codebase, runs on all three platforms, touch + mouse, and can be visually checked here in the embedded browser.
Godot/Unity would require an editor and per-platform exports. Cost: a lower performance ceiling than a native engine
(thousands of buildings are OK; hundreds of thousands of agents are not).

## Honest Scope

CS2 is a game made by roughly 100 people over years. Goal: a **playable core** that reproduces the loop (terrain → roads → zones → city grows → economy) and the visual language of the UI. It is not feature parity.

## Milestones

| # | Milestone | Delivery |
|---|---|---|
| M1 | **Playable core** ✅ done | Terrain, mouse+touch camera, roads, R/C/I zones, bulldoze, growth, RCI demand, budget/taxes, HUD, tests |
| M2 | ✅ Services | Power, water, sewage, garbage collection; radius coverage; infoview overlays |
| M3 | ✅ Civic services | Police, fire, health, education, parks; happiness and land value |
| M4 | ✅ Freeform roads | Curves/Bézier, road types, intersections, crossings, cut terrain |
| M5 | ✅ Agents | Citizens/vehicles with pathfinding (A*/flow), traffic, congestion |
| M6 | ✅ Public transit | Buses, metro, lines, and stops |
| M7 | ✅ Persistence and meta | Save/load, maps, light achievements, day/night cycle, weather |
| M8 | ✅ Packaging (Mac verified; Windows and iPad pending verification) | Offline PWA, Tauri Mac/Win, icons, iPad performance |
| M9 | ✅ Visual identity | Crown logo, HUD icons, preferences panel (language, quality, autosave), indicators |
| M10 | ✅ Visual kit | PDF icons and tiles, selectable terrains, trees, tabbed preferences |
| M11 | ✅ 3D models | Procedural houses, towers, sheds, facilities, lit windows at night |
| M12 | ✅ Official maps | Map Kit heightmaps loaded in game, map selector in menu |
| M13 | ✅ Building kit | Catalog of 40 buildings, model per entry, seven facilities, inspector |
| M14 | ✅ Blender, nature, and water | Blender-to-GLB pipeline, trees, vehicles, boats, flowing water |
| M15 | ✅ Detail | Textures, AO, crosswalks, clouds, smoke, redesigned primary buildings |
| M16 | ✅ Node road network | Node graph, corners, crosswalks, traffic-light data; roads by Line and Curve |
| M17 | ✅ Blocks and lots | Persistent street-facing lots, one building per lot, zones up to 4 lots from the road |
| M18 | ✅ Networks and underground | Water, sewage, and power by road flow, Underground view, warnings |
| M19 | ✅ Water | Continuous shoreline, normals, reflection, foam, quality tiers |
| M20 | ✅ Rendering | Layered terrain, HD textures, shadows, tone mapping, LOD, quality tiers |
| M21 | ✅ Roads and signals | One-way, roundabout, traffic lights with phases, sidewalk props |
| M22 | pending | Pedestrians, polish, validation on Windows and iPad |
| M25 | ✅ Detection and texture | Automatic crossing rules, preview, interchange; texture-based Blender roads |
| M24 | ✅ Level separation | Overpass and underpass without a node, layer-specific traffic |
| M23 | ✅ Bridges and tunnels | Segment elevation, water and hill spans, deck, pillars, portals |
| M27 | ✅ merged, off by default | Oriented zoning: segment-frame blocks, oriented lots, tile mirror, save v2, oriented rendering and painting behind the `zoning` preference; cutover (P9) pending |
| M28 | ✅ Visual assets | Audit and strict export, manifests, base/variant registry, rear facades, detailed fleet, v2 reference buildings with LODs (opt-in), 700-triangle budget |
| UI-1 | ✅ Interface | UI scale/opacity, collapsible persistent panels, road-build readout |
| UI-2 | ◐ Road builder | Undo/Redo, snapping, upgrade in place, parallel roads done; whole-road upgrade stroke pending |
| UI-3 | ◐ Zoning tools | Marquee and Fill done; densities and lot visualisation pending |
| UI-4 to UI-6 | pending | Inspector diagnostics and economy dashboard, iPad layout and onboarding, themes and districts (see `docs/UI-V2-PLAN.md`) |

## Architecture

```text
src/sim/      pure logic (no DOM/three): world, rules, tick  → vitest
src/render/   three.js: terrain, instances, camera, picking
src/ui/       DOM/CSS HUD (top bar, toolbar, RCI, budget)
src/input.ts  mouse/keyboard/touch → intentions (pan, zoom, rotate, paint)
src/main.ts   loop: input → sim (ticks by speed) → render → HUD
```

Principles: deterministic simulation (seeded RNG), renderer only reads state and rebuilds when `world.revision` changes,
UI never mutates the world directly and uses `applyTool`.

## Verification

- `npm test`: simulation rules (connectivity, growth, economy, determinism).
- `npm run build`: types + bundle.
- Browser: game screenshots compared with `screenshots/` for UI visuals.

## Per-Milestone Ritual

When closing a milestone: edit the `DATA` object in `docs/mayor-status.html` (milestone status, checks, log, screenshot in `docs/img/`) and republish the same file to the Artifact https://claude.ai/artifact/VdToX8pcS7bZcKx1m65Abu (passing `files` with the images).
