/**
 * The session end of the api-client: the refresh exchange, and what a failed
 * one means.
 *
 *   · one refresh at a time ACROSS TABS, reading the token inside the lock —
 *     two tabs refreshing with the same token trip reuse detection and kill the
 *     session for both (doc/AUTH_SESSIONS.md, Trap 2);
 *   · a refresh that never reached the server is OFFLINE, not the session
 *     ending — it must not lock the screen;
 *   · a refused refresh says WHY, so the lock screen can say it too;
 *   · while locked, nothing authenticated leaves the browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError, NETWORK_DOWN, SESSION_ENDED_EVENT, SESSION_LOCKED, resetSessionEnded, tenant, tryRefresh } from "./api-client";
import { tokenStore } from "./token-store";
import { sessionClock } from "./session-clock";
import { __resetConnectionForTests } from "./connection";

const fetchMock = vi.fn();
const res = (status: number, body: unknown) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    statusText: String(status),
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

const failure = (p: Promise<unknown>): Promise<ApiError> => p.then(() => null, (e) => e) as Promise<ApiError>;

beforeEach(() => {
  localStorage.clear();
  __resetConnectionForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  tokenStore.clear();
  tokenStore.setLocked(false);
  resetSessionEnded();
});
afterEach(() => {
  vi.unstubAllGlobals();
  tokenStore.setLocked(false);
});

describe("tryRefresh", () => {
  it("takes the cross-tab lock and reads the token INSIDE it", async () => {
    tokenStore.setRefresh("stale");
    const request = vi.fn(async (_name: string, cb: () => Promise<boolean>) => {
      // Another tab rotated the token while this one waited for the lock.
      tokenStore.setRefresh("current");
      return cb();
    });
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });
    fetchMock.mockResolvedValue(res(200, { data: { access_token: "a2", refresh_token: "r2", session_expires_in: 600 } }));

    expect(await tryRefresh()).toBe(true);

    expect(request).toHaveBeenCalledWith("praxis-auth-refresh", expect.any(Function));
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.refresh_token).toBe("current");
    expect(tokenStore.getRefresh()).toBe("r2");
    expect(tokenStore.getAccess()).toBe("a2");
    // …and the session's end is known to every tab.
    expect(sessionClock.msLeft()).toBeGreaterThan(590_000);
  });

  it("de-dupes a burst of 401s into one exchange", async () => {
    tokenStore.setRefresh("r1");
    fetchMock.mockResolvedValue(res(200, { data: { access_token: "a", refresh_token: "r" } }));
    await Promise.all([tryRefresh(), tryRefresh(), tryRefresh()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("a failed refresh during a request", () => {
  it("announces the session's end with the server's reason", async () => {
    tokenStore.setRefresh("r1");
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(SESSION_ENDED_EVENT, on);
    fetchMock
      .mockResolvedValueOnce(res(401, { error: { code: "TOKEN_EXPIRED" } }))
      .mockResolvedValueOnce(res(401, { error: { code: "SESSION_EXPIRED", fields: { reason: "session_max_age" } } }));

    const err = await failure(tenant("/things"));

    window.removeEventListener(SESSION_ENDED_EVENT, on);
    expect(err.status).toBe(401);
    expect(seen).toEqual([{ reason: "session_max_age" }]);
    expect(tokenStore.getRefresh()).toBeNull();
  });

  it("treats a refresh that never reached the server as offline — no lock", async () => {
    tokenStore.setRefresh("r1");
    const on = vi.fn();
    window.addEventListener(SESSION_ENDED_EVENT, on);
    fetchMock
      .mockResolvedValueOnce(res(401, { error: { code: "TOKEN_EXPIRED" } }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const err = await failure(tenant("/things"));

    window.removeEventListener(SESSION_ENDED_EVENT, on);
    expect(err.code).toBe(NETWORK_DOWN);
    expect(on).not.toHaveBeenCalled();
    // The session is intact: the token is kept for when the network returns.
    expect(tokenStore.getRefresh()).toBe("r1");
  });
});

describe("while locked", () => {
  it("refuses authenticated calls without touching the network", async () => {
    tokenStore.setLocked(true);
    const err = await failure(tenant("/finance/payments"));
    expect(err.code).toBe(SESSION_LOCKED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still lets the sign-in calls through (they are how you unlock)", async () => {
    tokenStore.setLocked(true);
    fetchMock.mockResolvedValue(res(200, { data: { ok: true } }));
    await tenant("/auth/login", { method: "POST", auth: false, body: {} });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
