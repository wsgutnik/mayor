# MAYOR — Starter Map Kit

Four procedurally generated, original terrain maps for prototyping the MAYOR game.

## Folders
Each map includes:
- `heightmap_16bit.png`: **a real 16-bit grayscale image**, 1024x1024. Bright pixels = high elevation. PNG mode `I;16`, no RGB data.
- `heightmap_preview_8bit.png`: a preview for visually inspecting the relief only, with gamma applied for viewing. It does not replace the 16-bit heightmap.
- `terrain_preview.png`: colored top-down view for designers, **not** a heightmap.
- `water_mask.png`: 8-bit image; white marks water (ocean/rivers) and black marks land.
- `buildable_mask.png`: 8-bit image; white marks terrain that is tentatively buildable (limited by slope/water).
- `development_guide.png`: illustrative guide for placing neighborhoods and zones, **not** a road mesh.
- `map.json`: seed, suggested size, scale and technical notes.

## Scale and integration
Base resolution: 1024x1024 pixels. Suggested world: 8192x8192 meters (8 m/pixel). Reference maximum height: 600 m. Normalized sea level: 0.23 (16-bit ≈ 15073; 138 m on the reference scale).

Suggested pipeline (Unity/Godot/Unreal or a custom engine): (1) import the 16-bit heightmap, (2) scale the terrain to 8192 x 8192 m / 600 m vertical, (3) set up water from the mask and channels, (4) generate textures, trees and roads, (5) reserve roads and zones using the flat-terrain mask. Engines differ in formats and settings, so conversion to RAW/R16 and recalibration of the vertical axis may be needed.

Important: river water is a separate layer; each engine must generate the water flow/surface correctly. The buildable mask is indicative only; there is no real game simulation in it.

## The options
01 — Metropolitan Bay: commerce, tourism, port and islands.
02 — Green Valley: central river, mountains and dams.
03 — Blue Archipelago: islands, crossings and ports.
04 — Central Plain: easy to start, wide terrain.
