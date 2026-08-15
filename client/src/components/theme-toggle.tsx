/**
 * Theme toggle — flips between Light and Dark only. "System" is never a
 * user-selectable state; it's just the silent default the app resolves to when
 * the user hasn't chosen yet (see theme-mode.ts: getMode() falls back to
 * "system", resolved() follows the OS). The first click commits an explicit
 * light/dark preference.
 */
import * as React from "react";
import { getMode, setMode, resolved } from "@/lib/theme-mode";
import { SunIcon, MoonIcon } from "@/components/ui/icons";

export function ThemeToggle() {
  // Track the concrete appearance (light|dark), resolving "system" via the OS.
  const [dark, setDark] = React.useState<boolean>(
    () => resolved(getMode()) === "dark",
  );

  function toggle() {
    const next = dark ? "light" : "dark";
    setMode(next);
    setDark(next === "dark");
  }

  const label = dark ? "Dark" : "Light";
  return (
    <button
      onClick={toggle}
      title={`Theme: ${label} (click to switch)`}
      aria-label={`Theme: ${label}. Click to switch.`}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      {dark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
