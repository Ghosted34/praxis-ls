/**
 * Treasury reconciliation (MOD-09) — API types and fetchers.
 *
 * Separate from `treasury-api.ts` because the two answer different questions:
 * that module is the account master (what the account IS), this one is the
 * reconciliation workflow (what agrees with it, and what does not). They share
 * a permission and a screen, not a shape.
 *
 * The types mirror the server's own vocabulary deliberately — `sign_convention`,
 * `tier`, `foots`, `unexplained_difference` are the words the backend, the
 * database comments and the accountant all use, and renaming them for the UI
 * would put a translation layer between a treasurer and the thing they are
 * signing.
 */
import { tenant } from "./api-client";

/* ─────────────── the canonical vocabulary a column map maps onto ─────────── */

export type CanonicalField =
  | "booking_date" | "value_date" | "description" | "debit" | "credit"
  | "amount" | "direction" | "running_balance" | "external_ref"
  | "cheque_no" | "counterparty" | "fee" | "currency";

export type SourceKind = "CSV" | "XLSX" | "PDF" | "CAMT053" | "MT940" | "MANUAL";
export type SignConvention = "SIGNED_AMOUNT" | "DEBIT_CREDIT_COLUMNS" | "AMOUNT_WITH_INDICATOR";

export type ColumnMap = Partial<Record<CanonicalField, string | null>>;

/* ─────────────── saved layouts ───────────────────────────────────────────── */

export type StatementProfile = {
  statement_profile_id: string;
  entity_id: string;
  source_kind: SourceKind;
  institution: string | null;
  label: string;
  header_signature: string | null;
  column_map: ColumnMap;
  sign_convention: SignConvention;
  date_format: string;
  decimal_separator: string;
  thousands_separator: string;
  proposed_by_ai: boolean;
  confirmed_at: string | null;
  version: number;
  is_active: boolean;
  use_count?: number;
};

/* ─────────────── statements + lines ──────────────────────────────────────── */

export type StatementStatus =
  | "UPLOADED" | "NEEDS_MAPPING" | "PARSED" | "VALIDATED"
  | "RECONCILING" | "RECONCILED" | "CLOSED" | "REJECTED";

export type MatchStatus = "UNMATCHED" | "SUGGESTED" | "MATCHED" | "PARTIAL" | "IGNORED" | "POSTED";

export type BankStatement = {
  statement_id: string;
  treasury_account_id: string;
  file_name: string | null;
  source_kind: SourceKind;
  period_start: string | null;
  period_end: string | null;
  currency: string;
  opening_balance_declared: string | number | null;
  closing_balance_declared: string | number | null;
  line_count: number;
  duplicate_count: number;
  /** `null` means the check could not run — not that it passed. */
  foots: boolean | null;
  footing_difference: string | number | null;
  status: StatementStatus;
  imported_at: string;
  unmatched_count?: string | number;
};

export type StatementLine = {
  statement_line_id: string;
  statement_id: string;
  row_index: number;
  booking_date: string;
  value_date: string | null;
  /** Always signed, positive = money into the account. */
  amount: string | number;
  currency: string;
  fee_amount: string | number;
  description: string | null;
  counterparty: string | null;
  external_ref: string | null;
  cheque_no: string | null;
  running_balance: string | number | null;
  match_status: MatchStatus;
  matched_amount: string | number;
  duplicate_of: string | null;
  ignored_reason: string | null;
  suggestion_count?: string | number;
};

export type FootingResult = {
  foots: boolean | null;
  difference: number | null;
  movement: number;
  expected: number | null;
  basis: "DECLARED_BALANCES" | "RUNNING_BALANCE" | "UNCHECKABLE";
  fees_included_in_balance?: boolean | null;
  broke_at_row?: number | null;
  reason: string;
};

/* ─────────────── the preview / mapping handshake ─────────────────────────── */

export type MappingProposal = {
  profile: {
    column_map: ColumnMap;
    sign_convention: SignConvention;
    date_format: string;
    decimal_separator: string;
    thousands_separator: string;
    header_signature: string | null;
  };
  field_source: Partial<Record<CanonicalField, "heuristic" | "model">>;
  field_scores: Partial<Record<CanonicalField, number>>;
  model_used: boolean;
  detection: {
    number: { decimalSeparator: string; thousandsSeparator: string; confidence: number; reason: string };
    date: { format: string; confidence: number; ambiguous: boolean; reason: string };
  };
  verification: { ok: boolean; errors: string[]; warnings: string[]; stats: Record<string, number> };
  preview: Array<Record<string, unknown>>;
  alternatives: Partial<Record<CanonicalField, Array<{ header: string; score: number }>>>;
};

export type PreviewReady = {
  status: "READY";
  account: { treasury_account_id: string; label: string; currency: string; category_code: string | null; is_momo: boolean; is_bank: boolean };
  file: { name: string | null; hash: string; size: number; source_kind: SourceKind };
  already_imported: { statement_id: string; imported_at: string } | null;
  profile: { statement_profile_id: string; label: string; institution: string | null } | null;
  line_count: number;
  duplicate_count: number;
  rejected: Array<{ __row?: number; reasons: string[] }>;
  footing: FootingResult;
  preview: Array<Record<string, unknown>>;
  source_meta: Record<string, unknown>;
};

export type PreviewNeedsMapping = {
  status: "NEEDS_MAPPING";
  account: PreviewReady["account"];
  file: PreviewReady["file"];
  already_imported: PreviewReady["already_imported"];
  headers: string[];
  sample: Array<Record<string, unknown>>;
  proposal: MappingProposal;
  message: string;
  source_meta: Record<string, unknown>;
};

export type PreviewResult = PreviewReady | PreviewNeedsMapping;

/* ─────────────── matches ─────────────────────────────────────────────────── */

export type ReconciliationMatch = {
  match_id: string;
  statement_line_id: string;
  journal_line_id: string;
  amount: string | number;
  /** 1 = an exact institution-reference hit; ascending = weaker evidence. */
  tier: number;
  confidence: string | number;
  method: string;
  reasons: string[];
  status: "SUGGESTED" | "CONFIRMED" | "REJECTED";
  entry_date?: string;
  description?: string | null;
  entry_no?: number;
  journal_code?: string;
  debit?: string | number;
  credit?: string | number;
};

/* ─────────────── the etat de rapprochement ───────────────────────────────── */

export type Reconciliation = {
  reconciliation_id: string;
  treasury_account_id: string;
  statement_id: string | null;
  period_start: string;
  period_end: string;
  currency: string;
  ledger_balance: string | number;
  statement_balance: string | number;
  deposits_in_transit: string | number;
  outstanding_payments: string | number;
  unrecorded_credits: string | number;
  unrecorded_debits: string | number;
  unexplained_difference: string | number;
  matched_count: number;
  unmatched_statement_count: number;
  unmatched_ledger_count: number;
  status: "DRAFT" | "SUBMITTED_FOR_VALIDATION" | "SUBMITTED_FOR_APPROVAL" | "APPROVED_LOCKED" | "CANCELLED";
  doc_number: string | null;
  approved_at: string | null;
};

export type CashCount = {
  cash_count_id: string;
  counted_on: string;
  currency: string;
  denominations: Array<{ note: number; qty: number }>;
  counted_total: string | number;
  ledger_balance: string | number;
  difference: string | number;
  over_float_limit: boolean;
  variance_reason: string | null;
  status: "DRAFT" | "ATTESTED" | "APPROVED_LOCKED" | "CANCELLED";
  attested_at: string | null;
};

/* ─────────────── fetchers ────────────────────────────────────────────────── */

const base = "/reconciliation";

/**
 * Read a File as a base64 data URL — the upload convention the whole product
 * uses (document vault, dictionary importer), so there is no multipart
 * middleware anywhere in the API.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export const previewStatement = (body: {
  treasury_account_id: string; file: string; filename?: string;
}) => tenant<PreviewResult>(`${base}/statements/preview`, { method: "POST", body });

export const importStatement = (body: {
  treasury_account_id: string; file: string; filename?: string; statement_profile_id?: string;
}) => tenant<{
  statement: BankStatement; imported: number; duplicates: number;
  rejected: Array<{ __row?: number; reasons: string[] }>; footing: FootingResult;
}>(`${base}/statements`, { method: "POST", body });

export const listStatements = (treasuryAccountId: string) =>
  tenant<BankStatement[]>(`${base}/statements?treasury_account_id=${encodeURIComponent(treasuryAccountId)}`);

export const getStatement = (statementId: string, matchStatus?: MatchStatus) =>
  tenant<{ statement: BankStatement; lines: StatementLine[] }>(
    `${base}/statements/${statementId}${matchStatus ? `?match_status=${matchStatus}` : ""}`,
  );

export const confirmProfile = (body: {
  entity_id: string;
  source_kind: SourceKind;
  institution?: string | null;
  label?: string;
  header_signature?: string | null;
  column_map: ColumnMap;
  sign_convention?: SignConvention;
  date_format?: string;
  decimal_separator?: string;
  thousands_separator?: string;
  proposed_by_ai?: boolean;
}) => tenant<StatementProfile>(`${base}/profiles`, { method: "POST", body });

export const listProfiles = (entityId?: string) =>
  tenant<StatementProfile[]>(`${base}/profiles${entityId ? `?entity_id=${encodeURIComponent(entityId)}` : ""}`);

export const runMatcher = (statementId: string, body: { near_days?: number; far_days?: number; auto_confirm?: boolean } = {}) =>
  tenant<{ considered: number; candidates: number; suggested: number; auto_confirmed: number; unmatched: number }>(
    `${base}/statements/${statementId}/match`, { method: "POST", body },
  );

export const lineMatches = (statementLineId: string) =>
  tenant<ReconciliationMatch[]>(`${base}/lines/${statementLineId}/matches`);

export const confirmMatch = (matchId: string) =>
  tenant<{ match: ReconciliationMatch; line: StatementLine }>(`${base}/matches/${matchId}/confirm`, { method: "POST", body: {} });

export const rejectMatch = (matchId: string, reason?: string) =>
  tenant<{ match: ReconciliationMatch; line: StatementLine }>(`${base}/matches/${matchId}/reject`, { method: "POST", body: { reason } });

export const ignoreLine = (statementLineId: string, reason?: string) =>
  tenant<StatementLine>(`${base}/lines/${statementLineId}/ignore`, { method: "POST", body: { reason } });

export const buildReconciliation = (body: {
  treasury_account_id: string; statement_id?: string; period_start?: string; period_end?: string;
}) => tenant<{ reconciliation: Reconciliation; outstanding: Record<string, unknown[]> }>(base, { method: "POST", body });

export const listReconciliations = (treasuryAccountId: string) =>
  tenant<Reconciliation[]>(`${base}?treasury_account_id=${encodeURIComponent(treasuryAccountId)}`);

export const approveReconciliation = (id: string) =>
  tenant<Reconciliation>(`${base}/${id}/approve`, { method: "POST", body: {} });

export const listCashCounts = (treasuryAccountId: string) =>
  tenant<CashCount[]>(`${base}/cash-counts?treasury_account_id=${encodeURIComponent(treasuryAccountId)}`);

export const recordCashCount = (body: {
  treasury_account_id: string;
  counted_on?: string;
  denominations?: Array<{ note: number; qty: number }>;
  counted_total?: number;
  variance_reason?: string | null;
}) => tenant<CashCount>(`${base}/cash-counts`, { method: "POST", body });

export const attestCashCount = (id: string, variance_reason?: string) =>
  tenant<CashCount>(`${base}/cash-counts/${id}/attest`, { method: "POST", body: { variance_reason } });
