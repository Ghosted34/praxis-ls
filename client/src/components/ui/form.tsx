/**
 * Form — React Hook Form + Zod, wired to the `Field` accessibility fix.
 *
 * WHY (audit F4 / F12). Two findings meet here:
 *
 *   - 4 of 565 `<Field>`s ever received an `error`. Validation was enforced
 *     server-side and surfaced as ONE banner string, so the user was told
 *     something was wrong but not WHICH field. `finance/pages.tsx:92` even
 *     parsed a 422's `details` into "field: message" text — and then flattened
 *     it into a single sentence rather than routing it to the offending input.
 *   - There was no form library and no schema sharing. The backend validates
 *     with Zod; the client re-implemented the same rules as ad-hoc booleans
 *     (`finance/pages.tsx:141`'s `canSubmit`), which drift.
 *
 * `useZodForm` takes a schema from `@shared` — the SAME object the Express
 * validator parses with — so the client cannot disagree with the API about what
 * is valid. `<FormField>` then routes each message to its own control, where
 * `Field` turns it into `aria-invalid` + `aria-describedby`.
 *
 * @example
 * import { finalInvoice } from "@shared";
 * import { useZodForm } from "@/lib/use-zod-form";
 *
 * function SubmitInvoiceForm({ onDone }: { onDone: () => void }) {
 *   const form = useZodForm(finalInvoice.submit, { defaultValues: { entry_date: todayISO(), source_doc_ref: "" } });
 *   const toast = useToast();
 *
 *   return (
 *     <Form
 *       form={form}
 *       onSubmit={async (values) => {
 *         await tenant(`/final-invoices/${id}/submit`, { method: "POST", body: values });
 *         toast.success("Invoice submitted");
 *         onDone();
 *       }}
 *     >
 *       <FormField form={form} name="entry_date" label="Entry date" required>
 *         {(field) => <Input type="date" {...field} />}
 *       </FormField>
 *       <FormField form={form} name="source_doc_ref" label="Document reference" required>
 *         {(field) => <Input {...field} />}
 *       </FormField>
 *       <FormError form={form} />
 *       <FormButtons busy={form.formState.isSubmitting} onCancel={onDone} saveLabel="Submit invoice" />
 *     </Form>
 *   );
 * }
 *
 * BEST PRACTICE. Validate on `submit`, not on every keystroke — telling someone
 * their email is invalid while they are still typing it is the single most
 * disliked form behaviour there is. `mode: "onTouched"` below re-validates a
 * field once the user has left it AND a submit has failed, which is the
 * behaviour people actually want. Never add a client-side rule the schema does
 * not have: put it in `packages/shared` so the API enforces it too, or it is
 * not a rule, it is a suggestion.
 */
import * as React from "react";
import {
  Controller,
  type UseFormReturn,
  type FieldValues,
  type Path,
  type SubmitHandler,
  type ControllerRenderProps,
} from "react-hook-form";
import { Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { errMsg } from "@/lib/use-resource";
import { ApiError } from "@/lib/api-client";

/** One leaf of RHF's error tree: the dotted path, and the message to show. */
type Stranded = { path: string; message: string };

/**
 * Flatten RHF's error tree to its LEAVES.
 *
 * `formState.errors` is a tree, not a flat map: a failure on `contact.email`
 * arrives as `{ contact: { email: { type, message } } }`, and a field array as
 * `{ legs: { 0: { eta: {…} } } }`. Walking only the top level therefore yields
 * the CONTAINER — a node with no `message` at a path no control answers to —
 * which is how a form that is behaving perfectly ends up announcing
 * "contact: Invalid" while the real message sits correctly on the input.
 *
 * A leaf is identified by a string `type`, which is the one property RHF's
 * `FieldError` always sets and container nodes never do.
 */
function leafErrors(
  node: unknown,
  path = "",
  out: Stranded[] = [],
): Stranded[] {
  if (!node || typeof node !== "object") return out;
  const record = node as Record<string, unknown>;

  if (typeof record.type === "string") {
    const message =
      typeof record.message === "string" && record.message
        ? record.message
        : "This value is not valid.";
    out.push({ path, message });
    return out;
  }

  for (const [key, child] of Object.entries(record)) {
    // `ref` is the DOM node and `types` the multi-error map — neither is a field.
    if (key === "ref" || key === "types") continue;
    leafErrors(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}

/**
 * `<form>` wrapper that runs the schema, calls `onSubmit` with parsed values,
 * and — the part that matters — maps a 422 from the server back onto the
 * offending FIELDS rather than into one banner.
 */
export function Form<TFieldValues extends FieldValues>({
  form,
  onSubmit,
  children,
  className,
}: {
  form: UseFormReturn<TFieldValues>;
  onSubmit: SubmitHandler<TFieldValues>;
  children: React.ReactNode;
  className?: string;
}) {
  // Scopes the "is this message on screen?" lookup below to THIS form.
  const formRef = React.useRef<HTMLFormElement>(null);

  const submit = form.handleSubmit(
    async (values) => {
      // A fresh attempt owns the banner: clear the last failure before making
      // one, or a resolved error stays on screen next to a successful submit.
      form.clearErrors("root.serverError");
      try {
        await onSubmit(values);
      } catch (e) {
        /**
         * The API returns 422 with `details` as `{ field: [message] }` (see
         * `AppError("VALIDATION_ERROR", …, 422, p.error.flatten().fieldErrors)`).
         * Routing those to the fields is the half of F12 that the errMsg
         * consolidation in PR1 could not do from a helper — it needs the form.
         */
        if (
          e instanceof ApiError &&
          e.status === 422 &&
          e.fields &&
          typeof e.fields === "object"
        ) {
          let routed = false;
          for (const [name, messages] of Object.entries(
            e.fields as Record<string, string[] | string>,
          )) {
            const message = Array.isArray(messages)
              ? messages.join(", ")
              : String(messages);
            // Only fields the form actually has; anything else falls through to
            // the banner rather than being silently dropped.
            if (name in form.getValues()) {
              form.setError(name as Path<TFieldValues>, {
                type: "server",
                message,
              });
              routed = true;
            }
          }
          if (routed) return;
        }
        form.setError("root.serverError", {
          type: "server",
          message: errMsg(e),
        });
      }
    },
    (errors) => {
      /**
       * THE SILENT FAIL. `handleSubmit` refuses to call `onSubmit` when the
       * schema rejects the values, and every message it produced is rendered by
       * the `<Field>` that owns it. So a rule about a field the screen does NOT
       * render — `clientMaster.create` hard-requires `name`, and the client form
       * collects `legal_name`/`trading_name` — has nowhere to go: the button
       * does nothing, forever, and says nothing about why.
       *
       * Anything that lands on a control the user can see is already handled and
       * must NOT be repeated here; the banner is only for the remainder.
       *
       * FOCUS IS DELIBERATELY NOT SET HERE. RHF's own `shouldFocusError` (on by
       * default) focuses the first invalid field after this callback returns, so
       * a `focus()` call here is overwritten a tick later — and the DOM lookup
       * that fed it, being a `document`-wide query for `[name=…]`, resolved a
       * modal's field to the identically-named field of the page BEHIND it and
       * scrolled there. Scoping the lookup to this form is what makes the check
       * below trustworthy; the browser scrolls to whatever RHF focuses.
       */
      const stranded = leafErrors(errors)
        // `root` is this banner's own key — walking it would echo the previous
        // message back into itself.
        .filter(({ path }) => path !== "root" && !path.startsWith("root."))
        .filter(({ path }) => {
          // Only `"` and `\` are special inside a quoted attribute selector.
          const escaped = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          return !formRef.current?.querySelector(`[name="${escaped}"]`);
        });

      if (stranded.length === 0) {
        // Every message reached a field. Clear any banner left by an earlier
        // attempt so a stale failure doesn't outlive the thing it described.
        form.clearErrors("root.serverError");
        return;
      }

      // The schema's messages are already written as sentences ("Client name is
      // required."), so they read as prose. The path is the fallback for a rule
      // that never got given one.
      const details = stranded
        .map(({ path, message }) => message || path)
        .join(" ");
      form.setError("root.serverError", {
        type: "validation",
        message: `This form can't be submitted: ${details} That isn't a field on this screen, so please report it.`,
      });
    },
  );

  return (
    <form ref={formRef} onSubmit={submit} noValidate className={className}>
      {children}
    </form>
  );
}

/**
 * One controlled field. The render prop receives RHF's `field` object, so the
 * control stays uncontrolled-by-you and validated-by-the-schema.
 *
 * Everything about the accessible name and state comes from `<Field>` — this
 * just feeds it the message RHF produced.
 */
export function FormField<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  className,
  children,
}: {
  form: UseFormReturn<TFieldValues>;
  name: Path<TFieldValues>;
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (
    field: ControllerRenderProps<TFieldValues, Path<TFieldValues>>,
  ) => React.ReactElement;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          label={label}
          hint={hint}
          required={required}
          error={fieldState.error?.message}
          className={className}
        >
          {children(field)}
        </Field>
      )}
    />
  );
}

/**
 * Form-level failure — the errors that belong to no single field (a 409 from a
 * closed period, a network drop). Field-level messages render at their field;
 * this is only the remainder.
 */
export function FormError<TFieldValues extends FieldValues>({
  form,
}: {
  form: UseFormReturn<TFieldValues>;
}) {
  const message = form.formState.errors.root?.serverError?.message;
  if (!message) return null;
  return <ErrorState message={message} />;
}
