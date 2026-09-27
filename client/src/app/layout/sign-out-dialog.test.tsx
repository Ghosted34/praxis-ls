/**
 * Sign out, and the one question the device now has to ask.
 *
 * What these pin:
 *   · "Remember me on this device" starts ticked, so one click on Sign out is
 *     the plain, reversible sign-out;
 *   · unticking it makes the same button run the OTHER handler — a checkbox
 *     that collects a decision and discards it is worse than no checkbox;
 *   · the tick comes back on every opening, so one person's shared-PC choice
 *     does not leak into the next person's sign-out;
 *   · cancelling runs neither.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/lib/i18n";
import { SignOutDialog } from "./sign-out-dialog";

const EMAIL = "ama@acme.cm";

function setup(open = true) {
  const onSignOut = vi.fn();
  const onSignOutAndForget = vi.fn();
  const onClose = vi.fn();
  const ui = (o: boolean) => (
    <SignOutDialog
      open={o}
      onClose={onClose}
      onSignOut={onSignOut}
      onSignOutAndForget={onSignOutAndForget}
      email={EMAIL}
    />
  );
  const { rerender } = render(ui(open));
  return {
    onSignOut,
    onSignOutAndForget,
    onClose,
    reopen: () => {
      rerender(ui(false));
      rerender(ui(true));
    },
  };
}

const remember = () =>
  screen.getByRole("checkbox", { name: /remember me on this device/i });

describe("SignOutDialog", () => {
  it("names the account being signed out", () => {
    setup();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
  });

  it("starts with 'remember me' ticked", () => {
    setup();
    expect(remember()).toBeChecked();
  });

  it("signs out without forgetting the device by default", async () => {
    const user = userEvent.setup();
    const { onSignOut, onSignOutAndForget } = setup();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onSignOutAndForget).not.toHaveBeenCalled();
  });

  it("forgets the account when 'remember me' is unticked", async () => {
    const user = userEvent.setup();
    const { onSignOut, onSignOutAndForget } = setup();

    await user.click(remember());
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOutAndForget).toHaveBeenCalledTimes(1);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("re-ticks 'remember me' every time it opens", async () => {
    const user = userEvent.setup();
    const { reopen } = setup();

    await user.click(remember());
    expect(remember()).not.toBeChecked();
    reopen();
    expect(remember()).toBeChecked();
  });

  it("stays signed in when cancelled", async () => {
    const user = userEvent.setup();
    const { onSignOut, onSignOutAndForget, onClose } = setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSignOut).not.toHaveBeenCalled();
    expect(onSignOutAndForget).not.toHaveBeenCalled();
  });

  it("does not render while closed", () => {
    setup(false);
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
  });
});
