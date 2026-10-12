# MAYOR — Transport / World Asset Integration Plan v0.1

## Status and honest scope
- 55 **actual geometric** models exported as individual glTF GLB files with color-coded mesh materials, made procedurally. They are suitable as editable **blockout / prototype assets**, not photoreal or production-retopologized models. The prior reference images are **art direction**, not reconstructed geometry.
- These models were generated without running Blender. The included Blender automation script creates the native `.blend` library and optionally 55 individual `.blend` projects when executed on a computer with Blender 4.x/5.x.
- `Mayor_City_Hall.glb` from the previous user session is included as a separate reference asset in `city_hall/`.

## Standard coordinate contract (enforce globally)
- World units meters, Z up, X right, vehicle longitudinal axis Y, FRONT -Y, ground plane Z=0.
- Every asset uses an `ASSET_ROOT` parent with `mayor_asset_id` and `mayor_category` custom properties in Blender.
- Do not use catalog-preview offsets as actual game asset transforms. Ingest each GLB independently or reset its root to `(0,0,0)`.
- Separate rendering geometry from collision, anchors and simulation logic. Generated meshes have no physics colliders or rigging.

## Road / transport connection architecture
1. **Road edges as directed splines** with lane centerlines; each lane stores forward heading and speed limits. Junction graph nodes carry inbound/outbound lane connections.
2. **Vehicle instances** have geometry prefab `asset_id`, bounds, lane attachment, `route_id`, arc length along spline, speed, acceleration and safe-follow gap; use a single traffic simulation transform to drive the scene.
3. **Turn lanes and intersection connectors** are cubic Bezier (or clothoid) curves between lane end sockets. Signal phases gate entry into connector edges.
4. **Tractor and trailer**: treat semis as a single first-pass long rigid vehicle in simulation; next phase add trailer hitch socket + articulated kinematic follower (tractor kingpin -> trailer front anchor). The merged GLB assets are visual prototypes.
5. **Bus stop** attaches to sidewalk and a **curbside lane edge**: `stop_id`, `lane_id`, `s_m`, `door_side=right`, `dwell_seconds`, optional dedicated bay edge. Bus route graph is a sequence of stop identifiers linked with lane routes.
6. **Bus terminals** attach multiple bay/stop sockets to a depot route planner. Model passenger simulation and dwell times separately; stop furniture is visual only.
7. **City Hall** is a landmark service building: place on zoning-free civic lot, align entry to sidewalk network and provide pedestrian accessibility; never connect building meshes directly to lane physics.
8. **Terrain/roads** should own elevation and slope. Place street furniture on terrain via raycast, preserving 0.05m clearance to avoid z-fighting.

## Road width reference (verify against Mayor repo before wiring)
- Local lane width 3.25m, highway lane 3.65m, sidewalk width 1.8m, bus bay minimum width 3.2m, bus shelter rear setback >= 0.5m.
- Articulated buses and semis need longer turning paths, larger swept path envelopes, and curb avoidance; these numbers are proposal defaults, **not repository-verified**.

## Asset registry recommendation
`asset_id -> GLB URI, LOD GLB URI, dimensions, category, pivot rule, traffic class, appearance variants, collision proxy URI, optimization thresholds`

## Specific game connection mapping
| Prefab category | Simulation owner | Network attachment | Suggested initial rule |
|---|---|---|---|
| Cars/taxis/police/ambulance | TrafficManager | directed lane edge | regular traffic except emergency override |
| Cargo/maintenance trucks | Freight/Service dispatch | lane + facility driveway | spawn from depots/facilities |
| Semis/trailers | Freight logistics | road freight network | prevent small-road turns by restrictions |
| Buses | TransitManager | route segments + stop IDs | slow/dwell at stop anchor |
| Bus shelters, signs, kiosks | StopManager | pedestrian-side curb socket | register one stop ID to matching lane edge |
| Stations and terminals | TransitManager | multiple bay sockets | multistop routes connect via dispatch |
| City Hall | Services/Landmarks | lot + footpath | civic placement, no moving physics |

## Progressive implementation
### Stage 1: assets and quality gates
- [x] Deliver actual GLB geometry, 55 asset names, meter scale and orientation convention.
- [x] Deliver Blender script to assemble, generate native library and optional individual .blend assets.
- [ ] Run Blender locally to generate/inspect all .blend projects; validate colors/geometry and preview camera.
- [ ] Blender side: refine vehicle topology, headlights, curves, glass transparency, UV maps, texture PBR and LODs.

### Stage 2: roads and anchors
- [ ] Read current Mayor repo schema before committing to its ECS/renderer; determine native unit conversion and lane graph representation.
- [ ] Define road segments, lane spline collection, turn connectors, sidewalk edges and stops as actual socket objects.
- [ ] Build collision proxy meshes and tire rolling animation, create pivot/socket convention with schema validation.

### Stage 3: integration
- [ ] Build GLB registry loader, streaming/instancing and compatibility tests in the engine.
- [ ] Add spawn classes, vehicle movement, stop dwell logic, bus route UI and depot assignment.
- [ ] Introduce generic vehicle color variants and semantic services.

### Stage 4: QA and performance
- [ ] Visual checks at all game LOD distances; reduce draw calls and mesh count.
- [ ] LOD0/LOD1/LOD2, instanced common materials, 2K/1K/512 texture atlas budget.
- [ ] Test lanes across bridges, tunnels, intersections, one-way streets and roundabouts.
- [ ] Validate articulated turns, traffic lights, bus stops, pathfinding, and save/load behavior.

## Important limitation
This is a portable, engine-neutral asset integration plan. The current Mayor repository's schemas were not verified in this build; do not paste this into production without reading its existing architecture first.
