/**
 * useZodForm — a React Hook Form instance bound to a Zod schema.
 *
 * Lives in lib/ rather than next to `<Form>` so that file exports components
 * only (react-refresh), and because this is the import every form starts from:
 * pass a schema from `@shared` and the client cannot disagree with the API
 * about what is valid (audit F12 — the client used to re-implement the rules as
 * ad-hoc booleans, e.g. `finance/pages.tsx:141`'s `canSubmit`).
 *
 * See `components/ui/form.tsx` for the full worked example and the
 * best-practices note.
 */
import { useForm, type UseFormProps, type FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

/**
 * A form bound to a Zod schema — ideally one from `@shared`, so the client and
 * the API agree by construction.
 *
 * `mode: "onTouched"` validates on SUBMIT, then re-validates a field as the
 * user leaves it. Not onChange: telling someone their date is malformed while
 * they are still typing it is the single most disliked form behaviour there is.
 */
export function useZodForm<TSchema extends z.ZodType<FieldValues>>(
  schema: TSchema,
  options?: Omit<UseFormProps<z.input<TSchema>>, "resolver">,
) {
  return useForm<z.input<TSchema>>({
    resolver: zodResolver(schema),
    // See the header: validate on submit, then re-validate a field as the user
    // leaves it. Not onChange.
    mode: "onTouched",
    ...options,
  });
}
