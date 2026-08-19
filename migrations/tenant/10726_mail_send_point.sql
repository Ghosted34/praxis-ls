-- ============================================================================
-- TENANT DB — 10726 The send-point registry: every place the product sends mail,
-- and which address each one goes out from.
--
-- ── WHAT WAS THERE, AND WHY IT WAS NOT ENOUGH ───────────────────────────────
--
-- `email_section_binding` (0523) maps a "section" to one `email_identity`, and
-- `email.service.resolveMail` falls back identity → tenant SMTP → the Praxis
-- platform sender → env. The bones are right. Three things were missing:
--
--   1. The four sections are hard-coded in the frontend, so the list of things
--      an administrator can route is a list somebody typed into a React file.
--   2. Nothing anywhere says WHICH parts of the product use which section. An
--      administrator configuring "DOCUMENTS" has to already know what that
--      means to be able to use the screen.
--   3. `UNIQUE (section_key)` means a section resolves to exactly one sender for
--      the whole tenant. A group with two operating companies cannot send
--      company A's invoices from A's address and company B's from B's.
--
-- This migration turns the four sections into a declared registry of real send
-- points, gives each binding an optional corporate entity, and keeps the
-- fallback chain exactly as it is.
--
-- ── is_wired IS THE HONESTY COLUMN ──────────────────────────────────────────
--
-- Some send points are called by code today; others are declared because the
-- module exists and will mail from it. A configuration screen that lists twenty
-- routable events when only eight of them ever send is a screen that lies, and
-- the administrator finds out when a test message never arrives. `is_wired`
-- lets the UI say "not yet used by the product" next to the ones that are not,
-- and a later PR flips the flag in the same commit that wires the caller.
--
-- ── THE FALLBACK IS NOT CHANGED ─────────────────────────────────────────────
--
-- Resolution stays: send-point binding for this entity → send-point binding for
-- the tenant → the legacy purpose identity → the tenant's shared SMTP → the
-- Praxis platform fallback → env. This adds two more specific steps at the top;
-- it removes nothing. In particular the deliverability guard in email.service
-- (a tenant-domain From must never go out through the deploy relay) is
-- untouched, because that is about transport, not routing.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mail_send_point (
  send_point_key   text PRIMARY KEY,
  module_key       text,
  group_key        text NOT NULL,          -- how the admin screen groups the rows
  label_en         text NOT NULL,
  label_fr         text NOT NULL,
  description_en   text,
  description_fr   text,
  legacy_purpose   text,                   -- the email_identity purpose this used to resolve through
  default_catalogue_key text REFERENCES mail_shared_catalogue(catalogue_key),
  is_wired         boolean NOT NULL DEFAULT false,
  is_system        boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 100,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_send_point_binding (
  mail_send_point_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_point_key      text NOT NULL REFERENCES mail_send_point(send_point_key) ON DELETE CASCADE,
  entity_id           uuid,                -- NULL = the tenant-wide default for this send point
  email_identity_id   uuid REFERENCES email_identity(email_identity_id) ON DELETE CASCADE,
  email_connection_id uuid REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  created_by          uuid REFERENCES app_user(user_id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_send_point_binding_target
    CHECK (email_identity_id IS NOT NULL OR email_connection_id IS NOT NULL)
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = current_schema() AND table_name = 'corporate_entity')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mail_send_point_binding_entity_fk') THEN
    ALTER TABLE mail_send_point_binding
      ADD CONSTRAINT mail_send_point_binding_entity_fk
      FOREIGN KEY (entity_id) REFERENCES corporate_entity(entity_id) ON DELETE CASCADE;
  END IF;
END $$;

-- One binding per (send point, entity), where "no entity" is itself a slot.
-- The zero uuid stands in for NULL because a plain unique index treats NULLs as
-- distinct, which would let a send point collect any number of tenant defaults.
CREATE UNIQUE INDEX IF NOT EXISTS ux_send_point_binding_scope
  ON mail_send_point_binding (send_point_key, COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS ix_send_point_binding_identity
  ON mail_send_point_binding (email_identity_id) WHERE email_identity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_send_point_binding_connection
  ON mail_send_point_binding (email_connection_id) WHERE email_connection_id IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mail_send_point_updated') THEN
    CREATE TRIGGER trg_mail_send_point_updated BEFORE UPDATE ON mail_send_point
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mail_send_point_binding_updated') THEN
    CREATE TRIGGER trg_mail_send_point_binding_updated BEFORE UPDATE ON mail_send_point_binding
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── The registry ────────────────────────────────────────────────────────────
-- is_wired = true means a caller in src/ sends through this today. The eight
-- true rows below were read off the code, not guessed:
--   auth.*          src/modules/security/app_user/app_user.service.js
--   portal.invite   src/modules/portal_auth/portal_auth.service.js
--   notification.*  src/modules/notification/notification.service.js
--   document.share  src/modules/documents/template/template.service.js
--   intake.reply    src/modules/sales/inbound_intake/inbound_intake.service.js
--   campaign.send   src/modules/sales/marketing_campaign/marketing_campaign.service.js
--   system.test     src/modules/smartcomm/smartcomm.config.service.js
INSERT INTO mail_send_point
  (send_point_key, module_key, group_key, label_en, label_fr, description_en, description_fr, legacy_purpose, default_catalogue_key, is_wired, sort_order)
VALUES
  ('auth.otp',              'MOD-67', 'SECURITY',   'Sign-in code',            'Code de connexion',         'One-time codes for two-factor sign-in.', 'Codes à usage unique pour la connexion à deux facteurs.', 'NOTIFICATIONS', NULL,          true,  10),
  ('auth.password_reset',   'MOD-67', 'SECURITY',   'Password reset',          'Réinitialisation du mot de passe', 'The reset link a user asks for when locked out.', 'Le lien de réinitialisation demandé par un utilisateur bloqué.', 'NOTIFICATIONS', NULL, true,  20),
  ('portal.invite',         'MOD-63', 'SECURITY',   'Client portal invitation','Invitation au portail client','Invites a client contact to the portal.', 'Invite un contact client à rejoindre le portail.', 'NOTIFICATIONS', 'SUPPORT',    true,  30),
  ('notification.alert',    'MOD-70', 'SYSTEM',     'Notification alert',      'Alerte de notification',    'A single in-app notification also sent by email.', 'Une notification de l''application envoyée aussi par courriel.', 'NOTIFICATIONS', NULL, true,  40),
  ('notification.security', 'MOD-67', 'SECURITY',   'Security notification',   'Notification de sécurité',  'Security-category alerts, which email unconditionally.', 'Alertes de sécurité, envoyées sans condition.', 'NOTIFICATIONS', NULL, true,  50),
  ('document.share',        'MOD-64', 'DOCUMENTS',  'Document sent to a party','Document envoyé à un tiers','Any generated document emailed from its record.', 'Tout document généré et envoyé depuis sa fiche.', 'DOCUMENTS', 'OPERATIONS', true,  60),
  ('intake.reply',          'MOD-25', 'SALES',      'Enquiry reply',           'Réponse à une demande',     'The answer to a website contact enquiry.', 'La réponse à une demande via le formulaire de contact.', 'SUPPORT', 'INFO',        true,  70),
  ('campaign.send',         'MOD-24', 'SALES',      'Marketing campaign',      'Campagne marketing',        'Bulk campaign mail.', 'Envoi groupé de campagne.', 'NOTIFICATIONS', 'SALES',           true,  80),
  ('system.test',           'MOD-70', 'SYSTEM',     'Configuration test',      'Test de configuration',     'The test message the setup wizard sends to prove a mailbox works.', 'Le message de test envoyé par l''assistant de configuration.', 'NOTIFICATIONS', NULL, true, 90),

  ('invoice.issued',        'MOD-46', 'FINANCE',    'Invoice issued',          'Facture émise',             'A final invoice sent to a client.', 'Une facture définitive envoyée à un client.', 'BILLING', 'BILLING',   false, 100),
  ('proforma.issued',       'MOD-45', 'FINANCE',    'Proforma issued',         'Facture proforma émise',    'A proforma sent to a client.', 'Une facture proforma envoyée à un client.', 'BILLING', 'BILLING',   false, 110),
  ('credit_note.issued',    'MOD-46', 'FINANCE',    'Credit note issued',      'Avoir émis',                'A credit note sent to a client.', 'Un avoir envoyé à un client.', 'BILLING', 'BILLING',                   false, 120),
  ('receipt.issued',        'MOD-47', 'FINANCE',    'Payment receipt',         'Reçu de paiement',          'Acknowledgement that a payment was received.', 'Accusé de réception d''un paiement.', 'BILLING', 'BILLING',    false, 130),
  ('statement.sent',        'MOD-47', 'FINANCE',    'Account statement',       'Relevé de compte',          'A periodic statement of what a client owes.', 'Un relevé périodique des soldes d''un client.', 'BILLING', 'BILLING', false, 140),
  ('quotation.sent',        'MOD-27', 'SALES',      'Quotation sent',          'Cotation envoyée',          'A quotation sent to a prospect or client.', 'Une cotation envoyée à un prospect ou un client.', 'DOCUMENTS', 'SALES',  false, 150),
  ('proposal.shared',       'MOD-23', 'SALES',      'Proposal shared',         'Proposition partagée',      'A commercial proposal shared by link.', 'Une proposition commerciale partagée par lien.', 'DOCUMENTS', 'SALES',    false, 160),
  ('purchase_order.sent',   'MOD-55', 'PROCUREMENT','Purchase order sent',     'Bon de commande envoyé',    'A purchase order sent to a supplier.', 'Un bon de commande envoyé à un fournisseur.', 'DOCUMENTS', 'PROCUREMENT', false, 170),
  ('delivery_note.sent',    'MOD-32', 'OPERATIONS', 'Delivery note sent',      'Bon de livraison envoyé',   'A delivery note sent to a client or carrier.', 'Un bon de livraison envoyé à un client ou transporteur.', 'DOCUMENTS', 'OPERATIONS', false, 180),
  ('dossier.milestone',     'MOD-31', 'OPERATIONS', 'Shipment status update',  'Mise à jour d''expédition', 'A milestone update sent to the client of a dossier.', 'Une mise à jour d''étape envoyée au client d''un dossier.', 'NOTIFICATIONS', 'OPERATIONS', false, 190),
  ('payslip.sent',          'MOD-16', 'HR',         'Payslip',                 'Bulletin de paie',          'A payslip sent to an employee.', 'Un bulletin de paie envoyé à un employé.', 'DOCUMENTS', 'HR',        false, 200),
  ('contract.sent',         'MOD-12', 'HR',         'Employment contract',     'Contrat de travail',        'A contract sent to an employee or candidate.', 'Un contrat envoyé à un employé ou candidat.', 'DOCUMENTS', 'HR', false, 210),
  ('recruitment.reply',     'MOD-11', 'HR',         'Candidate correspondence','Correspondance candidat',   'Replies to job applicants.', 'Réponses aux candidats.', 'NOTIFICATIONS', 'HR',                          false, 220)
ON CONFLICT (send_point_key) DO NOTHING;

-- ── Carry today's routing across, exactly ───────────────────────────────────
-- Every existing section binding becomes a tenant-wide binding on each send
-- point that used to resolve through that purpose. Nothing changes about where
-- a message goes; the same decision is simply now expressed per send point, so
-- it can be varied per send point from here on.
INSERT INTO mail_send_point_binding (send_point_key, entity_id, email_identity_id)
SELECT sp.send_point_key, NULL, b.email_identity_id
  FROM email_section_binding b
  JOIN mail_send_point sp ON sp.legacy_purpose = b.section_key
 WHERE NOT EXISTS (
   SELECT 1 FROM mail_send_point_binding x
    WHERE x.send_point_key = sp.send_point_key AND x.entity_id IS NULL)
ON CONFLICT (send_point_key, COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

COMMENT ON TABLE mail_send_point IS
  'Every place the product sends mail. Rows are seeded, not user-created: a send point exists because code sends from it (is_wired) or will. Administrators bind them to senders, they do not invent them.';
COMMENT ON COLUMN mail_send_point.is_wired IS
  'True when a caller in src/ actually sends through this send point today. False rows are declared for routing but nothing sends yet, and the UI must say so rather than implying a working route.';
COMMENT ON COLUMN mail_send_point_binding.entity_id IS
  'NULL is the tenant-wide binding. A row with an entity overrides it for that operating company only, so a group can send each company''s invoices from its own address.';

-- DOWN
--   DROP INDEX IF EXISTS ix_send_point_binding_connection;
--   DROP INDEX IF EXISTS ix_send_point_binding_identity;
--   DROP INDEX IF EXISTS ux_send_point_binding_scope;
--   DROP TRIGGER IF EXISTS trg_mail_send_point_binding_updated ON mail_send_point_binding;
--   DROP TRIGGER IF EXISTS trg_mail_send_point_updated ON mail_send_point;
--   -- DESTRUCTIVE: drops every routing decision made since the migration. The
--   -- original email_section_binding rows are NOT deleted by this migration, so
--   -- resolution falls back to them intact — but any per-send-point or
--   -- per-entity routing configured afterwards is lost and cannot be inferred.
--   DROP TABLE IF EXISTS mail_send_point_binding;
--   DROP TABLE IF EXISTS mail_send_point;
