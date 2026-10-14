# P2-B info views v2 + P3-B UI patterns (gm)

Design note for the port of `docs/process/10-fable-render-port.md` §2.7 (P2-B, P3-B).
Sources: fable-cities MIT (`src/modules/simulation/infoview.js`,
`src/modules/roads/RoadMaterials.js` info texture, `src/modules/ui/{toasts,onboarding,tooltip,infoview}.js`).
Ported files carry the MIT header; NOTICE.md already has the fable-cities entry.

## P2-B: coverage field + traffic road tint

- `src/sim/coverage-field.ts` (pure): `buildCoverageField(world, bit, out?)` bakes one RGBA
  texel per tile — R served strength (chamfer distance to the nearest uncovered tile over
  `STRENGTH_RAMP_TILES = 3`), G signed boundary distance (`0.5 + sd / 2·SD_RANGE`, `SD_RANGE = 30`
  tiles = Fable's 240 m ÷ 8), B developed mask (land AND zoned/built/facility/road). Returns rings
  (one per facility of the bit, bus stops for transit, capped at `MAX_RINGS = 48`), the uncapped
  facility count, developed count and served fraction for the legend. `out` reuses the caller
  buffer; the two chamfer passes allocate per rebuild (revision-gated, never per frame).
- `src/render/coverage-overlay.ts`: one `DataTexture` + `ShaderMaterial` (three-stop ramp
  crimson → amber → service, hatched gaps, AA rings + glow) on a mesh that **shares the terrain
  geometry** (second draw, +0.05 lift, polygonOffset −2, renderOrder 5). Tile conversions from
  Fable metres: hatch `fract((x+z)·0.44)` (0.055·8), ring width `fwidth·1.8 + 0.2` (1.6 m ÷ 8),
  glow `exp(−d·0.36)` (0.045·8). Colours use `THREE.Color` without Fable's extra
  `convertSRGBToLinear()` (double-converts under ColorManagement); the fragment ends in the
  tone-mapping + output-colour chunks so the overlay matches the ACES pipeline. Rings fade by
  `ringWeight` (camera distance/target), refreshed every 4 frames, skipped on unchanged keys.
- `src/render/traffic-tint.ts` + `road-material.ts`: R8 load-ratio texture (`trafficByte` =
  `clamp(load/capacity)`, unitless), sampled at world xz in the road fragment when `uTrafficOn`
  and `vRoadClass > 0.5` (kerbs untinted). Refreshed every 10 frames (9 KB upload); the old
  ~2000-instance rebuild every 10 frames (F11) is gone. Program cache key bumped to
  `road-atlas-v2`.
- `scene.ts` hook (minimal): `syncInfoViews()` in `setOverlay`/`setWorld`, coverage/traffic
  branches in `rebuildOverlay` (land value keeps the instanced path), texture refresh + ring
  update in the loop, `renderer.infoViews` debug getter, night dim in `setAtmosphere`.

Invariants (tests): served/edge/gap/undeveloped texels, 128-crossing at the boundary, ring cap
+ anchor dedupe, `buildCoverageField` 0.6 ms at 96² (target < 2 ms), traffic byte clamp,
  shader string checks (conversions, chunks, uniforms), texture upload without reallocation.

## P3-B: toasts + bell, onboarding, tooltip, legend

- `src/ui/events.ts`: `cityEvents` bus (`roads:changed`, `zones:changed`, `time:speed`,
  `building:added`, `tool:changed`). main.ts emits at commitRoad, strokeEnd, doZoneFill,
  roundabout/upgrade, onSpeed, onTool, and population growth in frame().
- `src/ui/toasts.ts`: DOM-free `ToastQueue` (3 visible, life by tone info 6 / success 5 /
  warning 8 / error 9 / milestone 8 s, log cap 40, unread badge) + `ToastsView` (stack, top-bar
  bell, centre dropdown). `Hud.showToast` stays as the compat wrapper; `Hud.notify` adds tones.
- `src/ui/onboarding.ts`: DOM-free `OnboardingModel` (road → zone → speed → grow; baselines at
  start because Mayor pre-builds an entry road; completion only via `check()`, no timers;
  session dismissal) + `OnboardingCard` (left-stack card, pointer ring at ~8 Hz, 11 s closing
  card). Starts on first `Hud.update` with state; `onCitySwapped` re-seeds.
- `src/ui/tooltip.ts`: shared rich tooltip (`placeTooltip` pure: above/lifted/below, clamped,
  arrow tracking), 320 ms hover (40 ms re-hover), iPad long-press, `suspend()` while the menu
  is open. Attached to every toolbar tool (title/desc/cost) and group button.
- `src/ui/legend.ts`: pure `legendFor(layer, state)` (titles/descs/stops, city-average marker,
  rows from live numbers only: Facilities + coverage, utility Capacity/Demand/Supply, traffic
  Vehicles/Congestion inverted, land-value Happiness) + `LegendView` docked in the left stack,
  sig-gated refresh. No categorical chips (Mayor has no zoning infoview).
- Strings only via `src/i18n.ts` (pt-BR default, en passthrough); `hasTranslation` backs the
  key-coverage tests (`strings.test.ts`, legend key sweep).

## Visual checklist for the lead (not run here — no browser in the sandbox)

Police coverage with a gap district (hatched crimson, amber edge, whisper + white ring),
traffic view green→red on roads only, night dim, bell badge + centre, guide card + ring on a
fresh city, tooltip above an open flyout, legend avg marker. Console snippets in gm.report.md.
