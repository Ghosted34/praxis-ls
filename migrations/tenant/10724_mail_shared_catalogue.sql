-- ============================================================================
-- TENANT DB — 10724 The shared-mailbox catalogue.
--
-- A tenant does not invent its team addresses from nothing. A freight forwarder
-- runs on a known set, and several of them already have ERP modules waiting to
-- be wired to them — website enquiries have `contact_enquiry`, job applications
-- have `vacancy` and `talent_pool`, supplier mail has `purchase_order`.
--
-- So the catalogue is seeded rather than free-form-only. A seeded entry gives a
-- later feature something stable to address ("route website enquiries to
-- whichever mailbox fulfils INFO") without a per-tenant conversation about what
-- that mailbox is called. Free-form remains available, because no catalogue
-- survives contact with a real company.
--
-- ── WHY SEVEN AND NOT TWELVE ────────────────────────────────────────────────
--
-- The wider list was reviewed and deliberately collapsed:
--
--   · documents@ and customs@ fold into OPERATIONS. In this business the same
--     desk chases the bill of lading and the customs declaration; splitting them
--     creates two inboxes one person watches.
--   · fleet@ and warehouse@ fold into OPERATIONS for the same reason.
--   · careers@ folds into HR — the people who read applications are the people
--     who read staff mail.
--   · accounts@ folds into PROCUREMENT: supplier invoices arrive alongside the
--     purchase orders they belong to, and the same team reconciles them.
--   · claims@ is not seeded. Cargo claims are rare enough that a tenant who
--     needs one can add it free-form.
--
-- BILLING stays separate from PROCUREMENT on purpose: money going out to
-- suppliers and money coming in from clients are different teams with different
-- mail, and merging them is the kind of decision that should be made on
-- purpose rather than by omission.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mail_shared_catalogue (
  catalogue_key        text PRIMARY KEY,
  label_en             text NOT NULL,
  label_fr             text NOT NULL,
  suggested_local_part text NOT NULL,      -- 'operations' → operations@<domain>
  description_en       text,
  description_fr       text,
  department           text,               -- matches employee.department where it can
  feeds                text[] NOT NULL DEFAULT '{}',  -- ERP areas this mailbox serves
  sort_order           integer NOT NULL DEFAULT 100,
  is_system            boolean NOT NULL DEFAULT false,  -- seeded: editable, not deletable
  is_enabled           boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mail_shared_catalogue_updated') THEN
    CREATE TRIGGER trg_mail_shared_catalogue_updated
      BEFORE UPDATE ON mail_shared_catalogue
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

INSERT INTO mail_shared_catalogue
  (catalogue_key, label_en, label_fr, suggested_local_part, description_en, description_fr, department, feeds, sort_order, is_system)
VALUES
  ('OPERATIONS', 'Operations', 'Exploitation', 'operations',
   'Carriers, agents and shipment coordination, plus transport documents (BL, AWB, POD), customs and transit correspondence, fleet and warehouse.',
   'Transporteurs, agents et coordination des expéditions, ainsi que les documents de transport (BL, LTA, preuve de livraison), la correspondance douane et transit, la flotte et l''entrepôt.',
   'Operations', ARRAY['dossier','milestone','transit_order','delivery_note','document_vault','fleet','wms'], 10, true),

  ('BILLING', 'Billing', 'Facturation', 'billing',
   'Invoices and statements going out, and client questions about what they owe.',
   'Factures et relevés sortants, et questions des clients sur leurs soldes.',
   'Finance', ARRAY['invoice','receipt','receivable','statement'], 20, true),

  ('SALES', 'Sales', 'Commercial', 'sales',
   'Requests for quotation, proposals and prospects.',
   'Demandes de cotation, propositions et prospects.',
   'Commercial', ARRAY['lead','opportunity','quotation','proposal','quote_request'], 30, true),

  ('SUPPORT', 'Customer Support', 'Service client', 'support',
   'Client service and complaints.',
   'Service client et réclamations.',
   'Customer Support', ARRAY['q_ticket','client_message'], 40, true),

  ('PROCUREMENT', 'Procurement & Accounts', 'Achats et comptabilité fournisseurs', 'procurement',
   'Supplier onboarding, purchase orders and requests for quotation going out, plus supplier invoices and payment advice coming in.',
   'Référencement fournisseurs, bons de commande et demandes de prix sortants, factures fournisseurs et avis de paiement entrants.',
   'Procurement', ARRAY['purchase_order','purchase_request','supplier_master','supplier_invoice','payment'], 50, true),

  ('HR', 'Human Resources', 'Ressources humaines', 'hr',
   'Staff matters and payroll queries, and job applications with their CVs.',
   'Questions du personnel et de la paie, candidatures et CV.',
   'Human Resources', ARRAY['employee','payroll','leave','vacancy','talent_pool','hr_contract'], 60, true),

  ('INFO', 'General Enquiries', 'Renseignements généraux', 'info',
   'The website contact form and anything addressed to the company rather than a person.',
   'Le formulaire de contact du site et tout courrier adressé à l''entreprise plutôt qu''à une personne.',
   NULL, ARRAY['contact_enquiry','inbound_intake','partnership_request'], 70, true)
ON CONFLICT (catalogue_key) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_connection_catalogue_fk') THEN
    ALTER TABLE email_connection
      ADD CONSTRAINT email_connection_catalogue_fk
      FOREIGN KEY (catalogue_key) REFERENCES mail_shared_catalogue(catalogue_key);
  END IF;
END $$;

-- One live mailbox may fulfil a given catalogue slot. Two operations@ addresses
-- is a configuration mistake, not a feature — the send-point router in 10726
-- would have no way to choose between them.
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_connection_catalogue_live
  ON email_connection (catalogue_key)
  WHERE catalogue_key IS NOT NULL AND status <> 'ARCHIVED';

-- DOWN
--   DROP INDEX IF EXISTS ux_email_connection_catalogue_live;
--   ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS email_connection_catalogue_fk;
--   DROP TRIGGER IF EXISTS trg_mail_shared_catalogue_updated ON mail_shared_catalogue;
--   -- DESTRUCTIVE: drops the catalogue and therefore every tenant-authored entry
--   -- added beyond the seven seeded ones. email_connection.catalogue_key values
--   -- survive as free text until 10723's down runs.
--   DROP TABLE IF EXISTS mail_shared_catalogue;
