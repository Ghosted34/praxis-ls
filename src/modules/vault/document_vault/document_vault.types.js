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
  /*
   * The etat de rapprochement bancaire (MOD-09) and the petty-cash count sheet
   * that stands in for it where no institution issues a statement. Both are
   * signed control documents an auditor asks for by name, so both are captured
   * rather than re-rendered on demand: the figures in the vault copy are the
   * ones the treasurer signed, not whatever the ledger says today.
   */
  BANK_RECONCILIATION:   { label: "Bank reconciliation",       module: "master/reconciliation",         moduleKey: "MOD-09" },
  CASH_COUNT_SHEET:      { label: "Cash count sheet",          module: "master/reconciliation",         moduleKey: "MOD-09" },
  REGIE_ADVANCE:         { label: "Régie advance",            module: "costing/regie",                 moduleKey: "MOD-49" },
  COMMS_CERTIFIED_EXPORT:{ label: "Certified comms export",   module: "smartcomm",                     moduleKey: "MOD-64" },
  /*
   * The text of a discovery dictation (MOD-21). Registered for the same reason
   * the master-data scans below are: `moduleKeyForDocType` falls back to MOD-70
   * for an unregistered type, so without this row the salesperson who just
   * dictated the section could not read their own transcript back unless they
   * also administered the application — while anyone holding Settings could
   * read every client conversation in the tenant.
   */
  MEETING_TRANSCRIPT:    { label: "Meeting transcript",       module: "sales/meeting",                  moduleKey: "MOD-21" },
  /*
   * An enquiry attachment (MOD-20, F6) — a packing list, a cargo photo, a spec
   * sheet the requester sent with their quote request. Registered for the same
   * reason as MEETING_TRANSCRIPT above: `moduleKeyForDocType` falls back to
   * MOD-70 for an unregistered type, so without this row the salesperson
   * working the enquiry could not open the file attached to it unless they also
   * administered the application.
   */
  QUOTE_REQUEST_ATTACHMENT: { label: "Quote request attachment", module: "sales/quote_request",          moduleKey: "MOD-20" },
  /*
   * The applicant's own company profile, uploaded with a partnership or vendor
   * application (MOD-25, F10). Registered for the same reason as the two above:
   * `moduleKeyForDocType` falls back to MOD-70 for an unregistered type, so
   * without this row the person vetting the application could not open the
   * prospectus it turns on unless they also administered the application, while
   * anyone holding Settings could read every applicant's file in the tenant.
   */
  PARTNERSHIP_PROFILE:   { label: "Partnership corporate profile", module: "sales/partnership_request", moduleKey: "MOD-25" },
  SUCCESS_STORY_MEDIA:   { label: "Success story public image", module: "sales/success_story", moduleKey: "MOD-26" },
  /*
   * Master-data scans — the file behind a register entry, not a document this
   * system issues. There is no template for these three and there never will
   * be: nobody prints a client's tax clearance from here, they photograph the
   * one the authority gave them.
   *
   * They are registered anyway because `moduleKeyForDocType` is what decides
   * who may OPEN an uploaded file, and its fallback for an unregistered type is
   * MOD-70 — the Settings grant. Without these rows, the operator who has just
   * attached a scan to a client they administer could not read it back unless
   * they also administered the application, while anyone holding Settings could
   * read every ID document in the tenant. Reading follows the register the
   * document belongs to: entities MOD-01, clients MOD-03, suppliers MOD-04.
   */
  /*
   * The employment contract. The doc type has existed in the TEMPLATE registry
   * since documents/templates shipped, and the contracts screen has always
   * uploaded signed copies under it — but it was never registered HERE, and
   * `moduleKeyForDocType` falls back to MOD-70 for anything unregistered. So a
   * signed employment contract has been gated on the SETTINGS grant: the HR
   * officer who filed it could not open it unless they also administered the
   * application, while anyone holding Settings could read every employment
   * agreement in the company. It is the most sensitive document here after a
   * payslip (0700).
   */
  EMPLOYMENT_CONTRACT:   { label: "Employment contract",      module: "hr/hr_contract",                moduleKey: "MOD-12" },
  /*
   * Session minutes filed at the close of a training (0702). Same reasoning as
   * MEETING_TRANSCRIPT: unregistered types fall back to MOD-70, so without this
   * row the facilitator who ran the session could not read back the minutes it
   * produced unless they also administered the application.
   */
  TRAINING_MINUTES:      { label: "Training session minutes",  module: "hr/training",                   moduleKey: "MOD-18" },
  /*
   * The PDF rendered from an SOP's body (0704). Registered for the same reason
   * as the two above: an unregistered type falls back to MOD-70, so the HR
   * manager who wrote the procedure could not read back the document it
   * produced unless they also administered the application — and an SOP is the
   * one document in this module that is meant to be READ by everybody it binds.
   */
  SOP_DOCUMENT:          { label: "Standard operating procedure", module: "hr/sop_onboarding",           moduleKey: "MOD-16" },
  ENTITY_DOCUMENT:       { label: "Entity document scan",     module: "master/corporate_entity",       moduleKey: "MOD-01" },
  CLIENT_DOCUMENT:       { label: "Client KYC scan",          module: "master/client_master",          moduleKey: "MOD-03" },
  SUPPLIER_DOCUMENT:     { label: "Supplier KYC scan",        module: "master/supplier_master",        moduleKey: "MOD-04" },
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
