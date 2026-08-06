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
  titlebarMode: "surface" | "brand" | "custom" | null;
  titlebarLight: string | null;
  titlebarDark: string | null;
  titlebarImageUrl: string | null;
  titlebarImageOpacity: number | null;
  titlebarBlur: number | null;
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
  titlebarMode: NonNullable<PwaConfig["titlebarMode"]>;
  titlebarLight: string;
  titlebarDark: string;
  titlebarImageUrl: string | null;
  titlebarImageOpacity: number;
  titlebarBlur: number;
};

/** The installed window's title bar, resolved for one theme. `base` is both the
 *  colour the page paints and the `theme_color` the OS paints behind the caption
 *  buttons — they must be the same value or the window shows a seam. */
export type ResolvedTitlebar = {
  base: string;
  imageUrl: string | null;
  /** 0..1 — artwork in a title bar is texture, so the ceiling is low. */
  opacity: number;
  /** px */
  blur: number;
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
  function resolveTitlebar(cfg: EffectivePwa, theme: "dark" | "light"): ResolvedTitlebar;
  const TITLEBAR_MODES: readonly NonNullable<PwaConfig["titlebarMode"]>[];
  const SURFACE_LIGHT: string;
  const SURFACE_DARK: string;
  function clamp(n: number, range: [number, number]): number;
}

export declare namespace common {
  const uuid: z.ZodString;
  const isoDate: IsoDate;
  function requiredText(label?: string): z.ZodString;
  const amount: Amount;
  const positiveAmount: Amount;
  const currency: z.ZodString;
  function blankToUndefined<T>(schema: z.ZodType<T>): Blankable<T>;
  const optionalText: Blankable<string>;
  const email: Blankable<string>;
  const countryCode: Blankable<string>;
  const optionalDate: Blankable<string>;
  const phone: Blankable<string>;
  const optionalPercent: BlankableNumeric;
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

/**
 * The shared identity/terms fields of a client payload. `create` uses it as-is;
 * `update` loosens `name` and adds the lifecycle flags. Declared as a shape type
 * so the two cannot drift.
 */
type ClientBaseShape = {
  entity_id: Blankable<string>;
  name: z.ZodString;
  legal_name: Blankable<string>;
  trading_name: Blankable<string>;
  client_type_id: Blankable<string>;
  niu: Blankable<string>;
  rccm: Blankable<string>;
  email: Blankable<string>;
  address: Blankable<string>;
  city: Blankable<string>;
  country_code: Blankable<string>;
  industry: Blankable<string>;
  website: Blankable<string>;
  notes: Blankable<string>;
  risk_tier: Blankable<string>;
  tax_residency_country: Blankable<string>;
  default_currency: Blankable<string>;
  default_language: Blankable<string>;
  preferred_channel: Blankable<string>;
  relationship_manager_user_id: Blankable<string>;
  payment_terms_days: BlankableNumeric;
  credit_limit: BlankableNumeric;
  credit_insured: z.ZodOptional<z.ZodBoolean>;
  credit_insurance_ref: Blankable<string>;
  credit_insurance_expires_on: Blankable<string>;
  guarantee_amount: BlankableNumeric;
  deposit_amount: BlankableNumeric;
  advance_required: z.ZodOptional<z.ZodBoolean>;
  advance_required_percent: BlankableNumeric;
  kyc_docs: z.ZodOptional<z.ZodArray<z.ZodAny>>;
  is_withholding_agent: z.ZodOptional<z.ZodBoolean>;
};

type RegistrationStatus = z.ZodOptional<
  z.ZodEnum<["DRAFT", "PENDING_REVIEW", "ACTIVE", "SUSPENDED", "DEACTIVATED", "ARCHIVED"]>
>;

export declare namespace clientMaster {
  const create: z.ZodObject<ClientBaseShape>;
  const update: z.ZodObject<
    Omit<ClientBaseShape, "name"> & {
      name: z.ZodOptional<z.ZodString>;
      is_active: z.ZodOptional<z.ZodBoolean>;
      registration_status: RegistrationStatus;
    }
  >;
  const aiUpdate: typeof update;
}

/** The shared identity/terms fields of a supplier payload; see ClientBaseShape. */
type SupplierBaseShape = {
  entity_id: Blankable<string>;
  name: z.ZodString;
  legal_name: Blankable<string>;
  trading_name: Blankable<string>;
  supplier_type: Blankable<string>;
  supplier_type_id: Blankable<string>;
  niu: Blankable<string>;
  rccm: Blankable<string>;
  email: Blankable<string>;
  address: Blankable<string>;
  city: Blankable<string>;
  country_code: Blankable<string>;
  industry: Blankable<string>;
  website: Blankable<string>;
  notes: Blankable<string>;
  evaluation_notes: Blankable<string>;
  risk_tier: Blankable<string>;
  tax_residency_country: Blankable<string>;
  default_currency: Blankable<string>;
  default_language: Blankable<string>;
  preferred_channel: Blankable<string>;
  relationship_manager_user_id: Blankable<string>;
  payment_method: Blankable<string>;
  momo_network: Blankable<string>;
  momo_number: Blankable<string>;
  is_non_resident: z.ZodOptional<z.ZodBoolean>;
  rating: BlankableNumeric;
  withholding_rate: BlankableNumeric;
  withholding_certificate_ref: Blankable<string>;
  withholding_certificate_expires_on: Blankable<string>;
};

export declare namespace supplierMaster {
  const create: z.ZodObject<SupplierBaseShape>;
  const update: z.ZodObject<
    Omit<SupplierBaseShape, "name"> & {
      name: z.ZodOptional<z.ZodString>;
      is_active: z.ZodOptional<z.ZodBoolean>;
      registration_status: RegistrationStatus;
    }
  >;
  const aiUpdate: typeof update;
}

/**
 * Nested master-data resources shared by both masters. Each `*Create` is the
 * full body a nested POST accepts; each `*Update` is its partial. Typed
 * loosely as objects — the fields are enumerated at runtime in party-common.js
 * and the API strips unknown keys.
 */
export declare namespace partyCommon {
  const contactCreate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const contactUpdate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const addressCreate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const addressUpdate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const bankCreate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const bankUpdate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const documentCreate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const documentUpdate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const registrationCreate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const registrationUpdate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const beneficialOwnerCreate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const beneficialOwnerUpdate: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const blockReason: z.ZodObject<Record<string, z.ZodTypeAny>>;
  const ROLE_TAGS: readonly string[];
  const ADDRESS_TYPES: readonly string[];
}

/** One `party_field_config` row, as the API returns it and the form reads it. */
export type FieldConfig = {
  applies_to: "CLIENT" | "SUPPLIER";
  field_key: string;
  field_group: string | null;
  is_required: boolean;
  is_visible: boolean;
  is_custom: boolean;
  sort_order: number;
  label_override: string | null;
};

export declare namespace partyConfig {
  const DEFAULT_ROWS: ReadonlyArray<[string, string, string, boolean]>;
  const GROUP_ORDER: readonly string[];
  function defaultsFor(appliesTo: string): FieldConfig[];
  function effectiveConfig(appliesTo: string, dbRows: FieldConfig[] | null | undefined): FieldConfig[];
  function checkRequired(
    data: Record<string, unknown>,
    config: FieldConfig[],
  ): { ok: boolean; missing: string[] };
}

/** A country as the reference module and the picker render it. */
export type Country = { code: string; name: string; phone: string; currency: string };
export type CountryRow = Country & { sort_order: number };
export type RegistrationRequirement = {
  kind: string;
  label_fr: string;
  label_en: string;
  regex: string;
  placeholder: string;
  required: boolean;
};

export declare namespace countries {
  const COUNTRIES: readonly Country[];
  const CATALOGUE: readonly CountryRow[];
  const CEMAC: readonly string[];
  const OHADA: readonly string[];
  const EU: readonly string[];
  const PRIORITY_ORDER: readonly string[];
  const REGISTRATION_REQUIREMENTS: Record<string, RegistrationRequirement[]>;
  function sortOrder(code: string): number;
  function requirementsFor(code: string): RegistrationRequirement[];
  function byCode(code: string): Country | undefined;
  function phoneCodeFor(code: string): string;
}
