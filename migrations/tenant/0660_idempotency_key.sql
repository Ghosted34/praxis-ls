-- ============================================================================
-- TENANT DB — 0660 Idempotency keys: replaying a write must not double-post.
--
-- WHY THIS TABLE EXISTS
--
-- The client now holds a write that failed because the network dropped and
-- sends it again when the connection returns (client/src/lib/outbox.ts). That
-- rescue is only safe if the server can tell a REPLAY from a SECOND WRITE, and
-- it cannot do so from the payload alone: "the request never left the browser"
-- and "the request was processed and the response was lost on the way back"
-- produce exactly the same rejected fetch. Without a key, an operator on a bad
-- 3G connection who presses Save once can post two supplier invoices — and in
-- an OHADA ledger a duplicated posting is a material misstatement, not a
-- cosmetic bug. The cure would have been worse than the disease.
--
-- So: the client mints a key per logical write and repeats it on every replay.
-- The first request to arrive claims the key and its response is stored against
-- it; any later request bearing the same key is answered from the store and
-- does no work. See src/middleware/idempotency.js for the state machine.
--
-- WHY THE RESPONSE BODY IS KEPT, NOT JUST A FLAG
--
-- A caller replaying a create needs the created row — its id is what the next
-- screen navigates to. Answering "yes, that already happened" with no payload
-- would leave the client knowing the write succeeded and unable to act on it,
-- which in practice means a full refetch and a guess at which row is theirs.
--
-- ONLY SUCCESSES ARE KEPT
--
-- A request that ended 4xx/5xx releases its key (the middleware deletes the
-- row), because nothing was committed and the user must be able to correct the
-- input and try again. Caching a validation failure would pin the user to their
-- own typo for as long as the key lived.
--
-- WHY ROWS EXPIRE
--
-- A key is useful for as long as a client might still retry — minutes, at the
-- outside a day for a laptop that was closed overnight. 48 hours is generous
-- against that and keeps the table small enough that it never becomes an
-- operational concern. Expired rows are swept lazily by the middleware; no job
-- is required, and an unswept row is harmless because `expires_at` is checked
-- on read.
--
-- ADDITIVE ONLY. New table, no existing object touched. A tenant that has not
-- run this migration keeps working — the middleware treats a missing table as
-- "no idempotency available" and passes the request through unchanged, which is
-- exactly the behaviour that existed before this file.
-- ============================================================================

CREATE TABLE IF NOT EXISTS idempotency_key (
  -- Client-generated (a UUID from the outbox). Text rather than uuid: it is an
  -- opaque token chosen by the caller, and rejecting a well-formed key for not
  -- being a UUID would be inventing a rule no HTTP client expects.
  key           text PRIMARY KEY,

  -- Bound to the request that claimed it. A key presented against a DIFFERENT
  -- method/path/body is a bug or an attack, never a replay, and the middleware
  -- refuses it rather than returning someone else's response.
  method        text        NOT NULL,
  path          text        NOT NULL,
  request_hash  text        NOT NULL,

  -- Whoever was authenticated when the request completed. Nullable because the
  -- row is claimed before the module's auth middleware has run; it is filled in
  -- at completion. Audit value only — the request_hash is what enforces safety.
  user_id       uuid,

  -- 'in_flight' from claim until the response is known, then 'completed'.
  -- A replay arriving while the original is still in flight gets 409 rather
  -- than a second execution: two identical writes racing is the exact thing
  -- this table exists to prevent.
  state         text        NOT NULL DEFAULT 'in_flight',

  status_code   integer,
  response_body jsonb,

  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '48 hours'
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_idempotency_state') THEN
    ALTER TABLE idempotency_key ADD CONSTRAINT chk_idempotency_state
      CHECK (state IN ('in_flight', 'completed'));
  END IF;
  -- A completed row without its response is unusable — the replay it exists to
  -- serve would have nothing to return.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_idempotency_completed') THEN
    ALTER TABLE idempotency_key ADD CONSTRAINT chk_idempotency_completed
      CHECK (state <> 'completed' OR status_code IS NOT NULL);
  END IF;
END $$;

-- The sweep predicate. Small table, but this is the only query that scans it.
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_key (expires_at);

COMMENT ON TABLE idempotency_key IS
  'Replay protection for client-retried writes. Claimed by Idempotency-Key header; see src/middleware/idempotency.js.';
