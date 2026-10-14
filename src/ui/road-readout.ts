/** Floating road-build readout: pure formatting and grade math (DOM-free, tested). */
import { curvePoints, type Pt } from "../sim/world";

/** Tile size for the length readout, in metres. */
export const METERS_PER_TILE = 8;

export type RoadReadoutMode = "ground" | "bridge" | "tunnel";
export type RoadPlanSpan = "bridge" | "tunnel" | undefined;
export type RoadDraftLevel = "ground" | "elevated" | "tunnel";

/** Translators injected so this module stays pure (see src/i18n.ts `tr`/`trReason`). */
export interface RoadReadoutI18n {
  tr(key: string, vars?: Record<string, string | number>): string;
  trReason(reason: string): string;
}

export interface RoadReadoutInput {
  /** Price from `planRoad` — never recomputed here. */
  cost: number;
  /**
   * The parallel twin's own price and validity, when the Parallel option is on.
   * The Cost row then shows the combined total; a second row breaks the twin out.
   */
  parallel?: { cost: number; ok: boolean; reason?: string };
  /** Centreline length from `segmentLength`, in tiles. */
  lengthTiles: number;
  /** Steepest grade along the path, in percent (see `maxSlopePercent`). */
  maxSlopePct: number;
  mode: RoadReadoutMode;
  ok: boolean;
  /** Raw `planRoad` reason when invalid; translated, never invented. */
  reason?: string;
  /** Turn from the preceding leg; displayed in the existing floating readout. */
  angleDeg?: number;
}

export interface RoadReadoutRow {
  label: string;
  value: string;
  bad?: boolean;
}

/**
 * Steepest grade along `pts` in percent: max |dh|/dist over ~0.25-tile samples.
 * Heights and distances are both in tile units, so the ratio needs no scaling.
 */
export function maxSlopePercent(pts: Pt[], heightAt: (x: number, z: number) => number): number {
  const samples = curvePoints(pts, 0.25);
  let max = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    if (dist < 1e-9) continue;
    const grade = (Math.abs(heightAt(b.x, b.z) - heightAt(a.x, a.z)) / dist) * 100;
    if (grade > max) max = grade;
  }
  return max;
}

/**
 * Effective elevation mode: the plan's span when set; a valid span-less plan is
 * built at grade (an explicit deck over plain junctions falls back to ground);
 * an invalid plan shows the requested level, since nothing is built yet.
 */
export function resolveReadoutMode(span: RoadPlanSpan, level: RoadDraftLevel, ok: boolean): RoadReadoutMode {
  if (span) return span;
  if (ok) return "ground";
  return level === "elevated" ? "bridge" : level === "tunnel" ? "tunnel" : "ground";
}

const MODE_KEY: Record<RoadReadoutMode, string> = { ground: "Ground", bridge: "Bridge", tunnel: "Tunnel" };

/** One compact row per stat, plus the translated plan reason when invalid. */
export function formatRoadReadout(d: RoadReadoutInput, i18n: RoadReadoutI18n): RoadReadoutRow[] {
  const { tr, trReason } = i18n;
  const total = d.cost + (d.parallel?.cost ?? 0);
  const rows: RoadReadoutRow[] = [
    { label: tr("Cost"), value: `$${Math.round(total).toLocaleString("en-US")}` },
    ...(d.parallel ? [{
      label: tr("Parallel"),
      ...(d.parallel.ok
        ? { value: `$${Math.round(d.parallel.cost).toLocaleString("en-US")}` }
        : d.parallel.reason
          ? { value: trReason(d.parallel.reason), bad: true as const }
          : { value: "–", bad: true as const }),
    }] : []),
    {
      label: tr("Length"),
      value: `${Math.round(d.lengthTiles)} ${tr("tiles")} · ${Math.round(d.lengthTiles * METERS_PER_TILE)} m`,
    },
    { label: tr("Slope"), value: `${Math.round(d.maxSlopePct)}%` },
    ...(d.angleDeg === undefined ? [] : [{ label: tr("Angle"), value: `${Math.round(d.angleDeg)}°` }]),
    { label: tr("Level"), value: tr(MODE_KEY[d.mode]) },
  ];
  if (!d.ok && d.reason) rows.push({ label: "", value: trReason(d.reason), bad: true });
  return rows;
}
