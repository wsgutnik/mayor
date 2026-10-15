# 24 — Service usage numbers, tier balance and service models

Owner request (three items after the 41-84 expansion): every service building shows its numbers of use, the new tiers
are balanced against the old kinds, and the new structures render at the size of their family.

## 1. Numbers of use: one shared function

`src/sim/facility-usage.ts` exports `facilityUsage(kind, at?)`, a pure function used by both surfaces:

- **Build tooltip** (`src/ui/hud.ts`, no `at`): cost, upkeep, capacity or radius, footprint and the estimate
  "at full capacity" (networked utilities) or "at full coverage" (radius services).
- **Inspector** (`src/sim/inspect.ts` → `TileInfo.usage`, rendered by `src/ui/inspector.ts`): the same plus live
  numbers for the placed facility.

Rows are formatted once in `src/ui/facility-usage-view.ts` (`usageRows`), so the tooltip and the inspector never
disagree. Every string is in `src/i18n.ts` (pt-BR and English); `facility-usage-view.test.ts` checks both the
usage strings and every tool label and hint.

| Mode | Kinds | Live numbers (inspector) | Estimate (tooltip) |
|---|---|---|---|
| network | power, solar, large power, water pump, water tower, large water, sewage | in use = this facility's capacity share of the pooled network demand (`load / capacity`), "not connected" when no road within 5 tiles, network supply and demand, lots/residents/jobs served (capacity share of the lots the network covers) | homes = `floor(capacity / demandOf(RES, 1))`, residents = homes × `CAPACITY.res[1]` |
| relay | substation | network supply and demand, lots the network serves | "relays the network, adds no supply" |
| garbage | landfill | in use (pooled garbage demand share), lots/residents in its radius | min(radius estimate, capacity estimate) |
| coverage | police, fire post/station/HQ, clinic, hospital, schools, park, library, community, museum | lots, residents and jobs inside the coverage disc (same disc as `updateCoverage`) | tiles in the disc × `BUILDABLE_SHARE` (0.5) level-1 homes |
| transit | metro, train station | the disc as above, plus the station stop, lines calling there, their vehicles and seats/day, riders/day (city riders × this station's share of the fleet) | as coverage |
| citywide | city hall | every built lot and the population | "whole city" |

Residents are `CAPACITY.res[level] × occupancy` per tile (`occupancy = population / housing capacity`), the same
model `recount` uses. Lots are counted once whatever their size (`w.lotAt`).

## 2. Bugs found while wiring the numbers

The "new tiers show no numbers" report had two simulation causes, both fixed:

1. `recount` (`src/sim/sim.ts`) only added supply for kinds `<= FAC.LANDFILL`: solar, large power, water tower and
   large water plant supplied **nothing** to `s.utilities`, so the services panel never counted them. Supply now
   follows `facilityUtility(kind)` (from the coverage bit) for every kind with capacity.
2. `updateNetworkCoverage`'s fast path (`src/sim/networks.ts`) only looked for kinds 1, 2, 3, 17: a city powered only
   by a solar plant or watered only by a tower never flooded its network. It now uses `isNetworkedFacility`.
   Network sources are derived from `FACILITY_INFO` (`networkSources`), so the next tier cannot be forgotten.

Regression tests: `facility-usage.test.ts` ("tier utilities reach the city").

## 3. Tier balance (docs table; values in `FACILITY_INFO`, `src/sim/world.ts`)

The expansion shipped solar 180 > coal 120 and tower 160 > pump 90, inverting the families. Fixed values:
solar 80 (cost 1000, upkeep 30), water tower 60 (cost 450, upkeep 28). Order now holds in every family and is
asserted by `service-tiers.test.ts` and `facility-usage.test.ts`:
solar < plant < large plant; tower < pump < large water plant; fire post < station < HQ (radius and upkeep).

| Building | Kind | Mode | Footprint | Cost | Upkeep/mo | Capacity | Upkeep per unit | Radius | Tiles reached | Serves ~homes / ~residents (estimate) |
|---|---|---|---|---|---|---|---|---|---|---|
| Solar plant | FAC.POWER_SOLAR | network | 2x2 | $1000 | $30 | 80 | 0.38 | roads | - | ~40 / ~320 |
| Power plant | FAC.POWER | network | 2x2 | $800 | $60 | 120 | 0.50 | roads | - | ~60 / ~480 |
| Large power plant | FAC.POWER_LARGE | network | 2x2 | $3200 | $140 | 380 | 0.37 | roads | - | ~190 / ~1520 |
| Substation | FAC.SUBSTATION | relay | 1x1 | $300 | $20 | - | - | roads | - | relays only |
| Water tower | FAC.WATER_TOWER | network | 1x1 | $450 | $28 | 60 | 0.47 | roads | - | ~30 / ~240 |
| Water pump | FAC.WATER | network | 2x2 | $500 | $40 | 90 | 0.44 | roads | - | ~45 / ~360 |
| Large water plant | FAC.WATER_LARGE | network | 2x2 | $1500 | $80 | 260 | 0.31 | roads | - | ~130 / ~1040 |
| Sewage outlet | FAC.SEWAGE | network | 1x1 | $400 | $40 | 90 | 0.44 | roads | - | ~45 / ~360 |
| Landfill | FAC.LANDFILL | garbage | 1x1 | $300 | $30 | 80 | 0.38 | 12 | 441 | ~40 / ~320 |
| Fire post | FAC.FIRE_POST | coverage | 1x1 | $300 | $25 | - | - | 8 | 197 | ~98 / ~784 |
| Fire station | FAC.FIRE | coverage | 1x1 | $600 | $50 | - | - | 12 | 441 | ~220 / ~1760 |
| Fire headquarters | FAC.FIRE_HQ | coverage | 2x2 | $1500 | $110 | - | - | 20 | 1257 | ~628 / ~5024 |
| Police station | FAC.POLICE | coverage | 1x1 | $600 | $50 | - | - | 12 | 441 | ~220 / ~1760 |
| Clinic | FAC.CLINIC | coverage | 1x1 | $700 | $60 | - | - | 12 | 441 | ~220 / ~1760 |
| General hospital | FAC.HOSPITAL | coverage | 2x2 | $1800 | $130 | - | - | 18 | 1009 | ~504 / ~4032 |
| School | FAC.SCHOOL | coverage | 1x1 | $900 | $70 | - | - | 14 | 613 | ~306 / ~2448 |
| Secondary school | FAC.HIGHSCHOOL | coverage | 2x2 | $1400 | $100 | - | - | 20 | 1257 | ~628 / ~5024 |
| Park | FAC.PARK | coverage | 1x1 | $150 | $10 | - | - | 8 | 197 | ~98 / ~784 |
| Public library | FAC.LIBRARY | coverage | 1x1 | $700 | $40 | - | - | 12 | 441 | ~220 / ~1760 |
| Community centre | FAC.COMMUNITY | coverage | 1x1 | $500 | $30 | - | - | 10 | 317 | ~158 / ~1264 |
| City museum | FAC.MUSEUM | coverage | 1x1 | $1500 | $90 | - | - | 16 | 797 | ~398 / ~3184 |
| Metro station | FAC.METRO | transit | 2x2 | $1200 | $60 | - | - | 9 | 253 | ~126 / ~1008 |
| Train station | FAC.TRAIN_STATION | transit | 2x2 | $2000 | $90 | - | - | 12 | 441 | ~220 / ~1760 |
| City hall | FAC.CITYHALL | citywide | 2x2 | $2500 | $150 | - | - | city | - | whole city |

Design reading: the small tier of each utility costs more per unit to run but needs less (solar: no smoke, highest
build cost per unit; tower: no shoreline); the large tier is the cheapest per unit but a big up-front cost. Coverage
tiers get cheaper per covered tile as they grow (post $0.127, station $0.113, HQ $0.088 per tile per month).
The networked "radius" column in FACILITY_INFO is unused by the simulation (networks follow the roads) and is not
shown anywhere.

## 4. Service models and sizes (item 3)

Cause of "the new structures render smaller": none of the seven new kinds had a Blender model, so they showed the
procedural stand-ins (about 0.5 to 0.7 tile wide; 2x2 kinds scaled by 1.8). A second, wider bug: since street-frame
snapping every placed facility carries an anchor, and the renderer enlarged *every* anchored facility by the 2x2
fallback scale 1.8 until an x2 model loaded, which never happens for 1x1 kinds — kit 1x1 services rendered 1.8x too
large, overflowing their tile, next to a correctly sized new kind. `facilityFallbackScale` now enlarges only 2x2
kinds.

Model resolution is one pure function, `facilityModelPlan` (`src/render/facility-models.ts`):
2x2 → `models/x2/NN.glb`; 1x1 kit (1-40) → `models/NN.glb` via the Visual V2 manifest gate; 1x1 expansion (41-84) →
`models/x1/NN.glb` (a new directory, so the 40-file kit inventory test stays exact). `facility-models.test.ts`
checks that every kind resolves to a shipped file of its footprint (sewage outlet and park keep their procedural
models: they have no kit entry), that the x1 models stay inside the tile and fill at least 0.85 of it, and that
the new x2 models fill the 2x2 footprint.

New recipes in `blender/buildings_services_tiers.py` (registry now accepts variant numbers up to 84; `build_all.py`
exports `x1` variants to `models/x1/`):

| Kind | Asset | Footprint | Triangles | Height | Notes |
|---|---|---|---|---|---|
| Train station | x2/61 | 2x2 | 1256 | 1.31 | stone hall, clock tower, two covered platforms, regional train, footbridge |
| Solar plant | x2/73 | 2x2 | 1156 | 0.29 | seven rows of tilted panels, inverter house, transformer yard |
| Large power plant | x2/81 | 2x2 | 838 | 1.93 | twin tall cooling towers, turbine hall, stack (smoke source), switchyard |
| Large water plant | x2/82 | 2x2 | 1116 | 0.75 | six clarifiers, filter hall with skylights, reservoir tower |
| Fire headquarters | x2/83 | 2x2 | 1432 | 1.15 | four-bay engine hall, command block, drill tower, three engines |
| Water tower | x1/76 | 1x1 | 409 | 1.23 | steel tank on six legs, ladder, pump house |
| Fire post | x1/84 | 1x1 | 398 | 0.64 | single-bay station with hose tower, smaller than the fire station |

Footprints were already right for every role (fire post 1x1, station 1x1, HQ 2x2; solar, plant and large plant
2x2; tower 1x1; large water 2x2; train station 2x2) and are now asserted in `service-tiers.test.ts`. Previews:
`docs/img/models/{61,73,81,82,83}_x2*.png`, `docs/img/models/{76,84}_x1*.png`; in-game:
`docs/img/services/`.
