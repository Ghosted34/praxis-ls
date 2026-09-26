/**
 * The sign-in email field, and the device that remembers whose it is.
 *
 * ── THE DEFECT THIS FILE WAS BORN FROM ──────────────────────────────────────
 *
 * The modal prefills the address of the last successful sign-in. To type a
 * DIFFERENT one you clear the field first, and clearing it did not work: the
 * moment the final character went, the whole remembered address came back. The
 * sync effect could not tell "the user is deleting this" from "the prefill has
 * not happened yet":
 *
 *     if (lastSession?.email && !email) setEmail(lastSession.email);
 *
 * Backspace on the last character re-filled it, and "Use another account" —
 * whose entire job was `setEmail("")` — was undone in the same commit. On a
 * shared machine the app was effectively locked to whoever signed in last.
 *
 * ── HOW IT IS FIXED, AND WHAT THAT DID TO THIS FILE ─────────────────────────
 *
 * Not by making the effect smarter: by REMOVING the email field from the
 * device that remembers someone. The identity screen knows the account and does
 * not ask for it, so there is no longer any state where a prefilled address and
 * an editable field exist at the same time — the refill has nowhere to happen.
 * Changing account is now an explicit act ("Not you? Switch account"), which
 * clears the device's memory and hands over an empty, focused field.
 *
 * So the original assertion — "backspace the last character and the value stays
 * gone" — is now covered by the second test below, and the ones after it walk
 * the path a real person takes to sign in as somebody else. If a refill effect
 * ever comes back alongside an editable prefilled field, these fail.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { lastSessionStore } from "@/lib/last-session";
import { pinStore } from "@/lib/pin-store";

/** Declared with the real signature, so the assertions below are typed against
 *  the arguments the modal actually passes rather than against `any`. */
const loginMock = vi.fn<
  (email: string, password: string) => Promise<{ pending2fa: boolean }>
>(async () => ({ pending2fa: false }));

// Faked, not wrapped: the modal's own behaviour is what is under test here, and
// the real provider fetches /branding before it will render children.
vi.mock("@/app/auth/auth-context", () => ({
  useAuth: () => ({
    login: loginMock,
    verify2fa: vi.fn(),
    pinLogin: vi.fn(),
    passkeyLogin: vi.fn(),
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

const REMEMBERED = "ama@acme.cm";

function renderModal() {
  return render(
    <MemoryRouter>
      <LoginModal onClose={() => {}} />
    </MemoryRouter>,
  );
}

/** The email control, found by its label — the way a user finds it. */
function emailField(): HTMLInputElement {
  return screen.getByLabelText("Email") as HTMLInputElement;
}

/** Backspace the field empty, one character at a time.
 *
 *  One at a time is the point: the reported symptom is about the LAST
 *  keystroke, and `user.clear()` would collapse the sequence and could pass
 *  against code that repopulates only on shorter inputs. */
async function backspaceToEmpty(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLInputElement,
) {
  await user.click(input);
  await user.keyboard("{End}");
  // Length captured up front: the value shrinks as this runs, so reading it in
  // the loop condition would stop half way and quietly change what is asserted.
  const length = input.value.length;
  for (let i = 0; i < length; i++) {
    await user.keyboard("{Backspace}");
  }
}

describe("LoginModal — typing an address on a device that knows nobody", () => {
  beforeEach(() => {
    localStorage.clear();
    loginMock.mockClear();
  });

  it("has an empty, editable email field and no greeting", () => {
    renderModal();
    expect(emailField()).toHaveValue("");
    expect(screen.queryByText(/Welcome back /)).not.toBeInTheDocument();
  });

  it("keeps the field empty when the last character is deleted", async () => {
    const user = userEvent.setup();
    renderModal();

    const input = emailField();
    await user.type(input, "kofi@other.cm");
    await backspaceToEmpty(user, input);

    // The original failure mode: the last backspace restored the whole address.
    expect(input).toHaveValue("");
  });

  it("accepts a different address afterwards", async () => {
    const user = userEvent.setup();
    renderModal();

    const input = emailField();
    await user.type(input, "typo@acme.cm");
    await backspaceToEmpty(user, input);
    await user.type(input, "kofi@other.cm");

    expect(input).toHaveValue("kofi@other.cm");
  });
});

describe("LoginModal — changing account on a device that remembers someone", () => {
  beforeEach(() => {
    localStorage.clear();
    loginMock.mockClear();
    loginMock.mockImplementation(async (email: string) => {
      // What auth-context's login does on success, and the only reason the
      // greeting can move to a different person.
      lastSessionStore.set({
        email,
        display_name: "Kofi Mensah",
        avatar_url: null,
      });
      return { pending2fa: false };
    });
    lastSessionStore.set({
      email: REMEMBERED,
      display_name: "Ama Nkeng",
      avatar_url: null,
    });
    pinStore.set(REMEMBERED, { device_id: "d-ama", label: "This laptop" });
  });

  it("does not render an email field at all while the device knows you", () => {
    renderModal();

    // The field is not merely read-only — it is absent, which is why the old
    // refill cannot recur: there is nothing for a sync effect to write into.
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.getByText(REMEMBERED)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Welcome back, Ama/ }),
    ).toBeInTheDocument();
  });

  it("'Switch account' releases the device, then hands over an empty focused field", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(
      screen.getByRole("button", { name: "Not you? Switch account" }),
    );

    const input = emailField();
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    // The greeting goes with the identity it belonged to.
    expect(
      screen.queryByText(/Welcome back, Ama/),
    ).not.toBeInTheDocument();
    // Released for real, not just hidden: a reopen must not re-greet.
    expect(lastSessionStore.get()).toBeNull();
  });

  it("is still released after the modal is reopened", async () => {
    const user = userEvent.setup();
    const first = renderModal();

    await user.click(
      screen.getByRole("button", { name: "Not you? Switch account" }),
    );
    first.unmount();

    // The release has to be in the STORE, not in component state — otherwise a
    // reload, or simply closing and reopening the modal, would greet the person
    // who just said they were somebody else.
    expect(lastSessionStore.get()).toBeNull();
    renderModal();
    expect(
      screen.queryByText(/Welcome back, Ama/),
    ).not.toBeInTheDocument();
  });

  it("signing in as somebody else moves the device memory to them", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(
      screen.getByRole("button", { name: "Not you? Switch account" }),
    );
    await user.type(emailField(), "kofi@other.cm");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /^Sign in$/ }));

    // No "keep me signed in" any more: every session ends at two hours.
    expect(loginMock).toHaveBeenCalledWith("kofi@other.cm", "correct horse");
    // The device now belongs to Kofi — not to Ama, and not to nobody.
    expect(lastSessionStore.get()?.email).toBe("kofi@other.cm");
  });

  it("leaves the previous owner's Quick PIN alone", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(
      screen.getByRole("button", { name: "Not you? Switch account" }),
    );

    // Switching account says "not me", not "destroy my credentials". Ama's PIN
    // record is keyed by her email and survives, so signing back in is still
    // fast. Destroying it is the other exit — "Sign out and remove this
    // account" in the shell.
    expect(pinStore.get(REMEMBERED)).toMatchObject({ device_id: "d-ama" });
  });
});
