/**
 * Who this device belongs to. Turns the sign-in screen into a greeting
 * ("Welcome back, Ama") that leads with the fastest route the person has here —
 * the passkey on this device, then their Quick PIN, then the password.
 *
 * SURVIVES logout on purpose — it is a DEVICE fact ("whose machine this is"),
 * not session state. auth-context's logout removes session keys only and never
 * this one (lib/device-keys.ts is the list it keeps).
 *
 * ── NOTHING HERE FORGETS ANYONE ─────────────────────────────────────────────
 *
 * Owner decision, 29 Sep 2026: a device forgets nothing about its person
 * unless they remove the passkey themselves. So there is no "clear":
 *
 *   · signing out keeps it;
 *   · "Not you?" does not delete it — it opens a blank sign-in for SOMEONE ELSE
 *     (`someoneElse`, below) and offers "Continue as Ama" to go back. Only a
 *     different person actually signing in replaces the greeting, and their
 *     predecessor's passkey record on this device is untouched by that;
 *   · if the browser itself erases this (Safari does after seven days away),
 *     the server's memory of the device puts it back (lib/device-memory.ts).
 *
 * Single identity only (the last). Storing a list would be a recent-accounts
 * picker, which is a different design.
 */
const KEY = "praxis.last_session";
/** Per TAB, not per device: "someone else is signing in here right now". */
const SOMEONE_ELSE_KEY = "praxis.signin.someone_else";

export type LastSession = {
  email: string;
  display_name?: string | null;
  avatar_url?: string | null;
  /** The account has a Quick PIN — it works on any device, so offer it here. */
  has_quick_pin?: boolean;
};

function normalise(j: LastSession): LastSession {
  return {
    email: String(j.email).trim().toLowerCase(),
    display_name: j.display_name || null,
    avatar_url: j.avatar_url || null,
    has_quick_pin: !!j.has_quick_pin,
  };
}

function read(): LastSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as LastSession;
    if (!j || !j.email) return null;
    return normalise(j);
  } catch { /* @silent:storage */
    return null;
  }
}

function write(v: LastSession) {
  try {
    if (v && v.email) localStorage.setItem(KEY, JSON.stringify(normalise(v)));
  } catch { /* @silent:storage — quota or private mode; the server's memory of
       the device (device-memory.ts) restores the greeting next time. */
  }
}

export const lastSessionStore = {
  KEY,
  get: read,
  set: (v: LastSession) => write(v),
  /**
   * Upsert from a User-like shape returned by the auth endpoints. A field the
   * shape does not carry keeps its stored value for the SAME person — the
   * minimal sign-in block has no avatar, and must not erase the one /me gave.
   */
  fromUser: (u: {
    email?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
    has_quick_pin?: boolean | null;
  } | null) => {
    if (!u || !u.email) return;
    const email = String(u.email).trim().toLowerCase();
    const prev = read();
    const same = prev && prev.email === email ? prev : null;
    write({
      email,
      display_name: u.display_name ?? same?.display_name ?? null,
      avatar_url: u.avatar_url !== undefined ? u.avatar_url : same?.avatar_url ?? null,
      has_quick_pin: typeof u.has_quick_pin === "boolean" ? u.has_quick_pin : !!same?.has_quick_pin,
    });
  },
  /** The account's Quick PIN was set, changed, switched off or turned off. */
  setQuickPin: (email: string, on: boolean) => {
    const prev = read();
    if (prev && prev.email === email.trim().toLowerCase()) write({ ...prev, has_quick_pin: on });
  },

  /**
   * "Not you?" — a blank sign-in for someone else, in THIS tab, without the
   * device forgetting its person. Cleared when anyone signs in, or when the
   * person comes back ("Continue as …").
   */
  someoneElse: {
    active: (): boolean => {
      try {
        return sessionStorage.getItem(SOMEONE_ELSE_KEY) === "1";
      } catch { /* @silent:storage */
        return false;
      }
    },
    start: () => {
      try {
        sessionStorage.setItem(SOMEONE_ELSE_KEY, "1");
      } catch { /* @silent:storage — the greeting shows; "Not you?" again. */
      }
    },
    end: () => {
      try {
        sessionStorage.removeItem(SOMEONE_ELSE_KEY);
      } catch { /* @silent:storage */
      }
    },
  },
};
