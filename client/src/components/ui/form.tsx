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
  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (e) {
      /**
       * The API returns 422 with `details` as `{ field: [message] }` (see
       * `AppError("VALIDATION_ERROR", …, 422, p.error.flatten().fieldErrors)`).
       * Routing those to the fields is the half of F12 that the errMsg
       * consolidation in PR1 could not do from a helper — it needs the form.
       */
      if (e instanceof ApiError && e.status === 422 && e.fields && typeof e.fields === "object") {
        let routed = false;
        for (const [name, messages] of Object.entries(e.fields as Record<string, string[] | string>)) {
          const message = Array.isArray(messages) ? messages.join(", ") : String(messages);
          // Only fields the form actually has; anything else falls through to
          // the banner rather than being silently dropped.
          if (name in form.getValues()) {
            form.setError(name as Path<TFieldValues>, { type: "server", message });
            routed = true;
          }
        }
        if (routed) return;
      }
      form.setError("root.serverError", { type: "server", message: errMsg(e) });
    }
  });

  return (
    <form onSubmit={submit} noValidate className={className}>
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
  children: (field: ControllerRenderProps<TFieldValues, Path<TFieldValues>>) => React.ReactElement;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} hint={hint} required={required} error={fieldState.error?.message} className={className}>
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
export function FormError<TFieldValues extends FieldValues>({ form }: { form: UseFormReturn<TFieldValues> }) {
  const message = form.formState.errors.root?.serverError?.message;
  if (!message) return null;
  return <ErrorState message={message} />;
}
