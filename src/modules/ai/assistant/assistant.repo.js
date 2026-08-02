/**
 * Assistant conversation history.
 *
 * `ai_conversation` / `ai_message` have existed since 0400_ai.sql but nothing
 * ever wrote to them — `orchestrator.ask` built a two-message request (system +
 * the current question) on every call, so the assistant had no memory of the
 * previous turn. These are the reads/writes that make it a conversation.
 *
 * MODEL: one rolling thread per user. There is no thread list and no "new chat"
 * picker; the copilot is a floating panel that continues where you left off, and
 * clearing starts a fresh conversation row. SQL only, per doc/CONVENTIONS.md.
 */
"use strict";

/**
 * The user's current thread, created on first use.
 *
 * Picks the most recent conversation rather than assuming one exists: `clear`
 * leaves old rows in place (history is retained, just detached), so a user can
 * legitimately have several, and the newest is always the live one.
 */
async function currentConversation(client, userId) {
  const { rows } = await client.query(
    "SELECT conversation_id FROM ai_conversation WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  if (rows[0]) return rows[0].conversation_id;
  const created = await client.query(
    "INSERT INTO ai_conversation (user_id) VALUES ($1) RETURNING conversation_id",
    [userId],
  );
  return created.rows[0].conversation_id;
}

/**
 * Last N turns, oldest-first (chat order).
 *
 * Selected newest-first then reversed, because the LIMIT has to take the most
 * RECENT rows — ordering ascending with a LIMIT would return the oldest ones.
 * Only user/assistant roles: `tool` and `system` rows are execution detail, and
 * replaying them would confuse the model rather than inform it.
 */
async function recentMessages(client, conversationId, limit = 20) {
  const { rows } = await client.query(
    "SELECT role, content FROM ai_message " +
      "WHERE conversation_id = $1 AND role IN ('user','assistant') AND content IS NOT NULL AND content <> '' " +
      "ORDER BY created_at DESC, ai_message_id DESC LIMIT $2",
    [conversationId, limit],
  );
  return rows.reverse();
}

/** Full thread for the panel to render on open (newest N, chat order). */
async function listMessages(client, conversationId, limit = 200) {
  const { rows } = await client.query(
    "SELECT ai_message_id, role, content, created_at FROM ai_message " +
      "WHERE conversation_id = $1 AND role IN ('user','assistant') " +
      "ORDER BY created_at DESC, ai_message_id DESC LIMIT $2",
    [conversationId, limit],
  );
  return rows.reverse();
}

async function addMessage(client, { conversationId, role, content }) {
  const { rows } = await client.query(
    "INSERT INTO ai_message (conversation_id, role, content) VALUES ($1,$2,$3) RETURNING ai_message_id, role, content, created_at",
    [conversationId, role, content],
  );
  return rows[0];
}

/**
 * Start a fresh thread.
 *
 * Deliberately does NOT delete: retention is "keep indefinitely" for now, and
 * ai_action_run references conversation_id, so deleting would either cascade
 * away an audit trail of proposed/executed actions or fail on the FK. Inserting
 * a new conversation makes it the current one and leaves the old thread intact.
 */
async function startNewConversation(client, userId) {
  const { rows } = await client.query(
    "INSERT INTO ai_conversation (user_id) VALUES ($1) RETURNING conversation_id",
    [userId],
  );
  return rows[0].conversation_id;
}

// ── Rolling summary (0481) ──────────────────────────────────────────────────
// The replay window keeps per-call cost flat; the summary is what stops the
// messages that fall out of it from vanishing entirely. See orchestrator.service.

/** The conversation's stored summary + how far it covers. */
async function conversationSummary(client, conversationId) {
  const { rows } = await client.query(
    "SELECT summary, summary_through, summary_at FROM ai_conversation WHERE conversation_id = $1",
    [conversationId],
  );
  return rows[0] || { summary: null, summary_through: null, summary_at: null };
}

/**
 * Messages that have scrolled out of the replay window and are NOT yet covered
 * by the summary — i.e. exactly the text at risk of being forgotten.
 *
 * `keepRecent` mirrors the orchestrator's replay window: those rows are re-sent
 * verbatim, so summarising them too would duplicate them in the prompt.
 * `sinceMessageId` is the last message the current summary covers; ordering by
 * `(created_at, ai_message_id)` as a ROW comparison matches the ordering used
 * everywhere else in this file, so a batch can neither skip nor double-count a
 * message when two land in the same millisecond.
 *
 * Oldest-first: a summariser reads a transcript in the order it happened.
 */
async function messagesAwaitingSummary(client, conversationId, { keepRecent = 20, sinceMessageId = null } = {}) {
  const { rows } = await client.query(
    `WITH ranked AS (
       SELECT ai_message_id, role, content, created_at,
              row_number() OVER (ORDER BY created_at DESC, ai_message_id DESC) AS rn
         FROM ai_message
        WHERE conversation_id = $1
          AND role IN ('user','assistant')
          AND content IS NOT NULL AND content <> ''
     ),
     mark AS (
       SELECT created_at, ai_message_id FROM ai_message WHERE ai_message_id = $3
     )
     SELECT r.ai_message_id, r.role, r.content
       FROM ranked r
      WHERE r.rn > $2
        AND (NOT EXISTS (SELECT 1 FROM mark)
             OR (r.created_at, r.ai_message_id) > (SELECT created_at, ai_message_id FROM mark))
      ORDER BY r.created_at ASC, r.ai_message_id ASC`,
    [conversationId, keepRecent, sinceMessageId],
  );
  return rows;
}

/**
 * Replace the summary (never append).
 *
 * Replacing is the whole point: an appended summary grows without bound and
 * recreates the cost problem the replay window exists to solve. `summary_through`
 * advances to the newest message the new text covers, so the next batch resumes
 * exactly where this one stopped.
 */
async function setSummary(client, conversationId, { summary, throughMessageId }) {
  await client.query(
    "UPDATE ai_conversation SET summary = $2, summary_through = $3, summary_at = now() WHERE conversation_id = $1",
    [conversationId, summary, throughMessageId || null],
  );
}

module.exports = {
  currentConversation,
  recentMessages,
  listMessages,
  addMessage,
  startNewConversation,
  conversationSummary,
  messagesAwaitingSummary,
  setSummary,
};
