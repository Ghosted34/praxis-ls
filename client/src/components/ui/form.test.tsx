/**
 * Form — RHF + Zod, and the packages/shared round trip.
 *
 * The point of these tests is not that React Hook Form works. It is that the
 * client is now enforcing THE SAME schema object the Express API parses with
 * (`packages/shared`), and that a validation failure lands on the FIELD rather
 * than in a banner — the two halves of F12 that PR1's errMsg consolidation
 * could not reach from a helper.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { z } from "zod";
import { finalInvoice, common } from "@shared";

import { Form, FormField, FormError } from "./form";
import { useZodForm } from "@/lib/use-zod-form";
import { Input } from "./input";
import { ApiError } from "@/lib/api-client";

/* ───────────────────── the shared package, used as shipped ───────────────── */

describe("@shared — the package the root README promised and did not exist", () => {
  it("is importable from the client and exports real Zod schemas", () => {
    expect(finalInvoice.submit).toBeInstanceOf(z.ZodType);
    expect(common.uuid).toBeInstanceOf(z.ZodType);
  });

  it("accepts a payload the API would accept", () => {
    const r = finalInvoice.submit.safeParse({
      entry_date: "2026-03-21",
      source_doc_ref: "INV-2026-0041",
    });
    expect(r.success).toBe(true);
  });

  it("rejects the cases the client's ad-hoc booleans used to let through", () => {
    // `canSubmit` in finance/pages.tsx tested `value !== ""`, so a field of
    // spaces passed the client and failed the server.
    const r = finalInvoice.submit.safeParse({
      entry_date: "2026-02-31",
      source_doc_ref: "   ",
    });
    expect(r.success).toBe(false);
    const errors = r.error!.flatten().fieldErrors;
    expect(errors.entry_date?.join(" ")).toMatch(/doesn't exist/);
    expect(errors.source_doc_ref?.join(" ")).toMatch(/required/);
  });

  it("coerces a numeric string, because form inputs produce strings", () => {
    expect(common.positiveAmount.safeParse("1500").success).toBe(true);
    expect(common.positiveAmount.safeParse("0").success).toBe(false);
    expect(common.positiveAmount.safeParse("abc").success).toBe(false);
  });
});

/* ────────────────────────────── the form itself ──────────────────────────── */

function InvoiceForm({
  onSubmit,
}: {
  onSubmit: (v: {
    entry_date: string;
    source_doc_ref: string;
  }) => Promise<void>;
}) {
  const form = useZodForm(finalInvoice.submit, {
    defaultValues: { entry_date: "", source_doc_ref: "" },
  });
  return (
    <Form form={form} onSubmit={onSubmit}>
      <FormField form={form} name="entry_date" label="Entry date" required>
        {(field) => <Input {...field} />}
      </FormField>
      <FormField
        form={form}
        name="source_doc_ref"
        label="Document reference"
        required
      >
        {(field) => <Input {...field} />}
      </FormField>
      <FormError form={form} />
      <button type="submit">Submit invoice</button>
    </Form>
  );
}

describe("Form", () => {
  it("blocks submission and shows the message ON THE FIELD, not in a banner", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<InvoiceForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Submit invoice" }));

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Entry date" }),
      ).toHaveAttribute("aria-invalid", "true"),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    // The message is the field's accessible DESCRIPTION — which is what makes a
    // screen reader read it when focus lands on the input. Before this, 0 of 565
    // fields had aria-describedby at all.
    expect(
      screen.getByRole("textbox", { name: "Entry date" }),
    ).toHaveAccessibleDescription(/YYYY-MM-DD/);
  });

  it("submits parsed values once the schema is satisfied", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<InvoiceForm onSubmit={onSubmit} />);

    await user.type(
      screen.getByRole("textbox", { name: "Entry date" }),
      "2026-03-21",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Document reference" }),
      "INV-2026-0041",
    );
    await user.click(screen.getByRole("button", { name: "Submit invoice" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        entry_date: "2026-03-21",
        source_doc_ref: "INV-2026-0041",
      }),
    );
  });

  /**
   * THE F12 FIX, end to end. The API returns 422 with
   * `{ details: { field: [message] } }`; finance/pages.tsx used to parse that
   * and then flatten it into one sentence. Here it lands on the input.
   */
  it("routes a server 422 back onto the offending field", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "Invalid body", 422, {
        source_doc_ref: [
          "That reference is already used on invoice INV-2026-0038.",
        ],
      }),
    );
    render(<InvoiceForm onSubmit={onSubmit} />);

    await user.type(
      screen.getByRole("textbox", { name: "Entry date" }),
      "2026-03-21",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Document reference" }),
      "INV-2026-0041",
    );
    await user.click(screen.getByRole("button", { name: "Submit invoice" }));

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Document reference" }),
      ).toHaveAccessibleDescription(/already used on invoice INV-2026-0038/),
    );
    expect(
      screen.getByRole("textbox", { name: "Document reference" }),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("falls back to a form-level alert for an error that belongs to no field", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValue(
        new ApiError("PERIOD_CLOSED", "Period 2026-03 is already closed.", 409),
      );
    render(<InvoiceForm onSubmit={onSubmit} />);

    await user.type(
      screen.getByRole("textbox", { name: "Entry date" }),
      "2026-03-21",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Document reference" }),
      "INV-2026-0041",
    );
    await user.click(screen.getByRole("button", { name: "Submit invoice" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Period 2026-03 is already closed.",
      ),
    );
  });

  it("keeps a 403 readable rather than replacing it with 'Something went wrong'", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new ApiError("FORBIDDEN", "nope", 403));
    render(<InvoiceForm onSubmit={onSubmit} />);

    await user.type(
      screen.getByRole("textbox", { name: "Entry date" }),
      "2026-03-21",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Document reference" }),
      "INV-2026-0041",
    );
    await user.click(screen.getByRole("button", { name: "Submit invoice" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You don't have permission to do this.",
      ),
    );
  });

  it("has no axe violations, valid or invalid", async () => {
    const user = userEvent.setup();
    const { container } = render(<InvoiceForm onSubmit={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("button", { name: "Submit invoice" }));
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Entry date" }),
      ).toHaveAttribute("aria-invalid", "true"),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
