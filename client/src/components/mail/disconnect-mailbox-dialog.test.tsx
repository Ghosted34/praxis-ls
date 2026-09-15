/**
 * The disconnect confirmation is the one sentence in the mail setup screens a
 * person MUST read before answering, which is why it stopped being a
 * `window.confirm`. These tests pin the two properties that move was for: it
 * is the product's own dialog (branded, named action, warning tone), and it is
 * still not answerable by clicking away.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DisconnectMailboxDialog } from "./disconnect-mailbox-dialog";

describe("DisconnectMailboxDialog", () => {
  const open = (over: Partial<React.ComponentProps<typeof DisconnectMailboxDialog>> = {}) => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DisconnectMailboxDialog
        open
        address="ops@acme.cm"
        onClose={onClose}
        onConfirm={onConfirm}
        {...over}
      />,
    );
    return { onClose, onConfirm };
  };

  it("names the address and both consequences", () => {
    open();
    expect(screen.getByText("ops@acme.cm")).toBeInTheDocument();
    expect(screen.getByText("New mail stops arriving.")).toBeInTheDocument();
    expect(screen.getByText("The saved password is deleted.")).toBeInTheDocument();
  });

  it("names the action on its buttons rather than OK/Cancel", () => {
    open();
    expect(screen.getByRole("button", { name: "Disconnect mailbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep it connected" })).toBeInTheDocument();
  });

  it("cannot be answered by pressing Escape", () => {
    const { onClose } = open();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel and confirm still work", () => {
    const { onClose, onConfirm } = open();
    fireEvent.click(screen.getByRole("button", { name: "Keep it connected" }));
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect mailbox" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("disables both buttons while the disconnect is running", () => {
    open({ busy: true });
    expect(screen.getByRole("button", { name: "Keep it connected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  });
});
