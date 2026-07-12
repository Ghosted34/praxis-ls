/**
 * Ingestion — embed knowledge and upsert it into a corpus. Idempotent via
 * content_hash (unchanged sources/chunks are skipped). Two targets:
 *   ingestGlobal(items)              → platform.ai_* (codebase, docs, platform schema)
 *   ingestTenantCards(client, cards) → <tenant>.ai_* (schema cards + entity cards)
 * See doc/AI_KNOWLEDGE.md §4.
 *
 * Tenant ingestion HONOURS the per-tenant `ai.vectorization` toggle
 * (AI_READINESS Rule 4): an AI-disabled tenant's data is never embedded. The
 * event-driven re-embed handler (reembedEntity) refreshes just the changed
 * entity's cards when the Universal Event Engine fires its `entity.action`.
 */
"use strict";

const platformDb = require("../platform/db");
const { chunkText, sha256 } = require("./chunker");
const embeddings = require("./embeddings.service");
const entityCards = require("./knowledge/entity-cards");
const { logger } = require("../../config/logger");

const toVec = (arr) => `[${arr.join(",")}]`;

/** Is semantic recall/embedding enabled for this tenant? (feature_state gate.) */
async function isVectorizationOn(client) {
  try {
    const { rows } = await client.query(
      "SELECT state FROM feature_state WHERE feature_key = $1",
      ["ai.vectorization"],
    );
    // Default-off: only 'on' enables embedding (AI is opt-in per tenant).
    return rows.length > 0 && rows[0].state === "on";
  } catch {
    return false; // no feature_state / not resolvable → do not embed
  }
}

async function embedChunks(client, chunks) {
  if (chunks.length === 0) return [];
  const vecs = await embeddings.embedBatch(client, chunks.map((c) => c.content));
  return chunks.map((c, i) => ({ ...c, vec: toVec(vecs[i]) }));
}

/** Global corpus (platform DB). items: { kind, ref, title, content }. */
async function ingestGlobal(items) {
  const pf = platformDb.getPool();
  let changed = 0;
  for (const it of items) {
    const hash = sha256(it.content);
    const src = await pf.query(
      `INSERT INTO platform.ai_source (kind, ref, title, content_hash, last_indexed_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (kind, ref) DO UPDATE SET title=EXCLUDED.title
       RETURNING ai_source_id, content_hash`,
      [it.kind, it.ref, it.title || it.ref, hash],
    );
    const row = src.rows[0];
    if (row.content_hash === hash) {
      // hash matched an already-indexed source → nothing to do
      const existing = await pf.query(
        "SELECT count(*)::int AS n FROM platform.ai_document WHERE ai_source_id=$1",
        [row.ai_source_id],
      );
      if (existing.rows[0].n > 0) continue;
    }
    await pf.query("DELETE FROM platform.ai_document WHERE ai_source_id=$1", [row.ai_source_id]);
    const doc = await pf.query(
      `INSERT INTO platform.ai_document (ai_source_id, kind, ref, title)
       VALUES ($1,$2,$3,$4) RETURNING ai_document_id`,
      [row.ai_source_id, it.kind, it.ref, it.title || it.ref],
    );
    const docId = doc.rows[0].ai_document_id;
    const chunks = await embedChunks(null, chunkText(it.content));
    for (const c of chunks) {
      await pf.query(
        `INSERT INTO platform.ai_chunk (ai_document_id, chunk_no, content, content_hash, embedding, token_count)
         VALUES ($1,$2,$3,$4,$5::vector,$6)`,
        [docId, c.chunk_no, c.content, c.content_hash, c.vec, c.token_count],
      );
    }
    await pf.query("UPDATE platform.ai_source SET content_hash=$2, last_indexed_at=now() WHERE ai_source_id=$1", [row.ai_source_id, hash]);
    changed += 1;
  }
  logger.info({ items: items.length, changed }, "global corpus ingested");
  return { total: items.length, changed };
}

/**
 * Tenant corpus. `client` is a connection already bound to the tenant schema
 * (search_path=live|sandbox). cards: { ref, title, text, confidentiality, dossierRef? }.
 * Replace-by-source_ref keeps it idempotent. Skips entirely when the tenant's
 * `ai.vectorization` flag is off (no embedding for an AI-disabled tenant).
 */
async function ingestTenantCards(client, cards, { force = false } = {}) {
  if (!force && !(await isVectorizationOn(client))) {
    return { cards: 0, skipped: "ai.vectorization off" };
  }
  let n = 0;
  for (const card of cards) {
    await client.query("DELETE FROM ai_document WHERE source_ref=$1", [card.ref]);
    const doc = await client.query(
      `INSERT INTO ai_document (source_kind, source_ref, title, confidentiality)
       VALUES ($1,$2,$3,$4) RETURNING ai_document_id`,
      [card.ref.split(":")[0], card.ref, card.title || card.ref, card.confidentiality || "normal"],
    );
    const docId = doc.rows[0].ai_document_id;
    const chunks = await embedChunks(client, chunkText(card.text));
    for (const c of chunks) {
      await client.query(
        `INSERT INTO ai_chunk (ai_document_id, chunk_no, content, embedding, token_count)
         VALUES ($1,$2,$3,$4::vector,$5)`,
        [docId, c.chunk_no, c.content, c.vec, c.token_count],
      );
    }
    n += 1;
  }
  return { cards: n };
}

/**
 * Event-driven re-embed (AI_KNOWLEDGE §4 / AI_ARCHITECTURE grounding freshness).
 * Given a changed entity_ref ("<prefix>:<id>"), refresh the cards for that
 * entity's TYPE and re-ingest them (idempotent, replace-by-source_ref). Gated by
 * the tenant's ai.vectorization flag. Best-effort: a re-embed failure must never
 * break the business transaction that emitted the event, so callers invoke it
 * post-commit / from the ingest worker, and it swallows errors.
 */
async function reembedEntity(client, { entityRef } = {}) {
  if (!entityRef) return { reembedded: 0, skipped: "no entity_ref" };
  if (!(await isVectorizationOn(client))) return { reembedded: 0, skipped: "ai.vectorization off" };
  const prefix = String(entityRef).split(":")[0];
  // Map the changed entity's prefix to the knowledge builder for its type.
  const builder = entityCards.BUILDERS.find((b) => b.key === prefix)
    || entityCards.BUILDERS.find((b) => b.card({}).ref.split(":")[0] === prefix);
  if (!builder) return { reembedded: 0, skipped: `no card builder for '${prefix}'` };
  try {
    const cards = (await entityCards.buildEntityCards(client, { limitPerEntity: 500 }))
      .filter((c) => c.ref.split(":")[0] === prefix);
    const res = await ingestTenantCards(client, cards, { force: true });
    return { reembedded: res.cards, entity: prefix };
  } catch (err) {
    logger.warn({ err: err.message, entityRef }, "re-embed failed (best-effort)");
    return { reembedded: 0, error: err.message };
  }
}

module.exports = { ingestGlobal, ingestTenantCards, reembedEntity, isVectorizationOn };
