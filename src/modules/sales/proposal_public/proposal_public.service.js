"use strict";
const crypto = require("crypto");
const repo = require("../proposal/proposal.repo");
const presentation = require("../proposal/proposal.presentation");
const vault = require("../../vault/document_vault/document_vault.service");
const { AppError } = require("../../../utils/errors");
const hash = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const notFound = () => new AppError("NOT_FOUND", "Proposal not found", 404);
const languageRef = (id, language) => `proposal:${id}:lang:${language}`;

async function resolve(client, token) {
  const row = await repo.byShareHash(client, hash(token));
  if (!row || row.status !== "SENT" || row.share_revoked_at || !row.share_expires_at || new Date(row.share_expires_at) <= new Date()) {
    throw notFound();
  }
  return row;
}

async function parts(client, row) {
  const [lines, narratives, clientResult] = await Promise.all([
    repo.listLines(client, row.proposal_id),
    repo.listNarratives(client, row.proposal_id),
    row.client_id
      ? client.query("SELECT name, legal_name FROM client_master WHERE client_id=$1", [row.client_id])
      : Promise.resolve({ rows: [] }),
  ]);
  return { lines, narratives, client: clientResult.rows[0] || null };
}

async function get(client, token, requestedLanguage = null) {
  const row = await resolve(client, token);
  const detail = await parts(client, row);
  const selected = presentation.selectedLanguage(row, requestedLanguage);
  const model = presentation.build({ proposal: row, ...detail, language: selected });
  await repo.stampViewed(client, row.proposal_id);
  return { presentation: model };
}

async function download(client, token, requestedLanguage = null) {
  const row = await resolve(client, token);
  const selected = presentation.selectedLanguage(row, requestedLanguage);
  // New captures are language-specific. The legacy pointer remains a fallback
  // only for proposals sent before language-specific capture was introduced.
  const exact = await vault.getByRef(client, languageRef(row.proposal_id, selected));
  const docId = exact && exact.doc_id || row.pdf_vault_id;
  if (!docId) throw notFound();
  const out = await vault.fetchBytes(client, docId);
  await repo.stampDownloaded(client, row.proposal_id);
  return out;
}

module.exports = { get, download, resolve, hash, notFound, languageRef, parts };
