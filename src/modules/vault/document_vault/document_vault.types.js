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
  /*
   * The procurement goods-received note (MOD-61) — issued by the
   * procurement/goods_received module. Distinct from the WMS inbound GRN
   * (grn_inbound) which has no capture yet; registering this code means the
   * vault row, the template registry entry and the RBAC gate all agree, and
   * `moduleKeyForDocType` does not fall back to MOD-70 for it.
   */
  GOODS_RECEIVED:        { label: "Goods received note",      module: "procurement/goods_received",    moduleKey: "MOD-61" },
  DELIVERY_NOTE:         { label: "Delivery note",            module: "operations/delivery_note",      moduleKey: "MOD-32" },
  TRANSIT_ORDER:         { label: "Transit order",            module: "operations/transit_order",      moduleKey: "MOD-30" },
  CASH_REQUEST:          { label: "Cash request",             module: "costing/cash_request",          moduleKey: "MOD-49" },
  /*
   * The costing worksheet (12766). It has had a TEMPLATE since documents
   * shipped and a `loadRecord` branch to build its payload — but it was never
   * registered HERE, and `assertDocType` throws 422 UNKNOWN_DOC_TYPE on
   * anything unregistered. So `document_vault.capture()` refused the one
   * document the module produces: the sheet could be previewed and printed
   * from the browser and could never be FILED, which is why no approved
   * costing in any tenant has a vault copy of what was approved.
   *
   * MOD-46 rather than the MOD-49 its two neighbours carry: a costing is the
   * operations officer's budget, and cash requests and régie advances are the
   * finance officer's disbursements. Reading follows the module that owns the
   * record, and these are two different desks.
   */
  COSTING:               { label: "Costing sheet",             module: "costing/costing",               moduleKey: "MOD-46" },
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
   * The Certificate of Completion (SIGNATURE_ENGINEERING_GUIDE §6.7).
   *
   * A doc type rather than a report, because with no PAdES seal this document
   * plus the immutable_ledger trail is the ENTIRE evidentiary case — so it
   * goes through the same pipeline as everything else: rendered by the
   * template registry, captured into document_vault, hashed like any artifact,
   * downloadable through the same gated route. An evidence document living
   * outside the vault would be the one document in the system with no content
   * hash and no audit trail of its own.
   *
   * It is NOT in SIGNATURE_CEILING below: a certificate is the output of
   * signing, and a certificate that could itself be signed is a loop.
   */
  SIGNATURE_CERTIFICATE:{ label: "Certificate of completion", module: "vault/signature_request",       moduleKey: "MOD-64" },
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
 * The signature CEILING per doc type — level 1 of the eligibility funnel
 * (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.4). Code, deliberately: a tenant may
 * narrow this but must never widen it.
 *
 *   signable   can this doc type be signed at all?
 *   allowsQes  may it be sent for third-party certification? Costs money per
 *              envelope, so it is off unless the document's nature warrants it.
 *   allowsWet  may it be printed and signed in ink? A payslip must not be — it
 *              would put a salary on paper travelling through an office — while
 *              a delivery note is signed on paper more often than not.
 *
 * Anything unlisted is NOT signable. That is the conservative default: a new
 * doc type appearing in a signing menu because somebody forgot to think about
 * it is the failure this table exists to prevent.
 */
/*
 * Null-prototype: docType reaches this map from a request body, and a plain
 * literal would resolve SIGNATURE_CEILING["constructor"] to `Object` — truthy,
 * so the `|| NOT_SIGNABLE` fallback never fired and this function returned a
 * FUNCTION where its contract promises an object. Nothing broke, because every
 * property read off it came back undefined and read as "not allowed", but that
 * is luck rather than design. Same class as the canonical.js CodeQL finding.
 */
const SIGNATURE_CEILING = Object.assign(Object.create(null), {
  FINAL_INVOICE:       { signable: true, allowsQes: true,  allowsWet: true },
  PROFORMA_ADVANCE:    { signable: true, allowsQes: false, allowsWet: true },
  QUOTATION:           { signable: true, allowsQes: true,  allowsWet: true },
  PROPOSAL:            { signable: true, allowsQes: true,  allowsWet: true },
  PURCHASE_ORDER:      { signable: true, allowsQes: true,  allowsWet: true },
  DELIVERY_NOTE:       { signable: true, allowsQes: false, allowsWet: true },
  TRANSIT_ORDER:       { signable: true, allowsQes: false, allowsWet: true },
  /*
   * The one type that may NOT be wet-signed. An employment contract carries a
   * salary, and the wet path prints it, hands it to a courier and posts the
   * scan back through a shared mailbox. It is also the type most likely to be
   * disputed years later, which is why it is the only one where certification
   * is worth its cost.
   */
  EMPLOYMENT_CONTRACT: { signable: true, allowsQes: true,  allowsWet: false },
  /*
   * The costing worksheet: signable, but neither certifiable nor wet-signable.
   *
   * NOT CERTIFIED. Certification is bought per envelope from a third party and
   * is for documents a stranger relies on — an invoice, a contract, an offer.
   * A costing is an INTERNAL budget: it is never sent to the client, and the
   * legacy system's own sheet says "estimate" on it. Paying a certification fee
   * three times per file (issue, validate, approve) for a document nobody
   * outside the building reads is a cost with no counterparty.
   *
   * NOT WET. The three seals exist to record WHO decided, and the wet path
   * prints the page, collects an ink signature and scans it back — at which
   * point the record says a scan was uploaded, not that the named validator
   * decided. It also cannot be automatic, and these seals are applied by the
   * transition itself so that no approval can be recorded without one.
   */
  COSTING:             { signable: true, allowsQes: false, allowsWet: false },
});

const NOT_SIGNABLE = Object.freeze({ signable: false, allowsQes: false, allowsWet: false });

/** The ceiling for a doc type. Unregistered types are not signable. */
const signaturePolicyFor = (docType) =>
  (typeof docType === "string" && Object.prototype.hasOwnProperty.call(SIGNATURE_CEILING, docType)
    ? SIGNATURE_CEILING[docType]
    : NOT_SIGNABLE);

/** Doc types that can carry a signature at all. */
const signableDocTypes = () => Object.keys(SIGNATURE_CEILING);

/**
 * The module whose grant governs reading this doc type. Falls back to MOD-70
 * (the historical gate) for anything unregistered, so an unknown type is gated
 * conservatively rather than left open.
 */
const moduleKeyForDocType = (docType) =>
  (isDocType(docType) && DOC_TYPES[docType].moduleKey) || "MOD-70";

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

module.exports = {
  DOC_TYPES, isDocType, assertDocType, moduleKeyForDocType,
  SIGNATURE_CEILING, signaturePolicyFor, signableDocTypes,
};
