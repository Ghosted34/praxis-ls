/**
 * Is the Window Controls Overlay actually active?
 *
 * WHY THIS IS A DIAGNOSTIC AND NOT A FEATURE FLAG. Nothing in the shell branches
 * on WCO — `.wco` uses `env(titlebar-area-*)` with fallbacks, so the same markup
 * is the title bar when the overlay exists and an ordinary utility bar when it
 * does not. That is the right design and it has one cost: when WCO silently
 * fails to activate, the app looks completely normal and the only symptom is a
 * duplicate title bar above it, with no way to tell whether the manifest, the
 * install, or the browser is at fault.
 *
 * This reports what the browser actually decided, so the App & PWA screen can
 * say it out loud instead of leaving someone to reinstall repeatedly and guess.
 *
 * THE THREE STATES ARE DIFFERENT PROBLEMS:
 *   unsupported  not a Chromium desktop browser — Safari and every mobile
 *                browser, where there is nothing to diagnose.
 *   windowed     supported, but the app is running in a browser TAB. There is no
 *                title bar to take over; install it.
 *   inactive     supported AND installed AND standalone, but the overlay is off.
 *                This is the one worth investigating: the installed manifest
 *                does not carry `display_override`, which usually means the app
 *                was installed before it did, or was added via "Create shortcut"
 *                rather than installed as an app.
 */
export type WcoState = "unsupported" | "windowed" | "inactive" | "active";

type WindowControlsOverlay = {
  visible: boolean;
  addEventListener(type: "geometrychange", fn: () => void): void;
  removeEventListener(type: "geometrychange", fn: () => void): void;
};

function overlay(): WindowControlsOverlay | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay }).windowControlsOverlay ?? null;
}

/** Running as an installed app rather than in a tab. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

export function readWcoState(): WcoState {
  const wco = overlay();
  if (!wco) return "unsupported";
  if (wco.visible) return "active";
  return isStandaloneDisplay() ? "inactive" : "windowed";
}
