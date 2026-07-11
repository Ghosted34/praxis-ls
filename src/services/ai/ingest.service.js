/**
 * Ingestion — embed knowledge and upsert it into a corpus. Idempotent via
 * content_hash (unchanged sources/chunks are skipped). Two targets:
 *   ingestGlobal(items)              → platform.ai_* (codebase, docs, platform schema)
 *   ingestTenantCards(client, cards) → <tenant>.ai_* (schema cards + entity cards)
 * See doc/AI_KNOWLEDGE.md §4.
 */
"use strict";

const platformDb = require("../platform/db");
const { chunkText, sha256 } = require("./chunker");
const embeddings = require("./embeddings.service");
const { logger } = require("../../config/logger");

const toVec = (arr) => `[${arr.join(",")}]`;

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
 * Replace-by-source_ref keeps it idempotent.
 */
async function ingestTenantCards(client, cards) {
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

module.exports = { ingestGlobal, ingestTenantCards };
