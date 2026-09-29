/**
 * What sign-out keeps: every fact about the DEVICE, untouched.
 *
 * Owner decision, 29 Sep 2026: a device forgets its person's passkey only when
 * they remove it in My security. Sign-out used to clear() everything and write
 * back a snapshot; a key missing from the snapshot, or anything going wrong in
 * between, lost the greeting and the passkey record. These pin that each device
 * store's key is on the keep-list, and that the wipe never touches them.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DEVICE_KEYS, clearSessionKeepDevice } from "./device-keys";
import { lastSessionStore } from "./last-session";
import { passkeyDeviceStore, PASSKEY_DEVICES_KEY } from "./passkey-devices";
import { deviceId, DEVICE_ID_KEY } from "./device-id";
import { passkeyOfferStore, PASSKEY_OFFER_KEYS } from "./passkey-offer";

const AMA = "ama@acme.cm";

beforeEach(() => localStorage.clear());

describe("DEVICE_KEYS", () => {
  it("lists every device store's own key", () => {
    for (const k of [lastSessionStore.KEY, PASSKEY_DEVICES_KEY, DEVICE_ID_KEY, ...PASSKEY_OFFER_KEYS]) {
      expect(DEVICE_KEYS).toContain(k);
    }
  });

  it("does not keep the retired per-device PIN registry (the PIN is per person now)", () => {
    expect(DEVICE_KEYS).not.toContain("praxis.pin.devices");
  });
});

describe("clearSessionKeepDevice", () => {
  it("removes session state and leaves the device's person and passkey exactly as they were", () => {
    lastSessionStore.set({ email: AMA, display_name: "Ama Nkeng", has_quick_pin: true });
    passkeyDeviceStore.add(AMA, "cred-1");
    const hw = deviceId();
    passkeyOfferStore.dismissNudge(AMA);
    localStorage.setItem("praxis.refresh_token", "r");
    localStorage.setItem("praxis.user", "{}");
    localStorage.setItem("praxis.theme", "dark");
    localStorage.setItem("praxis.pin.devices", "{}");
    const before = DEVICE_KEYS.map((k) => localStorage.getItem(k));

    clearSessionKeepDevice();

    expect(DEVICE_KEYS.map((k) => localStorage.getItem(k))).toEqual(before);
    expect(lastSessionStore.get()?.email).toBe(AMA);
    expect(passkeyDeviceStore.ids(AMA)).toEqual(["cred-1"]);
    expect(deviceId()).toBe(hw);
    expect(passkeyOfferStore.nudgeDismissed(AMA)).toBe(true);
    for (const k of ["praxis.refresh_token", "praxis.user", "praxis.theme", "praxis.pin.devices"]) {
      expect(localStorage.getItem(k)).toBeNull();
    }
  });
});
