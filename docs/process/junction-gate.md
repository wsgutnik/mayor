# Junction / road quality gate (G1–G5)

Quality loop for anything that draws roads, junctions, kerbs, markings, bridges or
roundabouts. Adopted from fable-cities' critique loop (08 section 4); mapped to
AGENTS.md rule 11 and `.claude/skills/mayor-visual-quality/SKILL.md`.

Two halves, both required before a junction change merges:

- **Headless gate** (this repo, always green): `src/sim/showcase-gate.test.ts`
  builds all 12 showcase cases and asserts the geometric invariants. Run:
  `npx vitest run src/sim/showcase-gate.test.ts`.
- **Critic pass** (a separate agent that writes no code): captures the fixed shot
  matrix below with `scripts/showcase-shots.md`, scores against the anchored
  rubric, and writes `docs/critique/junctions_rN.json`.

## 1. Shot matrix (G1)

World: dev server plus `?showcase=1` (`src/dev/showcase.ts`). Fixed seed 7,
fixed grid, fixed presets — the critic never picks an angle.

Required shots per round (26):

| Preset | Zoom | tod | File |
|---|---|---|---|
| each of the 12 cases | close | day (16.2 h) | `shots/junctions/<case>_close_day.png` |
| each of the 12 cases | close | night (21 h) | `shots/junctions/<case>_close_night.png` |
| overview | — | day + night | `shots/junctions/overview_day.png`, `overview_night.png` |

The 12 cases (`__showcase.list()`): `cross-street`, `cross-avenue-street`,
`tee`, `y-25`, `five-arm`, `dead-end`, `curve-node`, `bend`,
`avenue-street-transition`, `bridge-ramp`, `short-pair`, `roundabout`.

Game-zoom (`__showcase.go(name, "game")`) shots are required for every case
with a major-or-worse issue (to judge player-visible impact) plus 4 cases
sampled at random each round. Rule 11's "game zoom and close up" is satisfied
by close-up-always plus game-zoom-on-demand-and-sampled.

Each PNG gets a `.json` sidecar: the `__showcase.stats()` output plus the
console-error count (must be 0) copied from devtools.

## 2. Anchored rubric (G4)

Fixed anchors. The anchor text is the contract; do not re-derive it per round.

| Score | Label | Meaning for junctions/roads |
|---|---|---|
| 10 | indistinguishable | Side by side with the `screenshots/` Cities: Skylines reference, a player cannot tell which is Mayor. Kerbs, markings, caps and lighting all hold at close zoom, day and night. |
| 9 | AAA | Correct everywhere; only sub-pixel or single-frame nits a player would never notice (slight dash phase, 1-texel marking edge). |
| **8.5** | **AAA with nits (PASS)** | All checklist items (§3) hold. At most minor issues, each confined to one case/zoom and invisible at game zoom. Zero blockers, zero console errors. |
| 7 | good indie | Reads well at game zoom, but a close-up shows a systematic nit (kerb tone step, dash cut, cap seam) across several cases. No blockers. |
| 5 | programmer art | Shapes are right but surfacing is wrong (flat untextured asphalt, missing kerbs, unreadable night markings) or one major issue (visible gap/overlap at game zoom). |
| 3 | broken shapes | Blockers present: gaps, overlaps, open caps, stray arcs, z-fighting, floating markings visible in the required shots. |
| 0 | missing | Case does not build, renders nothing, or crashes the page. |

**Pass = score ≥ 8.5 AND zero `blocker` issues AND zero console errors AND
no headless pin raised (§5).** At most 4 builder↔critic rounds per change;
after that the lead decides.

## 3. Per-case checklist

Applies to every case, both tods, both zooms unless noted. Any failure is at
least `major`; failures visible at game zoom, or any item marked (B), are
`blocker`. (B) items are rule 11's zero-tolerance list.

- Ribbon meets patch with no gap, no overlap, no notch (B).
- No blob/octagon standing in for a crossing; the patch follows the arms (B).
- Kerb/sidewalk continuous around every convex corner; kerbs never stop at a
  node (B).
- No stray arcs or pale strips inside the asphalt (B).
- No z-fighting shimmer on asphalt, kerbs or markings (B).
- Crosswalk and stop line fully on asphalt, never on the seam or grass (B);
  stop line on inbound lanes only.
- Dead end: cap closed, kerb wraps the U, no markings (B for open caps).
- Lots touch neither kerb nor asphalt; no prop on asphalt; no building
  overlapping a road (B).
- Markings legible at night; no unreadable black hole, no blown-out white.
- Dashes cut cleanly at the patch edge (no dash stub stranded on grass).
- Case specifics: `y-25` shows no wedge notch at close zoom; `short-pair`
  keeps two distinct patches; `avenue-street-transition` steps width without
  a lip; `bridge-ramp` ramps meet the ground with no cliff or floating deck
  end, parapets run the full deck; `roundabout` island is kerbed and grassed,
  ring entries carry yield dashes; `curve-node` ribbon follows the curve
  through the node with no chord shortcut.

## 4. Critique file schema (G4)

`docs/critique/junctions_rN.json` (N increments per round; history is never
edited):

```json
{
  "score": 8.5,
  "pass": true,
  "summary": "one paragraph: what changed, what holds, what does not",
  "perf": { "drawCalls": 0, "triangles": 0, "consoleErrors": 0 },
  "shots": ["shots/junctions/cross-street_close_day.png"],
  "strengths": ["..."],
  "issues": [
    {
      "severity": "blocker|major|minor",
      "description": "what is wrong",
      "evidence": "cross-street_close_day.png @ (410,300)-(470,330); src/render/roads.ts:691",
      "suggestion": "carry the trim 0.12 further on the wide side (nodeLayout setTrim)"
    }
  ]
}
```

`perf` comes from `__showcase.stats()` (drawCalls/triangles after a render).
Every issue cites a screenshot pixel box AND a `file:line`; every suggestion
carries a number. The critic re-verifies each builder claim
("builder's AFTER numbers reproduce exactly" or "contrary to the report").

## 5. Headless numbers (G3)

`npx vitest run src/sim/showcase-gate.test.ts` logs one line per case:

`gate <case>: segs=… nodes=… junctions=… rings=… fanArea>=… fanAng>=… kerbArea>=…
kerbAng>=… coverage=A/B ringOverlap~… nonSimple=…`

Asserted today (fail the build on regression): every case builds without
throwing; kerb-quad triangles > 1e-5 area and ≥ 5°; fan triangles > 1e-9 area;
kerbs on the asphalt boundary or outside it; no two junction rings overlap;
mouth coverage at the pinned count; rebuilds are bit-identical.

Ratchet pins (exact-count assertions; a fix must update the pin, a regression
fails the build). Current values, 2026-10-13:

| Pin | Value | Finding |
|---|---|---|
| `nonSimple` total | 13 of 16 rings | F1: fillet arcs are emitted in reverse order (`junctionDebugGeometry` arc), so every ring with a convex corner doubles back over itself. Patches still cover (folds double-cover). |
| `coverage` misses | 2 (`y-25` both acute arms at d=0.9) | F2: per-side trims are symmetrised to the max while ring touch points stay per-side, leaving a bare wedge on the wide side of acute arms. |

P2/P3 must drive both pins to 0 and flip them to plain assertions. Until then
the critic fails any change that raises a pin. A live count is available in
the running game at `window.__city.junctionDiagnostics`.

## 6. Image metrics (G5)

Computed on the G1 PNGs once the scripted pipeline exists (08 P9); until then
the critic judges by eye and records pixel boxes:

- (a) junction-fan vs abutting-ribbon luminance-std ratio ≤ 1.5 (tonal seam).
- (b) marking pixels inside the asphalt mask = 100 % (floating markings).
- (c) kerb-mask continuity around every convex corner (sidewalk wrap).
