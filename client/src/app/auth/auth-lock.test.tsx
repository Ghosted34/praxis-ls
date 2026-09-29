/**
 * The lock, as a state machine: when an authenticated session becomes
 * "locked", what that does to the tokens, and who may bring it back.
 *
 *   · the two-hour deadline passes             → locked (session_max_age)
 *   · the server ends the session mid-use      → locked, NOT signed out
 *   · another tab locks                        → locked here too
 *   · the same person signs back in            → authed, in place
 *   · a DIFFERENT person's tokens arrive       → the page reloads instead
 *   · "Lock screen" from the menu              → the session ends server-side first
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";

const tenant = vi.fn();
const tryRefresh = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    tenant: (...a: unknown[]) => tenant(...a),
    tryRefresh: () => tryRefresh(),
  };
});
vi.mock("@/lib/connection", () => ({
  onReconnect: () => () => {},
  probeNow: async () => true,
  reportUnreachable: () => {},
}));
vi.mock("@/lib/query-client", () => ({ queryClient: { invalidateQueries: vi.fn(async () => {}) } }));

import { AuthProvider, useAuth } from "./auth-context";
import { SESSION_ENDED_EVENT } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";
import { sessionClock } from "@/lib/session-clock";
import { lastSessionStore } from "@/lib/last-session";
import { passkeyDeviceStore } from "@/lib/passkey-devices";

const AMA = { user_id: "u-ama", email: "ama@acme.cm", display_name: "Ama Nkeng" };
const KOFI = { user_id: "u-kofi", email: "kofi@acme.cm", display_name: "Kofi" };

let api: ReturnType<typeof useAuth> | null = null;
function Probe() {
  api = useAuth();
  return <p data-testid="status">{api.status}</p>;
}
const status = () => screen.getByTestId("status").textContent;

async function bootSignedIn() {
  tokenStore.setRefresh("refresh-1");
  localStorage.setItem("praxis.user", JSON.stringify(AMA));
  tryRefresh.mockImplementation(async () => {
    tokenStore.setAccess("access-1");
    sessionClock.set(7200);
    return true;
  });
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(status()).toBe("authed"));
}

const replace = vi.fn();
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  tokenStore.clear();
  tokenStore.setLocked(false);
  tenant.mockReset();
  tenant.mockImplementation(async (path: string) => (path === "/auth/me" ? AMA : {}));
  tryRefresh.mockReset();
  replace.mockClear();
  vi.stubGlobal("location", { ...window.location, replace });
  api = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the lock", () => {
  it("locks — not signs out — when the server ends the session mid-use", async () => {
    await bootSignedIn();

    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: { reason: "inactivity_timeout" } }));
    });

    expect(status()).toBe("locked");
    expect(api?.lockReason).toBe("inactivity_timeout");
    // The person behind the lock is still known (the lock screen greets them)…
    expect(api?.user?.email).toBe(AMA.email);
    // …but nothing that could act for them survives.
    expect(tokenStore.getAccess()).toBeNull();
    expect(tokenStore.getRefresh()).toBeNull();
    expect(tokenStore.isLocked()).toBe(true);
  });

  it("locks at the two-hour deadline, on its own, with no request needed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await bootSignedIn();
    act(() => {
      sessionClock.set(1); // one second left
    });
    // The interval check is the backstop when the precise timer was scheduled
    // before the deadline moved.
    await act(async () => {
      vi.advanceTimersByTime(16_000);
    });
    expect(status()).toBe("locked");
    expect(api?.lockReason).toBe("session_max_age");
  });

  it("locks when another tab locks the shared session", async () => {
    await bootSignedIn();
    localStorage.setItem("praxis.session.locked", JSON.stringify({ reason: "manual" }));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "praxis.refresh", newValue: null }));
    });
    expect(status()).toBe("locked");
    expect(api?.lockReason).toBe("manual");
  });

  it("unlocks in place when the same person signs back in", async () => {
    await bootSignedIn();
    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: { reason: "session_max_age" } }));
    });
    tenant.mockImplementation(async (path: string) =>
      path === "/auth/login"
        ? { access_token: "access-2", refresh_token: "refresh-2", session_expires_in: 7200, user: AMA }
        : AMA,
    );

    await act(async () => {
      await api?.login(AMA.email, "correct horse");
    });

    expect(status()).toBe("authed");
    expect(tokenStore.isLocked()).toBe(false);
    expect(tokenStore.getAccess()).toBe("access-2");
    expect(replace).not.toHaveBeenCalled();
    expect(sessionClock.msLeft()).toBeGreaterThan(7_000_000);
  });

  it("reloads instead of unlocking when a DIFFERENT person's tokens arrive", async () => {
    await bootSignedIn();
    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: { reason: "session_max_age" } }));
    });
    tenant.mockImplementation(async () => ({ access_token: "k", refresh_token: "k", user: KOFI }));

    await act(async () => {
      await api?.login(KOFI.email, "pw");
    });

    // Ama's data is still in memory behind the blur; Kofi does not get to see it.
    expect(replace).toHaveBeenCalledWith("/");
    expect(status()).toBe("locked");
  });

  it("'Lock screen' ends the session server-side before locking", async () => {
    await bootSignedIn();
    await act(async () => {
      await api?.lockNow();
    });
    expect(tenant).toHaveBeenCalledWith("/auth/logout", expect.objectContaining({ method: "POST" }));
    expect(status()).toBe("locked");
    expect(api?.lockReason).toBe("manual");
  });

  it("a session that never got going falls back to signed-out, not a lock", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(status()).toBe("anon"));
    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: { reason: "revoked" } }));
    });
    expect(status()).toBe("anon");
  });
});

/**
 * Owner decision, 29 Sep 2026: the ONLY thing that takes a passkey off a device
 * is removing it in My security. Signing out, and "Not you?" on the lock
 * screen, end sessions — they never erase what the device knows about its
 * person or which passkey lives on it.
 */
describe("the device forgets nothing", () => {
  it("signing out removes the session and keeps the device's person and passkey", async () => {
    await bootSignedIn();
    lastSessionStore.set({ email: AMA.email, display_name: AMA.display_name, has_quick_pin: true });
    passkeyDeviceStore.add(AMA.email, "cred-ama");
    localStorage.setItem("praxis.device.id", "hw-1");
    localStorage.setItem("praxis.theme", "dark");

    await act(async () => {
      await api?.logout();
    });

    expect(status()).toBe("anon");
    expect(tokenStore.getRefresh()).toBeFalsy();
    expect(localStorage.getItem("praxis.user")).toBeNull();
    // Session preferences go…
    expect(localStorage.getItem("praxis.theme")).toBeNull();
    // …the device's own facts stay, untouched.
    expect(lastSessionStore.get()).toMatchObject({ email: AMA.email, has_quick_pin: true });
    expect(passkeyDeviceStore.ids(AMA.email)).toEqual(["cred-ama"]);
    expect(localStorage.getItem("praxis.device.id")).toBe("hw-1");
  });

  it("'Not you?' on the lock screen opens a blank sign-in without forgetting the person", async () => {
    await bootSignedIn();
    lastSessionStore.set({ email: AMA.email, display_name: AMA.display_name });
    passkeyDeviceStore.add(AMA.email, "cred-ama");
    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: { reason: "revoked" } }));
    });
    expect(status()).toBe("locked");

    act(() => api?.abandonLock());

    expect(replace).toHaveBeenCalledWith("/login");
    expect(lastSessionStore.someoneElse.active()).toBe(true);
    expect(lastSessionStore.get()?.email).toBe(AMA.email);
    expect(passkeyDeviceStore.ids(AMA.email)).toEqual(["cred-ama"]);
  });
});

describe("the Quick PIN, from any device", () => {
  it("signs in with the email and PIN alone — no device id is sent", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(status()).toBe("anon"));
    tenant.mockImplementation(async (path: string) =>
      path === "/auth/pin/login"
        ? { access_token: "a", refresh_token: "r", session_expires_in: 7200, user: { ...AMA, has_quick_pin: true } }
        : path === "/auth/me"
          ? { ...AMA, has_quick_pin: true }
          : {},
    );

    let r: { pending2fa: boolean } | undefined;
    await act(async () => {
      r = await api?.pinLogin(" AMA@acme.cm ", "4817");
    });

    expect(r).toEqual({ pending2fa: false });
    expect(tenant).toHaveBeenCalledWith("/auth/pin/login", expect.objectContaining({ body: { email: AMA.email, pin: "4817" } }));
    expect(status()).toBe("authed");
    expect(lastSessionStore.get()).toMatchObject({ email: AMA.email, has_quick_pin: true });
  });

  it("hands over to the authenticator code on an account that has one", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(status()).toBe("anon"));
    tenant.mockImplementation(async (path: string) =>
      path === "/auth/pin/login" ? { pending_2fa: true, pending_token: "p-1" } : {},
    );

    let r: { pending2fa: boolean } | undefined;
    await act(async () => {
      r = await api?.pinLogin(AMA.email, "4817");
    });

    expect(r).toEqual({ pending2fa: true });
    expect(status()).toBe("anon");
    expect(api?.pendingToken).toBe("p-1");
  });
});
