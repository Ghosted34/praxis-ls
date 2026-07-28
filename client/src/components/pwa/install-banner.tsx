/**
 * Install banner — the "download the app" affordance, shown at the bottom on
 * every route. Two flavours:
 *   - Android / desktop Chromium: an "Install" button that fires the native
 *     install dialog (via the captured beforeinstallprompt event).
 *   - iOS Safari: a dismissible instruction card (Share → Add to Home Screen),
 *     the only install path Apple allows.
 * Dismissal is remembered in localStorage so it shows at most once per platform,
 * and can be re-opened from the account menu (openInstallUi bumps openSignal).
 */
import * as React from "react";
import { usePwaInstall } from "@/lib/pwa-install";
import { useBranding } from "@/app/branding/branding-context";
import { XIcon } from "@/components/ui/icons";

const DISMISS_KEY_ANDROID = "pwa-install-dismissed";
const DISMISS_KEY_IOS = "pwa-ios-a2hs-dismissed";

function dismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function rememberDismiss(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* private mode — banner just re-appears next load, acceptable */
  }
}

/** Small inline share glyph (iOS "Share" button look) — avoids touching the
 *  shared icon set for a single-use mark. */
function ShareGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

export function InstallBanner() {
  const { canInstall, isIOS, isStandalone, openSignal, promptInstall } = usePwaInstall();
  const { branding } = useBranding();
  const brandName = branding.name || "Praxis LS";

  // "forced" = the user re-opened the banner from the menu; overrides dismissal.
  const [forced, setForced] = React.useState(false);
  const [closed, setClosed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // React to menu re-entry.
  const firstSignal = React.useRef(openSignal);
  React.useEffect(() => {
    if (openSignal !== firstSignal.current) {
      setForced(true);
      setClosed(false);
    }
  }, [openSignal]);

  // Already installed / running as an app → never show.
  if (isStandalone) return null;

  const iosMode = isIOS;
  const androidMode = !isIOS && canInstall;
  // Nothing to offer (e.g. desktop browser that hasn't fired the event, or an
  // unsupported browser) unless the user explicitly re-opened it.
  if (!iosMode && !androidMode && !forced) return null;

  const key = iosMode ? DISMISS_KEY_IOS : DISMISS_KEY_ANDROID;
  if (!forced && dismissed(key)) return null;
  if (closed) return null;

  const close = () => {
    rememberDismiss(key);
    setClosed(true);
    setForced(false);
  };

  const onInstall = async () => {
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === "accepted" || outcome === "unavailable") close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`Install ${brandName}`}
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+12px)]"
    >
      <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border bg-popover p-4 shadow-l">
        <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
          {brandName.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Install {brandName}</p>
          {iosMode ? (
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
              Tap <ShareGlyph /> <span className="font-medium text-foreground">Share</span>, then{" "}
              <span className="font-medium text-foreground">Add to Home Screen</span> to use {brandName} like an app —
              full screen, on your home screen.
            </p>
          ) : (
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
              Add {brandName} to your device for a faster, full-screen app that works offline.
            </p>
          )}

          {!iosMode && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={onInstall}
                disabled={busy || !canInstall}
                className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Installing…" : "Install"}
              </button>
              <button
                type="button"
                onClick={close}
                className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Not now
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={close}
          className="flex-none rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <XIcon width={16} height={16} />
        </button>
      </div>
    </div>
  );
}
