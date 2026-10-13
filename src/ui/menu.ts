import { SlotInfo } from "../storage";
import { Prefs, Quality, defaultPrefs } from "../prefs";
import { Lang, getLang, tr } from "../i18n";
import { BIOMES, Biome } from "../sim/world";
import type { MapIndex, MapListing } from "../sim/maps";
import { difficultyKey, localizedDescription, localizedName, sortMapsByDifficulty } from "./maps-list";

/** Official maps from /maps/index.json, fetched lazily on first menu open. */
let cachedMaps: MapListing[] | null = null;
let mapsFailed = false;
let mapsInflight: Promise<void> | null = null;

function loadMaps(): Promise<void> {
  if (cachedMaps || mapsFailed) return Promise.resolve();
  if (mapsInflight) return mapsInflight;
  mapsInflight = fetch("/maps/index.json")
    .then((r) => {
      if (!r.ok) throw new Error(`maps index ${r.status}`);
      return r.json() as Promise<MapIndex>;
    })
    .then((idx) => { cachedMaps = sortMapsByDifficulty(idx.maps ?? []); })
    .catch(() => { mapsFailed = true; })
    .finally(() => { mapsInflight = null; });
  return mapsInflight;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const BIOME_LABEL: Record<Biome, string> = {
  plains: "Plains", forest: "Forest", river: "River", coast: "Coast", mountain: "Mountain", desert: "Desert",
};

export interface MenuHooks {
  onSave(slot: number): void;
  onLoad(slot: string): void;
  onNew(seed: number, biome: Biome): void;
  onNewMap(id: string): void;
  onExport(): void;
  onImport(file: File): void;
  info(slot: string): SlotInfo | null;
  getPrefs(): Prefs;
  onPrefs(p: Prefs): void;
}

const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Pause-style menu: save slots, continue, a seeded new city, and preferences. */
export class Menu {
  private root: HTMLElement;
  private view: "main" | "prefs" = "main";
  private biome: Biome = "plains";
  private selectedMap: string | null = null;
  private draft: Prefs | null = null;
  private prefTab: "general" | "graphics" | "gameplay" | "controls" = "general";

  constructor(parent: HTMLElement, private hooks: MenuHooks) {
    this.root = document.createElement("div");
    this.root.className = "menu-backdrop";
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  /** Keep the menu above a freshly rebuilt HUD. */
  raise(): void { this.root.parentElement?.appendChild(this.root); }

  get isOpen(): boolean { return !this.root.hidden; }
  close(): void { this.root.hidden = true; }
  toggle(): void { if (this.isOpen) this.close(); else this.open(); }

  open(): void {
    this.view = "main";
    this.draft = null;
    this.render();
    this.root.hidden = false;
    // Lazy official maps: fill the section in once the index arrives.
    void loadMaps().then(() => { if (this.isOpen && this.view === "main") this.render(); });
  }

  /** Re-render in place (language changed). */
  refresh(): void {
    if (this.isOpen) this.render();
  }

  private frame(inner: string): void {
    this.root.innerHTML = `<div class="panel menu">
      <img class="menu-logo" src="/ui/brand-banner.png" alt="Mayor">
      <div class="menu-body">${inner}</div>
      <button class="menu-close">${tr(this.view === "prefs" ? "OK" : "Back to the city")}</button></div>`;
    this.root.querySelector(".menu-close")!.addEventListener("click", () => {
      if (this.view === "prefs") {
        if (this.draft) { this.hooks.onPrefs({ ...this.draft }); this.draft = null; }
        this.view = "main";
        this.render();
      } else this.close();
    });
    this.root.onpointerdown = (e) => { if (e.target === this.root) this.close(); };
  }

  private render(): void {
    if (this.view === "prefs") { this.renderPrefs(); return; }
    const rows: string[] = [];
    const auto = this.hooks.info("auto");
    const meta = (i: SlotInfo) => `${fmtDate(i.saved)} · ${tr("Population")} ${i.pop.toLocaleString("en-US")} · $${i.money.toLocaleString("en-US")}`;
    rows.push(`<div class="menu-row"><div><b>${tr("Autosave")}</b><small>${auto ? meta(auto) : tr("Created at the start of each month")}</small></div>
      <button data-load="auto" ${auto ? "" : "disabled"}>${tr("Continue")}</button></div>`);
    for (const n of [1, 2, 3]) {
      const i = this.hooks.info(String(n));
      rows.push(`<div class="menu-row"><div><b>${tr("Slot {n}", { n })}</b><small>${i ? meta(i) : tr("Empty")}</small></div>
        <span><button data-save="${n}">${tr("Save")}</button><button data-load="${n}" ${i ? "" : "disabled"}>${tr("Load")}</button></span></div>`);
    }
    rows.push(`<div class="menu-block"><div class="menu-row new"><div><b>${tr("New city")}</b><small>${tr("Map seed")}</small></div>
      <span><input id="menu-seed" inputmode="numeric" value="${Math.floor(Math.random() * 99999)}"><button data-new>${tr("Generate")}</button></span></div>
      ${this.mapsSection()}
      <div class="maps-title">${tr("Random terrain")}</div>
      <div class="terrain-pick">${BIOMES.map((b) => `<button data-biome="${b}" class="${b === this.biome ? "on" : ""}">
        <img src="/ui/kit/tile-${b}.png" alt=""><span>${tr(BIOME_LABEL[b])}</span></button>`).join("")}</div></div>`);
    rows.push(`<div class="menu-row"><div><b>${tr("Save file")}</b><small>${tr("Keep a copy or move it to another device")}</small></div>
      <span><button data-export>${tr("Export")}</button><button data-import>${tr("Import")}</button>
      <input id="menu-file" type="file" accept=".json,.mayor.json,application/json" hidden></span></div>`);
    rows.push(`<div class="menu-row"><div><b>${tr("Preferences")}</b><small>${tr("Language")}, ${tr("Graphics quality")}</small></div>
      <button data-prefs>${tr("Preferences")}</button></div>`);
    this.frame(rows.join(""));

    const body = this.root;
    body.querySelectorAll<HTMLButtonElement>("[data-save]").forEach((b) =>
      b.addEventListener("click", () => { this.hooks.onSave(Number(b.dataset.save)); this.render(); }));
    body.querySelectorAll<HTMLButtonElement>("[data-load]").forEach((b) =>
      b.addEventListener("click", () => { this.hooks.onLoad(b.dataset.load!); this.close(); }));
    body.querySelector("[data-new]")!.addEventListener("click", () => {
      const v = Number((body.querySelector("#menu-seed") as HTMLInputElement).value);
      this.hooks.onNew(Number.isFinite(v) ? Math.abs(Math.floor(v)) : 1337, this.biome);
      this.close();
    });
    const fileInput = body.querySelector<HTMLInputElement>("#menu-file")!;
    body.querySelector("[data-export]")!.addEventListener("click", () => this.hooks.onExport());
    body.querySelector("[data-import]")!.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) { this.hooks.onImport(f); this.close(); }
    });
    body.querySelectorAll<HTMLButtonElement>("[data-biome]").forEach((b) =>
      b.addEventListener("click", () => {
        this.biome = b.dataset.biome as Biome;
        body.querySelectorAll("[data-biome]").forEach((x) => x.classList.toggle("on", x === b));
      }));
    body.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((b) =>
      b.addEventListener("click", () => {
        this.selectedMap = b.dataset.map!;
        body.querySelectorAll("[data-map]").forEach((x) => x.classList.toggle("on", x === b));
        const play = body.querySelector<HTMLButtonElement>("[data-play-map]");
        if (play) play.disabled = false;
      }));
    body.querySelector("[data-play-map]")?.addEventListener("click", () => {
      if (this.selectedMap) { this.hooks.onNewMap(this.selectedMap); this.close(); }
    });
    body.querySelector("[data-prefs]")!.addEventListener("click", () => { this.view = "prefs"; this.render(); });
  }

  /** Official maps section; empty when the index hasn't loaded (or failed), so the menu hides it. */
  private mapsSection(): string {
    if (!cachedMaps || cachedMaps.length === 0) return "";
    const lang = getLang();
    const cards = cachedMaps.map((m) => `
      <button class="map-card${m.id === this.selectedMap ? " on" : ""}" data-map="${escapeHtml(m.id)}">
        <img src="${escapeHtml(m.preview)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/ui/kit/tile-plains.png'">
        <span class="map-info">
          <span class="map-name">${escapeHtml(localizedName(m, lang))}
            <i class="diff diff-${m.difficulty}">${tr(difficultyKey(m.difficulty))}</i></span>
          <span class="map-desc">${escapeHtml(localizedDescription(m, lang))}</span>
          <span class="map-size">${tr("Size")}: ${m.size} × ${m.size}</span>
        </span>
      </button>`).join("");
    return `<div class="maps-title">${tr("Official maps")}</div>
      <div class="maps-list">${cards}</div>
      <button class="map-play" data-play-map${this.selectedMap ? "" : " disabled"}>${tr("Play")}</button>`;
  }

  /** Preferences in the layout of the brand kit: tabs on the left, Restore / Apply / OK at the bottom. */
  private renderPrefs(): void {
    const draft = (this.draft ??= { ...this.hooks.getPrefs() });
    const sel = (id: string, opts: [string, string][], cur: string) =>
      `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    const chk = (id: string, label: string, on: boolean) =>
      `<label class="menu-row check"><span>${label}</span><input type="checkbox" id="${id}" ${on ? "checked" : ""}></label>`;
    const tabs: [string, string, string][] = [
      ["general", "General", "kit/ico-engrenagem"], ["graphics", "Graphics", "kit/ico-globo"],
      ["gameplay", "Gameplay", "kit/ico-martelo"], ["controls", "Controls", "kit/ico-ajuda"],
    ];
    const qdesc: Record<Quality, string> = {
      low: "No shadows · flat ground · fewer trees",
      medium: "Soft shadows · textured ground",
      high: "Sharp shadows · detailed ground · dense trees",
    };
    const panes: Record<string, string> = {
      general: `<div class="menu-row"><b>${tr("Language")}</b>${sel("pf-lang", [["pt", "Português (Brasil)"], ["en", "English"]], draft.lang)}</div>
        ${chk("pf-tips", tr("Show tips"), draft.tips)}`,
      graphics: `<div class="menu-row"><b>${tr("Graphics quality")}</b>${sel("pf-quality", [["low", tr("Low quality")], ["medium", tr("Medium quality")], ["high", tr("High quality")]], draft.quality)}</div>
        <div class="menu-row"><small id="pf-qdesc">${tr(qdesc[draft.quality])}</small></div>
        ${chk("pf-daynight", tr("Dynamic day/night"), draft.dayNight)}`,
      gameplay: `${chk("pf-auto", tr("Save automatically"), draft.autosave)}${chk("pf-tips2", tr("Show tips"), draft.tips)}`,
      controls: `<table class="keys">
        <tr><td>${tr("Use tool")}</td><td>${tr("Left button / one finger")}</td></tr>
        <tr><td>${tr("Move camera")}</td><td>${tr("Right button, WASD / two fingers")}</td></tr>
        <tr><td>${tr("Rotate")}</td><td>${tr("Middle button, Q E / twist")}</td></tr>
        <tr><td>${tr("Zoom")}</td><td>${tr("Wheel / pinch")}</td></tr>
        <tr><td>${tr("Cancel")}</td><td>Esc</td></tr></table>`,
    };
    this.frame(`<div class="prefs">
      <nav>${tabs.map(([id, label, icon]) => `<button data-tab="${id}" class="${id === this.prefTab ? "on" : ""}"><img src="/ui/${icon}.png" alt="">${tr(label)}</button>`).join("")}</nav>
      <div class="prefs-pane">${panes[this.prefTab]}</div></div>
      <div class="prefs-foot"><button data-reset>${tr("Restore defaults")}</button><span></span>
        <button data-apply>${tr("Apply")}</button></div>`);

    const q = <T extends HTMLElement>(sel2: string) => this.root.querySelector(sel2) as T | null;
    const bind = (id: string, apply: (el: HTMLInputElement | HTMLSelectElement) => void) => {
      const e = q<HTMLInputElement | HTMLSelectElement>(id);
      if (e) e.addEventListener("change", () => apply(e));
    };
    bind("#pf-lang", (e) => { draft.lang = e.value as Lang; });
    bind("#pf-quality", (e) => {
      draft.quality = e.value as Quality;
      const desc = q("#pf-qdesc");
      if (desc) desc.textContent = tr(qdesc[draft.quality]);
    });
    bind("#pf-tips", (e) => { draft.tips = (e as HTMLInputElement).checked; });
    bind("#pf-tips2", (e) => { draft.tips = (e as HTMLInputElement).checked; });
    bind("#pf-auto", (e) => { draft.autosave = (e as HTMLInputElement).checked; });
    bind("#pf-daynight", (e) => { draft.dayNight = (e as HTMLInputElement).checked; });
    this.root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => { this.prefTab = b.dataset.tab as typeof this.prefTab; this.render(); }));
    q("[data-apply]")!.addEventListener("click", () => { this.hooks.onPrefs({ ...draft }); this.draft = null; this.render(); });
    q("[data-reset]")!.addEventListener("click", () => { this.draft = { ...defaultPrefs() }; this.render(); });
  }
}
