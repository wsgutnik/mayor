# Mayor 3D transport / infrastructure library

Contains **55 individually exported .glb models**, a JSON manifest, a procedural rebuild script, and a Blender import/assembly script. Geometry is color-coded 3D prototype mesh geometry; concept reference sheets are not 3D.

## Use in Blender
1. Unzip the package.
2. Blender GUI: **File → Import → glTF 2.0** and select any model from `assets/`.
3. To create one unified `.blend`, open a terminal in the unzipped folder:
   `blender --background --python assemble_in_blender.py`
4. To additionally generate 55 individual editable Blender files:
   `blender --background --python assemble_in_blender.py -- --individual`
5. Output: `Mayor_Transport_Library.blend` (all assets in categorized collections), `Mayor_Integrated_Demo.blend`, optionally `blend_files/*.blend`.

The `.blend` outputs are **not included in this zip** because Blender is not installed in the authoring environment. Scripts generate them on a Blender-equipped machine. Blender version 4.2+ recommended.

## Regenerate GLBs
`python -m pip install trimesh numpy` then `python build_transport.py`.

## World contract
Meters, Z up, forward -Y; each isolated asset is centered close to its origin. Car and truck wheel ground Z=0. The Blender library places them in a display grid; those offsets are preview-only. GLB assets are not physically simulated or animated.

## Directory
- `assets/*.glb`: 55 individually importable 3D meshes
- `asset_manifest.json`: stable prefab identifiers, dimensions and categories
- `build_transport.py`: procedural source
- `assemble_in_blender.py`: creates Blender projects
- `city_hall/`: existing City Hall geometry to integrate
- `docs/INTEGRATION_PLAN.md`: pipeline and implementation phases
- `references/`: generated style boards
