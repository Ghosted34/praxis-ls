/**
 * The identity-first sign-in screen: which credential the device leads with.
 *
 * ── THE RULE, as specified ──────────────────────────────────────────────────
 *
 *   A device stores the account that signed in on it, permanently. From then on
 *   the sign-in screen greets that person and opens on the fastest route THIS
 *   DEVICE can actually complete:
 *
 *     a Quick PIN set up here          → the PIN boxes lead
 *     a passkey that lives here        → the orb leads
 *     both                             → the PIN leads, the orb sits above it
 *     neither                          → the password field, because it is the
 *                                        only thing that can work
 *
 *   and the password is always reachable underneath, because a credential can
 *   be revoked from another session and the person standing at the machine
 *   still has to be able to get in.
 *
 * ── WHAT IS ACTUALLY BEING PINNED HERE ──────────────────────────────────────
 *
 * Both halves of each answer, because either one alone is a bug:
 *
 *   · the ROUTE IS OFFERED when the device can complete it — otherwise a
 *     laptop with a working Touch ID asks for a password anyway, which is the
 *     complaint this feature exists to fix;
 *   · the route is NOT offered when it cannot — a PIN is device-bound, so a
 *     PIN that exists for the account on some OTHER device must not put boxes
 *     on this screen. The old code could not tell those apart.
 *
 * ── WHY PASSKEYS NEED A TAP ─────────────────────────────────────────────────
 *
 * The orb is a button and the tests click it. That is not laziness: WebAuthn's
 * `navigator.credentials.get()` is refused outside a user gesture, so no
 * implementation can prompt on modal open. "Defaults to the passkey" means the
 * ceremony is the most prominent thing on the card and exactly one tap away.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { lastSessionStore } from "@/lib/last-session";
import { pinStore } from "@/lib/pin-store";
import { passkeyDeviceStore } from "@/lib/passkey-devices";

const passkeyLoginMock = vi.fn(async () => {});
const pinLoginMock = vi.fn(async () => {});

vi.mock("@/app/auth/auth-context", () => ({
  useAuth: () => ({
    login: vi.fn(async () => ({ pending2fa: false })),
    verify2fa: vi.fn(),
    pinLogin: pinLoginMock,
    passkeyLogin: passkeyLoginMock,
  }),
}));

vi.mock("@/app/branding/branding-context", () => ({
  useBranding: () => ({
    branding: {
      name: "Acme Freight",
      primary: "#1188ff",
      primaryForeground: "#fff",
      logoUrl: null,
    },
    setBranding: vi.fn(),
    ready: true,
  }),
}));

import { LoginModal } from "./login-modal";

const EMAIL = "ama@acme.cm";

function renderModal() {
  return render(
    <MemoryRouter>
      <LoginModal onClose={() => {}} />
    </MemoryRouter>,
  );
}

/** The passkey orb, by the name a screen reader would hear. */
const orb = () => screen.queryByRole("button", { name: /passkey/i });
/**
 * The PIN boxes. `PinInput` renders one input per digit, each named "PIN digit
 * N" inside a group named "Quick PIN" — matched on the digit name so the
 * group, the Show/Hide toggle and the "PIN works only on a device…" note are
 * all excluded rather than colliding with it.
 */
const pinBoxes = () => screen.queryAllByLabelText(/^PIN digit /);

describe("LoginModal — the device leads with the fastest route it can actually complete", () => {
  beforeEach(() => {
    localStorage.clear();
    passkeyLoginMock.mockClear();
    pinLoginMock.mockClear();
    lastSessionStore.set({
      email: EMAIL,
      display_name: "Ama Nkeng",
      avatar_url: null,
    });
  });

  it("greets the stored account by name", () => {
    renderModal();
    expect(
      screen.getByRole("heading", { name: "Welcome back Ama Nkeng" }),
    ).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
  });

  it("leads with the PIN when this device has one — and offers no orb there is no passkey for", () => {
    pinStore.set(EMAIL, { device_id: "d1", label: "This laptop" });
    renderModal();

    expect(pinBoxes()).toHaveLength(4);
    expect(orb()).not.toBeInTheDocument();
    // Nothing to "default" to in the password sense: the password is a
    // fallback behind a link, not the field in front of them.
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Login with password/i }),
    ).toBeInTheDocument();
  });

  it("leads with the passkey orb when the pin is absent and a credential lives here", () => {
    passkeyDeviceStore.set(EMAIL);
    renderModal();

    expect(orb()).toBeInTheDocument();
    expect(pinBoxes()).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: /Login with password/i }),
    ).toBeInTheDocument();
  });

  it("puts BOTH on screen when both exist, with the PIN as the primary action", () => {
    pinStore.set(EMAIL, { device_id: "d1", label: "This laptop" });
    passkeyDeviceStore.set(EMAIL);
    renderModal();

    expect(orb()).toBeInTheDocument();
    expect(pinBoxes()).toHaveLength(4);
    // The specified priority: the PIN is the 4-tap route, so it owns the
    // submit button; the orb is an equal alternative one tap above it.
    expect(
      screen.getByRole("button", { name: /Sign in with PIN/i }),
    ).toBeInTheDocument();
  });

  it("falls back to the password field when the device holds neither", () => {
    renderModal();

    expect(orb()).not.toBeInTheDocument();
    expect(pinBoxes()).toHaveLength(0);
    // No greeting-only dead end: with no quick route the password IS the door.
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("does not offer the password field while a quick route is showing", async () => {
    const user = userEvent.setup();
    pinStore.set(EMAIL, { device_id: "d1", label: "This laptop" });
    renderModal();

    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    // …but one click brings it back for the person whose PIN was revoked from
    // another session. The door is never actually locked.
    await user.click(
      screen.getByRole("button", { name: /Login with password/i }),
    );
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("never asks for the email address it already knows", () => {
    pinStore.set(EMAIL, { device_id: "d1", label: "This laptop" });
    renderModal();

    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("shows no greeting and no quick routes on a device that knows nobody", () => {
    localStorage.clear();
    renderModal();

    expect(screen.queryByText(/Welcome back Ama/)).not.toBeInTheDocument();
    expect(orb()).not.toBeInTheDocument();
    expect(pinBoxes()).toHaveLength(0);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });
});

describe("LoginModal — the quick routes are wired to the right ceremonies", () => {
  beforeEach(() => {
    localStorage.clear();
    passkeyLoginMock.mockClear();
    pinLoginMock.mockClear();
    lastSessionStore.set({
      email: EMAIL,
      display_name: "Ama Nkeng",
      avatar_url: null,
    });
  });

  it("the orb runs the passkey ceremony for the stored account", async () => {
    const user = userEvent.setup();
    passkeyDeviceStore.set(EMAIL);
    renderModal();

    await user.click(orb() as HTMLElement);

    // Scoped to the remembered identity, not to an email field that is not on
    // screen — the ceremony must assert against the right account's credentials.
    expect(passkeyLoginMock).toHaveBeenCalledWith(EMAIL);
  });

  /**
   * The fourth digit signs you in — and that was a LIVE BUG until this test.
   *
   * `PinInput` fires `onChange(joined)` and `onComplete(joined)` in the same
   * tick, so the old `onComplete={() => onPin()}` read a `pin` state that still
   * held three digits, decided the PIN was too short, and replaced the sign-in
   * with "PIN must be 4 digits." while four digits sat on screen. Only the
   * button worked, which is why nobody noticed: anyone who presses the button is
   * unaffected, and the people who wait for the auto-submit had a plausible
   * error message to explain it away.
   */
  it("signs in on the fourth digit, without waiting for the button", async () => {
    const user = userEvent.setup();
    pinStore.set(EMAIL, { device_id: "d1", label: "This laptop" });
    renderModal();

    // `keyboard`, not `type`: `type` keeps sending to the element it was given,
    // while the boxes auto-advance focus after each digit — so all four would
    // land in box one and the PIN would never complete.
    await user.click(pinBoxes()[0]);
    await user.keyboard("1234");

    expect(pinLoginMock).toHaveBeenCalledWith(EMAIL, "1234");
    // …and no "PIN must be 4 digits." underneath a complete PIN.
    expect(screen.queryByText(/PIN must be/)).not.toBeInTheDocument();
  });

  /**
   * The device's claim can be wrong — a key deleted from the OS keychain, a
   * restored laptop, a credential revoked from another session. When the
   * server says there is nothing to match, the orb has to GO, or the next
   * visit leads with a button that cannot work. This is the one case where the
   * registry is corrected by a failure.
   */
  it("retires the orb when the server says there is no passkey after all", async () => {
    const user = userEvent.setup();
    passkeyDeviceStore.set(EMAIL);
    passkeyLoginMock.mockRejectedValueOnce(
      Object.assign(new Error("No passkey found for that account"), {
        code: "PASSKEY_NOT_FOUND",
      }),
    );
    renderModal();

    await user.click(orb() as HTMLElement);

    expect(
      await screen.findByText(/No passkey found for that account/i),
    ).toBeInTheDocument();
    expect(passkeyDeviceStore.get(EMAIL)).toBe(false);
    expect(orb()).not.toBeInTheDocument();
  });

  /**
   * A dismissed Touch ID sheet is an ANSWER, not a fault. It says nothing about
   * whether the credential exists, so the orb must stay exactly where it is.
   */
  it("keeps the orb when the ceremony is merely cancelled", async () => {
    const user = userEvent.setup();
    passkeyDeviceStore.set(EMAIL);
    passkeyLoginMock.mockRejectedValueOnce(
      Object.assign(new Error("cancelled"), {
        name: "NotAllowedError",
        code: "NOT_ALLOWED",
      }),
    );
    renderModal();

    await user.click(orb() as HTMLElement);

    expect(
      await screen.findByRole("button", { name: /passkey/i }),
    ).toBeInTheDocument();
    expect(passkeyDeviceStore.get(EMAIL)).toBe(true);
  });
});
