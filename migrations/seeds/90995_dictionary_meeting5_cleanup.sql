-- ============================================================================
-- SEED (per tenant schema) — 90995 financial dictionary clean-up agreed in the
-- tenant review of 21 Sep 2026 ("meeting 5").
--
-- A SEED, NOT A MIGRATION, because it edits catalogue rows that 9080/9082
-- create. On a freshly provisioned tenant the whole migration set runs BEFORE
-- the seeds, so a tenant migration would find an empty dictionary and do
-- nothing, and 9080 would then seed the old shape. The name sorts after 9098
-- and inside the /^90/ tenant-seed glob (migrator.js), so 9080 and 9082 have
-- always run first.
--
-- Three things, in this order:
--
--   1. DOCUMENTATION FEE IS A DISBURSEMENT (01:04:57, 01:44:14). It was seeded
--      as our own revenue (7061, output VAT). The company rules it is paid on
--      the client's behalf and re-billed at cost, so it becomes a disbursement
--      with the 4731 pair and no VAT, and it goes on the BASIC list for Sea
--      Freight Import so "Suggest charges" offers it on every such file.
--
--   2. A CODE'S LETTER FOLLOWS ITS DIRECTION (01:20:04). Until now changing a
--      line's direction kept its old code, so a disbursement could carry #R.
--      The service re-letters on every direction change from this release;
--      this repairs the rows that drifted before it — including the
--      documentation fee from step 1 — using the same lowest-free-number rule
--      as `financial_dictionary.repo.nextCode`. The old code is appended to the
--      description, as 9082 did, because a seed writes no audit row.
--
--   3. TITLES ARE TITLE CASE (01:44:14 — "titles that come with small letters").
--      Every word of label_en and label_fr starts with a capital, except each
--      language's small words ("Frais de Dossier", "Frais d'Agence et de
--      Documentation", "Commission on Disbursements"), which stay lower case
--      unless they open the label or a phrase. The rest of each word is left
--      alone, so "THC", "PDF", "(BL)" and "IT" survive — unlike initcap(),
--      which would print "Thc". Same rule as
--      `financial_dictionary.rules.titleCase`, which the service applies on
--      every save from this release.
--
-- IDEMPOTENT. Step 1 is guarded on the direction it changes; step 2 only
-- touches a row whose letter disagrees with its direction; step 3 only writes a
-- label that title-casing would change. A second run changes nothing.
-- ============================================================================

-- ── helpers (session-scoped; dropped with the session) ─────────────────────
CREATE OR REPLACE FUNCTION pg_temp.praxis_title_case(s text, lang text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
-- The SQL twin of financial_dictionary.rules.titleCase — see that function for
-- the rule. Every word capitalised, the language's small words lower case
-- unless they open the label or a phrase, elided articles kept small
-- ("d'Agence"), and only ever a word's FIRST letter raised.
DECLARE
  small  text[] := CASE WHEN lang = 'fr' THEN ARRAY[
    'à','au','aux','avec','chez','d','dans','de','des','du','en','entre','et',
    'l','la','le','les','ou','par','pour','sans','sous','sur','un','une','vers']
  ELSE ARRAY[
    'a','an','and','as','at','by','for','from','in','nor','of','on','or','per',
    'the','to','via','vs','with'] END;
  out          text := '';
  tok          text;
  phrase_start boolean := true;
  opening      boolean;
  el           text[];
  m            text[];
BEGIN
  IF s IS NULL THEN RETURN NULL; END IF;
  FOR tok IN
    SELECT (regexp_matches(s, '([[:space:]()\[\]/"«»:—–-]+|[^[:space:]()\[\]/"«»:—–-]+)', 'g'))[1]
  LOOP
    IF tok ~ '^[[:space:]()\[\]/"«»:—–-]+$' THEN
      -- A separator run: hyphen and slash separate words inside a phrase,
      -- a bracket, colon, quote or dash also starts a new phrase.
      IF tok ~ '[(\[:"«—–]' THEN phrase_start := true; END IF;
      out := out || tok;
      CONTINUE;
    END IF;
    opening := phrase_start;
    phrase_start := false;
    el := regexp_match(tok, '^([[:alpha:]])([''’])(.+)$');
    IF el IS NOT NULL AND lower(el[1]) = ANY (small) THEN
      m := regexp_match(el[3], '^([^[:alpha:]]*)([[:alpha:]])(.*)$');
      out := out
             || CASE WHEN opening THEN upper(el[1]) ELSE lower(el[1]) END
             || el[2]
             || CASE WHEN m IS NULL THEN el[3] ELSE m[1] || upper(m[2]) || m[3] END;
      CONTINUE;
    END IF;
    IF NOT opening AND lower(tok) = ANY (small)
       AND NOT (tok = upper(tok) AND tok <> lower(tok)) THEN
      out := out || lower(tok);
      CONTINUE;
    END IF;
    m := regexp_match(tok, '^([^[:alpha:]]*)([[:alpha:]])(.*)$');
    out := out || CASE WHEN m IS NULL THEN tok ELSE m[1] || upper(m[2]) || m[3] END;
  END LOOP;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.praxis_dict_letter(direction text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE direction WHEN 'REVENUE' THEN 'R' WHEN 'EXPENSE' THEN 'E'
                        WHEN 'DISBURSEMENT' THEN 'D' WHEN 'ASSET' THEN 'A' END
$$;

-- ── 1. Documentation fee → disbursement ────────────────────────────────────
-- Matched by its English name, exactly (case-insensitive): "Agency &
-- Documentation Fee" is the carrier's charge and is a different line.
CREATE TEMP TABLE _m5_docfee ON COMMIT DROP AS
SELECT di.dictionary_item_id
  FROM dictionary_item di
 WHERE lower(btrim(di.label_en)) = 'documentation fee'
   AND di.direction <> 'DISBURSEMENT';

UPDATE dictionary_item di
   SET direction = 'DISBURSEMENT',
       category = 'disbursement',
       is_disbursement = true,
       disbursement_vat_transparent = true
  FROM _m5_docfee f
 WHERE di.dictionary_item_id = f.dictionary_item_id;

-- Its revenue rule credited 7061 with output VAT, which is exactly what must
-- stop; the 4731 pair replaces it in the same transaction. Posted journals are
-- untouched — they carry their own accounts.
-- DESTRUCTIVE: drops the posting rules of the documentation fee only, rebuilt below.
DELETE FROM posting_rule pr
 USING _m5_docfee f
 WHERE pr.dictionary_item_id = f.dictionary_item_id;

INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
SELECT f.dictionary_item_id, 'purchase', '4731', '4011', NULL, true
  FROM _m5_docfee f
 WHERE NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = f.dictionary_item_id AND pr.applies_context = 'purchase')
ON CONFLICT DO NOTHING;

INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
SELECT f.dictionary_item_id, 'sale', '4111', '4731', NULL, true
  FROM _m5_docfee f
 WHERE NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = f.dictionary_item_id AND pr.applies_context = 'sale')
ON CONFLICT DO NOTHING;

-- On the BASIC list for Sea Freight Import, whatever tier it had there.
INSERT INTO service_type_dictionary_item (service_type_id, dictionary_item_id, tier, sort_order)
SELECT st.service_type_id, di.dictionary_item_id, 'BASIC', 100
  FROM dictionary_item di
  JOIN service_type st ON st.key = 'SEA_FREIGHT_IMPORT'
 WHERE lower(btrim(di.label_en)) = 'documentation fee'
ON CONFLICT (service_type_id, dictionary_item_id)
  DO UPDATE SET tier = 'BASIC'
  WHERE service_type_dictionary_item.tier IS DISTINCT FROM 'BASIC';

-- ── 2. Re-letter every code whose letter disagrees with its direction ─────
-- One row at a time, so each takes the lowest number free AFTER the previous
-- one moved — the same answer nextCode() would have given if each change had
-- been made in the app.
DO $$
DECLARE
  r       record;
  letter  text;
  n       int;
  newcode text;
BEGIN
  FOR r IN
    SELECT dictionary_item_id, code::text AS code, direction
      FROM dictionary_item
     WHERE code::text ~ '^#[RDEA][0-9]+$'
       AND substr(code::text, 2, 1) IS DISTINCT FROM pg_temp.praxis_dict_letter(direction)
       AND pg_temp.praxis_dict_letter(direction) IS NOT NULL
     ORDER BY code
  LOOP
    letter := pg_temp.praxis_dict_letter(r.direction);
    SELECT MIN(g) INTO n
      FROM generate_series(1, (
             SELECT COALESCE(MAX((substring(code::text FROM 3))::int), 0) + 1
               FROM dictionary_item WHERE code::text ~ ('^#' || letter || '[0-9]+$'))) g
     WHERE NOT EXISTS (
       SELECT 1 FROM dictionary_item
        WHERE code::text ~ ('^#' || letter || '[0-9]+$')
          AND (substring(code::text FROM 3))::int = g);
    newcode := '#' || letter || lpad(n::text, 3, '0');
    UPDATE dictionary_item
       SET code = newcode,
           description = COALESCE(description || ' ', '')
                         || '[Recodé ' || r.code || ' → ' || newcode
                         || ' (changement de nature). Recoded from ' || r.code || ' after a direction change.]'
     WHERE dictionary_item_id = r.dictionary_item_id;
    RAISE NOTICE '90995: % → % (%)', r.code, newcode, r.direction;
  END LOOP;
END $$;

-- ── 3. Title Case on every label ───────────────────────────────────────────
UPDATE dictionary_item
   SET label_en = pg_temp.praxis_title_case(label_en, 'en')
 WHERE label_en IS NOT NULL
   AND label_en IS DISTINCT FROM pg_temp.praxis_title_case(label_en, 'en');

UPDATE dictionary_item
   SET label_fr = pg_temp.praxis_title_case(label_fr, 'fr')
 WHERE label_fr IS DISTINCT FROM pg_temp.praxis_title_case(label_fr, 'fr');

-- DOWN
-- Step 3 is not reversed (the original casing is not kept, and was the defect).
-- Step 2 can be reversed per row from the note it appended to `description`.
-- Step 1:
-- UPDATE dictionary_item SET direction = 'REVENUE', category = 'service',
--        is_disbursement = false, disbursement_vat_transparent = false
--  WHERE lower(btrim(label_en)) = 'documentation fee';
-- DELETE FROM posting_rule pr USING dictionary_item di
--  WHERE pr.dictionary_item_id = di.dictionary_item_id AND lower(btrim(di.label_en)) = 'documentation fee';
-- INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
-- SELECT di.dictionary_item_id, 'sale', '4111', '7061',
--        (SELECT tax_code_id FROM tax_code WHERE code = 'TVA_STD' ORDER BY effective_from DESC LIMIT 1), false
--   FROM dictionary_item di WHERE lower(btrim(di.label_en)) = 'documentation fee';
