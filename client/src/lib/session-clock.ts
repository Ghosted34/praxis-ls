/**
 * When this session locks — shared by every tab of the workspace.
 *
 * The server ends a session SESSION_MAX_AGE_MIN (two hours) after sign-in and
 * says how long is left on every sign-in and refresh (`session_expires_in`, in
 * seconds — relative, because this machine's clock is not the server's). This
 * turns that into a local deadline and keeps it in localStorage, so a tab
 * opened at 11:50 on a session that began at 10:00 locks at 12:00 with the
 * others, not at 13:50.
 *
 * It is the CLIENT half of the rule, and it exists for one reason: the moment
 * the screen blurs should be the moment the session ends, not the next time
 * something happens to make a request. The server half — refusing to refresh
 * and capping every token's `exp` at the same instant — is what makes it a
 * rule rather than a courtesy.
 */
const KEY = "praxis.session.deadline";

function read(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    /* @silent:storage — no storage, no local deadline; the server still ends the session. */
    return null;
  }
}

export const sessionClock = {
  KEY,
  /** Record the deadline from the server's "seconds left". Ignores nonsense. */
  set(secondsLeft: unknown) {
    const s = Number(secondsLeft);
    if (!Number.isFinite(s) || s <= 0) return;
    try {
      localStorage.setItem(KEY, String(Date.now() + s * 1000));
    } catch {
      /* @silent:storage */
    }
  },
  /** Epoch ms on this machine's clock, or null when unknown. */
  deadline: read,
  /** Milliseconds left, or null when unknown. Never negative. */
  msLeft(): number | null {
    const d = read();
    return d === null ? null : Math.max(0, d - Date.now());
  },
  expired(): boolean {
    const d = read();
    return d !== null && Date.now() >= d;
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* @silent:storage */
    }
  },
};
