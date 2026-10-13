Implemented the offline map converter and generated all four maps.

Key additions:

- Dependency-free PNG decoder/encoder and map baking utilities in [heightmap.mjs](/tmp/mayor-wt/codex-maps/cities-skylines-2/scripts/lib/heightmap.mjs)
- CLI converter in [convert-maps.mjs](/tmp/mayor-wt/codex-maps/cities-skylines-2/scripts/convert-maps.mjs)
- `npm run maps`
- Four MapData JSON files and 480×480 PNG previews
- Comprehensive tests in [maps.test.ts](/tmp/mayor-wt/codex-maps/cities-skylines-2/src/sim/maps.test.ts)

Generated results:

| Map | Entry `(x,y,dx,dy)` | Water | Buildable |
|---|---:|---:|---:|
| Baía Metropolitana | `(127,64,-1,0)` | 40.63% | 56.13% |
| Vale Verde | `(0,64,1,0)` | 5.68% | 62.05% |
| Arquipélago Azul | `(9,103,1,0)` | 67.86% | 10.92% |
| Planície Central | `(0,64,1,0)` | 4.07% | 91.47% |

Validation passed:

- `npx tsc --noEmit`
- `npx vitest run` — 91 tests passed
- Regeneration via `npm run maps` is deterministic
- No prohibited files were modified
- `public/maps/index.json` only changed preview extensions from `.jpg` to `.png`

No contract types were changed. One contract clarification is advisable: Arquipélago Azul has water on every boundary, so no boundary tile can satisfy the required land condition. The converter therefore follows the selected edge’s inward ray to its first valid three-tile land run, producing the inland `(9,103,1,0)` entry. The contract should explicitly permit this for ocean-ringed maps, or define a separate off-map connection/corridor representation.