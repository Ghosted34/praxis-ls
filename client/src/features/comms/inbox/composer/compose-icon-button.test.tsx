/**
 * The 360 mail-icon shim.
 *
 * It is deliberately thin — a button that opens NewMessageDialog, the ONLY
 * compose wrapper in the product — so the tests pin exactly that: the icon is
 * a real named button, clicking it opens the wrapper, and the prefill it was
 * handed (address, record link) arrives there intact.
 *
 * NewMessageDialog itself is stubbed here; its own decisions (mailbox picking,
 * the "no mailbox connected" callout) are covered by new-message.integration.test.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** What the shim handed to NewMessageDialog on its last render. */
const seen = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));

vi.mock("./new-message", () => ({
  NewMessageDialog: (props: Record<string, unknown>) => {
    seen.props = props;
    return <div data-testid="new-message-dialog" data-open={String(props.open)} />;
  },
}));

import { ComposeIconButton } from "./compose-icon-button";

describe("the 360 mail-icon shim", () => {
  it("renders a real button named for what it does", () => {
    render(<ComposeIconButton />);
    const btn = screen.getByRole("button", { name: "Compose email" });
    expect(btn).toHaveAttribute("title", "Compose email");
  });

  it("opens nothing until it is clicked", () => {
    render(<ComposeIconButton to="ada@company.cm" />);
    expect(screen.queryByTestId("new-message-dialog")).not.toBeInTheDocument();
  });

  it("clicking opens NewMessageDialog", async () => {
    render(<ComposeIconButton to="ada@company.cm" />);
    await userEvent.click(screen.getByRole("button", { name: "Compose email" }));
    const dialog = screen.getByTestId("new-message-dialog");
    expect(dialog).toHaveAttribute("data-open", "true");
  });

  it("PASSES `to` THROUGH AS A ONE-ELEMENT ARRAY — the wrapper speaks string[]", async () => {
    render(<ComposeIconButton to="ada@company.cm" />);
    await userEvent.click(screen.getByRole("button", { name: "Compose email" }));
    expect(seen.props?.to).toEqual(["ada@company.cm"]);
  });

  it("forwards the record the mail belongs to", async () => {
    render(<ComposeIconButton to="ada@company.cm" entityRef="employee:e-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Compose email" }));
    expect(seen.props?.entityRef).toBe("employee:e-1");
  });

  it("defaults to an unaddressed message filed to nothing", async () => {
    render(<ComposeIconButton />);
    await userEvent.click(screen.getByRole("button", { name: "Compose email" }));
    expect(seen.props?.to).toEqual([]);
    expect(seen.props?.entityRef).toBeNull();
  });

  it("CLOSES AGAIN WHEN THE WRAPPER SAYS IT CLOSED", async () => {
    render(<ComposeIconButton to="ada@company.cm" />);
    await userEvent.click(screen.getByRole("button", { name: "Compose email" }));
    expect(screen.getByTestId("new-message-dialog")).toBeInTheDocument();
    // The wrapper calls onClose when the operator cancels or has sent.
    await act(async () => {
      (seen.props?.onClose as () => void)();
    });
    expect(screen.queryByTestId("new-message-dialog")).not.toBeInTheDocument();
  });
});
