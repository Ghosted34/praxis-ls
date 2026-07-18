/**
 * Procurement API helpers — purchase requests, purchase orders, goods received
 * (GRN), supplier invoices. Routes mirror src/modules/procurement/*.
 */
import { tenant } from "./api-client";

/* ── Purchase requests(/purchase-requests) ── */
export type PurchaseRequest = { pr_id: string; ref?: string | null; department?: string | null; justification?: string | null; status: string; created_at?: string };
export type PurchaseRequestInput = { requested_by?: string; department?: string; justification?: string };
export const listPurchaseRequests = () => tenant<PurchaseRequest[]>("/purchase-requests");
export const createPurchaseRequest = (body: PurchaseRequestInput) => tenant<PurchaseRequest>("/purchase-requests", { method: "POST", body });
export const transitionPR = (id: string, to: "SUBMITTED" | "APPROVED" | "REJECTED" | "ORDERED", extra: { entity_id?: string; date?: string } = {}) =>
  tenant<PurchaseRequest>(`/purchase-requests/${id}/transition`, { method: "POST", body: { to, ...extra } });

/* ── Purchase orders(/purchase-orders) ── */
export type PoItem = { dictionary_item_id?: string; label?: string; qty: number; unit_price: number };
export type PurchaseOrder = { po_id: string; ref?: string | null; supplier_id?: string | null; dossier_id?: string | null; expense_category?: string | null; total_ttc?: number | null; status: string; created_at?: string };
export type PurchaseOrderInput = { pr_id?: string; supplier_id?: string; dossier_id?: string; expense_category?: "OPERATIONS" | "OVERHEAD"; items?: PoItem[] };
export const listPurchaseOrders = () => tenant<PurchaseOrder[]>("/purchase-orders");
export const createPurchaseOrder = (body: PurchaseOrderInput) => tenant<PurchaseOrder>("/purchase-orders", { method: "POST", body });
export const transitionPO = (id: string, to: "ISSUED_LOCKED" | "APPROVED_LOCKED" | "RECEIVED" | "CLOSED" | "CANCELLED", extra: { entity_id?: string; date?: string } = {}) =>
  tenant<PurchaseOrder>(`/purchase-orders/${id}/transition`, { method: "POST", body: { to, ...extra } });

/* ── Goods received / GRN(/goods-received) ── */
export type Grn = { grn_id: string; ref?: string | null; po_id?: string | null; supplier_invoice_ref?: string | null; created_at?: string };
export type GrnInput = { po_id: string; received_by?: string; supplier_invoice_ref?: string; entity_id?: string; date?: string };
export const listGrn = () => tenant<Grn[]>("/goods-received");
export const createGrn = (body: GrnInput) => tenant<Grn>("/goods-received", { method: "POST", body });

/* ── Supplier invoices(/supplier-invoices) ── */
export type SupplierInvoiceLine = { dictionary_item_id?: string | null; label?: string; qty?: number; unit_price: number; tax_code_id?: string | null; expense_account: string };
export type SupplierInvoice = { supplier_invoice_id: string; ref?: string | null; supplier_id?: string | null; dossier_id?: string | null; amount_ttc?: number | null; status: string; due_on?: string | null; created_at?: string };
export type SupplierInvoiceInput = {
  entity_id: string; supplier_id?: string; po_id?: string; grn_id?: string; dossier_id?: string;
  supplier_ref?: string; currency?: string; vat_total?: number; wht_total?: number; due_on?: string; lines: SupplierInvoiceLine[];
};
export const listSupplierInvoices = () => tenant<SupplierInvoice[]>("/supplier-invoices");
export const createSupplierInvoice = (body: SupplierInvoiceInput) => tenant<SupplierInvoice>("/supplier-invoices", { method: "POST", body });
export const matchSupplierInvoice = (id: string) => tenant<Record<string, unknown>>(`/supplier-invoices/${id}/match`, { method: "POST", body: {} });
export const postSupplierInvoice = (id: string, body: { entry_date: string; source_doc_ref?: string }) =>
  tenant<SupplierInvoice>(`/supplier-invoices/${id}/post`, { method: "POST", body });
