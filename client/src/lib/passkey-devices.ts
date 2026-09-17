/**
 * Device-bound passkey registry. Maps email → true for accounts that hold a
 * passkey usable on THIS device.
 *
 * WHY IT HAS TO EXIST. `pinStore` already answers "does this device have a
 * Quick PIN for that account", which is the whole reason the sign-in screen can
 * open on the PIN tab instead of guessing. Passkeys had no equivalent, so the
 * identity-first sign-in had nothing to branch on: a device with a passkey and a
 * device with none looked identical, and the only way to find out was to offer
 * the ceremony and let it fail.
 *
 * ASKING THE SERVER IS NOT THE ANSWER. `POST /auth/passkey/login/options` will
 * happily say whether an account has credentials, but it is rate-limited, it
 * costs a round trip on every modal open, and it is wrong in the direction that
 * matters: a credential registered on a different laptop is listed by the
 * server and NOT present in this browser's authenticator, so the answer would
 * put a Face ID button in front of someone whose Face ID cannot answer it. The
 * browser is the only party that knows whether this device can do this.
 *
 * WHAT WRITES IT — the two moments the fact becomes true and is observable:
 *   · a passkey is REGISTERED from this device (My security, or the sign-in
 *     offer straight after signing in), and
 *   · a passkey SIGN-IN SUCCEEDS on this device, which is proof the credential
 *     is here (a passkey that lives only in iCloud Keychain and syncs to this
 *     machine counts, and should).
 *
 * WHAT DELETES IT — the passkey is gone or the account is released: the last
 * credential is removed in My security, or the device hands over via "Sign out
 * and remove this account". Not a failed sign-in: a dismissed Touch ID sheet is
 * not a fact about the credential.
 *
 * SURVIVES LOGOUT ON PURPOSE, like pinStore and deviceId — it is a DEVICE fact
 * ("this machine can unlock Tom-blake's account"), not session state.
 * auth-context preserves it across the logout localStorage.clear() via
 * snapshot()/restore(). Wiping it on sign-out would leave the sign-in screen
 * unable to tell a passkey device from a password-only one, which is the exact
 * guess this store was added to remove.
 */
const KEY = "praxis.passkey.devices";

type Registry = Record<string, true>;

function read(): Registry {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Registry;
  } catch {
    /* @silent:storage — private mode or a malformed entry. The failure
       direction is a sign-in screen that offers a password instead of a
       passkey, which still works. */
    return {};
  }
}

function key(email: string): string {
  return email.trim().toLowerCase();
}

export const passkeyDeviceStore = {
  /** Does THIS device hold a passkey for that account? */
  get: (email: string): boolean => {
    if (!email) return false;
    return !!read()[key(email)];
  },
  set: (email: string) => {
    if (!email) return;
    const r = read();
    r[key(email)] = true;
    try {
      localStorage.setItem(KEY, JSON.stringify(r));
    } catch {
      /* @silent:storage — quota or private mode. The device forgets to offer
         the passkey next time; the passkey itself is unaffected. */
    }
  },
  remove: (email: string) => {
    const r = read();
    delete r[key(email)];
    try {
      localStorage.setItem(KEY, JSON.stringify(r));
    } catch {
      /* @silent:storage */
    }
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
