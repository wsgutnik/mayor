# Mayor — Visual Asset Architecture V2 (Cycle 2)

Status: **prototype source code in a draft PR; no binary GLBs or Blender renders have been verified.**
Base: `main`. Cycle 1 audit remains a separate open draft PR and must be verified independently.

## Delivered in this cycle

- `blender/visual_v2.py`: five original reference-building generators: #01 Starter House, #10 Premium Tower, #20 Corporate Tower, #21 City Hall, #38 Heavy Factory.
- `blender/build_v2.py`: exports near/mid/far variants to an explicit output directory with bounding-box and triangle checks and a JSON build report.
- `src/render/visual-v2.ts`: typed, deterministic asset resolver and production fallback.
- `src/render/visual-v2.test.ts`: path, opt-in, invalid-ID, and fallback coverage.
- `src/render/scene.ts`: optional loading of V2 LOD0 when `?visualV2=1` is in the URL. Legacy models remain the default; absent prototypes fall back to existing `NN.glb`.

## Cycle 2B update (validation tooling; still a draft)

The opt-in runtime preview is now gated on the SHA256-containing asset manifest produced by `scripts/verify_v2_assets.py`. Missing or invalid manifests preserve the original GLBs. Blender export now defines front-left and front-right renders for each of the 15 reference models, totaling 30 previews after execution. The **source code and validation script are implemented**, but real Blender binaries, screenshots and hardware test results have not been verified. See [VISUAL-V2-VALIDATION.md](VISUAL-V2-VALIDATION.md).


| Tier | Design intention | Runtime status |
| --- | --- | --- |
| N0 | Basic blockout/placeholder, valid mass and scale | Existing procedural fallback |
| N1 | Production low-poly, shared patterned materials | Current production kit |
| N2 | Readable facade, proper entrance, window and roof detail | Reference prototypes introduce this |
| N3 | Material and urban dressing fidelity suitable for gameplay closeups | Target; requires renders and profiler |
| N4 | Landmarks with unique silhouette, entrance, signage, and contextual grounds | Target for city hall and key towers |

Important: N2–N4 are visual acceptance levels, **not triangle-count promises**. Polygon budgets are tested against real workloads; do not exceed the existing 450-triangle production limit until a compatible LOD pipeline is in place.

## LOD contracts

- **LOD0:** near camera; facade segmentation, doors/windows, roof equipment and site elements.
- **LOD1:** medium camera; preserve roofline, podium, main glazing and prominent attachments.
- **LOD2:** distant camera; retain roof silhouette, wings, chimneys, towers and industrial stacks. Never replace a unique landmark with an undifferentiated box.
- The reference script checks that triangle counts decrease (LOD0 >= LOD1 >= LOD2). It reports numeric bounds and aborts on invalid dimensions.
- This cycle only exercises **LOD0** in the game through the opt-in path. It **does not change the existing far-distance box LOD** yet. Implement asset-specific LOD1/LOD2 instancing as a separately tested step.

## Coordinate system and integration

Blender: X/Y are horizontal, Z-up, frontage toward -Y.
Runtime glTF/Three.js: X/Z horizontal, Y-up, frontage toward +Z.
The prototypes intentionally remain within the **legacy single-tile bounds** (-0.5...+0.5 horizontally, 0...2.6 high) so oriented and classic lots need no save migration. Larger true-to-scale 2x2 civic campuses and industrial facilities are **future work**, and must synchronize footprint, entrance, traffic access and terrain placement before activation.

No new functional building type is introduced. Catalog IDs remain stable. All source textures/material names are from the existing `lib.PALETTE` and `public/models/patterns.json` contract.

## Generate the 15 GLBs

On a machine with Blender installed, from repository root:

```bash
blender -b --factory-startup --python blender/build_v2.py -- --out /tmp/mayor-v2 --previews /tmp/mayor-v2-previews
```

Check `/tmp/mayor-v2/build-report.json`: expect IDs 01, 10, 20, 21, 38 and three LODs each; all models must be inside bounds and triangle counts decreasing.

Only after a human has inspected the previews, copy the validated prototype output to the game asset folder:

```bash
mkdir -p public/models/v2
cp /tmp/mayor-v2/*_lod*.glb public/models/v2/
npm run ci
```

To view LOD0 references in the browser, use `http://localhost:5173/?visualV2=1`. Remove the parameter to view production models. Until the GLBs exist, the app quietly falls back to production building GLBs. To test LOD1/LOD2, examine the Blender previews for now; live automatic switching is not part of this PR.

Do **not** overwrite `public/models/01.glb`, `10.glb`, `20.glb`, `21.glb`, or `38.glb`.

## Required verification before merge

1. Review the generator source and test Python syntax (`python3 -m py_compile blender/visual_v2.py blender/build_v2.py`).
2. Run export in Blender; verify bounds, hierarchy, materials, UVs, normals, mesh size and monotonic polygon reduction. Do not assert these from source alone.
3. Run `npx tsc --noEmit`, `npx vitest run`, `npm run ci`.
4. For each of the five assets, capture front/right, day/night and three zoom levels; compare to the original with same camera and light settings.
5. Confirm window lighting, terrain contact and orientation on curved and diagonal streets.
6. Profile 3,000 lots with mixed instancing on Mac, then real iPad before increasing geometry budgets. Record draw calls, triangles, VRAM, load time and FPS (iPad target >=45, Mac >=60 only after measuring).
7. Verify existing saves, classic zoning, and experimental oriented zoning. No simulation or save-format changes are allowed in this PR.

## Next implementation sequence

**C2-A (this PR):** source-only reference asset generators, safe opt-in preview resolution, and tests. Require local CI and Blender export before merge.

**C2-B:** persist validated 15 GLB files and screenshot baselines, create an asset registry with validated dimensions and material mappings. Preserve legacy fallback.

**C2-C:** add asset-specific LOD1/LOD2 instancing with performance instrumentation; only then consider lifting per-asset triangle budgets.

**C3:** after these five prove quality and speed, update the remaining 35 models in batches, then add procedural style/colour variants.

## Licensing

All reference-model geometry in `blender/visual_v2.py` is project-original. Do not copy game assets from Cities: Skylines I/II; consult `NOTICE.md` for any future third-party dependencies.
