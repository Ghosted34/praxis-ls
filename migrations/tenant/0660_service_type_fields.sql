-- ============================================================================
-- TENANT DB — 0660 Shared Shipment/Service Detail Component (SSDC).
--
-- THE PROBLEM THIS CLOSES.
--
-- `dossier` carries ONE flattened set of shipment columns — pol, pod, bl_mawb,
-- vessel_flight, incoterm, customs_regime, eta, ata — and the operations-file
-- form renders all of them for every service type. A WAREHOUSING file is asked
-- for a Port of Loading. An AIR_FREIGHT_IMPORT file is asked for a Bill of
-- Lading it will never have. There is nowhere to put an airline, a flight
-- number, a bonded-warehouse status or a representation scope, so none of them
-- are captured at all, and every document downstream prints whatever subset of
-- sea vocabulary happens to be filled in.
--
-- The legacy PHP system had the right idea and the wrong mechanism: a `switch`
-- on the service type in the browser injected a different block of HTML
-- (`renderDynamicSections`), writing into a different block of hard-coded
-- columns (sea_bl / air_mawb / inland_truck / warehouse_loc / rep_scope). Adding
-- a service meant a schema change, a form change and a normaliser change — and
-- the normaliser ("what is the transport reference for this file?") was written
-- THREE times, once in JavaScript and twice in PHP, and had already drifted.
--
-- WHAT THIS DOES INSTEAD.
--
-- The fields a service type needs become DATA hanging off `service_type`, in
-- exactly the shape `milestone_template` already proved: a VERSIONED set, with
-- one active version, that a manager edits from the Service Type screen. A
-- dossier records the version it was created under, so a file opened in March
-- keeps rendering the March form even after the set is republished in June.
--
-- WHY VERSIONED AND NOT JUST EDITABLE. Someone will add a required field, or
-- rename a label, or retire a field, while two hundred files are open. Without
-- versions those files retroactively become "incomplete", locked documents cite
-- field keys that no longer exist, and there is no answer to "what did this form
-- look like when the file was opened". Milestone templates hit this first and
-- solved it with versions; this is the same problem and gets the same answer.
--
-- WHERE THE VALUES GO (the hybrid, deliberately).
--
-- A field definition names its storage. `column_name` NULL means the value
-- lives in `dossier.details_json` under the field's `key`. `column_name` set
-- means the field IS an existing dossier column — so the SEA field set's "Port
-- of Loading" is literally `dossier.pol`, and everything already built on that
-- column keeps working untouched: the Control Tower map's geo_place resolution
-- (0479), the dossier search (repo `q` matches bl_mawb/vessel_flight), the
-- carrier rate lookup (0635). Only genuinely service-specific fields — bonded
-- status, flight number, representation scope — land in jsonb.
--
-- Pure jsonb would have been simpler and would have thrown away every foreign
-- key we have earned. A real column per field is impossible: fields are created
-- by users at runtime, and a form cannot run a migration.
--
-- FACET ROLES — why the shared component works for a service invented in 2030.
--
-- Each service type owns its own fields; nothing is shared between them (a
-- deliberate product decision — a Warehousing file must never show freight
-- vocabulary, not even an empty box). That leaves one question: how does a
-- generic panel know which of a service's fields is "the transport reference"?
--
-- `facet_role`. The author tags "Bill of Lading" on Sea and "MAWB" on Air both
-- as TRANSPORT_REF; "Warehouse" on Warehousing as CUSTODY_LOCATION. The
-- projection reads roles, never keys, so every consumer — costing, quotation,
-- proforma, invoice, transit order, delivery note, the client portal, and
-- whatever is built next — renders a correct panel for a service type nobody
-- had thought of when the consumer was written. This is the single thing the
-- legacy system lacked, and the reason its normaliser had to be rewritten per
-- consumer.
--
-- EQUIPMENT (containers).
--
-- The container TYPE registry already exists and is already editable —
-- `dictionary_ref` kind CONTAINER_TYPE (0630/0632), wired to `expense_rate`
-- per carrier per type (0634). What has never existed is any link from a FILE
-- to the boxes on it: "this job is 2 flat racks and 3 × 40' HC" is currently
-- unrepresentable, which is why per-container charges can only ever be
-- estimated.
--
-- Two tables, because the information arrives in two stages. At booking you
-- know the counts (`dossier_container_line`); when the BL lands you know the
-- numbers and seals (`dossier_container_unit`). Grouped counts are the default
-- and are enough on their own; per-box capture is a per-service-type toggle for
-- tenants who track equipment individually. A file never has to wait for
-- container numbers to be opened.
--
-- REGISTRY SIZE SPLIT. The seeded specials had no size — `FLATRACK` was just
-- "Flat Rack", so "2 FR" could not distinguish a 20' from a 40'. That matters
-- the moment anything is charged per box. The sized rows (FR20/FR40, OT20/OT40,
-- RF20/RF40/RF40HC, TK20/TK40, VT20/VT40, plus 20' HC) are added by seed 9092 —
-- see the note above section 5 for why they cannot live in this file.
--
-- ADDITIVE ONLY. No column is dropped, no row is deleted, every new column has
-- a default or is nullable. Existing dossiers keep working with no field set at
-- all — `activeFieldSet` returning nothing is a normal state that renders the
-- legacy core fields, not an error.
-- ============================================================================

-- ── 1. Versioned field sets ─────────────────────────────────────────────────
-- Mirrors milestone_template (0310) down to the (service_type_id, version)
-- uniqueness, so the two editors on the Service Type screen behave alike.
CREATE TABLE IF NOT EXISTS service_type_field_set (
  service_type_field_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id  uuid NOT NULL REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  version          integer NOT NULL DEFAULT 1,
  is_active        boolean NOT NULL DEFAULT true,
  name             text,
  -- Which version this one was cloned from — the audit trail behind "who
  -- changed the sea form and what did it look like before".
  source_version   integer,
  is_system        boolean NOT NULL DEFAULT false,
  published_at     timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_type_id, version)
);

-- At most ONE active version per service type. Enforced in the database because
-- "which form do I render" must have exactly one answer; the service activates
-- by deactivating siblings in the same transaction.
CREATE UNIQUE INDEX IF NOT EXISTS ux_service_type_field_set_active
  ON service_type_field_set (service_type_id) WHERE is_active;

CREATE OR REPLACE TRIGGER trg_stfs_updated
  BEFORE UPDATE ON service_type_field_set
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. The field definitions themselves ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_type_field (
  service_type_field_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_field_set_id uuid NOT NULL
    REFERENCES service_type_field_set(service_type_field_set_id) ON DELETE CASCADE,

  -- Visual sectioning WITHIN one service type's form ("Transport", "Cargo",
  -- "Customs"). Not a shared/reusable group: each service type owns its own
  -- fields outright, so this is a heading, not a foreign key.
  group_code       text NOT NULL DEFAULT 'DETAILS',
  group_label_fr   text,
  group_label_en   text,
  group_seq        integer NOT NULL DEFAULT 0,

  -- numeric, like milestone_template_stage.stage_seq — a field can be inserted
  -- BETWEEN two others (2.5) without renumbering the set.
  seq              numeric(10,4) NOT NULL DEFAULT 0,

  -- Stable machine key. Becomes the `details_json` property name, so it is
  -- snake_case and immutable after creation (renaming would orphan every value
  -- already captured under the old name).
  key              text NOT NULL,

  label_fr         text NOT NULL,
  label_en         text,
  help_text_fr     text,
  help_text_en     text,
  placeholder      text,

  data_type        text NOT NULL DEFAULT 'TEXT',
  -- SELECT / MULTISELECT choices: [{ value, label_fr, label_en }]
  options_json     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- For data_type REF: which dictionary_ref.kind the picker reads
  -- (CONTAINER_TYPE, LOAD_MODE, …). Ignored for every other type.
  ref_kind         text,
  -- { min, max, min_length, max_length, format } — enforced server-side on
  -- write, not just in the browser. `format` names one of a fixed list of
  -- expressions owned in code (EMAIL, CONTAINER_NO, …); a definition may NOT
  -- carry a raw regular expression, because one authored through the API is
  -- regex injection and Node cannot time a regex out.
  validation_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_value    jsonb,

  -- Required AT CREATION. The product rule (deliberate): a file must open on
  -- the day the booking lands, when the ETA and the BL number genuinely are not
  -- known yet. So "required" is a per-field choice the service-type owner
  -- makes, and everything else is captured progressively and surfaced as a
  -- completeness figure rather than a blocker.
  is_required      boolean NOT NULL DEFAULT false,
  -- Rendered on the client portal beside the milestone chain.
  is_client_visible boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  is_system        boolean NOT NULL DEFAULT false,

  -- What this field MEANS to the shared panel. See the header.
  facet_role       text,

  -- NULL = the value lives in dossier.details_json under `key`.
  -- Set  = the field IS this dossier column (see the header's hybrid note).
  column_name      text,

  -- Layout hint for the renderer.
  width            text NOT NULL DEFAULT 'HALF',

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_type_field_set_id, key)
);

CREATE INDEX IF NOT EXISTS ix_service_type_field_set
  ON service_type_field (service_type_field_set_id, group_seq, seq);

CREATE OR REPLACE TRIGGER trg_stf_updated
  BEFORE UPDATE ON service_type_field
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Vocabularies as CHECK constraints rather than app-only validation: these are
-- read by the renderer, the projection and the validator, and a value outside
-- the list silently renders nothing rather than failing loudly.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_stf_data_type') THEN
    ALTER TABLE service_type_field ADD CONSTRAINT chk_stf_data_type CHECK (data_type IN (
      'TEXT','TEXTAREA','NUMBER','INTEGER','DATE','DATETIME','BOOLEAN',
      'SELECT','MULTISELECT',
      -- Pickers backed by real registries, so a field can carry a foreign key
      -- rather than a string somebody typed three ways.
      'GEO_PLACE','RATE_PROVIDER','REF','CURRENCY'
    ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_stf_width') THEN
    ALTER TABLE service_type_field ADD CONSTRAINT chk_stf_width
      CHECK (width IN ('THIRD','HALF','FULL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_stf_facet_role') THEN
    ALTER TABLE service_type_field ADD CONSTRAINT chk_stf_facet_role CHECK (
      facet_role IS NULL OR facet_role IN (
        -- Movement
        'TRANSPORT_REF','CONVEYANCE','CARRIER','ORIGIN','DESTINATION','ROUTE_VIA',
        'DEPARTURE_DATE','ARRIVAL_DATE',
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
  END IF;
  -- The promotable columns, named explicitly. A field definition may only bind
  -- to a dossier column that this migration knows about — an app-level typo
  -- ("column_name": "clients") must fail here, not reach query-helpers.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_stf_column_name') THEN
    ALTER TABLE service_type_field ADD CONSTRAINT chk_stf_column_name CHECK (
      column_name IS NULL OR column_name IN (
        'pol','pod','bl_mawb','vessel_flight','incoterm','customs_regime',
        'eta','ata','promised_delivery_date','rate_provider_id','title',
        'commodity','commodity_desc','gross_weight','weight_unit',
        'package_count','volume_cbm','marks_numbers','place_receipt','place_delivery'
      )
    );
  END IF;
END $$;

-- ── 3. Cargo columns promoted onto the dossier ──────────────────────────────
-- Cross-service by nature (a sea file, an air file, a truck and a warehouse job
-- all have a commodity and a weight), read by every printed document, and worth
-- filtering a report on — which is the test for promotion. Everything genuinely
-- mode-specific stays in details_json.
ALTER TABLE dossier
  ADD COLUMN IF NOT EXISTS commodity       text,
  ADD COLUMN IF NOT EXISTS commodity_desc  text,
  ADD COLUMN IF NOT EXISTS gross_weight    numeric(18,3),
  ADD COLUMN IF NOT EXISTS weight_unit     text,
  ADD COLUMN IF NOT EXISTS package_count   integer,
  ADD COLUMN IF NOT EXISTS volume_cbm      numeric(18,3),
  ADD COLUMN IF NOT EXISTS marks_numbers   text,
  ADD COLUMN IF NOT EXISTS place_receipt   text,
  ADD COLUMN IF NOT EXISTS place_delivery  text,
  -- The field-set version this file was created under. NULL is legitimate and
  -- common: every dossier that predates this migration, and any file on a
  -- service type whose owner has not defined a set yet.
  ADD COLUMN IF NOT EXISTS service_type_field_set_id uuid
    REFERENCES service_type_field_set(service_type_field_set_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dossier_weight_unit') THEN
    ALTER TABLE dossier ADD CONSTRAINT chk_dossier_weight_unit
      CHECK (weight_unit IS NULL OR weight_unit IN ('KG','TON','LB'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dossier_package_count') THEN
    ALTER TABLE dossier ADD CONSTRAINT chk_dossier_package_count
      CHECK (package_count IS NULL OR package_count >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_dossier_field_set
  ON dossier (service_type_field_set_id) WHERE service_type_field_set_id IS NOT NULL;

-- ── 4. Equipment capture, toggled per service type ──────────────────────────
-- Off by default, because most service types are not containerised and an empty
-- container table on a Business Representation file is exactly the kind of
-- freight leakage this whole migration exists to stop.
ALTER TABLE service_type
  ADD COLUMN IF NOT EXISTS captures_containers boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS container_detail_mode text NOT NULL DEFAULT 'GROUPED';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_service_type_container_mode') THEN
    ALTER TABLE service_type ADD CONSTRAINT chk_service_type_container_mode
      CHECK (container_detail_mode IN ('GROUPED','PER_BOX'));
  END IF;
END $$;

-- Grouped counts: "3 × 40' HC". What is known at booking.
CREATE TABLE IF NOT EXISTS dossier_container_line (
  dossier_container_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id       uuid NOT NULL REFERENCES dossier(dossier_id) ON DELETE CASCADE,
  seq              integer NOT NULL DEFAULT 0,
  -- The editable registry (dictionary_ref kind CONTAINER_TYPE), the same rows
  -- expense_rate prices against — so a file's equipment and its rate card can
  -- never disagree about what a 40' HC is.
  container_type_ref_id uuid NOT NULL REFERENCES dictionary_ref(ref_id),
  load_mode_ref_id uuid REFERENCES dictionary_ref(ref_id),
  qty              integer NOT NULL DEFAULT 1,
  gross_weight_kg  numeric(18,3),
  volume_cbm       numeric(18,3),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_container_line_qty') THEN
    ALTER TABLE dossier_container_line ADD CONSTRAINT chk_container_line_qty CHECK (qty > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_container_line_dossier
  ON dossier_container_line (dossier_id, seq);
CREATE INDEX IF NOT EXISTS ix_container_line_type
  ON dossier_container_line (container_type_ref_id);

-- Per-box identity: filled in later, when the BL lands. Optional by design —
-- a line with no units is complete and usable; units simply make anything
-- charged per container exact instead of estimated.
CREATE TABLE IF NOT EXISTS dossier_container_unit (
  dossier_container_unit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_container_line_id uuid NOT NULL
    REFERENCES dossier_container_line(dossier_container_line_id) ON DELETE CASCADE,
  -- Denormalised so "every box on this file" is one index scan rather than a
  -- join through the lines; kept in step by the service, never written directly.
  dossier_id       uuid NOT NULL REFERENCES dossier(dossier_id) ON DELETE CASCADE,
  container_no     text,
  seal_no          text,
  tare_kg          numeric(18,3),
  gross_weight_kg  numeric(18,3),
  temperature_c    numeric(6,2),
  imdg_class       text,
  discharged_on    date,
  out_of_port_on   date,
  returned_on      date,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_container_unit_line
  ON dossier_container_unit (dossier_container_line_id);
CREATE INDEX IF NOT EXISTS ix_container_unit_dossier
  ON dossier_container_unit (dossier_id);
-- A container number is unique within a file (the same box cannot be on one
-- job twice); across files it repeats constantly, which is normal — boxes are
-- reused. Partial so the many rows with no number yet do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS ux_container_unit_no
  ON dossier_container_unit (dossier_id, container_no)
  WHERE container_no IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_container_line_updated
  BEFORE UPDATE ON dossier_container_line
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER trg_container_unit_updated
  BEFORE UPDATE ON dossier_container_unit
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- NOTE — the container TYPE registry (sized rows for the specials) is seeded in
-- `seeds/9092_seed_service_type_fields.sql`, NOT here. `dictionary_ref`'s
-- CONTAINER_TYPE rows are themselves created by `seeds/9080`, and seeds run
-- AFTER every tenant migration on both a fresh provision and an upgrade — so
-- an INSERT/UPDATE against those rows in this file would match nothing on a new
-- tenant and silently do half its job. It belongs where the rows exist.

-- DOWN
-- DROP TABLE IF EXISTS dossier_container_unit;
-- DROP TABLE IF EXISTS dossier_container_line;
-- ALTER TABLE service_type DROP COLUMN IF EXISTS captures_containers,
--   DROP COLUMN IF EXISTS container_detail_mode;
-- ALTER TABLE dossier DROP COLUMN IF EXISTS service_type_field_set_id,
--   DROP COLUMN IF EXISTS commodity, DROP COLUMN IF EXISTS commodity_desc,
--   DROP COLUMN IF EXISTS gross_weight, DROP COLUMN IF EXISTS weight_unit,
--   DROP COLUMN IF EXISTS package_count, DROP COLUMN IF EXISTS volume_cbm,
--   DROP COLUMN IF EXISTS marks_numbers, DROP COLUMN IF EXISTS place_receipt,
--   DROP COLUMN IF EXISTS place_delivery;
-- DROP TABLE IF EXISTS service_type_field;
-- DROP TABLE IF EXISTS service_type_field_set;
-- (The dictionary_ref rows added above are data, not schema: reactivate the
--  size-less specials and delete the sized codes by hand only after confirming
--  no dossier_container_line references them.)
