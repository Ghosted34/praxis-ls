/**
 * Procurement API helpers — purchase requests, purchase orders, goods received
 * (GRN), supplier invoices. Routes mirror src/modules/procurement/*.
 */
import { tenant } from "./api-client";

/* ── Purchase requests(/purchase-requests) ── */
// `scope_id` is the department reference (0490); `department` is the display
// snapshot stored beside it, which is what documents print.
export type PurchaseRequest = {
  pr_id: string;
  ref?: string | null;
  scope_id?: string | null;
  department?: string | null;
  justification?: string | null;
  status: string;
  created_at?: string;
};
export type PurchaseRequestInput = {
  requested_by?: string;
  scope_id?: string;
  department?: string;
  justification?: string;
  lines?: {
    dictionary_item_id: string;
    label?: string;
    qty?: number;
    unit_price?: number;
  }[];
};
export const listPurchaseRequests = () =>
  tenant<PurchaseRequest[]>("/purchase-requests");
export const createPurchaseRequest = (body: PurchaseRequestInput) =>
  tenant<PurchaseRequest>("/purchase-requests", { method: "POST", body });
export const transitionPR = (
  id: string,
  to: "SUBMITTED" | "APPROVED" | "REJECTED" | "ORDERED",
  extra: { entity_id?: string; date?: string } = {},
) =>
  tenant<PurchaseRequest>(`/purchase-requests/${id}/transition`, {
    method: "POST",
    body: { to, ...extra },
  });

/* ── Purchase orders(/purchase-orders) ── */
export type PoItem = {
  dictionary_item_id?: string;
  label?: string;
  qty: number;
  unit_price: number;
};
// The header a PO can carry — the legacy Finance & Treasury payment block,
// withholding and advance (analysis doc §6.1).
export type PurchaseOrder = {
  po_id: string;
  ref?: string | null;
  supplier_id?: string | null;
  dossier_id?: string | null;
  entity_id?: string | null;
  expense_category?: string | null;
  total_ttc?: number | null;
  total_ht?: number | null;
  total_vat?: number | null;
  net_payable?: number | null;
  amount_paid?: number | null;
  currency?: string | null;
  delivery_on?: string | null;
  due_on?: string | null;
  delivery_location?: string | null;
  payment_means?: string | null;
  pay_days?: number | null;
  air_rate?: number | null;
  adv_paid?: number | null;
  terms?: string | null;
  remarks?: string | null;
  unlock_reason?: string | null;
  bank_block?: BankBlock;
  items?: PoItem[];
  payments?: { payment_id: string; amount: number; paid_on: string; note?: string | null }[];
  status: string;
  created_at?: string;
};
export type BankBlock = {
  bank?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  momo_network?: string | null;
  momo_number?: string | null;
};
export type PurchaseOrderInput = {
  pr_id?: string;
  supplier_id?: string;
  dossier_id?: string;
  expense_category?: "OPERATIONS" | "OVERHEAD";
  currency?: string;
  delivery_on?: string;
  delivery_location?: string;
  payment_means?: "BANK" | "CASH" | "MOBILE_MONEY" | "CHEQUE";
  pay_days?: number;
  bank_block?: BankBlock;
  air_rate?: number;
  adv_paid?: number;
  terms?: string;
  remarks?: string;
  items?: PoItem[];
};
export const listPurchaseOrders = () =>
  tenant<PurchaseOrder[]>("/purchase-orders");
export const getPurchaseOrder = (id: string) =>
  tenant<PurchaseOrder & { items?: PoItem[] }>(`/purchase-orders/${id}`);
export const createPurchaseOrder = (body: PurchaseOrderInput) =>
  tenant<PurchaseOrder>("/purchase-orders", { method: "POST", body });
export const updatePurchaseOrder = (id: string, body: PurchaseOrderInput) =>
  tenant<PurchaseOrder>(`/purchase-orders/${id}`, {
    method: "PATCH",
    body,
  });
export const transitionPO = (
  id: string,
  to: "ISSUED_LOCKED" | "APPROVED_LOCKED" | "RECEIVED" | "CLOSED" | "CANCELLED",
  extra: { entity_id?: string; date?: string } = {},
) =>
  tenant<PurchaseOrder>(`/purchase-orders/${id}/transition`, {
    method: "POST",
    body: { to, ...extra },
  });
// 10721: pay a PO directly (legacy po_mark_paid) and the unlock loop.
export const payPurchaseOrder = (
  id: string,
  body: { amount?: number; paid_on?: string; treasury_account_id?: string; note?: string },
) =>
  tenant<{ purchase_order: PurchaseOrder; amount_paid: number; status: string; outstanding: number }>(
    `/purchase-orders/${id}/pay`,
    { method: "POST", body },
  );
export const unlockPurchaseOrder = (
  id: string,
  body: { action: "REQUEST_UNLOCK" | "UNLOCK" | "DENY_UNLOCK"; reason?: string },
) =>
  tenant<PurchaseOrder>(`/purchase-orders/${id}/unlock`, {
    method: "POST",
    body,
  });

/* ── Goods received / GRN(/goods-received) ── */
export type GrnLine = {
  dictionary_item_id?: string | null;
  label?: string;
  ordered?: number;
  received?: number;
  condition?: string;
};
export type Grn = {
  grn_id: string;
  ref?: string | null;
  po_id?: string | null;
  supplier_invoice_ref?: string | null;
  doc_number?: string | null;
  received_on?: string | null;
  note?: string | null;
  wms_inbound_id?: string | null;
  lines?: GrnLine[];
  created_at?: string;
};
export type GrnInput = {
  po_id: string;
  received_by?: string;
  supplier_invoice_ref?: string;
  entity_id?: string;
  date?: string;
  note?: string;
  lines?: GrnLine[];
};
export const listGrn = () => tenant<Grn[]>("/goods-received");
export const createGrn = (body: GrnInput) =>
  tenant<Grn>("/goods-received", { method: "POST", body });
export const sendGrnToWarehouse = (id: string) =>
  tenant<Grn>(`/goods-received/${id}/send-to-warehouse`, {
    method: "POST",
    body: {},
  });

/* ── Supplier invoices(/supplier-invoices) ── */
export type TreasuryAccount = {
  treasury_account_id: string;
  label?: string;
  kind?: string;
  coa_code?: string;
  currency?: string;
};
export const listTreasuryAccounts = () =>
  tenant<TreasuryAccount[]>("/treasury-accounts");
export type SupplierInvoiceLine = {
  dictionary_item_id?: string | null;
  label?: string;
  qty?: number;
  unit_price: number;
  tax_code_id?: string | null;
  expense_account: string;
};
export type SupplierInvoice = {
  supplier_invoice_id: string;
  ref?: string | null;
  supplier_id?: string | null;
  dossier_id?: string | null;
  amount_ttc?: number | null;
  amount_paid?: number | null;
  status: string;
  due_on?: string | null;
  created_at?: string;
};
export type SupplierInvoiceInput = {
  entity_id: string;
  supplier_id?: string;
  po_id?: string;
  grn_id?: string;
  dossier_id?: string;
  supplier_ref?: string;
  currency?: string;
  vat_total?: number;
  wht_total?: number;
  due_on?: string;
  lines: SupplierInvoiceLine[];
};
export const listSupplierInvoices = () =>
  tenant<SupplierInvoice[]>("/supplier-invoices");
export const createSupplierInvoice = (body: SupplierInvoiceInput) =>
  tenant<SupplierInvoice>("/supplier-invoices", { method: "POST", body });
export const matchSupplierInvoice = (id: string) =>
  tenant<Record<string, unknown>>(`/supplier-invoices/${id}/match`, {
    method: "POST",
    body: {},
  });
export const postSupplierInvoice = (
  id: string,
  body: { entry_date: string; source_doc_ref?: string },
) =>
  tenant<SupplierInvoice>(`/supplier-invoices/${id}/post`, {
    method: "POST",
    body,
  });
export const paySupplierInvoice = (
  id: string,
  body: {
    amount?: number;
    entity_id?: string;
    entry_date: string;
    treasury_account_id?: string;
    note?: string;
  },
) =>
  tenant<{
    supplier_invoice: SupplierInvoice;
    payment: { payment_id: string; amount: number };
    amount_paid: number;
    status: string;
    outstanding: number;
  }>(`/supplier-invoices/${id}/pay`, {
    method: "POST",
    body,
  });
export const reverseSupplierInvoice = (
  id: string,
  body: { reason?: string; entry_date?: string },
) =>
  tenant<SupplierInvoice>(`/supplier-invoices/${id}/reverse`, {
    method: "POST",
    body,
  });
