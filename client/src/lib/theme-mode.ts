/**
 * Light / dark / system theme mode. Tailwind is darkMode:"class", so this just
 * toggles the `dark` class on <html> — every token in index.css flips, tenant
 * colour included (applyBrand's inline vars apply in both modes). Persists the
 * choice; when set to "system" it follows the OS and live-updates if the OS
 * preference changes. Call initThemeMode() once at boot.
 */
export type ThemeMode = "light" | "dark" | "system";

const KEY = "praxis.theme";
const mql = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** The concrete appearance a mode resolves to right now. */
export function resolved(mode: ThemeMode = getMode()): "light" | "dark" {
  return mode === "system" ? (mql().matches ? "dark" : "light") : mode;
}

function apply(mode: ThemeMode) {
  document.documentElement.classList.toggle("dark", resolved(mode) === "dark");
}

export function setMode(mode: ThemeMode) {
  localStorage.setItem(KEY, mode);
  apply(mode);
}

/** Apply the stored mode and keep "system" in sync with OS changes. */
export function initThemeMode() {
  apply(getMode());
  mql().addEventListener("change", () => {
    if (getMode() === "system") apply("system");
  });
}
