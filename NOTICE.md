# Notices

**Mayor** is an original game **inspired by** Cities: Skylines and Cities: Skylines II. It is not affiliated with,
sponsored by, or endorsed by Paradox Interactive or Colossal Order. Referenced names belong to their owners. No code,
model, texture, sound, or interface from those games is included in this repository; study reference images stay outside
git (`screenshots/` is in `.gitignore`).

## Code License

No license has been chosen yet. Until a `LICENSE` file exists, all rights are reserved by the author: the code may be
read, but not reused.

## Third-Party Materials (public domain, CC0)

| Folder | Source | License |
|---|---|---|
| `third_party/kenney-city-kit-roads/` | Kenney, City Kit Roads 2.2, https://kenney.nl/assets/city-kit-roads | CC0 |
| `third_party/polyhaven-asphalt_02/` | Poly Haven, asphalt_02, https://polyhaven.com/a/asphalt_02 | CC0 |

## Author-Provided Materials

`third_party/mayor-*`, `docs/img/brand/`, `docs/maps-kit/`, and `public/ui/` contain art kits, maps, models, and
illustrations created or commissioned by the author for this project (some generated with AI tools). They are not covered
by any open license.

## Libraries

Three.js (MIT), Tauri (MIT or Apache-2.0), Vite, and Vitest (MIT). See `package.json` and `src-tauri/Cargo.toml`.

## AI-generated texture swatches (2026-10-13)

`blender/textures/*_hd.png` and `public/textures/*_hd.png` for plaster, brick, concrete, roof tile, wood, metal, paving, gravel, grass, dirt, rock, sand, asphalt, foliage, sidewalk, kerb and garden plot
swatches were derived from swatches generated with Higgsfield (GPT Image 2.5) on the project owner's account, then
made seamless, desaturated and brightness-matched by `blender/apply_ai_textures.py`. They contain no third-party
artwork by design (prompts describe generic materials).
