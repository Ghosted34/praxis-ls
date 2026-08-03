/**
 * Doc-type registry (GAP_FIXES_PLAN §5.2). The single source of truth for the
 * `doc_type` a document is captured under. Issuing modules used to pass
 * hand-written string literals into document_vault.capture(); those strings are
 * also the keys of the `document_template` setting (§1.1), so a typo silently
 * severed a document from its template with nothing to catch it.
 *
 * Every value a caller may pass as `docType` lives here. `label` is for humans;
 * `module` records the issuer so the registry and the template keys stay joined.
 * A tenant's document_template settings SHOULD be keyed by one of these codes.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

/**
 * `moduleKey` added 2026-08-02: the MOD-xx whose `view` grant should govern
 * READING a document of this type.
 *
 * Why it was needed: the document viewer (`DocumentPage`, the View button on
 * every finance / procurement / HR / fleet / WMS / operations record) renders
 * through `POST /document-templates/:docType/preview`, and that router is gated
 * on **MOD-70 (Settings)** because it began life as the template Studio — an
 * admin configuration screen. So opening your own purchase request required the
 * Settings permission, and every non-admin got "You don't have permission to do
 * this" on a document they had just created.
 *
 * Reading a document now follows the module that owns the record; only the
 * template CONFIG routes stay on MOD-70, which is what that grant is actually
 * for. Same reasoning as approval_task.module_key (0488).
 *
 * `module` (the path) stays as-is — it documents the issuer and is used to keep
 * the template keys joined to the registry.
 */
const DOC_TYPES = {
  FINAL_INVOICE:         { label: "Final invoice",            module: "finance/final_invoice",         moduleKey: "MOD-51" },
  PROFORMA_ADVANCE:      { label: "Proforma / advance",       module: "finance/proforma",              moduleKey: "MOD-50" },
  CREDIT_NOTE:           { label: "Credit note",              module: "finance/credit_note",           moduleKey: "MOD-51" },
  PAYMENT_RECEIPT:       { label: "Payment receipt",          module: "finance/smart_receivables",     moduleKey: "MOD-52" },
  QUOTATION:             { label: "Quotation",                module: "commercial/quotation",          moduleKey: "MOD-27" },
  PROPOSAL:              { label: "Proposal",                 module: "sales/proposal",                moduleKey: "MOD-23" },
  PURCHASE_ORDER:        { label: "Purchase order",           module: "procurement/purchase_order",    moduleKey: "MOD-60" },
  PURCHASE_REQUEST:      { label: "Purchase request",         module: "procurement/purchase_request",  moduleKey: "MOD-62" },
  SUPPLIER_INVOICE:      { label: "Supplier invoice",         module: "procurement/supplier_invoice",  moduleKey: "MOD-61" },
  DELIVERY_NOTE:         { label: "Delivery note",            module: "operations/delivery_note",      moduleKey: "MOD-32" },
  TRANSIT_ORDER:         { label: "Transit order",            module: "operations/transit_order",      moduleKey: "MOD-30" },
  CASH_REQUEST:          { label: "Cash request",             module: "costing/cash_request",          moduleKey: "MOD-49" },
  REGIE_ADVANCE:         { label: "Régie advance",            module: "costing/regie",                 moduleKey: "MOD-49" },
  COMMS_CERTIFIED_EXPORT:{ label: "Certified comms export",   module: "smartcomm",                     moduleKey: "MOD-64" },
};

/**
 * The module whose grant governs reading this doc type. Falls back to MOD-70
 * (the historical gate) for anything unregistered, so an unknown type is gated
 * conservatively rather than left open.
 */
const moduleKeyForDocType = (docType) =>
  (DOC_TYPES[docType] && DOC_TYPES[docType].moduleKey) || "MOD-70";

const isDocType = (docType) => Object.prototype.hasOwnProperty.call(DOC_TYPES, docType);

/**
 * Validate a docType against the registry. `null`/`undefined` is allowed —
 * capture() may create a placeholder row before the type is known — but any
 * non-null value must be a registered code, so a typo is rejected at write time.
 * Returns the docType unchanged for convenient inline use.
 */
function assertDocType(docType) {
  if (docType === null || docType === undefined) return docType;
  if (!isDocType(docType)) {
    throw new AppError(
      "UNKNOWN_DOC_TYPE",
      "Unknown doc_type '" + docType + "'. Register it in document_vault.types.",
      422,
    );
  }
  return docType;
}

module.exports = { DOC_TYPES, isDocType, assertDocType, moduleKeyForDocType };
