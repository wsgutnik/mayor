MAYOR — CITY HALL 3D ASSET (concept-to-mesh reconstruction)
========================================================

INCLUDED
Mayor_City_Hall.glb        Actual multi-part 3D model with vertex colors.
build_cityhall.py           Editable procedural geometry generator (Python + trimesh).
convert_to_blend.py        Blender importer, scene setup and .blend saver.
Reference_City_Hall.png    Original concept illustration (reference only).

FASTEST WAY TO USE IN BLENDER
Open Blender > File > Import > glTF 2.0 (.glb/.gltf) > Mayor_City_Hall.glb.
The model is composed of individually editable mesh objects.

TO CREATE A FULL .BLEND PROJECT (with labels, camera, lights)
From a terminal where Blender is installed:
  blender --background --python convert_to_blend.py
This creates Mayor_City_Hall.blend beside these files.
You can also run convert_to_blend.py from Blender's Scripting workspace.

COORDINATES
Z is up, Y negative is front, units interpreted as meters.
Footprint of building approx. 42 x 29 m, with a 56 x 48 m plaza.
Center clock tower rises to ~33 m including flag.

IMPORTANT
The mesh is an original manually/procedurally modeled approximation of the
illustration, not an automatic photogrammetry reconstruction or a polygon-perfect
copy. Geometry is suitable as a foundation for game-oriented Blender editing.
Geometry is not yet UV-unwrapped, optimized into LODs, or collision-meshed.
For performance, consolidate small elements and add LODs before production use.
