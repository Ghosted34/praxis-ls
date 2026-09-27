/**
 * Token store. The access token lives in memory only (lost on reload —
 * refreshed from the refresh token on boot). The refresh token lives in
 * localStorage, so every tab of the workspace shares one session and a reload
 * restores it.
 *
 * ── WHY THERE IS NO "KEEP ME SIGNED IN" ANY MORE ──────────────────────────
 *
 * The checkbox used to choose between localStorage (a 30-day session) and
 * sessionStorage (one tab). Sessions now END two hours after sign-in whatever
 * was ticked (server: SESSION_MAX_AGE_MIN, enforced on every token) and the
 * screen locks, so the only thing the choice still decided was whether a new
 * tab opened signed in. A session that the user cannot see in their other tab
 * is a support ticket, not a security property. One store.
 *
 * ── THE LOCK FLAG ─────────────────────────────────────────────────────────
 *
 * While the screen is locked (auth-context), `api()` refuses authenticated
 * calls without touching the network. Nothing behind the blur can act, and a
 * locked tab does not spend the next hour firing polls that 401.
 *
 * NOTE (security tradeoff, flagged for the team): a refresh token in web storage
 * is readable by any XSS on the page. Acceptable for the scaffold; revisit with
 * httpOnly-cookie refresh + CSRF if the threat model demands it. Everything
 * funnels through here so that swap is a one-file change.
 */
const REFRESH_KEY = "praxis.refresh";
/** Written by builds before the two-hour ceiling; read once to clean it up. */
const LEGACY_PERSIST_KEY = "praxis.refresh.persist";
const ENV_KEY = "praxis.env"; // 'live' | 'sandbox' (X-Praxis-Env)

let accessToken: string | null = null;
let locked = false;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    /* @silent:storage — private mode / blocked storage; behave as empty. */
    return fallback;
  }
}

export const tokenStore = {
  REFRESH_KEY,

  getAccess: () => accessToken,
  setAccess: (t: string | null) => {
    accessToken = t;
  },

  // A refresh token written into sessionStorage by an older build is still
  // honoured, so nobody is signed out by the upgrade itself.
  getRefresh: () =>
    safe(() => localStorage.getItem(REFRESH_KEY) || sessionStorage.getItem(REFRESH_KEY), null),
  setRefresh: (t: string | null) => {
    safe(() => {
      localStorage.removeItem(REFRESH_KEY);
      sessionStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(LEGACY_PERSIST_KEY);
      if (t) localStorage.setItem(REFRESH_KEY, t);
    }, undefined);
  },

  /** The screen is locked: authenticated calls are refused locally. */
  isLocked: () => locked,
  setLocked: (v: boolean) => {
    locked = v;
  },

  getEnv: () => safe(() => localStorage.getItem(ENV_KEY), null) || "live",
  setEnv: (e: string) => safe(() => localStorage.setItem(ENV_KEY, e), undefined),

  clear: () => {
    accessToken = null;
    safe(() => {
      localStorage.removeItem(REFRESH_KEY);
      sessionStorage.removeItem(REFRESH_KEY);
    }, undefined);
  },
};
