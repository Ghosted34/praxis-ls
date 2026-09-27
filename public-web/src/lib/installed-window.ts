/**
 * Is this page showing inside an INSTALLED app window, and how does it get out?
 *
 * ── WHY THIS APP EVER RUNS IN ONE ──────────────────────────────────────────
 *
 * This app has no web manifest, so it can never be installed itself. It shares
 * a host with the staff ERP, though, and the ERP's PWA claims scope "/" on that
 * host (src/routes/pwa.js). Once a staff member installs it, Android — whose
 * WebAPK intent filter is generated from the scope, with no way to exclude a
 * path — opens every link on the host in the staff app's window. A client's
 * portal set-password email opened on such a phone lands HERE, framed as the
 * staff app. So for this app, "in an installed window" means exactly "captured
 * by the staff PWA", and the right response is to offer the way out.
 *
 * The server does what it can first (portal emails prefer the tenant's public
 * host, a different origin; the manifest asks desktop Chromium not to capture
 * links). This is the net under both.
 */

const INSTALLED_MODES = ["standalone", "minimal-ui", "window-controls-overlay", "fullscreen"] as const;

type MatchMedia = (query: string) => { matches: boolean };

/** True when the document is displayed in an installed-app window rather than a browser tab. */
export function isInInstalledWindow(matchMedia: MatchMedia | undefined = typeof window !== "undefined" ? window.matchMedia?.bind(window) : undefined): boolean {
  if (!matchMedia) return false;
  return INSTALLED_MODES.some((m) => matchMedia(`(display-mode: ${m})`).matches);
}

/**
 * The URL that opens `href` in a real browser tab.
 *
 * ANDROID. A plain link to the same host is captured by the same WebAPK again,
 * so it is wrapped in an `intent:` URL naming Chrome's package explicitly — an
 * explicit target is not resolved against other apps' intent filters, so the
 * page opens as a Chrome tab. `S.browser_fallback_url` is what Chrome's own
 * intent handling uses when the package is missing (a phone without Chrome);
 * the fragment is dropped because `#Intent` is the intent URL's own fragment.
 *
 * ELSEWHERE. The URL itself: a desktop app window opens a new-window link in
 * the browser once link capturing is off, which the manifest now asks for.
 */
export function browserUrlFor(href: string, userAgent: string): string {
  if (!/Android/i.test(userAgent)) return href;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return href;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return href;
  const scheme = u.protocol.slice(0, -1);
  return (
    `intent://${u.host}${u.pathname}${u.search}` +
    `#Intent;scheme=${scheme};package=com.android.chrome;` +
    `S.browser_fallback_url=${encodeURIComponent(href)};end`
  );
}
