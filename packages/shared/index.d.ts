/**
 * Hand-written declarations for the client.
 *
 * The package ships plain CommonJS so the backend can `require` it with no build
 * step (see README.md). These types are what make it a first-class import on the
 * TypeScript side: `z.input<typeof finalInvoice.submit>` has to give the client
 * the EXACT payload shape the API will accept, which means being precise here.
 * `ZodTypeAny` would compile and then quietly erase every field type into `any`
 * — the shared package would typecheck while proving nothing.
 */
import type { z } from "zod";

/** `YYYY-MM-DD`, round-trip validated (see schemas/common.js). */
type IsoDate = z.ZodEffects<z.ZodString, string, string>;
/** Number or numeric string in, number out. */
type Amount = z.ZodEffects<
  z.ZodEffects<z.ZodUnion<[z.ZodNumber, z.ZodString]>, number, number | string>,
  number,
  number | string
>;

export declare namespace common {
  const uuid: z.ZodString;
  const isoDate: IsoDate;
  function requiredText(label?: string): z.ZodString;
  const amount: Amount;
  const positiveAmount: Amount;
  const currency: z.ZodString;
}

export declare namespace finalInvoice {
  const line: z.ZodObject<{
    dictionary_item_id: z.ZodString;
    amount: Amount;
    is_debours: z.ZodOptional<z.ZodBoolean>;
    label: z.ZodOptional<z.ZodString>;
  }>;

  const createDraft: z.ZodObject<{
    entity_id: z.ZodString;
    client_id: z.ZodOptional<z.ZodString>;
    dossier_id: z.ZodOptional<z.ZodString>;
    lines: z.ZodOptional<z.ZodArray<typeof line>>;
  }>;

  const updateDraft: z.ZodObject<{
    client_id: z.ZodOptional<z.ZodString>;
    dossier_id: z.ZodOptional<z.ZodString>;
    lines: z.ZodOptional<z.ZodArray<typeof line>>;
  }>;

  const submit: z.ZodObject<{
    entry_date: IsoDate;
    source_doc_ref: z.ZodString;
  }>;

  const aiUpdate: z.ZodObject<{
    client_id: z.ZodOptional<z.ZodString>;
    dossier_id: z.ZodOptional<z.ZodString>;
    lines: z.ZodOptional<z.ZodArray<typeof line>>;
    invoice_id: z.ZodString;
  }>;

  const aiSubmit: z.ZodObject<{
    entry_date: IsoDate;
    source_doc_ref: z.ZodString;
    invoice_id: z.ZodString;
  }>;
}
