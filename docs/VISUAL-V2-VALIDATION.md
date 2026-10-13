# Mayor — Visual V2 Validation and Texture Quality Gate (Cycle 2B)

**Status:** implementation prepared and Python unit tests run against synthetic fixtures. Real Blender export, 15 production GLBs, 30 preview PNGs, hardware profiling and project-wide npm CI remain unverified.

This change is stacked onto the Visual V2 prototypes branch. It does **not** replace the 40 production assets, change functional catalog IDs, modify saves, or alter simulation.

## Delivered

- scripts/verify_v2_assets.py: validates all 15 GLBs and generates a deterministic asset-manifest.json, including SHA256, bytes, mesh count, triangle and vertex counts, material names, and Blender bounds.
- scripts/test_verify_v2_assets.py: seven local regression tests for missing, corrupt, missing-UV, mismatched-count, out-of-bounds, stale-manifest and deterministic cases.
- src/render/visual-v2-manifest.ts: validates manifest structure before using optional V2 assets. Production paths remain unchanged; invalid or missing preview assets safely fall back.
- src/render/visual-v2-manifest.test.ts: tests opt-in, manifest rejection and preview fallback.
- blender/build_v2.py: after execution in Blender, outputs consistent front-left and front-right camera angles for all 15 references — 30 images total.

The manifest is a packaging quality gate, not cryptographic browser-side verification of downloaded bytes.

## Local commands

Run from the repository root, on a machine with Blender and Node.js installed:

    python3 -m unittest discover -s scripts -p 'test_verify_v2_assets.py' -v
    python3 -m py_compile blender/visual_v2.py blender/build_v2.py scripts/verify_v2_assets.py
    blender -b --factory-startup --python blender/build_v2.py -- --out /tmp/mayor-v2 --previews /tmp/mayor-v2-previews
    python3 scripts/verify_v2_assets.py --dir /tmp/mayor-v2
    python3 scripts/verify_v2_assets.py --dir /tmp/mayor-v2 --check
    npm run ci

Only after inspecting all 30 images and the audit report, copy the validated 15 GLBs and asset-manifest.json into public/models/v2. Do not overwrite any production NN.glb. Test preview at http://localhost:5173/?visualV2=1 and verify normal loading without the query parameter.

## Five-building acceptance criteria

| ID | Geometry / silhouette | Material finish | Scene dressing |
| --- | --- | --- | --- |
| 01 Starter House | Split roofs, doorway, readable garage | Plaster, shingles, believable windows | Driveway, steps, trees |
| 10 Premium Tower | Podium, setbacks, offset upper volumes | Glass, balcony framing, rooftop finishes | Forecourt, AC equipment |
| 20 Corporate Tower | Distinct business tower and lobby | Curtain-wall glass, metal and concrete | Entrance, roof equipment |
| 21 City Hall | Wings, front portico and clock tower remain recognizable at far LOD | Masonry, roof, columns | Plaza, stairs, trees |
| 38 Heavy Factory | Chimneys and silos preserved at far LOD | Brick, steel, pipe materials | Loading docks and fences |

Inspect two angles, three distances, day and night, terrain contact, lighting and road alignment. The Blender static views do not substitute for actual game screenshots.

## Texture fidelity goals (future, not implemented claims)

| Material family | Maps to target | Resolution target |
| --- | --- | --- |
| Plaster, brick, concrete, timber | Base color, normal, roughness | Shared 512–1024 |
| Roof tiles, asphalt, paving | Base color, normal, roughness | Shared 512–1024 |
| Painted metal | Base color, roughness, metalness | Shared 512 |
| Glass | Tint, calibrated roughness, reflections | 256–512 |
| Windows and signs | Base color, night emission | 256–512 |

Maintain existing shared texture tier until comparative GPU measurements warrant PBR texture expansion. KTX2 is a proposal requiring real iPad tests, not an existing capability.

## Release gates

1. 15 actual GLBs exist, all verified against Blender build-report.json and materialized in a reviewable manifest.
2. Inspect 30 reference renders; silhouettes remain readable at every LOD.
3. Run Python syntax and unit tests, TypeScript checks and full npm CI; manually validate original saves and fallback behavior.
4. Capture representative real game screenshots at near, mid and far distances for both classic and oriented lots.
5. Profile Mac and iPad on representative maps and document draw calls, GPU memory if available, FPS, and frame spikes.
6. Implement automatic runtime LOD1/2 switching only **after** these gates pass.

## Branch dependencies

PR #1 remains the separate Cycle 1 draft. PR #2 contains the original V2 reference generators. This Cycle 2B branch is based on PR #2 and should not merge before PR #2 is validated and merged. Its intended next base is main once the prerequisite merges.
