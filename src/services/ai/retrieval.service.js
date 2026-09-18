/**
 * Retrieval — embed a query and vector-search BOTH corpora (tenant ∪ global),
 * then apply the caller's field-confidentiality to the tenant hits. Cosine
 * distance via pgvector's <=> operator. See doc/AI_KNOWLEDGE.md §3.
 *
 * ── THREE POOLS WITH SEPARATE BUDGETS (audit A3, A4) ────────────────────────
 *
 * This used to be one number. `k` defaulted to 6, was used as the LIMIT on each
 * corpus, and was then used AGAIN to truncate the merged list — so the whole
 * grounding block was six chunks, and the global corpus (which is mostly this
 * repository's own source code) competed with the tenant's own records for
 * those six slots. A question about receivables could be grounded on four
 * chunks of JavaScript.
 *
 * So hits are now drawn into three pools, each with its own budget:
 *
 *   knowledge  the OHADA KB, the PRD and the rest of `doc/` (global kind `doc`).
 *              Holds a small RESERVED allocation, because it is the only place
 *              the model can learn SYSCOHADA rules it does not know natively,
 *              and a tenant corpus of a thousand entity cards will outrank it
 *              on cosine similarity every time.
 *
 *   tenant     the caller's own records, confidentiality-filtered. Gets every
 *              slot the other two do not take — it is what a tenant question is
 *              about.
 *
 *   codebase   source, UI and platform-schema chunks. EXCLUDED BY DEFAULT
 *              (audit A4): feeding raw code and schema to the assistant is a
 *              large part of why it drifts into snake_case, UUIDs and "database
 *              language" in answers meant for an operator. A caller that really
 *              wants them — a "how does Praxis work" surface — passes
 *              `includeCodebase: true` and gets a hard-capped allocation.
 *
 * An unfilled budget is not wasted: knowledge and tenant backfill each other by
 * similarity, so a tenant with no `doc/` hits above the floor still gets `k`
 * chunks. Codebase does not take part in backfill — its budget is a ceiling,
 * not a reservation.
 */
"use strict";

const platformDb = require("../platform/db");
const embeddings = require("./embeddings.service");
const { config } = require("../../config/env");

const toVec = (arr) => `[${arr.join(",")}]`;
const bySim = (a, b) => b.sim - a.sim;

/** Global-corpus kinds that are DOMAIN KNOWLEDGE rather than this repo's guts. */
const KNOWLEDGE_KINDS = ["doc", "other"];

/**
 * Drop hits that the vector index returned only because something had to come
 * back. Deliberately low — this is a junk filter, not a relevance opinion.
 */
const SIM_FLOOR = 0.15;

/** Hard ceiling on codebase chunks when a caller opts into them. */
const CODEBASE_BUDGET = 2;

/** Over-fetch per corpus so the floor and the budgets have something to choose from. */
const fetchWidth = (k) => Math.min(60, Math.max(k, 12) * 2);

/**
 * @param {object}   opts
 * @param {string}   opts.query              natural-language query
 * @param {object}   [opts.tenantClient]     connection bound to the tenant schema
 * @param {string[]} [opts.allowed]          confidentiality tags the caller may see
 * @param {number}   [opts.k]                total chunks returned (default AI_RETRIEVAL_K)
 * @param {number}   [opts.kbBudget]         slots reserved for domain knowledge
 * @param {boolean}  [opts.includeCodebase]  include source/schema chunks (default false)
 * @param {number}   [opts.minSim]           similarity floor
 */
async function retrieve(opts) {
  const k = opts.k || config.AI_RETRIEVAL_K;
  const allowed = opts.allowed || ["normal"];
  const includeCodebase = opts.includeCodebase === true;
  const minSim = opts.minSim === undefined ? SIM_FLOOR : opts.minSim;
  // Never reserve more for the KB than the answer has room for.
  const kbBudget = Math.max(0, Math.min(opts.kbBudget === undefined ? config.AI_RETRIEVAL_KB_K : opts.kbBudget, k));
  const codeBudget = includeCodebase ? Math.min(CODEBASE_BUDGET, k) : 0;
  const width = fetchWidth(k);

  // Embed the query. When embeddings are unavailable (no vendor configured, or an
  // auth/network error) the service logs "skipping vectors" and returns []/undefined
  // — degrade gracefully to NO vector grounding rather than crashing on an undefined
  // vector. The assistant still answers, just without knowledge-base recall.
  const vec = await embeddings.embedOne(opts.tenantClient, opts.query);
  if (!vec || !vec.length) return [];
  const qvec = toVec(vec);

  const hits = [];

  // Global corpus — domain knowledge (docs). Filtered in SQL rather than after
  // the fact, so a corpus dominated by source files cannot starve the KB out of
  // its own budget before the budget is ever applied.
  const g = await platformDb.query(
    `SELECT d.kind, d.ref, d.title, c.content, 1 - (c.embedding <=> $1::vector) AS sim
       FROM platform.ai_chunk c
       JOIN platform.ai_document d ON d.ai_document_id = c.ai_document_id
      WHERE c.embedding IS NOT NULL
        AND d.kind = ANY($3)
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2`,
    [qvec, width, KNOWLEDGE_KINDS],
  );
  for (const r of g.rows) hits.push({ scope: "global", pool: "knowledge", ...r });

  // Global corpus — this repository. Only when the caller asked for it (A4), and
  // only ever a couple of chunks.
  if (codeBudget > 0) {
    const c = await platformDb.query(
      `SELECT d.kind, d.ref, d.title, c.content, 1 - (c.embedding <=> $1::vector) AS sim
         FROM platform.ai_chunk c
         JOIN platform.ai_document d ON d.ai_document_id = c.ai_document_id
        WHERE c.embedding IS NOT NULL
          AND NOT (d.kind = ANY($3))
        ORDER BY c.embedding <=> $1::vector
        LIMIT $2`,
      [qvec, width, KNOWLEDGE_KINDS],
    );
    for (const r of c.rows) hits.push({ scope: "global", pool: "codebase", ...r });
  }

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
      [qvec, width, allowed],
    );
    for (const r of t.rows) hits.push({ scope: "tenant", pool: "tenant", ...r });
  }

  const ranked = boostDomainHits(hits, opts.query || "").filter((h) => Number(h.sim) >= minSim);
  return compose(ranked, { k, kbBudget, codeBudget });
}

/**
 * Fill the answer from the three pools: knowledge takes its reservation first
 * (it is the pool that gets crowded out), codebase takes its hard cap, and the
 * tenant takes everything left. Knowledge and tenant then backfill each other
 * by similarity so an empty pool costs nobody a slot.
 */
function compose(ranked, { k, kbBudget, codeBudget }) {
  const pools = { knowledge: [], tenant: [], codebase: [] };
  for (const h of ranked) (pools[h.pool] || pools.tenant).push(h);
  for (const p of Object.values(pools)) p.sort(bySim);

  const picked = [];
  const take = (pool, n) => {
    for (let i = 0; i < n && pool.length; i++) picked.push(pool.shift());
  };

  take(pools.knowledge, kbBudget);
  take(pools.codebase, codeBudget);
  take(pools.tenant, k - picked.length);
  take([...pools.knowledge, ...pools.tenant].sort(bySim), k - picked.length);

  return picked.sort(bySim).slice(0, k);
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
// Bare two-letter tokens (`IS` for impôt sur les sociétés, `GL` for general
// ledger) were in this list under the /i flag, so `\bIS\b` matched the English
// word "is" and `\bGL\b`… — the boost fired on almost every question (audit A2).
// They are spelled out here instead; the long forms below already cover them.
const DOMAIN_KEYWORDS = /\b(ohada|syscohada|débours|disbursement|journal entry|posting|chart of accounts|VAT|TVA|tax declaration|withholding|précompte|acompte|impôt sur les sociétés|corporate income tax|BIC|CNPS|NIU|patente|financial statement|bilan|compte de résultat|TAFIRE|general ledger|double.entry|depreciation|amortissement)\b/i;
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

module.exports = { retrieve, toContextBlock, boostDomainHits, compose };
