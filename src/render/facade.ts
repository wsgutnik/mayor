// Portions adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10): buildings/facadeShader.js#bayLayout, #doorCentre, #dockLayout.
/** Pure facade measurements in Mayor tile units (docs/process/09-fable-buildings-port.md §3.1). */

export const KIT_STOREY = 0.25;
export const FACADE_SIDE_MARGIN = 0.55 / 8;

export type FacadeStyle = "house" | "apartment" | "retail" | "curtain" | "industrial";
export interface BayLayout { count: number; bay: number; usable: number; side: number }

/** Fable's `bayLayout`, converted from metres to tiles. Never returns a zero-width bay. */
export function bayLayout(faceWidth: number, wantedBay = 1.2 / 8): BayLayout {
  const side = Math.min(FACADE_SIDE_MARGIN, Math.max(0, faceWidth * 0.24));
  const usable = Math.max(faceWidth - side * 2, faceWidth * 0.5);
  const count = Math.max(1, Math.floor(usable / Math.max(wantedBay, 1e-4) + 0.35));
  return { count, bay: usable / count, usable, side };
}

/** Centre of the front door bay, or 0 for a symmetric facade without a door. */
export function doorCentre(layout: BayLayout, hasDoor = true): number {
  return hasDoor ? layout.side + (Math.floor(layout.count / 2) + 0.5) * layout.bay : 0;
}

export interface FacadeParams { style: FacadeStyle; floorH: number; groundH: number; bayW: number; winFrac: number; litBias: number }
export function facadeParams(style: FacadeStyle, _floors: number): FacadeParams {
  void _floors;
  const floorH = KIT_STOREY;
  const groundH = style === "retail" ? floorH * 1.4 : floorH * (style === "apartment" ? 1.13 : 1);
  const litBias = style === "industrial" ? 0.35 : style === "retail" ? 0.75 : style === "curtain" ? 0.55 : style === "house" ? 0.70 : 0.60;
  return { style, floorH, groundH, bayW: 1.2 / 8, winFrac: style === "apartment" ? 0.5 : 0.55, litBias };
}

/** Deterministic facade grid check used by recipes and tests. */
export function checkFacade(layout: BayLayout): boolean {
  return layout.count >= 1 && layout.bay > 0 && layout.side >= 0 && Math.abs(layout.side * 2 + layout.usable - (layout.usable + layout.side * 2)) < 1e-6;
}
