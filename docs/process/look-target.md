# Mayor look target: P1-C/P1-D

The renderer keeps ACESFilmic tone mapping. Fable's absolute AgX exposure values are not copied; only ratios are
ported. Mayor uses 1 tile = 8 m, so vehicle-relative metre measurements use 0.0875 tile/m (0.70 / 8).

Targets: HDRI environment intensity ≤ 0.6 by day and ≤ 0.3 at night; wet road roughness 0.32 (dry 0.90), wet
albedo scale 0.82; environment boosts are capped at 1.3. Road atlas daylight modulation is 0.55–1.0 so lighting,
not the atlas shader, controls night falloff. Missing HDRI is a valid fallback to the authored sky.

Visual measurement checklist for the lead: compare 4-way, T, acute Y, dead end, curve, avenue + street and bridge
ramp at game zoom and close-up, day and night. Measure road luminance, sky hue, shadow readability, wet-road highlight
width, and HDRI reflection clipping; record screenshots or SVG dumps with the report.
