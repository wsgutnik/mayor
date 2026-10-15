import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getLang, hasTranslation, setLang, tr } from "../i18n";
import { CREDITS, CREDITS_KEYS, FABLE_MIT_NOTICE, creditsHtml } from "./credits";

const NOTICE = readFileSync(new URL("../../NOTICE.md", import.meta.url), "utf8");
const MENU = readFileSync(new URL("./menu.ts", import.meta.url), "utf8");

describe("about and credits", () => {
  it("translates every About string to pt-BR and passes it through in en", () => {
    const prev = getLang();
    try {
      setLang("pt");
      for (const key of CREDITS_KEYS) expect(hasTranslation(key), key).toBe(true);
      setLang("en");
      for (const key of CREDITS_KEYS) expect(tr(key), key).toBe(key);
    } finally {
      setLang(prev);
    }
  });

  it("names only sources that NOTICE.md also records", () => {
    for (const c of CREDITS) {
      const author = c.by.split(" (")[0];
      const named = NOTICE.includes(author) || NOTICE.includes(c.name.split(" (")[0]);
      expect(named, `${c.name} / ${c.by} missing from NOTICE.md`).toBe(true);
      expect(c.url.startsWith("https://"), c.url).toBe(true);
    }
    // Every licence family in NOTICE.md is represented.
    for (const lic of ["CC0", "MIT"]) expect(CREDITS.some((c) => c.license.includes(lic)), lic).toBe(true);
  });

  it("carries the Fable Cities MIT notice verbatim (modulo line wrapping)", () => {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const start = NOTICE.indexOf("MIT License — Copyright (c) 2026 raw");
    const end = NOTICE.indexOf("SOFTWARE.", NOTICE.indexOf("IN NO EVENT", start)) + "SOFTWARE.".length;
    expect(start).toBeGreaterThan(0);
    expect(norm(FABLE_MIT_NOTICE)).toBe(norm(NOTICE.slice(start, end)));
  });

  it("renders every credit, the privacy line and the version, escaped", () => {
    const prev = getLang();
    try {
      setLang("pt");
      const html = creditsHtml("1.2.3");
      for (const c of CREDITS) {
        expect(html).toContain(c.license);
        expect(html).toContain(tr(c.use));
      }
      expect(html).toContain("Fable Cities");
      expect(html).toContain("não coleta dados");
      expect(html).toContain("1.2.3");
      expect(creditsHtml("<b>")).toContain("&lt;b&gt;");
      expect(creditsHtml("<b>")).not.toContain("<b><");
    } finally {
      setLang(prev);
    }
  });

  it("is reachable from the menu", () => {
    expect(MENU).toContain("data-about");
    expect(MENU).toContain("creditsHtml(");
  });
});
