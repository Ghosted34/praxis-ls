-- ============================================================================
-- TENANT DB — 0667 The haulier becomes a carrier, and carrier pickers get scoped.
--
-- WHY
--
-- Two things were left half-done when 9092 seeded the service-type forms.
--
-- 1. THE HAULIER WAS TEXT. On INLAND and HINTERLAND, "Transporteur" is a plain
--    text field with no facet_role and no column_name: a name in details_json,
--    invisible to the rate cascade, spelled "Sotramaf", "SOTRAMAF" and "Sotramaf
--    Sarl" by three clerks on three files. 0666 gave TRUCKING and RAIL somewhere
--    to exist; this points the field at them.
--
-- 2. THE CARRIER PICKERS WERE UNSCOPED. A RATE_PROVIDER field had no way to say
--    WHICH kinds it accepts, so an air file would offer shipping lines and an
--    inland file would offer Maersk. `ref_kind` already exists on
--    service_type_field (0660:161) for exactly this shape of question — it was
--    documented as "for data_type REF" and is now read for RATE_PROVIDER too,
--    which means the scoping is tenant-editable like every other definition
--    rather than a hard-coded map in the browser.
--
-- ONE COLUMN, ONE FIELD — WHY HINTERLAND IS DIFFERENT
--
-- 9092's own sanity check refuses two fields on one service type binding the
-- same dossier column, because they would silently overwrite each other. On
-- HINTERLAND the sea leg's "Compagnie maritime" ALREADY binds rate_provider_id,
-- so the haulier cannot also take it. That is not a workaround: a hinterland
-- move genuinely has two carriers, and `dossier.rate_provider_id` is the file's
-- costing scope — which, for a corridor job priced off the sea rate card, is the
-- shipping line. So the haulier there becomes a RATE_PROVIDER stored in
-- details_json: a real reference a picker can resolve, without pretending the
-- file has one carrier when it has two.
--
-- On INLAND there is no sea leg and nothing else binds the column, so the
-- haulier takes it and a domestic file's costing finally scopes to the trucker
-- that actually priced it.
--
-- THE BACKFILL IS BEST-EFFORT, AND SAYS SO
--
-- Existing typed names become TRUCKING providers one per distinct spelling —
-- the same mapper 0634 used for shipping lines. Three spellings of one haulier
-- become three rows; merging them is a judgement call for a human with the
-- invoices in front of them, and a migration that guessed would silently merge
-- two real companies with similar names. Anything blank stays NULL.
-- ============================================================================

-- ── 1. Mint a provider per distinct typed haulier name ──────────────────────
INSERT INTO rate_provider (kind, code, name, is_system)
SELECT DISTINCT 'TRUCKING',
       upper(regexp_replace(btrim(d.details_json->>'transporter'), '[^A-Za-z0-9]+', '_', 'g')),
       btrim(d.details_json->>'transporter'),
       false
  FROM dossier d
 WHERE d.details_json ? 'transporter'
   AND btrim(COALESCE(d.details_json->>'transporter', '')) <> ''
   -- A file already holding a uuid here has been migrated; leave it be.
   AND d.details_json->>'transporter' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ON CONFLICT (kind, code) DO NOTHING;

-- ── 2. INLAND: the haulier is the file's carrier, so it takes the column ─────
UPDATE dossier d
   SET rate_provider_id = rp.rate_provider_id,
       details_json     = d.details_json - 'transporter'
  FROM rate_provider rp, service_type st
 WHERE d.service_type_id = st.service_type_id
   AND st.key = 'INLAND_TRANSPORTATION'
   AND d.rate_provider_id IS NULL
   AND btrim(COALESCE(d.details_json->>'transporter', '')) <> ''
   AND rp.kind = 'TRUCKING'
   AND rp.code = upper(regexp_replace(btrim(d.details_json->>'transporter'), '[^A-Za-z0-9]+', '_', 'g'));

-- ── 3. HINTERLAND: the haulier stays in details_json, but as a reference ─────
UPDATE dossier d
   SET details_json = jsonb_set(d.details_json, '{transporter}', to_jsonb(rp.rate_provider_id::text))
  FROM rate_provider rp, service_type st
 WHERE d.service_type_id = st.service_type_id
   AND st.key = 'HINTERLAND_TRANSIT'
   AND btrim(COALESCE(d.details_json->>'transporter', '')) <> ''
   AND rp.kind = 'TRUCKING'
   AND rp.code = upper(regexp_replace(btrim(d.details_json->>'transporter'), '[^A-Za-z0-9]+', '_', 'g'));

-- ── 4. Retype the field definitions ─────────────────────────────────────────
-- INLAND takes the column; HINTERLAND keeps column_name NULL (see the header).
UPDATE service_type_field f
   SET data_type   = 'RATE_PROVIDER',
       ref_kind    = 'TRUCKING,RAIL',
       facet_role  = 'CARRIER',
       column_name = 'rate_provider_id'
  FROM service_type_field_set fs, service_type st
 WHERE f.service_type_field_set_id = fs.service_type_field_set_id
   AND fs.service_type_id = st.service_type_id
   AND st.key = 'INLAND_TRANSPORTATION'
   AND f.key = 'transporter'
   AND f.data_type = 'TEXT';

UPDATE service_type_field f
   SET data_type  = 'RATE_PROVIDER',
       ref_kind   = 'TRUCKING,RAIL',
       facet_role = 'CARRIER'
  FROM service_type_field_set fs, service_type st
 WHERE f.service_type_field_set_id = fs.service_type_field_set_id
   AND fs.service_type_id = st.service_type_id
   AND st.key = 'HINTERLAND_TRANSIT'
   AND f.key = 'transporter'
   AND f.data_type = 'TEXT';

-- ── 5. Scope the carrier pickers that already existed ───────────────────────
-- A sea file offers shipping lines, an air file airlines. PROJECT's "carrier"
-- is deliberately left unscoped: a project move is whatever moves it.
UPDATE service_type_field SET ref_kind = 'SHIPPING_LINE'
 WHERE data_type = 'RATE_PROVIDER' AND key = 'shipping_line' AND ref_kind IS NULL;
UPDATE service_type_field SET ref_kind = 'AIRLINE'
 WHERE data_type = 'RATE_PROVIDER' AND key = 'airline' AND ref_kind IS NULL;

-- ── 6. Guard: the column must still back at most one field per service type ─
-- The same invariant 9092 checks at seed time, re-checked here because step 4
-- is the one edit in this file that could break it.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(st.key || '.' || f.column_name, ', ') INTO bad
    FROM service_type_field f
    JOIN service_type_field_set fs ON fs.service_type_field_set_id = f.service_type_field_set_id
    JOIN service_type st ON st.service_type_id = fs.service_type_id
   WHERE f.column_name IS NOT NULL AND f.is_active
   GROUP BY st.key, fs.service_type_field_set_id, f.column_name
  HAVING COUNT(*) > 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0667: a dossier column now backs two fields — %', bad;
  END IF;
END $$;

-- DOWN
-- Steps 1-3 rewrote data and cannot be undone by a script: the typed names are
-- gone from details_json on INLAND files, and only the provider rows remember
-- them. Reverting the DEFINITIONS is safe and leaves those references readable
-- as ids; reverting the data needs the provider names copied back deliberately.
--
--   UPDATE service_type_field SET ref_kind = NULL
--    WHERE data_type = 'RATE_PROVIDER' AND key IN ('shipping_line','airline');
--   UPDATE service_type_field SET data_type = 'TEXT', ref_kind = NULL,
--          facet_role = NULL, column_name = NULL
--    WHERE key = 'transporter' AND data_type = 'RATE_PROVIDER';
