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

const DOC_TYPES = {
  FINAL_INVOICE:         { label: "Final invoice",            module: "finance/final_invoice" },
  PROFORMA_ADVANCE:      { label: "Proforma / advance",       module: "finance/proforma" },
  CREDIT_NOTE:           { label: "Credit note",              module: "finance/credit_note" },
  PAYMENT_RECEIPT:       { label: "Payment receipt",          module: "finance/smart_receivables" },
  QUOTATION:             { label: "Quotation",                module: "commercial/quotation" },
  PROPOSAL:              { label: "Proposal",                 module: "sales/proposal" },
  PURCHASE_ORDER:        { label: "Purchase order",           module: "procurement/purchase_order" },
  PURCHASE_REQUEST:      { label: "Purchase request",         module: "procurement/purchase_request" },
  SUPPLIER_INVOICE:      { label: "Supplier invoice",         module: "procurement/supplier_invoice" },
  DELIVERY_NOTE:         { label: "Delivery note",            module: "operations/delivery_note" },
  TRANSIT_ORDER:         { label: "Transit order",            module: "operations/transit_order" },
  CASH_REQUEST:          { label: "Cash request",             module: "costing/cash_request" },
  REGIE_ADVANCE:         { label: "Régie advance",            module: "costing/regie" },
  COMMS_CERTIFIED_EXPORT:{ label: "Certified comms export",   module: "smartcomm" },
};

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

module.exports = { DOC_TYPES, isDocType, assertDocType };
