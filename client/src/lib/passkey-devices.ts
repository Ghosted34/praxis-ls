/**
 * Device-bound passkey registry: which accounts hold a passkey on THIS device,
 * and WHICH passkeys those are.
 *
 * ── WHY IT HAS TO EXIST ─────────────────────────────────────────────────────
 *
 * `pinStore` answers "does this device have a Quick PIN for that account".
 * This answers the same for passkeys, so the sign-in and lock screens can lead
 * with the passkey on a device that has one — the owner's order is passkey,
 * then PIN, then password — instead of guessing.
 *
 * Asking the server is not the answer: the server knows every passkey the
 * ACCOUNT holds, but not which of them lives in THIS browser's authenticator.
 * A passkey registered on the laptop is on the server's list and useless on
 * the phone.
 *
 * ── WHY IT KEEPS THE CREDENTIAL IDS ─────────────────────────────────────────
 *
 * "On my laptop I use my laptop's passkey, on my phone my phone's." The ids
 * are what make that literal: sign-in sends them, the server scopes the
 * ceremony to exactly those credentials on this device's own authenticator,
 * and the OS goes straight to Touch ID / Face ID / Windows Hello — no list of
 * every passkey on the account, no "use a phone" QR code.
 *
 * Entries written before ids were kept are the bare `true`; they still mean
 * "this device has one", sign in with an unscoped (but account-bound)
 * ceremony, and gain their id on the first successful passkey sign-in.
 *
 * ── WHAT WRITES AND DELETES IT ──────────────────────────────────────────────
 *
 *   written  a passkey is REGISTERED from this device, or a passkey SIGN-IN
 *            succeeds here (proof the credential is here — a synced iCloud /
 *            Google passkey counts, and should).
 *   deleted  the server says a credential is no longer on the account
 *            (PASSKEY_REVOKED), this device's passkey is removed in My
 *            security, or the account is released ("Sign out and remove this
 *            account"). Never a dismissed Face ID sheet — that is an answer,
 *            not a fact about the credential.
 *
 * SURVIVES LOGOUT ON PURPOSE, like pinStore and deviceId — it is a DEVICE fact.
 * auth-context preserves it across the logout localStorage.clear() via
 * snapshot()/restore().
 */
const KEY = "praxis.passkey.devices";

type Entry = true | { ids: string[] };
type Registry = Record<string, Entry>;

function read(): Registry {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || "{}");
    return r && typeof r === "object" ? (r as Registry) : {};
  } catch {
    /* @silent:storage — private mode or a malformed entry. The failure
       direction is a sign-in screen that offers a PIN or password instead of
       a passkey, which still works. */
    return {};
  }
}

function write(r: Registry) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* @silent:storage — quota or private mode. The device forgets to offer
       the passkey next time; the passkey itself is unaffected. */
  }
}

function key(email: string): string {
  return email.trim().toLowerCase();
}

function idsOf(e: Entry | undefined): string[] {
  return e && e !== true && Array.isArray(e.ids) ? e.ids.filter((x) => typeof x === "string" && x) : [];
}

export const passkeyDeviceStore = {
  /** Does THIS device hold a passkey for that account? */
  get: (email: string): boolean => {
    if (!email) return false;
    return !!read()[key(email)];
  },
  /** The ids of the passkeys this device holds for that account (may be empty
   *  for an entry recorded before ids were kept). */
  ids: (email: string): string[] => (email ? idsOf(read()[key(email)]) : []),
  /** Record that this device holds a passkey for the account — with its id when known. */
  add: (email: string, credentialId?: string | null) => {
    if (!email) return;
    const r = read();
    const ids = idsOf(r[key(email)]);
    if (credentialId && !ids.includes(credentialId)) ids.push(credentialId);
    r[key(email)] = { ids: ids.slice(-10) };
    write(r);
  },
  /** @deprecated use `add` — kept for callers that do not know the id. */
  set: (email: string) => passkeyDeviceStore.add(email),
  /**
   * Forget ONE credential (the server said it is gone). Returns whether this
   * device still holds another for the account. An entry that never had ids
   * (the bare legacy `true`) is dropped: the one passkey it stood for is the
   * one the server just refused.
   */
  forgetId: (email: string, credentialId: string): boolean => {
    if (!email) return false;
    const r = read();
    const e = r[key(email)];
    if (!e) return false;
    const rest = idsOf(e).filter((x) => x !== credentialId);
    if (rest.length === 0) delete r[key(email)];
    else r[key(email)] = { ids: rest };
    write(r);
    return rest.length > 0;
  },
  /** Does this device hold THAT credential? (My security's "this device" badge.) */
  holds: (email: string, credentialId: string): boolean =>
    !!email && idsOf(read()[key(email)]).includes(credentialId),
  remove: (email: string) => {
    const r = read();
    delete r[key(email)];
    write(r);
  },
  clear: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* @silent:storage */
    }
  },
  snapshot: (): string => {
    try {
      return localStorage.getItem(KEY) || "{}";
    } catch {
      /* @silent:storage */
      return "{}";
    }
  },
  restore: (s: string) => {
    try {
      localStorage.setItem(KEY, s);
    } catch {
      /* @silent:storage */
    }
  },
};
