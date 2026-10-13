# Asset architecture V2 (design, Cycle 2 target)

Status: **design + first increments**. Cycle 1 shipped the validation foundation (strict export, manifest, variant
registry). Nothing below changes the production renderer yet; each step is gated by a compatibility test.

## 1. Goals and non-goals

Goals: higher-quality GLB assets, three LODs, shared PBR materials, atlases with optional KTX2, realistic and
multi-tile footprints, deterministic variants per district, reusable props, instancing and a bounded GPU budget.
Non-goals: changing simulation, catalog IDs (1–40), the save format, or the existing renderer's instancing model.
Original procedural geometry or CC0/licensed resources only; no proprietary Cities: Skylines assets.

## 2. Current state (verified in code)

| Piece | Today |
|---|---|
| Build | `blender/build_all.py`: one `NN.glb` per kit number, `registry.building`, procedural, palette materials with vertex colours + shared pattern textures supplied at load time (`public/models/patterns.json`) |
| Load | `src/render/glb-models.ts` merges each GLB into one geometry with a material group per mesh (`mergeScene`), `kit-materials.ts` upgrades materials; a missing/corrupt file resolves `null` and the procedural model stays |
| Draw | one `InstancedMesh` per (model, material group); `lod.ts` swaps far buildings for one shared 12-triangle box |
| Budget | ≤450 triangles per building, footprint = one tile, all 40 models fill the 0.96 plot pad |

## 3. Asset model

```
AssetSpec (public/models/manifest.json, schema 1 → 2)
  n            kit number 1–40 (stable)           variant   "base" | "v2" | district style …
  version      integer, bumped on any geometry    footprint [w, d] in tiles (default [1,1])
  lods         ["NN.glb", "NN_lod1.glb", "NN_lod2.glb"]   tris per LOD, bounds, inside_tile
  materials    shared PBR set names               module    source file (provenance)
```

Rules:
- **Coordinate convention**: +Y up, base at 0, front −Z (Blender: +Z up, front −Y), 1 unit = 1 tile, footprint inside
  `|x|,|z| ≤ 0.5·footprint`. Enforced by `build_all.py --strict` and `building-inventory.test.ts`.
- **Variants never replace base.** `@building(n, name, variant="v2")` is exported to `variants/<variant>/NN.glb`
  (see `registry.VARIANTS`). Production is recoverable at any time.
- **Overrides are declared.** The old "last import wins" behaviour is logged (`REGISTRATIONS`, `OVERRIDES`) and
  `--strict` fails on an undeclared replacement.
- **Footprints.** Large facilities (hospital #27, city hall #21, plants #34/#40, stations #31–33) are candidates for
  2×2 or 2×1. A multi-tile model needs a lot planner that reserves the footprint; `lotFootprint` already walks lot
  tiles, so the sim side is a per-catalog `footprint` field plus classic/oriented placement support. Not enabled in
  Cycle 1 (would change save contents).

## 4. LOD

| LOD | Use | Triangles (proposal, to be benchmarked) |
|---|---|---|
| 0 | near camera | houses 1.5–4k, apartments 3–8k, towers 5–12k, civic 8–20k, industry 4–12k |
| 1 | mid distance | ~25% of LOD0, same silhouette, no small props |
| 2 | far | ~5%, silhouette + roof colour |

The proposal comes from the external audit and is a hypothesis: **no hardware benchmarking has been run**.
Integration is incremental: `lod.ts` today buckets by distance and uses one shared box for far buildings; LOD1/2
slots in as additional `InstancedMesh` buckets per model, falling back to today's box when a model has no LOD files.

## 5. Materials and textures

- Keep the current shared palette (`lib.PALETTE`, `patterns.json`) as the **fallback**; add a small PBR set
  (albedo/normal/ORM) per family (brick, concrete, plaster, roof tile, glass, metal) in one atlas per family.
- Roughness/metalness conventions: neutral albedo, moderate normals, metalness only for metal/glass; `glow_*`
  emissive stays independent of the lights so night windows do not light the scene.
- Optional KTX2/BasisU: load through `KTX2Loader` only when the transcoder files exist and the device reports
  support; otherwise fall back to the PNG path. Mac/Windows/iPad all need a measured VRAM budget first.

## 6. Variants and district styles

Deterministic selection: `variant = hash(seed, lotId) % variants(n, style)`; `style` comes from a district tag
(never from RNG order), so cities are reproducible and old saves, which store only lot ids, keep working.
Styles are data (palette overrides + roof/facade variants), not new catalog IDs.

## 7. Props and instancing

Trees, street furniture and vehicles already instance per model. V2 adds: shared small-prop atlases; lot
decorations (driveways, plazas, fences) as separate low-cost meshes keyed by lot so they are not baked into the
building, which removes the blank-yard repetition and lets one building model serve many lots.

## 8. GPU memory management

Budget per quality profile (low/medium/high/ultra in `quality.ts`): texture bytes, instanced triangles, draw calls.
Report them from the audit script (`--json`), assert in tests, and dispose geometry/material on city swap (already
done for water and roads; models are process-lifetime).

## 9. Compatibility plan (incremental, each step test-gated)

1. ✅ Strict export, manifest, variant registry, two-angle previews, 40/40 tests (Cycle 1).
2. Loader reads `manifest.json` (optional); with no manifest it behaves exactly as today.
3. `?assets=v2` dev flag (and a pref) loads `variants/v2/NN.glb` where present, else base — A/B in the same city.
4. LOD1/LOD2 buckets in `lod.ts`, fallback to the shared box.
5. Atlas/PBR materials for the v2 family only; base untouched.
6. Footprint field in catalog + planner support (classic and oriented), behind a save-version bump.
