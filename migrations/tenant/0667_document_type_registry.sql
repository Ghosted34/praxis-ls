-- ============================================================================
-- TENANT DB — 0667 Document types a person chooses, and who a document is for.
--
-- WHY A REGISTRY FOR UPLOADS
--
-- The vault already has a doc-type registry — `document_vault.types.js` — but it
-- governs SYSTEM-GENERATED captures, where the code doubles as the template key,
-- and `createDocument` says so in as many words: "Ad-hoc uploads are free-form
-- … no registry guard here". So an operator attaching a Bill of Lading writes
-- whatever the calling screen passed. "BL", "B/L", "Bill of Lading" and
-- "connaissement" are four documents as far as any report is concerned, and
-- there is no list to pick from because there is no list.
--
-- The values live in `dictionary_ref` under kind DOCUMENT_TYPE rather than in a
-- new table: same gear modal, same is_system/is_active semantics, same inline
-- "+ Add" as every other registry in the product. A tenant meeting a document
-- Praxis never heard of adds it from the picker, mid-upload, and it is there for
-- every file afterwards. That is the whole requirement — the TYPE is reusable;
-- each uploaded FILE is still its own vault row.
--
-- WHY THE VAULT GAINS FOUR COLUMNS
--
-- `doc_type_ref_id` is the reference; the legacy `doc_type` text stays and is
-- kept populated with the registry CODE so every existing reader keeps working
-- and nothing has to be migrated in lockstep.
--
-- `client_id` because filing is by client at least as often as by file: a tax
-- exemption certificate is the client's, and finding "every APEC we hold for
-- Bolloré" should not mean walking their dossiers.
--
-- `original_name` because `storage_path` is a random key — the vault could not
-- tell you what the user called the file they uploaded, which is the first thing
-- they say when asking you to find it.
--
-- `uploaded_by` because "who attached this" is the second thing.
-- ============================================================================

-- ── 1. The registry ─────────────────────────────────────────────────────────
-- `client_scoped`/`reusable` on APEC record that it is a client-level
-- certificate rather than a per-shipment document. Nothing reads them yet; they
-- are the hook for referencing one certificate from several files later, and
-- recording the fact now costs nothing.
INSERT INTO dictionary_ref (kind, code, name_fr, name_en, extra, sort_order, is_system) VALUES
  ('DOCUMENT_TYPE','BL','Connaissement','Bill of Lading','{"client_visible":true}'::jsonb,10,true),
  ('DOCUMENT_TYPE','MAWB','LTA','Air Waybill','{"client_visible":true}'::jsonb,20,true),
  ('DOCUMENT_TYPE','INVOICE','Facture','Invoice','{}'::jsonb,30,true),
  ('DOCUMENT_TYPE','RECEIPT','Reçu','Receipt','{}'::jsonb,40,true),
  ('DOCUMENT_TYPE','POD','Preuve de livraison','Proof of Delivery','{}'::jsonb,50,true),
  ('DOCUMENT_TYPE','CUSTOMS','Document douanier','Customs Document','{}'::jsonb,60,true),
  ('DOCUMENT_TYPE','APEC','Attestation de Prise en Charge','Tax Exemption Certificate',
     '{"client_scoped":true,"reusable":true}'::jsonb,70,true),
  ('DOCUMENT_TYPE','PACKING_LIST','Liste de colisage','Packing List','{}'::jsonb,80,true),
  ('DOCUMENT_TYPE','WAYBILL','Lettre de voiture','Waybill','{}'::jsonb,90,true),
  ('DOCUMENT_TYPE','OTHER','Autre','Other','{}'::jsonb,999,true)
ON CONFLICT (kind, code) DO NOTHING;

-- ── 2. Filing columns on the vault ──────────────────────────────────────────
ALTER TABLE document_vault
  ADD COLUMN IF NOT EXISTS doc_type_ref_id uuid REFERENCES dictionary_ref(ref_id),
  ADD COLUMN IF NOT EXISTS client_id       uuid REFERENCES client_master(client_id),
  ADD COLUMN IF NOT EXISTS original_name   text,
  ADD COLUMN IF NOT EXISTS uploaded_by     uuid REFERENCES app_user(user_id);

-- Partial, both of them: system-generated documents carry neither, and these
-- indexes exist for "every BL on this file" and "every APEC for this client",
-- which always filter on NOT NULL.
CREATE INDEX IF NOT EXISTS ix_vault_doc_type ON document_vault(doc_type_ref_id)
  WHERE doc_type_ref_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_vault_client   ON document_vault(client_id)
  WHERE client_id IS NOT NULL;

-- ── 3. Adopt what is already there ──────────────────────────────────────────
-- Uploads whose free-text doc_type happens to match a registry code get the
-- reference. Anything else keeps its text and gains no reference — which is the
-- honest outcome: "B/L" is probably a Bill of Lading and a migration should not
-- be the thing that decides that.
UPDATE document_vault v
   SET doc_type_ref_id = dr.ref_id
  FROM dictionary_ref dr
 WHERE v.doc_type_ref_id IS NULL
   AND v.doc_type IS NOT NULL
   AND dr.kind = 'DOCUMENT_TYPE'
   AND dr.code = upper(btrim(v.doc_type));

-- DOWN
-- The columns and indexes are additive. Deleting the registry rows would orphan
-- the references, so the DOWN drops the columns first and leaves the rows —
-- a retired kind costs one unused tab in the gear modal.
--
--   DROP INDEX IF EXISTS ix_vault_client;
--   DROP INDEX IF EXISTS ix_vault_doc_type;
--   -- DESTRUCTIVE: loses the typed filing on every document uploaded since.
--   ALTER TABLE document_vault
--     DROP COLUMN IF EXISTS uploaded_by,
--     DROP COLUMN IF EXISTS original_name,
--     DROP COLUMN IF EXISTS client_id,
--     DROP COLUMN IF EXISTS doc_type_ref_id;
--   DELETE FROM dictionary_ref WHERE kind = 'DOCUMENT_TYPE' AND is_system;
