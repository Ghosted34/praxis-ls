-- ============================================================================
-- TENANT DB — 0521 persist an answer's grounding on the message that made it
--
-- WHAT WAS BROKEN. `ai_message` stored `role` and `content` and nothing else, so
-- an answer's SOURCES and TRACE existed only for the lifetime of the HTTP
-- response that produced them. The orchestrator built them (`buildSources` /
-- `buildTrace`), streamed them to the browser as `sources` / `trace` events, and
-- then dropped them on the floor. Reopen the conversation an hour later and the
-- workspace's Sources tab was empty and its trace disclosures were gone — not
-- because nothing had been read, but because nothing had been kept.
--
-- That is a provenance failure, which on this product is the serious kind. The
-- assistant reads live financial data under the user's own permissions; "which
-- records is this figure standing on?" is the question that makes an AI answer
-- usable in an audit at all, and it was answerable for exactly as long as the
-- tab stayed open.
--
-- THE SHAPE. Two nullable jsonb columns on the message the grounding belongs
-- to. Not a side table: a source list has no identity of its own, is never
-- queried across conversations, and is always read with its message — a join
-- table would be three writes and a join to reconstruct something that is
-- conceptually one column of one row. Not text: these are already structured on
-- the wire (`AiSource[]`, `string[]`) and jsonb keeps them structured, so a
-- later "which records does the assistant cite most" question is a query rather
-- than a parse.
--
-- WHY NULLABLE, AND WHY NO DEFAULT. Absent and empty are different facts. A
-- message written before this migration has NULL — we do not know what it read.
-- A message written after it that consulted nothing has `[]`. Defaulting to
-- `'[]'` would quietly assert the second about every historical row. The client
-- renders on presence, so NULL and `[]` both draw nothing; the distinction costs
-- the UI nothing and preserves the truth in the table.
--
-- SIZE. Sources are a label, a route and a row count per read — tens of bytes,
-- capped by how many tools one turn may call (MAX_TOOL_ROUNDS × calls per
-- round). No result rows are stored here: `readTrace` holds the actual data
-- in memory to count it, and only the label/route/count survive into these
-- columns. This is deliberately NOT a cache of what the reads returned — that
-- data has RBAC attached to it and must be re-read under the caller's own
-- permissions every time, never served from a message row.
--
-- Additive and idempotent: a deploy that runs this against a database that
-- already has the columns is a no-op, and the previous release keeps working
-- against a database that has them (it simply never selects them).
-- ============================================================================

ALTER TABLE ai_message ADD COLUMN IF NOT EXISTS sources jsonb;
ALTER TABLE ai_message ADD COLUMN IF NOT EXISTS trace   jsonb;

COMMENT ON COLUMN ai_message.sources IS
  'Grounding citations for an assistant turn: [{kind,label,href,rows}]. Built from the reads the turn executed (services/ai/answer-sources.js), never from the prose. NULL = written before 0521; [] = this answer consulted nothing.';
COMMENT ON COLUMN ai_message.trace IS
  'Human-readable steps the turn took, in order: ["Read invoices - 4 rows", ...]. Rendered as the trace disclosure under the answer. NULL = written before 0521.';

-- No index. Both columns are read only as part of "give me this conversation's
-- messages", which the existing (conversation_id, created_at) access path
-- already serves; a GIN index here would add write cost on the hot insert path
-- of every single turn to serve a query nothing makes.

-- DOWN
-- ALTER TABLE ai_message DROP COLUMN IF EXISTS sources;
-- ALTER TABLE ai_message DROP COLUMN IF EXISTS trace;
--
-- Safe to run, and the cost is bounded and non-recoverable: every stored
-- answer's citation list and trace is discarded. No user-authored content is
-- touched — `content` is untouched by this migration and by its undo — and the
-- assistant keeps answering, because grounding is built fresh on every turn and
-- only the REPLAY of it depends on these columns. Threads answered after the
-- rollback are simply back to being ungrounded once you close the tab.
--
-- Ordering constraint: drop the columns only once the code that selects them
-- (assistant.repo listMessages) is out of service, or the history endpoint
-- errors on every conversation open.
