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
