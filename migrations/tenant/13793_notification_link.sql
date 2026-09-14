-- ============================================================================
-- TENANT — 13793 Notifications: where the thing that happened actually IS.
--
-- ── WHAT WAS BROKEN ────────────────────────────────────────────────────────
--
-- Clicking a notification marked it read and moved the user nowhere. Not a
-- regression — it was never wired. The bell rendered each row as a button whose
-- only handler was `markRead`, and on an already-read row that handler was
-- guarded off, so a read notification was an inert button. The full inbox was
-- the same list with a "Mark read" column.
--
-- `notify()` has accepted a `url` since it was written, but it reached web-push
-- ONLY. It was never persisted, so the in-app list had nothing to navigate to
-- even where a producer had bothered to pass one — and five producers in the
-- whole backend did.
--
-- ── WHY A COLUMN AND NOT JUST entity_ref ───────────────────────────────────
--
-- `entity_ref` is a type and an id; turning it into a route is a mapping, and
-- packages/shared/rules/entity-route.js is where that mapping lives. Most rows
-- need nothing more. But two things it cannot express:
--
--   1. A producer that knows better than the map. Mail already sends
--      `/comms/mail?thread=…` with the query the inbox reads; smart-comms sends
--      `/comms?channel=…`. Those are not derivable from a type and an id.
--   2. The push and the in-app row agreeing. The URL the phone opens and the
--      URL the bell opens are now the same stored string, rather than one
--      computed at send time and one at draw time from different code.
--
-- Nullable, and stays nullable. A notification with no destination is a real
-- state, not a defect: a God Mode PIN has no page. The client resolves a null
-- from `entity_ref` and, failing that, renders the row as text rather than
-- pretending it is a link. Which is the honest version of the same screen.
--
-- No backfill. Every existing row keeps its `entity_ref`, and the client's
-- fallback resolves those on read — a backfill would freeze today's map into
-- history and be wrong the next time a route moves.
-- ============================================================================

ALTER TABLE notification
  ADD COLUMN IF NOT EXISTS link_url text;

COMMENT ON COLUMN notification.link_url IS
  'In-app path this notification opens (e.g. /comms/mail?thread=…). Stamped at write time from the producer''s explicit url, else derived from entity_ref by packages/shared/rules/entity-route.js. NULL is a real state — a notification with no destination (a God Mode PIN) renders as text, not a link. Rows predating this column resolve from entity_ref on the client.';

-- ============================================================================
-- VERIFY
--   SELECT count(*) FILTER (WHERE link_url IS NOT NULL) AS linked,
--          count(*) AS total FROM notification;   -- linked grows from 0
--   INSERT INTO notification (user_id, title, link_url)
--     VALUES (NULL, 'x', '/hr/payroll');          -- accepted
--
-- DOWN
--   ALTER TABLE notification DROP COLUMN IF EXISTS link_url;
--   -- Clicking a notification stops navigating and goes back to marking it
--   -- read. Nothing else reads this column.
-- ============================================================================
