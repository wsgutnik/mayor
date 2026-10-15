import { tr } from "../i18n";

/**
 * "About and credits" content for the menu (docs/appstore/review-notes.md). Mirrors NOTICE.md and
 * third_party/README.md; `credits.test.ts` checks that every entry here is still named in NOTICE.md.
 * Pure string building so it is testable without a DOM.
 */
export interface Credit {
  /** Work or library name, shown as is (proper noun). */
  name: string;
  /** Author or publisher, shown as is. */
  by: string;
  /** Licence identifier, shown as is (CC0, MIT, ...). */
  license: string;
  /** English i18n key describing what Mayor uses it for. */
  use: string;
  url: string;
}

export const CREDITS: readonly Credit[] = [
  { name: "City Kit Roads 2.2", by: "Kenney", license: "CC0", use: "Road props source models", url: "https://kenney.nl/assets/city-kit-roads" },
  { name: "asphalt_02, Kloofendal 48d sky", by: "Poly Haven", license: "CC0", use: "Asphalt texture and sky lighting", url: "https://polyhaven.com" },
  { name: "ambientCG materials (via Fable Cities)", by: "ambientCG", license: "CC0", use: "Ground, road and facade textures", url: "https://ambientcg.com" },
  { name: "Fable Cities", by: "raw (github.com/rawprogress)", license: "MIT", use: "Adapted traffic, signal, zoning and rendering code", url: "https://github.com/rawprogress/fable-cities" },
  { name: "Three.js", by: "three.js authors", license: "MIT", use: "3D rendering library", url: "https://threejs.org" },
  { name: "Tauri", by: "Tauri Programme", license: "MIT / Apache-2.0", use: "Native app shell", url: "https://tauri.app" },
];

/** Verbatim MIT notice required by the Fable Cities licence. Legal text: intentionally not translated. */
export const FABLE_MIT_NOTICE = `MIT License — Copyright (c) 2026 raw (github.com/rawprogress)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

/** Every English key the About view renders (asserted translated in tests). */
export const CREDITS_KEYS: readonly string[] = [
  "About and credits", "About", "Licences, privacy and acknowledgements",
  "Mayor is an original city builder. It is inspired by classic city-building games but is not affiliated with, sponsored by, or endorsed by Paradox Interactive or Colossal Order.",
  "Privacy: Mayor collects no data. Cities are saved only on this device; there are no accounts, ads, analytics or tracking.",
  "Third-party materials",
  "Some textures, illustrations and the icon were made by the author with the help of AI image tools (Higgsfield, ChatGPT Image, Midjourney) from generic prompts; they are project assets.",
  "Fable Cities licence notice", "Version",
  ...CREDITS.map((c) => c.use),
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inner HTML of the About view (the menu frame adds the logo and the back button). */
export function creditsHtml(version: string): string {
  const rows = CREDITS.map((c) => `<li><b>${esc(c.name)}</b> · ${esc(c.by)} · <i>${esc(c.license)}</i>
      <small>${esc(tr(c.use))} — ${esc(c.url)}</small></li>`).join("");
  return `<div class="about">
    <p>${esc(tr("Mayor is an original city builder. It is inspired by classic city-building games but is not affiliated with, sponsored by, or endorsed by Paradox Interactive or Colossal Order."))}</p>
    <p>${esc(tr("Privacy: Mayor collects no data. Cities are saved only on this device; there are no accounts, ads, analytics or tracking."))}</p>
    <div class="maps-title">${esc(tr("Third-party materials"))}</div>
    <ul class="credits">${rows}</ul>
    <p><small>${esc(tr("Some textures, illustrations and the icon were made by the author with the help of AI image tools (Higgsfield, ChatGPT Image, Midjourney) from generic prompts; they are project assets."))}</small></p>
    <details><summary>${esc(tr("Fable Cities licence notice"))}</summary><pre class="licence">${esc(FABLE_MIT_NOTICE)}</pre></details>
    <p><small>${esc(tr("Version"))} ${esc(version)}</small></p>
  </div>`;
}
