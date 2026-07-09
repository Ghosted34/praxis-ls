/**
 * Theme toggle — cycles light → dark → system and back. Shows the current mode's
 * icon (sun/moon/monitor). Persists via theme-mode.ts.
 */
import * as React from "react";
import { getMode, setMode, type ThemeMode } from "@/lib/theme-mode";
import { SunIcon, MoonIcon, MonitorIcon } from "@/components/ui/icons";

const ORDER: ThemeMode[] = ["light", "dark", "system"];
const NEXT: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "system", system: "light" };
const ICON = { light: SunIcon, dark: MoonIcon, system: MonitorIcon };
const LABEL = { light: "Light", dark: "Dark", system: "System" };

export function ThemeToggle() {
  const [mode, setLocal] = React.useState<ThemeMode>(() => getMode());
  const Icon = ICON[mode];

  function cycle() {
    const next = NEXT[mode];
    setMode(next);
    setLocal(next);
  }

  return (
    <button
      onClick={cycle}
      title={`Theme: ${LABEL[mode]} (click to change)`}
      aria-label={`Theme: ${LABEL[mode]}. Click to change.`}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      <Icon />
    </button>
  );
}

export { ORDER };
