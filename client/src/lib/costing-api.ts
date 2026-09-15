/**
 * Costing API helpers — costing sheets, cost tracking (actuals), cash requests,
 * régie d'avance. Routes mirror src/modules/costing/*.
 */
import { tenant } from "./api-client";
import type { ShipmentDetails } from "./operations-api";

/* ── Costing sheets(/costings) ── */
/** `container_type_ref_id` (0663) records which box the charge was priced for.
 *  NULL for anything with no equipment dimension, which is most of the
 *  catalogue; the joined `container_type_*` fields are read-only display. */
export type CostingLine = {
  costing_line_id?: string;
  dictionary_item_id?: string;
  label?: string;
  qty?: number;
  unit_cost?: number;
  is_disbursement?: boolean;
  /** §3.3 — the per-line VAT toggle the legacy sheet had (save.php:84). */
  tax_code_id?: string | null;
  /** Joined by the repo for totals — the line's own VAT rate. */
  tax_rate_percent?: number | null;
  container_type_ref_id?: string | null;
  container_type_code?: string | null;
  container_type_en?: string | null;
  container_type_fr?: string | null;
  /** 12766 — the sheet's order. Lines used to read by uuid and reshuffle on
   *  every save; the server assigns this from the order lines are sent in. */
  line_no?: number;
  /** 12766 — the supplier's own VAT inside a débours (the 19,250 in a 119,250
   *  Maersk demurrage invoice). 12768: now BUDGETED into the sheet's VAT and
   *  TTC (a costing is a cash budget, not a fiscal invoice), marked (PT). Only
   *  ever set on a disbursement line. */
  upstream_vat_amount?: number | null;
  /** 12768 — the rate a débours was priced at (default TVA_STD 19.25). The
   *  amount above is derived from it; NULL means the amount was typed by hand
   *  or the line carries no VAT. Only ever set on a disbursement line. */
  upstream_vat_rate_percent?: number | null;
  /** Joined for display: what the catalogue says about this charge. */
  item_code?: string | null;
  unit_of_measure?: string | null;
  subcategory?: string | null;
  tax_code?: string | null;
  disbursement_vat_transparent?: boolean | null;
  varies_by_equipment?: boolean | null;
};
export type Costing = {
  costing_id: string;
  ref?: string | null;
  doc_number?: string | null;
  dossier_id?: string | null;
  currency?: string;
  /** DEPRECATED (§2.2): still present on historical rows; never written. */
  margin_percent?: number | null;
  total_cost?: number | null;
  total?: number | null;
  /** HT / VAT / TTC — the whole footer (§2.2). Present on GET /costings/:id. */
  totals?: {
    service_cost: number;
    disbursement_total: number;
    total_ht: number;
    vat_total: number;
    total_ttc: number;
    total_cost: number;
    /** A memo, now inside vat_total (12768): the part of the VAT that is the
     *  supplier's own on débours (PT). See CostingLine. */
    upstream_vat_total: number;
    /** The sheet converted at its own stored rate; the only figure any
     *  cross-costing sum may use. */
    total_ttc_xaf: number;
  };
  status: string;
  created_at?: string;
  exchange_rate_to_xaf?: number | string | null;
  /** §3.3 — worksheet notes + the named validator (legacy save.php parity). */
  remarks?: string | null;
  validator_id?: string | null;
  validator_assigned_at?: string | null;
  lines?: CostingLine[];
  /** Unlock audit trail (10718). Present once a reopening has been asked for. */
  unlock_reason?: string | null;
  unlock_requested_at?: string | null;
  unlocked_at?: string | null;
  /** 12766 — totals stored on the row, so the registry can show money without
   *  fetching every line of every sheet. `total`/`total_cost` above never
   *  existed as columns, which is why the registry's Total column was blank. */
  total_ht?: number | null;
  total_vat?: number | null;
  total_ttc?: number | null;
  total_ttc_xaf?: number | null;
  /** 12766 — who actually did it, and when. `validator_id` is who the sheet was
   *  addressed TO; `validated_by` is who validated it, and they differ whenever
   *  somebody stands in. */
  validated_by?: string | null;
  validated_at?: string | null;
  approver_id?: string | null;
  approved_at?: string | null;
  locked_at?: string | null;
  /** Joined by the registry query for the list columns. */
  dossier_ref?: string | null;
  client_name?: string | null;
  service_type_key?: string | null;
  service_name_en?: string | null;
  service_name_fr?: string | null;
  /** 12766 — what moved since this sheet was last approved. Present only on a
   *  sheet approved before and since changed, which is exactly when somebody is
   *  about to be asked to approve it again. */
  amendment?: CostingAmendment | null;
  /** The operations file this sheet is costing. The worksheet renders from the
   *  RESPONSE (FRONTEND_GUIDE §3.11), because a sheet opened from a pasted link
   *  has a uuid and nothing else. Present on GET /costings/:id. */
  file?: CostingFile | null;
  /** The file's equipment, one entry per container type with its count — the
   *  same rows marks & numbers is generated from. */
  containers?: {
    container_type_ref_id: string;
    qty: number;
    container_type_code?: string | null;
    container_type_en?: string | null;
    container_type_fr?: string | null;
  }[];
  /** The shipment facts, frozen if the sheet was approved and live if it is
   *  still being worked on — a pricer prices the SHIPMENT, not a list of codes. */
  shipment_details?: ShipmentDetails | null;
  /** Which of the two was used. A document that cannot tell you whether it is
   *  current or historic is how the legacy reprint problem went unnoticed. */
  shipment_details_source?: "SNAPSHOT" | "LIVE" | null;
};

/** The file a costing belongs to, as the sheet's header needs it. */
export type CostingFile = {
  dossier_id: string;
  ref: string;
  client_name?: string | null;
  service_type_id?: string | null;
  service_type_key?: string | null;
  service_name_en?: string | null;
  service_name_fr?: string | null;
  rate_provider_id?: string | null;
  rate_provider_name?: string | null;
};

/** One line in the amendment block, as the re-approver reads it. */
export type CostingAmendmentLine = {
  key: string;
  dictionary_item_id?: string | null;
  container_type_ref_id?: string | null;
  label: string;
  qty: number;
  unit_cost: number;
  is_disbursement: boolean;
  amount: number;
  delta: number;
  was_qty?: number;
  was_unit_cost?: number;
  was_amount?: number;
};

/**
 * The diff against the last approval. Unchanged lines are COUNTED, not listed —
 * the block's value is that an approver reads three rows rather than fourteen.
 */
export type CostingAmendment = {
  added: CostingAmendmentLine[];
  changed: CostingAmendmentLine[];
  removed: CostingAmendmentLine[];
  unchanged_count: number;
  before_ht: number;
  after_ht: number;
  delta_ht: number;
  delta_percent: number | null;
  has_changes: boolean;
  since_revision: number;
  approved_at: string;
};
export type CostingInput = {
  dossier_id: string;
  currency?: string;
  exchange_rate_to_xaf?: number;
  remarks?: string | null;
  validator_id?: string | null;
  lines?: CostingLine[];
};
/** Registry filter (12766) — mirrors legacy's list.php: a text search across
 *  reference / file / client, a status, a currency, and a date window. */
export type CostingListQuery = {
  dossier_id?: string;
  status?: string;
  currency?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};
const qs = (query: Record<string, unknown> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
};
export const listCostings = (query: CostingListQuery = {}) =>
  tenant<Costing[]>(`/costings${qs(query as Record<string, unknown>)}`);

/** Counts by status and total TTC in XAF, over the SAME filter the page used —
 *  so "Approved: 3" means three matching sheets, not three on this page. */
export type CostingKpis = {
  total: number;
  draft: number;
  to_validate: number;
  to_approve: number;
  approved: number;
  unlock_requested: number;
  total_ttc_xaf: number;
};
export const costingKpis = (query: CostingListQuery = {}) =>
  tenant<CostingKpis>(`/costings/kpis${qs(query as Record<string, unknown>)}`);

/* ── Suggest (12766) ── */

/** One proposed line. Nothing is saved until the person picks it. */
export type SuggestedLine = {
  dictionary_item_id: string;
  item_code: string;
  label: string;
  label_fr?: string | null;
  subcategory?: string | null;
  unit_of_measure?: string | null;
  is_disbursement: boolean;
  is_billable: boolean;
  disbursement_vat_transparent: boolean;
  tax_code_id: string | null;
  tax_code: string | null;
  tax_rate_percent: number | null;
  tier: "BASIC" | "ADVANCED" | "FULL";
  sort_order: number;
  container_type_ref_id: string | null;
  container_type_code: string | null;
  container_type_label: string | null;
  /** null = nothing on the file can tell us (a per-day charge); the person types it. */
  qty: number | null;
  qty_basis: "CONTAINERS" | "GROSS_WEIGHT" | "VOLUME" | "PACKAGES" | "DEFAULT" | "TYPED";
  needs_equipment?: boolean;
  /** null = no rate on file and no catalogue default — badged "needs a price". */
  unit_cost: number | null;
  currency: string | null;
  price_source: "EXPENSE_RATE" | "CATALOGUE_DEFAULT" | "NONE";
  price_note: string | null;
  expense_rate_id: string | null;
  effective_from: string | null;
  rate_scope: "CARRIER_AND_TYPE" | "CARRIER" | "TYPE" | "DEFAULT" | null;
};

/**
 * The proposal, banded by tier.
 *
 * Banded rather than flat because the tiers NEST (BASIC ⊆ ADVANCED ⊆ FULL):
 * three tabs would show the same charge three times.
 */
export type CostingSuggestion = {
  file: {
    dossier_id: string;
    ref: string;
    client_name: string | null;
    service_type_id: string;
    service_type_key: string | null;
    service_name_en: string | null;
    service_name_fr: string | null;
    rate_provider_id: string | null;
    rate_provider_name: string | null;
    containers: { container_type_ref_id: string; code: string; label: string; qty: number }[];
  };
  tier: "BASIC" | "ADVANCED" | "FULL";
  bands: { tier: "BASIC" | "ADVANCED" | "FULL"; lines: SuggestedLine[] }[];
  counts: {
    total: number;
    priced: number;
    needs_price: number;
    needs_quantity: number;
    disbursements: number;
  };
  defaults: {
    tax_code_id: string | null;
    tax_code: string | null;
    tax_rate_percent: number | null;
    /** Surfaced so the wizard can say WHY no VAT is offered rather than looking
     *  broken on a franchise-regime entity. */
    vat_regime: string | null;
    priced_on: string;
  };
};

export const suggestCostingLines = (
  dossierId: string,
  tier: "BASIC" | "ADVANCED" | "FULL" = "FULL",
) => tenant<CostingSuggestion>(`/costings/suggest${qs({ dossier_id: dossierId, tier })}`);

/** DRAFT-only, server-side. The screen has never called this; the worksheet
 *  in PR 2 does. */
export const updateCosting = (id: string, body: Partial<CostingInput>) =>
  tenant<Costing>(`/costings/${id}`, { method: "PATCH", body });
export const getCosting = (id: string) => tenant<Costing>(`/costings/${id}`);
export const createCosting = (body: CostingInput) =>
  tenant<Costing>("/costings", { method: "POST", body });
// The backend expects an ACTION verb under `to` (not a status under `status`):
// SUBMIT_VALIDATION → SUBMITTED_FOR_VALIDATION, SUBMIT_APPROVAL →
// SUBMITTED_FOR_APPROVAL, APPROVE → APPROVED_LOCKED, REJECT → REJECTED.
export type CostingAction =
  "SUBMIT_VALIDATION" | "SUBMIT_APPROVAL" | "APPROVE" | "REJECT";
export const setCostingStatus = (id: string, to: CostingAction) =>
  tenant<Costing>(`/costings/${id}/status`, { method: "POST", body: { to } });

/**
 * The unlock loop (10718) — the way out of APPROVED_LOCKED.
 *
 * A separate endpoint from `/status`, not a fifth `to` value: `setStatus`
 * refuses every transition out of a locked status by design, and unlock works
 * around that guard rather than through it.
 *
 * `reason` is required for REQUEST_UNLOCK and ignored for the two decisions.
 *
 * No invoice status blocks it (12766). A costing is a BUDGET, and what the
 * client was billed says nothing about whether what the file cost us is still
 * correctly stated — a carrier detention charge arriving a week after the
 * invoice has to land on the file's budget before it can be paid and re-billed.
 */
export type UnlockAction = "REQUEST_UNLOCK" | "UNLOCK" | "DENY_UNLOCK";
export const unlockCosting = (
  id: string,
  action: UnlockAction,
  reason?: string,
) =>
  tenant<Costing>(`/costings/${id}/unlock`, {
    method: "POST",
    body: reason ? { action, reason } : { action },
  });

/* ── Cost tracking(/cost-tracking) — actuals per dossier ── */
export type CostEntry = {
  cost_entry_id?: string;
  dossier_id: string;
  label?: string;
  amount: number;
  category?: string;
  entry_date?: string;
  is_disbursement?: boolean;
};
export type CostEntryInput = {
  dossier_id: string;
  entity_id: string;
  dictionary_item_id?: string;
  amount: number;
  category?: string;
  is_disbursement?: boolean;
  expense_coa?: string;
  treasury_coa?: string;
  entry_date: string;
};
export const costEntriesByDossier = (dossierId: string) =>
  tenant<CostEntry[]>(`/cost-tracking/dossier/${dossierId}`);
/** One row of the portfolio sheet — a dossier with its budget, actual and coverage. */
export type CostPortfolioRow = {
  dossier_id: string;
  ref?: string | null;
  dossier_status?: string | null;
  bl_mawb?: string | null;
  eta?: string | null;
  ata?: string | null;
  pol?: string | null;
  pod?: string | null;
  client_name?: string | null;
  service_type?: string | null;
  budget: number;
  actual: number;
  variance: number;
  variance_percent: number | null;
  over_budget: boolean;
  advance_received: number;
  advance_applied: number;
  balance: number;
  coverage_percent: number | null;
};
export type CostPortfolioKpis = {
  files_tracked: number;
  over_budget: number;
  total_budget: number;
  total_actual: number;
  total_variance: number;
  total_advance_received: number;
  total_balance: number;
  overall_coverage_percent: number | null;
};
/** Portfolio-wide cost tracking — the legacy master sheet, restored. */
export const costPortfolio = () =>
  tenant<CostPortfolioRow[]>("/cost-tracking/portfolio");
export const costPortfolioKpis = () =>
  tenant<CostPortfolioKpis>("/cost-tracking/kpis");

export const reconcileDossier = (dossierId: string) =>
  tenant<Record<string, unknown>>(
    `/cost-tracking/dossier/${dossierId}/reconcile`,
  );
export const recordCostEntry = (body: CostEntryInput) =>
  tenant<CostEntry>("/cost-tracking", { method: "POST", body });

/* ── §3.4 — master-ledger matrix, bulk entry, advances ─────────────── */
/** One column of the matrix: derived from the dictionary items that carry
 *  spend, never a fixed list (the legacy hardcoded 15 in PHP). */
export type MatrixItem = {
  dictionary_item_id: string | null;
  code: string;
  label: string;
};
export type MatrixRow = {
  dossier_id: string;
  ref?: string;
  client_name?: string | null;
  budget: number;
  actual: number;
  advance_received: number;
  balance: number;
  over_budget?: boolean;
  /** dictionary_item_id (or "OTHER") → actual spend for that item. */
  cells: Record<string, number>;
  total_spend: number;
  total_balance: number;
};
export const costMatrix = () =>
  tenant<{ items: MatrixItem[]; rows: MatrixRow[] }>("/cost-tracking/matrix");

export type BulkCostLine = {
  dictionary_item_id?: string | null;
  category?: string | null;
  amount: number;
  is_disbursement?: boolean;
};
/** The whole sheet in one transaction — never 15 round trips. */
export const bulkRecordCosts = (body: {
  dossier_id: string;
  entity_id: string;
  entry_date: string;
  source_doc_ref: string;
  lines: BulkCostLine[];
}) =>
  tenant<{ recorded: number }>("/cost-tracking/bulk", {
    method: "POST",
    body,
  });

/** Advances are per FILE (owner-decided); allocation to an item is optional. */
export type AdvanceAllocation = {
  advance_allocation_id: string;
  dictionary_item_id: string;
  item_code?: string | null;
  item_label?: string | null;
  amount: number;
  note?: string | null;
};
export type DossierAdvance = {
  advance_id: string;
  amount: number;
  received_on?: string;
  applied_amount: number;
  allocations: AdvanceAllocation[];
};
export const dossierAdvances = (dossierId: string) =>
  tenant<DossierAdvance[]>(`/cost-tracking/dossier/${dossierId}/advances`);
export const allocateAdvance = (
  advanceId: string,
  body: { dictionary_item_id: string; amount: number; note?: string | null },
) =>
  tenant<AdvanceAllocation>(`/cost-tracking/advances/${advanceId}/allocations`, {
    method: "POST",
    body,
  });
export const removeAdvanceAllocation = (allocationId: string) =>
  tenant<AdvanceAllocation>(`/cost-tracking/allocations/${allocationId}`, {
    method: "DELETE",
  });

/* ── Budget Reconciliation (/costing/reconciliations) — MOD-76 ────────────
 *
 * ONE reconciliation per operations file, for ever (owner decision Q6). It does
 * not close; it settles, and re-opens when the costing is amended or more cash
 * goes out. Every amount is TTC (Q4) — the question is a CASH question: "we
 * disbursed 119 250, is that what you spent?"
 *
 * The grid is PROJECTED from the file's approved costing lines, so a line the
 * costing gained five minutes ago is already here and a line nobody has touched
 * still renders. There is no draft-it step and no create call. */

/** One budget line. `budget_ttc`, `committed` and `disbursed` are derived from
 *  the costing and the cash requests; only `actual_ttc`, `spent_on`,
 *  `variance_reason` and `returned_amount` are ever typed by a person. */
export type ReconLine = {
  costing_line_id: string;
  /** Null until somebody has typed something against this line — the row is
   *  created on first edit, so the grid is wider than the stored table. */
  line_id: string | null;
  line_no: number;
  label: string;
  item_code?: string | null;
  item_label?: string | null;
  container_type_code?: string | null;
  dictionary_item_id?: string | null;
  is_disbursement: boolean;
  qty: number;
  unit_cost: number;
  net: number;
  vat: number;
  budget_ttc: number;
  committed: number;
  pending: number;
  disbursed: number;
  actual_ttc: number;
  /** DERIVED = nobody has looked; the grid is showing what was disbursed as a
   *  hypothesis. CONFIRMED = a person agreed with it. OVERRIDDEN = replaced. */
  actual_source: "DERIVED" | "CONFIRMED" | "OVERRIDDEN";
  spent_on?: string | null;
  /** Positive = under budget. Negative is the overspend needing a reason. */
  variance: number;
  variance_reason?: string | null;
  /** Shared by every line one reason was applied to at once (Q12). */
  reason_group_id?: string | null;
  returned_amount: number;
  /** Disbursed − actual − returned: what the holder still has to account for. */
  outstanding: number;
  justification_required: boolean;
  document_count: number;
  funded: boolean;
  over_budget: boolean;
  reason_required: boolean;
  reason_missing: boolean;
  proof_missing: boolean;
  documents?: ReconDocument[];
  updated_at?: string | null;
  updated_by?: string | null;
};

/** Proof that a budget line was spent as claimed. MANY per line (Q8): the first
 *  demurrage invoice covers one day, the second covers two, and both belong. */
export type ReconDocument = {
  recon_document_id: string;
  line_id: string;
  doc_id: string;
  costing_line_id: string;
  note?: string | null;
  doc_type?: string | null;
  doc_status?: string | null;
  uploaded_by?: string | null;
  uploaded_by_name?: string | null;
  uploaded_at?: string;
};

export type ReconTotals = {
  budget_ttc: number;
  committed: number;
  disbursed: number;
  actual_ttc: number;
  returned: number;
  outstanding: number;
  variance: number;
  lines: number;
  lines_over_budget: number;
  reasons_missing: number;
  proofs_missing: number;
  /** The one HT figure in the module — service costs, débours excluded,
   *  derived at read. A management indicator, not the number that settles. */
  actual_ht: number;
  margin_ht: number | null;
};

/** Three verdicts, because they come apart: a file executed well against a
 *  budget that was quoted too cheap is within budget AND a loss. */
export type ReconGrades = {
  execution: { key: string; label: string; percent: number | null };
  accountability: { key: string; label: string; amount: number };
  commercial: { key: string; label: string; percent: number | null };
};

export type ReconBlocker = {
  costing_line_id: string;
  label: string;
  kind: "REASON" | "PROOF";
  detail: string;
};

export type ReconStatus = "OPEN" | "SUBMITTED" | "SETTLED";

export type ReconSheet = {
  dossier_id: string;
  reconciliation_id: string | null;
  status: ReconStatus;
  revision?: number;
  currency?: string;
  exchange_rate_to_xaf?: number;
  costing?: {
    costing_id: string;
    doc_number?: string | null;
    status: string;
    currency?: string;
  } | null;
  /** False when the file has no APPROVED_LOCKED costing — there is no budget to
   *  reconcile against, and `blocked_reason` says so in words. */
  can_reconcile: boolean;
  blocked_reason: string | null;
  lines: ReconLine[];
  documents?: ReconDocument[];
  settlements?: Array<{
    settlement_id: string; revision: number;
    budget_ttc: number; disbursed_ttc: number; actual_ttc: number; returned_ttc: number;
    settled_at?: string; settled_by?: string | null;
  }>;
  allowance: { amount: number; percent: number };
  blockers?: ReconBlocker[];
  totals: ReconTotals;
  grades: ReconGrades;
  submitted_by?: string | null;
  submitted_at?: string | null;
  settled_by?: string | null;
  settled_at?: string | null;
  returned_total?: number;
  reject_reason?: string | null;
  reopened_reason?: string | null;
};

/** Receipts a person owes — "Cash to account for". */
export type ReceiptsOwed = {
  count: number;
  total_ttc: number;
  items: Array<{
    dossier_id: string;
    dossier_ref: string;
    costing_line_id: string;
    line_label: string;
    owed_by: string;
    owed_by_name?: string | null;
    reconciliation_id?: string | null;
    claimed_ttc: number;
  }>;
};

const RECON = "/costing/reconciliations";

export const getReconciliation = (dossierId: string) =>
  tenant<ReconSheet>(`${RECON}/${encodeURIComponent(dossierId)}`);

/** Record what was actually spent against one budget line. An omitted field is
 *  left alone; an explicit null clears it. */
export const patchReconLine = (
  dossierId: string,
  costingLineId: string,
  body: {
    actual_ttc?: number;
    spent_on?: string | null;
    variance_reason?: string | null;
    returned_amount?: number;
  },
) =>
  tenant<ReconSheet>(`${RECON}/${dossierId}/lines/${costingLineId}`, {
    method: "PATCH",
    body,
  });

/** One reason, several lines — a customs delay moves demurrage, port storage
 *  and yard occupancy together, and that is one sentence typed once (Q12). */
export const applyReconReason = (
  dossierId: string,
  reason: string,
  costingLineIds: string[],
) =>
  tenant<ReconSheet>(`${RECON}/${dossierId}/reasons`, {
    method: "POST",
    body: { reason, costing_line_ids: costingLineIds },
  });

export const attachReconDocument = (
  dossierId: string,
  costingLineId: string,
  docId: string,
  note?: string,
) =>
  tenant<ReconSheet>(`${RECON}/${dossierId}/lines/${costingLineId}/documents`, {
    method: "POST",
    body: { doc_id: docId, note },
  });

export const detachReconDocument = (
  dossierId: string,
  costingLineId: string,
  docId: string,
) =>
  tenant<ReconSheet>(`${RECON}/${dossierId}/lines/${costingLineId}/documents/${docId}`, {
    method: "DELETE",
  });

export const submitReconciliation = (dossierId: string, note?: string) =>
  tenant<ReconSheet>(`${RECON}/${dossierId}/submit`, { method: "POST", body: { note } });

export const rejectReconciliation = (dossierId: string, reason: string) =>
  tenant<ReconSheet>(`${RECON}/${dossierId}/reject`, { method: "POST", body: { reason } });

/** Finance settles: records what came back to the vault and stamps the file. */
export const settleReconciliation = (
  dossierId: string,
  returned?: Record<string, number>,
) =>
  tenant<ReconSheet>(`${RECON}/${dossierId}/settle`, { method: "POST", body: { returned } });

export const myReceiptsOwed = () => tenant<ReceiptsOwed>(`${RECON}/owed`);
export const allReceiptsOwed = () => tenant<ReceiptsOwed>(`${RECON}/owed/all`);

/* ── The budget a costing authorises (/costings/:id/budget) ── */

/**
 * One budget line and what is left of it (12771).
 *
 * `remaining` MAY BE NEGATIVE: a costing line amended below what is already
 * committed reads over-consumed rather than clamping at zero, because the clamp
 * would hide the one row somebody has to act on.
 *
 * `disbursed` is APPORTIONED — instalments are paid against the request, not
 * its lines — so it is a display figure and nothing is gated on it.
 */
export type BudgetLine = {
  costing_line_id: string;
  line_no: number;
  label: string;
  item_code?: string | null;
  dictionary_item_id?: string | null;
  container_type_code?: string | null;
  is_disbursement?: boolean;
  qty: number;
  unit_cost: number;
  net: number;
  vat: number;
  budget: number;
  committed: number;
  pending: number;
  disbursed: number;
  remaining: number;
  over_committed: boolean;
};

export type CostingBudget = {
  costing_id: string;
  doc_number?: string | null;
  dossier_id?: string | null;
  status: string;
  revision: number;
  currency: string;
  exchange_rate_to_xaf: number;
  /** APPROVED_LOCKED. The gate a cash request applies, answered here so the
   *  screen can explain itself before the user meets a 403. */
  can_fund: boolean;
  lines: BudgetLine[];
  totals: {
    budget: number;
    committed: number;
    pending: number;
    disbursed: number;
    remaining: number;
    over_committed_lines: number;
  };
};

/**
 * The budget ledger for one costing.
 *
 * `for_cash_request` leaves THAT request out of every total — the difference
 * between "how much was available to me" and "how much is left now". Without
 * it an approved request is measured against a balance it is itself inside.
 */
/* ── The costing gate (12774) ──────────────────────────────────────────────
 *
 * Everything the cash-request dialog needs to answer "can this file be funded,
 * and if not, who is holding it up?" — in ONE call made the moment a file is
 * picked. Three round trips to paint a status line is how a dialog comes to
 * feel slow.
 */
export type CostingGate = {
  dossier_id: string;
  /** `null` when the file has no costing at all — a real answer, not an error. */
  costing: {
    costing_id: string;
    doc_number: string | null;
    status: string;
    status_words: { fr: string; en: string };
    total_ttc: number | null;
    currency: string | null;
  } | null;
  can_fund?: boolean;
  /** The sheet is a DRAFT with nobody named to validate it; submitting refuses
   *  without one, so the screen asks first rather than showing a button that
   *  fails. */
  needs_validator?: boolean;
  stage?: "VALIDATION" | "APPROVAL" | null;
  awaiting?: {
    user_id: string | null;
    name: string | null;
    role_id: string | null;
    role_name: string | null;
  } | null;
  nudges_used?: number;
  nudges_remaining?: number;
  nudge_limit?: number;
};
export const costingGate = (dossierId: string) =>
  tenant<CostingGate>(`/costings/gate?dossier_id=${encodeURIComponent(dossierId)}`);

/** What a reminder send answers with — including what is left of today's quota. */
export type NudgeResult = {
  sent: number;
  stage: "VALIDATION" | "APPROVAL";
  nudges_used: number;
  nudges_remaining: number;
  nudge_limit: number;
};
/** Chase whoever is holding a pending costing. Three a day (12774); the server
 *  answers 429 rather than silently doing nothing. */
export const nudgeCosting = (id: string) =>
  tenant<NudgeResult>(`/costings/${id}/nudge`, { method: "POST", body: {} });

export const getCostingBudget = (costingId: string, forCashRequest?: string) =>
  tenant<CostingBudget>(
    `/costings/${costingId}/budget${forCashRequest ? `?for_cash_request=${forCashRequest}` : ""}`,
  );

/* ── Cash requests(/cash-requests) ── */
export type CashLine = {
  /** 12771 — round-tripped so an edit is unambiguous even when the label and
   *  the amount both change. Absent means a new line. */
  cash_request_line_id?: string;
  /** 12771 — the BUDGET LINE this claim draws down. Required on every line of
   *  an OPS request before it can be submitted: no money leaves without a
   *  costing. NULL on an overhead request, which has no operations file. */
  costing_line_id?: string | null;
  dictionary_item_id?: string | null;
  label?: string;
  /** 12771 — the legacy line shape, back. `budget_amount` alone still works
   *  and is read as 1 × that amount. */
  qty?: number;
  unit_cost?: number;
  budget_amount?: number;
  spent_amount?: number;
  /** Set only by CLOSE_BALANCE: this line's share of what was actually paid. */
  settled_amount?: number | null;
  is_disbursement?: boolean;
  source?: "IMPORTED" | "MANUAL";
  /** §3.5 — legacy per-line VAT % and "Just. Req?" (10746). */
  vat_percent?: number | null;
  justification_required?: boolean;
};
export type DisbursementMethod = "CASH" | "BANK" | "CHEQUE" | "MOMO";
export type CashRequestStatus =
  | "DRAFT" | "SUBMITTED" | "VALIDATED" | "APPROVED"
  | "PARTIALLY_DISBURSED" | "DISBURSED" | "CLOSED_SHORT"
  | "JUSTIFIED" | "REJECTED";

export type CashRequest = {
  cash_request_id: string;
  ref?: string | null;
  doc_number?: string | null;
  dossier_id?: string | null;
  costing_id?: string | null;
  status: string;
  total_budget?: number | null;
  /** Σ of the payment rows (10719). Derived server-side, never set by hand. */
  disbursed_amount?: number | null;
  amount?: number | null;
  beneficiary?: string | null;
  category?: string | null;
  cost_center?: string | null;
  overhead_justification?: string | null;
  remarks?: string | null;
  /** §3.5 — how the money leaves (10746); details are method-specific. */
  disbursement_method?: DisbursementMethod | null;
  disbursement_details?: Record<string, string> | null;
  /** §3.5 — the voucher footer, derived server-side on GET /:id. */
  totals?: { subtotal: number; vat_total: number; total_payable: number };
  /** 12771 — the money unit. An OPS request inherits the costing's. */
  currency?: string | null;
  exchange_rate_to_xaf?: number | null;
  amount_xaf?: number | null;
  /** 12771 — attribution the row never carried. */
  approved_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  over_budget_reason?: string | null;
  settled_at?: string | null;
  settlement_reason?: string | null;
  costing_revision?: number | null;
  created_at?: string;
};

/**
 * What a validator and an approver read before they act (12771, owner Q20).
 *
 * Finance validates against the budget, so "is this file budgeted for, and is
 * this request inside it?" has to be answerable on the screen the decision is
 * taken on. Null on an overhead request, which has no costing — and null if the
 * ledger could not be read, because an unreadable budget must not make the
 * request unreadable.
 */
export type BudgetControl = {
  costing_id: string | null;
  costing_doc_number: string | null;
  costing_status: string | null;
  can_fund?: boolean;
  currency?: string;
  budget_total: number;
  committed_elsewhere: number;
  remaining_before: number;
  claimed_here: number;
  remaining_after: number;
  unbudgeted_line_count: number;
  breaches: {
    costing_line_id: string;
    label: string | null;
    claim: number;
    remaining: number;
    excess: number;
  }[];
  is_over_budget: boolean;
};

/** One instalment. The receipt is per tranche: each is handed over separately. */
export type CashPayment = {
  cash_request_payment_id: string;
  amount: number;
  paid_on: string;
  memo?: string | null;
  regie_advance_id?: string | null;
  treasury_account_id?: string | null;
  received_by?: string | null;
  received_at?: string | null;
  received_ack_kind?: "IN_APP" | "WET_SCAN" | null;
  created_at?: string;
};
export type CashRequestInput = {
  dossier_id?: string;
  costing_id?: string;
  requested_by?: string;
  beneficiary?: string;
  category?: "OPS" | "OVH";
  cost_center?: string;
  overhead_justification?: string;
  remarks?: string;
  disbursement_method?: DisbursementMethod;
  disbursement_details?: Record<string, string>;
  /** 12771 — an OPS request INHERITS the costing's currency; these are for an
   *  overhead request, which has no costing to inherit from. */
  currency?: string;
  exchange_rate_to_xaf?: number;
  lines?: CashLine[];
};
export const listCashRequests = () => tenant<CashRequest[]>("/cash-requests");
export const createCashRequest = (body: CashRequestInput) =>
  tenant<CashRequest>("/cash-requests", { method: "POST", body });
/** Import the budget lines from the linked APPROVED_LOCKED costing (10720). */
export const importCostingLines = (id: string) =>
  tenant<CashRequestDetail>(`/cash-requests/${id}/import-costing`, {
    method: "POST",
    body: {},
  });
/**
 * Advance the request one step. 12771 adds two arguments and one destination:
 *
 *   `reason`             REQUIRED to reject — a rejection with no explanation
 *                        is the one thing the requester cannot act on.
 *   `over_budget_reason` REQUIRED to submit a claim over what the budget has
 *                        left. It may still not be APPROVED: the reason tells
 *                        the approver to go and amend the costing.
 *   `"DRAFT"`            reopens a rejected request, keeping its reference.
 */
export const transitionCashRequest = (
  id: string,
  to: "SUBMITTED" | "VALIDATED" | "APPROVED" | "REJECTED" | "DRAFT",
  extra: {
    entity_id?: string;
    date?: string;
    reason?: string;
    over_budget_reason?: string;
  } = {},
) =>
  tenant<CashRequest>(`/cash-requests/${id}/transition`, {
    method: "POST",
    body: { to, ...extra },
  });

/** One cash request with its lines and payments. */
export const getCashRequest = (id: string) =>
  tenant<CashRequestDetail>(`/cash-requests/${id}`);

export type CashRequestDetail = CashRequest & {
  requested_by?: string | null;
  regie_advance_id?: string | null;
  amount?: number | null;
  lines?: CashLine[];
  payments?: CashPayment[];
  /** 12771 — the budgetary control block. Null for an overhead request. */
  budget_control?: BudgetControl | null;
};

/**
 * Disburse an APPROVED request, in full or as one instalment (10719).
 *
 * `amount` is optional and defaults server-side to the whole outstanding
 * balance, so a single full payment is unchanged for callers. Each instalment
 * issues its OWN régie advance — two payments a fortnight apart are two
 * advances, each with its own policy window and aging clock — and the link
 * lives on the payment row.
 *
 * `treasury_coa` is not sent on purpose so the server resolves it from
 * ('finance','accounts'); passing one from the browser would hardcode an
 * account number into the client.
 */
export const disburseCashRequest = (
  id: string,
  body: {
    /** Omit to pay the whole outstanding balance (the common case). */
    amount?: number;
    entity_id: string;
    entry_date: string;
    source_doc_ref?: string;
    holder_user_id?: string | null;
    memo?: string;
  },
) =>
  tenant<{ cash_request: CashRequest; regie_advance_id: string | null }>(
    `/cash-requests/${id}/disburse`,
    { method: "POST", body },
  );

/**
 * Justify a DISBURSED request: record actual spend per line and RETIRE the
 * linked régie advance in the same transaction.
 *
 * Since Landing A this is the only thing that closes the advance. If the
 * remainder is still open the server refuses with ADVANCE_NOT_CLEARED — the
 * holder returns the unspent cash on the advance itself first.
 */
/**
 * Settle a part-paid request at what actually moved (12771, owner Q15).
 *
 * Releases the unpaid commitment back to the file's budget — without it a
 * request holds budget for ever against cash that will never move. A decision,
 * so the server demands a written reason.
 */
export const closeCashRequestBalance = (id: string, reason: string) =>
  tenant<CashRequest & { paid: number; released_to_budget: number }>(
    `/cash-requests/${id}/close-balance`,
    { method: "POST", body: { reason } },
  );

/**
 * The régie holder acknowledging that they took ONE instalment — the third
 * signature on the voucher (owner Q13).
 *
 * Per payment, not per request: each tranche is handed over separately, and the
 * legacy's single `disbursed_time` on the header is the shape that cannot say
 * who took the second one.
 */
export const acknowledgeCashReceipt = (
  id: string,
  paymentId: string,
  body: { ack_kind?: "IN_APP" | "WET_SCAN"; received_by?: string | null } = {},
) =>
  tenant<CashPayment>(`/cash-requests/${id}/payments/${paymentId}/receipt`, {
    method: "POST",
    body,
  });

/** Edit a DRAFT request. The route has existed since the module shipped and had
 *  no caller at all until the worksheet (12771). */
export const updateCashRequest = (
  id: string,
  body: Partial<CashRequestInput> & { lines?: CashLine[] },
) => tenant<CashRequestDetail>(`/cash-requests/${id}`, { method: "PATCH", body });

/** The KPI strip, over the same filter the page used — so "Approved: 3" means
 *  three matching requests, not three on this page. */
export const cashRequestKpis = () =>
  tenant<{
    total: number; draft: number; to_validate: number; to_approve: number;
    to_disburse: number; partially_disbursed: number; disbursed: number;
    justified: number; rejected: number;
    disbursed_total_xaf: number; outstanding_xaf: number;
  }>("/cash-requests/kpis");

export const justifyCashRequest = (
  id: string,
  body: { lines: CashLine[]; entity_id?: string; entry_date?: string },
) =>
  tenant<CashRequestDetail>(`/cash-requests/${id}/justify`, {
    method: "POST",
    body,
  });

/* ── Régie d'avance(/regie) ── */
export type Regie = {
  regie_advance_id: string;
  ref?: string | null;
  doc_number?: string | null;
  holder_user_id?: string | null;
  amount?: number | null;
  state?: string | null;
  status?: string | null;
  issued_on?: string | null;
  created_at?: string;
  /** Frozen onto the row at issue from `finance.regie.policy_window_days`, so a
   *  later change to the tenant default cannot retroactively age advances
   *  already in flight. Always read the ROW, never a constant. */
  policy_window_days?: number | null;
  currency?: string | null;
  exchange_rate_to_xaf?: number | null;
  justified_amount?: number | null;
  returned_amount?: number | null;
};

/** One row of the retirement ledger — `regie_retirement` (10717). */
export type RegieRetirement = {
  regie_retirement_id: string;
  regie_advance_id: string;
  kind: RegieRetirementKind;
  dossier_id?: string | null;
  amount: number;
  proof_vault_id?: string | null;
  entry_id?: string | null;
  memo?: string | null;
  retired_on?: string | null;
  created_at?: string;
};

export type RegieRetirementKind = "RECEIPT" | "CASH_RETURN" | "WRITE_OFF";

/**
 * `GET /regie/:id`. Everything below `retirements` is DERIVED SERVER-SIDE and
 * must be rendered as given.
 *
 * `open_balance` in particular is `amount - justified - returned`, the number
 * aging keys off; recomputing it in TSX would put a second implementation of
 * the balance next to the one the ledger actually posts against. Likewise
 * `next` is the server's `NEXT[state]` — the client renders the actions the
 * state machine permits instead of keeping its own copy of the machine.
 */
export type RegieDetail = Regie & {
  retirements?: RegieRetirement[];
  open_balance?: number;
  amount_xaf?: number;
  days_to_window?: number;
  is_aged?: boolean;
  is_due_soon?: boolean;
  next?: string[];
};

/** A watchlist row: open, and at or near its own policy window. */
export type RegieWatch = Regie & {
  open_balance?: number;
  days_to_window?: number;
  is_aged?: boolean;
};

export type RegieIssueInput = {
  holder_user_id?: string;
  amount: number;
  entity_id: string;
  entry_date: string;
  source_doc_ref: string;
  policy_window_days?: number;
  currency?: string;
  exchange_rate_to_xaf?: number;
};

/** Body of `POST /regie/:id/retire`. `dossier_id` is required for a RECEIPT
 *  (4731 is `requires_analytic`); the server refines the same rule. */
export type RegieRetireInput = {
  kind: RegieRetirementKind;
  amount: number;
  dossier_id?: string;
  proof_vault_id?: string;
  memo?: string;
  entity_id?: string;
  entry_date?: string;
  source_doc_ref?: string;
};

export const listRegie = (q?: string) =>
  tenant<Regie[]>(`/regie${q ? `?${q}` : ""}`);
export const getRegie = (id: string) => tenant<RegieDetail>(`/regie/${id}`);
export const regieWatchlist = () => tenant<RegieWatch[]>("/regie/watchlist");

/** The caller's OWN open advances. Self-scoped server-side from the session —
 *  it takes no holder argument, deliberately, so it cannot be aimed at someone
 *  else's float. Needs no MOD-49 grant. */
export const myRegie = () => tenant<RegieWatch[]>("/regie/mine");
export const issueRegie = (body: RegieIssueInput) =>
  tenant<Regie>("/regie/issue", { method: "POST", body });

/** Recording a receipt / returned cash. `edit`, not `approve`: gating
 *  justification harder is what produces aged advances in the first place. */
export const retireRegie = (id: string, body: RegieRetireInput) =>
  tenant<RegieDetail>(`/regie/${id}/retire`, { method: "POST", body });

/** A hold, not a verdict — QUERIED exits both ways (write off, or justify). */
export const queryRegie = (id: string, reason: string) =>
  tenant<Regie>(`/regie/${id}/query`, { method: "POST", body: { reason } });

/** Dr 658 / Cr 581. Only reachable from QUERIED, and may open an approval
 *  chain, so the response can come back pending rather than posted. */
export const writeOffRegie = (
  id: string,
  body: { amount?: number; memo?: string; entity_id?: string; entry_date?: string; source_doc_ref?: string },
) => tenant<Regie>(`/regie/${id}/write-off`, { method: "POST", body });

/** Reverse an aging reclassification (Dr 581 / Cr 4211) after a late
 *  justification. Advances aged before 10717 have no `aged_entry_id` and the
 *  server refuses rather than posting a second, unlinked entry. */
export const unageRegie = (
  id: string,
  body: { reason?: string; entry_date?: string },
) => tenant<Regie>(`/regie/${id}/unage`, { method: "POST", body });
