# 25 — Tool state machine and menu rules

Owner report: "there is an error with the return from choosing the road tool and the way back". The toolbar, the
flyouts and the map-tap handlers each kept their own copy of the selection (`hud.ts` `currentTool` / `roadType` /
`roadMode` / `roadLevel` / a DOM `aria-pressed` for Upgrade; `main.ts` `tool` / `roadType` / `roadMode` /
`roadLevel` / `upgradeMode` / `pendingInterchange` / `draft`), updated through five hooks in whatever order each
button called them. The "way back" (a second tap on Roads, Move and back, Roundabout, Interchange, a touch
long-press) left those copies disagreeing. Evidence and the list of defects are in
`/tmp/mayor-agents/fable-ui.report.md`; the screenshots are in `docs/img/menus/`.

## One state, one writer

`src/ui/tool-state.ts` is a pure reducer: `reduceTool(state, event) -> { state, fx }`.

| Field | Meaning |
|---|---|
| `tool` | the active `ToolId` |
| `roadType`, `roadMode` (`line` / `curve`), `roadLevel` (`ground` / `elevated` / `tunnel`) | the road selection |
| `upgradeMode` | Upgrade road toggle; taps on tarmac convert it instead of drafting |
| `pendingInterchange` | the next tap stamps a diamond interchange |
| `draft` | 0 / 1 / 2 road points placed (`main.ts` keeps the geometry; `ui.draft === draft.length` is asserted in DEV) |
| `lineStops` | stops picked for a transit line |
| `flyout` | the open flyout (`road` / `zones` / `services` / `transit` / `view`) or null |
| `zoneMode` | paint / marquee / fill |

Events: `tool`, `group`, `roadType`, `roadMode`, `roadLevel`, `cycleLevel`, `upgrade`, `interchange`,
`interchangeDone`, `zoneMode`, `mapDown`, `closeFlyouts`, `draftPoint`, `draftCommit`, `lineStop`, `cancel`,
`citySwapped`. Effects tell the host what to do with things the reducer does not own: `clearDraft` (preview, guides,
stop marks, readout, pills), `trimDraft` (curve -> line after the bend), `replan` (class / level changed under a
draft), `toolChanged` (inspector, ghosts, `tool:changed`), `upgradeOff` (hide the upgrade readout).

`main.ts` has exactly one writer, `dispatch(e)`: reduce, refresh the read-only mirrors, apply the effects, call
`hud.render(ui)`, restore the resting hint (`hintFor(ui)` -> `renderHint`). `hud.ts` only renders a `ToolState`
and emits events through `HudHooks.onEvent`.

Invariants (`checkToolState`, checked after every transition in tests and in DEV builds):

- a draft exists only with the road tool; two points only in curve mode;
- an armed interchange only with the road tool and no draft;
- line stops only with a line tool;
- the Roads flyout is open only with a road-group tool (road, roundabout); Zones only with a zoning tool.

## Rules the reducer encodes

1. **Picking keeps the work.** A road class, draw mode or level pick keeps the draft and re-plans it (curve -> line
   trims the bend). Opening Roads mid-draft keeps the draft. Only a different tool, Escape / Finish / a long-press,
   Interchange, or a city swap (load, new, undo, redo) drops it, and each of those drops it exactly once.
2. **Flyouts.** Choosing a tool or a road / zone selection closes the flyout; the option groups (Snap, Parallel,
   Upgrade) keep it open; any pointer-down on the map closes it. Opening Roads arms the road tool (the roundabout
   stays if it was active); opening Zones takes Residential unless a zoning tool is already active.
3. **Highlights follow the tool.** Roads stays lit for Roundabout; Interchange and Upgrade are shown pressed and in
   the flyout summary ("Avenue · Curve · Ground · $45/tile · Upgrade road").
4. **Hints come from the state**, never from button order: `hintFor` returns the resting hint; hover previews
   overwrite it until the next event.
5. **Touch long-press** (450 ms still on the anchor) cancels; the release that follows is swallowed, so it can never
   restart the draft (previously a 450-499 ms press cancelled and restarted in the same gesture).

## Menus (Task 2)

- Roads: header with the live summary; sections Type | Draw | Level | Tools (Roundabout, Interchange, Upgrade) |
  Snap | Parallel. Docked above the toolbar, at most 40 % of the screen (body scrolls), every control >= 44 px
  (`--ui-min-touch`). Road type tooltips: cost and upkeep per tile, lanes, capacity (`ROAD_CAPACITY`), width;
  one source in `src/ui/road-facts.ts`.
- Services: five titled groups with icons, two columns; each button shows cost and a 1×1 / 2×2 badge; the tooltip
  shows upkeep, capacity or radius and the `facilityUsage` estimate; greyed when the balance cannot pay or a second
  city hall is attempted (`src/ui/tool-availability.ts`), with the reason in the tooltip and as a toast on tap.
  Mayor has no unlock tree, so there is no "not unlocked" state; "no road nearby" depends on the spot and stays a
  placement refusal (hover ghost + hint).
- Zones: Zone | Shape. Transit: Stops | Lines with footprint badges. Tooltips also follow keyboard focus.
