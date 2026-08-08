-- ============================================================================
-- TENANT DB — AI user preferences: per-user settings that tailor the assistant's
-- output (e.g. "always show amounts in XAF", "prefer tables", "include dossier
-- ref"). Stored as a JSON blob — the schema is freeform so new preferences
-- can be added without migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_user_preference (
  user_id          uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  preferences      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- OR REPLACE: the table above is guarded but the trigger was not, so a re-run
-- died on `trigger "trg_aiuserpref_updated" already exists` — and a migration
-- re-runs more often than it looks (a file that fails part way leaves its ledger
-- row unwritten and the WHOLE file runs again; provision-tenant replays the set;
-- CI applies the tenant set twice on purpose). PG14+ supports OR REPLACE and the
-- deployment is pg16. See doc/DB_ARCHITECTURE.md §8.2.
CREATE OR REPLACE TRIGGER trg_aiuserpref_updated BEFORE UPDATE ON ai_user_preference
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- DOWN --
-- DROP TABLE IF EXISTS ai_user_preference;