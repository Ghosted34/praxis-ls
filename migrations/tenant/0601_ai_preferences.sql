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

CREATE TRIGGER trg_aiuserpref_updated BEFORE UPDATE ON ai_user_preference
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- DOWN --
-- DROP TABLE IF EXISTS ai_user_preference;