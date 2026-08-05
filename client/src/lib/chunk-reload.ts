/**
 * Recover from a stale build's chunk references.
 *
 * THE FAILURE. Every route in this app is lazy, and Vite fingerprints each chunk
 * (`index-CRdI1OP9.js`). A deploy replaces those files with new hashes and
 * deletes the old ones. Meanwhile the service worker registers with
 * `registerType: "prompt"` (vite.config.ts), so a tab that was open across the
 * deploy keeps serving the PREVIOUS index.html — which points at chunk names the
 * server no longer has — until the user clicks Reload on the update toast.
 *
 * So anyone who ignores that toast and then navigates to a screen they have not
 * visited yet gets "Failed to fetch dynamically imported module". The app looks
 * broken; nothing is broken; the HTML is simply out of date. It happens to every
 * user on every deploy, which is what makes it worth handling rather than
 * leaving to the error boundary.
 *
 * WHY RELOAD RATHER THAN RETRY. Retrying the import re-requests the same dead
 * URL, so it fails identically. Only a full reload fetches a fresh index.html
 * with the current hashes — which is exactly what the boundary's "Reload the
 * page" button does, just without making a user read an error first.
 *
 * WHY IT CANNOT LOOP. A reload is only attempted ONCE per session, recorded in
 * sessionStorage before navigating. If the very next load fails the same way,
 * the cause is not a stale build — the network is down, or an asset is genuinely
 * missing — and the error must reach the boundary where a human can see it. A
 * naive version of this is an infinite refresh loop on an offline device, which
 * is far worse than the error it replaces.
 */
const FLAG = "praxis.chunk-reloaded";

/** Vite/browser wording for a chunk that will not load. Matched loosely because
 *  the phrasing differs across Chromium, Firefox and Safari, and a missed match
 *  means an unnecessary error screen. */
function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /'text\/html' is not a valid JavaScript MIME type/i.test(msg)
  );
}

function alreadyTried(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    // Private mode: no way to remember, so never reload — an unrecoverable
    // error screen beats a refresh loop the user cannot escape.
    return true;
  }
}

/** Called once the app has rendered successfully, so the NEXT deploy can
 *  recover too rather than being locked out by a flag from this one. */
export function clearChunkReloadFlag() {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Wrap a dynamic import so a stale-build failure reloads instead of surfacing.
 * Any other error — a genuine bug in the module — passes straight through.
 */
export function withChunkReload<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((err) => {
      if (!isStaleChunkError(err) || alreadyTried()) throw err;
      try {
        sessionStorage.setItem(FLAG, "1");
      } catch {
        throw err;
      }
      window.location.reload();
      // Never settles: the page is going away. Resolving or rejecting here would
      // let React render either the screen or the error boundary in the moments
      // before navigation, which flashes content the user should not see.
      return new Promise<T>(() => {});
    });
}
