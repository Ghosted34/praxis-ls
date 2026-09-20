/**
 * i18n bootstrap (PRD §605/§617). react-i18next over i18next with two
 * built-in dictionaries (en / fr). Language resolution:
 *   1. `localStorage["praxis.lang.<user_id>"]` — this account's explicit
 *      top-bar choice on this browser.
 *   2. fallback "en" before login and for every account with no saved choice.
 * The user id is part of the key so a French-speaking colleague signing out on
 * a shared workstation cannot silently switch the next fresh login to French.
 * The tenant's entity default_language (EN/FR, settings §12.2) could seed this
 * on first visit; it is read server-side for documents today. `import "./i18n"`
 * happens in main.tsx BEFORE the app renders so the first paint is correct.
 */
import * as React from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en, fr } from "./i18n-dict";

export const LANG_KEY = "praxis.lang";
let languageOwner: string | null = null;
const keyFor = (userId: string) => `${LANG_KEY}.${userId}`;

/** Before identity is known, never inherit the previous person's language. */
export function detectLang(): string {
  return "en";
}

/** Bind browser persistence to the authenticated account, not the device. */
export function bindLanguageOwner(userId: string | null | undefined) {
  languageOwner = userId || null;
  let lang: "en" | "fr" = "en";
  if (languageOwner) {
    try {
      const saved = window.localStorage.getItem(keyFor(languageOwner));
      if (saved === "en" || saved === "fr") lang = saved;
    } catch {
      /* @silent:storage unavailable — English for this session */
    }
  }
  void i18n.changeLanguage(lang);
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

export function setLang(lang: "en" | "fr") {
  try {
    if (languageOwner) window.localStorage.setItem(keyFor(languageOwner), lang);
  } catch {
    /* @silent:storage unavailable — session only */
  }
  void i18n.changeLanguage(lang);
}

/**
 * Translate a navigation label by its EXACT English text. The dict's `nav`
 * section is keyed by the label itself, so a surface that renders a label
 * (areas.ts, nav-model.ts, ribbon, rail, tabs) can translate without knowing
 * an id — and anything missing falls back to the English label harmlessly.
 */
export function navT(t: (k: string, o?: { defaultValue?: string }) => string, label: string): string {
  return t(`nav.${label}`, { defaultValue: label });
}

/**
 * Translate a UI string by its exact English text (fallback: English).
 *
 * Bulk-conversion path for the remaining screens: the `strings` dictionary in
 * i18n-dict.ts is keyed by the English source text, so a screen converts
 * without id bookkeeping and anything not yet translated renders English
 * harmlessly. The app roots call useLang() so every tr() consumer re-renders
 * when the toggle flips.
 */
export function tr(label: string): string {
  const out = i18n.t(`strings.${label}`, { defaultValue: label });
  return typeof out === "string" ? out : label;
}

/**
 * tr() with interpolation: same exact-English-key lookup, but
 * {{placeholders}} are filled from `vars` inside the translation (i18next),
 * so a French "Vu le {{date}} à {{time}}" keeps its word order.
 */
export function tv(label: string, vars: Record<string, string | number>): string {
  const out = i18n.t(`strings.${label}`, { defaultValue: label, ...vars });
  return typeof out === "string" ? out : label;
}

/**
 * Subscribe the calling component (usually an app root) to language changes.
 * tr() reads the global i18next instance, so without this a component would
 * keep its first language until remount.
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

/** Locale for Intl formatting — French numbers/dates use fr-FR, everything
 *  else stays en. Kept here so format.ts and any component agree. */
export function currentLocale(): string {
  return i18n.language?.startsWith("fr") ? "fr-FR" : "en-US";
}

export default i18n;
