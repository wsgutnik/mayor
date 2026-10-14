// Adapted from fable-cities (MIT, (c) 2026 raw):
//   src/modules/ui/infoview.js — createInfoView (legend panel: title +
//   description, Low→High gradient with the city-average marker, stats read
//   live from the simulation, nothing estimated).
// Mayor differences: the model (legendFor) is pure and tested; numbers come
// from CityState; no categorical chips (Mayor has no zoning infoview).

import { tr } from "../i18n";
import type { CityState, CivicKey, UtilityKey } from "../sim/sim";
import { countLayerFacilities, coverageRamp } from "../sim/coverage-field";
import { COVER, LAND_VALUE_LAYER, TRAFFIC_LAYER } from "../sim/world";

export type LegendCls = "" | "good" | "warn" | "bad";
export interface LegendRow { k: string; v: string; cls: LegendCls }

export interface LegendModel {
  titleKey: string;
  descKey: string;
  color: string;
  stops: [string, string, string];
  lowKey: string;
  highKey: string;
  /** City-average marker 0..1, or null when the stat does not exist. */
  avg: number | null;
  /** True when a high average is bad (congestion). */
  invert?: boolean;
  rows: LegendRow[];
}

const CIVIC_OF_BIT: Record<number, CivicKey> = {
  [COVER.POLICE]: "police", [COVER.FIRE]: "fire", [COVER.HEALTH]: "health", [COVER.EDU]: "edu",
  [COVER.PARK]: "park", [COVER.TRANSIT]: "transit", [COVER.CULTURE]: "culture",
};

const UTILITY_OF_BIT: Record<number, UtilityKey> = {
  [COVER.POWER]: "power", [COVER.WATER]: "water", [COVER.SEWAGE]: "sewage", [COVER.GARBAGE]: "garbage",
};

const LAYER_TITLE: Record<number, string> = {
  [COVER.POWER]: "Power coverage", [COVER.WATER]: "Water coverage", [COVER.SEWAGE]: "Sewage coverage",
  [COVER.GARBAGE]: "Garbage coverage", [COVER.POLICE]: "Police coverage", [COVER.FIRE]: "Fire coverage",
  [COVER.HEALTH]: "Health coverage", [COVER.EDU]: "Education coverage", [COVER.PARK]: "Park coverage",
  [COVER.TRANSIT]: "Transit coverage", [COVER.CULTURE]: "Culture coverage",
  [TRAFFIC_LAYER]: "Traffic", [LAND_VALUE_LAYER]: "Land value",
};

const LAYER_DESC: Record<number, string> = {
  [COVER.POWER]: "Buildings the power grid reaches. Hatched blocks need supply.",
  [COVER.WATER]: "Buildings the water network reaches. Hatched blocks need supply.",
  [COVER.SEWAGE]: "Buildings the sewage network drains. Hatched blocks need supply.",
  [COVER.GARBAGE]: "Buildings the garbage service collects. Hatched blocks need a landfill.",
  [COVER.POLICE]: "Share of buildings the police reach. Hatched blocks need a station.",
  [COVER.FIRE]: "Share of buildings the fire service reaches. Hatched blocks need a station.",
  [COVER.HEALTH]: "Share of buildings with health cover. Hatched blocks need a clinic.",
  [COVER.EDU]: "Share of buildings with education. Hatched blocks need a school.",
  [COVER.PARK]: "Share of buildings near a park. Hatched blocks want green space.",
  [COVER.TRANSIT]: "Share of buildings near a stop or station. Hatched blocks need transit.",
  [COVER.CULTURE]: "Share of buildings with culture. Hatched blocks need a venue.",
  [TRAFFIC_LAYER]: "How full each road is, green (free) to red (jammed).",
  [LAND_VALUE_LAYER]: "Desirability per tile, from services, parks and industry.",
};

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const fmtInt = (v: number): string => Math.round(v).toLocaleString("en-US");

const clsFor = (v: number, invert = false): LegendCls => {
  const good = invert ? v < 0.35 : v > 0.65;
  const bad = invert ? v > 0.7 : v < 0.4;
  return good ? "good" : bad ? "bad" : "warn";
};

/**
 * Legend model for one infoview layer, from live simulation numbers only.
 * Returns null for off/unknown layers (the underground view has no legend).
 */
export function legendFor(layer: number, s: CityState): LegendModel | null {
  const titleKey = LAYER_TITLE[layer];
  if (!titleKey) return null;
  if (layer === TRAFFIC_LAYER) {
    return {
      titleKey, descKey: LAYER_DESC[layer], color: "#e5584f",
      stops: ["#22a03c", "#e8b35a", "#d91f0f"], lowKey: "Free flow", highKey: "Congested",
      avg: s.congestion, invert: true,
      rows: [
        { k: "Vehicles", v: fmtInt(s.vehicles), cls: "" },
        { k: "Congestion", v: pct(s.congestion), cls: clsFor(s.congestion, true) },
      ],
    };
  }
  if (layer === LAND_VALUE_LAYER) {
    const avg = s.landValue / 100;
    return {
      titleKey, descKey: LAYER_DESC[layer], color: "#7fd35c",
      stops: ["#d6392c", "#e8a33d", "#35d38a"], lowKey: "Low value", highKey: "High value",
      avg,
      rows: [{ k: "Happiness", v: pct(s.happiness / 100), cls: clsFor(s.happiness / 100) }],
    };
  }
  const ramp = coverageRamp(layer);
  const base = {
    titleKey, descKey: LAYER_DESC[layer], color: ramp.covered,
    stops: [ramp.bad, ramp.warn, ramp.covered] as [string, string, string],
    lowKey: "Not reached", highKey: "Fully served",
  };
  const civic = CIVIC_OF_BIT[layer];
  if (civic) {
    const facilities = countLayerFacilities(s.world, layer);
    const avg = s.coverage[civic];
    const rows: LegendRow[] = [{ k: "Facilities", v: fmtInt(facilities), cls: facilities > 0 ? "" : "bad" }];
    if (layer === COVER.TRANSIT && s.world.lines.length > 0) {
      rows.push({ k: "Riders", v: fmtInt(s.transit.riders), cls: "" });
    }
    return { ...base, avg, rows };
  }
  const util = UTILITY_OF_BIT[layer];
  if (util) {
    const u = s.utilities[util];
    const facilities = countLayerFacilities(s.world, layer);
    const ratio = u.demand > 0 ? Math.min(1, u.supply / u.demand) : null;
    const rows: LegendRow[] = [
      { k: "Facilities", v: fmtInt(facilities), cls: facilities > 0 ? "" : "bad" },
      { k: "Capacity", v: fmtInt(u.supply), cls: "" },
      { k: "Demand", v: fmtInt(u.demand), cls: "" },
    ];
    if (ratio !== null) rows.push({ k: "Supply", v: pct(ratio), cls: ratio >= 0.95 ? "good" : ratio >= 0.7 ? "warn" : "bad" });
    return { ...base, avg: ratio, rows };
  }
  return null;
}

/** Signature of the rendered model; refresh skips DOM work while it is unchanged. */
export function legendSig(m: LegendModel): string {
  return [m.titleKey, m.avg?.toFixed(3) ?? "-", m.rows.map((r) => `${r.k}=${r.v}|${r.cls}`).join(";")].join("~");
}

/** The DOM legend panel; the HUD shows it with the infoview and refreshes it from state. */
export class LegendView {
  private el: HTMLElement;
  private dot: HTMLElement;
  private titleEl: HTMLElement;
  private descEl: HTMLElement;
  private gradBar: HTMLElement;
  private marker: HTMLElement;
  private lowEl: HTMLElement;
  private highEl: HTMLElement;
  private avgRow: HTMLElement;
  private avgVal: HTMLElement;
  private stats: HTMLElement;
  private layer = 0;
  private sig = "";

  constructor(parent: HTMLElement, onClose: () => void, before?: HTMLElement | null) {
    this.dot = document.createElement("i");
    this.dot.className = "legend-dot";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "legend-title";
    const close = document.createElement("button");
    close.className = "notif-close";
    close.setAttribute("aria-label", tr("Close info view"));
    close.textContent = "✕";
    close.addEventListener("click", onClose);
    const head = document.createElement("div");
    head.className = "legend-head";
    head.append(this.dot, this.titleEl, close);
    this.descEl = document.createElement("div");
    this.descEl.className = "legend-desc";
    this.gradBar = document.createElement("div");
    this.gradBar.className = "legend-grad";
    this.marker = document.createElement("i");
    this.marker.className = "legend-marker";
    const bar = document.createElement("div");
    bar.className = "legend-bar";
    bar.append(this.gradBar, this.marker);
    this.lowEl = document.createElement("span");
    this.highEl = document.createElement("span");
    const labels = document.createElement("div");
    labels.className = "legend-labels";
    labels.append(this.lowEl, this.highEl);
    this.avgVal = document.createElement("b");
    this.avgRow = document.createElement("div");
    this.avgRow.className = "legend-avg";
    const avgLabel = document.createElement("span");
    avgLabel.textContent = tr("City average");
    this.avgRow.append(avgLabel, this.avgVal);
    this.stats = document.createElement("div");
    this.stats.className = "legend-stats";
    this.el = document.createElement("div");
    this.el.className = "panel legend";
    this.el.setAttribute("role", "region");
    this.el.setAttribute("aria-label", tr("Infoview"));
    this.el.hidden = true;
    this.el.append(head, this.descEl, bar, labels, this.avgRow, this.stats);
    if (before) parent.insertBefore(this.el, before);
    else parent.appendChild(this.el);
  }

  get visible(): boolean { return !this.el.hidden; }

  show(layer: number): void {
    this.layer = layer;
    this.sig = "";
    this.el.hidden = false;
  }

  hide(): void {
    this.layer = 0;
    this.sig = "";
    this.el.hidden = true;
  }

  refresh(s: CityState): void {
    if (!this.layer) return;
    const m = legendFor(this.layer, s);
    if (!m) {
      this.hide();
      return;
    }
    const sig = legendSig(m);
    if (sig === this.sig) return;
    this.sig = sig;
    this.dot.style.background = m.color;
    this.titleEl.textContent = tr(m.titleKey);
    this.descEl.textContent = tr(m.descKey);
    this.gradBar.style.background = `linear-gradient(90deg, ${m.stops.join(", ")})`;
    this.lowEl.textContent = tr(m.lowKey);
    this.highEl.textContent = tr(m.highKey);
    if (m.avg === null) {
      this.avgRow.style.display = "none";
      this.marker.style.display = "none";
    } else {
      this.avgRow.style.display = "";
      this.marker.style.display = "";
      this.marker.style.left = `${Math.round(m.avg * 100)}%`;
      this.avgVal.textContent = pct(m.avg);
      this.avgVal.className = clsFor(m.avg, m.invert ?? false);
    }
    this.stats.innerHTML = "";
    for (const r of m.rows) {
      const row = document.createElement("div");
      row.className = "row";
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = tr(r.k);
      const v = document.createElement("b");
      v.className = `v ${r.cls}`;
      v.textContent = r.v;
      row.append(k, v);
      this.stats.appendChild(row);
    }
    this.stats.style.display = m.rows.length ? "" : "none";
  }

  destroy(): void {
    this.el.remove();
  }
}
