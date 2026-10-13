# MAYOR — Visual Asset Audit (Cycle 1)

Status: implementation prepared for local verification. This document does **not** claim that Blender, tests, or the game were run.

## Scope

- Catalog IDs 1–40 remain unchanged; saves and simulation unaffected.
- `scripts/audit-visual-assets.mjs` reads all existing `public/models/*.glb` and `public/models/props/*.glb` without altering them.
- Reports triangles, mesh count, GLB size, material names, UV absence, non-finite positions, and world bounds. Missing models, corrupt GLBs, current tile-bound violations, and >450 building triangles are errors.
- `src/render/building-inventory.test.ts` checks catalog IDs, complete set of 40 GLBs, and their parseability.
- This deliberately does not modify asset meshes, renderer behavior, gameplay, procedural fallback, or the 450-triangle budget.

## Run locally

```bash
npm ci
node scripts/audit-visual-assets.mjs --strict --json docs/asset-audit.json
npx vitest run src/render/building-inventory.test.ts src/render/glb-assets.test.ts
npm run ci
```

The JSON report is generated only when requested. Review it before committing; avoid committing machine-generated measurements until verified. `--strict` fails the command for error-level findings. Warnings need human review.

## Manual Blender and in-game review

1. Run `blender -b --factory-startup --python blender/build_all.py -- --previews /tmp/mayor-model-previews --out /tmp/mayor-models`.
2. Review the script's `inside_tile`, bounds, and triangle output. It currently reports out-of-bounds issues but does not stop the export on them.
3. Compare the generated previews to catalog images and record two angles per representative model (house #01, tower #10, city hall #21, office #20, factory #38).
4. Launch the game at fixed camera distance and light time. Check shadows, building orientation, scale, terrain contact, and missing textures in both classic and experimental oriented-lot modes.
5. Profile city sizes with multiple thousands of lots on Mac and real iPad hardware before raising LOD0 budgets.

## Findings from static code review

- Existing GLB tests accepted any nonzero number of buildings. The new coverage test closes this integrity gap.
- `blender/registry.py` registers model functions by numeric ID; `buildings_zz_hero.py` overrides simpler versions via import order. Follow-up: explicit asset variant/version registry.
- `blender/build_all.py` calls `check_bounds`, but does not fail export if the result is false. Follow-up: optional strict export mode.
- Existing far-building LOD uses generic boxes; follow-up: silhouette-preserving LOD1/LOD2.
- The `CityRenderer` maintains many rendering subsystems together; follow-up: extract an asset manager without touching the deterministic sim.
- Current Blender bounds and scale are normalized per tile, and some larger facilities need designed multi-tile footprints after compatibility work.

## Next change set

After validation, introduce a versioned asset manifest and scene-based visual regression previews. Keep original catalog IDs and a fallback path for old saves. A separate PR should implement new models and PBR materials after a measured Mac/iPad rendering baseline.

## Acceptance gates

- 40/40 catalog files present and parseable.
- Zero error-level findings from `--strict`.
- Existing GLB and gameplay tests pass.
- Visual review screenshots for five representative buildings in near/mid/far camera views.
- No changes to simulation files or saved-city format in Cycle 1.
