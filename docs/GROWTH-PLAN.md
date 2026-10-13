# Mayor — Growth Plan

> Update 2026-10-13 (after writing): S-3 multi-tile footprints is partly done (2x2 service placement, save and renderer fallback are merged; the 2x2 models are in progress), and oriented zoning plus the detail redesign, AI textures and traffic corner fixes landed. Hardware measurement (HW-1) is still the first open item.

Status: planning document, October 2026. Sources: `README.md`, `PLAN.md`, `PROGRESS.md`, `docs/UI-V2-PLAN.md`, `docs/VISUAL-UPGRADE-ROADMAP.md`, `docs/ASSET-ARCHITECTURE-V2.md`, `docs/process/01-research.md`–`05-oriented-lots.md`, and `src/sim`, `src/render`, `src/ui`. Cited measurements come from those documents; the rest is labelled as target or code observation. Hardware performance is **not measured** yet (`PROGRESS.md`, M28), so no frame-rate below is claimed as achieved.

## 1. Where Mayor stands against a Cities: Skylines-class builder

Mayor is a coherent, playable single-city builder, not a feature-parity clone (`README.md` says so explicitly). The core loop works end to end: terrain → roads → zoning → growth → economy → services → traffic/transit → saves → local packaging (Tauri Mac verified; Windows and iPad unverified). Milestones M1–M21, M23–M28 and UI-1/UI-2/UI-3 (part) are done; M22 (pedestrians, polish, real-hardware validation) is the only pending milestone. The gap to Skylines is therefore not "does it run" but depth per system, content volume, and proven performance at scale.

| Pillar | Mayor today | Skylines-class expectation |
|---|---|---|
| Simulation depth | Deterministic pure-TS sim (`src/sim/`), monthly economy step in `src/sim/sim.ts` (`step`, `recount`), aggregate population/jobs/happiness, no individual citizens | Agent citizens with homes, jobs, education, life cycle |
| Economy | Single treasury, flat `taxRate`, R/C/I demand from jobs/workers balance (`sim.ts` `recount`); no loans, bonds, per-zone tax, or trade | Budgets per service, loans, district policies, imports/exports |
| Services | Radius `COVER` bitmask (`src/sim/world.ts`) plus road-flow utilities (`src/sim/networks.ts`); police/fire/health/education/parks/transit bits; no fire spread, crime simulation, or per-facility staffing | Simulated service vehicles, coverage by road travel, disasters |
| Traffic | Tile-grid A* (`src/sim/traffic.ts`), `MAX_VEHICLES = 260`, tile `load` congestion, centreline smoothing; no lanes, no pedestrians | Lane graph, lane changes, parking, pedestrians, cargo chains |
| Zoning / lots | Dual model: classic tile lots (`src/sim/blocks.ts`) and oriented segment-frame cells/lots (`src/sim/zonecells.ts`, `zoneblocks.ts`, `orientedlots.ts`, `mirror.ts`), oriented is default since M27 P9; depth 4, 1×1–2×2 (planner tries up to 4×4 shapes) | Per-segment grids, 1×1–4×4 (CS1) or up to 6×6 (CS2), densities, district styles |
| Visuals | N1–N2 baseline, heroes at N2 (`docs/VISUAL-UPGRADE-ROADMAP.md`); 40 buildings + 67 props audited, rear facades largely done, five v2 references opt-in (`?visualV2=1`) without runtime LOD switching | N3 consistent realism, full LOD chains, PBR, district variety |
| UI/UX | DOM HUD (`src/ui/hud.ts`, `menu.ts`, `inspector.ts`), i18n pt-BR default; UI-1–UI-3 partial; UI-4–UI-6 (diagnostics, iPad layout, districts) pending | Dense infoviews, economy dashboard, onboarding, full touch layout |
| Performance / platforms | Instanced rendering, quality tiers (`src/prefs.ts`), rebuild gated by `world.revision` in `src/render/scene.ts`; iPad budget is rebuild under 10 ms at 96×96 (`AGENTS.md` rule 4); no hardware FPS/VRAM data | Profiled budgets per platform, adaptive LOD/streaming |
| Content | 40 catalog buildings (`src/sim/catalog.ts`), Map Kit maps, biomes; bus-station/cargo entries without gameplay function; no scenarios, achievements beyond "light", no editor | Hundreds of assets, scenarios, milestones, workshop content |
| Onboarding | Tips preference and HUD hints; no tutorial, encyclopedia, or first-city guided flow (UI-5 owns it, pending) | Tutorial, advisor, milestone unlocks |
| Monetisation / distribution | Local packaging only (`npm run package`), ad hoc signing ready, Developer ID/notarization scripted but blocked on certificate; public web demo waits on Vercel/Stripe (`PROGRESS.md`) | Store pages, demo funnel, updates |

Three facts shape everything below. The sim is deliberately aggregate: `recount` sums capacity per tile/lot and traffic spawns representative vehicles, so realism means new subsystems, not tuning. Two zoning generations coexist (tile mirror + oriented cells); the mirror under-counts diagonal capacity (`05-oriented-lots.md` Q4) and taxes every new feature until readers migrate. Nothing is profiled on real Windows/iPad hardware, so scale claims are unproven on a headline platform.

## 2. Prioritised roadmap

Sequencing principle: prove performance and finish the oriented-zoning cutover before adding simulation depth; add depth before content volume; monetise only a build that retains. Each deliverable names its acceptance check; `npx tsc --noEmit` and `npx vitest run` (463 tests at time of writing) must stay green throughout, and old saves must load (`AGENTS.md` rules 2–3).

### Horizon 1 — Next 2 weeks: measure and finish what is merged

- **HW-1 Hardware baseline.** Profile the 96×96 demo city on a real iPad and a Windows machine: FPS by quality tier, `renderer.info` draw calls/triangles/textures, rebuild time, load time. Acceptance: numbers recorded in `PROGRESS.md` replacing "Not measured"; budgets in §6 confirmed or revised. Depends on: nothing; blocks all later performance work.
- **HW-2 Oriented polish.** Fix the known M27 gaps (`PROGRESS.md`): ragged block edges, front-row-only growth in sparse blocks, pad thickness; implement or explicitly defer `G-INHERIT` neighbour-zone inheritance. Acceptance: new `zoneblocks.test.ts`/`orientedlots.test.ts` cases for deep-row growth; diagonal street playtest with no pad on asphalt (lead visual check via `window.__city`). Depends on: —.
- **HW-3 Runtime LOD for v2 references.** Wire LOD1/LOD2 buckets in `src/render/lod.ts` for the five `?visualV2=1` buildings with fallback to the shared box. Acceptance: `lod.test.ts` covers bucket switching; visual A/B in one city; base assets untouched. Depends on: HW-1 (to judge cost).
- **HW-4 Whole-road upgrade stroke + UI-3 remainder design.** Ship the pending UI-2 stroke; spec (not build) densities and lot visualisation against `orientedlots.ts` data. Acceptance: `roadupgrade.test.ts` stroke cases; one-undo-entry behaviour preserved. Depends on: HW-2.

### Horizon 2 — 1–2 months: depth the player can feel

- **D-1 Inspector diagnostics + economy dashboard (UI-4).** "Why is this building not growing" from real sim state (`src/sim/inspect.ts`, `inspector.ts`) and a budget view fed by `recount` (income/upkeep per service, utility supply/demand). Acceptance: every reason string maps to a sim predicate with a test; no placeholder numbers (per `docs/UI-V2-PLAN.md`). Depends on: HW-2.
- **D-2 Pedestrians (M22 core).** Sidewalk agents on the segment graph: spawn at lots, walk to transit/commercial, rendered as one instanced mesh. Deliberately aggregate (pooled walkers, no per-citizen homes yet). Acceptance: walkers visible at street level, zero per-frame allocation, capped count by quality tier; `traffic.test.ts`-style determinism test. Depends on: HW-1.
- **D-3 iPad layout + onboarding (UI-5).** Bottom-sheet tools, persistent build controls, compact/comfortable density, first-city guided flow, encyclopedia entries via `src/i18n.ts`. Acceptance: full build loop completable by touch alone at 1024 px without horizontal toolbar scroll (fixes the known UI-1 overflow); tutorial completable without keyboard. Depends on: D-1.
- **D-4 Service depth pass.** Per-facility utility budgeting (replacing the single-pool proximity model noted in `PROGRESS.md`), service-vehicle visualisation for garbage/fire where cheap. Acceptance: shortage localises to districts of the map instead of city-wide averaging; `networks.test.ts` extended. Depends on: —.

### Horizon 3 — 3–6 months: systems that justify a price

- **S-1 Lane-graph traffic (phased).** Move traffic from tile A* to a lane graph derived from `src/sim/roads.ts` nodes/segments (reference: `third_party/mayor-road-kit/docs/ROAD_NETWORK_ARCHITECTURE.md` phases C/E, already cited in `PROGRESS.md`). Phase A: lane-aware paths on existing geometry with tile fallback; Phase B: lane offsets, junction turning, parking pressure. Acceptance: one-way/roundabout suites in `traffic.test.ts` pass on the lane graph; vehicle cap raised only with HW-1 headroom data. Depends on: HW-1, D-2 (shared corridor model).
- **S-2 Districts + themes (UI-6) and densities.** District painting (`world` field + terrain border), per-district style selection using the deterministic variant rule in `docs/ASSET-ARCHITECTURE-V2.md` §6, and zoning densities (UI-3 remainder) as data in `catalog.ts`, not new catalog IDs. Acceptance: old saves load (districts optional, validated in `src/sim/save.ts`); no visible repetition in a 300-lot city (C5 gate in the visual roadmap). Depends on: D-1, HW-3.
- **S-3 Multi-tile footprints.** `footprint` field in `catalog.ts` + planner support (classic and oriented) for hospital/city hall/plants/stations (#27, #21, #31–#33, #34, #40), behind a save-version bump with migration. Acceptance: `save.test.ts` round-trip + v-current migration; 2×2 facilities place, render, and serve. Depends on: HW-2, save-versioning work in §4.
- **S-4 Content pack 1.** Give bus station (#31) and cargo terminal (#33) gameplay function via `transit.ts`; scenarios/milestone goals; additional maps. Acceptance: each entry either functions or is honestly labelled decorative in the catalog. Depends on: D-4.

### Horizon 4 — 6–12 months: scale and business

- **L-1 Performance at 128×128.** Chunked/incremental rebuild (split `world.revision` by subsystem), KTX2/ASTC texture path gated on measured VRAM (design in `docs/ASSET-ARCHITECTURE-V2.md` §5, §8), PBR family atlases for v2 assets. Acceptance: §6 budgets met on iPad hardware; PNG fallback intact. Depends on: HW-1, S-1.
- **L-2 Citizen layer (optional, gated).** Named households/workers only if retention data (Horizon 3) shows players hitting the aggregate ceiling; otherwise invest in content instead. Acceptance: design spike with sim-tick budget before any build. Depends on: S-1, owner decision Q3.
- **L-3 Distribution.** Developer ID + notarization (`docs/SIGNING.md`), Windows hardware sign-off, public web demo and store presence per owner decisions in §5. Acceptance: signed, notarized Mac build; verified Windows install; demo funnel instrumented locally (no third-party analytics without owner approval). Depends on: §5 decisions.
- **L-4 Mod/asset pipeline (only if Q4 = yes).** Documented GLB variant contract (registry, strict export, manifests already exist) exposed as a community asset path. Acceptance: third-party building loads without code change; base game unaffected by bad assets. Depends on: L-1, Q4.

## 3. The 10 highest-leverage bets

1. **Measure on hardware first (HW-1).** Every later bet spends against an unmeasured budget (`PROGRESS.md` flags performance as unvalidated). Risk: results force scope cuts — cheaper now than after lane traffic.
2. **Finish oriented zoning over maintaining two models (HW-2 + mirror migration).** Diagonal streets are the most visible gap and every feature pays dual-path tax. Risk: migration loses buildings; mitigated by the lossless-migration invariant and save tests in `05-oriented-lots.md`.
3. **Inspector diagnostics before new systems (D-1).** Players cannot enjoy depth they cannot debug. Risk: exposes shallow rules; acceptable, it prioritises D-4 honestly.
4. **Pedestrians as pure life layer (D-2).** Largest realism gain per sim cost, reusing segment geometry without citizen simulation. Risk: reads as decoration; mitigate with lot→transit/commercial purposes.
5. **Lane-graph traffic in phases with tile fallback (S-1).** The 260-vehicle tile model caps believability. Risk: largest item here; fallback keeps the game shippable at each step.
6. **Districts + deterministic variants over raw asset count (S-2).** Data-driven variety scales; hand-modelling hundreds of buildings does not. Risk: variants read as recolors; pair with the silhouette queue.
7. **Multi-tile civic footprints (S-3).** Landmark scale sells screenshots, and planner groundwork (`lotFootprint`) exists. Risk: needs the save bump; batch it once (§4).
8. **iPad as a designed surface, not a scaled desktop (D-3).** Touch layout plus onboarding decides demo conversion. Risk: dual layout maintenance; contain with `src/ui/panel-state.ts`.
9. **Functional transit/cargo over new building art (S-4).** Moving goods/people creates stories; static models do not. Risk: scope swallows; cap at one goods loop tied to industry.
10. **Free web demo as funnel, desktop as product (L-3, pending Q2).** The PWA exists; a bounded demo de-risks pricing. Risk: cannibalises sales if unbounded; cap by map/population, not features.

## 4. Technical debt to pay before scaling

- **Tile-grid traffic vs lane graph.** `src/sim/traffic.ts` A* walks tiles and smooths centrelines after; lanes/turning/parking have nowhere to live. Do S-1 before raising caps or map size. Keep tile fallback until lane tests match.
- **Sim/render coupling.** `src/sim` is cleanly pure (keep it), but `src/render/scene.ts` (1,663 lines) rebuilds on one `world.revision`; G19 in `docs/process/02-gaps.md` calls for split revisions. Split before 128×128 (L-1), incrementally.
- **Dual zoning readers.** Migrate `networks.ts`, `traffic.ts`, `transit.ts`, `inspect.ts` to cells/lots (`05-oriented-lots.md` §3.1), then delete dead tile code (M27 P9). Budget dual tests until then.
- **Save versioning.** `SAVE_VERSION = 2` (`src/sim/save.ts`) is a good base. Batch the next bump (S-3, S-2) into one migration with per-version fixtures; keep `next*Id` monotonicity and the tile mirror until the flag-off path is deleted.
- **Asset pipeline.** Reconcile triangle budgets: `AGENTS.md` rule 7 says 1,400, the strict exporter defaults to 700, detailed models reach 1,170 (`PROGRESS.md`). One number in `glb-assets.test.ts` before further refinement. Do not start PBR/KTX2 (designed, not built) until HW-1 VRAM data exists; PVRTC pitfall in `docs/process/04-grids-crossings-drawing.md` §3.2.
- **Test strategy.** 463 tests are sim-heavy; gaps are hardware performance (none), visual regression (manual only), save fixtures. Add golden saves per version, headless instance-count tests (pattern in `05-oriented-lots.md` P5), and a benchmark script writing to `PROGRESS.md`. No browser automation (`AGENTS.md` reserves it for the lead).
- **Agent workflow.** Worktree + patch-merge works but concentrates Blender/visual checks on the lead; Muse stalls are documented. Keep 30–60 min phase units (`05-oriented-lots.md` §8), tests with every patch, and the `docs/mayor-status.html` ritual.

## 5. Decisions the owner must make

- **Q1 Platforms and price.** Is iPad a first-class paid platform or a companion to desktop? What single price (or free + paid unlock) for Tauri builds? This sets the performance budget and store work in L-3. Recommendation to react to: desktop-first paid, iPad same purchase promise only after HW-1 passes.
- **Q2 Free demo.** Bounded web demo (capped map/population) yes/no, and on which host/account (Vercel + Stripe groundwork exists per `PROGRESS.md`)? Recommendation: yes, capped by city size so the full loop is visible.
- **Q3 Content scope.** Depth (citizen layer L-2, cargo S-4) versus breadth (more buildings/maps)? Recommendation: depth first; the catalog is sufficient until districts make variants cheap.
- **Q4 Mod support.** Officially supported community assets (L-4), unsupported-but-tolerated, or closed? Recommendation: tolerate via the existing manifest contract now; promise support only after L-1 stabilises formats.
- **Q5 Multiplayer.** Recommendation: **no** — no networking exists anywhere in the codebase, the sim is local-deterministic by design, and cooperative building would reorder every priority above. Revisit only as asynchronous city sharing (export/import already exists) if players ask.

## 6. Metrics scorecard

Targets below are goals to verify, not results; the only measured figures are the 463 passing tests and asset audit counts (40 buildings, 67 props, 0 errors) from `PROGRESS.md`. Review this table at each horizon gate and replace targets with hardware readings as HW-1 lands.

| Metric | Target / budget | Source or gate |
|---|---|---|
| Frame rate, iPad medium, 96×96 demo city | ≥ 45 fps sustained (aspirational figure from M20 planning in `docs/process/03-plan.md`; unverified) | HW-1 measurement |
| Frame rate, Mac high | ≥ 60 fps (same planning source; unverified) | HW-1 measurement |
| Sim + rebuild cost | Rebuild under 10 ms at 96×96 (`AGENTS.md` rule 4); zone-block build for 2,000 segments under 15 ms (`05-oriented-lots.md` P1) | `npx vitest run` perf cases |
| Texture memory, iPad | ≤ 64 MB medium / ≤ 128 MB high (proposed in `05-oriented-lots.md` §6) via `renderer.info` | HW-1, L-1 |
| Load time | Cold load to interactive measured on iPad and recorded; no target set until HW-1 baseline exists | HW-1 |
| Tests | `npx tsc --noEmit` clean; `npx vitest run` green, count never decreases; every new sim rule ships with tests (`AGENTS.md` rule 2) | `npm run ci` per merge |
| Save safety | Every released save version loads; zero building loss in migration fixtures | `save.test.ts` |
| Retention proxies (local only) | Demo: tutorial completion, first city reaching each milestone, second-session return — collected only with owner-approved local instrumentation (L-3) | Horizon 3 gate for L-2 |
| Content health | Asset audit 0 errors / 0 warnings; every catalog entry functional or labelled decorative | `scripts/audit-visual-assets.mjs`, S-4 |

Through-line: the hard skeleton exists — node roads, oriented lots, road-flow utilities, instanced rendering, validated saves. The risk is now measurement, legibility, and depth worth charging for. Horizons 1–2 answer those in order.
