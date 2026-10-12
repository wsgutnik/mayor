import { SlotInfo } from "../storage";
import { Prefs, Quality, defaultPrefs } from "../prefs";
import { Lang, tr } from "../i18n";

export interface MenuHooks {
  onSave(slot: number): void;
  onLoad(slot: string): void;
  onNew(seed: number): void;
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
    this.render();
    this.root.hidden = false;
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
      if (this.view === "prefs") { this.view = "main"; this.render(); } else this.close();
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
    rows.push(`<div class="menu-row new"><div><b>${tr("New city")}</b><small>${tr("Map seed")}</small></div>
      <span><input id="menu-seed" inputmode="numeric" value="${Math.floor(Math.random() * 99999)}"><button data-new>${tr("Generate")}</button></span></div>`);
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
      this.hooks.onNew(Number.isFinite(v) ? Math.abs(Math.floor(v)) : 1337);
      this.close();
    });
    const fileInput = body.querySelector<HTMLInputElement>("#menu-file")!;
    body.querySelector("[data-export]")!.addEventListener("click", () => this.hooks.onExport());
    body.querySelector("[data-import]")!.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) { this.hooks.onImport(f); this.close(); }
    });
    body.querySelector("[data-prefs]")!.addEventListener("click", () => { this.view = "prefs"; this.render(); });
  }

  private renderPrefs(): void {
    const p = this.hooks.getPrefs();
    const sel = (id: string, opts: [string, string][], cur: string) =>
      `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    const chk = (id: string, label: string, on: boolean) =>
      `<label class="menu-row check"><span>${label}</span><input type="checkbox" id="${id}" ${on ? "checked" : ""}></label>`;
    this.frame(`
      <div class="menu-row"><b>${tr("Language")}</b>${sel("pf-lang", [["pt", "Português (Brasil)"], ["en", "English"]], p.lang)}</div>
      <div class="menu-row"><b>${tr("Graphics quality")}</b>${sel("pf-quality", [["low", tr("Low")], ["medium", tr("Medium")], ["high", tr("High")]], p.quality)}</div>
      ${chk("pf-tips", tr("Show tips"), p.tips)}
      ${chk("pf-auto", tr("Save automatically"), p.autosave)}
      ${chk("pf-daynight", tr("Dynamic day/night"), p.dayNight)}
      <div class="menu-row"><span></span><button data-reset>${tr("Restore defaults")}</button></div>`);
    const read = (): Prefs => ({
      lang: (this.root.querySelector("#pf-lang") as HTMLSelectElement).value as Lang,
      quality: (this.root.querySelector("#pf-quality") as HTMLSelectElement).value as Quality,
      tips: (this.root.querySelector("#pf-tips") as HTMLInputElement).checked,
      autosave: (this.root.querySelector("#pf-auto") as HTMLInputElement).checked,
      dayNight: (this.root.querySelector("#pf-daynight") as HTMLInputElement).checked,
    });
    const apply = () => {
      const next = read();
      const langChanged = next.lang !== this.hooks.getPrefs().lang;
      this.hooks.onPrefs(next);
      if (langChanged) this.render();
    };
    this.root.querySelectorAll("select, input[type=checkbox]").forEach((e) => e.addEventListener("change", apply));
    this.root.querySelector("[data-reset]")!.addEventListener("click", () => {
      this.hooks.onPrefs({ ...defaultPrefs() });
      this.render();
    });
  }
}
