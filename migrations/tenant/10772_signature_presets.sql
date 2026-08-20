-- ============================================================================
-- TENANT DB — 10772 The signature card catalogue, and the signing-reason list.
--
-- WHY A TABLE AND NOT AN ENUM IN CODE
--
-- signature_preset is the join between the vocabulary the business uses out
-- loud ("Tier 1", "Tier 3") and the two axes the schema actually stores. Both
-- the sender and the signer see the same four cards, rendered from these rows —
-- one catalogue, one component, two audiences. Adding or retiring a card is a
-- row, not a deploy.
--
-- assurance_rank exists so the doc-type ceiling can compare levels without
-- hardcoding an order in three places. WET sits at rank 2, level with AES_OTP:
-- a wet signature that has been printed, signed, scanned and barcode-reconciled
-- carries a verified chain of custody comparable to an email-verified digital
-- one — and in OHADA practice it is what a court expects on a delivery note. So
-- an employment contract with a floor of rank 2 can still be signed by hand,
-- which is correct. (doc/SIGNATURE_ENGINEERING_GUIDE.md §1.3(c))
--
-- Idempotent. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS signature_preset (
  preset_code      text PRIMARY KEY,
  label_en         text NOT NULL,
  label_fr         text NOT NULL,
  blurb_en         text,
  blurb_fr         text,
  assurance_level  text NOT NULL CHECK (assurance_level IN ('SES','AES_OTP','QES','WET')),
  visual_mark      text NOT NULL CHECK (visual_mark IN ('STAMP','DRAWN','PROVIDER','INK')),
  assurance_rank   smallint NOT NULL,
  tier_label       text,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       smallint NOT NULL DEFAULT 0
);

-- Four cards. Stamp and "type your name" are ONE card: the mark they produce is
-- identical, and the only difference — where the signer's name came from — is
-- recorded as document_signature.identity_source, not as a second mark.
--
-- There is deliberately no "upload an image of your signature" card. An
-- uploaded image proves nothing about who uploaded it and invites one scan to
-- be reused indefinitely, which adds evidentiary noise at exactly the point
-- this system exists to add weight.
INSERT INTO signature_preset
  (preset_code, label_en, label_fr, blurb_en, blurb_fr,
   assurance_level, visual_mark, assurance_rank, tier_label, sort_order)
VALUES
  ('STAMP', 'Digital stamp', 'Cachet numérique',
   'Your name, role and the date, applied as a stamp.',
   'Votre nom, fonction et la date, apposés en cachet.',
   'AES_OTP', 'STAMP', 2, '1', 10),
  ('DRAWN', 'Draw your signature', 'Dessiner votre signature',
   'Sign with your finger or your mouse.',
   'Signez avec le doigt ou la souris.',
   'AES_OTP', 'DRAWN', 2, '2', 20),
  ('CERTIFIED', 'Certified signature', 'Signature certifiée',
   'Identity verified by an independent signature provider.',
   'Identité vérifiée par un prestataire de signature indépendant.',
   'QES', 'PROVIDER', 3, '3', 30),
  ('PRINT_SIGN', 'Print and sign by hand', 'Imprimer et signer',
   'Print, sign in ink, and send the scan back.',
   'Imprimez, signez à l''encre, puis renvoyez le scan.',
   'WET', 'INK', 2, '4', 40)
ON CONFLICT (preset_code) DO UPDATE SET
  label_en = EXCLUDED.label_en, label_fr = EXCLUDED.label_fr,
  blurb_en = EXCLUDED.blurb_en, blurb_fr = EXCLUDED.blurb_fr,
  assurance_level = EXCLUDED.assurance_level,
  visual_mark = EXCLUDED.visual_mark,
  assurance_rank = EXCLUDED.assurance_rank,
  tier_label = EXCLUDED.tier_label,
  sort_order = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------------
-- The signing reason — a controlled vocabulary, never free text.
--
-- Printed as the headline of the seal, so it is the sentence a human reads
-- first. It stays a fixed list because free text on a legal seal is a liability
-- field: someone will eventually type something that contradicts the document
-- it sits on, and it will be printed, signed and filed before anyone notices.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signature_reason (
  reason_code  text PRIMARY KEY,
  label_en     text NOT NULL,
  label_fr     text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   smallint NOT NULL DEFAULT 0
);

INSERT INTO signature_reason (reason_code, label_en, label_fr, sort_order) VALUES
  ('APPROVED_DISPATCH', 'Approved for dispatch',  'Approuvé pour expédition',   10),
  ('APPROVED_PAYMENT',  'Approved for payment',   'Approuvé pour paiement',     20),
  ('GOODS_RECEIVED',    'Goods received',         'Marchandises reçues',        30),
  ('REVIEWED_ACCEPTED', 'Reviewed and accepted',  'Examiné et accepté',         40),
  ('ACKNOWLEDGED',      'Acknowledged',           'Accusé de réception',        50)
ON CONFLICT (reason_code) DO UPDATE SET
  label_en = EXCLUDED.label_en, label_fr = EXCLUDED.label_fr,
  sort_order = EXCLUDED.sort_order;

-- document_signature.sign_reason references this list by code. Not a foreign
-- key on purpose: a tenant retiring a reason must not orphan or rewrite the
-- signatures that already carry it. The label is snapshotted into
-- content_payload at signing time for exactly that reason.

COMMENT ON TABLE signature_preset IS
  'The four signature cards. Maps the Tier 1..4 vocabulary onto assurance_level x visual_mark.';
COMMENT ON TABLE signature_reason IS
  'Controlled vocabulary for the signing intent printed on the seal. Never free text.';

-- ============================================================================
-- VERIFY
--   SELECT preset_code, assurance_level, visual_mark, assurance_rank, tier_label
--     FROM signature_preset ORDER BY sort_order;          -- expect 4 rows, tiers 1..4
--   SELECT count(*) FROM signature_reason WHERE is_active; -- expect 5
--
-- DOWN
--   -- Safe to drop: both tables are catalogues, re-seeded from this file. But
--   -- document_signature.preset_code / .sign_reason carry these codes as TEXT
--   -- (deliberately, so retiring a card cannot orphan a signature), and dropping
--   -- the catalogue leaves those codes unresolvable to a label.
--   -- DROP TABLE IF EXISTS signature_reason;
--   -- DROP TABLE IF EXISTS signature_preset;
-- ============================================================================
