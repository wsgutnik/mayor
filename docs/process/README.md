# docs/process — index

Design, research and review documents, numbered roughly in the order they were written. A number names one topic;
letter suffixes (`07a`, `12b`, `14b`, `16b`) are companions to the same topic. Numbers 20 to 22 are unused (the
gap is historical). Rule 11 in `AGENTS.md`: visible geometry must follow one of these designs or the
`mayor-visual-quality` skill.

| Doc | One line |
|---|---|
| [01-research.md](01-research.md) | How Cities: Skylines handles the basics (roads, zones, services, traffic): reference study. |
| [02-gaps.md](02-gaps.md) | Gap list: Mayor at M15 against the reference. |
| [03-plan.md](03-plan.md) | Execution plan for M16 to M22. |
| [04-grids-crossings-drawing.md](04-grids-crossings-drawing.md) | Zone grids, crossings and road drawing in CS, and what Mayor should do (with `04-regras.json`). |
| [05-oriented-lots.md](05-oriented-lots.md) | Segment-frame zone cells and oriented lots: the M27 spec (phases in `05-phases.json`). |
| [06-corridor-parcel-architecture.md](06-corridor-parcel-architecture.md) | ADR 06: road corridor and parcel architecture (`src/sim/corridor.ts`). |
| [06-corridor-parcel-research.md](06-corridor-parcel-research.md) | Research behind ADR 06: a shared road-corridor model. |
| [07-junction-builder.md](07-junction-builder.md) | Junction builder interface and drawing recipe. |
| [07a-junction-review.md](07a-junction-review.md) | Read-only design-vs-code review of the junction builder. |
| [08-fable-cities-port.md](08-fable-cities-port.md) | Fable Cities (MIT) study: what to port for junctions, lanes and quality. |
| [09-fable-buildings-port.md](09-fable-buildings-port.md) | Fable Cities study: buildings, zoning and alignment rules. |
| [10-fable-render-port.md](10-fable-render-port.md) | Fable Cities study part 2: vehicles, materials and rendering. |
| [11-gm-infoview-ui.md](11-gm-infoview-ui.md) | Info views v2 and UI patterns (event bus, toasts, onboarding, tooltip, legend). |
| [11-junction-renderer-status.md](11-junction-renderer-status.md) | Junction renderer handoff notes (shares 11 with the info views doc; historical). |
| [12-github-road-tools-research.md](12-github-road-tools-research.md) | GitHub research (Opus): roads, junctions, lanes, signals, markings; licence-checked. |
| [12b-github-research-muse.md](12b-github-research-muse.md) | Same research by Muse: ideas, algorithms, data. |
| [13-review-opus-1.md](13-review-opus-1.md) | Adversarial read-only review of the codebase (Opus, round 1). |
| [14-lot-evolution.md](14-lot-evolution.md) | Growable lots: 1x1 to 2x2..4x4 merge rules and thresholds. |
| [14b-evolved-buildings.md](14b-evolved-buildings.md) | Evolved-footprint building models (x2/x4) and their budgets. |
| [15-demographics-construction.md](15-demographics-construction.md) | Per-building construction stages and demographics (age groups, employment). |
| [16-landmarks.md](16-landmarks.md) | Landmark easter eggs: roll, cooldown, effects. |
| [16b-landmark-models.md](16b-landmark-models.md) | Landmark Blender model recipes. |
| [17-road-snapping.md](17-road-snapping.md) | Road snapping audit and rules (pixel radius, priorities, refusals). |
| [18-touch-operation-notes.md](18-touch-operation-notes.md) | Touch operation on the iPad simulator: what works, difficulties, status of fixes. |
| [19-facility-snapping.md](19-facility-snapping.md) | Facility street-frame snapping (`src/sim/facilityplace.ts`). Renamed from `18-facility-snapping.md` on 2026-10-15 to give each topic a unique number. |
| [23-flora-assets.md](23-flora-assets.md) | Flora recipe: pack trees, ground texture layers, cloud banks. |
| [24-service-usage.md](24-service-usage.md) | Service usage numbers (`facilityUsage`), tier balance table, service models. |
| [25-tool-state.md](25-tool-state.md) | Tool state reducer and menu rules (`src/ui/tool-state.ts`). |
| [26-roads-cycle1.md](26-roads-cycle1.md) | Roads cycle 1: single road profile table, junction surfaces, tapers, one-way, 3+3 highway, ramps, interchange, road tool. |
| [junction-gate.md](junction-gate.md) | Junction and road quality gate G1-G5 (headless `src/sim/showcase-gate.test.ts`). |
| [look-target.md](look-target.md) | Visual look target (P1-C/P1-D). |
| `process.json`, `05-phases.json`, `04-regras.json` | Machine-readable phase and rule data used by the docs above. |
