-- ============================================================================
-- TENANT DB — 10733 Full-text search over mail.
--
-- ── WHY 'simple' AND NOT 'english' ──────────────────────────────────────────
--
-- The corpus is bilingual. A tenant in Douala writes to a carrier in English on
-- Monday and to a broker in French on Tuesday, frequently in the same thread.
-- Stemming French with an English dictionary is worse than not stemming at all:
-- it mangles the French without helping the English, and the failure is
-- invisible — a search that quietly does not match looks exactly like a search
-- with no results.
--
-- `simple` does no stemming and no stop-word removal. Prefix matching in the
-- query parser covers most of what stemming would have given us.
--
-- ── ACCENTS: THE FRENCH HALF OF THE CORPUS DEPENDS ON THIS ──────────────────
--
-- Without folding, "declaration" does not find "Déclaration" — which is most of
-- what a customs desk types. `unaccent` is a standard contrib module; it is
-- created here if the server has it, and if it does not, `unaccent_safe` passes
-- text through so the migration still applies and search still works for
-- everything unaccented. Degrading is right; failing to migrate is not.
--
-- THE WRAPPER RESOLVES THE EXTENSION'S REAL SCHEMA, and that is not pedantry.
-- An earlier draft of this file hardcoded `public.unaccent(t)`. Tenant
-- migrations run with `search_path = <schema>,public`, so `CREATE EXTENSION`
-- put unaccent in `live` on a database where nothing had created it first —
-- and `public.unaccent` then did not exist. The wrapper's own
-- `EXCEPTION WHEN OTHERS` swallowed the error and returned the text unfolded,
-- so nothing failed, nothing logged, and accent-folding was simply absent.
-- Caught by running the search against a freshly provisioned tenant; no static
-- check could have seen it.
--
-- Two guards now, because either alone is insufficient: the extension is asked
-- for in `public` explicitly, AND the wrapper is built with whatever schema the
-- extension actually turns out to live in — which covers the database where it
-- was already installed somewhere else before we arrived.
--
-- STABLE, not IMMUTABLE: `unaccent()` is STABLE because its dictionary can be
-- reloaded, and labelling a wrapper IMMUTABLE to borrow it is how a wrong answer
-- gets cached in an index. This function is only ever called from the trigger
-- below, which has no immutability requirement.
--
-- ── EMAIL ADDRESSES HAVE TO BE INDEXED TWICE ────────────────────────────────
--
-- `to_tsvector('simple','client@maersk.cm')` yields ONE token: the whole
-- address. So searching "maersk" — which is what a person actually types —
-- matches nothing. Caught by the verification pass on the backfill, not by any
-- static check. Addresses are therefore indexed whole AND split on @ and dot, so
-- both "client@maersk.cm" and "maersk" find the thread.
--
-- ── WHY WEIGHTED, AND WHY A TRIGGER ─────────────────────────────────────────
--
-- Subject and participants outrank the body: someone searching "Maersk" wants
-- the thread with Maersk, not every message quoting them in a footer. A
-- generated column cannot carry the weights, so it is a trigger — which also
-- means the vector is recomputed only when the text it derives from changes.
-- ============================================================================

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'unaccent not available; mail search will not fold accents';
END $$;

DO $$
DECLARE
  ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'unaccent';

  IF ext_schema IS NULL THEN
    -- No extension anywhere: a pass-through, so search still works for
    -- everything unaccented and the migration still applies.
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION unaccent_safe(t text) RETURNS text AS $body$
        SELECT t;
      $body$ LANGUAGE sql STABLE;
    $f$;
    RAISE NOTICE 'unaccent absent; unaccent_safe() passes text through unfolded';
  ELSE
    -- Schema-qualified with the extension's ACTUAL schema, resolved now rather
    -- than assumed. No EXCEPTION handler: with the schema resolved there is no
    -- expected failure left, and a handler here is what hid the last one.
    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION unaccent_safe(t text) RETURNS text AS $body$
        SELECT %I.unaccent(t);
      $body$ LANGUAGE sql STABLE;
    $f$, ext_schema);
  END IF;
END $$;

/** Addresses, tokenised the way people search for them: whole and in pieces. */
CREATE OR REPLACE FUNCTION mail_address_terms(t text) RETURNS text AS $$
  SELECT COALESCE(t, '') || ' ' || replace(replace(replace(COALESCE(t, ''), '@', ' '), '.', ' '), '-', ' ');
$$ LANGUAGE sql IMMUTABLE;

ALTER TABLE email_message ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE OR REPLACE FUNCTION email_message_search_tsv() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
      setweight(to_tsvector('simple', unaccent_safe(COALESCE(NEW.subject, ''))), 'A')
   || setweight(to_tsvector('simple', unaccent_safe(
        mail_address_terms(NEW.from_address::text) || ' ' ||
        COALESCE(NEW.from_name, '') || ' ' ||
        mail_address_terms(array_to_string(NEW.to_address::text[], ' ')) || ' ' ||
        mail_address_terms(array_to_string(NEW.cc_address::text[], ' ')))), 'B')
   || setweight(to_tsvector('simple', unaccent_safe(
        left(COALESCE(NEW.body_text, NEW.body_preview, ''), 100000))), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_email_message_search') THEN
    CREATE TRIGGER trg_email_message_search
      BEFORE INSERT OR UPDATE OF subject, from_address, from_name, to_address, cc_address, body_text, body_preview
      ON email_message
      FOR EACH ROW EXECUTE FUNCTION email_message_search_tsv();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_email_message_tsv ON email_message USING GIN (search_tsv);

-- Backfill whatever 10731 carried across, and re-do it whenever this file is
-- re-run so a change to the weighting above actually reaches existing rows.
UPDATE email_message SET subject = subject;

COMMENT ON COLUMN email_message.search_tsv IS
  'Weighted search vector: A = subject, B = participants (indexed whole AND split, because ''client@maersk.cm'' is one token and people search for ''maersk''), C = body. Built with ''simple'' because the corpus is EN and FR in the same threads.';

-- DOWN
--   DROP INDEX IF EXISTS ix_email_message_tsv;
--   DROP TRIGGER IF EXISTS trg_email_message_search ON email_message;
--   DROP FUNCTION IF EXISTS email_message_search_tsv();
--   DROP FUNCTION IF EXISTS mail_address_terms(text);
--   DROP FUNCTION IF EXISTS unaccent_safe(text);
--   -- DESTRUCTIVE: drops a derived column only — the vector is recomputable from
--   -- the message text by re-running this migration.
--   ALTER TABLE email_message DROP COLUMN IF EXISTS search_tsv;
