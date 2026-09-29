/**
 * Sign out — one confirm, and the device forgets nothing.
 *
 * What these pin:
 *   · there is ONE way out of the dialog that signs out, and no checkbox or
 *     second handler that could make the device forget its person or their
 *     passkey (owner decision, 29 Sep 2026: only removing the passkey in My
 *     security takes it off a device);
 *   · the dialog says so, so nobody signs out expecting to be forgotten;
 *   · cancelling signs nobody out.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/lib/i18n";
import { SignOutDialog } from "./sign-out-dialog";

const EMAIL = "ama@acme.cm";

function setup(open = true) {
  const onSignOut = vi.fn();
  const onClose = vi.fn();
  render(<SignOutDialog open={open} onClose={onClose} onSignOut={onSignOut} email={EMAIL} />);
  return { onSignOut, onClose };
}

describe("SignOutDialog", () => {
  it("names the account being signed out", () => {
    setup();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
  });

  it("offers no way to make the device forget — no checkbox at all", () => {
    setup();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("says the device still knows you and your passkey stays", () => {
    setup();
    expect(screen.getByText(/your passkey stays on it/i)).toBeInTheDocument();
  });

  it("signs out on the one button", async () => {
    const user = userEvent.setup();
    const { onSignOut } = setup();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("stays signed in when cancelled", async () => {
    const user = userEvent.setup();
    const { onSignOut, onClose } = setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("does not render while closed", () => {
    setup(false);
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });
});
