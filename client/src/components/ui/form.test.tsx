/**
 * Form — RHF + Zod, and the packages/shared round trip.
 *
 * The point of these tests is not that React Hook Form works. It is that the
 * client is now enforcing THE SAME schema object the Express API parses with
 * (`packages/shared`), and that a validation failure lands on the FIELD rather
 * than in a banner — the two halves of F12 that PR1's errMsg consolidation
 * could not reach from a helper.
 */
import * as React from "react";
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

/**
 * The shape `clients.tsx` has: `name` is required by the schema but has no
 * control — it is derived from the legal/trading name the user actually types.
 */
const derivedName = z.object({
  name: z.string().trim().min(1, "Client name is required."),
  legal_name: z.string().optional(),
});

function DerivedNameForm({
  onSubmit,
}: {
  onSubmit: (v: { name: string; legal_name?: string }) => Promise<void>;
}) {
  const form = useZodForm(derivedName, {
    defaultValues: { name: "", legal_name: "" },
  });
  const legalName = form.watch("legal_name");
  React.useEffect(() => {
    form.setValue("name", (legalName || "").trim(), { shouldValidate: true });
  }, [legalName, form]);

  return (
    <Form form={form} onSubmit={onSubmit}>
      <FormField form={form} name="legal_name" label="Legal name" required>
        {(field) => <Input {...field} />}
      </FormField>
      <FormError form={form} />
      <button type="submit">Save client</button>
    </Form>
  );
}

const nestedContact = z.object({
  contact: z.object({
    email: z.string().email("Enter a valid email address."),
  }),
});

function NestedForm() {
  const form = useZodForm(nestedContact, {
    defaultValues: { contact: { email: "" } },
  });
  return (
    <Form form={form} onSubmit={vi.fn()}>
      <FormField
        form={form}
        name="contact.email"
        label="Contact email"
        required
      >
        {/* `field.value` types as the union of every path, so coerce as the screens do. */}
        {(field) => <Input {...field} value={String(field.value ?? "")} />}
      </FormField>
      <FormError form={form} />
      <button type="submit">Save contact</button>
    </Form>
  );
}

const titled = z.object({ title: z.string().min(1, "A title is required.") });

/** A modal over a page, both owning a field called `title`. */
function TwoForms() {
  const page = useZodForm(titled, { defaultValues: { title: "" } });
  const modal = useZodForm(titled, { defaultValues: { title: "" } });
  return (
    <>
      <Form form={page} onSubmit={vi.fn()}>
        <FormField form={page} name="title" label="Page title" required>
          {(field) => <Input {...field} />}
        </FormField>
        <button type="submit">Save page</button>
      </Form>
      <Form form={modal} onSubmit={vi.fn()}>
        <FormField form={modal} name="title" label="Modal title" required>
          {(field) => <Input {...field} />}
        </FormField>
        <button type="submit">Save modal</button>
      </Form>
    </>
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

  /**
   * THE SILENT FAIL, at the primitive.
   *
   * `clientMaster.create` hard-requires `name`; the client form collects
   * `legal_name`/`trading_name` and derives `name` on submit. `handleSubmit`
   * runs the schema FIRST, so it rejected the empty `name`, never called
   * `onSubmit`, and — `name` having no `<Field>` to render its message — left
   * the Save button doing nothing at all, with nothing on screen to explain it.
   *
   * A rule the screen cannot show must reach the user somewhere, or "invalid"
   * and "broken" are indistinguishable from the outside.
   */
  it("names a rule the screen has no field for, instead of silently doing nothing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DerivedNameForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Save client" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Client name is required.",
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("drops that banner once the stranded rule is satisfied", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<DerivedNameForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Save client" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // Typing a legal name derives `name`, which is the whole point of the sync.
    await user.type(
      screen.getByRole("textbox", { name: "Legal name" }),
      "Bolloré Transport",
    );
    await user.click(screen.getByRole("button", { name: "Save client" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * REGRESSION — the error object is a TREE.
   *
   * A failure on `contact.email` arrives as `{ contact: { email: {…} } }`.
   * Reading only the top level yields the CONTAINER: no `message`, and a path
   * (`contact`) no control answers to — so a form behaving perfectly, with its
   * message already on the input, also announced "contact: Invalid".
   */
  it("does not invent a banner for a nested field that already shows its message", async () => {
    const user = userEvent.setup();
    render(<NestedForm />);

    await user.click(screen.getByRole("button", { name: "Save contact" }));

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Contact email" }),
      ).toHaveAttribute("aria-invalid", "true"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * REGRESSION — a modal and the page behind it both have a `name` field.
   *
   * The lookup that decides "is this message on screen?" used to be a
   * `document`-wide `querySelector('[name=…]')`, which resolves to the FIRST
   * match in the document — the page's field, not the submitting modal's. It
   * then focused and smooth-scrolled to it, which both moved the viewport to an
   * unrelated form and, by touching that field, lit it up as invalid.
   */
  it("leaves an identically-named field in another form alone", async () => {
    const user = userEvent.setup();
    render(<TwoForms />);
    const pageField = screen.getByRole("textbox", { name: "Page title" });

    await user.click(screen.getByRole("button", { name: "Save modal" }));

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Modal title" }),
      ).toHaveAttribute("aria-invalid", "true"),
    );
    expect(pageField).not.toHaveAttribute("aria-invalid");
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
