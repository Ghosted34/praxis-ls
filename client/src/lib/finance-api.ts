/**
 * Finance write-path helpers + option loaders. Thin typed wrappers over the
 * tenant() client for the Phase 1 posting endpoints, plus the master-data
 * lookups the forms need as dropdowns (entities, clients, dictionary items,
 * postable accounts). Kept out of the page files so the forms stay declarative.
 */
import { tenant } from "@/lib/api-client";

/* ── option loaders (id + display) ── */
export type Option = { id: string; label: string; extra?: string };

export async function loadEntities(): Promise<Option[]> {
  const rows = await tenant<Record<string, unknown>[]>("/entities");
  return (rows || []).map((r) => ({
    id: String(r.entity_id),
    label: String(r.legal_name ?? r.code ?? r.entity_id),
    extra: r.code ? String(r.code) : undefined,
  }));
}

export async function loadClients(): Promise<Option[]> {
  const rows = await tenant<Record<string, unknown>[]>("/clients");
  return (rows || []).map((r) => ({
    id: String(r.client_id),
    label: String(r.name ?? r.client_id),
    extra: r.ref ? String(r.ref) : undefined,
  }));
}

export async function loadDictionaryItems(): Promise<Option[]> {
  const rows = await tenant<Record<string, unknown>[]>("/financial-dictionary");
  return (rows || []).map((r) => ({
    id: String(r.dictionary_item_id),
    label: String(r.label_fr ?? r.code ?? r.dictionary_item_id),
    extra: r.code ? String(r.code) : undefined,
  }));
}

/** Postable leaf accounts only — the ledger rejects non-postable codes. */
export async function loadPostableAccounts(): Promise<Option[]> {
  const rows = await tenant<Record<string, unknown>[]>("/chart-of-accounts");
  return (rows || [])
    .filter((r) => r.is_postable !== false)
    .map((r) => ({
      id: String(r.code),
      label: `${r.code} — ${r.label_fr ?? ""}`.trim(),
      extra: undefined,
    }));
}

/* ── write calls ── */
export type JournalLineInput = {
  account_code: string;
  debit?: number;
  credit?: number;
  dossier_id?: string;
  is_debours?: boolean;
};

export type PostJournalInput = {
  entity_id: string;
  journal_code: string;
  entry_date: string;
  description?: string;
  source_doc_ref?: string;
  validate?: boolean;
  lines: JournalLineInput[];
};

export const postJournalEntry = (body: PostJournalInput) =>
  tenant("/journal-entries", { method: "POST", body });

export type PayAdvanceInput = {
  entity_id: string;
  client_id?: string;
  dossier_id?: string;
  amount: number;
  treasury_coa?: string;
  entry_date: string;
  source_doc_ref: string;
};

export const payAdvance = (body: PayAdvanceInput) =>
  tenant("/proformas/pay", { method: "POST", body });

export type InvoiceLineInput = { dictionary_item_id: string; amount: number; is_debours?: boolean; label?: string };

export const createInvoiceDraft = (body: {
  entity_id: string;
  client_id?: string;
  dossier_id?: string;
  lines?: InvoiceLineInput[];
}) => tenant<{ final_invoice_id?: string; id?: string }>("/final-invoices", { method: "POST", body });

export const submitInvoice = (id: string, body: { entry_date: string; source_doc_ref: string }) =>
  tenant(`/final-invoices/${id}/submit`, { method: "POST", body });

export type InvoiceDetail = {
  invoice_id: string;
  entity_id: string;
  client_id?: string | null;
  dossier_id?: string | null;
  status: string;
  lines?: Array<{ dictionary_item_id?: string | null; label?: string | null; line_ht?: number | string; is_debours?: boolean }>;
  [k: string]: unknown;
};

export const getInvoice = (id: string) => tenant<InvoiceDetail>(`/final-invoices/${id}`);

export const updateInvoiceDraft = (id: string, body: { client_id?: string; dossier_id?: string; lines?: InvoiceLineInput[] }) =>
  tenant(`/final-invoices/${id}`, { method: "PATCH", body });

/* ── journal reversal(approve) ── */
export const reverseJournalEntry = (id: string, body: { reason?: string; entry_date?: string }) =>
  tenant(`/journal-entries/${id}/reverse`, { method: "POST", body });

/* ── accounting periods / guided close ── */
export type Period = {
  period_id: string;
  entity_id?: string | null;
  code: string;
  starts_on?: string;
  ends_on?: string;
  status: "OPEN" | "FROZEN" | "CLOSED" | string;
};

export const listPeriods = (entityId?: string) =>
  tenant<{ periods: Period[] }>(`/statements/periods${entityId ? `?entity_id=${entityId}` : ""}`);

export const closePeriod = (body: { period_id: string; to: "FROZEN" | "CLOSED" }) =>
  tenant("/statements/periods/close", { method: "POST", body });

/* ── tax declarations / filing workflow ── */
export const TAX_KINDS = ["TVA", "IS", "MIN_TAX", "WHT", "DSF", "CNPS", "DIPE", "PATENTE"] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

export type TaxDeclaration = {
  declaration_id: string;
  entity_id?: string | null;
  kind: TaxKind | string;
  period_code: string;
  status: "DRAFT" | "COMPUTED" | "APPROVED" | "FILED" | string;
  amount?: number | string | null;
  due_on?: string | null;
  filed_ref?: string | null;
  filed_at?: string | null;
  created_at?: string | null;
  [k: string]: unknown;
};

export const listDeclarations = (entityId?: string) =>
  tenant<TaxDeclaration[]>(`/tax/declarations${entityId ? `?entity_id=${entityId}` : ""}`);

export const getDeclaration = (id: string) => tenant<TaxDeclaration>(`/tax/declarations/${id}`);

export type FileDeclarationInput = {
  entity_id?: string;
  kind: TaxKind;
  period_code: string;
  from?: string;
  to?: string;
  due_on?: string;
};

export const fileDeclaration = (body: FileDeclarationInput) =>
  tenant<TaxDeclaration>("/tax/declarations", { method: "POST", body });

export const approveDeclaration = (id: string) =>
  tenant<TaxDeclaration>(`/tax/declarations/${id}/approve`, { method: "POST", body: {} });

export const submitDeclaration = (id: string, body: { filed_ref?: string }) =>
  tenant<TaxDeclaration>(`/tax/declarations/${id}/submit`, { method: "POST", body });

/* ── credit notes ── */
export type CreditNoteLineInput = {
  label: string;
  amount: number;
  dictionary_item_id?: string;
  is_debours?: boolean;
};

export type CreditNote = {
  credit_note_id: string;
  entity_id: string;
  client_id?: string | null;
  reverses_invoice_id?: string | null;
  status: string;
  doc_number?: string | null;
  total_ttc?: number | string | null;
  created_at?: string | null;
  [k: string]: unknown;
};

export type CreditNoteDetail = CreditNote & {
  dossier_id?: string | null;
  lines?: Array<{ dictionary_item_id?: string | null; label?: string | null; amount?: number | string; line_ht?: number | string; is_debours?: boolean }>;
};

/** FINAL invoices only — a credit note reverses a finalised invoice. */
export async function loadFinalInvoices(): Promise<Option[]> {
  const rows = await tenant<Record<string, unknown>[]>("/final-invoices");
  return (rows || [])
    .filter((r) => String(r.status ?? r.state ?? "").toUpperCase() === "FINAL")
    .map((r) => ({
      id: String(r.invoice_id ?? r.final_invoice_id ?? r.id),
      label: String(r.doc_number ?? r.ref ?? r.invoice_id ?? ""),
      extra: r.total_ttc != null ? String(r.total_ttc) : undefined,
    }));
}

export const listCreditNotes = () => tenant<CreditNote[]>("/credit-notes");

export const getCreditNote = (id: string) => tenant<CreditNoteDetail>(`/credit-notes/${id}`);

export type CreateCreditNoteInput = {
  entity_id: string;
  client_id?: string;
  dossier_id?: string;
  reverses_invoice_id?: string;
  lines?: CreditNoteLineInput[];
};

export const createCreditNote = (body: CreateCreditNoteInput) =>
  tenant<CreditNote>("/credit-notes", { method: "POST", body });

export const updateCreditNote = (
  id: string,
  body: { client_id?: string; dossier_id?: string; reverses_invoice_id?: string; lines?: CreditNoteLineInput[] },
) => tenant<CreditNote>(`/credit-notes/${id}`, { method: "PATCH", body });

export const postCreditNote = (id: string, body: { entry_date?: string; source_doc_ref?: string }) =>
  tenant<CreditNote>(`/credit-notes/${id}/post`, { method: "POST", body });

/** Today as YYYY-MM-DD in local time — the default for date fields. */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ══════════════ Smart Receivables (MOD-52) — ageing, receipts, dunning ══════════════ */
export type Ageing = { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; open_count: number };
export type Receipt = {
  receipt_id: string; client_id?: string | null; method: string; treasury_account_id?: string | null;
  amount: number | string; received_on: string; status: string; doc_number?: string | null;
};
export type ReceiptDetail = Receipt & { allocations?: { allocation_id?: string; invoice_id?: string; amount: number | string }[] };
export type Reminder = { invoice_id: string; doc_number?: string | null; client_id?: string | null; outstanding: number | string; days_overdue: number; level?: number | null; label?: string | null };
export type ReminderPlan = { as_of: string; count: number; reminders: Reminder[] };

export const getAgeing = () => tenant<Ageing>("/receivables/ageing");
export const getReminders = () => tenant<ReminderPlan>("/receivables/reminders");
export const listReceipts = () => tenant<Receipt[]>("/receivables");
export const getReceipt = (id: string) => tenant<ReceiptDetail>(`/receivables/${id}`);
export const createReceipt = (body: { client_id?: string; method: string; treasury_account_id?: string; amount: number; received_on?: string }) =>
  tenant<Receipt>("/receivables", { method: "POST", body });
export const postReceipt = (id: string, body: { entity_id?: string; entry_date: string; source_doc_ref?: string; customer_account?: string }) =>
  tenant<Receipt>(`/receivables/${id}/post`, { method: "POST", body });

/* ══════════════ Debt / financing (MOD-53) — engagements, drawdown, repay ══════════════ */
export type DebtEngagement = {
  debt_engagement_id: string; entity_id?: string | null; dossier_id?: string | null;
  lender_kind?: string | null; lender_name?: string | null; principal: number | string; currency?: string | null;
  interest_rate?: number | null; coa_code?: string | null; status: string; started_on?: string | null; due_on?: string | null;
};
export type DebtRepayment = { debt_repayment_id: string; principal_part: number | string; interest_part: number | string; paid_on: string };
export type DebtDetail = DebtEngagement & { repayments?: DebtRepayment[]; repaid?: { principal: number; interest: number }; outstanding_principal?: number };
export type DebtInput = {
  entity_id: string; dossier_id?: string; lender_kind: string; lender_name?: string; principal: number;
  currency?: string; interest_rate?: number; coa_code?: string; started_on?: string; due_on?: string;
};

export const listDebt = () => tenant<DebtEngagement[]>("/financing");
export const getDebt = (id: string) => tenant<DebtDetail>(`/financing/${id}`);
export const createDebt = (body: DebtInput) => tenant<DebtEngagement>("/financing", { method: "POST", body });
export const updateDebt = (id: string, body: Partial<Pick<DebtInput, "lender_name" | "interest_rate" | "due_on" | "started_on" | "dossier_id">>) =>
  tenant<DebtEngagement>(`/financing/${id}`, { method: "PATCH", body });
export const deleteDebt = (id: string) => tenant<{ ok: boolean }>(`/financing/${id}`, { method: "DELETE" });
export const drawdownDebt = (id: string, body: { entity_id?: string; entry_date: string; source_doc_ref?: string; treasury_coa?: string }) =>
  tenant<DebtEngagement>(`/financing/${id}/drawdown`, { method: "POST", body });
export const repayDebt = (id: string, body: { entity_id?: string; entry_date: string; principal_part?: number; interest_part?: number; treasury_coa?: string; interest_coa?: string; source_doc_ref?: string }) =>
  tenant<DebtEngagement>(`/financing/${id}/repay`, { method: "POST", body });

/* ══════════════ Chart of accounts (MOD-58) — SYSCOHADA/OHADA ══════════════ */
export type Account = {
  code: string; parent_code?: string | null; label_fr: string; label_en?: string | null;
  class: number; normal_balance: "D" | "C"; is_postable: boolean; requires_analytic: boolean;
  is_active: boolean; is_system?: boolean; entity_id?: string | null;
};
export type AccountInput = {
  code: string; parent_code?: string; label_fr: string; label_en?: string; class: number;
  normal_balance: "D" | "C"; is_postable?: boolean; requires_analytic?: boolean;
};
export const listAccounts = () => tenant<Account[]>("/chart-of-accounts");
export const createAccount = (body: AccountInput) => tenant<Account>("/chart-of-accounts", { method: "POST", body });
export const updateAccount = (code: string, body: Partial<Omit<AccountInput, "code" | "class">> & { is_active?: boolean }) =>
  tenant<Account>(`/chart-of-accounts/${code}`, { method: "PATCH", body });

/* ══════════════ Finance command-center feeds (trial balance + the 4 chip lists) ══════════════ */
export type TrialBalanceRow = { account_code: string; debit: number | string; credit: number | string };
export type TrialBalance = { rows: TrialBalanceRow[]; totals: { debit: number; credit: number; balanced: boolean } };
export const getTrialBalance = () => tenant<TrialBalance>("/statements/trial-balance");

export type InvoiceRow = { invoice_id: string; doc_number?: string | null; client_id?: string | null; dossier_id?: string | null; total_ttc?: number | string | null; payment_due_on?: string | null; status: string };
export const listInvoices = () => tenant<InvoiceRow[]>("/final-invoices");
export type ProformaRow = { advance_id: string; client_id?: string | null; amount?: number | string | null; applied_amount?: number | string | null; status?: string | null; created_at?: string };
export const listProformas = () => tenant<ProformaRow[]>("/proformas/advances");
export type JournalRow = { entry_id: string; entry_date?: string | null; source_doc_ref?: string | null; status: string; source?: string | null };
export const listJournals = () => tenant<JournalRow[]>("/journal-entries");

/* treasury accounts — for the cash-position donut (kind → coa_code → balance) */
export type TreasuryAccount = { treasury_account_id: string; kind: string; label: string; coa_code: string };
export const listTreasuryAccounts = () => tenant<TreasuryAccount[]>("/treasury-accounts");

/* dossier option loader (ref + service key) — for tagging advances / invoices to an operation */
export async function loadDossiers(): Promise<Option[]> {
  const rows = await tenant<Record<string, unknown>[]>("/operations");
  return (rows || []).map((r) => ({
    id: String(r.dossier_id),
    label: String(r.ref || r.dossier_id),
    extra: r.service_name_en || r.service_key ? String(r.service_name_en || r.service_key) : undefined,
  }));
}

/* read-only VAT/total preview for a draft invoice (HT / débours / TVA / TTC + open advance) */
export type InvoiceTotals = {
  totals: { subtotal_ht: number; debours_total: number; tax_total: number; total: number };
  advance_open: number;
  line_count: number;
};
export const getInvoiceTotals = (id: string, entryDate?: string) =>
  tenant<InvoiceTotals>(`/final-invoices/${id}/totals${entryDate ? `?entry_date=${entryDate}` : ""}`);

/* attach a scanned slip / reference document to a receipt (vault upload, base64 data-url) */
export const uploadReceiptSlip = (receiptId: string, dataUrl: string) =>
  tenant<{ vault_id?: string }>("/documents", { method: "POST", body: { data_url: dataUrl, doc_type: "RECEIPT_SLIP", entity_ref: `payment_receipt:${receiptId}` } });
