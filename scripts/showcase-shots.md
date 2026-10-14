# Showcase screenshots (lead-run, built-in browser pane)

Captures the `docs/process/junction-gate.md` shot matrix with the stock dev
server and the browser pane. No extra dependencies: agents cannot run browsers
(AGENTS.md), so the lead drives and the critic scores the PNGs.

## 0. One-time setup

```bash
npm run dev          # http://localhost:5173
mkdir -p shots/junctions
```

`shots/` is local and out of git (like `screenshots/`).

## 1. Stage the showcase

Open `http://localhost:5173/?showcase=1` in the browser pane and wait for the
world to settle (one automatic pass: 12 cases on a fixed grid, camera on
`cross-street`, day light). Open devtools console; all driving is through:

```js
__showcase.list()              // 12 case names + "overview"
__showcase.go("tee")           // close-up preset (default zoom)
__showcase.go("tee", "game")   // game-zoom preset, same target
__showcase.setTod("day")       // low sun, 16.2 h
__showcase.setTod("night")     // 21 h
__showcase.stats()             // { cases, segments, nodes, rings, nonSimpleRings,
                               //   minFanArea, minFanAngleDeg, drawCalls, triangles }
```

## 2. Capture the required matrix (26 shots)

For each name in `__showcase.list()`:

1. `__showcase.go(name)` — wait ~1 s for shadows/atmosphere to settle.
2. `__showcase.setTod("day")` — wait ~1 s — capture the pane —
   save as `shots/junctions/<name>_close_day.png`
   (`overview_close_day.png` for the overview preset).
3. `__showcase.setTod("night")` — wait ~1 s — capture —
   save as `shots/junctions/<name>_close_night.png`.
4. Game zoom on demand: `__showcase.go(name, "game")`, capture day only,
   save as `shots/junctions/<name>_game_day.png` (required for every case
   with a major-or-worse issue, plus 4 random cases per round).

Paste-ready walker (prints each step; capture manually between steps, the pane
has no scripted capture):

```js
for (const n of __showcase.list()) {
  for (const tod of ["day", "night"]) {
    __showcase.go(n); __showcase.setTod(tod);
    console.log("CAPTURE", `${n}_close_${tod}.png`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}
```

Note: `tod` drifts slowly (full cycle 90 s at 1x). If a capture lags,
re-run `setTod` for that shot. Pause the sim first if traffic distracts
(the showcase stages no buildings, so no vehicles spawn).

## 3. Log file per shot

After each capture, copy one line into the sidecar
`shots/junctions/<same-basename>.json`:

```js
JSON.stringify({ shot: "<name>_close_day.png",
  stats: __showcase.stats(), consoleErrors: 0 })
```

`consoleErrors` is read from the devtools console (filter Errors): any error
fails the round. `drawCalls`/`triangles` come from `stats()` (WebGL counters
after a render; `-1` means "read before first render" — re-run `stats()`).

## 4. Sanity checks before handing to the critic

- 26 PNGs + 26 JSONs present; names match the matrix exactly.
- `nonSimpleRings` in any `stats()` output equals the pinned total in
  `docs/process/junction-gate.md` §5 (13 on 2026-10-13); anything higher is a
  regression, lower means the headless pins need updating first.
- Console shows zero errors for the whole session.
- Night shots are actually dark (tod 0.875): if a shot looks like day, the
  drift note in §2 applies — retake it.
