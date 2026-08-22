/**
 * Verification-portal repository (MOD-66).
 *
 * Almost everything this module reads belongs to another module's table, and it
 * reads those through their own repos rather than duplicating SQL:
 *
 *   document_signature (+ signature_scan)  → document_signature.repo
 *   the live record, for the hash recompute → template.service.loadRecord
 *
 * What is left, and what this file owns, is the tenant's own legal block. The
 * portal prints it (§5.4) for a reason worth stating: a stranger who has just
 * been told a document is genuine needs a way to reach the company that issued
 * it WITHOUT going through whoever handed them the paper. A verification page
 * that authenticates a document but leaves its reader unable to phone anyone is
 * half a page.
 */
"use strict";

/**
 * The issuing company, as printed. `ORDER BY created_at LIMIT 1` mirrors
 * corporate_entity.repo's own "the tenant's primary entity" query: a tenant
 * with subsidiaries still has one company whose letterhead its documents carry,
 * and it is the oldest row.
 *
 * A missing row returns null rather than throwing — a tenant that has not
 * finished onboarding should still be able to verify a document; it just shows
 * one block less.
 */
async function legalBlock(client) {
  const { rows } = await client.query(
    "SELECT legal_name, trading_name, rccm, niu, address, country_code "
      + "FROM corporate_entity ORDER BY created_at LIMIT 1",
  );
  return rows[0] || null;
}

/**
 * The vaulted bytes' hash for a document, used for the SECOND verdict.
 *
 * Deliberately not a join off the signature row: `document_vault_id` is NULL
 * until the document has been rendered, and "not rendered yet" and "rendered,
 * and the bytes do not match" are different answers that the portal states
 * differently. A join would collapse them into one NULL.
 */
async function vaultedHash(client, docId) {
  if (!docId) return null;
  const { rows } = await client.query(
    "SELECT doc_id, content_hash, version_no, status FROM document_vault WHERE doc_id = $1",
    [docId],
  );
  return rows[0] || null;
}

module.exports = { legalBlock, vaultedHash };
