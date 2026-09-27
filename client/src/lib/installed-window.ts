/**
 * Outsider pages inside the installed staff app — detecting it, and the way out.
 *
 * This app IS the installable PWA (manifest scope "/", src/routes/pwa.js), and
 * a few of its routes are for people who are not staff: the signing page, the
 * signature verifier printed in QR codes, and the secure-link viewer. With the
 * app installed, Android opens every link on the host in the app's window — its
 * WebAPK intent filter comes from the scope, and a scope cannot exclude a path —
 * so a counterparty's signing link opened on a staff member's phone, or a link
 * a staff member forwards to themselves to check, lands in the staff app. On
 * those routes the app offers to reopen the page in the browser and does not
 * advertise itself (no install banner, no push prompt) to a stranger.
 *
 * The same logic lives in public-web/src/lib/installed-window.ts; two copies
 * because the apps share no runtime package for UI code, and both are small
 * enough to read side by side.
 */

/**
 * Staff-app routes a stranger follows from a link or a QR code (see
 * app/app.tsx: all outside RequireAuth and AppShell). The portal is not here:
 * `/portal` is served by public-web, which handles its own case.
 */
const OUTSIDER_ROUTES = /^\/(sign|v|verify|s)(\/|$)/;

export function isOutsiderPath(pathname: string): boolean {
  return OUTSIDER_ROUTES.test(pathname);
}

const INSTALLED_MODES = ["standalone", "minimal-ui", "window-controls-overlay", "fullscreen"] as const;

type MatchMedia = (query: string) => { matches: boolean };

/** True when the document is displayed in an installed-app window rather than a browser tab. */
export function isInInstalledWindow(
  matchMedia: MatchMedia | undefined = typeof window !== "undefined" ? window.matchMedia?.bind(window) : undefined,
): boolean {
  if (!matchMedia) return false;
  return INSTALLED_MODES.some((m) => matchMedia(`(display-mode: ${m})`).matches);
}

/**
 * The URL that opens `href` in a real browser tab. On Android, an `intent:` URL
 * naming Chrome explicitly — a plain same-host link would be captured by the
 * same WebAPK again, and an explicit package is not resolved against other
 * apps' intent filters. `S.browser_fallback_url` covers a phone without Chrome.
 * Elsewhere the URL itself: a desktop app window sends a new-window link to the
 * browser once link capturing is off, which the manifest asks for.
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
