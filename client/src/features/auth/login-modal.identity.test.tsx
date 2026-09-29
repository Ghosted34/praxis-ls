/**
 * The identity-first sign-in: which credential the device leads with.
 *
 * ── THE RULE, as the owner specified it ─────────────────────────────────────
 *
 *   The device remembers whose it is, and leads with the best route the
 *   person has HERE:
 *
 *     a passkey that lives here   → the fingerprint orb (primary)
 *     otherwise their Quick PIN   → the PIN boxes — one PIN per person, valid
 *                                   on every device (14230)
 *     otherwise                   → the password
 *
 *   The others stay one tap away ("Use passkey", "Use PIN", "Use password"),
 *   because a credential can be revoked from another session and the person at
 *   the machine must always have a way in.
 *
 * Both halves of each answer are pinned. The orb LEADS only where this device
 * knows it holds a passkey; the passkey is still OFFERED on any device with its
 * own authenticator, because the browser can erase its record of a passkey
 * that is still in the OS keychain. The PIN appears wherever the ACCOUNT has
 * one, and nowhere it does not.
 *
 * ── AUTO-PROMPT ─────────────────────────────────────────────────────────────
 *
 * The passkey is "the primary means of connection", so the ceremony starts by
 * itself when the window has focus. jsdom reports no focus, which keeps every
 * test below click-driven except the one that grants focus on purpose.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "@/lib/api-client";
import { lastSessionStore } from "@/lib/last-session";
import { passkeyDeviceStore } from "@/lib/passkey-devices";
import { passkeyOfferStore } from "@/lib/passkey-offer";

const passkeyLoginMock = vi.fn(async (_email?: string) => {});
const pinLoginMock = vi.fn(async (_email: string, _pin: string) => ({ pending2fa: false }));
const recallDeviceMock = vi.fn(async () => null as unknown);
const platformMock = vi.fn(async () => true);
const loginMock = vi.fn(async (_email: string, _password: string) => ({ pending2fa: false }));
const registerPasskeyMock = vi.fn(async () => ({ credential_id: "new-cred" }));

vi.mock("@/app/auth/auth-context", () => ({
  useAuth: () => ({
    login: loginMock,
    verify2fa: vi.fn(),
    pinLogin: pinLoginMock,
    passkeyLogin: passkeyLoginMock,
  }),
}));

vi.mock("@/lib/device-memory", () => ({
  recallDevice: () => recallDeviceMock(),
  keepDeviceStorage: vi.fn(async () => {}),
}));

vi.mock("@/lib/webauthn", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webauthn")>("@/lib/webauthn");
  return {
    ...actual,
    registerPasskey: () => registerPasskeyMock(),
    // The real probe caches its answer for the page's life; a test that needs a
    // device WITHOUT an authenticator sets this instead.
    platformAuthenticatorAvailable: () => platformMock(),
  };
});

vi.mock("@/app/branding/branding-context", () => ({
  useBranding: () => ({
    branding: { name: "Acme Freight", primary: "#1188ff", primaryForeground: "#fff", logoUrl: null },
    setBranding: vi.fn(),
    ready: true,
  }),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

import { LoginModal } from "./login-modal";

const EMAIL = "ama@acme.cm";

function renderModal() {
  return render(
    <MemoryRouter>
      <LoginModal onClose={() => {}} />
    </MemoryRouter>,
  );
}

/** The passkey orb, by the name a screen reader hears. */
const orb = () => screen.queryByRole("button", { name: /with your passkey/i });
/** `PinInput` names each box "PIN digit N". */
const pinBoxes = () => screen.queryAllByLabelText(/^PIN digit /);

/** The account has a Quick PIN — which is all it takes, on any device. */
const withPin = () =>
  lastSessionStore.set({ email: EMAIL, display_name: "Ama Nkeng", avatar_url: null, has_quick_pin: true });
/** The alternative that offers the passkey without leading with it. */
const usePasskey = () => screen.queryByRole("button", { name: /^Use (Touch ID|passkey|Face ID|Windows Hello)/ });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  recallDeviceMock.mockReset();
  recallDeviceMock.mockResolvedValue(null);
  platformMock.mockReset();
  platformMock.mockResolvedValue(true);
  passkeyLoginMock.mockReset();
  passkeyLoginMock.mockResolvedValue(undefined);
  pinLoginMock.mockReset();
  pinLoginMock.mockResolvedValue({ pending2fa: false });
  loginMock.mockClear();
  registerPasskeyMock.mockClear();
  navigateMock.mockClear();
  // A browser with passkey support and a platform authenticator (Touch ID &c.).
  vi.stubGlobal(
    "PublicKeyCredential",
    Object.assign(function PublicKeyCredential() {}, {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    }),
  );
  lastSessionStore.set({ email: EMAIL, display_name: "Ama Nkeng", avatar_url: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SignInPanel — the device leads with the best route it can complete", () => {
  it("greets the stored account by name and never asks for its email", () => {
    renderModal();
    expect(screen.getByRole("heading", { name: "Welcome back, Ama" })).toBeInTheDocument();
    expect(screen.getByText("Ama Nkeng")).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("leads with the passkey when this device holds one — even when the account also has a PIN", () => {
    passkeyDeviceStore.add(EMAIL, "cred-1");
    withPin();
    renderModal();

    expect(orb()).toBeInTheDocument();
    // The PIN and the password are one tap away, not on screen competing.
    expect(pinBoxes()).toHaveLength(0);
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use PIN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use password" })).toBeInTheDocument();
  });

  it("offers the account's PIN on a device where it was never set up — one PIN, every device", () => {
    withPin();
    renderModal();

    expect(pinBoxes()).toHaveLength(4);
    expect(screen.getByText(/Works on any device/)).toBeInTheDocument();
    // No orb: this device has no record of a passkey…
    expect(orb()).not.toBeInTheDocument();
    // …but the passkey is one tap away, because the record can be erased while
    // the passkey itself is still in the keychain.
    expect(usePasskey()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use password" })).toBeInTheDocument();
  });

  it("offers no PIN for an account that has none", () => {
    renderModal();
    expect(pinBoxes()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Use PIN" })).not.toBeInTheDocument();
  });

  it("offers no passkey at all on a device without an authenticator of its own", async () => {
    platformMock.mockResolvedValue(false);
    renderModal();
    await waitFor(() => expect(usePasskey()).not.toBeInTheDocument());
  });

  it("falls back to the password when the device holds neither", () => {
    renderModal();
    expect(orb()).not.toBeInTheDocument();
    expect(pinBoxes()).toHaveLength(0);
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("switches route on request, and the PIN then leads", async () => {
    const user = userEvent.setup();
    passkeyDeviceStore.add(EMAIL, "cred-1");
    withPin();
    renderModal();

    await user.click(screen.getByRole("button", { name: "Use PIN" }));
    expect(pinBoxes()).toHaveLength(4);
    expect(orb()).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use password" }));
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("offers tabs and a device passkey on a device that knows nobody", () => {
    localStorage.clear();
    renderModal();

    expect(screen.queryByText(/Welcome back,/)).not.toBeInTheDocument();
    expect(orb()).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in with a passkey/i })).toBeInTheDocument();
  });

  it("greets its person again after the browser erased its own storage — the server remembers the device", async () => {
    localStorage.clear();
    recallDeviceMock.mockImplementation(async () => {
      // What device-memory's recallDevice does with GET /auth/device.
      lastSessionStore.set({ email: EMAIL, display_name: "Ama Nkeng", avatar_url: null, has_quick_pin: true });
      passkeyDeviceStore.add(EMAIL, "cred-1");
      return { email: EMAIL, display_name: "Ama Nkeng", has_quick_pin: true, passkeys: ["cred-1"] };
    });
    renderModal();

    expect(await screen.findByRole("heading", { name: "Welcome back, Ama" })).toBeInTheDocument();
    expect(orb()).toBeInTheDocument();
  });
});

describe("SignInPanel — each route runs the right ceremony", () => {
  it("the orb runs the passkey ceremony for the stored account", async () => {
    const user = userEvent.setup();
    passkeyDeviceStore.add(EMAIL, "cred-1");
    renderModal();

    await user.click(orb() as HTMLElement);
    expect(passkeyLoginMock).toHaveBeenCalledWith(EMAIL);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("starts the passkey by itself when the window has focus — the primary means of connection", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    passkeyDeviceStore.add(EMAIL, "cred-1");
    renderModal();

    await waitFor(() => expect(passkeyLoginMock).toHaveBeenCalledWith(EMAIL));
    expect(passkeyLoginMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The fourth digit signs you in. `PinInput` fires onChange and onComplete in
   * the same tick; reading `pin` state there once answered a complete PIN with
   * "PIN must be 4 digits.".
   */
  it("signs in on the fourth digit, without waiting for the button", async () => {
    const user = userEvent.setup();
    withPin();
    renderModal();

    await user.click(pinBoxes()[0]);
    await user.keyboard("4817");

    expect(pinLoginMock).toHaveBeenCalledWith(EMAIL, "4817");
    expect(screen.queryByText(/PIN must be/)).not.toBeInTheDocument();
  });

  it("asks for the authenticator code after the PIN on an account that has one", async () => {
    const user = userEvent.setup();
    withPin();
    pinLoginMock.mockResolvedValueOnce({ pending2fa: true });
    renderModal();

    await user.click(pinBoxes()[0]);
    await user.keyboard("4817");

    expect(await screen.findByRole("heading", { name: "Two-step verification" })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("moves to the password when the account's PIN has been switched off", async () => {
    const user = userEvent.setup();
    withPin();
    pinLoginMock.mockImplementationOnce(async () => {
      throw new ApiError("PIN_LOCKED", "Too many wrong PINs — your Quick PIN is now off. Sign in with your password, then set a new one.", 401);
    });
    renderModal();

    await user.click(pinBoxes()[0]);
    await user.keyboard("4817");

    expect(await screen.findByText(/your Quick PIN is now off/)).toBeInTheDocument();
    expect(pinBoxes()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Use PIN" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("runs the passkey for a device that has lost its record of one — the keychain still has it", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(usePasskey() as HTMLElement);
    await user.click(orb() as HTMLElement);

    // Bound to the account on screen, with no ids to scope to: the OS offers
    // what its keychain holds for this workspace.
    expect(passkeyLoginMock).toHaveBeenCalledWith(EMAIL);
  });

  it("stops leading with a passkey the account no longer holds", async () => {
    const user = userEvent.setup();
    passkeyDeviceStore.add(EMAIL, "cred-1");
    passkeyLoginMock.mockImplementationOnce(async () => {
      passkeyDeviceStore.forgetId(EMAIL, "cred-1");
      throw new ApiError(
        "PASSKEY_REVOKED",
        "This device's passkey is no longer registered to your account. Sign in another way, then set it up again.",
        400,
      );
    });
    renderModal();

    await user.click(orb() as HTMLElement);

    expect(await screen.findByText(/no longer registered to your account/i)).toBeInTheDocument();
    expect(orb()).not.toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("keeps the orb, silently, when the ceremony is merely cancelled", async () => {
    const user = userEvent.setup();
    passkeyDeviceStore.add(EMAIL, "cred-1");
    passkeyLoginMock.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "NotAllowedError", code: "NOT_ALLOWED" }));
    renderModal();

    await user.click(orb() as HTMLElement);

    await waitFor(() => expect(orb()).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(passkeyDeviceStore.get(EMAIL)).toBe(true);
  });
});

describe("SignInPanel — urging a passkey after a PIN or password sign-in", () => {
  it("offers this device a passkey right after signing in, and 'Not now' snoozes it", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /^Sign in$/ }));

    expect(await screen.findByRole("heading", { name: "One touch next time" })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
    expect(passkeyOfferStore.declined(EMAIL)).toBe(true);
  });

  it("sets the passkey up on the spot", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /^Sign in$/ }));
    await user.click(await screen.findByRole("button", { name: /^Set up/ }));

    expect(registerPasskeyMock).toHaveBeenCalled();
    await waitFor(() => expect(navigateMock).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("does not ask again while 'Not now' is snoozed on this device", async () => {
    const user = userEvent.setup();
    passkeyOfferStore.decline(EMAIL);
    renderModal();

    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /^Sign in$/ }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/", { replace: true }));
    expect(screen.queryByRole("heading", { name: "One touch next time" })).not.toBeInTheDocument();
  });
});
