/**
 * The costing worksheet's model layer — no JSX, no React.
 *
 * These are the pure pieces the sheet, the line grid, the Suggest dialog and
 * the register all need: what a line looks like while it is being edited, how
 * a line is identified, how a sheet's money adds up, and how a status enum is
 * said out loud.
 *
 * They live in their own module for two reasons.
 *
 * 1. THE TWO KEYS MUST AGREE. `lineKey` (a line already on the sheet) and
 *    `suggestionKey` (a line being offered) are the same notion of identity —
 *    dictionary item plus container type, because a charge priced per box is
 *    several lines that share an item and differ only by equipment. If they
 *    ever drift, Suggest re-offers a charge that is already on the sheet and
 *    the importer silently duplicates it. Side by side, that drift is visible.
 *
 * 2. The register imports `statusLabel` and `COSTING_BASE`. Taking them from
 *    the sheet dragged the whole worksheet — grid, dialogs, Suggest — into the
 *    register's chunk, and tripped `react-refresh/only-export-components` on
 *    every module that mixed a component with a helper.
 */
import { tr } from "@/lib/i18n";
import * as api from "@/lib/costing-api";

/** Where a costing sheet lives. One route, whether it opens as a page or in a
 *  dialog — a pasted link has to land on the same sheet (FRONTEND_GUIDE §3.11). */
export const COSTING_BASE = "/costing/costing";

/** Statuses are said out loud, never shown raw. Nobody outside the schema
 *  should have to read `SUBMITTED_FOR_VALIDATION` on an A4 document
 *  (FRONTEND_GUIDE §5). */
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED_FOR_VALIDATION: "To validate",
  SUBMITTED_FOR_APPROVAL: "To approve",
  APPROVED_LOCKED: "Approved",
  UNLOCK_REQUESTED: "Unlock requested",
  REJECTED: "Rejected",
};

export const statusLabel = (s?: string | null) =>
  tr(STATUS_LABEL[String(s || "")] || String(s || "—"));

/** What a suggested line is keyed by while it is being ticked. Must stay equal
 *  to `lineKey` below — see (1) at the top of this file. */
export const suggestionKey = (l: api.SuggestedLine) =>
  `${l.dictionary_item_id}|${l.container_type_ref_id || "-"}`;


/** The standard rate, as a last-resort default when the tax-code list has not
 *  loaded yet. The real TVA_STD from the catalogue is preferred everywhere it
 *  is available (see `defaultVatCode`). */
export const STD_RATE = 19.25;

/** A sales tax code as the worksheet holds it. */
export type VatCode = { tax_code_id: string; code: string; rate_percent?: number | null };

/** The default a new VAT control lands on: TVA_STD, by code then by rate, else
 *  the first available (Q — "all VAT controls default to TVA_STD 19.25%"). */
export const defaultVatCode = (codes: VatCode[]): VatCode | undefined =>
  codes.find((c) => c.code === "TVA_STD")
  || codes.find((c) => Number(c.rate_percent) === STD_RATE)
  || codes[0];

/** How a disbursement line's VAT is being entered: a rate the standard case
 *  derives the amount from, or a free-text amount for the rare bill whose VAT
 *  is not a clean rate. Client-only — the server reads the rate and amount. */
export type VatMode = "RATE" | "AMOUNT";

/** One line as the worksheet holds it while being edited. */
export type LineDraft = {
  dictionary_item_id?: string;
  label: string;
  qty: number | null;
  unit_cost: number | null;
  is_disbursement: boolean;
  tax_code_id?: string | null;
  tax_rate_percent?: number | null;
  container_type_ref_id?: string | null;
  container_type_label?: string | null;
  /** The supplier's own VAT on a débours. 12768: now BUDGETED into the sheet's
   *  VAT and TTC, marked (PT). Only ever set on a disbursement line. */
  upstream_vat_amount?: number | null;
  /** 12768 — the rate that derived the amount above (default TVA_STD). Null in
   *  free-text mode. Only ever set on a disbursement line. */
  upstream_vat_rate_percent?: number | null;
  /** Which of the two boxes a débours line's VAT is entered through. */
  vat_mode?: VatMode;
  /** True when the catalogue says this charge discloses its upstream VAT. */
  disbursement_vat_transparent?: boolean;
  /** Display only: where the price came from, so a number nobody can explain
   *  never reaches an approver. */
  price_note?: string | null;
  item_code?: string | null;
};

export const BLANK_LINE: LineDraft = {
  label: "",
  qty: 1,
  unit_cost: 0,
  is_disbursement: false,
};

/** The VAT a débours line's rate implies, from its net. */
const round2 = (n: number) => Math.round(n * 100) / 100;
export const deboursVatFromRate = (l: LineDraft, rate: number): number =>
  round2((Number(l.qty) || 0) * (Number(l.unit_cost) || 0) * (rate / 100));

/**
 * Give a freshly-created line its default VAT (12768). Applied only where a line
 * is BORN — added by hand, picked from the catalogue, imported from Suggest —
 * never on a saved line being re-loaded, so it cannot undo a choice already
 * made. A débours defaults to rate mode at TVA_STD; a service line whose VAT was
 * never decided (undefined/null) defaults to TVA_STD too. A rate the catalogue
 * or the user has already set is left alone.
 */
export const withVatDefault = (l: LineDraft, def?: VatCode): LineDraft => {
  const rate = def?.rate_percent ?? STD_RATE;
  if (l.is_disbursement) {
    if (l.upstream_vat_rate_percent != null) return { ...l, vat_mode: "RATE" };
    if (l.upstream_vat_amount != null) return { ...l, vat_mode: "AMOUNT" };
    return {
      ...l,
      vat_mode: "RATE",
      upstream_vat_rate_percent: rate,
      upstream_vat_amount: deboursVatFromRate(l, rate),
    };
  }
  if (l.tax_code_id) return l; // already carries a real code
  if (!def) return l; // codes not loaded yet — leave it for the next pass
  return { ...l, tax_code_id: def.tax_code_id, tax_rate_percent: rate };
};

/** Identity across an edit — the same pair the server diffs on. */
export const lineKey = (l: LineDraft) =>
  `${l.dictionary_item_id || `label:${l.label.trim().toLowerCase()}`}|${l.container_type_ref_id || "-"}`;

/** A suggested line, as the worksheet holds it. */
export const fromSuggestion = (s: api.SuggestedLine): LineDraft => ({
  dictionary_item_id: s.dictionary_item_id,
  label: s.label,
  qty: s.qty,
  unit_cost: s.unit_cost,
  is_disbursement: s.is_disbursement,
  tax_code_id: s.tax_code_id,
  tax_rate_percent: s.tax_rate_percent,
  container_type_ref_id: s.container_type_ref_id,
  container_type_label: s.container_type_label,
  disbursement_vat_transparent: s.disbursement_vat_transparent,
  item_code: s.item_code,
  price_note:
    s.price_source === "EXPENSE_RATE"
      ? tr("From the rate card")
      : s.price_source === "CATALOGUE_DEFAULT"
        ? tr("Catalogue default")
        : null,
});

/** A saved line, as the worksheet holds it. */
export const fromSaved = (l: api.CostingLine): LineDraft => ({
  dictionary_item_id: l.dictionary_item_id,
  label: l.label || "",
  qty: l.qty ?? 1,
  unit_cost: l.unit_cost ?? 0,
  is_disbursement: l.is_disbursement === true,
  tax_code_id: l.tax_code_id,
  tax_rate_percent: l.tax_rate_percent,
  container_type_ref_id: l.container_type_ref_id,
  container_type_label: l.container_type_code,
  upstream_vat_amount: l.upstream_vat_amount,
  upstream_vat_rate_percent: l.upstream_vat_rate_percent,
  // Which box to show a saved débours in: rate if it was priced from one,
  // otherwise the free-text amount it carries.
  vat_mode: l.is_disbursement
    ? (l.upstream_vat_rate_percent != null || l.upstream_vat_amount == null ? "RATE" : "AMOUNT")
    : undefined,
  disbursement_vat_transparent: l.disbursement_vat_transparent ?? undefined,
  item_code: l.item_code,
});

/** The payload shape the API takes. */
export const toPayload = (l: LineDraft) => ({
  dictionary_item_id: l.dictionary_item_id,
  label: l.label,
  qty: Number(l.qty) || 1,
  unit_cost: Number(l.unit_cost) || 0,
  is_disbursement: l.is_disbursement,
  tax_code_id: l.is_disbursement ? undefined : l.tax_code_id || undefined,
  container_type_ref_id: l.container_type_ref_id || null,
  // The server derives the amount from the rate when a rate is present, so a
  // rate mode line need not trust the amount it also sends; a free-text (AMOUNT)
  // line sends no rate. Both null on a service line.
  upstream_vat_rate_percent:
    l.is_disbursement && l.vat_mode !== "AMOUNT" ? (l.upstream_vat_rate_percent ?? null) : null,
  upstream_vat_amount: l.is_disbursement ? (l.upstream_vat_amount ?? null) : null,
});

/**
 * The footer arithmetic, computed the same way the server computes it
 * (costing.rules.computeCosting — keep the two in step).
 *
 * 12768: a disbursement's VAT is BUDGETED. Its net is in HT, its supplier VAT
 * is in the VAT total and the TTC like any other line, and `upstream_vat_total`
 * is a memo naming how much of that VAT came from débours (PT).
 */
export function computeTotals(lines: LineDraft[]) {
  let service = 0;
  let disbursement = 0;
  let serviceVat = 0;
  let upstream = 0;
  for (const l of lines) {
    const amt = (Number(l.qty) || 0) * (Number(l.unit_cost) || 0);
    if (l.is_disbursement) {
      disbursement += amt;
      upstream += Number(l.upstream_vat_amount) || 0;
    } else {
      service += amt;
      serviceVat += (amt * (Number(l.tax_rate_percent) || 0)) / 100;
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  const ht = r(service + disbursement);
  const vat = r(r(serviceVat) + r(upstream));
  return {
    service_cost: r(service),
    disbursement_total: r(disbursement),
    total_ht: ht,
    vat_total: vat,
    total_ttc: r(ht + vat),
    upstream_vat_total: r(upstream),
  };
}