/**
 * useConfirm / usePrompt.
 *
 * These two hooks replaced 25 native dialogs across the client, so their
 * contract is load-bearing in a way a normal component's is not: a bug in the
 * promise plumbing does not look like a broken dialog, it looks like a button
 * in HR or Settings that silently does nothing. The cases below are the ones
 * that would produce exactly that.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useConfirm } from "./use-confirm";
import { usePrompt } from "./use-prompt";

function ConfirmHarness({
  onResult,
  destructive = true,
}: {
  onResult: (v: boolean) => void;
  destructive?: boolean;
}) {
  const [confirm, dialog] = useConfirm();
  return (
    <>
      {dialog}
      <button
        onClick={async () =>
          onResult(
            await confirm({
              title: "Delete this conversation for ever?",
              body: "This cannot be undone.",
              confirmLabel: "Delete conversation",
              cancelLabel: "Keep it",
              destructive,
            }),
          )
        }
      >
        Delete
      </button>
    </>
  );
}

describe("useConfirm", () => {
  it("shows nothing until asked", () => {
    render(<ConfirmHarness onResult={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("resolves true when the named action is pressed", async () => {
    const onResult = vi.fn();
    render(<ConfirmHarness onResult={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Delete this conversation for ever?"),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete conversation" }),
    );
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("resolves false when cancelled — never leaves the promise hanging", async () => {
    const onResult = vi.fn();
    render(<ConfirmHarness onResult={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Keep it",
      }),
    );
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  /*
   * The property `window.confirm` had that an ordinary modal does not. For
   * "delete for ever" a stray click on the backdrop must not be an answer.
   */
  it("a destructive confirm is not dismissed by Escape", async () => {
    const onResult = vi.fn();
    render(<ConfirmHarness onResult={onResult} destructive />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("a non-destructive confirm IS dismissible, and dismissal means no", async () => {
    const onResult = vi.fn();
    render(<ConfirmHarness onResult={onResult} destructive={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  /*
   * If the host unmounts with a confirm open, the awaiting async function must
   * not be stranded — that is the failure that looks like "the button does
   * nothing" long after the dialog is gone.
   */
  it("resolves false if the component unmounts while open", async () => {
    const onResult = vi.fn();
    const { unmount } = render(<ConfirmHarness onResult={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog");
    unmount();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});

function PromptHarness({ onResult }: { onResult: (v: string | null) => void }) {
  const [prompt, dialog] = usePrompt();
  return (
    <>
      {dialog}
      <button
        onClick={async () =>
          onResult(
            await prompt({
              title: "Priced at or below cost",
              label: "Justification",
              hint: "At least 10 characters.",
              multiline: true,
              confirmLabel: "Submit for approval",
              validate: (v) =>
                v.trim().length < 10 ? "At least 10 characters." : null,
            }),
          )
        }
      >
        Submit
      </button>
    </>
  );
}

describe("usePrompt", () => {
  it("labels the field — the thing window.prompt could not do", async () => {
    render(<PromptHarness onResult={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByRole("dialog");
    // Associated by <Field>, so this resolves by accessible name.
    expect(screen.getByLabelText(/Justification/)).toBeInTheDocument();
  });

  /*
   * The whole point of the conversion at margin-simulations: the 10-character
   * rule used to be enforced AFTER the prompt, by rejecting the submission and
   * discarding it. Now the dialog will not accept a value it would refuse.
   */
  it("blocks submission while the value is invalid", async () => {
    const onResult = vi.fn();
    render(<PromptHarness onResult={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    const dialog = await screen.findByRole("dialog");

    const go = within(dialog).getByRole("button", { name: "Submit for approval" });
    expect(go).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Justification/), "too short");
    expect(go).toBeDisabled();
    expect(onResult).not.toHaveBeenCalled();

    await userEvent.type(
      screen.getByLabelText(/Justification/),
      " but now it is long enough",
    );
    expect(go).toBeEnabled();
    await userEvent.click(go);
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        "too short but now it is long enough",
      ),
    );
  });

  it("resolves null on cancel, matching window.prompt's contract", async () => {
    const onResult = vi.fn();
    render(<PromptHarness onResult={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null));
  });
});
