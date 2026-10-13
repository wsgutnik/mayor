# Building quality report (Cycle 1 baseline)

Source: `scripts/audit-visual-assets.mjs --strict` (geometry) and a Blender two-angle preview of all 40 GLBs
(front-right `NN.png`, back-left `NN_b.png`, identical lighting and framing). Observations are from those previews,
not from in-game captures; hardware performance was **not** measured.

## Baseline facts

- 40/40 GLBs present, parse and sit inside the unit tile; 0 errors, 0 warnings (all models use UVs and normals).
- Triangles: 167–444 per building (total 12,446, max 444 of the 450 test limit). Every model has 11–25 materials; no
  embedded textures (the game applies the shared pattern textures at load time); no LOD nodes; no duplicated geometry.
- Every model uses the full 0.96 × 0.96 plot pad; towers #20 (2.07), #10 (1.53), #7 (1.34) are the tallest.

## Cross-cutting findings

1. **Blank rear and side facades.** Almost every model is detailed on the front and a plain wall on the back/side;
   the game camera orbits, so this is the most visible defect (affects ~30 of 40).
2. **Repeated silhouettes.** #05/#06/#07/#08, #11/#13/#19 and #16/#18 are the same box with different decals.
3. **Flat roofs and eaves.** Roofs are single flat planes without parapets, eaves or equipment on most buildings.
4. **Scale.** Services such as the hospital (#27), city hall (#21) and corporate tower (#20) read small next to
   houses; they need larger or multi-tile footprints (asset metadata now carries `footprint`).
5. **Ground contact.** Every building sits on its own plot pad, which is good, but pad edges do not align with the
   sidewalk of oriented lots; driveways/plazas are absent outside the hero models.
6. **Night.** `glow_*` windows work; unlit rear windows make the back of each building dark.

## Per-building table

| ID | Building | Cat | Tris | Mats | Observed issues | Priority | Recommended action |
|---|---|---|---|---|---|---|---|
| 01 | Starter House | R1 | 403 | 17 | Good silhouette; rear facade is a blank wall; roof flat-shaded, no eaves; small yard | A | Hero v2 (in progress): garage, driveway, eaves, 4-6 style variants |
| 02 | Family House | R1 | 403 | 19 | Rear wall with only a few windows; hip roof without eaves; reads as #01 recoloured | A | Style variants (roof/wall/plot), rear windows, driveway |
| 03 | Modern Townhouse | R2 | 307 | 19 | Strong front, flat grey rear; no rooftop terrace; shares footprint idiom with #04 | B | Rear window pass, terrace, planter |
| 04 | Semi-detached Villa | R2 | 359 | 17 | Two halves nearly identical; party wall reads as a stripe; blank rear | B | Mirror-variation of halves, entry porches, gates |
| 05 | Small Apartment | R3 | 302 | 15 | Slab with blank rear; balconies only on the front; low roof detail | A | Rear/side windows, stair core, roof equipment, entrance canopy |
| 06 | Garden Condominium | R3 | 400 | 14 | Rear blank; 'garden' is a few trees; no courtyard | B | Courtyard + paths + parking pad; rear balconies |
| 07 | Compact Tower | R4 | 364 | 15 | Thin slab, rear is a dark stripe; repeats #05/#06/#08 silhouette | A | Silhouette change (setbacks), facade fins, LOD1/2 shaped like the tower |
| 08 | Balcony Residence | R3 | 370 | 14 | Green roof is a flat slab; rear blank; balconies uniform | B | Roof garden pergola, varied balcony rhythm |
| 09 | Local Mixed-use Building | R4 | 220 | 15 | Mixed-use box with floating rooftop units; ground-floor shops flat decals; rear blank | A | Shopfront recess, signage, side windows, parapet |
| 10 | Premium Tower | R5 | 408 | 14 | Slim slab; balcony rail only on one face; green roof flat; reads thin in scale | A | Hero v2 (in progress): podium, penthouse, balconies, varied facade |
| 11 | Convenience Store | C1 | 297 | 19 | Flat box with sign; parking pad ok; rear blank; repeats #13/#19 shape | A | Glazed front, canopy, pump-less forecourt, rear service door |
| 12 | Corner Café | C1 | 431 | 19 | Best-detailed commercial; rear is a blank dark box; tables/umbrellas are good | B | Rear/side windows; keep |
| 13 | Local Market | C2 | 302 | 18 | Box with green awning; reads as #11 recoloured; no loading dock | A | Loading bay, crate stack, roof signage, silhouette change |
| 14 | Urban Restaurant | C2 | 190 | 12 | Timber facade good; rear blank; night glow ok | B | Rear windows, terrace railing |
| 15 | Neighbourhood Pharmacy | C1 | 192 | 14 | Red band reads as stripe; floating canopy corner; rear blank | A | Cross sign, entrance recess, parking |
| 16 | Compact Office | C2 | 206 | 14 | Glass strip good; rear/sides plain; same silhouette as #18 | B | Curtain-wall variation, rooftop plant |
| 17 | Local Bank | C2 | 266 | 14 | Columns read well; rear plain; roof flat | B | Pediment, steps, vault detail |
| 18 | Executive Hotel | C3 | 287 | 14 | Brown stripe on the rear; plain; identical bulk to #16 | B | Marquee, rooftop sign, balcony rhythm |
| 19 | Neighbourhood Mall | C3 | 190 | 12 | Flat wide box; signs are flat decals; no parking/plaza despite description | B | Plaza, entrances, parking, roof units |
| 20 | Corporate Tower | C4 | 374 | 14 | Narrow tower (2.07 tall) with sparse rear glow; base small; lacks lobby | A | Hero v2 (in progress): curtain wall, lobby, crown |
| 21 | City Hall | S3 | 240 | 14 | Reads civic but small and boxy; no plaza; tower is a cube | A | Hero v2 (in progress): portico, plaza, clock tower |
| 22 | Public Library | S2 | 208 | 13 | Brick corners good; roof glass odd; rear plain | B | Entrance, reading garden, roof detail |
| 23 | Community Centre | S2 | 200 | 15 | Asymmetric; rear/side plain; low presence | B | Scale/plaza, accessibility ramp, canopy |
| 24 | Police Station | S3 | 431 | 18 | Blue front good; rear plain; no garage presence | B | Garage doors, patrol cars, flagpole detail |
| 25 | City Museum | S3 | 254 | 16 | Good pediment/atrium; rear plain; no plaza | B | Plaza, steps, banners |
| 26 | Clinic | S2 | 218 | 15 | Cross sign good; rear a grey box; small | B | Ambulance bay, canopy, rear windows |
| 27 | General Hospital | S4 | 298 | 12 | Footprint inside one tile reads small for a hospital; rear blocky; no ambulance zone | A | Multi-tile footprint (2x2) candidate, helipad, ambulance bay |
| 28 | Primary School | S2 | 214 | 16 | Gate readable; no playground; rear plain | B | Playground, court, fence |
| 29 | Secondary School | S3 | 200 | 14 | Three volumes ok; no sports field; rear plain | B | Sports court, annex variation |
| 30 | Fire Station | S3 | 333 | 15 | Tower and doors read well; rear plain; trucks small | A | Truck apron, hose tower detail, roller doors |
| 31 | Bus Station | T2 | 444 | 22 | Canopy good; bays flat; rear blank | B | Bays, platform numbers, shelter |
| 32 | Train Station | T3 | 440 | 25 | Good silhouette; rear plain; track absent | B | Platforms, footbridge, rails |
| 33 | Cargo Terminal | T3 | 438 | 24 | Busy yard good; container rear plain; no dock detail | B | Dock doors, semis, crane |
| 34 | Water Treatment Plant | U3 | 363 | 12 | Tank and tower read; pipes thin; rear plain | B | Tanks, pipework, fence, clarifier pools |
| 35 | Electrical Substation | U2 | 337 | 11 | Pylons read; transformers boxes; rear similar | B | Insulators, busbars, fence |
| 36 | Logistics Warehouse | I1 | 347 | 15 | Good shed + docks; rear plain; trailers small | A | Dock doors, roof ribs, trailers |
| 37 | Light Factory | I2 | 349 | 17 | Sawtooth + chimney good; rear fine | A | Pipes, vents, parking |
| 38 | Heavy Factory | I4 | 432 | 13 | Silos/chimneys good; rear plain; yard small | A | Hero v2 (in progress): pipes, tanks, service road, loading |
| 39 | Recycling Centre | U3 | 167 | 14 | Container yard readable; roof plain; green saturated | B | Sorting line, conveyor, bales |
| 40 | Thermal Power Plant | U4 | 262 | 13 | Cooling towers readable; thin stack; plant buildings plain | B | Boiler hall, pipe racks, coal yard |

Priority: **A** most visible in a typical city / hero candidate, **B** context value, **C** polish.
All ranks are inputs to Cycle 2; the five reference buildings (#01, #10, #20, #21, #38) are being rebuilt as
non-destructive `v2` variants (see `docs/VISUAL-UPGRADE-ROADMAP.md`).
