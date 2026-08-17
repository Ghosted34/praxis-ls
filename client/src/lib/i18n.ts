/**
 * i18n bootstrap (PRD §605/§617). react-i18next over i18next with two
 * built-in dictionaries (en / fr). Language resolution:
 *   1. `localStorage["praxis.lang"]` — the per-browser preference, set by the
 *      top-bar toggle (per-user in spirit; the staff app has no per-user
 *      language column yet, so the browser is the persistence boundary).
 *   2. fallback "en".
 * The tenant's entity default_language (EN/FR, settings §12.2) could seed this
 * on first visit; it is read server-side for documents today. `import "./i18n"`
 * happens in main.tsx BEFORE the app renders so the first paint is correct.
 */
import * as React from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en, fr } from "./i18n-dict";

export const LANG_KEY = "praxis.lang";

export function detectLang(): string {
  try {
    const saved = window.localStorage.getItem(LANG_KEY);
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    /* storage unavailable — fall through */
  }
  return "en";
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
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage unavailable — session only */
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
