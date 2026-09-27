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
