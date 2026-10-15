# Mayor — Plan (city builder inspired by Cities: Skylines II; Mac, Windows, iPad)

Visual reference: `screenshots/` (local, outside git). Sources in `SOURCES.md`.

## Stack Decision

**TypeScript + Three.js (WebGL) + Vite**, with a pure, testable TypeScript simulation.

| Platform | Delivery |
|---|---|
| iPad | Native Tauri 2 app on the App Store (`com.gutnik.mayor`, iPad only; build 3 in review since 2026-10-15); PWA zip as a fallback |
| Mac | Tauri, Developer ID signed and notarized dmg on GitHub releases (`v0.1.0-m35`) |
| Windows | Tauri (`.msi`/`.exe` build; needs a Windows machine; not built yet) |
| Browser | Paid web demo at https://mayor-demo.vercel.app ($4.99 one-time, Stripe), see `docs/WEB-DEMO.md` |

The iPad app uses Tauri 2 iOS (the same shell as the Mac app), not Capacitor as first planned. The main review risk
for a WebView game (guideline 4.2) and its mitigations are in `docs/appstore/review-notes.md`.

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
| M27 | ✅ only mode | Oriented zoning: segment-frame blocks, oriented lots, tile mirror, save v2, oriented rendering and painting; the only selectable model since `13812a1` (tile-only code still to delete) |
| M28 | ✅ Visual assets | Audit and strict export, manifests, base/variant registry, rear facades, detailed fleet, v2 reference buildings with LODs (opt-in), 700-triangle budget |
| UI-1 | ✅ Interface | UI scale/opacity, collapsible persistent panels, road-build readout |
| UI-2 | ✅ Road builder | Undo/Redo, pixel-radius snapping, angle guides v4, refusals with reasons, upgrade in place, parallel roads, touch anchor/tether/long-press; whole-road upgrade stroke still open |
| UI-3 | ◐ Zoning tools | Marquee and Fill done; densities and lot visualisation pending |
| UI tool state | ✅ | One reducer (`src/ui/tool-state.ts`), sectioned Roads/Services/Zones/Transit flyouts with costs, usage numbers and disabled reasons (`docs/process/25-tool-state.md`) |
| Junction builder | ✅ | Sidewalks wrapping corners, crosswalks, stop bars, guide dashes, arrows, lane graph, vehicles on connectors, unsignalised priority, adaptive signals |
| Traffic robustness | ✅ watchdogs | Signal-box reach and 8 s watchdog, exit-room check, leader cycle breaker, 90 s idle despawn; all six gridlock matrix cells flow. Structural spillback prevention open |
| Fable Cities ports | ✅ | MIT ports (signals by angle, IDM, zoning cells and packer, vehicle baking, HDRI, info views v2, UI patterns), all listed in `NOTICE.md` and in the in-app credits |
| City life | ✅ | Construction stages, demographics, lot evolution 1x1..4x4, 8 landmarks |
| Catalog 41-84 and rail | ◐ | Sim, rail transit and service tiers done; 7 new service models; most 41-84 GLBs missing |
| Services UX | ✅ | Street-frame facility snapping (`docs/process/19-facility-snapping.md`), usage numbers (`docs/process/24-service-usage.md`) |
| Environment | ✅ | Per-biome ground textures, pack trees, volumetric clouds (`docs/process/23-flora-assets.md`) |
| Procedural buildings | off | Core and renderer behind `?procBuildings=1`; rejected visually |
| 0.1.0 (M34, M35) | ✅ released | macOS Apple Silicon, signed and notarized; iPad PWA bundle (GitHub releases `v0.1.0-m34`, `v0.1.0-m35`) |
| App Store (iPad) | ◐ in review | Build 3 submitted 2026-10-15 03:05 PDT; build 4 in TestFlight; runbook `docs/appstore/APPSTORE.md` |
| Web demo | ✅ live | `mayor-demo.vercel.app`, Stripe Checkout $4.99 (`docs/WEB-DEMO.md`) |
| UI-4 to UI-6 | pending | Inspector diagnostics and economy dashboard, iPad layout and onboarding, themes and districts (see `docs/UI-V2-PLAN.md`) |

## Next Items

1. App Review of build 3, then manual release; hands-on TestFlight build 4 on a real iPad (Export save, 15-minute big-city run, touch open items).
2. Store tooling: fix `scripts/appstore-prereq-check.sh` for `tauri.ios.conf.json`, opaque Tauri icon source, versioned screenshots; privacy manifest if Apple asks.
3. Web demo: verify restore by email, refund policy, magic link decision.
4. Models for catalog 41-84 and placeholder services (parks, sewage outlet).
5. Traffic: prevent avenue spillback structurally instead of despawning; per-stop rider counts.
6. Memory leak hunt (tab crash after about 10 world swaps); delete the unreachable tile-zoning code.
7. M22: walking pedestrians, Windows build, hardware profiling on Mac and iPad.

Open items with owners and priorities: `docs/STATUS-2026-10-15.md`.

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

- `npm test` / `npx vitest run --exclude '.claude/**'`: simulation rules, geometry invariants, assets, UI reducers (968 passing at `db6c2d9`).
- `npm run build`: types + bundle; `npm run ci` runs both before every merge.
- Browser: game screenshots compared with `screenshots/` for UI visuals.

## Per-Milestone Ritual

When closing a milestone: add the entries to `docs/CHANGELOG.md`, update PROGRESS.md, then edit the sections of `docs/mayor-status.html` (status lists, facts, screenshots in `docs/img/`; the page is static HTML, there is no `DATA` object) and republish the same file to the Artifact https://claude.ai/artifact/VdToX8pcS7bZcKx1m65Abu (passing `files` with the images).
