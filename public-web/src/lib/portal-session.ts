/**
 * The portal session, on this device.
 *
 * Three things live here, in three different places, on purpose:
 *
 *   ACCESS TOKEN   memory, mirrored to sessionStorage so a reload of the same
 *                  tab stays signed in. Two hours, and never in localStorage: a
 *                  token an injected script can read from every tab for a month
 *                  is the thing "keep me signed in" must NOT become.
 *
 *   REFRESH TOKEN  localStorage — only when the person ticked "keep me signed
 *                  in". It is what makes the installed portal open signed in,
 *                  like any app on their phone. It rotates on every use (the
 *                  server answers each refresh with a new one), and the server
 *                  ends the whole session if an old one is ever replayed.
 *
 *   WHO THEY ARE   localStorage, also only when trusted: first name, company,
 *                  email and which passkeys this device holds. It is what lets
 *                  the sign-in screen say "Welcome back, Marie" and offer Face ID
 *                  first. Never a credential — just enough to greet someone.
 *
 * On a shared office PC (no tick) nothing outlives the tab.
 */

const ACCESS_KEY = "praxis.portal.token";
const REFRESH_KEY = "praxis.portal.refresh";
const KNOWN_KEY = "praxis.portal.known";

export type KnownPerson = {
  email: string;
  firstName: string | null;
  company: string | null;
  /** Passkeys THIS device registered for the account (credential ids). */
  passkeys: string[];
};

let accessInMemory: string | null = null;

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    // @silent:storage — private mode or a blocked store; the session simply
    // does not persist, which is the safe direction to fail.
    return fallback;
  }
};

export const portalSession = {
  access(): string | null {
    if (accessInMemory) return accessInMemory;
    accessInMemory = safe(() => sessionStorage.getItem(ACCESS_KEY), null);
    return accessInMemory;
  },
  refreshToken(): string | null {
    return safe(() => localStorage.getItem(REFRESH_KEY), null);
  },
  /** True when this device was trusted at sign-in. */
  trusted(): boolean {
    return !!this.refreshToken();
  },
  store(tokens: { access_token: string; refresh_token?: string | null }): void {
    accessInMemory = tokens.access_token;
    safe(() => sessionStorage.setItem(ACCESS_KEY, tokens.access_token), undefined);
    // `null` from the server means "the other tab already rotated it" — keep
    // whatever is stored; a missing key means an untrusted sign-in.
    if (tokens.refresh_token) safe(() => localStorage.setItem(REFRESH_KEY, tokens.refresh_token as string), undefined);
  },
  /** Ends the session on this device, keeping the greeting unless asked. */
  clear({ forget = false }: { forget?: boolean } = {}): void {
    accessInMemory = null;
    safe(() => sessionStorage.removeItem(ACCESS_KEY), undefined);
    safe(() => localStorage.removeItem(REFRESH_KEY), undefined);
    if (forget) safe(() => localStorage.removeItem(KNOWN_KEY), undefined);
  },
  dropAccess(): void {
    accessInMemory = null;
    safe(() => sessionStorage.removeItem(ACCESS_KEY), undefined);
  },
  known(): KnownPerson | null {
    return safe(() => {
      const raw = localStorage.getItem(KNOWN_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as KnownPerson;
      return v && typeof v.email === "string" ? { ...v, passkeys: Array.isArray(v.passkeys) ? v.passkeys : [] } : null;
    }, null);
  },
  remember(person: Partial<KnownPerson> & { email: string }): void {
    const prev = this.known();
    const same = prev && prev.email.toLowerCase() === person.email.toLowerCase();
    const next: KnownPerson = {
      email: person.email,
      firstName: person.firstName ?? (same ? prev.firstName : null),
      company: person.company ?? (same ? prev.company : null),
      passkeys: person.passkeys ?? (same ? prev.passkeys : []),
    };
    safe(() => localStorage.setItem(KNOWN_KEY, JSON.stringify(next)), undefined);
  },
  addPasskey(credentialId: string): void {
    const k = this.known();
    if (!k || k.passkeys.includes(credentialId)) return;
    this.remember({ ...k, passkeys: [...k.passkeys, credentialId] });
  },
  dropPasskey(credentialId: string): void {
    const k = this.known();
    if (!k) return;
    this.remember({ ...k, passkeys: k.passkeys.filter((p) => p !== credentialId) });
  },
};

/** Fired when the session ends underneath the app (expired, revoked). */
export const PORTAL_SIGNED_OUT = "praxis:portal-signed-out";

/**
 * Refresh the access token with the stored refresh token.
 *
 * One refresh at a time ACROSS TABS: a Web Lock serialises them, and the token
 * is read INSIDE the lock, so the second tab uses the token the first one just
 * received rather than the one it rotated away. (The server tolerates a race
 * for thirty seconds anyway; this keeps it from being needed.)
 */
let inFlight: Promise<boolean> | null = null;

export function refreshPortalSession(): Promise<boolean> {
  if (inFlight) return inFlight;
  const run = async (): Promise<boolean> => {
    const token = portalSession.refreshToken();
    if (!token) return false;
    const res = await fetch("/api/tenant/portal/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: token }),
    }).catch(() => null);
    if (!res) return false; // offline: not a sign-out
    if (!res.ok) {
      if (res.status === 401) {
        portalSession.clear();
        window.dispatchEvent(new CustomEvent(PORTAL_SIGNED_OUT));
      }
      return false;
    }
    const json = (await res.json().catch(() => null)) as { data?: { access_token: string; refresh_token?: string | null } } | null;
    if (!json || !json.data || !json.data.access_token) return false;
    portalSession.store(json.data);
    return true;
  };
  // Typed narrowly on purpose: the DOM's own LockManager signature is generic
  // over the callback's return, which reads a Promise<boolean> callback as
  // Promise<Promise<boolean>>.
  const locks = (navigator as unknown as { locks?: { request: (name: string, cb: () => Promise<boolean>) => Promise<boolean> } }).locks;
  const pending: Promise<boolean> = locks ? locks.request("praxis-portal-refresh", run) : run();
  inFlight = pending.finally(() => {
    inFlight = null;
  });
  return inFlight;
}
