# Fable Cities study, part 2: vehicles, materials and rendering for Mayor

Read-only study, 2026-10-13. Neither repository was edited.

- **Source.** `/tmp/gh-refs/fable-cities`, github.com/rawprogress/fable-cities @ `aea8b10`. MIT, "Copyright (c) 2026 raw
  (github.com/rawprogress)". JavaScript, three r185, units are **metres**.
- **Target.** Mayor at `/Volumes/T7/07-Projects/clones`. TypeScript, three 0.186.1, units are **tiles** (1 tile = 8 m).
- **Companion.** `docs/process/08-fable-cities-port.md` (part 1) already covers junctions, markings, the lane graph and
  the critique loop. This report does not repeat that material. It covers vehicles, materials, lighting, post-processing,
  info views, UI patterns and night lighting.

## Files read

Fable, read in full:
- `traffic/VehicleModels.js`, `traffic/materials.js`, `traffic/Renderer.js`
- the IDM, curve-speed, brake and blink parts of `traffic/TrafficSim.js` and `LaneNetwork.js`
- `shared/quality.js`
- `docs/MATERIAL_TARGET.md`, `docs/LOOK_TARGET.md`
- `docs/critique/traffic_p5.json`, `docs/critique/effects_p5.json`
- `public/assets/CREDITS.md`, `public/assets/shared/MANIFEST.md`

Fable, read where relevant:
- `core/Engine.js` (renderer, CSM, GTAO, bloom, SMAA, shadow tuning) and `core/Config.js` (quality presets)
- `environment/{index,atmosphere,EnvProbe,MaterialHook,SkyDome}.js`
- `roads/RoadMaterials.js` (material table, wetness, analytic lamp pools, info texture)
- `props/{PropRenderer,PropAssets}.js` (light pool, halo, contact decal, point-light pool)
- `effects/{index,WetSurfaces}.js`, `terrain/Water.js` (header), `perfguard/guard.js`
- `simulation/infoview.js`, `ui/{infoview,tooltip,onboarding,toasts}.js`, `traffic/PedestrianModel.js`, `traffic/Geometry.js`

Mayor:
- `AGENTS.md` rule 11, `.claude/skills/mayor-visual-quality/SKILL.md`, `docs/process/08-fable-cities-port.md`,
  `docs/UI-V2-PLAN.md`
- `src/render/scene.ts`: vehicles, atmosphere, shadows, overlay, quality, lamps
- `src/render/{kit-materials,glb-models,fleet,road-material}.ts`, the `roads.ts` lifts, `src/sim/traffic.ts`, `src/prefs.ts`
- `blender/props_fleet_vehicles.py`, `public/models/patterns.json`
- the GLB headers of the fleet (`public/models/props/*.glb`), `third_party/README.md`

Measured. Triangle counts of Fable's procedural vehicles came from running a copy of `Geometry.js`, `VehicleModels.js` and
`PedestrianModel.js` in the scratchpad (stock three). Mayor's GLB material and triangle counts came from parsing the GLB
JSON chunks.

---

## 0. Executive findings (Mayor defects this study surfaced)

All of these come from reading code. **F3 still needs a look in the browser** before anyone fixes it.

| # | Finding | Where | Effect |
|---|---|---|---|
| F1 | `updateVehicles` tints vehicles with `setColorAt`. Instance colour multiplies **every** material of the InstancedMesh, so glass, tyres, rims and lamps take the body colour. A red car gets red windows. This is the defect Fable's critic measured as "rear glass RGB(18,63,110) vs paint RGB(21,56,91)" | `scene.ts:1191-1203` | wrong-coloured glass, tyres and lamps on every car |
| F2 | `glass_dark` maps to the **building window texture** (`patterns.json: glass_dark → ['window', None, '#3d5a82']`). Car windscreens show office-window grids | `public/models/patterns.json`, `kit-materials.ts:91` | texture on car glass |
| F3 | `kitMaterial` rebuilds every patterned material as `MeshStandardMaterial` with no `emissive`. It sets an emissive colour only for `glow_window`, and `scene.ts:398` sets one only for the lamp prop. `glow_head`, `glow_tail` and `glow_sign` keep a black emissive, so raising `emissiveIntensity` at night does nothing. **Headlights and tail lights are dark at night** | `kit-materials.ts:94-104`, `scene.ts:461-465` | no vehicle lights at night |
| F4 | Each fleet GLB has **9 to 11 material groups**: `car_sedan` = black, metal_dark, car_body, glass_dark, white, glow_head, glow_tail, tire, rim. There are ~33 distinct looks, so a busy view issues ~330 vehicle draw calls, and up to 330 more in the shadow pass (`markShadows` makes every InstancedMesh cast) | `scene.ts:304-311`, `1313` | iPad draw-call budget |
| F5 | `updateVehicles` allocates on every frame: a `new THREE.Color`, the `CAR` array literal, a `new Map`, two closures and one object per vehicle from `heading()`. `setAtmosphere` also runs every frame (`main.ts:826`) and allocates about six `Color`s | `scene.ts:1181-1250`, `1141-1174` | breaks AGENTS rule 4 |
| F6 | `PCFSoftShadowMap` was **removed** in three 0.186. It logs a warning and falls back to `PCFShadowMap` (`node_modules/three/src/renderers/webgl/WebGLShadowMap.js:99-102`). With PCF, `shadow.radius` is the only softness control, and Mayor never sets it | `scene.ts:249` | console warning, no softness control |
| F7 | `shadow.normalBias = 0.03` tile is a constant, but the shadow frustum span ranges from 8 to 60 tiles (`scene.ts:1695`). Close up, the bias is ~3 texels and peter-pans car shadows by about 0.24 m. Zoomed out it is ~0.5 texel, which gives acne | `scene.ts:252-253` | detached or acned shadows |
| F8 | Vehicles have no pitch, so they stay level on bridge ramps and hills and their noses clip into the ramp. The lift `baseY + 0.07` is hard-coded; `ROAD_LIFT` is 0.06 and the GLB minimum y is 0.002, so cars float about 1 cm of tile (~10 cm) | `scene.ts:1195`, `roads.ts:14` | floating or clipping vehicles |
| F9 | The road shader multiplies albedo by `0.30 + 0.70·uDayFactor` **on top of** the lighting falloff, so night roads are darkened twice. Wet roads use roughness 0.32 and albedo ×0.82. There is no environment map anywhere (no `scene.environment`, no PMREM), so low roughness has nothing to reflect | `road-material.ts:243-256` | flat, matte wet roads; night double-dimmed |
| F10 | `adaptResolution` uses an EMA with fixed 26 ms / 14 ms thresholds and recovers after 6 s of fast frames, with no hitch rejection and no step limit. It can oscillate | `scene.ts:1492-1508` | pixel-ratio flapping on iPad |
| F11 | The coverage info view draws one instanced box per **covered** tile in a flat colour at 50 % opacity. It paints served land loudly and does not show the gaps, which are the information the player needs. The traffic view rebuilds ~2000 instance matrices every 10 frames | `scene.ts:1365-1411`, `1691` | weak info views; CPU cost |

---

## 1. Units and frames (apply to every number below)

| Item | Fable | Mayor | Conversion |
|---|---|---|---|
| Length | m | tile (8 m) | ÷ 8 |
| **Vehicle size** | sedan 4.62 m | `car_sedan` 0.405 tile = 3.24 m | Mayor vehicles are **0.70×** real size. Scale every vehicle-relative length (gaps, S0, decal sizes, lamp offsets) by 0.70/8 = **0.0875 tile per metre** |
| **Time** | real seconds | game seconds, compressed | `ROAD_SPEED` 3, 4.5 and 7 tiles/s stand for 50, 60 and 110 km/h, which is 1.74, 2.08 and 3.82 tiles/s, giving c = 1.73, 2.16 and 1.83. Use **c = 1.8** throughout |
| Acceleration | m/s² | tile/s² | × c²/8 = **× 0.405** |
| Time constants (headway) | s | s | ÷ c = **× 0.556** |
| Vehicle forward axis | +Z (`VehicleModels.js` header) | **+X** (`fleet.test.ts`, `props_fleet_vehicles.py`) | rotate −90° about Y when porting geometry |
| Colour space | `lin(hex)`: sRGB hex to linear | `THREE.Color.set` also converts to linear (ColorManagement on) | hex values port verbatim |
| Tone mapping | **AgX**, exposure 1.37 (day) to 3.15 (night) | **ACES**, exposure 0.85 to 1.05 | absolute emissive and exposure numbers do **not** carry over. Port the ratios and the "divide by exposure" rule, then retune against screenshots |
| Wall clock vs game clock | one clock | `tickTraffic` gets `dt × speed` | blink period, brake-lamp smoothing and glare fades must use **wall-clock** dt, or the indicators strobe at 4× game speed |

---

## 2. Function-level port list

### 2.1 Vehicles: surface classes and a single material (the core idea)

Fable puts a whole vehicle in **one geometry**. Glass, paint, chrome, rubber and lamp are chosen per vertex through `aClass`,
which the fragment shader reads as a `flat` varying, so a triangle is never half glass and half paint. Body colours come
in as per-instance attributes, so the whole fleet is one InstancedMesh per type and LOD.

| Fable | Mayor target | Port notes |
|---|---|---|
| `Geometry.js` vertex contract: `color`, `aSurf=(paintMask, paint2Mask, metal, rough)`, `aLight` (0 none, 1 head, 2 tail, 3 brake, 4 bus ceiling, 5/6 indicator L/R, 7 cabin, 10 lit glazing), `aClass` (0 generic, 1 paint, 2 glass, 3 bus glass, 4 chrome, 5 rubber, 6 lens) | **new** `src/render/vehicle-surface.ts` → `bakeVehicleSurface(model: LoadedModel, classOf: (matName) => SurfaceSpec): THREE.BufferGeometry` | Run after `mergeScene`. Per group, write `aClass`, `aLight` and `aSurf`; bake the pattern hex × the existing AO vertex colour into `color`; then `clearGroups()` and use **one** material. Material names map to classes: `car_body`→paint, `car_body2`→paint2 (new), `glass_dark`/`car_glass`→glass, `rim`/`metal`→chrome, `tire`/`black`→rubber, `glow_head`→lens/light 1, `glow_tail`→lens/light 2, `glow_sign`→light 7, `metal_dark`/`white`→generic with pattern roughness. This fixes F1, F2 and F4 and drops ~330 draws to ~33 |
| `materials.js` `patchSurface` + `SURFACE_FRAG` + `RESPONSE_FRAG` + `EMISSIVE_FRAG` + `createVehicleMaterial` | **new** `src/render/vehicle-material.ts` → `createVehicleMaterial(): THREE.MeshStandardMaterial` + `vehicleUniforms = { uLampExposure, uEnvComp }` | Use **MeshStandardMaterial** (no clearcoat on iPad; see §4). Keep the `flat varying float vCls` trick. Glass is pinned to linear albedo (0.0105, 0.0125, 0.0155) = sRGB `#1a1d21`, roughness 0.06, metal 0. Paint is roughness 0.30, metal 0, with the road-film term `film = smoothstep(0.62, 0.14, y_m)` → in Mayor local y: `smoothstep(0.054, 0.012, y)` (×0.0875), albedo ×`mix(1, 0.74, film·0.72)`. Chrome 0.15/1.0, rubber 0.90, lens 0.10. **Cap `envBoost` at 1.3**: Fable's 1.85 × `uEnvComp` 1.92 clipped glass to white blobs (`traffic_p5.json` specularVerdict) |
| `EMISSIVE_FRAG` lamp formulas (display units ÷ exposure) | same file | `ex = 1/max(0.45, exposure)`. Head (1, .955, .87)·(night·3.15 + 0.085). Tail (1, .055, .022)·(night·0.130 + brake·(0.210 + 0.320·night)). Brake-only (1, .07, .028)·(brake·(0.225 + 0.35·night) + 0.035·night). Indicator (1, .40, .03)·max(0, ±blink)·(0.34 + 0.55·night). Cabin (1, .74, .46)·night·0.22. Bus glazing (1, .80, .56)·night·0.17. **Starting values under ACES; retune from night screenshots.** Keep lens albedo dark (tail `#520a07`, brake `#5c0c08`, indicator `#6a3c08`): a bright red base plus emission clips to salmon. This fixes F3 |
| `Renderer.js` `instAttr` (`InstancedBufferAttribute`, `DynamicDrawUsage`) for `aPaint`, `aPaint2`, `aState=(lightsOn, brake, blink)` | `scene.ts` `updateVehicles` (rewrite) | Replaces `setColorAt`. Body colour goes to `aPaint`. Bus `aPaint2` = line colour (livery band); body = white or the `BOX_COLOURS` entry |
| `PAINT_COLOURS` (weighted, 62 % neutrals) + `weightedTable` (256-entry Uint8 lookup) + `BOX_COLOURS` | **new** `src/render/vehicle-palette.ts` (`paintOf(seed)`, `boxOf(seed)`) | Hex values port verbatim. Replaces `CAR` in `scene.ts:1186`, whose pastel `#e0b43a` and `#58a86a` are the "1950s pastel" set Fable's critic rejected. Precompute linear RGB once |
| `Renderer.sync` density LOD (`d>245 && id&1`, `d>400 && id&3`) | `updateVehicles` | Stable per-id thinning; never use a frame counter. Map to Mayor: thin by `lodDist` multiples (`> 1.0·lodDist` keep `id&1==0`, `> 1.6·lodDist` keep `id&3==0`) |
| `Renderer.sync` matrix: `_e.set(pitch, yaw, 0, 'YXZ')`, `_sc = (sw, sh, sl)` jitter | `updateVehicles` | Add **pitch** from heights sampled at the front and rear axle (`heightAt`/`deckH` at ±0.4·len), clamped to ±0.5 rad. Size jitter `sl = 1 ± 0.0275`, `sw = 1 ± 0.020`, `sh = 1 ± 0.0225` from the id hash (zero cost). This fixes F8 (pitch). Lift = `ROAD_LIFT` + 0.001, not 0.07 |
| `buildShadowProxyGeometry` (24-tri two-box silhouette, ×1.06 width, +12 % height), `proxyMat` (`colorWrite:false, depthWrite:false`), `mesh.instanceMatrix = far.instanceMatrix` | `vehicle-surface.ts` → `shadowProxy(geom)` + scene wiring | One proxy InstancedMesh per look **shares** the body's `instanceMatrix`. Body `castShadow=false`, proxy `castShadow=true`. Shadow pass cost: 33 × 24-tri draws instead of 330 multi-group draws |
| `VehicleModels.js` `carShell` / `carCanopy` / `carDetails` / `vanShell` / `truckShell` / `busShell` (lofted procedural shells) | **not a code port.** Port the **style rules** into `blender/dress_vehicles2.py` / `props_fleet_vehicles.py` | Measured: Fable LOD0 is 1156–2036 tris + 4 × 436-tri wheels; LOD1 is 604–836 tris. Mayor budgets are 1100 (car) and 1500 (truck, bus), and the current models are 314–461. Port the shape rules (circular arch `y = sill + (archTop−sill)·√(1−d²)` with `archR = 1.34·wheelR`, `archTop = 2.12·wheelR`; plan taper `hw·(1 − 0.115·tf² − 0.095·tr²)`; greenhouse taper 0.955 → 0.795; raked A/C pillars `zA = roofF + (wsBase−roofF)(1−t)·0.62`; B-pillar 0.055 wide; shut lines at `doorCuts`; dark cabin box with night glow; bus livery band `floor + 0.12 … winLo − 0.16`; bus saloon interior and ceiling strip) and the **material names** (`car_body2`, `glass`, `chrome`, `plate`, `lamp_brake`, `lamp_ind_l`, `lamp_ind_r`, `cabin`). Use `VEHICLE_SPECS` proportions × 0.0875 |
| `buildWheelGeometry` LOD0 (alloy, 436 tris) / `bakeWheels` | **skip** at game zoom; keep baked wheels | Spinning and steering wheels cost 4 instances per car and are invisible at Mayor's zoom. Fable itself turns off wheel shadows |
| `lampOffsets(spec)` | `vehicle-surface.ts` → `lampAnchors(geom)` | Derive from the `aLight` 1/2 vertex centroids at bake time (per look), rather than from a spec. Robust to Blender edits |

### 2.2 Vehicles: grounding and night passes (one draw each)

| Fable | Mayor target | Port notes (Mayor units) |
|---|---|---|
| `createContactShadowMaterial` (multiply blend `ZeroFactor/SrcColorFactor`, rounded-rect SDF, `a·(0.30 + 0.70a)`, clamp 0.96, polygonOffset −6/−6) + `sync` placement | **new** `src/render/vehicle-fx.ts` → `ContactShadows` | Quad = 1.70 × width, 1.26 × length. Darkness 0.95 (cars), 0.80 (peds). Sun lean `min(0.55, horiz/max(0.08, −y)·0.16) × width`. Fade over [1.0, 1.5]·`lodDist`. **Must** take the vehicle's pitch and sit at `ROAD_LIFT + 0.002` on the deck or ramp height (rule 11: "floating decals" are defects). **This is the iPad win: the low tier has `shadow: 0`, and this decal is the only grounding** |
| `createBeamMaterial` (headlight cone `w = mix(0.26, 1, v)`, `pow(1−v, 1.15)`; tail ellipse `pow(1−r, 2.4)`), additive, `depthWrite:false` | `vehicle-fx.ts` → `HeadlightPools` | Head pool: wide 0.23 + 1.1·w, long 1.14 + 1.4·L (tiles, vehicle-scaled). Intensity `lightsOn·0.150·fade/max(0.6, exposure)`, colour (1, .86, .66). Tail wash: wide 0.12 + 1.0·w, long 0.30 + 0.55·L, intensity `lightsOn·(0.30 + 0.85·brake)·0.17`, colour (1, .065, .03). Cap 2 × `MAX_VEHICLES` = 520. Sort by distance only when the cap binds (no per-frame sort allocation: reuse a typed index array) |
| `createGlareMaterial` (camera-facing additive point, `pow(1−d, 2.6) + 0.55·pow(max(0, 1−3.2d), 3)`) | `vehicle-fx.ts` → `LampGlare` | `facing = dot(fwd, toCam)` gates head versus tail. **Size must be screen-relative**: Fable's 0.34 m (0.03 tile) is sub-pixel at Mayor zoom, so use `size = max(0.03, 0.004·camDist)` tiles. This replaces bloom on iPad |
| `traffic/TrafficSim.js` brake and blink state | `src/sim/traffic.ts` `Vehicle` (+`brake`, `blink`, `accel` render-only fields, **not saved**) | `brakeT = clamp(−a/1.05, 0, 1)` (2.6 m/s² × 0.405). Hold 0.9 when `v < 0.135` tile/s and (at a red light or gap < 0.79 tile). Smoothing `brake += (t − brake)·min(1, dt_wall·9)`. Indicator from the turn sign at the next node (cross product of tile directions i→i+1 and i+1→i+2), on within 2 tiles of the node, `((t_wall + seed) % 0.94) < 0.52` |

### 2.3 Car following (IDM) on today's tile model

The lane-graph version is 08 §2 / P7. This is the drop-in for `src/sim/traffic.ts` before that lands.

| Fable constant (`TrafficSim.js`, `LaneNetwork.js`) | Value | Mayor value | Derivation |
|---|---|---|---|
| `A_MAX` | 2.85 m/s² | **1.15 tile/s²** | ×0.405 |
| `B_COMF` | 3.30 m/s² | **1.34 tile/s²** | ×0.405 |
| `S0` (standstill gap) | 2.05 m | **0.18 tile** | ×0.0875 (vehicle-relative) |
| `T_HEAD` | 1.05 s | **0.58 s** | ÷1.8 |
| `DEC_MAX` | −7.6 m/s² | **−3.08 tile/s²** | ×0.405 |
| δ (free-road exponent) | 4 | 4 | — |
| gap floor in `idmAccel` | 0.4 m | 0.035 tile | ×0.0875 |
| `LAT_ACC` (curve limit `v = √(a_lat/κ)`) | 3.4 m/s² | **1.38 tile/s²** | ×0.405 → kerb return R = 0.45 tile gives 0.79 tile/s = 26 % of street v0 |
| min curve speed | 2.6 m/s | 0.585 tile/s | ÷8 × c |
| entry-speed braking `√(v² + 2·2.0·d)` | 2.0 m/s² | 0.81 | ×0.405 |
| backward vmax pass | 1.6 m/s² | 0.65 | ×0.405 |
| driver factor `vf` | 0.86 + 0.24·rng | same | unitless |
| spawn clearance | half + half + 3.5 m | half + half + 0.31 tile | ×0.0875 |
| stop line before the junction | `remain − 0.7` m | `remain − 0.06` tile | ×0.0875 |
| vehicle half-lengths | spec | car 0.20, truck 0.30, bus 0.40 tile | from GLB bbox |

Mapped functions:

- `idmAccel(v, v0, gap, dv, aMax)`: **new** pure `src/sim/idm.ts`, verbatim with Mayor constants.
- `polyAt`/`makePoly` vmax: `routePath` already gives per-tile points. Add `vmaxAt(pts)` from the discrete curvature
  `κ = 2·sin(θ/2)/|seg|`, plus the backward pass.
- `_leader`: per-tile head array `Int32Array(size²)` plus `nextInTile: Int32Array(MAX_VEHICLES)`, rebuilt each tick, so
  there is no allocation. The leader is the nearest vehicle ahead on the same tile with the same next tile. Otherwise it
  is the minimum-progress vehicle on the next tile whose next tile is not ours (not oncoming).
- Signals: replace `RED_CRAWL` with a virtual stopped leader at the stop line (`idmAccel(v, v0, stop, v)`).
- **Sub-step to ≤ 0.1 s.** `tickTraffic` gets up to 0.25 s × game speed; explicit Euler at dt > T is unstable.
- Keep `load` and `ROAD_CAPACITY` for pathing and as an upper bound `v0·f` on speed, so gameplay balance holds.
- `congestion` = fraction of vehicles with `v < 0.6·v0`, the same meaning as today's `speedFactor < 0.6`.

### 2.4 Materials and environment

| Fable | Mayor target | Port notes |
|---|---|---|
| `MATERIAL_TARGET.md` table | **new** `src/render/material-targets.ts` (one const table, one source of truth) + a test | Vehicle paint 0.30/0, glass 0.06, chrome 0.15/1.0, tyre 0.90, lens 0.10, dry asphalt **0.65** (Mayor 0.9), wet asphalt **0.18** + albedo **×0.76** (Mayor 0.32 / ×0.82), markings 0.55, kerb and sidewalk 0.80, setts 0.70 (wet 0.26–0.30), brick and plaster 0.88, roof tiles 0.78, lamp pole 0.40/0.85, water 0.04, foliage 0.70, grass 0.85, soil 0.95 |
| `RoadMaterials.js` `GLSL_ROUGH` (roughness map ÷ its own mean `rmean`, clamped to [0.62, 1.42]) | `road-material.ts` (only if roughness maps are added) | Without this, a map with mean 0.52 **replaces** the authored 0.85 base. Applies to every PBR set in §5 |
| `GLSL_WET_ROUGH` (`roughness = mix(r, wetRough, uWetness·wet)`; albedo ×`mix(1, wetAlb, ·)`) | `road-material.ts` | Replace the 0.32/0.82 constants with the per-class table above. **Drop** the `0.30 + 0.70·uDayFactor` albedo hack (F9); night darkness comes from lighting |
| `EnvProbe` (PMREM of the live sky, 512 px, refreshed on time jumps) | **new** `src/render/environment.ts` | **iPad path:** load the CC0 HDRI `kloofendal_48d_partly_cloudy_puresky_1k.hdr` (1.4 MB) **once**, run `PMREMGenerator.fromEquirectangular` once, then `scene.environment = tex` and `scene.environmentIntensity = 0.15 + 0.85·day` (moonlit 0.08). No per-hour regeneration. Only Standard materials (vehicles, roads, kit) pick it up; the Lambert buildings stay cheap. Optional later: a 3-colour gradient-sky PMREM at 128 px, rebuilt per 1/48-day bucket (measure on iPad first) |
| `materials.js` `uEnvComp = min(2.2, 1/envIntensity)` | `vehicle-material.ts` | Only if `environmentIntensity < 1`. Cap at 1.5 in Mayor |
| `PropAssets.nightLit` (`totalEmissiveRadiance += albedo·uNight·0.085`) | scene tree, hedge and lawn materials | A night floor so foliage under lamps is not a black cutout. One `onBeforeCompile` line, no lights |
| `Water.js` (MeshPhysical, roughness 0.04, ior 1.333, planar reflection, five normal octaves, glitter) | `water.ts` (custom shader) | **Port only the targets**: LOOK_TARGET water Y 0.081 / C 0.028 (Fable started 3.7× too bright). Darken the base colour and get brightness from the sky term. Skip planar reflection and extra octaves |

### 2.5 Lighting, shadows, tone, post

| Fable | Mayor target | Port notes |
|---|---|---|
| `Engine._applyCascadeShadow` (bias from the texel footprint) | `scene.ts` render loop where `span` changes (`1695-1702`) → pure `shadowBias(span, mapSize, near, far)` in **new** `src/render/shadow-tuning.ts` | `texel = 2·span/mapSize`. `normalBias = min(0.11, texel·1.9)` (0.9 m cap ÷ 8). `bias = −(0.005 + texel·0.55)/(far − near)`. `radius = clamp(0.0625/texel, 1.15, 4.2)` (0.5 m penumbra ÷ 8). Set `renderer.shadowMap.type = THREE.PCFShadowMap` explicitly (F6, F7) |
| `environment/index.js` key and fill constants | `scene.ts` `setAtmosphere` (rewrite as a pure `atmosphereAt(tod, raining) → {sunCol, sunI, hemiSky, hemiGround, hemiI, exposure, fogCol, night}` in **new** `src/render/atmosphere.ts`, plus a non-allocating apply) | Warm key `KEY_WARM` (1, .935, .80) = `#fff8e7`, lerped 55 % below 46° elevation. Low sun lerps to (1, .55, .25) = `#ffc489`. Cool fill: golden-hour sky `#aabce5`, twilight `#a2b6ed`, ground bounce `COOL_BOUNCE` `#cedaf6` at golden hour and night. Moon `#ceddff`. **Cut the hemisphere hard**: Mayor's key:fill is 1.8 : 1.35 (white sky), while LOOK_TARGET wants a ground shadow-depth ratio near 19 : 1 (Fable started at 4.4). Start at sun 2.6 / hemi 0.55 by day and tune with the measuring tool. `nightFactor = 1 − smoothstep(−1°, 3°, elev)` drives every light-on switch (lamps, vehicle `lightsOn`, glow). Keep night ambient monotonic: the dusk floor must never drop below the midnight level (Fable r0 critic) |
| `exposureForSun` key table (AgX) | `atmosphere.ts` | Port the **shape** (exposure rises through civil twilight so ground luminance stays monotonic; +0.5 EV in golden hour), not the AgX values. Mayor range today is 0.85–1.05 |
| `docs/LOOK_TARGET.md` + `tools/lookmeasure.py` | **new** `tools/lookmeasure.py` (adapted, run on Mayor screenshots) + `docs/process/09-look-target.md` | Targets measured from CS2: black floor `lum_p10` 0.010; OKLab L mean 0.44; shadow depth 19.5; vegetation Y 0.056 / C 0.053 / hue 74°; water 0.081 / C 0.028; buildings 0.177 / C 0.036 / hue 41°; sky 0.268 / hue 214°; asphalt 0.058 / C 0.008; haze far ÷ near 2.15; shadow coolness (B−R)/Y +0.45 … +2.0. Beauty shots at sun elevation 22–34°, never noon. **Do not globally desaturate**: chroma at matched lightness was already on target, and the fault was lightness |
| `quality.js` `classifyGPU` / `recommendQuality` | `src/prefs.ts` default quality | Optional. Mayor's touch-without-hover check → low, the same rule Fable uses |
| `perfguard/guard.js` (median of a 2 s window, spikes > 400 ms dropped, debt with 45/55 fps dead band, 4 s sustain, 8 s cooldown, 6 s warm-up, max 2 steps) | **new** `src/render/perf-guard.ts`, driving `adaptResolution` | Pure state machine `sample(now, frameMs) → 'down' / 'up' / null`. Fixes F10. Steps are pixel ratio −0.25, then tier; never more than 2 automatic steps; only recover after 20 s above 58 fps |

### 2.6 Night street lighting (no real lights)

| Fable | Mayor target | Port notes |
|---|---|---|
| `PropAssets` `lightpool` material: **MAX blend** (`blendEquation: MaxEquation`), strength in `color`, polygonOffset −3 | **new** `src/render/street-light.ts` → `LightPools` (one InstancedMesh, one per lamp in `lampMesh`) | MAX, not additive: a row of overlapping pools never exceeds one lamp. Fable's additive version blew the pavement to Y 0.35 against CS2's 0.059. Pool radius = Fable street 11 m (`STREET_LAMP(3.8, 11.0)`) → 1.4 tiles. Colour (1.0, 0.70, 0.40). Per-lamp gain `0.82 + 0.36·hash(i)`. Intensity × `nightFactor` ÷ exposure. Place it from the same loop that places `lampMesh` (`scene.ts:813-834`) |
| `rd_addLamp` (inverse-square `h³/D³` + GGX spec), `rd_tone(p) = p/(1 + 0.7p)` | texture of the pool quad | Bake `h³/D³` with h = 9 m → 1.125 tile into a 128 px radial texture, then apply `rd_tone` as the soft knee. The analytic in-shader variant needs lamp positions in the road shader; Mayor's lamp placement depends on neighbouring tiles, so **skip it** |
| `PropAssets` `halo` (camera-facing additive quad, uColor (1, .78, .5)) | `street-light.ts` → `LampHalos` | Same screen-relative size rule as §2.2 |
| `PropRenderer.updateLights` (pool of real PointLights re-aimed at the nearest lamps) | **skip on iPad** | Every point light adds a loop to every lit fragment shader and recompiles programs. Fable runs 8–48 |

### 2.7 Info views and UI patterns

| Fable | Mayor target | Port notes |
|---|---|---|
| `simulation/infoview.js` `InfoViewOverlay`: an N×N RGBA DataTexture (R coverage, G signed distance to the boundary with 0.5 at the edge, B developed mask) and one draped plane. Three-stop ramp crimson → amber → service colour: `aServed = (0.04 + 0.08·s)·dev`, `aGap = gap·dev·0.38·(0.62 + 0.38·hatch)`, hatch = `fract((x + z)·0.055)` (m) → ·0.44 per tile. One anti-aliased ring per facility (`MAX_RINGS 48`, `w = fwidth(d)·1.8 + 1.6 m`) plus `exp(−d·0.045)` glow | **new** `src/render/coverage-overlay.ts` + pure `src/sim/coverage-field.ts` | Coverage is a binary `w.cover` bit. Strength = clamp(chamfer distance to the nearest uncovered tile / 3). Developed = zoned or built. Rings come from `FAC_DEFS[...].radius`. Draw as a **second draw of the terrain geometry** with a transparent overlay ShaderMaterial (world xz → texture), so one draw replaces up to 9216 instances. Gaps read loudly; served land is a whisper (CS rule) |
| `RoadMaterials` 4096×1 `uInfoTex` indexed by segment slot | `road-material.ts` + `scene.ts` traffic view | Mayor equivalent: a size×size R8 "load ratio" DataTexture sampled at world xz in the road fragment (`vRoadClass > 0.5`), green to red. Upload 9 KB every 10 frames instead of rebuilding ~2000 matrices (F11) |
| `ui/infoview.js` legend: Low→High gradient with the city-average marker, categorical chips, stats only when the owning module has written them | `src/ui/hud.ts` (UI-4) | Matches UI-V2-PLAN's "numbers must come from the real simulation". All strings through `src/i18n.ts` |
| `ui/toasts.js`: at most 3 visible, life by tone (info 6 s, success 5 s, warning 8 s, error 9 s, milestone 8 s), overflow into a bell with an unread badge, log capped at 40 | `hud.ts` (replace the single 1.8 s `toast`) | UI-4 alerts |
| `ui/onboarding.js`: a 4-step card that completes on **real events** (`roads:changed`, `zones:changed`, `time:speed`, `building:added`), never on a timer; rings the target control; dismissal is session-scoped; storage access wrapped in try | `hud.ts` + `main.ts` (UI-5) | Mayor already has `tips`. This is the objective-card upgrade |
| `ui/tooltip.js`: one shared rich tooltip (`{icon, title, key, desc, cost, upkeep, rows}`) that never covers sibling UI (lifts above the tray or dock), `suspend()` for modals | `hud.ts` | UI-5 / iPad. Touch: show on long-press |

### 2.8 Pedestrians (M22, later)

| Fable | Mayor target | Port notes |
|---|---|---|
| `PedestrianModel.js` (436 / 124 tris, `aLimb` 0–6, accessories collapsed per instance) + `PED_DECL` walk cycle in the vertex shader (`sin(phase)·speed·amp`, arms 0.46, legs 0.66, bob 0.017 m) + `createPedestrianDepthMaterial` | **new** `src/render/pedestrians.ts` | One draw per LOD. Stature 0.925–1.08, build 0.93–1.15 from the seed. Shirt and trouser palettes verbatim. Needs sidewalk lanes (08 P7). Height scale 0.0875 tile/m → a 1.75 m person is 0.15 tile. Check legibility at game zoom before investing |

---

## 3. What to skip (too heavy for iPad, or it did not work in Fable)

| Fable feature | Why skip |
|---|---|
| CSM, 2–4 cascades (`Engine.js:101`) | Mayor's top-down camera with a single target-following frustum is enough. Port only the texel bias |
| GTAO pass (16 samples + denoise + a second full-scene normal pre-pass) | Full-screen and a scene re-render. Fable disables it on `low`; Mayor GLBs carry baked AO vertex colours |
| UnrealBloom, SMAA, ColorGradingPass (GPU luminance meter, LUT, vignette), sun glare, heat shimmer | Each is a full-screen pass, plus EffectComposer render targets that lose native MSAA. Use glare billboards (§2.2, §2.6) in place of bloom; MSAA is already on |
| Analytic Rayleigh/Mie sky, volumetric cloud shell, cloud-shadow map, star cube, moon disc, live sky PMREM at 512 px | Per-pixel ray-marching. Use the HDRI PMREM once plus Mayor's colour background |
| MeshPhysical **clearcoat** on vehicles | Fable's own critic measured **no visible clearcoat lobe** on the paint (`traffic_p5.json` specularVerdict), and the physical BRDF costs extra |
| Puddle geometry, vehicle spray, GPU rain particles, wet ripples via global material hook | Fable's critic: puddles mirrored nothing, spray was not visible, night rain had no reflected columns (`effects_p5.json`) |
| Planar water reflection, five ripple octaves | Second scene render |
| Real PointLight pool | Shader light loops and program variants |
| LOD0 alloy wheels (436 tris × 4, spin and steer) and the procedural 2000-tri shells | Invisible at game zoom. Keep the Blender models within 1100/1500 |
| Kenney Car Kit GLBs (2032–3124 tris, atlas texture) as is | Over budget. Use only as Blender reference or decimate (§5) |
| Poly Haven glTF props (street lamps 20–31 k tris, hydrant 86 k, potted plant 176 k) | 100–1000× the 130-tri prop budget. Reference only |
| Displacement maps of the PBR sets | No tessellation or parallax in Mayor |

---

## 4. Licensing and asset reuse (exact paths)

**Code (MIT).** Any substantial port of `traffic/materials.js` shader chunks, `Renderer.js` passes, `guard.js` or
`infoview.js` needs the MIT notice. Use the NOTICE.md block already drafted in 08 §6, and add a header comment in each
ported file: "Adapted from fable-cities (MIT, (c) 2026 raw)". Constants and ideas alone need no notice; adding it anyway
is cheap.

**Assets (all CC0; `info.json` in every folder confirms id, source and licence).** Prefer fetching from the upstream URL
recorded in `public/assets/CREDITS.md`. Copying the files is also legal because they are CC0. Record each in
`third_party/README.md`, and run them through `blender/apply_ai_textures.py`-style processing (seamless, mean-matched,
≤ 1.5 MB, `_hd` naming) before they go into `public/textures/`.

| Use in Mayor | Fable path (`/tmp/gh-refs/fable-cities/public/assets/…`) | Upstream | Size |
|---|---|---|---|
| **Environment map (P1)** | `shared/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr` | Poly Haven `kloofendal_48d_partly_cloudy_puresky` | 1.4 MB |
| Road asphalt detail and normal (worn) | `shared/asphalt_light/{albedo,normal,roughness,ao}.jpg` (rmean 0.52) | ambientCG Asphalt031 | 5.3 MB |
| Road asphalt (fresh, highway) | `shared/asphalt/{albedo,normal,roughness}.jpg` (rmean 0.81) | ambientCG Asphalt010 | — |
| Sidewalk slabs | `shared/paving_slabs/{albedo,normal,roughness,ao}.jpg` (rmean 0.52) | ambientCG PavingStones070 | 5.6 MB |
| Kerb and concrete | `shared/concrete/{albedo,normal,roughness}.jpg` (rmean 0.52) | ambientCG Concrete034 | 1.7 MB |
| Pedestrian paths and setts | `shared/paving_cobble/…` (rmean 0.53) | ambientCG PavingStones128 | 5.1 MB |
| Facades (kit tint sources) | `shared/bricks_{red,yellow,white}/`, `shared/plaster_{modern,rough,painted}/` | ambientCG Bricks059, 075A, 060, Plaster001, 003, PaintedPlaster017 | 2.4–5.1 MB each |
| Roofs | `shared/roof_tiles_clay{,_b}/`, `shared/corrugatedsteel005/` | RoofingTiles013A, 014A, CorrugatedSteel005 | — |
| Office glass, day and night emission | `shared/facade_glass/`, `shared/facade_glass_night/emission.jpg` | Facade001, Facade009 | — |
| Terrain splat (md/hd) | `shared/Grass003/`, `shared/Grass004/`, `shared/Ground033/`, `Ground048/`, `Ground054/`, `shared/forest_floor/`, `shared/sand/`, `shared/Rock030/`, `Rock035/` | ambientCG | ~5.7 MB each |
| Service vehicle reference (ambulance, fire truck, police, garbage truck, delivery van) | `simulation/models/{ambulance,firetruck,police,garbage-truck,delivery}.glb` + `Textures/colormap.png` + `KENNEY_LICENSE.txt` | Kenney Car Kit 3.1 | 2.3–3.1 k tris. Decimate to ≤ 1100/1500 or use as proportion reference for `FLEET_BY_ROLE` |

Mayor today has only Poly Haven `asphalt_02` and single-channel PNG colour maps (no normal or roughness maps). A normal
map adds one fetch per fragment. Gate normal and roughness maps to the `high` tier (`QUALITY_PROFILE.high.tex = "hd"`).

---

## 5. Risks

1. **ACES vs AgX.** Every absolute exposure and emissive number in Fable was tuned under AgX at exposure 1.37–3.15.
   Porting the numbers verbatim under ACES 0.85–1.05 will look wrong; ACES also hue-shifts saturated reds. Port the
   ratios and the ÷exposure rule, then tune from screenshots. Switching Mayor to AgX (available in 0.186) is a separate,
   whole-look decision and needs an A/B with `lookmeasure.py`.
2. **Mixed BRDFs.** With an environment map, vehicles and roads (Standard) gain reflections while buildings (Lambert,
   15 materials in `scene.ts`) stay flat. Keep `environmentIntensity` modest (≤ 0.6 by day) and judge it in screenshots.
3. **IDM stability and balance.** `tickTraffic` dt reaches 0.25 s × game speed; sub-step at ≤ 0.1 s. Real queues at red
   lights lower throughput, and `congestion` feeds happiness. Keep the capacity factor as an upper bound and compare
   `s.congestion` on the same save before and after (test). Vehicles still pass through cross traffic at unsignalled
   nodes until 08 P7/P8.
4. **Multi-group to single material.** `bakeVehicleSurface` must preserve the AO vertex colour and the material colours
   exactly. A missing material-name mapping silently turns into "generic", so a test must enumerate every material name
   in every fleet GLB.
5. **Decals and rule 11.** Contact shadows and light pools are exactly the "floating decal" class the lead rejects. They
   need pitch on ramps and the deck height on bridges, must be hidden in tunnels (layer 2), must not stack above
   markings (render order after `markMesh`, polygonOffset), and need day, night and close-up screenshots of ramp, curve
   and junction.
6. **Additive passes and exposure.** Pools and glare land before tone mapping. Without the ÷exposure term they blow out
   at night; Fable hit asphalt Y 0.61.
7. **The MAX blend equation** is WebGL2 core (three 0.186 is WebGL2-only), so it is safe. A test should still assert the
   material's `blendEquation`.
8. **F3 is a code-reading finding.** Confirm in the browser that `glow_head` emissive is `#000000` at night
   (`__city.renderer` → vehicle mesh material) before building on it.
9. **Overlap with 08.** The IDM here uses a per-tile leader search. When the 08 P7 lane graph lands, only `leaderOf()`
   changes; keep `idm.ts` free of tile assumptions.
10. **Vehicle scale.** Mayor cars are 0.70× real size. All Fable vehicle-relative lengths use 0.0875 tile/m, and
    road-relative ones (pool radius, lamp height) use 0.125 tile/m. Mixing the two produces oversized decals.

---

## 6. Prioritised tasks (each sized for one contributor agent)

Every prompt must cite `.claude/skills/mayor-visual-quality/SKILL.md` and AGENTS rule 11. Every visual task's report
needs day and night screenshots at game zoom and close up, covering a junction, a curve and a bridge ramp. Each task must
keep `npx tsc --noEmit` clean and `npx vitest run` green.

### P0-A · Vehicle surface classes and a single material (fixes F1–F5) · 1.5 d

- Files: new `src/render/vehicle-surface.ts`, `vehicle-material.ts`, `vehicle-palette.ts`; `scene.ts` `updateVehicles`
  rewrite (preallocated `Matrix4`, typed counters, no closures or objects per frame); `patterns.json` untouched (the class
  map lives in TS).
- Tests:
  - every material name across `ALL_FLEET_PROPS` GLBs maps to a class (reads the GLBs as `fleet.test.ts` does);
  - the baked geometry has 0 groups and `aClass`, `aLight` and `aSurf` of the vertex count;
  - glass vertices have class 2 and `color` ≠ body;
  - the `weightedTable` histogram matches the weights within 1/256;
  - `paintOf(seed)` is deterministic;
  - the lamp formula is 0 by day for head (except the 0.085 DRL), and tail > head-red at night;
  - a structural "no `new` in `updateVehicles`" check (grep test on the function source is acceptable).
- Browser: `__city.renderer.lodStats().calls` before and after on the same save (expect about −250 draws); night
  screenshot shows lit head and tail lights; red car with dark-neutral glass.

### P0-B · Shadows and grounding (fixes F6–F8) · 1 d

- Files: new `src/render/shadow-tuning.ts`, `src/render/vehicle-fx.ts` (`ContactShadows`); `scene.ts` (PCFShadowMap,
  per-span bias, proxies sharing `instanceMatrix`, vehicle pitch, `ROAD_LIFT` lift).
- Tests:
  - `shadowBias` is monotonic in span and capped at 0.11;
  - radius is clamped to [1.15, 4.2];
  - the proxy is 24 tris and its bbox contains the source bbox;
  - the decal count equals visible ground vehicles (tunnel vehicles excluded);
  - `pitchFor(heights)` is 0 on flat ground and has the ramp sign on a ramp.
- Browser: low tier (shadows off) close up, showing cars grounded by decals; high tier with car shadows attached at
  close zoom.

### P1-A · IDM car following + brake and blink state · 1.5 d

- Files: new `src/sim/idm.ts`; `src/sim/traffic.ts` (leader lists, sub-stepping, the signal stop, vmax from curvature,
  brake and blink, congestion).
- Tests:
  - free road reaches 0.95·v0 within 3 s;
  - standstill gap converges to S0 ± 0.02;
  - a 50-vehicle platoon on a loop for 600 s never has gap < 0 and is deterministic for a fixed seed;
  - at a red light, vehicles stop within 0.06 ± 0.03 tile of the stop line, and brake ≥ 0.9 when stopped;
  - 260 vehicles tick in < 1 ms (bench);
  - `congestion` on the reference save is within ±25 % of the old model;
  - the indicator sign matches the left or right turn;
  - an old save loads (traffic is not saved).

### P1-B · Night vehicle lights (pools, tail wash, glare) · 1 d · depends on P0-A and P1-A

- Files: `vehicle-fx.ts` (`HeadlightPools`, `LampGlare`); `scene.ts` hookup (`lightsOn` = the `nightFactor` from P1-D,
  or `1 − day` until it lands).
- Tests:
  - count is 0 by day;
  - caps are respected;
  - intensity is ∝ 1/exposure;
  - glare size grows with camera distance;
  - `lampAnchors` sits inside the bbox front and rear faces.
- Browser: night queue at a signal showing a tail-light trail.

### P1-C · Environment map + material targets + roads · 1 d

- Files: new `src/render/environment.ts`, `src/render/material-targets.ts`; `road-material.ts` (wet table, drop the
  day-albedo hack); copy the HDRI into `public/env/` and credit it in `third_party/README.md`.
- Tests:
  - the target table values;
  - `envIntensity(day)` endpoints;
  - the road wet roughness and albedo come from the table;
  - a missing HDRI leaves `scene.environment` null (no crash).
- Browser: the PMREM build time on iPad (log it), noon versus rain screenshots, glass reflecting sky.

### P1-D · Atmosphere rewrite + look measurement · 1 d

- Files: new `src/render/atmosphere.ts` (pure `atmosphereAt` + an in-place `apply`); `scene.ts` `setAtmosphere` without
  allocation; new `tools/lookmeasure.py` (adapted) and `docs/process/09-look-target.md` with Mayor's measured table.
- Tests:
  - the warm key and cool fill hue (key r > b, fill b > r);
  - the night floor is never below midnight through dusk (monotonic ambient key);
  - `nightFactor` ramp endpoints;
  - no allocation after the first call.
- Report: `lookmeasure.py` numbers before and after for `lum_p10`, shadow depth and shadow coolness.

### P2-A · Street-light pools, halos and the vegetation night floor · 0.5 d

- Files: new `src/render/street-light.ts`; `scene.ts` lamp loop.
- Tests:
  - pool count equals lamp count;
  - pools sit on the road side of the lamp;
  - `blendEquation === MaxEquation`;
  - 0 by day.
- Browser: a night street shows no blown overlap.

### P2-B · Info views v2 (coverage field + traffic road tint) · 1.5 d

- Files: new `src/sim/coverage-field.ts`, `src/render/coverage-overlay.ts`; `road-material.ts` (load texture); `hud.ts`
  legend (i18n).
- Tests:
  - the field on synthetic worlds: served, edge, gap and undeveloped cases;
  - rings equal facilities of the type, capped at 48;
  - the field build is < 2 ms at 96²;
  - the traffic texture value equals clamp(load/capacity).
- Browser: police coverage with one gap district, hatched.

### P2-C · Perf guard · 0.5 d

- Files: new `src/render/perf-guard.ts`; `scene.ts` `adaptResolution`.
- Tests:
  - a single 900 ms hitch causes no step;
  - 5 s at 30 fps causes one step down;
  - 50 fps (dead band) never flips;
  - at most 2 steps per session;
  - no recover inside the cooldown.

### P2-D · Blender vehicle style pass · 1.5 d · Muse-friendly

- Files: `blender/dress_vehicles2.py`, `props_fleet_vehicles.py` (new material names, arch, pillar, shut-line and livery
  rules from §2.1 at 0.0875 scale); regenerate `public/models/props/*.glb`; update the P0-A class map.
- Tests: `fleet.test.ts` budgets (1100/1500), forward axis +X, the class-map coverage test from P0-A.
- Report: preview renders in `docs/img/models`.

### P3-A · Pedestrians (M22) · 2 d · after 08 P7 sidewalk lanes

`src/render/pedestrians.ts` + a sidewalk walker in sim. Tests: deterministic walkers stay on sidewalk polylines; 1 draw
per LOD; depth material matches the walk.

### P3-B · UI patterns (toasts with a bell, event-driven onboarding card, rich tooltip, legend) · 1.5 d

Part of UI-4 and UI-5. Tests: toast queue cap and lifetimes; onboarding step completes on the event, not a timer; i18n
keys exist in pt-BR and en.

Suggested order: P0-A ∥ P0-B → P1-A ∥ P1-C ∥ P1-D → P1-B → P2-* → P3-*.

---

## 10-line summary

1. Mayor's fleet has three real defects: instance colour tints glass, tyres and lamps; car glass uses the building-window texture; and `glow_head`/`glow_tail` have a black emissive, so they never light at night (confirm F3 in the browser).
2. Fable's main vehicle idea ports cheaply: one geometry per look, with a per-vertex surface class read as a `flat` varying and per-instance paint and lamp state. That cuts ~330 vehicle draw calls to ~33 and fixes all three defects (P0-A).
3. A 24-triangle shadow proxy sharing `instanceMatrix`, plus a multiply-blended contact decal, grounds vehicles even on the iPad low tier, which has no shadow map (P0-B).
4. Shadows: `PCFSoftShadowMap` is removed in three 0.186. Set PCF explicitly and derive bias and radius from the texel footprint, which varies 8→60 tiles with zoom (formulas in §2.5).
5. IDM car following ports onto today's tile model with constants converted at time compression 1.8 and vehicle scale 0.0875 tile/m: a = 1.15, b = 1.34, S0 = 0.18, T = 0.58 s, lateral 1.38. Sub-step at ≤ 0.1 s (P1-A).
6. Night lighting without lights: headlight and tail-wash pools, exposure-compensated glare billboards, and MAX-blended street-light pools (never additive) replace bloom and point lights.
7. Material targets (paint 0.30, glass 0.06, dry asphalt 0.65, wet 0.18 with albedo ×0.76) only matter with an environment map. Load the CC0 kloofendal 1k HDRI into a PMREM once and ramp `environmentIntensity` with the hour (P1-C).
8. Lighting should move to a warm key and a cool, much weaker fill, measured with an adapted `lookmeasure.py` against Fable's CS2-derived LOOK_TARGET numbers. Port ratios, not AgX exposures (P1-D).
9. Skip CSM, GTAO, bloom, SMAA, grading, the analytic sky, clouds, puddles, spray, clearcoat, point-light pools, alloy wheels and the Poly Haven props; several of these failed even in Fable's own critique.
10. CC0 reuse list (HDRI, Asphalt031/010, PavingStones070/128, Concrete034, brick, plaster, roof and terrain sets, Kenney service vans as reference) is in §4 with exact paths. Ported code carries the MIT notice from 08 §6.
