/**
 * Sign out, and the question the device now has to ask.
 *
 * The device stores the account it belongs to, so signing out no longer means
 * the machine forgets you. On a personal phone that is the feature; on a shared
 * workstation it is the hazard, and the two people involved want opposite
 * things from the same menu item. The dialog asks, once, at the only moment
 * anyone knows the answer.
 *
 * What these pin:
 *   · three answers, and the plain sign-out is the default-looking one, because
 *     it is what almost everybody wants and it is the reversible choice;
 *   · "remove this account" runs the OTHER handler — a dialog whose second
 *     button silently does the same thing as its first is worse than no dialog,
 *     since it collects a decision and discards it;
 *   · cancelling runs neither, and the destructive-ish option is not where a
 *     stray double-click lands.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/lib/i18n";
import { SignOutDialog } from "./sign-out-dialog";

const EMAIL = "ama@acme.cm";

function setup(open = true) {
  const onSignOut = vi.fn();
  const onSignOutAndForget = vi.fn();
  const onClose = vi.fn();
  render(
    <SignOutDialog
      open={open}
      onClose={onClose}
      onSignOut={onSignOut}
      onSignOutAndForget={onSignOutAndForget}
      email={EMAIL}
    />,
  );
  return { onSignOut, onSignOutAndForget, onClose };
}

describe("SignOutDialog", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("names the account whose device memory is at stake", () => {
    setup();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText(/Remembered on this device/i)).toBeInTheDocument();
  });

  it("offers the plain sign-out as the primary action", () => {
    setup();
    const keep = screen.getByRole("button", { name: "Sign out" });
    // Not a destructive control: keeping the identity is the ordinary case.
    expect(keep.className).toMatch(/bg-primary/);
    expect(
      screen.getByRole("button", { name: "Stay signed in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove this account/i }),
    ).toBeInTheDocument();
  });

  it("signs out without forgetting the device", async () => {
    const user = userEvent.setup();
    const { onSignOut, onSignOutAndForget } = setup();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onSignOutAndForget).not.toHaveBeenCalled();
  });

  it("removes the account from the device when that is the answer chosen", async () => {
    const user = userEvent.setup();
    const { onSignOut, onSignOutAndForget } = setup();

    await user.click(
      screen.getByRole("button", { name: /remove this account/i }),
    );

    expect(onSignOutAndForget).toHaveBeenCalledTimes(1);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("stays signed in when the question is dismissed", async () => {
    const user = userEvent.setup();
    const { onSignOut, onSignOutAndForget, onClose } = setup();

    await user.click(screen.getByRole("button", { name: "Stay signed in" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSignOut).not.toHaveBeenCalled();
    expect(onSignOutAndForget).not.toHaveBeenCalled();
  });

  it("says what each choice will mean for the next person", () => {
    setup();
    // The copy is the only place the difference is explained. If it stops
    // matching the handlers, this is where it shows up.
    expect(
      screen.getByText(/Keeps your account on this device/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The next person gets a blank sign-in form/i),
    ).toBeInTheDocument();
  });

  it("does not render while closed", () => {
    setup(false);
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
  });
});
