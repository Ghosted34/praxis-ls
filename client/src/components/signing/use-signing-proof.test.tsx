/**
 * useSigningProof — the signer's fingerprint / face, or the emailed code.
 *
 * jsdom has no WebAuthn, which is exactly the "device that can't do passkeys"
 * case: the hook must go straight to the emailed code, and resolve with it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/auth/auth-context", () => ({
  useAuth: () => ({ user: { email: "a@b.cm" } }),
}));
const send = vi.fn(async () => ({ sent_to: "a***@b.cm" }));
vi.mock("@/lib/signing-proof", () => ({
  proofOptions: vi.fn(async () => ({ has_passkey: false, options: null })),
  sendSigningCode: (...a: unknown[]) => send(...(a as [])),
}));

import { useSigningProof } from "./use-signing-proof";
import { PageHeader } from "@/components/data-list";

function Harness({ onResult }: { onResult: (v: unknown) => void }) {
  const [confirmSign, ui] = useSigningProof();
  return (
    <>
      {ui}
      <button
        onClick={async () =>
          onResult(
            await confirmSign({ entityRef: "costing:c-1", docType: "COSTING" }),
          )
        }
      >
        Approve
      </button>
    </>
  );
}

describe("useSigningProof on a device without passkeys", () => {
  it("emails a code and resolves with it once six digits are in", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(
      await screen.findByRole("dialog", { name: "Enter the code" }),
    ).toBeInTheDocument();
    expect(send).toHaveBeenCalledWith({
      entityRef: "costing:c-1",
      docType: "COSTING",
    });
    // Tap the first box, as a person does (and where iOS offers the emailed code).
    await user.click(screen.getAllByRole("textbox")[0]);
    await user.keyboard("123456");
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ otp_code: "123456" }),
    );
  });

  it("closing the sheet resolves null — nothing is signed", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByRole("dialog", { name: "Enter the code" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null));
  });
});

describe("PageHeader: the explanation sits behind ⓘ", () => {
  it("shows the title, hides the sentence until asked, and keeps it for screen readers", async () => {
    const user = userEvent.setup();
    render(
      <PageHeader title="Costing" description="What each file will cost us." />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Costing" });
    expect(heading).toHaveAccessibleDescription("What each file will cost us.");
    const text = screen.getByText("What each file will cost us.");
    expect(text).toHaveClass("sr-only");
    await user.click(screen.getByRole("button", { name: "About this page" }));
    expect(text).not.toHaveClass("sr-only");
  });
});
