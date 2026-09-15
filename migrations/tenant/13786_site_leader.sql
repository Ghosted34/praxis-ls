-- ============================================================================
-- TENANT — 13786 Leadership, for the group and for each entity.
--
-- ── ONE TABLE, TWO TIERS, AND THE NULLABLE FK IS THE MECHANISM ─────────────
--
--   entity_id IS NULL   group leadership — the CEO, the board
--   entity_id = X       that company's leadership — the country manager
--
-- One table means one editor, one renderer, one set of validation, and a
-- reordering rule that cannot disagree with itself. Two tables would have been
-- the same six columns twice and a second screen to maintain.
--
-- ON DELETE CASCADE because a leader of a company that no longer exists is not
-- a group leader: they are a row nobody will ever see and nobody will think to
-- remove. Deleting an entity is already a deliberate act.
--
-- ── PORTRAITS ARE VAULT DOCUMENTS, AND ONLY REAL ONES ──────────────────────
--
-- `photo_vault_id` scoped 'SITE' / 'LEADER' by 13788.
--
-- `doc/WEB_BUILD_BRIEF.md` N12 forbids stock photographs of people, and
-- `doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md` §1.3 extends that to generated ones:
-- a portrait slot accepts `provenance = 'owned'` and nothing else. A generated
-- face beside a real name and a real job title is not decoration, it is a claim
-- about a person who exists.
--
-- ── WHY A LINKEDIN URL AND NOT A CONTACT BLOCK ─────────────────────────────
--
-- One optional link, because that is the one a reader actually follows to
-- verify that a named executive is real. An email address on a public page is
-- a spam target the person did not consent to; a phone number is worse.
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_leader (
  leader_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL means group-level. See the note above: this nullable FK is the whole
  -- two-tier mechanism.
  entity_id       uuid REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,

  full_name       text NOT NULL,
  role_fr         text,
  role_en         text,
  bio_fr          text,
  bio_en          text,
  photo_vault_id  uuid REFERENCES document_vault(doc_id),
  linkedin_url    text,

  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES app_user(user_id),

  CONSTRAINT ck_site_leader_linkedin
    CHECK (linkedin_url IS NULL OR linkedin_url ~* '^https://([a-z0-9-]+\.)?linkedin\.com/')
);

-- Group leaders and one entity's leaders are two different reads; both are
-- ordered, both filter on is_active.
CREATE INDEX IF NOT EXISTS ix_site_leader_group  ON site_leader (sort_order) WHERE entity_id IS NULL AND is_active;
CREATE INDEX IF NOT EXISTS ix_site_leader_entity ON site_leader (entity_id, sort_order) WHERE entity_id IS NOT NULL AND is_active;

COMMENT ON TABLE site_leader IS
  'Leadership for the group (entity_id NULL) and for each corporate entity. One table, two tiers, one editor and one renderer — the nullable FK is the mechanism.';
COMMENT ON COLUMN site_leader.photo_vault_id IS
  'A vault document scoped SITE/LEADER. Owned photographs only: N12 forbids stock faces and the experience guide extends that to generated ones — a generated face beside a real name is a claim about a person who exists.';

-- ============================================================================
-- VERIFY
--   INSERT INTO site_leader(full_name, linkedin_url)
--     VALUES ('X', 'https://example.com/x');            -- expect 23514
--   -- Deleting an entity removes its leaders and leaves group leaders alone:
--   SELECT count(*) FROM site_leader WHERE entity_id IS NULL;
--
-- DOWN
--   DROP INDEX IF EXISTS ix_site_leader_entity;
--   DROP INDEX IF EXISTS ix_site_leader_group;
--   DROP TABLE IF EXISTS site_leader;
-- ============================================================================
