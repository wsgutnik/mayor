# 16b — Landmark model recipes

Landmarks are named Blender assets, exported as `public/models/landmarks/<slug>.glb` rather than catalog buildings. All use Blender `z=0`, frontage `-Y`, a 0.04-tile site-edge clearance, and a paved arrival edge on the street side. The 2x2 sites remain within `[-1.01,1.01]`; 4x4 sites within `[-2.01,2.01]`. Each model touches the ground and is measured by `landmark-assets.test.ts` after export: 2x2 assets are at most 1400 triangles and 4x4 assets at most 2800.

The visual hierarchy is deliberately silhouette-first: a roof/crown/spire must identify the civic type at game zoom, while glowing panes and lanterns, doors, trees, steps and street-side plazas give it a readable close/night pass. Facades use the existing `glow_window_*` families through `Model.windows`; separate glow lamps/signs are used only as civic accents.

| Model | Footprint | Intent / numeric recipe | Expected previews |
| --- | --- | --- | --- |
| `landmark_opera` | 2x2 | Three 0.48–0.62 wide, 0.55–0.82 high offset sail shells over a glazed 1.54×0.86 foyer and broad steps. | `landmark_opera.png`, `landmark_opera_b.png` |
| `landmark_cathedral` | 2x2 | 0.92×1.35 nave, pitched roof, two 1.20-high spires, buttresses and glowing rose window. | `landmark_cathedral.png`, `landmark_cathedral_b.png` |
| `landmark_artdeco` | 2x2 | 1.34 podium, three setbacks (0.78/0.54 widths), gold crown band and spire. | `landmark_artdeco.png`, `landmark_artdeco_b.png` |
| `landmark_hotel` | 4x4 | 3.20×2.45 hotel podium, central mansard block, two wings, porte-cochere, arrival fountain and trees. | `landmark_hotel.png`, `landmark_hotel_b.png` |
| `landmark_conservatory` | 2x2 | Low stone plinth, 12-sided glazed dome with metal ribs, palms and illuminated entry. | `landmark_conservatory.png`, `landmark_conservatory_b.png` |
| `landmark_clocktower` | 2x2 | Arcaded base, 1.40-high square tower, two luminous clock faces and copper-green roof/spire. | `landmark_clocktower.png`, `landmark_clocktower_b.png` |
| `landmark_observatory` | 2x2 | Colonnaded 1.46×1.20 base, 12-sided dome and a dark telescope shutter slit. | `landmark_observatory.png`, `landmark_observatory_b.png` |
| `landmark_palace` | 4x4 | Central hipped hall plus symmetric wings around a planted formal court, fountain and glow-accented gate. | `landmark_palace.png`, `landmark_palace_b.png` |

## Invariants and inspection

- Registration refuses a duplicate slug or a footprint other than 2x2/4x4; export writes `landmarks/manifest.json` with footprint, bounds and measured triangles.
- The exporter runs the same `lib.check_bounds()` gate as evolved sites (including height and ground-contact bounds) before enforcing the footprint-specific triangle cap.
- Existing evolved x2 sites retain the 1.96 plinth and x4 sites the 3.96 plinth. Their revised recipes add setbacks/corner wings, awnings, alternating balconies, crown/green roof patches and intentional arrival planting without changing lot/save contracts.
- After regeneration, inspect every `*_b.png` for rear/side facade continuity; in-game inspect all eight at day and night, game and close zoom. No Blender/Vite inspection is performed in this worktree by task instruction.
