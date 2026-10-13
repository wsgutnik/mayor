import { getLang, tr } from "../i18n";
import type { TileInfo } from "../sim/inspect";
import {
  clampLandValue,
  isCompact,
  levelDots,
  localizedName,
  localizedUse,
  peopleLabelKey,
  serviceChips,
} from "./inspector-model";

export interface InspectorHooks {
  onClose(): void;
}

/** Building inspector card: shows what is on the tapped tile. Escape is handled by the caller. */
export class Inspector {
  private root: HTMLElement;
  private img: HTMLImageElement;
  private nameEl: HTMLElement;
  private badgeEl: HTMLElement;
  private useEl: HTMLElement;
  private levelRow: HTMLElement;
  private levelLabel: HTMLElement;
  private dotsEl: HTMLElement;
  private peopleRow: HTMLElement;
  private lvFill: HTMLElement;
  private lvVal: HTMLElement;
  private chipsEl: HTMLElement;
  private facRows: HTMLElement;
  private upkeepVal: HTMLElement;
  private footprintVal: HTMLElement;
  private radiusRow: HTMLElement;
  private radiusVal: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private open = false;

  constructor(parent: HTMLElement, private hooks: InspectorHooks) {
    const root = document.createElement("div");
    root.className = "panel inspector";
    root.hidden = true;

    this.closeBtn = document.createElement("button");
    this.closeBtn.className = "insp-close";
    this.closeBtn.textContent = "✕";
    this.closeBtn.addEventListener("click", () => {
      this.hide();
      this.hooks.onClose();
    });
    root.appendChild(this.closeBtn);

    this.img = document.createElement("img");
    this.img.className = "insp-thumb";
    this.img.alt = "";
    this.img.addEventListener("error", () => {
      this.img.hidden = true;
    });
    root.appendChild(this.img);

    const title = document.createElement("div");
    title.className = "insp-title";
    this.nameEl = document.createElement("span");
    this.nameEl.className = "insp-name";
    this.badgeEl = document.createElement("span");
    this.badgeEl.className = "insp-badge";
    title.appendChild(this.nameEl);
    title.appendChild(this.badgeEl);
    root.appendChild(title);

    this.useEl = document.createElement("div");
    this.useEl.className = "insp-use";
    root.appendChild(this.useEl);

    this.levelRow = document.createElement("div");
    this.levelRow.className = "insp-row";
    this.levelLabel = document.createElement("span");
    this.levelLabel.className = "insp-lbl";
    this.dotsEl = document.createElement("span");
    this.dotsEl.className = "insp-dots";
    this.levelRow.appendChild(this.levelLabel);
    this.levelRow.appendChild(this.dotsEl);
    root.appendChild(this.levelRow);

    this.peopleRow = document.createElement("div");
    this.peopleRow.className = "insp-row";
    root.appendChild(this.peopleRow);

    const lvRow = document.createElement("div");
    lvRow.className = "insp-row insp-lv";
    const lvLabel = document.createElement("span");
    lvLabel.className = "insp-lbl";
    lvLabel.dataset.k = "lv-label";
    const lvBar = document.createElement("div");
    lvBar.className = "insp-lvbar";
    this.lvFill = document.createElement("i");
    lvBar.appendChild(this.lvFill);
    this.lvVal = document.createElement("span");
    this.lvVal.className = "insp-val";
    lvRow.appendChild(lvLabel);
    lvRow.appendChild(lvBar);
    lvRow.appendChild(this.lvVal);
    root.appendChild(lvRow);

    const svcTitle = document.createElement("div");
    svcTitle.className = "insp-sec";
    svcTitle.dataset.k = "svc-title";
    root.appendChild(svcTitle);

    this.chipsEl = document.createElement("div");
    this.chipsEl.className = "insp-chips";
    root.appendChild(this.chipsEl);

    this.facRows = document.createElement("div");
    this.facRows.className = "insp-fac";
    const upkeepRow = document.createElement("div");
    upkeepRow.className = "insp-row";
    const upkeepLabel = document.createElement("span");
    upkeepLabel.className = "insp-lbl";
    upkeepLabel.dataset.k = "upkeep-label";
    this.upkeepVal = document.createElement("span");
    this.upkeepVal.className = "insp-val";
    upkeepRow.appendChild(upkeepLabel);
    upkeepRow.appendChild(this.upkeepVal);
    const footprintRow = document.createElement("div");
    footprintRow.className = "insp-row";
    const footprintLabel = document.createElement("span");
    footprintLabel.className = "insp-lbl";
    footprintLabel.dataset.k = "footprint-label";
    this.footprintVal = document.createElement("span");
    this.footprintVal.className = "insp-val";
    footprintRow.appendChild(footprintLabel);
    footprintRow.appendChild(this.footprintVal);
    const radiusRow = this.radiusRow = document.createElement("div");
    radiusRow.className = "insp-row";
    const radiusLabel = document.createElement("span");
    radiusLabel.className = "insp-lbl";
    radiusLabel.dataset.k = "radius-label";
    this.radiusVal = document.createElement("span");
    this.radiusVal.className = "insp-val";
    radiusRow.appendChild(radiusLabel);
    radiusRow.appendChild(this.radiusVal);
    this.facRows.appendChild(upkeepRow);
    this.facRows.appendChild(footprintRow);
    this.facRows.appendChild(radiusRow);
    root.appendChild(this.facRows);

    this.root = root;
    parent.appendChild(root);
  }

  show(info: TileInfo): void {
    const lang = getLang();
    const name = localizedName(info, lang);
    const use = localizedUse(info, lang);
    this.root.classList.toggle("compact", isCompact(info));

    if (info.thumbnail) {
      this.img.hidden = false;
      this.img.src = info.thumbnail;
      this.img.alt = name;
    } else {
      this.img.hidden = true;
      this.img.removeAttribute("src");
      this.img.alt = "";
    }

    this.nameEl.textContent = name;
    this.badgeEl.textContent = info.category;
    this.badgeEl.hidden = !info.category;
    this.useEl.textContent = use;
    this.useEl.hidden = !use;

    const showLevel = info.kind === "building" && info.level >= 1;
    this.levelRow.hidden = !showLevel;
    if (showLevel) {
      this.levelLabel.textContent = tr("Level");
      this.dotsEl.innerHTML = "";
      for (const filled of levelDots(info.level)) {
        const d = document.createElement("span");
        d.className = filled ? "insp-dot on" : "insp-dot";
        this.dotsEl.appendChild(d);
      }
    }

    const peopleKey = peopleLabelKey(info);
    this.peopleRow.hidden = !peopleKey;
    if (peopleKey) this.peopleRow.textContent = `${tr(peopleKey)}: ${info.people}`;

    const lv = clampLandValue(info.landValue);
    this.root.querySelector<HTMLElement>('[data-k="lv-label"]')!.textContent = tr("Land value");
    this.lvFill.style.width = `${lv}%`;
    this.lvVal.textContent = String(lv);

    this.root.querySelector<HTMLElement>('[data-k="svc-title"]')!.textContent = tr("Services");
    this.chipsEl.innerHTML = "";
    for (const chip of serviceChips(info.services)) {
      const c = document.createElement("span");
      c.className = chip.present ? "insp-chip on" : "insp-chip off";
      c.textContent = tr(chip.labelKey);
      if (chip.present) c.style.setProperty("--chip", chip.color);
      this.chipsEl.appendChild(c);
    }

    const isFac = info.kind === "facility";
    this.facRows.hidden = !isFac;
    if (isFac) {
      this.root.querySelector<HTMLElement>('[data-k="upkeep-label"]')!.textContent = tr("Upkeep");
      this.root.querySelector<HTMLElement>('[data-k="footprint-label"]')!.textContent = tr("Footprint");
      this.root.querySelector<HTMLElement>('[data-k="radius-label"]')!.textContent = tr("Radius");
      this.upkeepVal.textContent = `$${info.upkeep}/${tr("mo")}`;
      this.footprintVal.textContent = `${info.footprint}x${info.footprint}`;
      // Networked utilities (usina, bomba, esgoto, subestação) show no radius.
      this.radiusRow.hidden = info.radius === 0;
      this.radiusVal.textContent = `${info.radius} ${tr("tiles")}`;
    }

    this.closeBtn.title = tr("Close");
    this.closeBtn.setAttribute("aria-label", tr("Close"));

    this.root.hidden = false;
    this.open = true;
  }

  hide(): void {
    this.root.hidden = true;
    this.open = false;
  }

  get isOpen(): boolean {
    return this.open;
  }
}
