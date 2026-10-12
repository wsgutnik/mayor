# Third-party assets (CC0)

| Folder | Source | License |
|---|---|---|
| `kenney-city-kit-roads/` | Kenney, City Kit Roads 2.2 — https://kenney.nl/assets/city-kit-roads (GLB only) | CC0 |
| `polyhaven-asphalt_02/` | Poly Haven, asphalt_02, 1k diffuse / normal (GL) / roughness — https://polyhaven.com/a/asphalt_02 | CC0 |

Source files only: the game does not load them directly. `blender/` scripts retint and budget them into `public/models/props/` and `public/textures/`.
| `mayor-road-kit/` | "MAYOR Road Kit" v0.1.0 (user-provided, generated for this project; "usable in MAYOR") — props, tunnel portal, bridge pieces only | project-internal |
| `mayor-transport-pack/` | "Mayor Transport Blender Pack v01" (55 vehicles and street furniture GLBs, user-provided, generated for this project) — conversion source only | project-internal |
| `mayor-city-hall/` | "Mayor City Hall" 6.5k-triangle GLB (user-provided) — reference for kit entry 21 | project-internal |

Note: the transport pack's vehicle meshes (880-2100 triangles, 24-65 parts) did not survive automatic decimation (wheels and windows were lost), so `blender/props_fleet_vehicles.py` rebuilds the shapes parametrically at 130-260 triangles; `blender/props_fleet.py` still converts the street furniture.
