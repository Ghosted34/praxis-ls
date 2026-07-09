/**
 * Token store. Access token lives in memory only (lost on reload — refreshed
 * from the refresh token on boot). Refresh token is persisted so a reload keeps
 * you logged in. NOTE (security tradeoff, flagged for the team): a refresh token
 * in localStorage is readable by any XSS on the page. Acceptable for the
 * scaffold; revisit with httpOnly-cookie refresh + CSRF if the threat model
 * demands it. Everything funnels through here so that swap is a one-file change.
 */
const REFRESH_KEY = "praxis.refresh";
const ENV_KEY = "praxis.env"; // 'live' | 'sandbox' (X-Praxis-Env)

let accessToken: string | null = null;

export const tokenStore = {
  getAccess: () => accessToken,
  setAccess: (t: string | null) => {
    accessToken = t;
  },
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  setRefresh: (t: string | null) => {
    if (t) localStorage.setItem(REFRESH_KEY, t);
    else localStorage.removeItem(REFRESH_KEY);
  },
  getEnv: () => localStorage.getItem(ENV_KEY) || "live",
  setEnv: (e: string) => localStorage.setItem(ENV_KEY, e),
  clear: () => {
    accessToken = null;
    localStorage.removeItem(REFRESH_KEY);
  },
};
