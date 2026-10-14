# 16 — Landmark easter eggs

## Design twice

**A: facility-like hand placement.** It is understandable but not an easter egg and creates a second placement path.
**B: a random global pop-up detached from lots.** It can overlap roads and cannot reuse zoning construction.
**C: deterministic replacement of an eligible oriented lot. Chosen.** The existing lot ID, segment frame and footprint remain authoritative; only its visual identity changes.

## Recipe

The eight entries in `src/sim/landmarks.ts` have a 2x2 or 4x4 site, permitted zone, radial effects, and both localized names. A completed oriented lot must have at least four cells, meet its entry footprint, land value 42+, and city population must support the global cap (`floor(population / 750)`). One daily candidate hash is `mix(seed, day, lot.id)`; `roll % 4096 == 0` wins, and a 45-day cooldown makes the event rare and bounded. The first eligible candidate in stable lot order wins.

Land value is recalculated normally, then the landmark field adds a linear radial bonus and clamps every tile to 0..100. City happiness is capped at +20 across landmarks; job grants are included in the normal job total. On appearance the lot retains its ID, begins the existing construction schedule at zero, emits `landmark:appeared`, and cannot burn, abandon, downgrade, or evolve. Player bulldozing still clears its zone as usual.

## Render contract and invariants

`public/models/landmarks/landmark_<id>.glb` is loaded through a dedicated instanced pool. Missing assets retain the normal kit fallback. Assets follow the evolved-site contract: 2x2 bounds ±1.01 and <=1400 triangles; 4x4 bounds ±2.01 and <=2800 triangles; base z=0, front -Y. No new runtime geometry is made per frame.

Tests cover hash determinism, effect caps, persistence/unknown-ID dropping, single event/cooldown, and the no-demolition guard. The headless footprint remains the existing oriented-lot `checkLots` contract, so a landmark cannot create overlap or a road conflict.
