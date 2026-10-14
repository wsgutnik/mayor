# 14b — Evolved-footprint buildings

## Contract

`x2` and `x4` are non-base Blender registry variants. They are exported to
`public/models/x2/NN.glb` and `public/models/x4/NN.glb`, respectively, and
never replace `NN.glb`. Blender coordinates use `z=0` for the base and `-Y`
for the frontage; the renderer rotates the resulting GLB to the oriented-lot
frame, whose front is `+Z`. Each asset is centred on the lot and stays within
`[-1.01,1.01]^2` (x2) or `[-2.01,2.01]^2` (x4), with a 0.04-tile site edge.

The renderer uses a dedicated instanced pool per catalog id and footprint. If
an evolved GLB has not arrived (or fails to load), that pool retains the normal
kit geometry, so old bundles and old saves still render safely. Saves contain
only lot geometry and levels, not a model variant.

## Recipe and invariants

- x2: 1.96 square paving/asphalt plinth, 0.04 edge clearance, one 1.22–1.62
  main mass (industrial: loading face), street-side shared entrance at Y=-0.78,
  roof parapet/slab and AC plant. Residential masses use apartment bays, sills,
  plinths and balcony rails; shops use retail or curtain-wall bay families;
  factories use industrial bays.
- x4: 3.96 site with a 3.38 x 2.82 podium plus 1.72 x 1.54 setback tower, or
  two separated industrial halls around a 2.85 x 0.80 parking/service court.
  Trees/plaza or parking make the unused site area intentional rather than a
  scaled-up 1x1 cluster.
- No mass, balcony, roof plant, tree or stack crosses the footprint limit;
  all solid masses share the plinth at z=0. Asset checks assert bounds,
  ground contact, material presence and triangle caps. The build manifest
  records every variant footprint and measured triangle count.
- x2 is capped at 1400 triangles. x4 is capped at 2800: a single x4 instance
  replaces four clustered kit instances, so the allowance maintains lower
  instance/draw overhead while supporting an identifiable podium/campus site.

## Inventory and intent

| Family | x2 models | Intent |
| --- | --- | --- |
| Residential | 1–10 | Shared-entry courtyard apartment progression: houses become low podium apartments, then set-back balcony towers. |
| Commercial | 11–20 | Shopfront/plinth progression: local retail gains a unified glazed frontage; offices gain curtain bands and roof plant. |
| Industrial / utility-scale | 36–40 | Loading-hall progression: warehouse, factory, heavy plant, recycling and power use asphalt yards, loading face or stacks. |
| x4 residential | 5, 10 | Apartment campus and premium tower with planted podium plaza. |
| x4 commercial | 18, 20 | Executive hotel and corporate tower with glazed podium and arrival court. |
| x4 industrial | 37, 38 | Light-factory parking campus and heavy-factory service court with stacks. |

The hard visual inspection (day/night, game/close zoom) remains a lead task
after Blender regeneration; this worktree intentionally does not run Blender
or Vite.
