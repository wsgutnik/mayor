import { SlotInfo } from "../storage";

export interface MenuHooks {
  onSave(slot: number): void;
  onLoad(slot: string): void;
  onNew(seed: number): void;
  info(slot: string): SlotInfo | null;
}

const fmtDate = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Pause-style menu: save slots, continue, and a seeded new city. */
export class Menu {
  private root: HTMLElement;
  private body: HTMLElement;

  constructor(parent: HTMLElement, private hooks: MenuHooks) {
    this.root = document.createElement("div");
    this.root.className = "menu-backdrop";
    this.root.hidden = true;
    this.root.innerHTML = `<div class="panel menu">
      <img class="menu-logo" src="/mayor-logo.jpg" alt="Mayor">
      <div class="menu-body"></div>
      <button class="menu-close">Back to the city</button></div>`;
    this.body = this.root.querySelector(".menu-body")!;
    this.root.querySelector(".menu-close")!.addEventListener("click", () => this.close());
    this.root.addEventListener("pointerdown", (e) => { if (e.target === this.root) this.close(); });
    parent.appendChild(this.root);
  }

  get isOpen(): boolean { return !this.root.hidden; }
  close(): void { this.root.hidden = true; }
  toggle(): void { if (this.isOpen) this.close(); else this.open(); }

  open(): void {
    this.render();
    this.root.hidden = false;
  }

  private render(): void {
    const rows: string[] = [];
    const auto = this.hooks.info("auto");
    rows.push(`<div class="menu-row"><div><b>Autosave</b><small>${auto
      ? `${fmtDate(auto.saved)} · pop ${auto.pop.toLocaleString("en-US")} · $${auto.money.toLocaleString("en-US")}`
      : "Created at the start of each month"}</small></div>
      <button data-load="auto" ${auto ? "" : "disabled"}>Continue</button></div>`);
    for (const n of [1, 2, 3]) {
      const i = this.hooks.info(String(n));
      rows.push(`<div class="menu-row"><div><b>Slot ${n}</b><small>${i
        ? `${fmtDate(i.saved)} · pop ${i.pop.toLocaleString("en-US")} · $${i.money.toLocaleString("en-US")}`
        : "Empty"}</small></div>
        <span><button data-save="${n}">Save</button><button data-load="${n}" ${i ? "" : "disabled"}>Load</button></span></div>`);
    }
    rows.push(`<div class="menu-row new"><div><b>New city</b><small>Map seed</small></div>
      <span><input id="menu-seed" inputmode="numeric" value="${Math.floor(Math.random() * 99999)}"><button data-new>Generate</button></span></div>`);
    this.body.innerHTML = rows.join("");
    this.body.querySelectorAll<HTMLButtonElement>("[data-save]").forEach((b) =>
      b.addEventListener("click", () => { this.hooks.onSave(Number(b.dataset.save)); this.render(); }));
    this.body.querySelectorAll<HTMLButtonElement>("[data-load]").forEach((b) =>
      b.addEventListener("click", () => { this.hooks.onLoad(b.dataset.load!); this.close(); }));
    this.body.querySelector("[data-new]")!.addEventListener("click", () => {
      const v = Number((this.body.querySelector("#menu-seed") as HTMLInputElement).value);
      this.hooks.onNew(Number.isFinite(v) ? Math.abs(Math.floor(v)) : 1337);
      this.close();
    });
  }
}
