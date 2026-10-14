import { describe, expect, it } from "vitest";
import { getLang, hasTranslation, setLang, tr } from "../i18n";
import { STEP_ARMED, STEP_TEXT, STEP_TITLE } from "./onboarding";

/** Every user-facing string the P3-B views render. English is the key; pt-BR must translate it. */
const KEYS = [
  // toasts + bell
  "Notifications", "Clear all", "Dismiss", "Close notifications", "All quiet — no notifications yet.",
  // tooltip
  "Cost", "Free", "Upkeep", "mo",
  // guide chrome
  "Getting started", "Dismiss the guide", "That is the whole loop",
  "Road, zone, let time run. Watch the RCI bars and add services as people arrive.",
  ...Object.values(STEP_TITLE),
  ...Object.values(STEP_TEXT),
  ...Object.values(STEP_ARMED),
];

describe("p3b strings", () => {
  it("exist in pt-BR (default) and pass through in en", () => {
    const prev = getLang();
    try {
      setLang("pt");
      for (const key of KEYS) {
        expect(hasTranslation(key), key).toBe(true);
        expect(tr(key).length, key).toBeGreaterThan(0);
      }
      setLang("en");
      for (const key of KEYS) expect(tr(key), key).toBe(key);
    } finally {
      setLang(prev);
    }
  });
});
