import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import i18n from "./i18n";
import {
  detectLang,
  getLang,
  setLang,
  LANG_KEY,
  tList,
  currentLocale,
} from "./i18n";
import { en, fr } from "./i18n-dict";

/**
 * The dictionary's own tests — the three failures a bilingual app grows on its
 * own, each of which is invisible in a screenshot of one page in one language.
 *
 *   1. A key that exists in English and not in French. i18next renders the KEY
 *      then falls back, so the French page shows `site.quote.incotermPick` where
 *      a label should be — usually in a corner nobody walks through.
 *   2. A `t("…")` call whose key nobody wrote. Same silent fallback, one page
 *      later, and it can only be found by rendering every screen in every
 *      language — which is what the source scan below does instead, in a
 *      millisecond, on every `npm test`.
 *   3. A translation that answers a question the sentence was not asking — caught
 *      only by structure checks, e.g. `{{tokens}}` must appear on both sides or
 *      the French form renders a literal `{{reference}}` where a quote number
 *      belongs.
 *
 * The scan reads `src/` as text rather than importing components: an unused
 * string in a file that no test renders is exactly the case a render test would
 * miss, and this app's whole promise is that the copy lives in one place.
 */

type Leaf = string | string[] | { [k: string]: unknown };

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out.push(key);
    else if (v && typeof v === "object")
      out.push(...flatten(v as Record<string, unknown>, key));
    else out.push(key);
  }
  return out;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) acc.push(p);
  }
  return acc;
}

describe("the two dictionaries", () => {
  it("have the same keys in both languages", () => {
    const enKeys = flatten(en as unknown as Record<string, unknown>);
    const frKeys = flatten(fr as unknown as Record<string, unknown>);
    const missingInFr = enKeys.filter((k) => !frKeys.includes(k));
    const missingInEn = frKeys.filter((k) => !enKeys.includes(k));
    expect({ missingInFr, missingInEn }).toEqual({
      missingInFr: [],
      missingInEn: [],
    });
  });

  it("never leave a translated leaf empty", () => {
    const empty: string[] = [];
    const walk = (o: Record<string, unknown>, p = "") => {
      for (const [k, v] of Object.entries(o)) {
        const key = p ? `${p}.${k}` : k;
        if (typeof v === "string") {
          if (!v.trim()) empty.push(key);
        } else if (Array.isArray(v)) {
          if (!v.length) empty.push(key);
        } else if (v && typeof v === "object")
          walk(v as Record<string, unknown>, key);
      }
    };
    walk(en as unknown as Record<string, unknown>);
    walk(fr as unknown as Record<string, unknown>);
    expect(empty).toEqual([]);
  });

  it("carries the same interpolation tokens on both sides", () => {
    const tokens = (s: string) =>
      (s.match(/\{\{(\w+)\}\}/g) || []).sort().join(",");
    const bad: string[] = [];
    const walk = (
      a: Record<string, unknown>,
      b: Record<string, unknown>,
      p = "",
    ) => {
      for (const [k, v] of Object.entries(a)) {
        const key = p ? `${p}.${k}` : k;
        const other = (b as Record<string, unknown>)[k];
        if (typeof v === "string" && typeof other === "string") {
          if (tokens(v) !== tokens(other)) bad.push(key);
        } else if (
          v &&
          typeof v === "object" &&
          other &&
          typeof other === "object"
        ) {
          walk(
            v as Record<string, unknown>,
            other as Record<string, unknown>,
            key,
          );
        }
      }
    };
    walk(
      en as unknown as Record<string, unknown>,
      fr as unknown as Record<string, unknown>,
    );
    expect(bad).toEqual([]);
  });

  it("answers every t() and tr() call in the source", () => {
    const keys = new Set(flatten(en as unknown as Record<string, unknown>));
    const strings = new Set(
      Object.keys((en as unknown as { strings: Record<string, Leaf> }).strings),
    );
    const root = process.cwd() + "/src";
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(
        /\bt\(\s*"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g,
      )) {
        if (!keys.has(m[1]))
          offenders.push(`${relative(process.cwd(), file)} → ${m[1]}`);
      }
      // `tr("Some label")` resolves through the `strings.` subtree, and misses
      // fall back to the label itself — the failure to catch is a label spelled
      // differently in the two dictionaries.
      for (const m of src.matchAll(/\btr\(\s*"([^"]+)"\s*\)/g)) {
        if (!strings.has(m[1]))
          offenders.push(
            `${relative(process.cwd(), file)} → strings."${m[1]}"`,
          );
      }
      for (const m of src.matchAll(/\btList[^(]*\(\s*"([a-zA-Z0-9_.]+)"/g)) {
        if (!keys.has(m[1]))
          offenders.push(`${relative(process.cwd(), file)} → ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("translates the status vocabulary the pills print", () => {
    // `Pill` prints `tr(enumLabel(status))`, so every token a public endpoint can
    // return must have a French counterpart or the FR portal is half English.
    const dict = (fr as unknown as { strings: Record<string, string> }).strings;
    const tokens = [
      "In progress",
      "Completed",
      "Pending",
      "Not started",
      "Current",
      "Upcoming",
      "Cancelled",
      "Full time",
      "Internship",
    ];
    const missing = tokens.filter((k) => !(k in dict));
    expect(missing).toEqual([]);
    // and the French must actually differ from the English for at least the ones
    // that have a translation, or the entry is a copy-paste.
    const enStrings = (en as unknown as { strings: Record<string, string> })
      .strings;
    const identical = tokens.filter(
      (k) =>
        k in dict &&
        k in enStrings &&
        dict[k] === enStrings[k] &&
        /[a-zà-ÿ]/.test(dict[k]),
    );
    expect(identical).toEqual([]);
  });
});

describe("language resolution", () => {
  beforeEach(() => {
    localStorage.clear();
    i18n.changeLanguage("en");
  });

  afterEach(() => {
    localStorage.clear();
    // Restore the URL too, not just the store: an assertion that throws before a
    // test's own cleanup line would otherwise leak `?lang=fr` into every case
    // after it — the "flaky when run together" failure that gets blamed on the
    // test runner and then on nothing at all.
    window.history.replaceState({}, "", "/");
  });

  it("reads the query override before anything else", () => {
    // jsdom's URL is about:blank, so drive the same code path the browser would.
    window.history.replaceState({}, "", "/public?lang=fr");
    // The query is what DETECTION reads; `currentLocale()` reads the ACTIVE
    // language, which changes when the toggle calls `setLang` — asserting the
    // locale off a query the app has not applied yet would pin the wrong thing.
    expect(detectLang()).toBe("fr");
    void i18n.changeLanguage("fr");
    expect(currentLocale()).toBe("fr-FR");
  });

  it("falls back to the browser, then to English", () => {
    expect(detectLang()).toBe("en");
  });

  it("persists an explicit choice and drops it on auto", () => {
    setLang("fr");
    expect(localStorage.getItem(LANG_KEY)).toBe("fr");
    expect(getLang()).toBe("fr");
    expect(i18n.language).toBe("fr");
    setLang("auto");
    // "auto" REMOVES the key rather than writing "auto": a stored "auto" would
    // win over the browser check on the next load and freeze the language.
    expect(localStorage.getItem(LANG_KEY)).toBeNull();
  });

  it("returns [] for a tList key that is not a list", () => {
    expect(tList("site.quote")).toEqual([]);
    expect(tList("does.not.exist")).toEqual([]);
    expect(tList<unknown>("site.services.items").length).toBeGreaterThan(0);
  });
});
