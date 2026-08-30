-- ============================================================================
-- TENANT — 12756 What a website quote request can carry that a phone call
-- cannot: a note, two verified places, and a file.
--
-- The five fields doc/PUBLIC_WEB_PLAN.md WS2 lists as "missing" are mostly not
-- missing at all — warehouse_location, warehouse_duration, estimated_weight and
-- project_cargo_flag have been on this table since 0683 and are already in the
-- repo's WRITABLE list. What was missing was the PUBLIC schema's willingness to
-- accept them (public_intake.validator.js), which is a code change, not a
-- migration. Only additional_notes had nowhere to go.
--
-- ── WHY THE PLACES ARE FOREIGN KEYS AND NOT TWO MORE numeric COLUMNS ───────
-- Resolved decision 4: "the coordinates must actually be submitted and stored —
-- operations/geo_place and the GEO_PLACE field type are the model to bind to."
-- Their site captures coordinates from an unkeyed public Photon instance and
-- then never submits them, which is the worst of both: a prospect's route is
-- sent to a third party and the desk still gets a text string.
--
-- Binding to geo_place rather than storing a lat/lng pair here buys three
-- things a pair of columns cannot: the coordinate carries its PROVENANCE
-- (`source = 'GEOAPIFY'`, `resolved_at`), the same place resolves to the same
-- row for every quote that names it, and the row is the one the dossier will
-- reference later when this request becomes an operation. A numeric pair here
-- would have to be re-geocoded to become any of that.
--
-- ON DELETE SET NULL on both: a place retired from the catalogue must not take
-- a quote request with it. The text in origin_location / destination_location
-- is what the requester actually typed and stays authoritative for reading; the
-- FK is the machine-readable enrichment beside it, and a quote with a text
-- route and no pin is the ordinary case, not a broken one.
--
-- ── WHY THE ATTACHMENT IS ONE FK AND NOT A CHILD TABLE ─────────────────────
-- Resolved decision 5 makes the attachment OPTIONAL and singular: one packing
-- list or one commercial invoice, offered by a prospect who has it to hand. A
-- child table would be modelling a document set nobody is going to send at the
-- "what would this cost" stage, and the desk that needs a second file asks for
-- it in the reply. If that changes, a child table can be added later without
-- rewriting this column's meaning.
-- ============================================================================

ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS additional_notes text;

ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS origin_place_id uuid
    REFERENCES geo_place(geo_place_id) ON DELETE SET NULL;
ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS destination_place_id uuid
    REFERENCES geo_place(geo_place_id) ON DELETE SET NULL;

ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS attachment_doc_id uuid
    REFERENCES document_vault(doc_id) ON DELETE SET NULL;

COMMENT ON COLUMN quote_request.additional_notes IS
  'Free text the requester added beyond the cargo description. Website intake.';
COMMENT ON COLUMN quote_request.origin_place_id IS
  'Geocoded origin, provider-verified server-side. NULL when the requester typed free text.';
COMMENT ON COLUMN quote_request.destination_place_id IS
  'Geocoded destination, provider-verified server-side. NULL when the requester typed free text.';
COMMENT ON COLUMN quote_request.attachment_doc_id IS
  'One optional file from the requester (packing list, invoice). Vault-stored, content-sniffed.';

-- Partial, because the overwhelming majority of rows have neither. These exist
-- for the one query the desk actually runs — "show me the requests with a pin"
-- when planning a route — not for the FK lookup, which Postgres does not index
-- automatically but also never needs here.
CREATE INDEX IF NOT EXISTS ix_quote_request_origin_place
  ON quote_request(origin_place_id) WHERE origin_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_quote_request_destination_place
  ON quote_request(destination_place_id) WHERE destination_place_id IS NOT NULL;

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'quote_request'
--      AND column_name IN ('additional_notes','origin_place_id',
--                          'destination_place_id','attachment_doc_id');
--   -- expect 4 rows
--
--   -- retiring a place must not delete the quote that named it:
--   DELETE FROM geo_place WHERE geo_place_id = '<id>';
--   SELECT origin_place_id FROM quote_request WHERE quote_request_id = '<id>';
--   -- expect NULL, and the row still present
--
-- DOWN
--   DROP INDEX IF EXISTS ix_quote_request_destination_place;
--   DROP INDEX IF EXISTS ix_quote_request_origin_place;
--   ALTER TABLE quote_request
--     DROP COLUMN IF EXISTS attachment_doc_id,
--     DROP COLUMN IF EXISTS destination_place_id,
--     DROP COLUMN IF EXISTS origin_place_id,
--     DROP COLUMN IF EXISTS additional_notes;
--   -- The public schema then rejects those keys as unknown (.strict()), which
--   -- is the correct refusal rather than a silent drop. Vault documents and
--   -- geo_place rows already written are orphaned, not deleted — deleting a
--   -- prospect's uploaded invoice to undo a column would be the wrong trade.
-- ============================================================================
