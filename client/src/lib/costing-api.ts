/**
 * Costing API helpers — costing sheets, cost tracking (actuals), cash requests,
 * régie d'avance. Routes mirror src/modules/costing/*.
 */
import { tenant } from "./api-client";

/* ── Costing sheets(/costings) ── */
export type CostingLine = { dictionary_item_id?: string; label?: string; qty?: number; unit_cost?: number; is_debours?: boolean };
export type Costing = {
  costing_id: string; ref?: string | null; dossier_id?: string | null; currency?: string;
  margin_percent?: number | null; total_cost?: number | null; total?: number | null; status: string; created_at?: string;
};
export type CostingInput = { dossier_id: string; currency?: string; exchange_rate_to_xaf?: number; margin_percent?: number; lines?: CostingLine[] };
export const listCostings = () => tenant<Costing[]>("/costings");
export const createCosting = (body: CostingInput) => tenant<Costing>("/costings", { method: "POST", body });
export const setCostingStatus = (id: string, status: string) => tenant<Costing>(`/costings/${id}/status`, { method: "POST", body: { status } });

/* ── Cost tracking(/cost-tracking) — actuals per dossier ── */
export type CostEntry = { cost_entry_id?: string; dossier_id: string; label?: string; amount: number; category?: string; entry_date?: string; is_debours?: boolean };
export type CostEntryInput = { dossier_id: string; entity_id: string; dictionary_item_id?: string; amount: number; category?: string; is_debours?: boolean; expense_coa?: string; treasury_coa?: string; entry_date: string };
export const costEntriesByDossier = (dossierId: string) => tenant<CostEntry[]>(`/cost-tracking/dossier/${dossierId}`);
export const reconcileDossier = (dossierId: string) => tenant<Record<string, unknown>>(`/cost-tracking/dossier/${dossierId}/reconcile`);
export const recordCostEntry = (body: CostEntryInput) => tenant<CostEntry>("/cost-tracking", { method: "POST", body });

/* ── Cash requests(/cash-requests) ── */
export type CashLine = { dictionary_item_id?: string | null; label?: string; budget_amount?: number; spent_amount?: number; is_debours?: boolean };
export type CashRequest = { cash_request_id: string; ref?: string | null; dossier_id?: string | null; status: string; total_budget?: number | null; created_at?: string };
export type CashRequestInput = { dossier_id?: string; costing_id?: string; requested_by?: string; lines?: CashLine[] };
export const listCashRequests = () => tenant<CashRequest[]>("/cash-requests");
export const createCashRequest = (body: CashRequestInput) => tenant<CashRequest>("/cash-requests", { method: "POST", body });
export const transitionCashRequest = (id: string, to: "SUBMITTED" | "APPROVED" | "REJECTED", extra: { entity_id?: string; date?: string } = {}) =>
  tenant<CashRequest>(`/cash-requests/${id}/transition`, { method: "POST", body: { to, ...extra } });

/* ── Régie d'avance(/regie) ── */
export type Regie = { regie_id: string; ref?: string | null; holder_user_id?: string | null; amount?: number | null; status?: string | null; created_at?: string };
export type RegieIssueInput = { holder_user_id?: string; amount: number; entity_id: string; entry_date: string; source_doc_ref: string; policy_window_days?: number };
export const listRegie = () => tenant<Regie[]>("/regie");
export const issueRegie = (body: RegieIssueInput) => tenant<Regie>("/regie/issue", { method: "POST", body });
