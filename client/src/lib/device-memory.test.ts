/**
 * The server's memory of this device, merged back into the browser's.
 *
 * Safari erases a site's localStorage after seven days away; every browser
 * evicts it under disk pressure. The passkey survives in the OS keychain, and
 * the server remembers the device behind an HttpOnly cookie — so what comes
 * back from GET /auth/device restores the greeting and the passkey record.
 * MERGE, NEVER SUBTRACT: nothing the server says can make the device forget.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const tenant = vi.fn();
vi.mock("./api-client", () => ({ tenant: (...a: unknown[]) => tenant(...a) }));

import { recallDevice, keepDeviceStorage } from "./device-memory";
import { lastSessionStore } from "./last-session";
import { passkeyDeviceStore } from "./passkey-devices";

const AMA = "ama@acme.cm";
const account = (over: Record<string, unknown> = {}) => ({
  account: { email: AMA, display_name: "Ama Nkeng", avatar_url: null, has_quick_pin: true, passkeys: ["cred-1"], ...over },
});

beforeEach(() => {
  localStorage.clear();
  tenant.mockReset();
});

describe("recallDevice", () => {
  it("asks without a token — the sign-in screen has none yet", async () => {
    tenant.mockResolvedValue({ account: null });
    await recallDevice();
    expect(tenant).toHaveBeenCalledWith("/auth/device", expect.objectContaining({ auth: false }));
  });

  it("brings back the greeting and the passkey after the browser erased them", async () => {
    tenant.mockResolvedValue(account());
    const a = await recallDevice();
    expect(a?.email).toBe(AMA);
    expect(lastSessionStore.get()).toMatchObject({ email: AMA, display_name: "Ama Nkeng", has_quick_pin: true });
    expect(passkeyDeviceStore.ids(AMA)).toEqual(["cred-1"]);
  });

  it("adds passkeys, never removes one the device already knew", async () => {
    passkeyDeviceStore.add(AMA, "cred-old");
    tenant.mockResolvedValue(account({ passkeys: ["cred-1"] }));
    await recallDevice();
    expect(passkeyDeviceStore.ids(AMA)).toEqual(["cred-old", "cred-1"]);
  });

  it("keeps this browser's own greeting — the newer answer — but takes the server's word on the PIN", async () => {
    lastSessionStore.set({ email: AMA, display_name: "Ama N.", has_quick_pin: false });
    tenant.mockResolvedValue(account({ display_name: "Someone Older", has_quick_pin: true }));
    await recallDevice();
    expect(lastSessionStore.get()).toMatchObject({ display_name: "Ama N.", has_quick_pin: true });
  });

  it("does not replace a different person this browser greets", async () => {
    lastSessionStore.set({ email: "kofi@acme.cm", display_name: "Kofi" });
    tenant.mockResolvedValue(account());
    await recallDevice();
    expect(lastSessionStore.get()?.email).toBe("kofi@acme.cm");
    // Ama's passkey on this device is still recorded, keyed by her email.
    expect(passkeyDeviceStore.ids(AMA)).toEqual(["cred-1"]);
  });

  it("changes nothing when the server cannot be asked", async () => {
    lastSessionStore.set({ email: AMA, display_name: "Ama", has_quick_pin: true });
    passkeyDeviceStore.add(AMA, "cred-1");
    tenant.mockRejectedValue(new Error("offline"));
    await expect(recallDevice()).resolves.toBeNull();
    expect(lastSessionStore.get()).toMatchObject({ email: AMA, has_quick_pin: true });
    expect(passkeyDeviceStore.ids(AMA)).toEqual(["cred-1"]);
  });

  it("shares one request between callers that ask at the same time", async () => {
    tenant.mockResolvedValue(account());
    await Promise.all([recallDevice(), recallDevice()]);
    expect(tenant).toHaveBeenCalledTimes(1);
  });
});

describe("keepDeviceStorage", () => {
  it("asks the browser to keep this site's storage when it is not yet persistent", async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", { ...navigator, storage: { persisted: async () => false, persist } });
    await keepDeviceStorage();
    expect(persist).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("does not ask again once it is", async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", { ...navigator, storage: { persisted: async () => true, persist } });
    await keepDeviceStorage();
    expect(persist).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
