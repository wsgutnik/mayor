# UI V2 plan (from the 2026 UI/UX audit, checked against the code)

Source: an external audit comparing Mayor with Cities: Skylines II. The audit was written from the repository and
documentation without running the game; this file records what was checked against `main` and what is planned.

## Verified against the code

| Audit claim | Check |
|---|---|
| Services panel is dense | True: `SERVICE_ROWS` + `CIVIC_ROWS` + traffic + land value in one panel (`hud.ts`). |
| Left panels cannot be collapsed | **Partly false**: the Services panel already collapses (`hud.ts`, `svc-head toggle`); indicators and the rest of the stack do not. |
| No UI scale or transparency | True: `Prefs` has `lang, quality, tips, autosave, dayNight, zoning` only. |
| No Undo/Redo | True: no command history in `main.ts` or `sim.ts`. Needs a command log compatible with the deterministic sim (UI-2). |
| Road preview lacks detail | Partly: `planRoad` already returns validity and cost; length, slope and block reasons are not surfaced. |
| iPad uses the desktop composition | True: `touch.css` adjusts sizes only. |

## Cycles

| Cycle | Scope | Status |
|---|---|---|
| UI-1 | Scale and opacity prefs, collapsible and persistent panels with a "hide panels" toggle, informative road-build readout | In progress (Muse agents `ui-scale`, `ui-panels`, `ui-roadhud`) |
| UI-2 | Road Builder V2: configurable snapping, parallel roads, replace/upgrade, Undo/Redo via a command log | Planned; needs sim work |
| UI-3 | Zoning V2: fill / paint / marquee, densities, lot visualisation | Planned; needs sim work |
| UI-4 | Inspector diagnostics ("why is this building not growing"), economy dashboard, service/traffic alerts | Planned; numbers must come from the real simulation |
| UI-5 | iPad layout: bottom sheets, persistent build controls, compact/comfortable modes; onboarding, encyclopedia | Planned |
| UI-6 | Architectural themes, districts, colour customisation | Planned |

## Acceptance for UI-1

All current controls keep working; keyboard and touch preserved; text legible at every scale; nothing important blocks
building; saves and simulation untouched; tests green.
