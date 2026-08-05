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

/**
 * `debit` / `credit` on a journal line. Number or numeric string in — and `""`,
 * which is how a form represents "this side is empty" — `number | undefined` out.
 */
type Side = z.ZodEffects<
  z.ZodEffects<
    z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>,
    number | undefined,
    number | string | undefined
  >,
  number | undefined,
  number | string | undefined
>;

export declare namespace journalEntry {
  const line: z.ZodObject<{
    account_code: z.ZodString;
    debit: Side;
    credit: Side;
    dossier_id: z.ZodOptional<z.ZodString>;
    dictionary_item_id: z.ZodOptional<z.ZodString>;
    is_debours: z.ZodOptional<z.ZodBoolean>;
    tax_code_id: z.ZodOptional<z.ZodString>;
    currency: z.ZodOptional<z.ZodString>;
    fx_rate: z.ZodOptional<z.ZodNumber>;
  }>;

  /**
   * `ZodEffects`, not `ZodObject` — `post` carries an object-level `.refine()`
   * for "journal_code or journal_id". Declaring it as a plain object would
   * compile and then let a caller pass neither.
   */
  const post: z.ZodEffects<
    z.ZodObject<{
      journal_code: z.ZodOptional<z.ZodString>;
      journal_id: z.ZodOptional<z.ZodString>;
      entity_id: z.ZodString;
      entry_date: IsoDate;
      description: z.ZodOptional<z.ZodString>;
      source_doc_ref: z.ZodOptional<z.ZodString>;
      source: z.ZodOptional<z.ZodEnum<["SYSTEM_AUTO", "SYSTEM_RULE", "HUMAN_MANUAL", "HUMAN_CORRECTION"]>>;
      validate: z.ZodOptional<z.ZodBoolean>;
      lines: z.ZodArray<typeof line>;
    }>
  >;

  const reverse: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
    entry_date: z.ZodOptional<IsoDate>;
  }>;

  const aiReverse: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
    entry_date: z.ZodOptional<IsoDate>;
    entry_id: z.ZodString;
  }>;
}

/**
 * The ledger's posting invariants — DOMAIN rules, not shape.
 *
 * Deliberately not Zod: each carries its own API error code, and a `.refine()`
 * would collapse six meanings into one `VALIDATION_ERROR`. See rules/ledger.js.
 */
export declare namespace ledger {
  /** A line as a form holds it — amounts may still be strings. */
  interface ProposedLine {
    account_code?: string;
    debit?: number | string;
    credit?: number | string;
  }
  type Ok = { ok: true };
  type Fail = {
    ok: false;
    /** ENTRY_UNBALANCED · LINE_ONE_SIDE · LINE_NO_ACCOUNT · … — the 422's code. */
    code: string;
    /** Operator-facing. Render it; do not match on it. */
    message: string;
    /** Zero-based index of the offending line, when there is one. */
    line?: number;
  };
  type Result = Ok | Fail;

  /** Decimal → integer minor units. `null` when it has more than 2 decimals. */
  function toMinor(value: number | string | undefined | null): number | null;
  function checkLine(line: ProposedLine | undefined, index: number): Result;
  function checkEntry(lines: ProposedLine[]): Result;
  function checkNoCompensation(lines: ProposedLine[]): Result;
  /** Every invariant, in the order the API applies them. Call this from a form. */
  function checkPostable(lines: ProposedLine[]): Result;
  function totals(lines: ProposedLine[]): { debitMinor: number; creditMinor: number };
}
