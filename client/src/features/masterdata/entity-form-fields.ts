/**
 * The corporate-entity form's value shape, and the one place its controls are
 * mapped onto the API's request body.
 *
 * Its own module, not part of `corporate-entities.tsx`, for two reasons. It is
 * the file `client/scripts/check-schemas.mjs` reads to learn which columns a
 * person can actually write — a small, stable target beats grepping a 400-line
 * screen — and a page that also exports plain functions loses fast refresh.
 *
 * WHY THIS EXISTS AT ALL. The form used to build its body inline from thirteen
 * pieces of `useState`, and the shared schema had thirty-three fields. The
 * twenty with no control were not decorative: `share_capital` is on
 * `rules.readiness()`, so the dossier's "not yet complete for statutory
 * documents" callout could never be cleared; the letterhead's share-capital
 * block — mandatory on French invoices — could be switched on but never filled;
 * the cap table's CAPITAL_MISMATCH finding could never fire. Everything the form
 * sends now goes through `entityFormBody`, so what it covers is a fact about one
 * function rather than a claim about a screen.
 */
import type * as api from "@/lib/masterdata-api";

/**
 * The form's values, one key per control.
 *
 * Everything is a string except where a control genuinely has no string form,
 * because that is what an `<input>` hands back. The conversion to the API's
 * numbers, nulls and enums happens once, below, instead of being spread across
 * thirty onChange handlers where a missing `|| null` is invisible.
 */
export type EntityFormValues = Record<string, string>;

export const EMPTY_VALUES: EntityFormValues = {
  code: "", legal_name: "", trading_name: "", legal_form: "", country_code: "",
  industry: "", website: "", email: "", phone: "", headcount: "", timezone: "",
  description: "",
  incorporation_date: "", incorporation_place: "", incorporation_country: "",
  dissolution_date: "",
  share_capital: "", share_capital_paid_up: "", share_capital_currency: "",
  doc_prefix: "", default_language: "", fiscal_year_start_month: "",
  accounting_framework: "", numbering_reset: "",
  default_currency: "", default_tax_jurisdiction_id: "", payroll_country: "",
  vat_registered: "",
  parent_entity_id: "", relationship_type: "",
  registration_status: "",
};

/**
 * `""` means "not filled in".
 *
 * Nullable columns are cleared with an explicit `null` rather than omitted: on a
 * PATCH, omitting a key leaves the old value, so a user who empties a field and
 * saves would watch it come straight back. The shared schema maps `""` to
 * undefined, which is why the empty string cannot simply be forwarded.
 */
const text = (v: string) => (v.trim() === "" ? null : v.trim());
const number = (v: string) => (v.trim() === "" ? null : Number(v));

/**
 * Map the form's strings onto the create/update body.
 *
 * The keys of what this returns ARE what the form sends, which is what makes the
 * coverage gate meaningful: it reads them straight out of this function rather
 * than trusting a list maintained alongside it, because a hand-kept list goes
 * stale the first time someone adds a field — the exact drift being guarded.
 */
export function entityFormBody(v: EntityFormValues): Record<string, unknown> {
  return {
    legal_name: v.legal_name.trim(),
    trading_name: text(v.trading_name),
    legal_form: text(v.legal_form),
    country_code: v.country_code || undefined,
    industry: text(v.industry),
    website: text(v.website),
    email: text(v.email),
    phone: text(v.phone),
    headcount: number(v.headcount),
    timezone: text(v.timezone),
    description: text(v.description),

    incorporation_date: text(v.incorporation_date),
    incorporation_place: text(v.incorporation_place),
    incorporation_country: text(v.incorporation_country),
    dissolution_date: text(v.dissolution_date),
    share_capital: number(v.share_capital),
    share_capital_paid_up: number(v.share_capital_paid_up),
    share_capital_currency: text(v.share_capital_currency),

    doc_prefix: v.doc_prefix.trim() || undefined,
    default_language: v.default_language || undefined,
    fiscal_year_start_month: v.fiscal_year_start_month === "" ? undefined : Number(v.fiscal_year_start_month),
    accounting_framework: (v.accounting_framework || null) as api.AccountingFramework | null,
    numbering_reset: (v.numbering_reset || null) as "NEVER" | "ANNUAL" | "MONTHLY" | null,

    default_currency: text(v.default_currency),
    default_tax_jurisdiction_id: v.default_tax_jurisdiction_id || null,
    payroll_country: text(v.payroll_country),
    // Tri-state on purpose: "we have not said" is not the same as "no", and the
    // dossier renders the difference (`—` against "No").
    vat_registered: v.vat_registered === "" ? null : v.vat_registered === "true",

    parent_entity_id: v.parent_entity_id || null,
    relationship_type: (v.relationship_type || null) as api.EntityRelationship | null,
  };
}

/** Seed the controls from an existing row; sensible defaults for a new one. */
export function valuesFrom(row: api.Entity | null): EntityFormValues {
  if (!row) {
    return {
      ...EMPTY_VALUES,
      country_code: "CM", default_language: "fr", fiscal_year_start_month: "1",
      accounting_framework: "OHADA", registration_status: "DRAFT",
    };
  }
  const v: EntityFormValues = { ...EMPTY_VALUES };
  for (const k of Object.keys(EMPTY_VALUES)) {
    const raw = (row as unknown as Record<string, unknown>)[k];
    v[k] = raw === null || raw === undefined ? "" : String(raw);
  }
  return v;
}
