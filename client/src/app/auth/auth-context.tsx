/**
 * Auth context — the current user, the access/refresh lifecycle, and the LOCK.
 *
 * We stash the user object returned by sign-in alongside the refresh token and
 * restore it on reload after confirming the refresh token still works (instant,
 * no flicker), then re-fetch GET /auth/me for the latest tenant feature state.
 * Access tokens stay in memory (token-store); the refresh token survives reload.
 *
 * ── STATUS ─────────────────────────────────────────────────────────────────
 *
 *   loading  boot, until the stored session has been checked
 *   authed   signed in; the app is usable
 *   locked   the session ENDED while someone was using the app. The app stays
 *            mounted — every half-typed form, every open record, exactly where
 *            it was — but it is blurred, inert and unreachable behind the lock
 *            screen, the tokens are gone, and every authenticated call is
 *            refused locally. Proving who you are (passkey → PIN → password)
 *            unlocks it in place.
 *   anon     nobody is signed in
 *
 * ── WHEN IT LOCKS ──────────────────────────────────────────────────────────
 *
 *   · the session reaches its two-hour ceiling (server: SESSION_MAX_AGE_MIN).
 *     A local timer fires at that exact moment — the screen must blur when the
 *     session ends, not the next time something happens to make a request —
 *     and the server refuses every token from that second anyway;
 *   · the server ends it: inactivity, killed from another device, reuse
 *     detection (SESSION_ENDED_EVENT from api-client);
 *   · another tab locked (they share one session, so they lock together — and
 *     unlocking one unlocks the others);
 *   · the user locks it themselves ("Lock screen" in the account menu), which
 *     also ends the session server-side.
 *
 * ── WHO MAY UNLOCK ─────────────────────────────────────────────────────────
 *
 * Only the person whose screen it is. The lock screen names them and does not
 * ask for an email; a passkey ceremony is bound to their account server-side.
 * If a DIFFERENT account ever ends up holding the tokens (another tab signed
 * in as someone else), the page is reloaded rather than unlocked: the previous
 * person's data is still in memory behind the blur, and it is not the new
 * person's to see.
 *
 * 2FA: password sign-in may return { pending_2fa } instead of tokens — the UI
 * then collects a code and calls verify2fa().
 */
import * as React from "react";
import {
  tenant,
  ApiError,
  tryRefresh,
  resetSessionEnded,
  SESSION_ENDED_EVENT,
  type SessionEndReason,
} from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";
import { sessionClock } from "@/lib/session-clock";
import { pinStore } from "@/lib/pin-store";
import { passkeyDeviceStore } from "@/lib/passkey-devices";
import { deviceIdStore } from "@/lib/device-id";
import { lastSessionStore } from "@/lib/last-session";
import { passkeyAssertion } from "@/lib/webauthn";
import { queryClient } from "@/lib/query-client";
import { onReconnect, probeNow, reportUnreachable } from "@/lib/connection";
import { bindLanguageOwner } from "@/lib/i18n";

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

export type LockReason = SessionEndReason | "manual";

type LoginResult = { pending2fa: boolean };

type AuthState = {
  user: User | null;
  status: "loading" | "authed" | "anon" | "locked";
  /** Why the screen is locked, for the lock screen's one line of explanation. */
  lockReason: LockReason | null;
  /** Bumped when ANOTHER tab unlocked this session, so this tab's lock screen
   *  closes too (its own panel did not do the unlocking). */
  unlockedElsewhere: number;
  pendingToken: string | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  verify2fa: (code: string) => Promise<void>;
  pinLogin: (email: string, pin: string) => Promise<void>;
  registerPin: (
    pin: string,
    label?: string | null,
    currentPassword?: string | null,
  ) => Promise<{ device_id: string }>;
  passkeyLogin: (email?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Lock the screen now and end the session server-side ("I'm stepping away"). */
  lockNow: () => Promise<void>;
  /** From the lock screen: "Not you?" — drop everything and start a clean sign-in. */
  abandonLock: () => void;
  /** Merge fields into the cached user (e.g. after an avatar upload). */
  patchUser: (partial: Partial<User>) => void;
};

const USER_KEY = "praxis.user";
/** Why the session locked, so every tab can say the same thing. */
const LOCK_KEY = "praxis.session.locked";
/**
 * Device facts that survive "Sign out" — every one of them is about THIS
 * machine, not the session. (`device-account.ts` is the one place that removes
 * them, when the account is taken off the device.)
 */
const DEVICE_KEYS = [
  "praxis.passkey.offer.declined",
  "praxis.passkey.nudge.dismissed",
];

const AuthCtx = React.createContext<AuthState | null>(null);

function persistUser(u: User | null) {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* @silent:storage */
  }
}
function readUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}
function readLockReason(): LockReason {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    const r = raw ? (JSON.parse(raw) as { reason?: LockReason }).reason : null;
    return r || "unknown";
  } catch {
    return "unknown";
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  session_expires_in?: number;
  user: User;
};
type LoginResponse = { pending_2fa: true; pending_token: string } | TokenResponse;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [status, setStatus] = React.useState<AuthState["status"]>("loading");
  const [lockReason, setLockReason] = React.useState<LockReason | null>(null);
  const [unlockedElsewhere, setUnlockedElsewhere] = React.useState(0);
  const [pendingToken, setPendingToken] = React.useState<string | null>(null);

  React.useEffect(() => {
    bindLanguageOwner(status === "authed" || status === "locked" ? user?.user_id : null);
  }, [status, user?.user_id]);

  // Read the live values without re-subscribing the listeners below.
  const statusRef = React.useRef(status);
  statusRef.current = status;
  const userRef = React.useRef(user);
  userRef.current = user;

  /**
   * Restore the session from the stored refresh token. Shared by boot and by the
   * reconnect handler, because the offline case needs to be RE-tried, not merely
   * survived.
   *
   * THE OFFLINE DISTINCTION IS THE WHOLE POINT. `tryRefresh()` collapses every
   * failure — a rejected token AND a dead network — to `false`. Only a REACHABLE
   * server that rejected the token should end a session; when we cannot reach
   * the server at all we keep the token, restore the cached user, and let
   * reconnect verify it.
   */
  const restore = React.useCallback(() => {
    if (!tokenStore.getRefresh()) {
      setStatus("anon");
      return;
    }
    // Through the SHARED, de-duped, cross-tab-locked refresh (api-client): the
    // BE rotates the refresh token every time and revokes the session if a
    // rotated-away token is replayed.
    void tryRefresh().then(async (ok) => {
      if (ok) {
        tokenStore.setLocked(false);
        setUser(readUser()); // instant restore from cache (no flicker)
        setStatus("authed");
        try {
          const fresh = await tenant<User>("/auth/me");
          persistUser(fresh);
          setUser(fresh);
        } catch {
          /* @silent:storage */
        }
        return;
      }
      const reachable = await probeNow();
      if (reachable) {
        tokenStore.clear();
        sessionClock.clear();
        persistUser(null);
        setStatus("anon");
      } else {
        // Offline. KEEP the token so reconnect can verify it; the OfflineBootGate
        // (app.tsx) shows the offline page over the login meanwhile.
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

  React.useEffect(
    () =>
      onReconnect(() => {
        if (statusRef.current === "anon" && tokenStore.getRefresh()) restore();
      }),
    [restore],
  );

  /**
   * Lock the screen. Only an AUTHED session locks — there is nothing to protect
   * on the sign-in page — and locking twice is a no-op.
   *
   * The tokens go first and the reason is written before them, so a tab that
   * hears about it through the `storage` event can say why.
   */
  const lock = React.useCallback((reason: LockReason) => {
    if (statusRef.current !== "authed") return;
    try {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ reason, at: Date.now() }));
    } catch {
      /* @silent:storage */
    }
    tokenStore.setLocked(true);
    tokenStore.clear();
    sessionClock.clear();
    setPendingToken(null);
    setLockReason(reason);
    statusRef.current = "locked";
    setStatus("locked");
  }, []);

  /** Back to "authed" after the right person proved who they are. */
  const finishUnlock = React.useCallback(() => {
    try {
      localStorage.removeItem(LOCK_KEY);
    } catch {
      /* @silent:storage */
    }
    setLockReason(null);
    statusRef.current = "authed";
    setStatus("authed");
    // Everything that tried to load while the screen was locked failed with
    // SESSION_LOCKED; ask again now so the screen they return to is current.
    void queryClient.invalidateQueries();
  }, []);

  /** Nobody is signed in any more (signed out here or in another tab). */
  const becomeAnon = React.useCallback(() => {
    tokenStore.setLocked(false);
    tokenStore.clear();
    sessionClock.clear();
    setUser(null);
    setPendingToken(null);
    setLockReason(null);
    statusRef.current = "anon";
    setStatus("anon");
  }, []);

  /**
   * Accept a fresh token pair from any way in — password, 2FA, PIN, passkey.
   * Returns false when the page is being reloaded instead (see "WHO MAY
   * UNLOCK" above).
   */
  const acceptTokens = React.useCallback(
    (r: TokenResponse): boolean => {
      const wasLocked = statusRef.current === "locked";
      const lockedUser = userRef.current;
      tokenStore.setLocked(false);
      resetSessionEnded();
      tokenStore.setAccess(r.access_token);
      tokenStore.setRefresh(r.refresh_token);
      sessionClock.set(r.session_expires_in);
      setPendingToken(null);

      if (wasLocked && lockedUser && lockedUser.user_id !== r.user.user_id) {
        persistUser(r.user);
        lastSessionStore.fromUser(r.user);
        window.location.replace("/");
        return false;
      }

      // The sign-in payload carries a MINIMAL user block; keep what we already
      // know about the same person (avatar, role) until /me answers.
      const merged: User =
        lockedUser && lockedUser.user_id === r.user.user_id ? { ...lockedUser, ...r.user } : r.user;
      persistUser(merged);
      lastSessionStore.fromUser(merged);
      setUser(merged);
      if (wasLocked) finishUnlock();
      else {
        statusRef.current = "authed";
        setStatus("authed");
      }
      tenant<User>("/auth/me")
        .then((fresh) => {
          persistUser(fresh);
          lastSessionStore.fromUser(fresh);
          setUser(fresh);
        })
        .catch(() => {
          /* @silent:storage */
        });
      return true;
    },
    [finishUnlock],
  );

  /**
   * The session died mid-use and could not be refreshed. Lock (not sign out):
   * the person in front of the screen proves who they are and carries on where
   * they were. Only a session that never got going falls back to "anon".
   */
  React.useEffect(() => {
    const onEnded = (e: Event) => {
      const reason = ((e as CustomEvent<{ reason?: SessionEndReason }>).detail?.reason ?? "unknown") as LockReason;
      if (statusRef.current === "authed") lock(reason);
      else if (statusRef.current !== "locked") becomeAnon();
    };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, [lock, becomeAnon]);

  /**
   * The two-hour ceiling, on this machine's clock. A timer for the exact
   * moment, a visibility/focus check for a laptop that slept through it
   * (background timers are throttled), and a slow interval as the backstop.
   */
  React.useEffect(() => {
    if (status !== "authed") return;
    let timer: number | undefined;
    const check = () => {
      if (sessionClock.expired()) lock("session_max_age");
    };
    const schedule = () => {
      window.clearTimeout(timer);
      const left = sessionClock.msLeft();
      if (left === null) return;
      timer = window.setTimeout(check, Math.min(left + 200, 2 ** 31 - 1));
    };
    const onWake = () => {
      check();
      schedule();
    };
    schedule();
    const interval = window.setInterval(check, 15_000);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    const onStorage = (e: StorageEvent) => {
      if (e.key === sessionClock.KEY) schedule();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("storage", onStorage);
    };
  }, [status, lock]);

  /**
   * Other tabs. They share one session, so they lock together and unlock
   * together, and signing out in one signs out all of them.
   */
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea && e.storageArea !== localStorage) return;
      const s = statusRef.current;
      // localStorage.clear() (a sign-out elsewhere) or the user record removed.
      if (e.key === null || (e.key === USER_KEY && !e.newValue)) {
        if (s === "authed" || s === "locked") becomeAnon();
        return;
      }
      if (e.key !== tokenStore.REFRESH_KEY) return;
      if (!e.newValue) {
        if (s === "authed") lock(readLockReason());
        return;
      }
      if (s !== "locked") return;
      // Unlocked in another tab: pick the session up here too — but only for
      // the same person.
      void (async () => {
        const ok = await tryRefresh();
        if (!ok || statusRef.current !== "locked") return;
        tokenStore.setLocked(false);
        let me: User | null = null;
        try {
          me = await tenant<User>("/auth/me");
        } catch {
          /* @silent:teardown — could not confirm who; stay locked. */
        }
        const lockedUser = userRef.current;
        if (!me) {
          tokenStore.setLocked(true);
          return;
        }
        if (lockedUser && me.user_id !== lockedUser.user_id) {
          window.location.replace("/");
          return;
        }
        resetSessionEnded();
        persistUser(me);
        setUser(me);
        finishUnlock();
        setUnlockedElsewhere((n) => n + 1);
      })();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [lock, becomeAnon, finishUnlock]);

  const login: AuthState["login"] = React.useCallback(
    async (email, password) => {
      const r = await tenant<LoginResponse>("/auth/login", {
        method: "POST",
        auth: false,
        body: { email, password },
      });
      if ("pending_2fa" in r) {
        setPendingToken(r.pending_token);
        return { pending2fa: true };
      }
      acceptTokens(r);
      return { pending2fa: false };
    },
    [acceptTokens],
  );

  const verify2fa: AuthState["verify2fa"] = React.useCallback(
    async (code) => {
      if (!pendingToken) throw new Error("No 2FA challenge in progress");
      const r = await tenant<TokenResponse>("/auth/2fa/verify", {
        method: "POST",
        auth: false,
        body: { pending_token: pendingToken, code },
      });
      acceptTokens(r);
      // `pendingToken`, NOT []: an empty array captures `null` from the first
      // render forever, and 2FA would never complete.
    },
    [pendingToken, acceptTokens],
  );

  const pinLogin: AuthState["pinLogin"] = React.useCallback(
    async (email, pin) => {
      const dev = pinStore.get(email);
      if (!dev)
        throw new ApiError(
          "NO_PIN_DEVICE",
          "No Quick PIN is set up on this device for that email.",
          400,
        );
      try {
        const r = await tenant<TokenResponse>("/auth/pin/login", {
          method: "POST",
          auth: false,
          body: { email: email.trim(), device_id: dev.device_id, pin },
        });
        acceptTokens(r);
      } catch (e) {
        // Locked out or revoked: this device's PIN no longer exists server-side,
        // so the screen must stop offering it.
        if (e instanceof ApiError && (e.code === "PIN_LOCKED" || e.code === "PIN_LOGIN_UNAVAILABLE")) {
          pinStore.remove(email);
        }
        throw e;
      }
    },
    [acceptTokens],
  );

  const registerPin: AuthState["registerPin"] = React.useCallback(
    async (pin, label = null, currentPassword = null) => {
      const email = user?.email ?? "";
      // Re-registering on this device REPLACES its PIN — the old one is revoked
      // server-side rather than left working alongside the new.
      const previous = email ? pinStore.get(email) : null;
      const r = await tenant<{ device_id: string; label?: string | null }>(
        "/auth/pin/register",
        {
          method: "POST",
          body: {
            pin,
            label,
            ...(previous ? { replace_device_id: previous.device_id } : {}),
            ...(currentPassword ? { current_password: currentPassword } : {}),
          },
        },
      );
      if (email)
        pinStore.set(email, {
          device_id: r.device_id,
          label: r.label ?? label,
        });
      return { device_id: r.device_id };
      // `user`, NOT [] — on the first render `user` is null, so an empty array
      // makes the `if (email)` branch permanently false.
    },
    [user],
  );

  const passkeyLogin: AuthState["passkeyLogin"] = React.useCallback(
    async (email?: string) => {
      const who = email ? email.trim().toLowerCase() : undefined;
      const { assertion, challengeToken } = await passkeyAssertion({
        email: who,
        credentialIds: who ? passkeyDeviceStore.ids(who) : [],
      });
      let r: TokenResponse & { credential_id?: string };
      try {
        r = await tenant<TokenResponse & { credential_id?: string }>("/auth/passkey/login/verify", {
          method: "POST",
          auth: false,
          body: { assertion, challengeToken, ...(who ? { email: who } : {}) },
        });
      } catch (e) {
        // The account no longer holds this device's passkey: forget it here so
        // the next visit does not lead with a passkey that cannot work.
        if (e instanceof ApiError && e.code === "PASSKEY_REVOKED" && who) {
          const gone = (e.fields as { credential_id?: string } | undefined)?.credential_id || String(assertion.id);
          passkeyDeviceStore.forgetId(who, gone);
        }
        throw e;
      }
      if (!acceptTokens(r)) return;
      // A ceremony that COMPLETED is proof this device holds the credential:
      // lead with it next time, scoped to exactly this one.
      passkeyDeviceStore.add(r.user.email, r.credential_id || String(assertion.id));
    },
    [acceptTokens],
  );

  const logout: AuthState["logout"] = React.useCallback(async () => {
    if (!tokenStore.isLocked()) {
      try {
        await tenant("/auth/logout", { method: "POST" });
      } catch {
        /* @silent:teardown */
      }
    }
    tokenStore.clear();
    tokenStore.setLocked(false);
    sessionClock.clear();
    persistUser(null);
    // Clear all persisted client state on logout: tokens, cached user, theme +
    // env preferences. DEVICE facts are carried across the wipe — the Quick PIN
    // and passkey records (the whole point is signing back in fast), the device
    // id (the time clock counts hardware), the remembered identity, and the
    // passkey-offer answers (so "Not now" and a dismissed nudge are not undone
    // by every sign-out).
    try {
      const pinSnap = pinStore.snapshot();
      const devSnap = deviceIdStore.snapshot();
      const lastSnap = lastSessionStore.snapshot();
      const pkSnap = passkeyDeviceStore.snapshot();
      const kept = DEVICE_KEYS.map((k) => [k, localStorage.getItem(k)] as const);
      localStorage.clear();
      pinStore.restore(pinSnap);
      deviceIdStore.restore(devSnap);
      lastSessionStore.restore(lastSnap);
      passkeyDeviceStore.restore(pkSnap);
      for (const [k, v] of kept) if (v) localStorage.setItem(k, v);
    } catch {
      /* @silent:storage */
    }
    setUser(null);
    setLockReason(null);
    statusRef.current = "anon";
    setStatus("anon");
  }, []);

  const lockNow: AuthState["lockNow"] = React.useCallback(async () => {
    if (statusRef.current !== "authed") return;
    // End the session server-side FIRST, while the token still works: a lock
    // that left the session alive would only be a curtain.
    try {
      await tenant("/auth/logout", { method: "POST", retry: false });
    } catch {
      /* @silent:teardown — the tokens are wiped below either way. */
    }
    lock("manual");
  }, [lock]);

  const abandonLock: AuthState["abandonLock"] = React.useCallback(() => {
    tokenStore.clear();
    tokenStore.setLocked(false);
    sessionClock.clear();
    persistUser(null);
    lastSessionStore.clear();
    try {
      localStorage.removeItem(LOCK_KEY);
    } catch {
      /* @silent:storage */
    }
    // A full reload, not a state change: the previous person's data is in memory
    // behind the blur, and the next person must start from nothing.
    window.location.replace("/login");
  }, []);

  const patchUser = React.useCallback(
    (partial: Partial<User>) =>
      setUser((u) => {
        if (!u) return u;
        const next = { ...u, ...partial };
        persistUser(next);
        lastSessionStore.fromUser(next);
        return next;
      }),
    [],
  );

  /**
   * PERF S14. The value is memoised so the context identity changes only when
   * the auth state genuinely does — AuthProvider wraps the whole app, and a new
   * value every render re-renders every consumer in the tree. `verify2fa` and
   * `registerPin` carry the render state they read (`pendingToken`, `user`);
   * everything else is stable.
   */
  const value = React.useMemo(
    () => ({
      user,
      status,
      lockReason,
      unlockedElsewhere,
      pendingToken,
      login,
      verify2fa,
      pinLogin,
      registerPin,
      passkeyLogin,
      logout,
      lockNow,
      abandonLock,
      patchUser,
    }),
    [
      user,
      status,
      lockReason,
      unlockedElsewhere,
      pendingToken,
      login,
      verify2fa,
      pinLogin,
      registerPin,
      passkeyLogin,
      logout,
      lockNow,
      abandonLock,
      patchUser,
    ],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
