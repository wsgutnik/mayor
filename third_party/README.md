# Third-party assets (CC0)

| Folder | Source | License |
|---|---|---|
| `kenney-city-kit-roads/` | Kenney, City Kit Roads 2.2 — https://kenney.nl/assets/city-kit-roads (GLB only) | CC0 |
| `polyhaven-asphalt_02/` | Poly Haven, asphalt_02, 1k diffuse / normal (GL) / roughness — https://polyhaven.com/a/asphalt_02 | CC0 |
| `public/env/kloofendal_48d_partly_cloudy_puresky_1k.hdr` | Poly Haven, Kloofendal 48d partly cloudy pure sky — https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | CC0 |

Source files only: the game does not load them directly. `blender/` scripts retint and budget them into `public/models/props/` and `public/textures/`.

## Fable Cities CC0 texture port

The following selected colour maps were copied from `/tmp/gh-refs/fable-cities/public/assets/`, resized to the
project's `_hd` convention (road/building maps at 1024 px maximum; terrain far-LOD maps at 512 px), and encoded as
PNG. Each source is listed in `public/assets/CREDITS.md` in the Fable Cities repository and is CC0 from ambientCG:

| Project file(s) | Fable source | Upstream / license |
|---|---|---|
| `public/textures/asphalt_hd.png` | `shared/asphalt_light/albedo.jpg` | ambientCG Asphalt031 — CC0 |
| `public/textures/kerb_hd.png` | `shared/concrete/albedo.jpg` | ambientCG Concrete034 — CC0 |
| `public/textures/sidewalk_hd.png` | `shared/paving_slabs/albedo.jpg` | ambientCG PavingStones070 — CC0 |
| `public/textures/brick_hd.png` | `shared/bricks_red/color.jpg` | ambientCG Bricks059 — CC0 |
| `public/textures/plaster_hd.png` | `shared/plaster_painted/color.jpg` | ambientCG PaintedPlaster017 — CC0 |
| `public/textures/roof_tile_hd.png` | `shared/roof_tiles_clay/color.jpg` | ambientCG RoofingTiles013A — CC0 |
| `public/textures/grass_hd.png` | `shared/Grass004/color.jpg` | ambientCG Grass004 — CC0 |
| `public/textures/sand_hd.png` | `shared/sand/color.jpg` | ambientCG Ground055S — CC0 |
| `public/textures/rock_hd.png` | `shared/Rock035/color.jpg` | ambientCG Rock035 — CC0 |
| `public/textures/dirt_hd.png` | `shared/Ground033/color.jpg` | ambientCG Ground033 — CC0 |

Every file under `public/textures/` is covered by this repository's texture credit test; existing project textures
retain their prior credits in `NOTICE.md`.

Credit coverage marker for the complete shipped texture tree: `public/textures/**`.
| `mayor-road-kit/` | "MAYOR Road Kit" v0.1.0 (user-provided, generated for this project; "usable in MAYOR") — props, tunnel portal, bridge pieces only | project-internal |
| `mayor-transport-pack/` | "Mayor Transport Blender Pack v01" (55 vehicles and street furniture GLBs, user-provided, generated for this project) — conversion source only | project-internal |
| `mayor-city-hall/` | "Mayor City Hall" 6.5k-triangle GLB (user-provided) — reference for kit entry 21 | project-internal |

Note: the transport pack's vehicle meshes (880-2100 triangles, 24-65 parts) did not survive automatic decimation (wheels and windows were lost), so `blender/props_fleet_vehicles.py` rebuilds the shapes parametrically at 130-260 triangles; `blender/props_fleet.py` still converts the street furniture.
