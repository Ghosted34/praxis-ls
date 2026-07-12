/**
 * Whitelisted action executors — the ONLY functions the agent may run on confirm.
 * Each calls a module SERVICE with the caller's client + identity (module RBAC/
 * audit applies). Explicit map = the safety boundary (AI_ARCHITECTURE §1/§7).
 *
 * Only actions with a COMPLETE, executable payload are enabled here. The create
 * actions carry a full schema; update/transition actions omit the record id in
 * their manifest schema, so they are intentionally NOT enabled until that lands.
 * A field-name adapter bridges snake_case AI payloads to the services' camelCase
 * args where they differ.
 */
"use strict";

const clientMaster = require("../../modules/master/client_master/client_master.service");
const opsFile = require("../../modules/operations/operations_file/operations_file.service");
const costing = require("../../modules/costing/costing/costing.service");
const quotation = require("../../modules/commercial/quotation/quotation.service");
const finalInvoice = require("../../modules/finance/final_invoice/final_invoice.service");
const purchaseOrder = require("../../modules/procurement/purchase_order/purchase_order.service");
const supplierInvoice = require("../../modules/procurement/supplier_invoice/supplier_invoice.service");
const cashRequest = require("../../modules/costing/cash_request/cash_request.service");

const registry = {
  ping: async ({ payload }) => ({ entity_ref: `ping:${(payload && payload.note) || "ok"}` }),

  // ── Master data ──
  create_client: async ({ client, user, payload }) => {
    const r = await clientMaster.create(client, { data: payload, actor: user });
    return { entity_ref: `client:${r.client_id}` };
  },
  open_dossier: async ({ client, user, payload }) => {
    const r = await opsFile.create(client, { data: payload, actor: user });
    return { entity_ref: `dossier:${r.ref}` };
  },

  // ── Commercial / costing (services take { data, actor }) ──
  create_costing: async ({ client, user, payload }) => {
    const r = await costing.createDraft(client, { data: payload, actor: user });
    return { entity_ref: `costing:${r.costing_id}` };
  },
  draft_quotation: async ({ client, user, payload }) => {
    const r = await quotation.createDraft(client, { data: payload, actor: user });
    return { entity_ref: `quotation:${r.quotation_id}` };
  },

  // ── Finance / procurement (services take flat camelCase args) ──
  draft_final_invoice: async ({ client, user, payload }) => {
    const r = await finalInvoice.createDraft(client, {
      entityId: payload.entity_id, clientId: payload.client_id, dossierId: payload.dossier_id,
      lines: payload.lines || [], actor: user,
    });
    return { entity_ref: `invoice:${r.invoice_id}` };
  },
  draft_purchase_order: async ({ client, user, payload }) => {
    const r = await purchaseOrder.createDraft(client, {
      prId: payload.pr_id || null, supplierId: payload.supplier_id || null, dossierId: payload.dossier_id || null,
      expenseCategory: payload.expense_category || "OPERATIONS", items: payload.items || [], actor: user,
    });
    return { entity_ref: `purchase_order:${r.po_id}` };
  },
  draft_supplier_invoice: async ({ client, user, payload }) => {
    const r = await supplierInvoice.createDraft(client, {
      entityId: payload.entity_id, supplierId: payload.supplier_id || null, poId: payload.po_id || null,
      grnId: payload.grn_id || null, dossierId: payload.dossier_id || null, supplierRef: payload.supplier_ref || null,
      currency: payload.currency || "XAF", vatTotal: payload.vat_total || 0, whtTotal: payload.wht_total || 0,
      dueOn: payload.due_on || null, lines: payload.lines || [], actor: user,
    });
    return { entity_ref: `supplier_invoice:${r.supplier_invoice_id}` };
  },
  draft_cash_request: async ({ client, user, payload }) => {
    const r = await cashRequest.createDraft(client, {
      dossierId: payload.dossier_id || null, costingId: payload.costing_id || null,
      requestedBy: payload.requested_by || null, lines: payload.lines || [], actor: user,
    });
    return { entity_ref: `cash_request:${r.cash_request_id}` };
  },
};

module.exports = { registry };
