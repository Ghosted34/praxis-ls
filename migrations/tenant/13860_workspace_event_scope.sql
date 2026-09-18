-- ============================================================================
-- My Workspace — event visibility scope
--
-- Calendar events already have creator and participant identity. This nullable
-- scope makes the selected least-privilege rule expressible for scoped team
-- calendars without changing existing unscoped events. NULL follows the
-- Workspace convention: it is an unscoped operational record and remains
-- visible to an authorised team audience; it is not a hidden row.
--
-- Idempotent so live and sandbox tenant upgrades can safely re-run it.
-- ============================================================================

ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS scope_id uuid;

COMMENT ON COLUMN calendar_event.scope_id IS
  'Organisational scope for team Calendar visibility. NULL means an unscoped operational event; creator and invited users retain visibility, and authorised team reads include unscoped rows.';

CREATE INDEX IF NOT EXISTS idx_calendar_event_scope
  ON calendar_event (scope_id)
  WHERE is_deleted = false AND scope_id IS NOT NULL;

-- DOWN
--   DROP INDEX IF EXISTS idx_calendar_event_scope;
--   ALTER TABLE calendar_event DROP COLUMN IF EXISTS scope_id;
