-- 0501 — Join a ledger row back to the request that wrote it.
--
-- OBS T1 (Critical), step 5 of six.
--
-- The audit walked a real incident: "posting an invoice failed this morning."
-- Six steps, every one blocked. Five are now unblocked — there is an access log
-- (L1), the correlation id survives to the client (E3), every log line carries
-- tenant and user (L3), the finance path logs (L2), and container logs outlive
-- a deploy (L7).
--
-- Step 5 was "join the ledger row to the request", and it needed a column.
-- immutable_ledger records WHAT happened and WHO did it, but nothing tied a row
-- to the HTTP request that produced it — so given a ledger entry you could not
-- find its logs, and given a request id you could not find what it wrote. Those
-- are the two directions an investigation actually runs in.
--
-- The value already exists on every request: requestIdMiddleware mints it and
-- config/request-context.js carries it in AsyncLocalStorage. Like
-- cached_receivables (DATA 1.9) and before_hash (DATA 6.2), the data was in
-- scope and simply never written down.
--
-- Nullable, no default, no backfill. A row written by a background job or a
-- migration has no request, and inventing one would make the column lie. NULL
-- means "not from an HTTP request", which is a true and useful thing to know.

ALTER TABLE immutable_ledger ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE event_log        ADD COLUMN IF NOT EXISTS request_id text;

COMMENT ON COLUMN immutable_ledger.request_id IS
  'Correlation id of the HTTP request that wrote this row; NULL for background work (OBS T1).';
COMMENT ON COLUMN event_log.request_id IS
  'Correlation id of the HTTP request that emitted this event; NULL for background work (OBS T1).';

-- Partial: the whole point of the index is looking up the handful of rows one
-- request wrote, and the NULLs (every background row, forever) are never the
-- target of that lookup. Excluding them keeps the index small on the two
-- largest append-only tables in the schema.
CREATE INDEX IF NOT EXISTS ix_ledger_request  ON immutable_ledger (request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_eventlog_request ON event_log (request_id)
  WHERE request_id IS NOT NULL;

-- DOWN
-- Reversible: both columns are additive and nothing reads them but the
-- investigation path. Dropping them loses the correlation for existing rows,
-- which is why this is a down-migration and not a routine operation.
--
-- DROP INDEX IF EXISTS ix_eventlog_request;
-- DROP INDEX IF EXISTS ix_ledger_request;
-- ALTER TABLE event_log        DROP COLUMN IF EXISTS request_id;
-- ALTER TABLE immutable_ledger DROP COLUMN IF EXISTS request_id;
