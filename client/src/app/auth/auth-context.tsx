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
import { tenant } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";

export type User = { user_id: string; email: string; display_name?: string };

type LoginResult = { pending2fa: boolean };

type AuthState = {
  user: User | null;
  status: "loading" | "authed" | "anon";
  pendingToken: string | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  verify2fa: (code: string) => Promise<void>;
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
    tenant<{ access_token: string }>("/auth/refresh", { method: "POST", auth: false, body: { refresh_token } })
      .then((r) => {
        tokenStore.setAccess(r.access_token);
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

  const login: AuthState["login"] = async (email, password) => {
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

  const logout: AuthState["logout"] = async () => {
    try {
      await tenant("/auth/logout", { method: "POST" });
    } catch {
      /* best-effort */
    }
    tokenStore.clear();
    persistUser(null);
    setUser(null);
    setStatus("anon");
  };

  return (
    <AuthCtx.Provider value={{ user, status, pendingToken, login, verify2fa, logout }}>{children}</AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
