/**
 * PWA install state — a tiny module-level store so the deferred
 * `beforeinstallprompt` event (fired once, early, on the window) is captured no
 * matter which component mounts later, and shared across the install banner and
 * the account-menu "Install app" action.
 *
 * Platforms differ:
 *   - Android / desktop Chromium fire `beforeinstallprompt`; we stash it and can
 *     later call prompt() to show the native install dialog.
 *   - iOS Safari fires nothing — the only install path is Share → Add to Home
 *     Screen, so there we show instructions instead of a button.
 */
import * as React from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type State = {
  canInstall: boolean; // a deferred prompt is available (Android/desktop)
  installed: boolean; // appinstalled fired this session
  openSignal: number; // bumped to force-open the banner (menu re-entry)
};

let deferred: BeforeInstallPromptEvent | null = null;
let state: State = { canInstall: false, installed: false, openSignal: 0 };
const subscribers = new Set<() => void>();

function emit() {
  for (const fn of subscribers) fn();
}
function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // stop the mini-infobar; we present our own affordance
    deferred = e as BeforeInstallPromptEvent;
    setState({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    setState({ canInstall: false, installed: true });
  });
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia?.("(display-mode: standalone)")?.matches;
  // iOS Safari exposes navigator.standalone instead of the display-mode query.
  const iosStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone ===
    true;
  return !!mm || iosStandalone;
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as Mac; detect the touch-Mac case too.
  const iPadOS =
    navigator.platform === "MacIntel" &&
    (navigator as unknown as { maxTouchPoints: number }).maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

/** Trigger the native install dialog (Android/desktop). */
export async function promptInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  if (!deferred) return "unavailable";
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  if (outcome === "accepted") {
    deferred = null;
    setState({ canInstall: false });
  }
  return outcome;
}

/** Force the install banner to re-appear (e.g. from the account menu), even if
 *  the user dismissed it earlier. */
export function openInstallUi() {
  setState({ openSignal: state.openSignal + 1 });
}

function subscribe(cb: () => void) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function getSnapshot() {
  return state;
}

export function usePwaInstall() {
  const snap = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    canInstall: snap.canInstall,
    installed: snap.installed,
    openSignal: snap.openSignal,
    isIOS: isIOS(),
    isStandalone: isStandalone(),
    promptInstall,
  };
}
