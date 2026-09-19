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
 *
 * MANAGEMENT (13930, audit J1-J3). That model is still true of the DRAWER, and
 * it stopped being the whole truth the moment the workspace grew a history rail.
 * A thread you can only ever add to is a thread you cannot get rid of, and the
 * review raised the case that makes that unacceptable: sensitive research typed
 * into the copilot with no way to remove it. So a conversation can now be
 * pinned, renamed, archived, soft-deleted and — behind its own confirm —
 * purged.
 *
 * EVERY ONE OF THOSE IS OWNERSHIP-SCOPED IN THE SQL, not in a check above it.
 * `WHERE conversation_id = $1 AND user_id = $2` is on each statement, so the
 * worst case for a caller that forgets to verify ownership is that nothing
 * happens — never that it happens to somebody else's thread. The functions
 * return a boolean for "did this match a row of yours", which is what lets the
 * service answer 404 without a second query.
 */
"use strict";
const { atomically } = require("../../../shared/db/tx");

/**
 * The user's current thread, created on first use.
 *
 * Picks the most recent conversation rather than assuming one exists: `clear`
 * leaves old rows in place (history is retained, just detached), so a user can
 * legitimately have several, and the newest is always the live one.
 *
 * ARCHIVED AND DELETED THREADS ARE NOT CANDIDATES (13930). Both are things the
 * user has explicitly put away, and resuming into one on the next question is
 * the opposite of what either gesture asked for — archiving the thread you were
 * in and having the assistant carry straight on in it would read as the control
 * being broken. Skipping both means the next question lands in a fresh thread,
 * which is what the INSERT below already does when a user has none.
 */
async function currentConversation(client, userId) {
  const { rows } = await client.query(
    "SELECT conversation_id FROM ai_conversation " +
      "WHERE user_id = $1 AND deleted_at IS NULL AND archived_at IS NULL " +
      "ORDER BY created_at DESC LIMIT 1",
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

/**
 * Full thread for the panel to render on open (newest N, chat order).
 *
 * SELECTS THE GROUNDING TOO (0521). It used to return role + content only,
 * which meant a reopened conversation came back as bare prose: the Sources tab
 * was empty and every trace disclosure was gone, on a thread that had visibly
 * had both an hour earlier. The columns are nullable for rows written before
 * 0521, and the client renders on presence, so an old message simply shows no
 * citations rather than showing wrong ones.
 */
async function listMessages(client, conversationId, limit = 200) {
  const { rows } = await client.query(
    "SELECT ai_message_id, role, content, sources, trace, created_at FROM ai_message " +
      "WHERE conversation_id = $1 AND role IN ('user','assistant') " +
      "ORDER BY created_at DESC, ai_message_id DESC LIMIT $2",
    [conversationId, limit],
  );
  return rows.reverse();
}

/**
 * The row shape the history rail renders, shared by the list and the single-row
 * read back.
 *
 * ONE COPY, BECAUSE THE FALLBACK TITLE IS THE PART THAT WOULD DRIFT. A thread
 * with no stored title displays its first user message, and that COALESCE is
 * only correct if EVERY path that hands a conversation to the client applies
 * it. A mutation that answered with the raw `title` column would report a
 * just-cleared title as null, the rail would draw "Untitled conversation", and
 * it would correct itself on the next refetch — a bug that only ever appears
 * for one render and is therefore the kind nobody reproduces.
 */
const CONVERSATION_ROW = `
  SELECT c.conversation_id,
         COALESCE(NULLIF(c.title, ''),
           (SELECT LEFT(m2.content, 80) FROM ai_message m2
             WHERE m2.conversation_id = c.conversation_id AND m2.role = 'user'
               AND m2.content IS NOT NULL AND m2.content <> ''
             ORDER BY m2.created_at ASC, m2.ai_message_id ASC LIMIT 1)) AS title,
         c.pinned_at,
         c.archived_at,
         COALESCE(MAX(m.created_at), c.created_at) AS last_at,
         COUNT(m.ai_message_id) FILTER (WHERE m.role IN ('user','assistant')) AS message_count
    FROM ai_conversation c
    LEFT JOIN ai_message m ON m.conversation_id = c.conversation_id`;

/** The aggregate above needs every non-aggregated column named. */
const CONVERSATION_GROUP =
  "GROUP BY c.conversation_id, c.title, c.pinned_at, c.archived_at, c.created_at";

/**
 * The user's conversations for the history sidebar.
 *
 * Title falls back to the first user message (trimmed to 80 chars) when none was
 * stored, so a thread is always identifiable. `last_at` is the most recent
 * message time (not created_at), so an old thread the user just returned to sorts
 * to the top. Empty threads (a `clear` with no follow-up question) are hidden.
 *
 * PINNED FIRST, THEN TIME (13930, audit J2). `pinned_at DESC NULLS LAST` ahead
 * of `last_at DESC` is what makes a pin mean anything: the rail groups the
 * pinned rows above its time buckets, and it can only do that if they arrive
 * ahead of the LIMIT rather than scattered through it. Ordering by the pin
 * TIMESTAMP rather than a flag also settles what happens when several threads
 * are pinned — most recently pinned first, no tiebreak needed.
 *
 * DELETED ROWS ARE GONE FROM HERE, ARCHIVED ONES ARE BEHIND A FLAG. Deleting is
 * an answer; archiving is "not now", so the rail asks for the archived ones
 * explicitly when the user opens that section rather than filtering a list it
 * was already given — over-fetching every archived thread on every load to hide
 * most of them is how a rail gets slow for the people who use it most.
 */
async function listConversations(client, userId, { limit = 50, includeArchived = false } = {}) {
  const { rows } = await client.query(
    `${CONVERSATION_ROW}
      WHERE c.user_id = $1
        AND c.deleted_at IS NULL
        AND ($3 OR c.archived_at IS NULL)
      ${CONVERSATION_GROUP}
     HAVING COUNT(m.ai_message_id) FILTER (WHERE m.role IN ('user','assistant')) > 0
      ORDER BY c.pinned_at DESC NULLS LAST, last_at DESC
      LIMIT $2`,
    [userId, limit, includeArchived === true],
  );
  return rows;
}

/**
 * One conversation in the rail's own row shape, for reading back after a
 * mutation so the client can patch its list without refetching all of it.
 *
 * No HAVING: this answers "what does this row look like now", not "does it
 * qualify for the rail". Ownership- and delete-scoped like everything else.
 */
async function conversationMeta(client, conversationId, userId) {
  const { rows } = await client.query(
    `${CONVERSATION_ROW}
      WHERE c.conversation_id = $1 AND c.user_id = $2 AND c.deleted_at IS NULL
      ${CONVERSATION_GROUP}`,
    [conversationId, userId],
  );
  return rows[0] || null;
}

/**
 * Ownership gate: a thread is private to its user, so load-by-id must verify it.
 *
 * A SOFT-DELETED THREAD IS NOT THE CALLER'S TO OPEN (13930). `deleted_at` is
 * what the user pressed delete on; leaving it loadable by id would mean a stale
 * tab, a bookmarked `?c=` or the drawer's hand-over could put the transcript
 * back on screen after it had been removed from every list — which is the one
 * outcome the feature exists to prevent. An ARCHIVED thread stays openable,
 * because archiving says "out of my way", not "gone".
 */
async function conversationBelongsToUser(client, conversationId, userId) {
  const { rows } = await client.query(
    "SELECT 1 FROM ai_conversation WHERE conversation_id = $1 AND user_id = $2 AND deleted_at IS NULL",
    [conversationId, userId],
  );
  return rows.length > 0;
}

/**
 * Append one turn.
 *
 * `sources` / `trace` are OPTIONAL and only ever meaningful on an assistant row
 * — a question grounds nothing. Passing `undefined` writes NULL, which is the
 * honest value for "this turn recorded no grounding" and is what every caller
 * other than the orchestrator's answer-save does. They are stringified here
 * rather than at the call site so no caller has to know the column is jsonb.
 */
async function addMessage(client, { conversationId, role, content, sources, trace }) {
  const { rows } = await client.query(
    "INSERT INTO ai_message (conversation_id, role, content, sources, trace) VALUES ($1,$2,$3,$4,$5) " +
      "RETURNING ai_message_id, role, content, sources, trace, created_at",
    [
      conversationId,
      role,
      content,
      sources === undefined || sources === null ? null : JSON.stringify(sources),
      trace === undefined || trace === null ? null : JSON.stringify(trace),
    ],
  );
  return rows[0];
}

/**
 * Start a fresh thread.
 *
 * Deliberately does NOT delete. "New conversation" is a navigation gesture — it
 * means "put this one down", not "destroy it" — and conflating the two is how a
 * product loses a transcript somebody wanted. Inserting a new conversation makes
 * it the current one and leaves the old thread intact in the rail.
 *
 * Deleting is now a separate, named act (`softDeleteConversation` /
 * `purgeConversation`, 13930). The FK note that used to live here belongs with
 * the purge, which is the function that has to deal with it.
 */
async function startNewConversation(client, userId) {
  const { rows } = await client.query(
    "INSERT INTO ai_conversation (user_id) VALUES ($1) RETURNING conversation_id",
    [userId],
  );
  return rows[0].conversation_id;
}

// ── Conversation management (13930, audit J1-J3) ────────────────────────────
// Pin, rename, archive, delete. Every statement carries `AND user_id = $2` and
// every function answers "did that match a row of yours", so a caller cannot
// act on a thread that is not the caller's even by mistake.

/**
 * Pin, rename and archive — the three properties a user owns on their own
 * thread (audit J2, J3, J1).
 *
 * ONE STATEMENT, NOT THREE. They are one PATCH at the API, so they are one
 * UPDATE here: the rail sends what changed, and a rename that also unarchives
 * is a single row version rather than two the client has to reconcile.
 *
 * EVERY SQL FRAGMENT BELOW IS A LITERAL IN THIS FILE. The `sets` array is built
 * from column names written out here and joined; a caller's key never reaches
 * the statement, and the only caller-supplied VALUE — the title — goes through
 * a bound parameter. That is what makes a dynamic SET safe, and it is the one
 * property worth checking if this ever grows a fourth column.
 *
 * `now()` rather than a JS `Date` for the two timestamps: the clock that stamps
 * these should be the clock that stamped `created_at` on the row above it.
 *
 * AN EMPTY TITLE IS STORED AS NULL, NOT AS "". `listConversations` reads the
 * title through `COALESCE(NULLIF(c.title, ''), <first user message>)`, so
 * clearing the field hands the thread back its derived title instead of leaving
 * a blank row in the rail — "reset to the default" with no separate control.
 * Trimmed here rather than at the call site because the COALESCE contract is
 * this file's to keep: a title of three spaces would defeat the NULLIF.
 *
 * Re-pinning an already-pinned thread REFRESHES `pinned_at`, which moves it to
 * the head of the pinned group. That follows from storing the moment rather
 * than a flag, and it is the behaviour you want: the menu reads "Unpin" on a
 * pinned row, so the only way here twice is to mean it.
 *
 * Returns false when nothing matched — not the caller's thread, already
 * deleted, or an empty patch — which is what lets the service answer 404
 * without a second query.
 */
async function updateConversation(client, conversationId, userId, { title, pinned, archived } = {}) {
  const sets = [];
  const params = [conversationId, userId];

  if (title !== undefined) {
    params.push(typeof title === "string" && title.trim() ? title.trim() : null);
    sets.push(`title = $${params.length}`);
  }
  if (pinned !== undefined) sets.push(pinned ? "pinned_at = now()" : "pinned_at = NULL");
  if (archived !== undefined) sets.push(archived ? "archived_at = now()" : "archived_at = NULL");
  if (!sets.length) return false;

  const { rowCount } = await client.query(
    `UPDATE ai_conversation SET ${sets.join(", ")} ` +
      "WHERE conversation_id = $1 AND user_id = $2 AND deleted_at IS NULL",
    params,
  );
  return rowCount > 0;
}

/**
 * Soft-delete: the thread leaves every list and stops being loadable, and the
 * rows are still there.
 *
 * WHY THERE ARE TWO DELETES AT ALL. The user-facing promise for a sensitive
 * thread has to be "gone", and a flag does not deliver that on its own. But the
 * hard delete is irreversible and touches an audit trail, so it sits behind its
 * own confirm — and between pressing delete and confirming the purge there has
 * to be a state where the thread is already out of sight. This is that state,
 * and it is also what a mis-click costs: nothing recoverable is destroyed.
 *
 * `AND deleted_at IS NULL` makes a second delete report false rather than
 * quietly re-stamping the timestamp, so the service can tell "already gone"
 * from "not yours".
 */
async function softDeleteConversation(client, conversationId, userId) {
  const { rowCount } = await client.query(
    "UPDATE ai_conversation SET deleted_at = now() WHERE conversation_id = $1 AND user_id = $2 AND deleted_at IS NULL",
    [conversationId, userId],
  );
  return rowCount > 0;
}

/**
 * Hard purge — the rows go.
 *
 * THE FK THAT MADE THIS HARD. `ai_action_run.conversation_id` references
 * `ai_conversation` with NO `ON DELETE` clause, so a plain DELETE fails on it;
 * that is why `clearHistory` never deleted anything (audit J1) and why the
 * obvious fix — repointing the constraint at `ON DELETE SET NULL` — is not
 * available: altering a constraint on a pre-existing table above 13791 breaks a
 * fresh tenant's sandbox provisioning pass, which `npm run ci` cannot see. So
 * the detach is explicit, and being explicit turns out to be the point.
 *
 * AN EXECUTED RUN IS NOT THREAD CONTENT. `ai_action_run` is the only record in
 * the tree of what the assistant was asked to do and what it did — there is no
 * second audit table behind it. A run that reached EXECUTED changed the ERP: a
 * lead exists, a purchase request was raised, and that row is the trail linking
 * the change to the person who confirmed it. Destroying it because the
 * conversation around it was deleted would let anyone erase the provenance of a
 * write by deleting the chat they made it from, and the record it created would
 * still be sitting there unexplained. So an executed run is DETACHED and kept.
 *
 * Everything else — PROPOSED, AWAITING_CONFIRM, VALIDATION_FAILED, REJECTED,
 * MANUAL_FALLBACK — is a proposal the user never took. Nothing in the ERP
 * points at it, its `proposed_payload` is verbatim thread content, and keeping
 * it would mean a purged sensitive thread left its drafts behind. Those go.
 *
 * `ai_message` cascades (0400) and `ai_answer_feedback` is ON DELETE SET NULL
 * on both its conversation and message columns (0600), so the transcript and
 * the ratings need no statement here.
 *
 * ATOMIC. Four statements that must not half-run: a detach without the delete
 * leaves orphaned runs, and a delete without the detach cannot happen but would
 * be worse if it could. `atomically` joins an outer transaction when there is
 * one rather than opening a second — Postgres has no nested transactions.
 */
async function purgeConversation(client, conversationId, userId) {
  // `atomically` takes a zero-arg callback — the client is the one closed over.
  return atomically(client, async () => {
    const owned = await client.query(
      "SELECT 1 FROM ai_conversation WHERE conversation_id = $1 AND user_id = $2",
      [conversationId, userId],
    );
    if (!owned.rowCount) return false;

    await client.query(
      "UPDATE ai_action_run SET conversation_id = NULL WHERE conversation_id = $1 AND status = 'EXECUTED'",
      [conversationId],
    );
    await client.query("DELETE FROM ai_action_run WHERE conversation_id = $1", [conversationId]);
    const { rowCount } = await client.query(
      "DELETE FROM ai_conversation WHERE conversation_id = $1 AND user_id = $2",
      [conversationId, userId],
    );
    return rowCount > 0;
  });
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
  listConversations,
  conversationMeta,
  conversationBelongsToUser,
  addMessage,
  startNewConversation,
  updateConversation,
  softDeleteConversation,
  purgeConversation,
  conversationSummary,
  messagesAwaitingSummary,
  setSummary,
};
