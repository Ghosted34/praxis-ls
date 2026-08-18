/**
 * Costing API helpers — costing sheets, cost tracking (actuals), cash requests,
 * régie d'avance. Routes mirror src/modules/costing/*.
 */
import { tenant } from "./api-client";

/* ── Costing sheets(/costings) ── */
/** `container_type_ref_id` (0663) records which box the charge was priced for.
 *  NULL for anything with no equipment dimension, which is most of the
 *  catalogue; the joined `container_type_*` fields are read-only display. */
export type CostingLine = {
  dictionary_item_id?: string;
  label?: string;
  qty?: number;
  unit_cost?: number;
  is_disbursement?: boolean;
  container_type_ref_id?: string | null;
  container_type_code?: string | null;
  container_type_en?: string | null;
  container_type_fr?: string | null;
};
export type Costing = {
  costing_id: string;
  ref?: string | null;
  doc_number?: string | null;
  dossier_id?: string | null;
  currency?: string;
  margin_percent?: number | null;
  total_cost?: number | null;
  total?: number | null;
  status: string;
  created_at?: string;
  /** Unlock audit trail (10718). Present once a reopening has been asked for. */
  unlock_reason?: string | null;
  unlock_requested_at?: string | null;
  unlocked_at?: string | null;
};
export type CostingInput = {
  dossier_id: string;
  currency?: string;
  exchange_rate_to_xaf?: number;
  margin_percent?: number;
  lines?: CostingLine[];
};
export const listCostings = () => tenant<Costing[]>("/costings");
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
 * UNLOCK is refused (422 INVOICE_ISSUED) when the dossier's final invoice has
 * left DRAFT — reopening a costing under a posted receivable would move the
 * priced basis while booked revenue stayed put.
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

/* ── Cash requests(/cash-requests) ── */
export type CashLine = {
  dictionary_item_id?: string | null;
  label?: string;
  budget_amount?: number;
  spent_amount?: number;
  is_disbursement?: boolean;
};
export type CashRequest = {
  cash_request_id: string;
  ref?: string | null;
  doc_number?: string | null;
  dossier_id?: string | null;
  status: string;
  total_budget?: number | null;
  /** Σ of the payment rows (10719). Derived server-side, never set by hand. */
  disbursed_amount?: number | null;
  created_at?: string;
};
export type CashRequestInput = {
  dossier_id?: string;
  costing_id?: string;
  requested_by?: string;
  lines?: CashLine[];
};
export const listCashRequests = () => tenant<CashRequest[]>("/cash-requests");
export const createCashRequest = (body: CashRequestInput) =>
  tenant<CashRequest>("/cash-requests", { method: "POST", body });
export const transitionCashRequest = (
  id: string,
  to: "SUBMITTED" | "APPROVED" | "REJECTED",
  extra: { entity_id?: string; date?: string } = {},
) =>
  tenant<CashRequest>(`/cash-requests/${id}/transition`, {
    method: "POST",
    body: { to, ...extra },
  });

/** One cash request with its lines and payments. */
export const getCashRequest = (id: string) =>
  tenant<CashRequestDetail>(`/cash-requests/${id}`);

export type CashRequestDetail = CashRequest & {
  costing_id?: string | null;
  requested_by?: string | null;
  regie_advance_id?: string | null;
  amount?: number | null;
  lines?: CashLine[];
  payments?: unknown[];
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
