import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";
vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const platformAuthenticatorAvailable = vi.fn();
const isPasskeySupported = vi.fn();
vi.mock("@/lib/webauthn", () => ({
  platformAuthenticatorAvailable: () => platformAuthenticatorAvailable(),
  isPasskeySupported: () => isPasskeySupported(),
}));

import { PasskeyNudge, PASSKEY_SETTING_PATH } from "./passkey-nudge";
import { passkeyDeviceStore } from "@/lib/passkey-devices";

/**
 * The nudge is the standing reminder — the sign-in step asks, and "Not now"
 * snoozes it — so the thing that matters is WHEN it stays quiet. Every one of
 * these cases is a way to nag somebody who does not need nagging:
 *
 *   · a DEVICE that already has a passkey (per device, not per account: the
 *     laptop's passkey is no use on the phone),
 *   · a browser or device that cannot hold one,
 *   · someone who has already dismissed it,
 *   · a platform probe that could not answer — "don't know" is not "yes".
 *
 * It also pins that dismissal does NOT touch the sign-in step's own flag.
 * One shared flag would collapse the pair: everyone meets the interrupt first,
 * so a single "Not now" would suppress this before it ever rendered.
 */
beforeEach(() => {
  localStorage.clear();
  platformAuthenticatorAvailable.mockReset();
  platformAuthenticatorAvailable.mockResolvedValue(true);
  isPasskeySupported.mockReset();
  isPasskeySupported.mockReturnValue(true);
});
afterEach(() => localStorage.clear());

describe("PasskeyNudge", () => {
  it("offers the route in words when this device has no passkey", async () => {
    renderScreen(<PasskeyNudge />);

    await screen.findByText(/no passkey yet/i);
    // The directional guide is the point of the component: naming the path is
    // what someone can still act on after the banner is gone.
    expect(screen.getByText(PASSKEY_SETTING_PATH)).toBeTruthy();
    expect(screen.getByRole("button", { name: /show me where/i })).toBeTruthy();
  });

  it("stays silent on a device that already has one", async () => {
    passkeyDeviceStore.add("test@example.test", "cred-1");
    renderScreen(<PasskeyNudge />);

    await waitFor(() => expect(platformAuthenticatorAvailable).toHaveBeenCalled());
    expect(screen.queryByText(/no passkey yet/i)).toBeNull();
  });

  it("stays silent where passkeys are not supported, and does not probe", async () => {
    isPasskeySupported.mockReturnValue(false);
    renderScreen(<PasskeyNudge />);

    await waitFor(() => expect(screen.queryByText(/no passkey yet/i)).toBeNull());
    expect(platformAuthenticatorAvailable).not.toHaveBeenCalled();
  });

  it("stays silent on a device with no authenticator of its own, or a probe that failed", async () => {
    platformAuthenticatorAvailable.mockResolvedValue(false);
    const first = renderScreen(<PasskeyNudge />);
    await waitFor(() => expect(platformAuthenticatorAvailable).toHaveBeenCalled());
    expect(screen.queryByText(/no passkey yet/i)).toBeNull();
    first.unmount();

    platformAuthenticatorAvailable.mockRejectedValue(new Error("no answer"));
    renderScreen(<PasskeyNudge />);
    await waitFor(() => expect(platformAuthenticatorAvailable).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/no passkey yet/i)).toBeNull();
  });

  it("dismisses, stays dismissed, and leaves the sign-in step's flag alone", async () => {
    const { unmount } = renderScreen(<PasskeyNudge />);
    await screen.findByText(/no passkey yet/i);

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(/no passkey yet/i)).toBeNull();

    // Survives a remount — a reminder that returns on every dashboard visit is
    // the nag this is meant not to be.
    unmount();
    renderScreen(<PasskeyNudge />);
    await waitFor(() => expect(screen.queryByText(/no passkey yet/i)).toBeNull());

    // The sign-in interrupt keeps its own answer.
    expect(localStorage.getItem("praxis.passkey.offer.declined")).toBeNull();
  });
});
