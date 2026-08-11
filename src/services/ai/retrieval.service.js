/**
 * Retrieval — embed a query and vector-search BOTH corpora (tenant ∪ global),
 * then apply the caller's field-confidentiality to the tenant hits. Cosine
 * distance via pgvector's <=> operator. See doc/AI_KNOWLEDGE.md §3.
 */
"use strict";

const platformDb = require("../platform/db");
const embeddings = require("./embeddings.service");

const toVec = (arr) => `[${arr.join(",")}]`;

/**
 * @param {object}   opts
 * @param {string}   opts.query              natural-language query
 * @param {object}   [opts.tenantClient]     connection bound to the tenant schema
 * @param {string[]} [opts.allowed]          confidentiality tags the caller may see
 * @param {number}   [opts.k]                top-k per corpus (default 6)
 */
async function retrieve(opts) {
  const k = opts.k || 6;
  const allowed = opts.allowed || ["normal"];

  // Embed the query. When embeddings are unavailable (no vendor configured, or an
  // auth/network error) the service logs "skipping vectors" and returns []/undefined
  // — degrade gracefully to NO vector grounding rather than crashing on an undefined
  // vector. The assistant still answers, just without knowledge-base recall.
  const vec = await embeddings.embedOne(opts.tenantClient, opts.query);
  if (!vec || !vec.length) return [];
  const qvec = toVec(vec);

  const hits = [];

  // Global corpus (codebase, docs, platform schema) — always visible.
  const g = await platformDb.query(
    `SELECT d.kind, d.ref, d.title, c.content, 1 - (c.embedding <=> $1::vector) AS sim
       FROM platform.ai_chunk c
       JOIN platform.ai_document d ON d.ai_document_id = c.ai_document_id
      WHERE c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2`,
    [qvec, k],
  );
  for (const r of g.rows) hits.push({ scope: "global", ...r });

  // Tenant corpus — filtered by confidentiality the caller may see.
  if (opts.tenantClient) {
    const t = await opts.tenantClient.query(
      `SELECT d.source_kind AS kind, d.source_ref AS ref, d.title, c.content,
              1 - (c.embedding <=> $1::vector) AS sim
         FROM ai_chunk c
         JOIN ai_document d ON d.ai_document_id = c.ai_document_id
        WHERE c.embedding IS NOT NULL
          AND d.confidentiality = ANY($3)
        ORDER BY c.embedding <=> $1::vector
        LIMIT $2`,
      [qvec, k, allowed],
    );
    for (const r of t.rows) hits.push({ scope: "tenant", ...r });
  }

  hits.sort((a, b) => b.sim - a.sim);
  const ranked = boostDomainHits(hits, opts.query || "");
  return ranked.slice(0, k);
}

/**
 * Boost OHADA/accounting domain docs when the query is about accounting, tax,
 * VAT, journal entries, GL, débours, SYSCOHADA, etc. The OHADA KB is 1,640
 * lines of domain-specific knowledge that the model doesn't have natively —
 * when the user asks an accounting question, those chunks should rank higher
 * than generic codebase chunks with similar cosine similarity.
 *
 * This is a post-retrieval re-rank, not a filter: non-OHADA hits still appear,
 * just below the boosted ones. The boost is additive (not multiplicative) so
 * a genuinely irrelevant OHADA chunk (sim=0.2) won't outrank a relevant
 * codebase chunk (sim=0.85).
 */
const DOMAIN_KEYWORDS = /\b(ohada|syscohada|débours|disbursement|journal entry|posting|chart of accounts|VAT|TVA|tax declaration|withholding|précompte| acompte|IS\b|BIC|TVA|CNPS|NIU|patente|financial statement|bilan|compte de résultat|TAFIRE|GL|general ledger|double.entry|depreciation|amortissement)\b/i;
const OHADA_REF = /ohada|OHADA_KB|Accounting.*KnowledgeBase|tax.*knowledge/i;

function boostDomainHits(hits, query) {
  if (!DOMAIN_KEYWORDS.test(query)) return hits; // not an accounting query → no boost
  return hits.map((h) => {
    if (OHADA_REF.test(h.ref || "") || OHADA_REF.test(h.title || "")) {
      return { ...h, sim: Math.min(h.sim + 0.15, 1.0) };
    }
    return h;
  }).sort((a, b) => b.sim - a.sim);
}

/** Format hits into a grounding block for the model prompt. */
function toContextBlock(hits) {
  return hits
    .map((h, i) => `[#${i + 1} ${h.scope}:${h.ref} sim=${Number(h.sim).toFixed(2)}]\n${h.content}`)
    .join("\n\n");
}

module.exports = { retrieve, toContextBlock };
