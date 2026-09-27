/**
 * The per-device passkey registry and the offer's snooze.
 *
 * The registry is what makes "on my laptop I use my laptop's passkey" literal:
 * it keeps the ids of the passkeys THIS device holds, so sign-in can scope the
 * ceremony to exactly them.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { passkeyDeviceStore } from "./passkey-devices";
import { passkeyOfferStore, OFFER_SNOOZE_MS } from "./passkey-offer";

const AMA = "ama@acme.cm";

beforeEach(() => localStorage.clear());

describe("passkeyDeviceStore", () => {
  it("records the credential ids this device holds, once each", () => {
    passkeyDeviceStore.add(AMA, "c1");
    passkeyDeviceStore.add(" AMA@acme.cm ", "c1");
    passkeyDeviceStore.add(AMA, "c2");
    expect(passkeyDeviceStore.get(AMA)).toBe(true);
    expect(passkeyDeviceStore.ids(AMA)).toEqual(["c1", "c2"]);
    expect(passkeyDeviceStore.holds(AMA, "c2")).toBe(true);
    expect(passkeyDeviceStore.holds(AMA, "c9")).toBe(false);
  });

  it("reads an entry written before ids were kept as 'has one, id unknown'", () => {
    localStorage.setItem("praxis.passkey.devices", JSON.stringify({ [AMA]: true }));
    expect(passkeyDeviceStore.get(AMA)).toBe(true);
    expect(passkeyDeviceStore.ids(AMA)).toEqual([]);
    // …and gains its id on the first successful passkey sign-in.
    passkeyDeviceStore.add(AMA, "c1");
    expect(passkeyDeviceStore.ids(AMA)).toEqual(["c1"]);
  });

  it("forgets one credential the server no longer knows, and the device once none are left", () => {
    passkeyDeviceStore.add(AMA, "c1");
    passkeyDeviceStore.add(AMA, "c2");
    expect(passkeyDeviceStore.forgetId(AMA, "c1")).toBe(true);
    expect(passkeyDeviceStore.ids(AMA)).toEqual(["c2"]);
    expect(passkeyDeviceStore.forgetId(AMA, "c2")).toBe(false);
    expect(passkeyDeviceStore.get(AMA)).toBe(false);
  });

  it("drops a legacy entry when its (unknown) credential is refused", () => {
    localStorage.setItem("praxis.passkey.devices", JSON.stringify({ [AMA]: true }));
    passkeyDeviceStore.forgetId(AMA, "whatever");
    expect(passkeyDeviceStore.get(AMA)).toBe(false);
  });
});

describe("passkeyOfferStore — 'Not now' snoozes, it does not silence for good", () => {
  it("holds the ask off for a week, then asks again", () => {
    const now = 1_800_000_000_000;
    passkeyOfferStore.decline(AMA, now);
    expect(passkeyOfferStore.declined(AMA, now + 1000)).toBe(true);
    expect(passkeyOfferStore.declined(AMA, now + OFFER_SNOOZE_MS + 1)).toBe(false);
  });

  it("asks once more under the new rule someone who said 'never' before it", () => {
    localStorage.setItem("praxis.passkey.offer.declined", JSON.stringify({ [AMA]: true }));
    expect(passkeyOfferStore.declined(AMA)).toBe(false);
  });

  it("keeps the dashboard nudge's dismissal separate and permanent", () => {
    passkeyOfferStore.dismissNudge(AMA);
    expect(passkeyOfferStore.nudgeDismissed(AMA)).toBe(true);
    expect(passkeyOfferStore.declined(AMA)).toBe(false);
  });
});
