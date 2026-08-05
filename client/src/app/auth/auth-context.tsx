/**
 * Auth context — holds the current user + access/refresh lifecycle.
 *
 * We stash the user object returned by login alongside the refresh token and
 * restore it on reload after confirming the refresh token still works (instant,
 * no flicker). We then re-fetch GET /auth/me to pick up the latest tenant
 * feature state (ai_enabled/channels) — so a platform-console feature toggle
 * reflects on the next reload without forcing a full re-login. Access tokens
 * stay in memory (token-store); refresh survives reload.
 *
 * 2FA: login may return { pending_2fa } instead of tokens — the UI then collects
 * a code and calls verify2fa().
 */
import * as React from "react";
import { tenant, ApiError, tryRefresh, SESSION_ENDED_EVENT } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";
import { pinStore } from "@/lib/pin-store";

export type User = {
  user_id: string;
  email: string;
  display_name?: string;
  /** Self-service profile picture (a /media URL), or absent → initials fallback. */
  avatar_url?: string | null;
  /** The employee record this login is linked to (drives the My HR self views). */
  employee_id?: string | null;
  /** Primary role display name, for the account menu. */
  role?: string | null;
  /** Per-tenant AI switch, resolved from the ai.assistant.backend feature flag
   *  and returned by the auth endpoints. Absent ⇒ AI off (opt-in). Drives the
   *  global AI gate — see components/ai-actions.tsx. */
  ai_enabled?: boolean;
  /** Comms channels switched on for the tenant. Absent ⇒ off. */
  channels?: { comms?: boolean };
};

type LoginResult = { pending2fa: boolean };

type AuthState = {
  user: User | null;
  status: "loading" | "authed" | "anon";
  pendingToken: string | null;
  login: (email: string, password: string, keepSignedIn?: boolean) => Promise<LoginResult>;
  verify2fa: (code: string) => Promise<void>;
  pinLogin: (email: string, pin: string) => Promise<void>;
  registerPin: (pin: string, label?: string | null) => Promise<{ device_id: string }>;
  logout: () => Promise<void>;
  /** Merge fields into the cached user (e.g. after an avatar upload). */
  patchUser: (partial: Partial<User>) => void;
};

const USER_KEY = "praxis.user";
const AuthCtx = React.createContext<AuthState | null>(null);

function persistUser(u: User | null) {
  if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
  else localStorage.removeItem(USER_KEY);
}
function readUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

type LoginResponse =
  | { pending_2fa: true; pending_token: string }
  | { access_token: string; refresh_token: string; user: User };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [status, setStatus] = React.useState<AuthState["status"]>("loading");
  const [pendingToken, setPendingToken] = React.useState<string | null>(null);

  // Boot: if we have a refresh token, exchange it for an access token and
  // restore the cached user. Otherwise we're anonymous.
  React.useEffect(() => {
    if (!tokenStore.getRefresh()) {
      setStatus("anon");
      return;
    }
    // Go through the SHARED, de-duped refresh (api-client) rather than a separate
    // fetch. The BE rotates the refresh token every time and revokes the session
    // if a rotated-away token is replayed; a standalone boot refresh racing the
    // first screen requests' 401-retries would present the same token twice and
    // trip that reuse-detection, logging the user out well before the 30-min
    // idle window. Sharing the de-dupe collapses them into one rotation.
    tryRefresh()
      .then(async (ok) => {
        if (ok) {
          setUser(readUser()); // instant restore from cache (no flicker)
          setStatus("authed");
          // Re-resolve the tenant feature block so a platform-console toggle
          // (ai_enabled / channels) is reflected without a full re-login.
          try {
            const fresh = await tenant<User>("/auth/me");
            persistUser(fresh);
            setUser(fresh);
          } catch {
            /* keep the cached user block */
          }
        } else {
          tokenStore.clear();
          persistUser(null);
          setStatus("anon");
        }
      })
      .catch(() => {
        tokenStore.clear();
        persistUser(null);
        setStatus("anon");
      });
  }, []);

  function acceptTokens(r: { access_token: string; refresh_token: string; user: User }) {
    tokenStore.setAccess(r.access_token);
    tokenStore.setRefresh(r.refresh_token);
    persistUser(r.user);
    setUser(r.user);
    setPendingToken(null);
    setStatus("authed");
    // The login / 2FA / PIN payloads carry a MINIMAL user block (no avatar_url or
    // employee_id). Hydrate the full profile from /me — with tokens now set, this
    // is authenticated — so the avatar shows immediately instead of only after a
    // hard refresh. Best-effort: if it fails, boot restore will hydrate later.
    tenant<User>("/auth/me")
      .then((fresh) => {
        persistUser(fresh);
        setUser(fresh);
      })
      .catch(() => {
        /* keep the minimal user */
      });
  }

  /**
   * The session died mid-use and could not be refreshed.
   *
   * Without this the app kept believing it was authenticated while holding a
   * dead token: every action failed with the same 401 and the user sat on a
   * "token expired" banner until they signed out by hand — which is exactly what
   * was reported. The boot path has always handled this; mid-session never did.
   */
  React.useEffect(() => {
    const onEnded = () => {
      persistUser(null);
      setUser(null);
      setPendingToken(null);
      setStatus("anon");
    };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, []);

  const login: AuthState["login"] = React.useCallback(async (email, password, keepSignedIn = true) => {
    // Record the persistence choice before any tokens land. It also carries the
    // 2FA path: acceptTokens() runs later in verify2fa() and reads this flag.
    tokenStore.setPersist(keepSignedIn);
    // The server needs the choice too: it exempts the session from the 30-minute
// idle kill (0494). Storing the token for 30 days while the server killed the
// session after half an hour is what users reported as "token expired".
    const r = await tenant<LoginResponse>("/auth/login", { method: "POST", auth: false, body: { email, password, keep_signed_in: keepSignedIn } });
    if ("pending_2fa" in r) {
      setPendingToken(r.pending_token);
      return { pending2fa: true };
    }
    acceptTokens(r);
    return { pending2fa: false };
  }, []);

  const verify2fa: AuthState["verify2fa"] = React.useCallback(async (code) => {
    if (!pendingToken) throw new Error("No 2FA challenge in progress");
    const r = await tenant<{ access_token: string; refresh_token: string; user: User }>("/auth/2fa/verify", {
      method: "POST",
      auth: false,
      // Carried through 2FA as well, or ticking the box then completing TOTP
      // would lose the choice (0494).
      body: { pending_token: pendingToken, code, keep_signed_in: tokenStore.getPersist() },
    });
    acceptTokens(r);
  }, []);

  const pinLogin: AuthState["pinLogin"] = React.useCallback(async (email, pin) => {
    const dev = pinStore.get(email);
    if (!dev) throw new ApiError("NO_PIN_DEVICE", "No Quick PIN is set up on this device for that email.", 400);
    tokenStore.setPersist(true);
    const r = await tenant<{ access_token: string; refresh_token: string; user: User }>("/auth/pin/login", {
      method: "POST",
      auth: false,
      body: { email: email.trim(), device_id: dev.device_id, pin, keep_signed_in: true },
    });
    acceptTokens(r);
  }, []);

  const registerPin: AuthState["registerPin"] = React.useCallback(async (pin, label = null) => {
    const r = await tenant<{ device_id: string; label?: string | null }>("/auth/pin/register", {
      method: "POST",
      body: { pin, label },
    });
    if (user) pinStore.set(user.email, { device_id: r.device_id, label: r.label ?? label });
    return { device_id: r.device_id };
  }, []);

  const logout: AuthState["logout"] = React.useCallback(async () => {
    try {
      await tenant("/auth/logout", { method: "POST" });
    } catch {
      /* best-effort */
    }
    tokenStore.clear();
    persistUser(null);
    // Clear all persisted client state on logout (until told otherwise): tokens,
    // cached user, theme + env preferences — nothing survives a sign-out.
    try {
      const pinSnap = pinStore.snapshot(); // trusted PIN devices survive sign-out
      localStorage.clear();
      pinStore.restore(pinSnap);
    } catch {
      /* ignore storage errors */
    }
    setUser(null);
    setStatus("anon");
  }, []);

  const patchUser = React.useCallback((partial: Partial<User>) =>
    setUser((u) => {
      if (!u) return u;
      const next = { ...u, ...partial };
      persistUser(next);
      return next;
    }), []);

  /**
   * PERF S14. This was an inline object literal containing six handlers that
   * were re-created on every render, so EVERY render of AuthProvider produced a
   * new context identity and re-rendered every consumer in the tree — and with
   * zero React.memo across 134 components there was nothing to arrest the
   * cascade. AuthProvider wraps the whole app, so that is every render of
   * everything.
   *
   * The handlers are now stable (useCallback with empty deps — they close only
   * over stable setters and module-level helpers, and patchUser uses the
   * functional setUser form), so the value identity changes only when the auth
   * state genuinely does.
   */
  const value = React.useMemo(
    () => ({ user, status, pendingToken, login, verify2fa, pinLogin, registerPin, logout, patchUser }),
    [user, status, pendingToken, login, verify2fa, pinLogin, registerPin, logout, patchUser],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
