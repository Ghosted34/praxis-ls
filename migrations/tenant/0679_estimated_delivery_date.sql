-- ============================================================================
-- 0679 — the Estimated Project Delivery Date gets a field.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- `dossier.promised_delivery_date` has existed since 0650 and is the FIRST thing
-- the milestone engine reaches for:
--
--   1. promised_delivery_date   the client SLA — what we committed to
--   2. eta                      the carrier's estimate — NOT the same promise
--   3. default_duration_days    25 working days for a sea import
--
-- Exactly ONE service type had a form field bound to that column: Hinterland's
-- "Planned delivery at destination". Sea, air, project and the two end-to-end
-- types had none, so on the commonest files in the system the column could not be
-- filled in at all and the engine silently fell through to rule 2 or rule 3.
--
-- ── WHY THAT IS WORSE THAN A MISSING BOX ────────────────────────────────────
--
-- `is_target_lock` — the SLA-protected stage — had nothing to protect. That flag
-- means "upstream slip COMPRESSES what remains rather than moving this date, down
-- to each stage's floor, and then it reports the breach". With no promised date it
-- locks onto the carrier's ETA instead, so a carrier delay silently becomes our
-- delay, the compression never fires, and nothing is ever reported as breached.
-- The whole slip-attribution model — the thing that turns "the carrier costs us
-- four days a file" into a query — was anchored to the wrong date.
--
-- The Control Tower also already filters on this column (`date_field=delivery`),
-- against something almost nothing could populate.
--
-- ── THE NAME ────────────────────────────────────────────────────────────────
--
-- "Estimated Project Delivery Date", in full, on every service type — including
-- Hinterland, whose seeded label is renamed to match. It is the phrase the
-- business uses, and a field that four service types call one thing and a fifth
-- calls another is a field people stop trusting is the same field. The FR side is
-- "Date de livraison estimée du projet".
--
-- ── WHY A NEW FACET ROLE ────────────────────────────────────────────────────
--
-- `ARRIVAL_DATE` is taken, by `eta`/`ata` — arrival at the PORT. Delivery to the
-- consignee is a different fact and a different date, and the facet map is keyed
-- by role, so reusing ARRIVAL_DATE would put two fields under one key and let one
-- silently win. Same reasoning as COLLECTION / FINAL_DELIVERY in 0678.
--
-- NOT ADDED TO: warehousing, brokerage and representation (no delivery — two of
-- them are open-ended by declaration), and inland transportation, whose own `eta`
-- is already labelled "Planned delivery". Adding a second delivery date to a
-- five-day domestic haul is the ask-twice mistake 0678 exists to undo.
--
-- Idempotent: the INSERT is guarded on the field being absent and carries
-- ON CONFLICT; the UPDATEs exclude rows they have already touched.
-- ============================================================================

-- ── 1. The role ─────────────────────────────────────────────────────────────
-- Dropped and re-added rather than guarded on absence: a CHECK cannot be extended
-- in place and this constraint already exists, so an IF NOT EXISTS guard would
-- match and skip, leaving the old vocabulary and failing step 2.
DO $$ BEGIN
  ALTER TABLE service_type_field DROP CONSTRAINT IF EXISTS chk_stf_facet_role;
  ALTER TABLE service_type_field ADD CONSTRAINT chk_stf_facet_role CHECK (
    facet_role IS NULL OR facet_role IN (
      -- Movement — the main carriage
      'TRANSPORT_REF','CONVEYANCE','CARRIER','ORIGIN','DESTINATION','ROUTE_VIA',
      'DEPARTURE_DATE','ARRIVAL_DATE',
      -- Movement — the door legs either side of it (0678)
      'COLLECTION','FINAL_DELIVERY',
      -- The commitment the milestone chain is scheduled against (0679)
      'DELIVERY_DATE',
      -- Cargo
      'CARGO_DESC','CARGO_WEIGHT','CARGO_VOLUME','CARGO_PACKAGES','CARGO_MARKS',
      -- Custody (warehousing, bonded storage)
      'CUSTODY_LOCATION','CUSTODY_STATUS','CUSTODY_IN','CUSTODY_OUT',
      -- Trade / regulatory
      'INCOTERM','CUSTOMS_REF','CUSTOMS_REGIME',
      -- Non-movement services (representation, brokerage retainers)
      'SCOPE_SUMMARY','COUNTERPARTY','PERIOD_START','PERIOD_END'
    )
  );
END $$;

-- ── 2. The field, where a movement service type has none ────────────────────
--
-- Placed just after the ATA it follows, in the same transport group: the file's
-- dates read departure → arrival → delivery, which is the order they happen.
INSERT INTO service_type_field (
  service_type_field_set_id, group_code, group_label_fr, group_label_en, group_seq,
  seq, key, label_fr, label_en, help_text_fr, help_text_en,
  data_type, is_required, is_client_visible, is_system, facet_role, column_name, width)
SELECT
  sib.service_type_field_set_id,
  sib.group_code, sib.group_label_fr, sib.group_label_en, sib.group_seq,
  sib.seq + 5, 'estimated_delivery_date',
  'Date de livraison estimée du projet', 'Estimated Project Delivery Date',
  'La date promise au client. La chaîne de jalons est planifiée sur cette date : '
    || 'un retard en amont comprime les étapes restantes au lieu de la décaler.',
  'The date promised to the client. The milestone chain is scheduled against it — '
    || 'upstream slip compresses the remaining stages rather than moving this date.',
  'DATE', false, true, true, 'DELIVERY_DATE', 'promised_delivery_date', 'HALF'
  FROM (VALUES
    ('SEA_FREIGHT_IMPORT',     'ata'),
    ('SEA_FREIGHT_EXPORT',     'ata'),
    ('AIR_FREIGHT_IMPORT',     'ata'),
    ('AIR_FREIGHT_EXPORT',     'ata'),
    ('PROJECT_CARGO',          'ata'),
    ('END_TO_END_SEA_FREIGHT', 'ata'),
    ('END_TO_END_AIR_FREIGHT', 'ata')
  ) AS v(svc, after_key)
  JOIN service_type st ON st.key = v.svc
  JOIN service_type_field_set fs
    ON fs.service_type_id = st.service_type_id AND fs.is_system AND fs.is_active
  JOIN service_type_field sib
    ON sib.service_type_field_set_id = fs.service_type_field_set_id AND sib.key = v.after_key
 WHERE NOT EXISTS (
         -- One dossier column backs at most one field per service type (0660), so
         -- this covers both "already added" and "the tenant bound their own".
         SELECT 1 FROM service_type_field x
          WHERE x.service_type_field_set_id = fs.service_type_field_set_id
            AND (x.key = 'estimated_delivery_date' OR x.column_name = 'promised_delivery_date')
       )
    ON CONFLICT (service_type_field_set_id, key) DO NOTHING;

-- ── 3. The one that already existed ─────────────────────────────────────────
-- Hinterland's `corridor_delivery_eta` is the same fact under a different name and
-- with no role. Tagged and renamed so all eight read alike — but only where the
-- label is still the seeded one, so a tenant who renamed it keeps their wording.
UPDATE service_type_field
   SET facet_role   = 'DELIVERY_DATE',
       label_en     = 'Estimated Project Delivery Date',
       label_fr     = 'Date de livraison estimée du projet'
 WHERE column_name = 'promised_delivery_date'
   AND facet_role IS NULL
   AND is_active IS NOT false
   AND label_en IN ('Planned delivery at destination', 'Estimated Project Delivery Date');

-- Any other tenant-authored field on the column gets the ROLE (so the engine and
-- the shared panel see it) without having its label touched.
UPDATE service_type_field
   SET facet_role = 'DELIVERY_DATE'
 WHERE column_name = 'promised_delivery_date'
   AND facet_role IS NULL
   AND is_active IS NOT false;

-- DOWN
-- The role narrows again, so the fields using it come out first. Check what would
-- be lost before running — the column keeps its values either way, only the way to
-- EDIT them goes:
--   SELECT COUNT(*) FROM dossier WHERE promised_delivery_date IS NOT NULL;
--
-- DELETE FROM service_type_field
--  WHERE is_system AND key = 'estimated_delivery_date'
--    AND column_name = 'promised_delivery_date';
-- UPDATE service_type_field
--    SET facet_role = NULL,
--        label_en = 'Planned delivery at destination',
--        label_fr = 'Livraison prévue à destination'
--  WHERE facet_role = 'DELIVERY_DATE' AND key = 'corridor_delivery_eta';
-- UPDATE service_type_field SET facet_role = NULL WHERE facet_role = 'DELIVERY_DATE';
-- ALTER TABLE service_type_field DROP CONSTRAINT IF EXISTS chk_stf_facet_role;
-- ALTER TABLE service_type_field ADD CONSTRAINT chk_stf_facet_role CHECK (
--   facet_role IS NULL OR facet_role IN (
--     'TRANSPORT_REF','CONVEYANCE','CARRIER','ORIGIN','DESTINATION','ROUTE_VIA',
--     'DEPARTURE_DATE','ARRIVAL_DATE','COLLECTION','FINAL_DELIVERY',
--     'CARGO_DESC','CARGO_WEIGHT','CARGO_VOLUME','CARGO_PACKAGES','CARGO_MARKS',
--     'CUSTODY_LOCATION','CUSTODY_STATUS','CUSTODY_IN','CUSTODY_OUT',
--     'INCOTERM','CUSTOMS_REF','CUSTOMS_REGIME',
--     'SCOPE_SUMMARY','COUNTERPARTY','PERIOD_START','PERIOD_END'));
