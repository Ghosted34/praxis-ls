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

/**
 * Raw `setting` section='pwa' values as the API stores and returns them. Every
 * field is nullable and null means INHERIT (from branding, or from the built-in
 * default) — not "empty". See pwa-design.js.
 */
export type PwaConfig = {
  appName: string | null;
  shortName: string | null;
  description: string | null;
  display: "standalone" | "fullscreen" | "minimal-ui" | "browser" | null;
  orientation: "any" | "portrait" | "landscape" | null;
  themeColor: string | null;
  backgroundColor: string | null;
  iconUrl: string | null;
  iconBackground: string | null;
  iconPadding: number | null;
  iconZoom: number | null;
  iconOffsetX: number | null;
  iconOffsetY: number | null;
  iconRadius: number | null;
  maskableBackground: string | null;
  maskablePadding: number | null;
  splashEnabled: boolean | null;
  splashPreset: "none" | "fade" | "pulse" | "shimmer" | "ring" | "mesh" | null;
  splashDuration: number | null;
  splashBackground: string | null;
  splashTagline: string | null;
  splashShowProgress: boolean | null;
  installEnabled: boolean | null;
  installTitle: string | null;
  installBody: string | null;
  installIosBody: string | null;
  installButton: string | null;
  offlineText: string | null;
  offlineReadyText: string | null;
  updateTitle: string | null;
  updateBody: string | null;
  updateButton: string | null;
};

/** What every consumer actually renders: nothing here is null except the two
 *  asset URLs and the copy overrides, which fall back in the component. */
export type EffectivePwa = {
  name: string;
  shortName: string;
  description: string;
  display: NonNullable<PwaConfig["display"]>;
  orientation: NonNullable<PwaConfig["orientation"]>;
  themeColor: string;
  backgroundColor: string;
  iconUrl: string | null;
  iconBackground: string;
  iconPadding: number;
  iconZoom: number;
  iconOffsetX: number;
  iconOffsetY: number;
  iconRadius: number;
  maskableBackground: string;
  maskablePadding: number;
  splashEnabled: boolean;
  splashPreset: NonNullable<PwaConfig["splashPreset"]>;
  splashDuration: number;
  splashBackground: string;
  splashTagline: string;
  splashShowProgress: boolean;
  splashLogoUrl: string | null;
  installEnabled: boolean;
  installTitle: string | null;
  installBody: string | null;
  installIosBody: string | null;
  installButton: string | null;
  offlineText: string | null;
  offlineReadyText: string | null;
  updateTitle: string | null;
  updateBody: string | null;
  updateButton: string | null;
};

/** Branding fields `effectivePwa` inherits from. A subset of the client's
 *  `Branding` type, declared structurally so neither side has to import the
 *  other. */
export type PwaBrandSource = {
  name?: string | null;
  primary?: string | null;
  logoUrl?: string | null;
  theme?: "dark" | "light" | null;
};

export declare namespace pwaDesign {
  const PWA_ENUMS: {
    display: readonly NonNullable<PwaConfig["display"]>[];
    orientation: readonly NonNullable<PwaConfig["orientation"]>[];
    splashPreset: readonly NonNullable<PwaConfig["splashPreset"]>[];
  };
  const PWA_RANGES: Record<string, [number, number]>;
  const PWA_BOOLS: readonly string[];
  const PWA_TEXT_MAX: Record<string, number>;
  const PWA_TEXT_DEFAULT_MAX: number;
  const PWA_DEFAULTS: Record<string, string | number | boolean>;
  const SPLASH_FALLBACK_BG: string;
  function effectivePwa(pwa: Partial<PwaConfig> | null, brand: PwaBrandSource | null): EffectivePwa;
  /** Artwork box inside the icon canvas, as fractions of the canvas (0..1). */
  function iconLayout(cfg: EffectivePwa, maskable: boolean): { size: number; left: number; top: number };
  function clamp(n: number, range: [number, number]): number;
}

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

/**
 * An optional text field as a FORM sends it: `""` in, `undefined` out.
 *
 * The declaration matters as much as the runtime here — a caller must be able to
 * pass `""` (which every untouched input does) and must NOT be able to read `""`
 * back out, because normalising blanks to `undefined` is the point.
 */
type Blankable<T> = z.ZodEffects<
  z.ZodOptional<z.ZodUnion<[z.ZodType<T>, z.ZodLiteral<"">]>>,
  T | undefined,
  T | "" | undefined
>;

/**
 * The numeric version. Its INPUT accepts a string, because that is what an
 * `<input type="number">` holds — declaring it as `number | ""` compiled and
 * then rejected `defaultValues: { credit_limit: String(row.credit_limit) }`,
 * which is the only way a form can seed one.
 */
type BlankableNumeric = z.ZodEffects<
  z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodNumber, z.ZodString]>, z.ZodLiteral<"">]>>,
  number | undefined,
  number | string | undefined
>;

export declare namespace clientMaster {
  const create: z.ZodObject<{
    entity_id: Blankable<string>;
    name: z.ZodString;
    client_type_id: Blankable<string>;
    niu: Blankable<string>;
    rccm: Blankable<string>;
    email: Blankable<string>;
    address: Blankable<string>;
    city: Blankable<string>;
    country_code: Blankable<string>;
    payment_terms_days: BlankableNumeric;
    credit_limit: BlankableNumeric;
    kyc_docs: z.ZodOptional<z.ZodArray<z.ZodAny>>;
    is_withholding_agent: z.ZodOptional<z.ZodBoolean>;
  }>;

  const update: z.ZodObject<{
    entity_id: Blankable<string>;
    name: z.ZodOptional<z.ZodString>;
    client_type_id: Blankable<string>;
    niu: Blankable<string>;
    rccm: Blankable<string>;
    email: Blankable<string>;
    address: Blankable<string>;
    city: Blankable<string>;
    country_code: Blankable<string>;
    payment_terms_days: BlankableNumeric;
    credit_limit: BlankableNumeric;
    kyc_docs: z.ZodOptional<z.ZodArray<z.ZodAny>>;
    is_withholding_agent: z.ZodOptional<z.ZodBoolean>;
    is_active: z.ZodOptional<z.ZodBoolean>;
  }>;

  const aiUpdate: typeof update;
}
