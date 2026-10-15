import { tr } from "../i18n";
import type { FacilityUsage } from "../sim/facility-usage";

export interface UsageRow { k: string; v: string }

/** Every i18n key the usage rows render (strings.test.ts checks both languages). */
export const USAGE_STRING_KEYS = [
  "Capacity", "In use", "units", "Serves", "buildings", "residents", "jobs", "homes", "At full capacity", "At full coverage",
  "Network", "supply", "demand", "Not connected to a road", "Relays the network, adds no supply", "Reach", "Whole city",
  "Road network", "Radius", "tiles", "Lines", "vehicles", "Riders", "seats", "day",
] as const;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (r: number) => `${Math.round(Math.max(0, r) * 100)}%`;

function servesText(buildings: number, residents: number, jobs: number): string {
  const parts = [`${fmt(buildings)} ${tr("buildings")}`, `${fmt(residents)} ${tr("residents")}`];
  if (jobs > 0) parts.push(`${fmt(jobs)} ${tr("jobs")}`);
  return parts.join(" · ");
}

/**
 * Rows describing what a facility supplies and serves. Pre-placement (no `live`): capacity or radius and the
 * full-capacity / full-coverage estimate. Placed: live load, the lots it serves and transit traffic first.
 */
export function usageRows(u: FacilityUsage): UsageRow[] {
  const rows: UsageRow[] = [];
  const live = u.live;
  const units = tr("units");
  if (u.mode === "network" || u.mode === "garbage") {
    if (live && u.mode === "network" && !live.linked) rows.push({ k: tr("In use"), v: tr("Not connected to a road") });
    else if (live) rows.push({ k: tr("In use"), v: `${fmt(live.load)} / ${fmt(u.capacity)} ${units} (${pct(live.loadShare)})` });
    else rows.push({ k: tr("Capacity"), v: `${fmt(u.capacity)} ${units}` });
  }
  if (u.mode === "relay") rows.push({ k: tr("Reach"), v: tr("Relays the network, adds no supply") });
  if (u.mode === "network") {
    if (!live) rows.push({ k: tr("Reach"), v: tr("Road network") });
  }
  if (live && (u.mode === "network" || u.mode === "relay" || u.mode === "garbage")) {
    rows.push({ k: tr("Network"), v: `${tr("supply")} ${fmt(live.netSupply)} · ${tr("demand")} ${fmt(live.netDemand)}` });
  }
  if (u.radius > 0 && !live) rows.push({ k: tr("Radius"), v: `${u.radius} ${tr("tiles")}` });
  if (u.mode === "citywide") rows.push({ k: tr("Reach"), v: tr("Whole city") });
  if (live && u.mode === "transit") {
    rows.push({ k: tr("Lines"), v: `${fmt(live.lines ?? 0)} · ${fmt(live.vehicles ?? 0)} ${tr("vehicles")} · ${fmt(live.dailyCapacity ?? 0)} ${tr("seats")}/${tr("day")}` });
    rows.push({ k: tr("Riders"), v: `${fmt(live.riders ?? 0)}/${tr("day")}` });
  }
  if (live) rows.push({ k: tr("Serves"), v: servesText(live.buildings, live.residents, live.jobs) });
  if (u.estimate.homes > 0) {
    const label = u.mode === "network" ? tr("At full capacity") : tr("At full coverage");
    rows.push({ k: label, v: `~${fmt(u.estimate.homes)} ${tr("homes")} · ~${fmt(u.estimate.residents)} ${tr("residents")}` });
  }
  return rows;
}
