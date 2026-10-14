---
name: mayor-visual-quality
description: Use before designing, changing or accepting ANY Mayor geometry the player sees: roads, junctions, kerbs, sidewalks, lots, buildings, vehicles, props, textures. Defines the design-then-verify workflow, the numeric recipes and the zero-tolerance list ("no slop") for this project.
---

# Mayor visual quality

Mayor is held to a Cities: Skylines standard of correctness. Code that compiles and passes unit tests is not enough.

## Rules

1. **Design first.** Write or update the design in `docs/process/` (interface, recipe with numbers, invariants). For a
   new module use the `design-an-interface` skill (>= 3 radically different designs, then synthesize). Junctions:
   `docs/process/07-junction-builder.md`. Corridor/parcels: `docs/process/06-*.md`.
2. **One source of truth.** Widths, kerbs, setbacks, offsets come from `RoadProfile` (`src/sim/corridor.ts`). Never
   hard-code a width in the renderer, lots, props or traffic.
3. **Invariants as tests.** Every geometry builder exposes a checker (rings closed/simple/nested, no gaps, no overlaps,
   no sliver triangles, snaps within 1e-3, determinism, incremental = full rebuild).
4. **Look at it.** Build the hard cases in the running game (`window.__city`, `import('/src/sim/sim.ts')`) and look,
   day and night, at game zoom and close up. Hard cases: 4-way cross, T, Y at 25 degrees, 5 arms, dead end (square and
   bulb), 2-arm bend, avenue + street, one-way arm, curve, hill, bridge ramp, roundabout. Save the screenshots or SVG
   dumps with the report.
5. **Zero tolerance** (reject, do not "polish later"): blobs/octagons for crossings, floating crosswalks or stop lines,
   open caps, stray arcs inside asphalt, notches at acute arms, gaps or overlaps between ribbon and junction,
   z-fighting, kerbs/sidewalks that stop at a node, lots touching kerbs, props on asphalt, vehicles off the carriageway,
   buildings overlapping roads, textures that stretch or visibly repeat on a facade.
6. **Agents:** the prompt must cite this skill; the report must include the measured numbers and the images of the
   hard cases; the lead rejects reports without them.

## Workflow checklist

- [ ] Design doc with numeric recipe and invariants exists and is linked
- [ ] Builder is pure (no DOM), deterministic, cached by revision
- [ ] `checkX()` invariants + tests for the hard cases
- [ ] Performance: 100 nodes/segments < 10 ms (iPad budget)
- [ ] Visual pass day + night + close up with images
- [ ] Old saves load; no save-format change without migration test
- [ ] Docs updated (PROGRESS.md, AGENTS.md if a rule changed)

## Junction recipe (summary; full numbers in docs/process/07-junction-builder.md)

Kerb return R = 0.45 tile (street), 0.60 (avenue); concentric rings asphalt / kerb / sidewalk; crosswalk 0.30 wide at the
trim, stop line 0.08 beyond it on inbound lanes only; flat square dead end wrapped by kerb and sidewalk; acute corners
keep the arc and chamfer to the miter limit; sidewalk continuous around every corner.

## Textures and buildings

Facade textures are neutral (the palette tints them); AI swatches go through `blender/apply_ai_textures.py`
(seamless, mean-matched, <= 1.5 MB). Buildings: front -Y, base z=0, inside the tile, <= 1400 triangles, glow_* windows,
rear and side facades detailed, v2 variants through the registry (never replace base models).

Procedural building generators may serve multi-cell lots. They use the oriented-lot frame (base y=0, front +Z), stay
inside the lot, are deterministic and allocation-free during rebuild, and carry the same <= 1400 triangle limit plus
headless no-gap/no-overlap/no-sliver invariants as Blender assets. One-cell lots remain Blender-kit buildings.
