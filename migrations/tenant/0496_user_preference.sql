-- ============================================================================
-- TENANT DB — 0496 per-user preferences (starting with appearance)
--
-- WHAT WAS MISSING. Appearance was a tenant-wide singleton: one `setting`
-- section, one theme, everybody gets it. That is right for the brand — the logo
-- and the primary colour are the company's, not the operator's — but wrong for
-- type. A dispatcher reading waybills for nine hours and a CFO scanning a
-- trial balance do not want the same body font, and neither preference should
-- overwrite the other, which is exactly what a shared row forces.
--
-- THE SHAPE. Deliberately generic: (user_id, section, key) → jsonb value,
-- mirroring `setting`'s (section, key) so the two layers read the same way and
-- an override is a straight overlay of the user's rows on the tenant's. Only
-- section='appearance' is written today; putting the section in the key means
-- the next per-user preference (density, locale, default landing screen) is a
-- new key, not a new migration and a new table.
--
-- WHY NOT COLUMNS ON app_user. Three font columns would have been smaller. They
-- would also have made every subsequent preference an ALTER TABLE on the
-- hottest table in the schema — app_user is read on every authenticated request
-- through the identity cache — and a widening row there costs far more than a
-- side table that is read once per session.
--
-- LIVES IN THE IDENTITY (live) SCHEMA. app_user does, and the FK must resolve;
-- a user is also the same person in TEST as in LIVE, so their font choice
-- should not evaporate when they switch environments or when the sandbox
-- schema is dropped by the wipe cron. Reads and writes go through
-- req.identityDb for this reason.
--
-- ON DELETE CASCADE. A preference has no meaning without its user, and these
-- rows carry nothing auditable — deleting a user should not leave orphans that
-- a later FK check trips over.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_preference (
  user_id     uuid        NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  section     text        NOT NULL,
  key         text        NOT NULL,
  value       jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, section, key)
);

COMMENT ON TABLE user_preference IS
  'Per-user overrides of tenant-wide settings, keyed (user_id, section, key) to mirror the `setting` table (0496). section=''appearance'' holds font_display/font_body/font_mono; a NULL/absent row means "inherit the tenant value".';

-- The only access pattern: "everything this user has overridden in this
-- section", on every authenticated boot. The PK's leading user_id already
-- serves it, so no additional index is created — a second one would only add
-- write cost to a table whose whole job is to be read.

-- DOWN
-- DROP TABLE IF EXISTS user_preference;
--
-- Clean to run, and worth being clear about what it costs: this migration only
-- CREATES, so the undo touches nothing that existed before it — no column is
-- dropped from app_user, no data outside this table is reachable from here.
-- What it does discard is every user's saved font choice. That is a preference,
-- not a record: nobody's work is lost, each person simply falls back to the
-- tenant's typography and re-picks. The application already treats a missing
-- row as "inherit the tenant value" (preference.service.js), so the API keeps
-- answering correctly with the table gone — the reads return null for every
-- key, which is exactly the pre-0496 behaviour.
--
-- The one ordering constraint: run this only after the code that writes to it
-- is out. A rollback that drops the table while the previous deploy is still
-- serving PUT /me/preferences/appearance gives users a 500 on save.
