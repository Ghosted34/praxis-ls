import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";
vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const listPasskeys = vi.fn();
const isPasskeySupported = vi.fn();
vi.mock("@/lib/webauthn", () => ({
  listPasskeys: (...a: unknown[]) => listPasskeys(...a),
  isPasskeySupported: () => isPasskeySupported(),
}));

import { PasskeyNudge, PASSKEY_SETTING_PATH } from "./passkey-nudge";

/**
 * The nudge is the only passkey prompt most people will ever see — the sign-in
 * step interrupts once and is then silenced for good — so the thing that
 * matters is WHEN it stays quiet. Every one of these cases is a way to nag
 * somebody who does not need nagging:
 *
 *   · an account that already has a passkey,
 *   · a browser that cannot hold one,
 *   · someone who has already dismissed it,
 *   · a credential list that could not be read — "don't know" is not "none".
 *
 * It also pins that dismissal does NOT touch the sign-in step's own flag.
 * One shared flag would collapse the pair: everyone meets the interrupt first,
 * so a single "Not now" would suppress this before it ever rendered.
 */
beforeEach(() => {
  localStorage.clear();
  listPasskeys.mockReset();
  isPasskeySupported.mockReset();
  isPasskeySupported.mockReturnValue(true);
});
afterEach(() => localStorage.clear());

describe("PasskeyNudge", () => {
  it("offers the route in words when the account has no passkey", async () => {
    listPasskeys.mockResolvedValue([]);
    renderScreen(<PasskeyNudge />);

    await screen.findByText(/no passkey yet/i);
    // The directional guide is the point of the component: naming the path is
    // what someone can still act on after the banner is gone.
    expect(screen.getByText(PASSKEY_SETTING_PATH)).toBeTruthy();
    expect(screen.getByRole("button", { name: /show me where/i })).toBeTruthy();
  });

  it("stays silent for an account that already has one", async () => {
    listPasskeys.mockResolvedValue([{ credential_id: "c1", label: null, created_at: "2026-01-01" }]);
    renderScreen(<PasskeyNudge />);

    await waitFor(() => expect(listPasskeys).toHaveBeenCalled());
    expect(screen.queryByText(/no passkey yet/i)).toBeNull();
  });

  it("stays silent where passkeys are not supported, and does not ask the server", async () => {
    isPasskeySupported.mockReturnValue(false);
    listPasskeys.mockResolvedValue([]);
    renderScreen(<PasskeyNudge />);

    await waitFor(() => expect(screen.queryByText(/no passkey yet/i)).toBeNull());
    expect(listPasskeys).not.toHaveBeenCalled();
  });

  it("treats an unreadable credential list as 'don't know', not 'none'", async () => {
    listPasskeys.mockRejectedValue(new Error("offline"));
    renderScreen(<PasskeyNudge />);

    await waitFor(() => expect(listPasskeys).toHaveBeenCalled());
    expect(screen.queryByText(/no passkey yet/i)).toBeNull();
  });

  it("dismisses, stays dismissed, and leaves the sign-in step's flag alone", async () => {
    listPasskeys.mockResolvedValue([]);
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
