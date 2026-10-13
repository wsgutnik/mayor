# MAYOR • ROAD BUILDER ASSET PACK v0.1

**40 usable original 3D assets** in `.glb`, assembled from editable procedural geometry. The pack includes street sections, curved roads, highway pieces, basic intersections/roundabouts, bridge approaches and urban props. These are *prototype components*; automatically joining full road networks in-game will require a procedural mesh and lane-graph upgrade.

## Start in Blender

1. Unzip `MAYOR_Roads_Blender_Kit.zip` to a local folder. Do not move the `manifest.json`, `glb/` or `scripts/` subfolders separately.
2. Blender: File > Import > glTF 2.0 (`.glb`) and select a desired file in `glb/`.
3. To import all 40 with categories and create a source `.blend`, open Blender **Scripting**, open `scripts/blender_import_pack.py`, Run Script. The script expects to be run from its own path. It saves `MAYOR_Roads.blend` beside the manifest. If Blender cannot resolve script path, set the `MAYOR_ROAD_KIT` environment variable to the unzipped folder.
4. Use the imported scenes / Collections to edit materials, UVs and geometry, then export individual optimised GLBs to your game.

## Via your local Blender MCP

- Install the *official community repository* MCP bridge (not a commercial 3D image generator): https://github.com/ahujasid/mcp-for-blender
- macOS (with `uv` installed): `uvx mcp-for-blender setup` (or manual `uvx mcp-for-blender install-addon` and `claude mcp add blender uvx mcp-for-blender`).
- In Blender, turn on the MCP for Blender addon; `N` > MCP for Blender if necessary. Start MCP Server if not already running.
- Set `MAYOR_ROAD_KIT` to the local absolute path. Ask the MCP client to **inspect scripts first** and run `scripts/blender_import_pack.py` inside Blender; `scripts/blender_mcp_sample.py` provides a reference execution pattern. Never expose Blender's scripting port on an untrusted network.
- Telemetry / safety settings and client behaviour vary by MCP version. Confirm permissions before running arbitrary Python.

## Core details

- Units: metres, GLB (glTF **Y-up**), imported into Blender as **Z-up**.
- All roadway pieces are original authored low-poly meshes and use embedded vertex colour materials — no copyrighted game art or externally downloaded models bundled.
- `manifest.json` includes category, triangle count, lane directions, connection endpoints, bounding box, SHA-256.
- Important: the curved pieces/roundabouts are **sample prototypes**, not yet seamless parametric runtime road stitching. The game must enforce topological snapping and intersection/bridge routing.
- Some pieces illustrate asymmetrical lane layouts/sidewalks on a single centerline; these are intentionally not detailed car-navigation lanes, their graph is metadata for the next engine implementation.

## Regenerate originals (no Blender needed)

`python -m pip install numpy trimesh`

`python scripts/build_road_kit.py`

## Recommended MAYOR repo integration

Place the geometry under `cities-skylines-2/public/models/roads/` and `manifest.json` under `cities-skylines-2/public/models/roads/manifest.json`, then implement a Three.js GLTFLoader preview to assess scale. Keep the original Blender `.blend` under `cities-skylines-2/art/roads/blender/` and follow `docs/ROAD_NETWORK_ARCHITECTURE.md` for integration stages.

## Contact sheets

`previews/MAYOR_Roads_Overview_1.png` and `_2.png` show two pages of model thumbnails (synthetic local renders).

### Single-file showroom

`glb/MAYOR_Roads_Showroom.glb` imports every component as a spaced-out gallery into Blender in one import. For collection-level labels and custom MAYOR connector metadata, prefer running `scripts/blender_import_pack.py` instead. The showroom is a demo gallery, not a single gameplay mesh.

### Example runtime preview

`scripts/threejs_road_preview.ts` is an optional, unintegrated Three.js model-loader example. Calibrate `metresPerWorldUnit` before trying the meshes on MAYOR's simulation terrain.
