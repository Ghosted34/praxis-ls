/**
 * AI action manifest (AI_ARCHITECTURE §2) for wet (paper) signatures (MOD-64).
 *
 * The paper lane of the signature product: print a barcoded sheet, have it
 * signed by hand, scan it back, and reconcile the scan to the job it came from.
 * The unreconciled queue is the thing somebody has to chase, so it is the read
 * that earns its place here.
 *
 * `ingest`, `decodeAndReconcile`, `bind` and `reject` are deliberately absent.
 * Ingest carries a base64 scan, which is an upload rather than a sentence; and
 * bind/reject are the human adjudication of an ambiguous scan — precisely the
 * decision that should not be proposed by something that cannot see the paper.
 */
"use strict";

const service = require("./signature_wet.service");
const validator = require("./signature_wet.validator");

const MOD = "MOD-64";

module.exports = {
  entity: "signature_wet",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "wet_signature_queue", service: (c, p) => service.queue(c, p || {}), permission: { module: MOD, action: "view" }, describe: "Scanned wet-signature sheets still waiting to be reconciled to a print job." },
    { key: "unreconciled_wet_signatures", service: (c) => service.unreconciledOffenders(c), permission: { module: MOD, action: "view" }, describe: "Print jobs whose signed paper never came back within the policy window — the chase list." },
  ],

  writes: [
    {
      key: "issue_wet_signature_job",
      service: (c, p, actor) => service.issue(c, { requestId: p.request_id, partyId: p.party_id, entityRef: p.entity_ref, docType: p.doc_type, documentVaultId: p.document_vault_id, actor }),
      schema: validator.schemas.issue,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Issue a barcoded print job for a document so it can be signed on paper.",
    },
    {
      key: "mark_wet_signature_printed",
      service: (c, p, actor) => service.markPrinted(c, { id: p.print_job_id, actor }),
      schema: validator.schemas.aiPrinted,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Record that a wet-signature print job by id has actually been printed.",
    },
  ],
};
