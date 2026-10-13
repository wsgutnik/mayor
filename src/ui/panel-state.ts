/** Collapsible HUD panel state, persisted across sessions (key `mayor:ui-panels`).
 *
 * Pure helpers so the HUD stays thin: parsing tolerates anything, storage
 * access is wrapped in try/catch (private mode, blocked cookies), and every
 * update returns a new object. Only collapse/visibility is stored here; what
 * each panel shows is unchanged.
 */

export const PANEL_STORAGE_KEY = "mayor:ui-panels";

/** Every permanent HUD panel that can collapse on its own. */
export type PanelId = "demand" | "indicators" | "services" | "lines";

export const PANEL_IDS: readonly PanelId[] = ["demand", "indicators", "services", "lines"];

export interface PanelState {
  collapsed: Record<PanelId, boolean>;
  /** The whole left stack is hidden to reveal the city (key H). */
  panelsHidden: boolean;
}

export function defaultPanelState(): PanelState {
  return { collapsed: { demand: false, indicators: false, services: false, lines: false }, panelsHidden: false };
}

function isPanelId(v: unknown): v is PanelId {
  return v === "demand" || v === "indicators" || v === "services" || v === "lines";
}

/** Parse a stored value; unknown, missing or corrupt input falls back to defaults. */
export function parsePanelState(raw: unknown): PanelState {
  const out = defaultPanelState();
  if (typeof raw !== "string" || !raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof parsed !== "object" || parsed === null) return out;
  const rec = parsed as Record<string, unknown>;
  if (rec.panelsHidden === true) out.panelsHidden = true;
  if (typeof rec.collapsed === "object" && rec.collapsed !== null) {
    for (const [k, v] of Object.entries(rec.collapsed)) {
      if (isPanelId(k) && v === true) out.collapsed[k] = true;
    }
  }
  return out;
}

export function serializePanelState(s: PanelState): string {
  return JSON.stringify({ collapsed: s.collapsed, panelsHidden: s.panelsHidden });
}

/** Minimal storage surface so tests can pass a fake; the real one is localStorage. */
export type PanelStorage = Pick<Storage, "getItem" | "setItem">;

function activeStorage(passed?: PanelStorage | null): PanelStorage | null {
  if (passed) return passed;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPanelState(storage?: PanelStorage | null): PanelState {
  try {
    return parsePanelState(activeStorage(storage)?.getItem(PANEL_STORAGE_KEY) ?? null);
  } catch {
    return defaultPanelState();
  }
}

export function savePanelState(s: PanelState, storage?: PanelStorage | null): void {
  try {
    activeStorage(storage)?.setItem(PANEL_STORAGE_KEY, serializePanelState(s));
  } catch {
    /* storage blocked: panel state lasts for this session only */
  }
}

export function setPanelCollapsed(s: PanelState, id: PanelId, collapsed: boolean): PanelState {
  if (s.collapsed[id] === collapsed) return s;
  return { ...s, collapsed: { ...s.collapsed, [id]: collapsed } };
}

export function togglePanelCollapsed(s: PanelState, id: PanelId): PanelState {
  return setPanelCollapsed(s, id, !s.collapsed[id]);
}

export function setPanelsHidden(s: PanelState, hidden: boolean): PanelState {
  return s.panelsHidden === hidden ? s : { ...s, panelsHidden: hidden };
}

export function togglePanelsHidden(s: PanelState): PanelState {
  return setPanelsHidden(s, !s.panelsHidden);
}
