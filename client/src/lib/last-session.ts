/**
 * Last-session remember. Persists the most recent successful sign-in identity
 * so the login modal can prefill and share the email across Password + Quick PIN,
 * and render Quick PIN as a read-only unlock (avatar + chip + "Not you?").
 *
 * SURVIVES logout on purpose — like pinStore/deviceId, it is a DEVICE fact
 * ("who used this device last"), not session state. auth-context preserves it
 * across the logout localStorage.clear() via snapshot/restore.
 *
 * Single identity only (the last). Storing a list would be a recent-accounts
 * picker, which is a different design.
 */
const KEY = "praxis.last_session";

export type LastSession = {
  email: string;
  display_name?: string | null;
  avatar_url?: string | null;
};

function read(): LastSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as LastSession;
    if (!j || !j.email) return null;
    return {
      email: String(j.email).trim().toLowerCase(),
      display_name: j.display_name || null,
      avatar_url: j.avatar_url || null,
    };
  } catch { /* @silent:storage */
    return null;
  }
}

function write(v: LastSession | null) {
  try {
    if (!v || !v.email) localStorage.removeItem(KEY);
    else
      localStorage.setItem(
        KEY,
        JSON.stringify({
          email: String(v.email).trim().toLowerCase(),
          display_name: v.display_name || null,
          avatar_url: v.avatar_url || null,
        }),
      );
  } catch { /* @silent:storage */
  }
}

export const lastSessionStore = {
  KEY,
  get: read,
  set: (v: LastSession) => write(v),
  clear: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* @silent:storage */
    }
  },
  snapshot: (): string | null => {
    try {
      return localStorage.getItem(KEY);
    } catch { /* @silent:storage */
      return null;
    }
  },
  restore: (s: string | null) => {
    try {
      if (s) localStorage.setItem(KEY, s);
    } catch {
      /* @silent:storage */
    }
  },
  /** Upsert from a User-like shape returned by login endpoints. */
  fromUser: (u: {
    email?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
  } | null) => {
    if (!u || !u.email) return;
    write({
      email: String(u.email).trim().toLowerCase(),
      display_name: u.display_name || null,
      avatar_url: u.avatar_url || null,
    });
  },
};
