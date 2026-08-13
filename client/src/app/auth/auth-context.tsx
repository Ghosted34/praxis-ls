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
import { onReconnect, probeNow, reportUnreachable } from "@/lib/connection";

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

  // Read the live status without re-subscribing the reconnect handler below.
  const statusRef = React.useRef(status);
  statusRef.current = status;

  /**
   * Restore the session from the stored refresh token. Shared by boot and by the
   * reconnect handler, because the offline case needs to be RE-tried, not merely
   * survived.
   *
   * THE OFFLINE DISTINCTION IS THE WHOLE POINT. `tryRefresh()` collapses every
   * failure — a rejected token AND a dead network — to `false`, and the old boot
   * cleared the tokens either way. So a cold reload in a tunnel silently signed
   * the user out: they lost the crafted offline page (they were "anonymous", so
   * the login showed), and even when the wifi came back they landed on that
   * login instead of the screen they were on. Only a REACHABLE server that
   * rejected the token should end a session. When we cannot reach the server at
   * all, we keep the token, restore the cached user, and let reconnect verify it.
   */
  const restore = React.useCallback(() => {
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
    void tryRefresh().then(async (ok) => {
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
          /* @silent:storage */
        }
        return;
      }
      // Refresh failed. Was it a dead session, or a dead network? Ask the health
      // probe (unauthenticated, touches no dependency — lib/connection.ts).
      const reachable = await probeNow();
      if (reachable) {
        // The server is up and said no. Genuinely signed out.
        tokenStore.clear();
        persistUser(null);
        setStatus("anon");
      } else {
        // Offline. KEEP the token so reconnect can verify it, and flip the
        // connection state so the branded offline gate + pill show. `anon`
        // gates the user out of protected DATA until we can confirm the session,
        // but the OfflineBootGate (app.tsx) shows the offline page over the login
        // for as long as we are unreachable, so they never see a login they
        // cannot use — and are returned to their screen the moment we recover.
        reportUnreachable();
        setUser(readUser());
        setStatus("anon");
      }
    });
  }, []);

  // Boot restore, once.
  React.useEffect(() => {
    restore();
  }, [restore]);

  // Re-verify on reconnect. If we still hold a refresh token but are not authed
  // — the offline-hold above, or a drop that happened while signed out — the
  // moment the server answers again is the moment to exchange the token and get
  // the user back into the app without a manual refresh.
  React.useEffect(
    () =>
      onReconnect(() => {
        if (statusRef.current !== "authed" && tokenStore.getRefresh()) restore();
      }),
    [restore],
  );

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
        /* @silent:storage */
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
    // `pendingToken`, NOT []. This closes over render state: an empty array
    // captures the value from the first render — `null`, always — so the guard
    // above would throw on every legitimate challenge, and if it did not, the
    // request would carry `pending_token: null`. 2FA would simply never
    // complete. PERF S14's empty arrays are right for the handlers that touch
    // only setters and module helpers; this is not one of them.
  }, [pendingToken]);

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
    // `user`, NOT [] — same reason as verify2fa. On the first render `user` is
    // null, so an empty array makes the `if (user)` branch permanently false:
    // the server registers the PIN device and the browser never records it, so
    // the next PIN login fails with NO_PIN_DEVICE against a device that exists.
    // Silent, and only on the happy path.
  }, [user]);

  const logout: AuthState["logout"] = React.useCallback(async () => {
    try {
      await tenant("/auth/logout", { method: "POST" });
    } catch {
      /* @silent:teardown */
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
      /* @silent:storage */
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
   * Four of the six are stable (`useCallback` with empty deps — they close only
   * over stable setters and module-level helpers, and `patchUser` uses the
   * functional `setUser` form), so the value identity changes only when the auth
   * state genuinely does.
   *
   * TWO ARE NOT, deliberately. `verify2fa` reads `pendingToken` and
   * `registerPin` reads `user`, so both carry that dependency. A first pass at
   * S14 gave all six `[]`, which is where this note used to claim all six were
   * stable — and it was a stale-closure bug in the auth path, not a lint
   * complaint: both would have captured `null` from the first render forever.
   * eslint's `exhaustive-deps` caught it. The cost is that those two change
   * identity when the value they read changes, which is once per sign-in — not
   * the every-render cascade S14 was about.
   *
   * `acceptTokens` is re-created each render and is intentionally NOT a
   * dependency of the three handlers that call it. It closes over nothing from
   * render scope — only setters, `tokenStore`, `persistUser` and `tenant` — so
   * a stale reference behaves identically to a fresh one. Listing it would make
   * `login`, `verify2fa` and `pinLogin` unstable on every render and undo S14
   * for no behavioural gain.
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
