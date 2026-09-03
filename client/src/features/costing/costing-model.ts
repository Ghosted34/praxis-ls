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
  /** The supplier's own VAT inside a pass-through gross — disclosed, never
   *  charged. Only ever set on a disbursement line. */
  upstream_vat_amount?: number | null;
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
  upstream_vat_amount: l.is_disbursement ? (l.upstream_vat_amount ?? null) : null,
});

/**
 * The footer arithmetic, computed the same way the server computes it.
 *
 * Disbursements are pass-through: billed at cost, never taxed. Their upstream
 * VAT is DISCLOSED alongside and is in no total — the client pays the
 * supplier's exact gross, and that money was never ours to collect.
 */
export function computeTotals(lines: LineDraft[]) {
  let service = 0;
  let disbursement = 0;
  let vat = 0;
  let upstream = 0;
  for (const l of lines) {
    const amt = (Number(l.qty) || 0) * (Number(l.unit_cost) || 0);
    if (l.is_disbursement) {
      disbursement += amt;
      upstream += Number(l.upstream_vat_amount) || 0;
    } else {
      service += amt;
      vat += (amt * (Number(l.tax_rate_percent) || 0)) / 100;
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  const ht = r(service + disbursement);
  return {
    service_cost: r(service),
    disbursement_total: r(disbursement),
    total_ht: ht,
    vat_total: r(vat),
    total_ttc: r(ht + r(vat)),
    upstream_vat_total: r(upstream),
  };
}