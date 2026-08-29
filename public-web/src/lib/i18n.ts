/**
 * i18n bootstrap — the same mechanism as `client/src/lib/i18n.ts` (i18next over
 * two built-in dictionaries), with the resolution rules rewritten for a surface
 * a stranger lands on.
 *
 * ── WHAT CHANGED, AND WHY IT MATTERS MORE HERE ─────────────────────────────
 *
 * `client` resolves language from `localStorage["praxis.lang"]` and nothing
 * else. Inside the ERP that is right: the user is known, they chose once, and the
 * whole app follows. On a public page, three more things should be consulted, in
 * this order:
 *
 *   1. `?lang=fr` — an explicit link. A forwarded job advert and a French-language
 *      email campaign must land in French even in a browser that has never seen
 *      this site. `client/src/features/sales/public-proposal.tsx` already reads
 *      `?lang` for the same reason, on the one page where the server renders a
 *      document in the requested language.
 *   2. `localStorage["praxis.lang"]` — the visitor's own choice, and THE SAME KEY
 *      the staff app writes. Not a coincidence: sign out of the ERP into the
 *      portal, or open a client's marketing page after using their workspace, and
 *      the language follows rather than resetting.
 *   3. `navigator.language` — for the visitor who has never been here and never
 *      touches a toggle. A Cameroonian client opening a tracking link on a phone
 *      set to French should not have to find the switch.
 *   4. English.
 *
 * ── WHAT IS DELIBERATELY NOT DONE (doc/WEB_BUILD_BRIEF.md N7) ───────────────
 *
 * No `/en/`–`/fr/` URL prefixes, no `hreflang` alternates, no localised slugs.
 * The guide specifies those for praxisls.com — a static, single-brand site whose
 * whole purpose is search. This app is per-tenant and served under a tenant's own
 * subdomain, where `/public` is one tree; prefixing it would put a language code
 * in the URL that shared proposal and careers links have to survive being read
 * off a phone. `pickSlug` in `lib/services-api.ts` is the part that DOES port:
 * service profiles have per-language slugs, so the switcher maps to the equivalent
 * page rather than dumping the visitor on the homepage. `lang` on `<html>` is set
 * per route render (see `app/lang-attr.tsx`), which is the half that costs
 * nothing and is the half a screen reader actually uses.
 */
import * as React from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en, fr } from "./i18n-dict";

export type Lang = "en" | "fr";

export const LANG_KEY = "praxis.lang";

const asLang = (v: unknown): Lang | null =>
  v === "fr" || v === "en" ? v : null;

function fromQuery(): Lang | null {
  try {
    return asLang(new URLSearchParams(window.location.search).get("lang"));
  } catch {
    return null;
  }
}

function fromStorage(): Lang | null {
  try {
    return asLang(window.localStorage.getItem(LANG_KEY));
  } catch {
    /* storage unavailable (private mode, embedded webview) */
    return null;
  }
}

function fromBrowser(): Lang | null {
  try {
    const tags = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    for (const tag of tags) {
      if (asLang(String(tag || "").slice(0, 2)))
        return asLang(String(tag).slice(0, 2));
    }
    return null;
  } catch {
    return null;
  }
}

/** The whole cascade, in priority order. Exported for the test and for the
 *  mount path in main.tsx, which has to run it BEFORE the first render. */
export function detectLang(): Lang {
  return fromQuery() || fromStorage() || fromBrowser() || "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: typeof window !== "undefined" ? detectLang() : "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export type LangChoice = Lang | "auto";

/**
 * `"auto"` clears the explicit choice rather than writing `"en"`.
 *
 * That distinction is the difference between "this visitor prefers English" and
 * "this visitor poked the toggle": the first is a preference to keep, the second
 * is a mistake to be able to undo. Undoing it hands the decision back to the
 * browser, which is what `detectLang`'s cascade is for.
 */
export function setLang(lang: LangChoice): void {
  try {
    if (lang === "auto") window.localStorage.removeItem(LANG_KEY);
    else window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* session only */
  }
  void i18n.changeLanguage(lang === "auto" ? detectLang() : lang);
}

export const getLang = (): Lang =>
  i18n.language?.startsWith("fr") ? "fr" : "en";

/**
 * Translate a UI string by its exact English text (fallback: English).
 *
 * Ported from the client, and kept for the same reason: `strings` is keyed by the
 * source text, so a screen converts without id bookkeeping and an untranslated
 * string renders English harmlessly instead of blank. Bulk conversion of the
 * portal screens depends on it.
 */
export function tr(label: string): string {
  const out = i18n.t(`strings.${label}`, { defaultValue: label });
  return typeof out === "string" ? out : label;
}

/**
 * Subscribe the calling component to language changes. `tr()` reads the global
 * instance, so without this a component keeps its first language until it
 * remounts — which is how a page ends up half in French.
 */
export function useLang(): void {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const bump = () => force();
    i18n.on("languageChanged", bump);
    return () => {
      i18n.off("languageChanged", bump);
    };
  }, []);
}

/**
 * A dictionary section that is a LIST (the service cards, the how-it-works steps,
 * the preview stages). `returnObjects` is how i18next hands back structure, and
 * the array check is the guard: an uninitialised or mis-keyed dictionary returns
 * `[]` so a section renders nothing rather than throwing on the homepage.
 *
 * The machine tokens inside those objects — `state: "done" | "current" | "next"`,
 * for instance — are NOT translated, in either language. A dictionary that holds
 * French for a value a component switches on is a component that silently stops
 * matching in one language only.
 */
export function tList<T>(key: string): T[] {
  const v = i18n.t(key, { returnObjects: true });
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Locale for `Intl` — French numbers and dates use fr-FR, everything else
 *  en-GB. Kept here so `lib/format.ts` and every component agree. */
export function currentLocale(): string {
  return getLang() === "fr" ? "fr-FR" : "en-GB";
}

export default i18n;
