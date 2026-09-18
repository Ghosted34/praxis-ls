/**
 * AI action manifest (AI_ARCHITECTURE §2) for the document vault (MOD-64).
 *
 * ── WHY `get_document` IS NOT HERE, AND MUST NOT BE ADDED CASUALLY ──────────
 *
 * `document_vault.routes.js` records SEC-M3: `GET /:id` once required MOD-64
 * `view` and nothing else, which made that grant a skeleton key over contracts,
 * payslips and ID documents across every department. The fix was
 * `service.assertDocumentAccess(docClient, identityClient, docId, user, action)`
 * — authority follows the RECORD, and the check needs BOTH a tenant connection
 * and an IDENTITY connection to resolve the caller's grants.
 *
 * The AI write/read adapters hand a manifest exactly one client. There is no
 * identity connection to pass, so a `get_document` tool could not run that
 * check — it would be the pre-SEC-M3 endpoint again, reached through the
 * assistant. It is left out until the adapter can carry the second connection.
 *
 * `list` and `archive` ARE here because they carry the same gate as their HTTP
 * routes (`MOD-64 view` / `MOD-64 delete`) and no per-record check beyond it,
 * so the assistant's reach is exactly the caller's and not one document wider.
 * `create` is left out for a different reason: it takes a base64 data URL, and
 * an upload is a file picker's job, not a sentence's.
 */
"use strict";

const service = require("./document_vault.service");
const validator = require("./document_vault.validator");

const MOD = "MOD-64";

module.exports = {
  entity: "document_vault",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_documents", service: (c, p) => service.list(c, p || {}), permission: { module: MOD, action: "view" }, describe: "List vaulted documents (filter by dossier, client, doc type or the record they are filed against). Returns metadata, never bytes." },
  ],

  writes: [
    {
      key: "archive_document",
      service: (c, p, actor) => service.archiveDocument(c, { id: p.document_vault_id, actor }),
      schema: validator.schemas.aiArchive,
      permission: { module: MOD, action: "delete" },
      confirm: true,
      describe: "Archive (soft-delete) a vaulted document by id. The bytes and the audit trail survive; the document stops appearing in the vault.",
    },
  ],
};
