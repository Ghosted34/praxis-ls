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
  const qvec = toVec(await embeddings.embedOne(opts.query));

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
  return hits.slice(0, k);
}

/** Format hits into a grounding block for the model prompt. */
function toContextBlock(hits) {
  return hits
    .map((h, i) => `[#${i + 1} ${h.scope}:${h.ref} sim=${Number(h.sim).toFixed(2)}]\n${h.content}`)
    .join("\n\n");
}

module.exports = { retrieve, toContextBlock };
