/**
 * Releasing a device — the set of things that have to go together.
 *
 * The sign-in screen decides what to offer from three stores: the remembered
 * identity (the greeting), the PIN record, and the passkey record. A release
 * that drops one and keeps the others fails in the quiet direction: the screen
 * still renders, it just keeps trusting the person who just left.
 *
 * The PIN case is the one that matters most and is the least visible. The
 * sign-in screen's PIN tab accepts any email plus a PIN, so a PIN record left
 * behind on a shared workstation still opens the account that signed out — with
 * no greeting on screen to say so.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { forgetDeviceAccount } from "./device-account";
import { lastSessionStore } from "./last-session";
import { pinStore } from "./pin-store";
import { passkeyDeviceStore } from "./passkey-devices";

const AMA = "ama@acme.cm";
const KOFI = "kofi@other.cm";

function seedDevice() {
  lastSessionStore.set({
    email: AMA,
    display_name: "Ama Nkeng",
    avatar_url: null,
  });
  pinStore.set(AMA, { device_id: "d-ama", label: "This laptop" });
  passkeyDeviceStore.set(AMA);
}

describe("forgetDeviceAccount", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes all three things that make the device belong to someone", () => {
    seedDevice();

    forgetDeviceAccount(AMA);

    expect(lastSessionStore.get()).toBeNull();
    expect(pinStore.get(AMA)).toBeNull();
    expect(passkeyDeviceStore.get(AMA)).toBe(false);
  });

  it("leaves other accounts on the device alone", () => {
    seedDevice();
    pinStore.set(KOFI, { device_id: "d-kofi", label: "Shared desk" });

    forgetDeviceAccount(AMA);

    expect(pinStore.get(KOFI)).toMatchObject({ device_id: "d-kofi" });
  });

  it("is case- and whitespace-insensitive, like the stores it clears", () => {
    seedDevice();

    forgetDeviceAccount("  AMA@Acme.CM  ");

    expect(pinStore.get(AMA)).toBeNull();
    expect(passkeyDeviceStore.get(AMA)).toBe(false);
  });

  it("clears the identity even when it cannot name the account", () => {
    seedDevice();

    // A half-hydrated session — the device should stop answering for it rather
    // than keep greeting a name nobody can vouch for.
    forgetDeviceAccount(null);

    expect(lastSessionStore.get()).toBeNull();
  });

  it("does not throw on an empty email, and touches no credential", () => {
    seedDevice();

    expect(() => forgetDeviceAccount("")).not.toThrow();
    expect(pinStore.get(AMA)).toMatchObject({ device_id: "d-ama" });
    expect(passkeyDeviceStore.get(AMA)).toBe(true);
  });
});

describe("the passkey device registry", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("answers no for an account it has never seen", () => {
    expect(passkeyDeviceStore.get(KOFI)).toBe(false);
  });

  it("answers no for an empty email rather than matching the whole registry", () => {
    seedDevice();
    // `{}[""]` is undefined and `{}[undefined]` is a string — both are the kind
    // of falsy/truthy accident this guard exists to stop.
    expect(passkeyDeviceStore.get("")).toBe(false);
  });

  it("survives a localStorage wipe through snapshot/restore, like the PIN store", () => {
    passkeyDeviceStore.set(AMA);
    const snap = passkeyDeviceStore.snapshot();

    // What auth-context's logout does: clear everything, then carry the device
    // facts back across. If this one were forgotten, every sign-out would turn
    // a passkey laptop into a password laptop — the exact guess the registry
    // exists to stop making.
    localStorage.clear();
    expect(passkeyDeviceStore.get(AMA)).toBe(false);

    passkeyDeviceStore.restore(snap);
    expect(passkeyDeviceStore.get(AMA)).toBe(true);
  });

  it("treats a corrupt entry as an empty registry instead of throwing", () => {
    localStorage.setItem("praxis.passkey.devices", "{not json");
    expect(passkeyDeviceStore.get(AMA)).toBe(false);
  });
});
