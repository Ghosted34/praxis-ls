/**
 * Token store. Access token lives in memory only (lost on reload — refreshed
 * from the refresh token on boot). Refresh token persistence depends on the
 * user's "Keep me signed in" choice:
 *   • checked  → refresh in localStorage (survives reload / new tab / restart)
 *   • unchecked → refresh in sessionStorage (gone when the tab/window closes)
 * Either way a reload within the same session restores the session; closing the
 * browser only keeps you in when you asked to be kept in.
 *
 * NOTE (security tradeoff, flagged for the team): a refresh token in web storage
 * is readable by any XSS on the page. Acceptable for the scaffold; revisit with
 * httpOnly-cookie refresh + CSRF if the threat model demands it. Everything
 * funnels through here so that swap is a one-file change.
 */
const REFRESH_KEY = "praxis.refresh";
const PERSIST_KEY = "praxis.refresh.persist"; // remembers which store the refresh lives in
const ENV_KEY = "praxis.env"; // 'live' | 'sandbox' (X-Praxis-Env)

let accessToken: string | null = null;

/** Which web-storage backs the refresh token, per the keep-signed-in choice. */
function refreshStore(): Storage {
  return localStorage.getItem(PERSIST_KEY) === "0"
    ? sessionStorage
    : localStorage;
}

export const tokenStore = {
  getAccess: () => accessToken,
  setAccess: (t: string | null) => {
    accessToken = t;
  },

  /** Set whether the refresh token should persist across browser restarts. */
  setPersist: (keep: boolean) => {
    localStorage.setItem(PERSIST_KEY, keep ? "1" : "0");
  },
  getPersist: () => localStorage.getItem(PERSIST_KEY) !== "0",

  // Read from whichever store currently holds it (checking both is fine — one is empty).
  getRefresh: () =>
    localStorage.getItem(REFRESH_KEY) || sessionStorage.getItem(REFRESH_KEY),
  setRefresh: (t: string | null) => {
    // Always clear both first so a token never lingers in the other store.
    localStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    if (t) refreshStore().setItem(REFRESH_KEY, t);
  },

  getEnv: () => localStorage.getItem(ENV_KEY) || "live",
  setEnv: (e: string) => localStorage.setItem(ENV_KEY, e),

  clear: () => {
    accessToken = null;
    localStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
  },
};
