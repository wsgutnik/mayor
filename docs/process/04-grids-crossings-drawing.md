# 04 — Grids, Crossings, and Road Drawing: how Cities: Skylines does it and what Mayor should do

Updated on 2026-10-12. Responds to the request "precisa detectar melhor; pesquisar como o Cities: Skylines monta essas grades, desenhar melhor, talvez uma versão mais compatível do mapa via Blender, mais pixels" (needs better detection; research how Cities: Skylines builds these grids, draw better, maybe a more map-compatible Blender version, more pixels). Does not repeat `01-research.md` (8 m scale, nodes/segments, 5 elevations, game limits); adds what was missing: the zoning-grid **algorithm**, **intersection × grade-separation rules**, road **rendering**, and the **Blender → Three.js** flow.

Conventions: **[source]** = what the source states, with numbers as written there. **[code]** = read in the copied game code used by the Zoning Adjuster mod (1:1 copies of CS1 `RoadAI.CreateZoneBlock`, `ZoneBlock.CalculateBlock1`, and `CalculateImplementation2`, with mod sections marked). **[inference]** = my conclusion, not written in the source. **Not verified** = I tried and did not find a source.

## 0. Source Status

| Source | Result |
|---|---|
| CS1 code (via `algernon-A/ZoningAdjuster`, `Code/Patches/CreateZoneBlocks.cs`, `CalcBlock1Patch.cs`, `CalcImpl2Patch.cs`) | **Obtained** through the GitHub API. This is the strongest source in this document: it contains exact zoning-grid constants and rules. |
| https://cs2.paradoxwikis.com/Roads and /Zoning | **Obtained.** Tool modes, snapping, elevation steps, parallel offsets, lot sizes by zone. The wiki marks both as "verified for 1.0, possibly outdated". |
| https://skylines.paradoxwikis.com/Roads, /Zoning, /Road_Editor | **Obtained.** Elevation steps, widths in cells, how road mesh is built and textured. |
| CS2 dev diary #1 "Road Tools" (https://colossalorder.fi/?p=1547) | **Obtained** (Colossal Order site version; Paradox forum returns HTTP 500 / browser validation). |
| CS1 dev diaries #1 Roads and #2 Zoning (Paradox forum) | **Not obtained** (HTTP 500 and browser validation). The DD2 snippet about "2-cell slices" came only from search summary. |
| Reddit | **Not obtained** (domain blocked for search and fetch; no accessible mirror). Steam forums and guides used instead. |
| Steam page for Tiny Segments mod (minimum segment length) | **Not obtained** (HTTP 429); only search snippet. |
| Blender manual (docs.blender.org) | **Not obtained** directly (anti-bot challenge); read the same page in Khronos `glTF-Blender-IO/docs/blender_docs/scene_gltf2.rst`. |
| three.js source (`src/textures/Texture.js`, `examples/jsm/loaders/KTX2Loader.js`) | **Obtained** from GitHub (dev branch). |
| CS2 internal rendering (road shaders, decals) | **Not verified.** No technical source; only modding diary (ECS/Burst) and community decal tools. |

---

## 1. GRIDS: How a Road Becomes a Zoning Grid and Block

### 1.1 Tools and Snapping

**What the sources state**
- **[source] CS1:** roads "automatically snap to other roads, angles, the zoning grid, and road guidelines"; tools Straight, Curved, Freeform, Upgrade. — https://skylines.paradoxwikis.com/Roads
- **[source] CS1:** "When two roads cross they create an intersection." — same
- **[source] CS2:** six modes: Straight (2 clicks), Simple Curve (3), Complex Curve (4), Continuous, Grid ("Create two initial points and then drag sideways to create a perfect grid"), Replace. Parallel: "The offset determines the distance in zone cells between the two roads and can be set from 0.25 to 12". — https://cs2.paradoxwikis.com/Roads
- **[source] CS2:** snapping to "zoning cell length ... snaps every 8 meters", 90° angles, existing geometry, building sides, guidelines, and zoning grid. No snapping distance in meters is given. — same
- **[source] CS2 (dev diary #1):** "the Grid mode allows you to create seamless city blocks with just three clicks" (corner, width, length); "Intersections are automatically created where roads intersect". — https://colossalorder.fi/?p=1547
- **[source] CS2 community:** the combination for a perfect grid is "Snap to zoning cell length, Snap to existing geometry, Snap to 90 degree angles"; "snap to guide lines ... will instantly start causing issues"; angle snapping "snaps at 90 degree if you have it switched on, but it's not very snappy". — https://steamcommunity.com/app/949230/discussions/0/4333105589465814156, https://steamcommunity.com/app/949230/discussions/0/3937895062998876459
- **[source] Segment length:** Maximum Segment Length mod: "instead of the default 96m (12u) long segments, you can build a bridge with 48m (6u) segments" (1 u = 8 m); Tiny Segments comment: minimum segment length "about one cell (8 m)". — search snippets (https://steamcommunity.com/sharedfiles/filedetails/comments/1586027591)
- **Not verified:** 15°/45° snapping. No official CS1 or CS2 source cites 15° or 45°; CS2 documents only 90°. Node merge distance also appears in no source.

**Inference**
- CS2's "perfect" grid comes from three combined rules: length multiple of 8 m, 90° angle, and snap to existing geometry. Guidelines break grids because they introduce sub-cell offsets.
- "Grid mode" is only a shortcut: it generates a rectangle of straight segments with spacing multiple of 8 m; the rest is the per-segment zoning rule (1.2).

**What to do in Mayor**
- `SNAP_RADIUS` is currently 0.6 tile (`src/sim/roads.ts:16`). Add three optional snaps, enabled by default in Line tool: (a) **length multiple of 1 tile** (8 m), (b) **90° angle** relative to origin segment (±7° tolerance), (c) **existing geometry** (already exists). Offer 45° as an option, not 15° (unsupported by sources).
- **Grid tool** (3 taps: corner, width, length) generating N×M straight segments; default step 12 tiles (see 1.3). Good for iPad: fewer taps than drawing street by street.
- **Parallel**: offset in tiles (0.25-12), generates shifted copy of the trace.
- Minimum segment length 1 tile; refuse (or merge into node) when `len < 1`.

### 1.2 How the Zoning Grid Is Generated Per Segment (CS1, from code)

**What the source states**
- **[code]** `CellSize = 8f`; `MaxExtent = 32f` (4 cells). Half-width used: `≤4 → 4`, `4..8 → 8`, otherwise rounded. `maxDistance = halfWidth + 32 + setback` (setback is modded; vanilla 0). — `CreateZoneBlocks.cs:325-360`
- **[code]** Initial offset along segment: if `halfWidth % 8 != 0`, start 4 m before the node; if multiple of 8, start at node. — `:362-381`. This keeps cells aligned to the 8 m grid of the road axis.
- **[code]** `rows = floor(length / 8 + 0.1)`; "zoning manager will only do blocks of up to 8 length": one block per side if `rows ≤ 8`, otherwise two blocks (`(rows+1)>>1` at start, `rows>>1` at end). Each segment has up to 4 blocks: `m_blockStartLeft/Right`, `m_blockEndLeft/Right`. Left/right respect `ZoneLeft/ZoneRight` and `Invert` flags. — `:396-445`
- **[code]** Curved road uses its own routine (`CurvedZoneBlocks`): minimum half-width 6 m, Bézier tangent (for example t = 0.14) gives block angle, long (> 50 m) or tight curves are split into two blocks per side. — `:72-310`
- **[code] Valid block mask** (`CalculateBlock1`): a `ulong` of 8 rows × 4 columns (column = depth; "This mask limits the maximum size of a zone block to 64 cells (e.g. 8x8)"). Cell invalid if: (a) `|cell height - height of road-side row| > 8 m`; (b) outside purchased area; (c) covered by a network segment on `Default` layer; (d) **behind an invalid cell** ("so that there are no cells with no road access", 7-iteration loop propagates invalidity backward). — `CalcBlock1Patch.cs:141-255`
- **[code] Overlap between blocks** (`CalculateImplementation2`): only blocks < 92 m apart; two cells "touch" if `dist² < 144` (12 m). If `dist² < 0.01` **and** angle difference is a multiple of 90° (1% tolerance), the cell is **shared**: closer to road wins (smaller column); tie → older block (`m_buildIndex` smaller). Otherwise, if quadrilaterals intersect: a cell in the **first two columns** (depth 0-1) beats a deeper cell; same depth band → older block wins. If `dist² < 36` (6 m), both are in the first 4 columns, and this cell has no zone, it **inherits the zone type** from the other. — `CalcImpl2Patch.cs:39-293`

**Inference**
- The CS1 zoning grid is not the world grid: it is an **8 × 4 cell rectangle per side and per segment**, rotated by segment angle, anchored at the start node and road axis. "Perfect" blocks appear because orthogonal segments with length multiple of 8 m produce blocks whose quads coincide within 10 cm and angle multiple of 90°, making sharing deterministic (closest to road, then oldest).
- **Corner**: there is no corner-lot type. The corner cell belongs to the block whose cell is closer to its road (smaller column); tie goes to the road built first. This explains why a CS1 corner building "chooses" one street, and why redrawing a road (new `buildIndex`) changes the corner.
- Rule (d) (no cell behind invalid cell) prevents island lots without road access.

**What to do in Mayor**
- Today `findFrontage` (`src/sim/blocks.ts:55-86`) assigns each tile to the nearest road tile at Manhattan distance ≤ 4, tie by class and index. Rewrite as **blocks per segment and side**, CS1-style:
  1. For each zoneable `RoadSegment`, each side: `rows = floor(len / 1 + 0.1)` (tile = cell), split into blocks of ≤ 8; origin at node A shifted 0.5 tile if half-width is not multiple of 1 tile.
  2. Block = 8 × 4 cells in segment coordinates; rasterize each cell to `World` (cell center → tile). On straight orthogonal segments this falls exactly on tiles; on curves/diagonals, use the cell center and accept that the tile is slightly off (CS1 does the same and draws the grid rotated).
  3. `valid` mask per block: tile occupied by road/facility/water → invalid; `|h - h_road| > 1 unit` (8 m) → invalid; propagate invalidity backward (column k invalid if k-1 invalid).
  4. Conflict between blocks on same tile: **smaller depth wins; tie → oldest segment (`id` lower)**. Store in `frontage.road/depth/dx/dy` as today so `planLots` continues to work.
- Then the block stops being a "band along the street" and becomes **four 8 × 4 blocks from four segments**, with a free middle when spacing exceeds 8 tiles — exactly what the player recognizes as a block.

### 1.3 Lot Sizes and Building Choice

**What the source states**
- **[source] CS1:** household/job tables list 1×1 to 4×4 footprints; "the front of all buildings must be immediately adjacent to the road". — https://skylines.paradoxwikis.com/Zoning
- **[source] CS1 (dev diary #2, via search):** "Instead of zoning the full depth of the zone grid (4 cells) the player can zone thinner slices, like 2 cell deep areas, that spawn smaller building fitting the 2 cell deep restriction". — https://admin-forum.paradoxplaza.com/forum/developer-diary/cities-skylines-dev-diary-2-zoning.804803 (not opened; search snippet)
- **[source] CS1 (District Styles Plus mod dev):** vanilla spawner "tries to place 4-unit-wide or 2-unit-wide buildings"; a 17×7 block left a 6×4 hole that never grew; cutting 1 or 2 cells fixed it. — https://steamcommunity.com/workshop/filedetails/discussion/2852723058/3550553789954178305
- **[source] CS1 community:** 8×8-cell block = four 4×4 buildings; widening the road shrinks it to 6×6; 10×10 recommended if widening later. — https://steamcommunity.com/app/255710/discussions/0/611701360840502796 (already in 01)
- **[source] CS2:** lots in cells (width along road × depth): Low Density Housing 2×2 to 4×6; Medium Row Housing 1×2 to 1×6; Medium/High/Mixed Housing, Low Rent, Industrial, Offices 2×2 to 6×6; Low Density Business 2×2 to 5×6; "No apparent in-game difference between themes in terms of available sizes". — https://cs2.paradoxwikis.com/Zoning
- **[source] CS2 community:** zoning 6×6 low-density "tends to get split into two 3×6 houses"; 112 m = 12-cell spacing between roads is "the most you can get without leaving a gap"; XP every "112m / 14 cells" (wiki note). — https://steamcommunity.com/app/949230/discussions/0/3951406499785218787, https://steamah.com/cities-skylines-ii-practical-engineering-efficient-grids-guide/, https://cs2.paradoxwikis.com/Roads

**Inference**
- CS2 has zoning depth of **6 cells** (lots 6 deep; 12 cells between roads = 6 + 6 with no gap). CS1 has 4. Preferred widths are **4 and 2** (CS1) and **2 to 6** (CS2); width 1 only in row housing.
- CS1 building choice is greedy by width: tries the largest footprint that fits in contiguous frontage of the same type, then smaller; there is no persistent "lot", the building is the lot.

**What to do in Mayor**
- Keep depth 4 (CS1) for now; `ZONE_DEPTH` is already 4. Document 6 as a "CS2" option for when buildings of depth 6 exist.
- `planLots` (`blocks.ts:145-180`) already tries `[4,4] [3,3] [2,2] [2,1] [1,2] [1,1]`; change preference to **width 4, then 2, then 1** and depth = min(painted zone, 4), always attached to frontage (depth 0), like vanilla spawner. Remove random rotation of the shape list (today `rotate` shuffles trial order), which creates patternless 1×1/2×2 mixing; keep shuffling only for **frontage order**.
- Corner: do not create a special type; the tile belongs to the block that won in 1.2. Model faces the block road (`lotYaw`, `src/render/lots.ts`).
- Recommended generator/tutorial block: **12 tiles between street axes** (4 + 4 zoning + 4 free middle, or 6 + 6 in CS2 mode) and 8 for blocks without middle.

---

## 2. DETECTION: At-Grade Crossing × Grade Separation

**What the source states**
- **[source] CS1:** elevation with Page Up/Down; default step "12 meters, but it can be adjusted to 3, 6, or 12 meters"; "There is a limit to how steep a road incline/decline can be"; tunnels have depth limit; height is "the primary way to achieve grade separation". — https://skylines.paradoxwikis.com/Roads
- **[source] CS1 guide:** max "60m in the air and 36m underground"; higher roads "need more length to make the change". — https://www.ggrecon.com/guides/cities-skylines-elevate-roads/
- **[source] CS1 Road Editor:** road `Min/Max Height` define vertical limits used "for water blocking and for keeping other nets from being built too low above the road". — https://skylines.paradoxwikis.com/Road_Editor
- **[source] CS1 Steam forum:** an extra node appears where a bridge returns to ground and makes cars stop; "the node that separates elevation is the key here"; solution was keeping the road elevated until the T. — https://steamcommunity.com/app/255710/discussions/0/3151934575302426853
- **[source] CS1 Fine Road Tool mod:** forced Ground / Elevated / Bridge / Tunnel modes; smaller elevation steps; "Follow terrain / level terrain" and "Absolute elevation". — https://steamcommunity.com/sharedfiles/filedetails/changelog/1625704117 and linked discussions
- **[source] CS2:** steps "1.25, 2.50, 5.00, 10.00 meters"; common-road Elevation column = -50 to 50 (unit not in table); bridges 0-200 (suspension), 0-100 (Grand), 0-40 (drawbridge); cost "+ ₡4.5K per elevation level" per km. Elevation lets roads pass "above and underneath each other without creating intersections". — https://cs2.paradoxwikis.com/Roads
- **[source] CS2 dev diary #1:** "the first negative values create cut roads before the road turns into a tunnel"; "elevated roads on the other hand require sufficient clearance below them"; road guide shows "a numerical value of the slope steepness"; "Intersections are automatically created where roads intersect"; highway ramps are made by adding a lane to a stretch and connecting it to a one-lane highway, with "proper acceleration and deceleration lanes". — https://colossalorder.fi/?p=1547
- **[source] CS2 guide:** "6.25m is the lowest your bridge can be while still crossing the road" (pedestrian overpass built with road tools, pillars one cell from span), ramp descends to 3.75 m and 1.25 m before ground. — https://gamepretty.com/cities-skylines-ii-how-to-building-a-pedestrian-overpass/
- **[source] CS2 Steam forum:** for pedestrian overpasses "the most reliable height was 7.5M above the road". — https://steamcommunity.com/app/949230/discussions/0/3877095833475404466
- **[source] CS2:** "Slope Too Steep" error exists; guides say to flatten terrain or use a curve. Limit value: **not verified** (no source gives % or degrees, for CS1 or CS2). — https://progameguides.com/cities-skylines-2/how-to-fix-slope-too-steep-in-cities-skylines-2/
- **[source] CS1:** highways and ramps are one-way and do not zone; traffic light does not spawn on 2-lane road (already in 01). — https://skylines.paradoxwikis.com/Roads

**Inference**
- In both games, the decision is **geometric, not by "mode"**: crossing becomes a node when both roads occupy the same volume; it passes over when the upper road is above the lower road's `Max Height` (CS1) or has "sufficient clearance" (CS2). Lowest observed working value is **6.25 m** (CS2, 5 steps of 1.25); community uses **7.5 m** as safe; in CS1 default step is **12 m**, and 6 m is the practical minimum. In real meters, 5-6 m clearance is what an urban road needs.
- Fine Road Tool modes are UI shortcuts for the same mechanism: they force segment elevation instead of letting height decide.
- A node only for elevation change (where ramp touches ground) is bad for traffic; ramp should belong to the same segment or degree-2 elevation nodes must not stop cars.
- Automatic ramp: neither game generates the ramp by itself; player defines height and game interpolates ("the road will create an incline from the original height to the new height") and refuses if slope exceeds limit.

**What to do in Mayor** (today: discrete Ground / Elevated / Underground levels by button, no detection; `addSegment` avoids a node only when levels differ — `roads.ts:401`)
1. **Node height in meters**, not only level: `RoadNode.y` (unit = 8 m; store in meters or eighths). Ground = terrain; Elevated = terrain + 6 m by default (3 m step); Underground = terrain - 6 m.
2. **Crossing rule** when inserting segment, at each geometric intersection P with an existing segment: compute `hA(P)` and `hB(P)` by linear interpolation between nodes; if `|hA - hB| ≥ CLEARANCE` (default **6 m**, adjustable 5-7.5) → **no node**; otherwise → node (split both). This replaces "level" comparison with height comparison and works for existing bridges/tunnels (`elevation.ts`) and gradual avenue ramps.
3. **Slope limit**: `MAX_SLOPE = 0.125` (12.5%, 1:8); 6 m ramp requires **≥ 48 m = 6 tiles**; keep current 3-tile ramp (25%) only as "arcade mode" preference. Refuse segment with `|Δh| / len > MAX_SLOPE` with "muito íngreme" (too steep) i18n warning.
4. **Ramp inside segment**: height transition is segment profile (linear between nodes), not an extra node; degree-2 node only for elevation change should not get traffic light/crosswalk or stop traffic.
5. **Minimum node distance**: 1 tile (CS1 ≈ 1 cell). New node < 1 tile from existing node merges into existing (`SNAP_RADIUS` 0.6 today; raise to 1.0 only for crossing nodes).
6. **Highway**: never creates node with street/avenue — only with ramp; ramp is one-way segment that **does** have a node with both sides. Highway × highway at grade → node only if one is one-way entering (merge); two two-way highways crossing at grade → refuse ("use viaduto" / use overpass), as CS2 effectively does by not providing zoneable highway crossings.
7. **Visual detection**: while dragging road, paint point P green (will pass above/below, show Δh) or orange (will create intersection), like CS2 slope guide shows angle.

---

## 3. DRAWING: How Roads Are Rendered and What Mayor Should Do on iPad

### 3.1 What CS1 Does (Road Editor)

**What the source states**
- **[source]** "Roads are usually modeled as straight 64 units long and 16-32 units wide road stubs"; "Segments are used normally on continuous roads, and nodes are used in intersections"; "Both segment and node models are simply straight road stubs, and the game takes care of bending and matching them"; "Wrong sized mesh can result in clipping or z-fighting between the segment meshes when they are tiled". — https://skylines.paradoxwikis.com/Road_Editor
- **[source]** "As the mesh is stretched the UV-mappings 'scroll' along the V-axis to avoid stretching the texels"; "Magenta vertex color (255, 0, 255) can be used to disable stretching the UV-mapping"; "Nodes are usually heavily stretched and bent so avoid using diffuse details in those"; textures split horizontally, with static UV islands on one side. — same
- **[source]** Maps: `_d` diffuse, `_n` normal, `_s` specular, `_a` alpha, `_p` pavement, `_r` road; "White areas in pavement and road maps are used to automatically generate texturing" (ground around it is painted by the road). Pavement 0.3 u above; "Roads usually consist of 5 elevations" (Basic, Elevated, Bridge, Slope, Tunnel). — same
- **[source]** From 01: growable LOD ≈ 100 tris, LOD texture 128²; buildings 1024² per asset. — https://skylines.paradoxwikis.com/Asset_Editor
- **[source] CS2:** only impressions: road lines "look more clean than the previous version" (forum); custom decals through ExtraAssetsImporter/CS2DecalBuilder; part of code is Burst/ECS "unmanaged for optimization". — https://forum.quartertothree.com/t/cities-skylines-ii-chirper-strikes-back/159230, https://www.nexusmods.com/citiesskylines2/mods/168, https://www.paradoxinteractive.com/games/cities-skylines-ii/modding/dev-diary-3-code-modding
- **Not verified:** CS2 surface shader, vanilla decal use for lane markings, road normal maps, road LOD strategy.

**Inference**
- CS road sharpness comes from three things: (1) **texture repeated per meter** along the axis (V scrolls, never stretches), (2) **lane markings in the same diffuse map** of the road, at high resolution per meter, (3) **node with low-detail texture** (just asphalt) to hide stretching, with crosswalk/line as prop or own texture. Asphalt also darkens sidewalk and terrain through `_p/_r`, making the road feel seated.
- Mayor looks flat because ribbons are flat color or 128² asphalt repeated every 0.6 u (see G12 in 02), with no per-meter repetition, no normal map, no ground darkening around road, and lane markings are geometry/color instead of texture.

### 3.2 What to Do in Mayor (web, iPad)

**What the source states (three.js and GPU)**
- **[code] three.js:** `Texture.minFilter` default `LinearMipmapLinearFilter`; `generateMipmaps = true`; `anisotropy` default `Texture.DEFAULT_ANISOTROPY` (= 1); maximum comes from `renderer.capabilities.getMaxAnisotropy()`. — `src/textures/Texture.js` (dev branch)
- **[source]** Markings blur at distance "even when trilinear filtered"; anisotropic filtering keeps sharpness; one dev says "the main problem are the lane markings as the streets look pretty good without markings". — https://research.ncl.ac.uk/game/mastersdegree/graphicsforgames/texturemapping/, https://hub.jmonkeyengine.org/t/solved-texture-looks-blurry/23090
- **[source] SDF:** smoothing by screen derivative: `delta = length(vec2(dFdx(d), dFdy(d)))` and `smoothstep` around threshold; artifacts where two edges meet. — https://godotshaders.com/shader/sdf-scalable-textures/, https://redblobgames.com/x/2403-distance-field-fonts
- **[code] three.js `KTX2Loader`:** `detectSupport(renderer)` reads `WEBGL_compressed_texture_astc / etc / s3tc / EXT_texture_compression_bptc / pvrtc`; transcode order ASTC → BC7 → ETC2 → ETC1 → PVRTC → `RGBA32` (decompressed) last. — `examples/jsm/loaders/KTX2Loader.js:230-270, 795-868`
- **[source]** ASTC "iOS hardware supports it as of the A8 (iPhone 6)" (WebKit bug 185272); MDN: 512×512 ASTC 4×4 = 262,144 bytes; `getSupportedProfiles()`. — https://bugs.webkit.org/show_bug.cgi?id=185272, https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_compressed_texture_astc
- **[source]** On older iPads transcoding falls back to PVRTC and alpha textures appear black/white; Basis author recommendation: "use 4444 or 32-bit instead of PVRTC1". — https://discourse.threejs.org/t/basis-textures-with-alpha-appearing-fully-black-and-white-on-some-ipads-and-older-mobile-devices/22575
- **[source]** iOS Safari kills and reloads tabs with too much WebGL memory pressure; "the solution is typically to reduce texture sizes, or use less textures". Limit numbers (100-150 MB, ~256 MB) circulate but are **not official**. — https://bugs.webkit.org/show_bug.cgi?id=300782, https://bugnet.io/blog/how-to-fix-ios-safari-killing-your-web-game-a-problem-repeatedly-occurred

**Inference**
- For "more pixels" without blowing iPad memory: few large shared textures (atlas), GPU-compressed (ASTC via KTX2), with mipmaps and max anisotropy, and **SDF markings** (texture-resolution-independent) instead of drawing markings at high atlas resolution.

**What to do in Mayor**
1. **UV by meter on ribbon**: in `buildRibbon` (`src/render/roads.ts`), `v = accumulated distance along axis / 8` (1 repeat per tile) and `u = lateral position in meters / texture width`; never stretch. Node: asphalt only (flat UV, no detail) + crosswalk/stop line as separate **SDF decal**.
2. **Road atlas** 1024×1024 for high tier (512 medium, 256 low), with asphalt (albedo + normal + packed roughness), curb, sidewalk, median grass, and one **SDF** channel for continuous line, dashed line, crosswalk, arrow, stop line. Marking = `smoothstep(0.5 - w, 0.5 + w, sdf)` with `w = fwidth(sdf)`; width and color by uniform; no aliasing at any zoom.
3. **Filters**: `minFilter = LinearMipmapLinearFilter`, `anisotropy = renderer.capabilities.getMaxAnisotropy()` (cap 8 in medium, 4 in low), `wrapS/T = RepeatWrapping`, `colorSpace = SRGBColorSpace` only on albedo.
4. **Compression**: KTX2 via `gltf-transform` (UASTC for normal/ORM, ETC1S for albedo; see 4); PNG/WebP fallback when `detectSupport` does not find ASTC (older iPads) — and **no alpha in textures that can fall to PVRTC**: SDF mask goes in RGB channel, not alpha.
5. **Seat road into terrain**: "pavement" mask painted in terrain shader in a 0.5-tile band around each road (equivalent to CS1 `_p/_r`), darkening and changing grass to dirt/concrete. This is the biggest thing making the road look part of the map.
6. **LOD**: beyond 40 tiles from camera, discard curb and markings (uniform `uDetail`), keep only asphalt; beyond 80, road becomes terrain color (tiers already in `prefs.ts`). Pixel ratio by tier: low 1.0, medium 1.5, high 2.0 (as today) — sharpness comes from SDF + anisotropy, not pixel ratio.
7. **Texture budget (inference, iPad 2020+)**: ≤ 64 MB GPU textures in medium tier (≈ 4 ASTC 4×4 2048² atlases ≈ 4 × 5.6 MB with mips, plus buildings), ≤ 128 MB high; measure with `renderer.info.memory.textures`.

---

## 4. MAP/ASSETS VIA BLENDER → Three.js

**What the source states**
- **[source] Blender glTF exporter:** exports Principled BSDF (base color, metallic/roughness, normal "tangent space, +Y up", "Baked Ambient Occlusion", emissive); occlusion only via `glTF Material Output` node group input `Occlusion`; "glTF stores occlusion in the red (R) channel, allowing it to optionally share the same image with the roughness and metallic channels" (ORM); Cycles Bake for AO and normal; `KHR_texture_transform` (Mapping node, *Point* type); `KHR_materials_emissive_strength` if emissive > 1; **GPU Instances**: "instances are exported using the EXT_mesh_gpu_instancing extension"; Draco and Meshopt; "Apply Modifiers"; vertex color exported as Base Color multiplier (Material/Active/Name modes, extra `COLOR_1, COLOR_2`); PNG/JPEG/WebP images ("If WebP is chosen, all textures will be saved as WebP, without any png/jpg fallback"); extras (custom properties). — https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst
- **[source] gltf-transform:** `uastc --slots "{normalTexture,occlusionTexture,metallicRoughnessTexture}" --level 4 --rdo --rdo-lambda 4 --zstd 18`, then `etc1s --quality 255` for the rest; `webp --slots baseColor`; `meshopt --level medium`; `draco --method edgebreaker`; `instance` (`EXT_mesh_gpu_instancing`), `dedup`, `palette`, `resize`; "Defaults in the optimize command may not be ideal for all scenes", run `inspect` first. — https://github.com/donmccurdy/glTF-Transform/blob/main/packages/cli/README.md, https://gltf-transform.dev/cli
- **[source] Khronos:** ETC1S "can achieve significantly smaller transmission and memory sizes than JPEG and PNG textures"; UASTC "significant memory savings"; Basis combines "selected modes of the Khronos-defined ETC1 and ASTC GPU texture formats". — https://www.khronos.org/news/press/khronos-ktx-2-0-textures-enable-compact-visually-rich-gltf-3d-assets
- **[source] Mayor today:** script-built models in `blender/`, GLB in `public/models/`, instancing in game, 450-triangle-per-building limit (`AGENTS.md` rule 7); roads generated at runtime (`buildRoadNetworkGeometry`).

**Inference: pre-modeled pieces × runtime-generated mesh**

| | Blender GLB pieces (straight, 90° curve, T, cross, ramp) | Runtime-generated mesh (sweep, as today) |
|---|---|---|
| Visual quality | High where piece fits: baked AO, beveled curb, drains, normal map per piece | Depends on code; only vertex AO; details = more code |
| Free angles and curves | Poor: works only at 90°/45° and fixed radii; Mayor draws free curves and segments of any length | Natural: any angle, radius, length, terrain |
| Terrain | Piece does not follow terrain; requires flattening under road (CS terraforms) | Follows `groundY` per vertex |
| Intersections | Combinatorial explosion (class × arms × angles) — CS1 solves by bending a straight stub in code, not with pieces | Node polygon + fillets already exist (`nodeLayout`) |
| iPad cost | Instancing cheap (1 draw per piece), but 90° pieces do not cover city | 1 merged geometry per layer (already 1-2 draws) |
| Authoring | Artist (Muse) controls everything in Blender | Programmer |

- **Conclusion:** CS1 **does not** use intersection pieces: it uses one straight segment stub and one straight node stub and **bends them in code**. The compatible Mayor path is the same: geometry remains generated at runtime, but **profiles and textures** come from Blender, not whole road meshes. Pre-modeled GLB pieces only for truly repeated, undeformed things: **node props** (traffic light, sign, pole, shelter, drain, grate), **overpass/tunnel pillars and portals**, **roundabout islands**, **lot pieces** (garage, garden, parking, corner sidewalk).

**What to do in Mayor (concrete flow)**
1. **Road profile in Blender** (`blender/roads_profile.py`): one cross-section per class (street, avenue, highway, ramp) as 2D curve with named vertices (asphalt, curb, sidewalk, median) and **UV u per vertex**; export JSON to `public/roads/profiles.json` (custom properties → `extras`). Runtime sweep reads the profile instead of fixed `halfAsphalt/kerbWidth` numbers.
2. **Road atlas** generated in Blender (`make_textures_hd.py`): 2048² albedo + 2048² normal/ORM baked from procedural materials (Cycles Bake), plus SDF channel for markings (Python script from vector curves, Euclidean pixel distance). Export PNG and convert with `gltf-transform`/`toktx` to **KTX2 UASTC (normal/ORM) and ETC1S (albedo)**, with `--zstd 18`. WebP fallback for browsers without ASTC.
3. **Props GLB** with `EXT_mesh_gpu_instancing` or loaded as `InstancedMesh` (already true): AO in vertex color (`COLOR_0`) as base-color multiplier; base at z = 0, front at -Y, like buildings. Budget per prop ≤ 150 tris; pillar/portal ≤ 300; roundabout island ≤ 400.
4. **Compatible terrain**: keep heightmap (16-bit Map Kit, already done in M12); missing part is the **surface mask** (pavement/dirt/grass) painted by roads and lots, in `Uint8Array` per tile and `size²` texture read in terrain shader — equivalent to CS1 `_p/_r`. Do not model terrain in Blender: it loses in-game editing.
5. **iPad budgets (inference; measure with `renderer.info`)**: 128×128 city with ~2,000 segments: road ≤ 60k tris (today ribbon ≈2 tris/tile per material strip; 6-vertex profile ≈10 tris/tile → 20k for 2,000 road tiles), nodes ≤ 20k, road props ≤ 40k instanced, buildings ≤ 450 × ~1,500 lots = 675k (largest consumer — LOD1 of 100 tris required, see G14). Target total **< 1M tris/frame in medium tier**, **< 1.5M in high**. Textures: see 3.2 item 7. Draw calls < 150.
6. **Pipeline in `npm run assets`**: `blender -b … build_all.py` → `gltf-transform dedup | instance | meshopt | uastc/etc1s` → `public/models/*.glb` + `public/textures/*.ktx2`; `glb-assets.test.ts` also checks KTX2 size and absence of alpha in textures that fall back to PVRTC.

---

## 5. Sources (All Used)

- CS1 code (via mod): https://github.com/algernon-A/ZoningAdjuster — `Code/Patches/CreateZoneBlocks.cs`, `CalcBlock1Patch.cs`, `CalcImpl2Patch.cs`
- https://skylines.paradoxwikis.com/Roads · https://skylines.paradoxwikis.com/Zoning · https://skylines.paradoxwikis.com/Road_Editor · https://skylines.paradoxwikis.com/Asset_Editor
- https://cs2.paradoxwikis.com/Roads · https://cs2.paradoxwikis.com/Zoning
- https://colossalorder.fi/?p=1547 (CS2 dev diary #1 Road Tools) · https://www.paradoxinteractive.com/games/cities-skylines-ii/modding/dev-diary-3-code-modding
- Steam: https://steamcommunity.com/app/949230/discussions/0/4333105589465814156 · /3937895062998876459 · /3951406499785218787 · /3877095833475404466 · https://steamcommunity.com/app/255710/discussions/0/3151934575302426853 · /611701360840502796 · https://steamcommunity.com/workshop/filedetails/discussion/2852723058/3550553789954178305 · https://steamcommunity.com/sharedfiles/filedetails/comments/1586027591 · https://steamcommunity.com/sharedfiles/filedetails/changelog/1625704117
- Guides: https://www.ggrecon.com/guides/cities-skylines-elevate-roads/ · https://gamepretty.com/cities-skylines-ii-how-to-building-a-pedestrian-overpass/ · https://progameguides.com/cities-skylines-2/how-to-fix-slope-too-steep-in-cities-skylines-2/ · https://steamah.com/cities-skylines-ii-practical-engineering-efficient-grids-guide/
- three.js: https://github.com/mrdoob/three.js/blob/dev/src/textures/Texture.js · https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/KTX2Loader.js · https://discourse.threejs.org/t/basis-textures-with-alpha-appearing-fully-black-and-white-on-some-ipads-and-older-mobile-devices/22575
- GPU/Safari: https://bugs.webkit.org/show_bug.cgi?id=185272 · https://bugs.webkit.org/show_bug.cgi?id=300782 · https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_compressed_texture_astc · https://www.khronos.org/news/press/khronos-ktx-2-0-textures-enable-compact-visually-rich-gltf-3d-assets
- Marking render: https://research.ncl.ac.uk/game/mastersdegree/graphicsforgames/texturemapping/ · https://hub.jmonkeyengine.org/t/solved-texture-looks-blurry/23090 · https://godotshaders.com/shader/sdf-scalable-textures/ · https://redblobgames.com/x/2403-distance-field-fonts
- Blender/glTF: https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst · https://github.com/donmccurdy/glTF-Transform/blob/main/packages/cli/README.md · https://gltf-transform.dev/cli
