import * as React from "react";
import { useTranslation } from "react-i18next";
import { getMode, setMode, type ThemeMode } from "@/lib/theme-mode";
import { MoonIcon, SunIcon } from "@/components/ui/icons";

/**
 * Light / dark. Two states, no "system", and the choice persists.
 *
 * `client`'s equivalent cycles light → dark → system, which is right for an app
 * somebody lives in for eight hours and wrong for a page somebody reads for two
 * minutes: a third state means a visitor cannot tell what they have selected, and
 * on this surface the OS default is already honoured before they touch anything
 * (see the `prefers-color-scheme` note in `index.css`).
 *
 * There is no flash to fix here — `index.html`'s inline script has already read
 * the stored value before first paint, which is the only reason a pre-paint theme
 * script is allowed to exist in this repo.
 */
export function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const { t } = useTranslation();
  const [mode, setLocal] = React.useState<ThemeMode>(() => getMode());
  const next: ThemeMode = mode === "dark" ? "light" : "dark";
  const Icon = mode === "dark" ? SunIcon : MoonIcon;
  const label =
    mode === "dark" ? t("site.chrome.themeLight") : t("site.chrome.themeDark");

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        setMode(next);
        setLocal(next);
      }}
      className={
        onDark
          ? "grid h-8 w-8 place-items-center rounded-full text-[var(--hero-muted)] transition-colors hover:bg-[rgb(237_238_238/0.14)] hover:text-[var(--hero-foreground)]"
          : "btn-surface grid h-9 w-9 place-items-center rounded-full"
      }
    >
      <Icon size={16} />
    </button>
  );
}
