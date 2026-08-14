-- ============================================================================
-- 0678 — a delivery place is one question, and the itinerary reads it.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- Two unrelated controls asked "where is this cargo delivered", on the same
-- form, in the same session:
--
--   1. the service type's own `place_delivery` field, bound to the dossier
--      column of that name — the value every document prints;
--   2. a "Deliver to the consignee" toggle in the create wizard, which appended
--      a FINAL_DELIVERY itinerary leg.
--
-- Both were answered by hand, neither knew about the other, and 0673 had ALREADY
-- given every freight service type a FINAL_DELIVERY leg in its template — so the
-- toggle produced a SECOND delivery leg on a file that already had one. Two legs,
-- two drawn lines between the same two places, and a column that could disagree
-- with both.
--
-- ── THE RULE THIS ESTABLISHES ───────────────────────────────────────────────
--
-- A place is named ONCE, in the service type's own form, and the itinerary is
-- derived from it (`itinerary.legsFromTemplate` walks the template and fills each
-- leg from `place_receipt` → `pol` → `pod` → `place_delivery`). The wizard's
-- toggle is gone; there is nothing left for it to ask.
--
-- For that to hold, the form has to actually HAVE the field — which is what this
-- migration fixes. Three gaps, all from 9092:
--
--   * SEA's `place_delivery` carried `facet_role = NULL`, so 0676 (which promotes
--     TEXT to GEO_PLACE by role) skipped it. On a sea import — the commonest file
--     in the system — "Place of delivery" was still a free-text box with no
--     picker, no verification and no coordinate, which is exactly the defect PR1
--     set out to remove. It is the one field a customer phones about.
--   * AIR and PROJECT have a FINAL_DELIVERY leg in their template and NO delivery
--     field at all, so the leg could never be filled from the form.
--   * The two END_TO_END types have a REQUIRED PICKUP leg and no collection
--     field. A door-to-door file could not record the address it is sold on.
--
-- ── WHY TWO NEW FACET ROLES ─────────────────────────────────────────────────
--
-- `ORIGIN` and `DESTINATION` describe the MAIN CARRIAGE — the port pair on the
-- bill of lading. The door legs are a different fact and need their own names:
--
--   COLLECTION      where the cargo is collected, BEFORE the main carriage
--   FINAL_DELIVERY  where the cargo is delivered, AFTER it
--
-- Reusing DESTINATION for the delivery address would put two DESTINATION fields
-- on one sea import, and the facet map is keyed by role — so one of the two would
-- silently win, and every consumer reading "the destination" would get whichever
-- came back first. The two end-to-end types keep `place_delivery` tagged
-- DESTINATION deliberately (9092 re-tags their POD to ROUTE_VIA for the same
-- reason: on a door-to-door file the delivery address IS the destination every
-- document prints), and `legsFromTemplate` reads the COLUMN rather than the role,
-- so both taggings produce the same itinerary.
--
-- Both roles join `PLACE_ROLES` in shipment_details, so a delivery address is
-- verified at promote exactly like a POL — no silent background geocode.
--
-- Idempotent throughout: the UPDATE's WHERE excludes rows it has converted, and
-- each INSERT is guarded on the field being absent.
-- ============================================================================

-- ── 1. The vocabulary ───────────────────────────────────────────────────────
-- DROPPED AND RE-ADDED, not guarded on absence: a CHECK cannot be extended in
-- place, and this constraint already exists (0660 named it), so an
-- `IF NOT EXISTS` guard would match and skip — leaving the old vocabulary and
-- failing step 3 on the first row that uses a new role. Drop-then-add inside one
-- transaction is idempotent by construction and never leaves the table unguarded.
DO $$ BEGIN
  ALTER TABLE service_type_field DROP CONSTRAINT IF EXISTS chk_stf_facet_role;
  ALTER TABLE service_type_field ADD CONSTRAINT chk_stf_facet_role CHECK (
    facet_role IS NULL OR facet_role IN (
      -- Movement — the main carriage
      'TRANSPORT_REF','CONVEYANCE','CARRIER','ORIGIN','DESTINATION','ROUTE_VIA',
      'DEPARTURE_DATE','ARRIVAL_DATE',
      -- Movement — the door legs either side of it
      'COLLECTION','FINAL_DELIVERY',
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

-- ── 2. The untagged delivery field becomes a real place field ───────────────
-- Scoped by COLUMN, not by key: `place_delivery` is the dossier column reserved
-- for the delivery address (0660's chk_stf_column_name), so any field bound to it
-- means that and nothing else, whatever a tenant named it. Rows that already
-- carry a role are left exactly as they are — the end-to-end pair's DESTINATION
-- tagging is load-bearing.
UPDATE service_type_field
   SET facet_role = 'FINAL_DELIVERY'
 WHERE column_name = 'place_delivery'
   AND facet_role IS NULL
   AND is_active IS NOT false;

-- Same promotion 0676 performed, now that the role is set. Kept as its own
-- statement rather than folded into the UPDATE above so that a tenant who had
-- already hand-tagged the field still gets the picker.
UPDATE service_type_field
   SET data_type = 'GEO_PLACE'
 WHERE data_type = 'TEXT'
   AND is_active IS NOT false
   AND facet_role IN ('COLLECTION', 'FINAL_DELIVERY');

-- ── 3. The missing fields ───────────────────────────────────────────────────
--
-- One INSERT, driven by a VALUES list of (service type, field) pairs, so the
-- three cases read as the table they are. Each row lands only where:
--
--   * the service type exists and has the system field set 9092 authored;
--   * no field in that set already binds the column (0660's own rule: one
--     dossier column backs at most one field per service type);
--   * no field in that set already uses the key.
--
-- `group_code` reuses the set's existing transport group so the field appears
-- beside the ports rather than in a section of its own — the delivery address is
-- part of the route, and a form that puts it under a new heading reads as an
-- afterthought. The group's labels and seq are copied from a sibling row, and
-- `seq_offset` places the new field relative to that sibling: collection lands
-- BEFORE the port it feeds, delivery AFTER the one it follows, so the form reads
-- in the order the cargo travels.
INSERT INTO service_type_field (
  service_type_field_set_id, group_code, group_label_fr, group_label_en, group_seq,
  seq, key, label_fr, label_en, help_text_fr, help_text_en,
  data_type, is_required, is_client_visible, is_system, facet_role, column_name, width)
SELECT
  sib.service_type_field_set_id,
  sib.group_code, sib.group_label_fr, sib.group_label_en, sib.group_seq,
  sib.seq + v.seq_offset, v.key, v.label_fr, v.label_en, v.help_fr, v.help_en,
  'GEO_PLACE', v.is_required, true, true, v.facet_role, v.column_name, 'HALF'
  FROM (VALUES
    -- Air and project files truck from the airport/quay like any other; the
    -- template has said so since 0673 and only the field was missing. Optional:
    -- a port-to-port air job that the consignee collects is a normal file.
    ('AIR_FREIGHT_IMPORT',     'place_delivery', 'Lieu de livraison', 'Place of delivery',
     'Où la marchandise est livrée après l''aéroport. Laissez vide si le client enlève lui-même.',
     'Where the cargo is delivered after the airport. Leave blank if the consignee collects.',
     'FINAL_DELIVERY', 'place_delivery', false, 'dest_airport', 5),
    ('AIR_FREIGHT_EXPORT',     'place_delivery', 'Lieu de livraison', 'Place of delivery',
     'Où la marchandise est livrée après l''aéroport. Laissez vide si le client enlève lui-même.',
     'Where the cargo is delivered after the airport. Leave blank if the consignee collects.',
     'FINAL_DELIVERY', 'place_delivery', false, 'dest_airport', 5),
    ('PROJECT_CARGO',          'place_delivery', 'Lieu de livraison', 'Place of delivery',
     'Le point de livraison final, quand il diffère de la destination du transport principal.',
     'The final delivery point, when it differs from the main carriage''s destination.',
     'FINAL_DELIVERY', 'place_delivery', false, 'pod', 5),
    -- A door-to-door file's collection address is known on the day the booking
    -- lands and is the first thing the client asks about, so it is required —
    -- and its PICKUP leg is not optional in the template either.
    ('END_TO_END_SEA_FREIGHT', 'place_receipt',  'Lieu d''enlèvement', 'Place of collection',
     'Où le camion charge chez l''expéditeur. Cette adresse ouvre l''itinéraire.',
     'Where the truck loads at the shipper. This address opens the itinerary.',
     'COLLECTION', 'place_receipt', true, 'pol', -5),
    ('END_TO_END_AIR_FREIGHT', 'place_receipt',  'Lieu d''enlèvement', 'Place of collection',
     'Où le camion charge chez l''expéditeur. Cette adresse ouvre l''itinéraire.',
     'Where the truck loads at the shipper. This address opens the itinerary.',
     'COLLECTION', 'place_receipt', true, 'origin_airport', -5)
  ) AS v(svc, key, label_fr, label_en, help_fr, help_en, facet_role, column_name,
         is_required, after_key, seq_offset)
  JOIN service_type st ON st.key = v.svc
  JOIN service_type_field_set fs
    ON fs.service_type_id = st.service_type_id AND fs.is_system AND fs.is_active
  JOIN service_type_field sib
    ON sib.service_type_field_set_id = fs.service_type_field_set_id AND sib.key = v.after_key
 WHERE NOT EXISTS (
         SELECT 1 FROM service_type_field x
          WHERE x.service_type_field_set_id = fs.service_type_field_set_id
            AND (x.key = v.key OR x.column_name = v.column_name)
       )
    -- The NOT EXISTS above is the real guard (it covers the column collision the
    -- key constraint cannot see); this is the belt to its braces, and it is what
    -- makes a re-run provably a no-op rather than argued to be one.
    ON CONFLICT (service_type_field_set_id, key) DO NOTHING;

-- ── 4. Help text on the sea field, which now has a picker ───────────────────
-- Only where it is still bare. A tenant who wrote their own hint keeps it.
UPDATE service_type_field
   SET help_text_fr = 'Où la marchandise est livrée après le port. Laissez vide si le client enlève lui-même.',
       help_text_en = 'Where the cargo is delivered after the port. Leave blank if the consignee collects.'
 WHERE column_name = 'place_delivery'
   AND facet_role = 'FINAL_DELIVERY'
   AND help_text_fr IS NULL
   AND help_text_en IS NULL;

-- DOWN
-- The vocabulary narrows again, which is only safe once no field uses the two new
-- roles — so the fields this file added come out first, and only while they hold
-- no data. Check before running:
--   SELECT COUNT(*) FROM dossier WHERE place_delivery IS NOT NULL OR place_receipt IS NOT NULL;
--
-- DELETE FROM service_type_field f
--  USING service_type_field_set fs, service_type st
--  WHERE f.service_type_field_set_id = fs.service_type_field_set_id
--    AND fs.service_type_id = st.service_type_id AND f.is_system
--    AND ((st.key IN ('AIR_FREIGHT_IMPORT','AIR_FREIGHT_EXPORT','PROJECT_CARGO')
--          AND f.key = 'place_delivery')
--      OR (st.key IN ('END_TO_END_SEA_FREIGHT','END_TO_END_AIR_FREIGHT')
--          AND f.key = 'place_receipt'));
-- UPDATE service_type_field SET facet_role = NULL
--  WHERE facet_role IN ('COLLECTION','FINAL_DELIVERY');
-- ALTER TABLE service_type_field DROP CONSTRAINT IF EXISTS chk_stf_facet_role;
-- ALTER TABLE service_type_field ADD CONSTRAINT chk_stf_facet_role CHECK (
--   facet_role IS NULL OR facet_role IN (
--     'TRANSPORT_REF','CONVEYANCE','CARRIER','ORIGIN','DESTINATION','ROUTE_VIA',
--     'DEPARTURE_DATE','ARRIVAL_DATE',
--     'CARGO_DESC','CARGO_WEIGHT','CARGO_VOLUME','CARGO_PACKAGES','CARGO_MARKS',
--     'CUSTODY_LOCATION','CUSTODY_STATUS','CUSTODY_IN','CUSTODY_OUT',
--     'INCOTERM','CUSTOMS_REF','CUSTOMS_REGIME',
--     'SCOPE_SUMMARY','COUNTERPARTY','PERIOD_START','PERIOD_END'));
--
-- The data_type promotion in step 2 is IRREVERSIBLE for the same reason 0676's
-- is: the pre-conversion type is not recorded, and reversing by role would
-- flatten a tenant's own GEO_PLACE fields alongside the ones this file converted.
-- It is additive in effect (a GEO_PLACE field stores the same text a TEXT field
-- did), so the recovery for an unwanted conversion is to set the individual
-- field's type back from Service types → Details.
