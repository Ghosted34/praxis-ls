/**
 * Auth context — holds the current user + access/refresh lifecycle.
 *
 * The backend has no /me endpoint (whoami returns tenant/env only), so we stash
 * the user object returned by login alongside the refresh token and restore it
 * on reload after confirming the refresh token still works. Access tokens stay
 * in memory (token-store); refresh survives reload.
 *
 * 2FA: login may return { pending_2fa } instead of tokens — the UI then collects
 * a code and calls verify2fa().
 */
import * as React from "react";
import { tenant, ApiError } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";
import { pinStore } from "@/lib/pin-store";

export type User = {
  user_id: string;
  email: string;
  display_name?: string;
  /** Per-tenant AI switch, resolved from the ai.assistant.backend feature flag
   *  and returned by the auth endpoints. Absent ⇒ AI off (opt-in). Drives the
   *  global AI gate — see components/ai-actions.tsx. */
  ai_enabled?: boolean;
  /** Comms channels switched on for the tenant (WhatsApp/Instagram hidden until
   *  enabled, like AI). Absent ⇒ off. */
  channels?: { comms?: boolean; whatsapp?: boolean; instagram?: boolean };
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
    const refresh_token = tokenStore.getRefresh();
    if (!refresh_token) {
      setStatus("anon");
      return;
    }
    tenant<{ access_token: string; refresh_token?: string }>("/auth/refresh", { method: "POST", auth: false, body: { refresh_token } })
      .then((r) => {
        tokenStore.setAccess(r.access_token);
        // Support refresh-token rotation if the BE returns a new one on refresh.
        if (r.refresh_token) tokenStore.setRefresh(r.refresh_token);
        setUser(readUser());
        setStatus("authed");
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
  }

  const login: AuthState["login"] = async (email, password, keepSignedIn = true) => {
    // Record the persistence choice before any tokens land. It also carries the
    // 2FA path: acceptTokens() runs later in verify2fa() and reads this flag.
    tokenStore.setPersist(keepSignedIn);
    const r = await tenant<LoginResponse>("/auth/login", { method: "POST", auth: false, body: { email, password } });
    if ("pending_2fa" in r) {
      setPendingToken(r.pending_token);
      return { pending2fa: true };
    }
    acceptTokens(r);
    return { pending2fa: false };
  };

  const verify2fa: AuthState["verify2fa"] = async (code) => {
    if (!pendingToken) throw new Error("No 2FA challenge in progress");
    const r = await tenant<{ access_token: string; refresh_token: string; user: User }>("/auth/2fa/verify", {
      method: "POST",
      auth: false,
      body: { pending_token: pendingToken, code },
    });
    acceptTokens(r);
  };

  const pinLogin: AuthState["pinLogin"] = async (email, pin) => {
    const dev = pinStore.get(email);
    if (!dev) throw new ApiError("NO_PIN_DEVICE", "No Quick PIN is set up on this device for that email.", 400);
    tokenStore.setPersist(true);
    const r = await tenant<{ access_token: string; refresh_token: string; user: User }>("/auth/pin/login", {
      method: "POST",
      auth: false,
      body: { email: email.trim(), device_id: dev.device_id, pin },
    });
    acceptTokens(r);
  };

  const registerPin: AuthState["registerPin"] = async (pin, label = null) => {
    const r = await tenant<{ device_id: string; label?: string | null }>("/auth/pin/register", {
      method: "POST",
      body: { pin, label },
    });
    if (user) pinStore.set(user.email, { device_id: r.device_id, label: r.label ?? label });
    return { device_id: r.device_id };
  };

  const logout: AuthState["logout"] = async () => {
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
  };

  return (
    <AuthCtx.Provider value={{ user, status, pendingToken, login, verify2fa, pinLogin, registerPin, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
