/**
 * SEARCH BY MEANING (§8.9).
 *
 * The mailbox's keyword search finds "demurrage" in threads containing the word
 * "demurrage". §8.9's toggle is for the other question — "when did we last
 * argue about storage charges at Douala" — where the operator remembers the
 * situation and not the vocabulary.
 *
 * ── HOW THREADS GET INTO THE CORPUS ─────────────────────────────────────────
 *
 * `ingestThread` writes ONE card per thread into the tenant's `ai_document` /
 * `ai_chunk` corpus, replace-by-`source_ref`, through the SAME
 * `services/ai/ingest.service` every other entity uses. Not a mail-specific
 * embedding path: a second one would need its own vectorization gate, its own
 * idempotence and its own dimension agreement with the retrieval side, and the
 * first time any of the three drifted, mail would be the corpus that silently
 * stopped matching.
 *
 * It inherits that service's `ai.vectorization` gate, so a tenant that has not
 * opted into embedding never has its correspondence vectorised. This matters
 * more for mail than for a schema card: email is the most sensitive corpus in
 * the product and "we embedded it because the feature existed" is not consent.
 *
 * ── THE VISIBILITY RE-FILTER IS NOT OPTIONAL ────────────────────────────────
 *
 * `ai_document.confidentiality` is a coarse tag; §9.5's rule is per-thread and
 * depends on connection membership, ownership and explicit shares. So the
 * vector search returns CANDIDATE thread ids, and every one is then re-read
 * through `triage/visibility`'s single predicate before it is returned. The
 * embedding layer can never be the thing that decides who sees a thread —
 * otherwise a PRIVATE thread becomes readable the moment someone phrases a
 * query that resembles it, which is a leak with no audit trail and no obvious
 * symptom.
 *
 * Both halves are needed: without the ingest there is nothing to search;
 * without the re-filter the search is a bypass around §9.5.
 */
"use strict";

const ingest = require("../../../services/ai/ingest.service");
const retrieval = require("../../../services/ai/retrieval.service");
const visibility = require("../triage/visibility");
const { logger } = require("../../../config/logger");

const REF = (threadId) => `email_thread:${threadId}`;

/**
 * One card per THREAD, not per message.
 *
 * A thread is the unit an operator remembers ("the argument with Camrail about
 * storage"), and per-message cards would return six near-identical hits from
 * the same conversation and push every other thread off the first page.
 */
async function ingestThread(client, threadId) {
  const { rows } = await client.query(
    `SELECT t.email_thread_id, t.subject, t.visibility,
            m.direction, m.from_address, m.body_text, m.received_at
       FROM email_thread t
       JOIN email_message m ON m.email_thread_id = t.email_thread_id
      WHERE t.email_thread_id = $1
      ORDER BY m.received_at
      LIMIT 40`,
    [threadId],
  );
  if (!rows.length) return { cards: 0, skipped: "no messages" };

  const text = [
    `Subject: ${rows[0].subject || "(none)"}`,
    ...rows.map((m) => `${m.direction === "OUT" ? "We wrote" : `${m.from_address} wrote`} ` +
      `on ${m.received_at ? new Date(m.received_at).toISOString().slice(0, 10) : "an unknown date"}: ` +
      `${String(m.body_text || "").slice(0, 4000)}`),
  ].join("\n\n");

  return ingest.ingestTenantCards(client, [{
    ref: REF(threadId),
    title: rows[0].subject || "(no subject)",
    text,
    // Tagged by the thread's own visibility so the corpus is not FLATTER than
    // the mailbox. The per-thread re-filter below is still what enforces the
    // rule — this is defence in depth, not the defence.
    confidentiality: rows[0].visibility === "COMPANY" ? "normal" : "restricted",
  }]);
}

/**
 * Best-effort, post-ingest. Called from the sync path.
 *
 * Swallows everything: a mailbox that stops syncing because an embedding vendor
 * is down is a far worse outcome than a thread that is not yet searchable by
 * meaning, and the next message on the thread re-ingests it anyway.
 */
async function onThreadUpdated(client, threadId) {
  try {
    return await ingestThread(client, threadId);
  } catch (err) {
    logger.warn({ err, threadId }, "mail semantic ingest failed");
    return { cards: 0, error: true };
  }
}

/**
 * Search by meaning, then prove visibility.
 *
 * `k` is deliberately over-fetched (3×) before the re-filter, because the
 * filter removes rows: asking for 10 and filtering to 2 would look like the
 * feature does not work, when what happened is that eight hits belonged to
 * other people's private threads.
 */
async function search(client, { query, userId, limit = 10 } = {}) {
  if (!query || !String(query).trim()) return { hits: [], query: query || "" };

  const hits = await retrieval.retrieve({
    query: String(query),
    tenantClient: client,
    allowed: ["normal", "restricted"],
    k: Math.min(60, limit * 3),
  });

  const ids = [];
  const sim = new Map();
  for (const h of hits) {
    const m = /^email_thread:(.+)$/.exec(String(h.ref || ""));
    if (!m) continue;
    if (!sim.has(m[1])) { ids.push(m[1]); sim.set(m[1], Number(h.sim)); }
  }
  if (!ids.length) return { hits: [], query: String(query), searched: hits.length };

  // The SAME predicate as list, get, timeline and export. `$2` is the caller;
  // `$1` is the candidate set.
  const { rows } = await client.query(
    `SELECT t.email_thread_id, t.subject, t.entity_ref, t.visibility, t.last_message_at
       FROM email_thread t
       JOIN email_connection c ON c.email_connection_id = t.email_connection_id
      WHERE t.email_thread_id = ANY($1::uuid[])
        AND ${visibility.clause("$2")}`,
    [ids, userId],
  );

  return {
    query: String(query),
    // Ordered by MEANING, not by the database's row order — the re-filter is a
    // permission check and must not be allowed to re-rank the results.
    hits: rows
      .map((r) => ({ ...r, similarity: sim.get(r.email_thread_id) || 0 }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit),
    searched: hits.length,
    withheld: ids.length - rows.length,
  };
}

module.exports = { ingestThread, onThreadUpdated, search, REF };
