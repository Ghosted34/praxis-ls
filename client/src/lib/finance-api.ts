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

/* ── journal reversal (MOD-55 approve) ── */
export const reverseJournalEntry = (id: string, body: { reason?: string; entry_date?: string }) =>
  tenant(`/journal-entries/${id}/reverse`, { method: "POST", body });

/* ── accounting periods / guided close (MOD-59) ── */
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

/** Today as YYYY-MM-DD in local time — the default for date fields. */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
