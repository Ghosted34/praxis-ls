/**
 * Push-subscription re-registration.
 *
 * ── THE FAILURE THIS GUARDS ─────────────────────────────────────────────────
 *
 * A PushSubscription is not permanent — browsers rotate and expire them on
 * their own schedule. When that happens the server keeps pushing to a dead
 * endpoint and the phone keeps not receiving, with NO error on either side. The
 * device just goes quiet, for good, and nobody finds out.
 *
 * The service worker re-subscribes the browser but cannot tell the server
 * (registering is authenticated; a worker holds no session). So this runs on
 * every app boot. The four cases below are the four states a device can be in,
 * and getting any of them wrong is a phone that stops receiving mail alerts.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const tenantMock = vi.fn();
vi.mock("@/lib/api-client", () => ({ tenant: (...a: unknown[]) => tenantMock(...a) }));

// Typed with a rest parameter so the mock factory below can spread into it.
const saveTokenMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/push-token-store", () => ({
  saveRotationToken: (...a: unknown[]) => saveTokenMock(...a),
  readRotationToken: vi.fn(async () => null),
  clearRotationToken: vi.fn(async () => undefined),
}));

const { syncPushSubscription } = await import("./push-sync");

type Perm = "granted" | "denied" | "default";

function setup({
  permission = "granted" as Perm,
  subscription = null as unknown,
  subscribeResult = null as unknown,
  subscribeThrows = false,
} = {}) {
  const subscribe = vi.fn(async () => {
    if (subscribeThrows) throw new Error("push service refused");
    return subscribeResult;
  });
  const getSubscription = vi.fn(async () => subscription);

  vi.stubGlobal("Notification", { permission });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("navigator", {
    serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
  });
  return { subscribe, getSubscription };
}

const existingSub = {
  endpoint: "https://fcm.example/abc",
  toJSON: () => ({ endpoint: "https://fcm.example/abc", keys: { p256dh: "k1", auth: "k2" } }),
};

beforeEach(() => {
  tenantMock.mockReset();
  tenantMock.mockResolvedValue({});
  saveTokenMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("syncPushSubscription", () => {
  it("re-POSTs an existing subscription — this is what repairs a silent rotation", async () => {
    setup({ subscription: existingSub });
    await expect(syncPushSubscription()).resolves.toBe("synced");

    expect(tenantMock).toHaveBeenCalledWith("/notifications/push/subscribe", {
      method: "POST",
      body: { subscription: existingSub.toJSON() },
    });
  });

  it("permission granted but the subscription is GONE → resubscribes silently", async () => {
    // The browser dropped it and the worker could not re-create it. Making the
    // user find the Settings toggle again is how a device goes quiet for good.
    const newSub = {
      endpoint: "https://fcm.example/new",
      toJSON: () => ({ endpoint: "https://fcm.example/new", keys: { p256dh: "n1", auth: "n2" } }),
    };
    const { subscribe } = setup({ subscription: null, subscribeResult: newSub });
    tenantMock.mockImplementation(async (path: string) =>
      path === "/notifications/push/public-key" ? { public_key: "PUBKEY" } : {},
    );

    await expect(syncPushSubscription()).resolves.toBe("resubscribed");
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(tenantMock).toHaveBeenCalledWith("/notifications/push/subscribe", {
      method: "POST",
      body: { subscription: newSub.toJSON() },
    });
  });

  it("NEVER prompts when permission was not granted", async () => {
    // Asking for notification permission unbidden on app boot is what gets a
    // site blocked permanently — after which no fix reaches this device at all.
    const { subscribe, getSubscription } = setup({ permission: "default", subscription: null });
    await expect(syncPushSubscription()).resolves.toBe("skipped");
    expect(subscribe).not.toHaveBeenCalled();
    expect(getSubscription).not.toHaveBeenCalled();
    expect(tenantMock).not.toHaveBeenCalled();
  });

  it("does nothing when the user has blocked notifications", async () => {
    setup({ permission: "denied", subscription: existingSub });
    await expect(syncPushSubscription()).resolves.toBe("skipped");
    expect(tenantMock).not.toHaveBeenCalled();
  });

  it("VAPID unset on the deployment → skips instead of subscribing to nothing", async () => {
    const { subscribe } = setup({ subscription: null });
    tenantMock.mockImplementation(async (path: string) =>
      path === "/notifications/push/public-key" ? { public_key: null } : {},
    );
    await expect(syncPushSubscription()).resolves.toBe("skipped");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("a failing network call resolves quietly — this runs on boot and must never break it", async () => {
    setup({ subscription: existingSub });
    tenantMock.mockRejectedValue(new Error("offline"));
    await expect(syncPushSubscription()).resolves.toBe("skipped");
  });

  it("a browser with no push support is not an error", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("Notification", undefined);
    await expect(syncPushSubscription()).resolves.toBe("skipped");
    expect(tenantMock).not.toHaveBeenCalled();
  });
});

describe("the rotation token", () => {
  it("is stored so the service worker can repair this device without a session", async () => {
    // This is the whole mechanism: /push/subscribe is authenticated and a
    // worker cannot reach the Bearer token in the page, so it presents this
    // instead when the browser rotates the subscription. Without it the repair
    // waits for the user to open an app that has stopped notifying them.
    setup({ subscription: existingSub });
    tenantMock.mockResolvedValue({ rotation_token: "ROT-TOKEN-1" });

    await syncPushSubscription();
    expect(saveTokenMock).toHaveBeenCalledWith("ROT-TOKEN-1");
  });

  it("a server that issues none (migration not run) does not break the sync", async () => {
    setup({ subscription: existingSub });
    tenantMock.mockResolvedValue({ rotation_token: null });
    await expect(syncPushSubscription()).resolves.toBe("synced");
    expect(saveTokenMock).not.toHaveBeenCalled();
  });
});
