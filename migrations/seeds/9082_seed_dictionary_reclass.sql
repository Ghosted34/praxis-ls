-- ============================================================================
-- SEED (per tenant schema) — 9082 dictionary reclassification and mode split.
--
-- This is the company's own line-by-line audit of all 177 catalogue rows,
-- applied. It supersedes the classification 9080 authored and 9081 corrected.
--
-- ── THE ONE IDEA BEHIND ALL OF IT ──────────────────────────────────────────
--
-- A service does not have an accounting nature. A service DELIVERED IN A
-- PARTICULAR WAY has one. "Transportation" is revenue when our own truck moves
-- the box, a disbursement when the shipping line's last-mile service moves it
-- and we merely advance and re-bill the carrier's charge, and an expense when
-- we buy the movement in on our own purchase order. Same work, three different
-- fates in the ledger. One row cannot carry three fates: is_disbursement is a
-- boolean, posting_rule.applies_context is fixed per rule, and the OHADA
-- treatment (4731 clearing versus 706 revenue versus a class-6 charge) is
-- decided by the row, not by the person filling in the invoice.
--
-- So the catalogue carries SIBLINGS: one row per fulfilment mode, sharing a
-- base name, distinguished by a qualifier and by the code letter. The operator
-- picks the mode when they pick the line, and the accounting follows without
-- anyone having to remember a rule.
--
-- ── NAMING, AND WHY THE QUALIFIER IS SAFE TO SHOW A CLIENT ─────────────────
--
--   REVENUE       base label, no qualifier         "Transportation"
--   DISBURSEMENT  "— Client Account"               "Transportation — Client Account"
--                 FR "— Pour Compte Client"
--   EXPENSE       "— Own Cost"                     "Transportation — Own Cost"
--                 FR "— Charge Propre"
--   ASSET         "— Deposit"                      "Bank Caution — Deposit"
--                 FR "— Dépôt"
--
-- Nothing in this vocabulary says subcontracted, third-party, or outsourced.
-- "Pour compte du client" is the standard OHADA phrase for a débours and is
-- the correct thing for a client to read: it is the justification for
-- re-billing the supplier's VAT-inclusive amount transparently rather than
-- retaining it (disbursement_vat_transparent). "Own Cost" only ever appears on
-- a purchase order or an internal costing sheet and never reaches a client.
-- The commercial arrangement behind a line lives in `description`, which is an
-- internal field.
--
-- Where a base name was already unambiguous the pre-existing row keeps it
-- unqualified and only the NEW sibling is qualified, so an operator who has
-- been picking "Truck Rental" for two years still finds "Truck Rental".
--
-- ── WHAT THIS REVERSES, DELIBERATELY ───────────────────────────────────────
--
-- 9081 moved seven customs lines out of disbursement into REVENUE (#D028→#R014
-- and friends; the direction was still spelt 'DEBOURS' when it did so),
-- arguing they are the forwarder's own fee rather than money advanced. The
-- company has ruled the other way and they go back to disbursement here. That
-- is not a regression: the forwarder's margin on those files is captured
-- explicitly by #R001 Commission on Disbursements and #R010 Service Charges,
-- both of which the audit confirmed as correct. Booking the customs payment as
-- revenue AND charging a commission on it would count the same margin twice.
--
-- 9081's other move — EMBASSY_CAUTION #D045 → #A003 — is kept, but the row is
-- split (below), because the company holds cautions two different ways.
--
-- ── THE CAUTIONS ───────────────────────────────────────────────────────────
--
-- Bank Caution, Permanent Deposit Fees and Embassy Caution each described two
-- unrelated transactions under one name:
--
--   we lodge our own money as a guarantee   -> refundable, class-2 deposit
--                                              (275), it comes back to us
--   the client pays a fee to use a caution   -> pure pass-through, 4731,
--   somebody else has already lodged            nothing of ours is at risk
--
-- The second is what the company does most of the time and it is not an asset
-- at all. Rather than reclassify and lose the ability to record the first, each
-- becomes two rows.
--
-- ── ORDERING ───────────────────────────────────────────────────────────────
-- Runs after 0640 (columns are is_disbursement / direction 'DISBURSEMENT') and
-- after 9080 + 9081. Idempotent: every write is keyed on a code and guarded, so
-- re-running changes nothing.
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM dictionary_item WHERE code = '#R001') THEN
    RAISE NOTICE '9082 skipped — 9080 catalogue not present in this schema';
    RETURN;
  END IF;
END $$;

-- ── Tax references, resolved once ───────────────────────────────────────────
CREATE TEMP TABLE _rc_tax (name text PRIMARY KEY, tax_code_id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO _rc_tax (name, tax_code_id)
SELECT DISTINCT ON (tc.code::text) tc.code::text, tc.tax_code_id
  FROM tax_code tc
  JOIN tax_jurisdiction tj ON tj.jurisdiction_id = tc.jurisdiction_id
 WHERE tj.country_code = 'CM'
   AND tc.code IN ('TVA_STD','TVA_INPUT_PURCH','TVA_INPUT_TRANSPORT')
 ORDER BY tc.code::text, tc.effective_from DESC
ON CONFLICT (name) DO NOTHING;

-- ══ 1. RENAMES ═════════════════════════════════════════════════════════════
-- Applied only where the row still holds the value 9080/9081 wrote, so a
-- tenant who has already edited a label by hand is never overwritten.
CREATE TEMP TABLE _rc_rename (
  code    text PRIMARY KEY,
  old_en  text NOT NULL,
  new_fr  text NOT NULL,
  new_en  text NOT NULL,
  descr   text
) ON COMMIT DROP;

INSERT INTO _rc_rename (code, old_en, new_fr, new_en, descr) VALUES
 -- The caution trio: the surviving ASSET row is now explicitly the deposit we
 -- fund ourselves, so it cannot be confused with the pass-through sibling.
 ('#A001','Bank Caution','Caution bancaire — Dépôt','Bank Caution — Deposit',
  'Caution que NOUS déposons auprès de la banque sur nos propres fonds : actif remboursable (275), pas une charge. Bank guarantee WE fund ourselves — a refundable class-2 deposit, not a cost. Use the "Client Account" sibling when the client is merely paying to use a caution already lodged by a third party.'),
 ('#A002','Permanent Deposit Fees (PDF)','Frais sur caution permanente (PDF) — Dépôt','Permanent Deposit Fees (PDF) — Deposit',
  'Caution permanente que NOUS déposons auprès de la compagnie ou du port : actif remboursable. Standing deposit WE lodge with the carrier or port, refundable to us.'),
 ('#A003','Embassy Caution','Caution ambassade — Dépôt','Embassy Caution — Deposit',
  'Caution ambassade déposée sur nos propres fonds, remboursable. Embassy caution funded by us and refundable to us.'),
 -- Disambiguated from #D098 Port Storage, which is a different charge from a
 -- different provider and was being picked by mistake.
 ('#R011','Storage per Day','Magasinage entrepôt (par jour)','Warehouse Storage per Day',
  'Magasinage dans NOTRE entrepôt, facturé au jour. Storage in OUR warehouse, billed per day. Distinct from #D098 Port Storage, which is the terminal''s charge.'),
 -- "Computers" named one item on a shelf; the line is used for the whole
 -- category of IT hardware.
 ('#E004','Computers','Matériel informatique','IT Equipment & Hardware',
  'Ordinateurs, portables, serveurs, périphériques et matériel réseau. Computers, laptops, servers, peripherals and network hardware.'),
 -- The transportation line the catalogue always had, under a name that
 -- advertised the sourcing and hid it from anyone searching "transportation".
 ('#D115','Third-party Trucking','Transport — Pour compte client','Transportation — Client Account',
  'Transport routier exécuté par un tiers ou par la compagnie maritime (dernier kilomètre), avancé puis refacturé au client à l''identique. Road movement performed by a carrier or vendor, advanced and re-billed to the client at cost. Sibling rows: revenue when our own fleet moves it, own-cost when we buy the movement in on our own PO.')
ON CONFLICT (code) DO NOTHING;

UPDATE dictionary_item d
   SET label_fr = r.new_fr, label_en = r.new_en,
       description = COALESCE(r.descr, d.description)
  FROM _rc_rename r
 WHERE d.code = r.code AND d.label_en = r.old_en;

-- ══ 2. STRAIGHT MOVES ══════════════════════════════════════════════════════
-- The direction changes, so the code letter must change with it — a #R code on
-- a disbursement is exactly the drift this whole exercise exists to remove.
-- The code is a human key referenced in exports and conversation, so the old
-- value is preserved in `description` rather than silently dropped.
CREATE TEMP TABLE _rc_move (
  old_code  text PRIMARY KEY,
  new_code  text NOT NULL,
  direction text NOT NULL,
  account   text                       -- NULL for DISBURSEMENT (4731 is fixed)
) ON COMMIT DROP;

INSERT INTO _rc_move (old_code, new_code, direction, account) VALUES
 -- Revenue -> disbursement. The seven 9081 lines the company has ruled back,
 -- plus two more the audit caught: extra legal work and the DI fee are both
 -- paid to a third party on the client's behalf.
 ('#R003','#D130','DISBURSEMENT',NULL),   -- Extra Legal Work
 ('#R005','#D131','DISBURSEMENT',NULL),   -- Import Declaration Fee
 ('#R014','#D132','DISBURSEMENT',NULL),   -- Customs Clearance
 ('#R015','#D133','DISBURSEMENT',NULL),   -- Customs Formalities
 ('#R016','#D134','DISBURSEMENT',NULL),   -- Customs Liquidation
 ('#R017','#D135','DISBURSEMENT',NULL),   -- Customs Declaration Processing
 ('#R018','#D136','DISBURSEMENT',NULL),   -- Import Formalities
 ('#R019','#D137','DISBURSEMENT',NULL),   -- Port Exit Formalities
 ('#R020','#D138','DISBURSEMENT',NULL),   -- Final Destination Clearance
 -- Expense -> disbursement. Opening an account for a client's file is the
 -- client's cost advanced, never ours.
 ('#E001','#D146','DISBURSEMENT',NULL)   -- Account Opening
ON CONFLICT (old_code) DO NOTHING;

UPDATE dictionary_item d
   SET code        = m.new_code,
       direction   = m.direction,
       category    = 'disbursement',
       is_disbursement = true,
       disbursement_vat_transparent = true,
       description = d.description || ' [Reclassé ' || m.old_code || ' → ' || m.new_code
                     || ' par audit interne. Reclassified from ' || m.old_code || ' by internal audit.]'
  FROM _rc_move m
 WHERE d.code = m.old_code;

-- Rebuild their posting rules: the old sale rule credited class 7 and carried
-- output VAT, which is precisely what must stop.
--
-- What is lost is account determination that is now WRONG — a sale rule
-- crediting 706 with output VAT on a line the company has ruled is a
-- pass-through. Leaving it would post client money to turnover. §4 rebuilds
-- the correct 4731 pair in the same transaction, and §5 fails the migration if
-- any item is left ruleless, so the window never closes on a broken state.
-- Posted journal entries are untouched: they carry their own account codes and
-- do not consult posting_rule after the fact.
--
-- DESTRUCTIVE: drops the posting rules of the 10 reclassified items only, rebuilt correctly in §4 below.
DELETE FROM posting_rule pr
 USING dictionary_item d, _rc_move m
 WHERE pr.dictionary_item_id = d.dictionary_item_id AND d.code = m.new_code;

-- ══ 3. SIBLINGS ════════════════════════════════════════════════════════════
-- parent_code supplies everything the sibling inherits — subcategory, unit,
-- applicability, service-type wiring, compliance answers — so the modes of one
-- service stay in step and only what MUST differ is stated here.
CREATE TEMP TABLE _rc_new (
  new_code    text PRIMARY KEY,
  parent_code text NOT NULL,
  direction   text NOT NULL,
  label_fr    text NOT NULL,
  label_en    text NOT NULL,
  account     text,                     -- credit for REVENUE, debit for EXPENSE/ASSET
  vat         text,                     -- STD | STD_T | NONE
  descr       text NOT NULL
) ON COMMIT DROP;

-- 3a. The cautions' pass-through siblings — what the company actually does
-- most of the time, and the reason the ASSET-only classification was wrong.
INSERT INTO _rc_new VALUES
 ('#D127','#A001','DISBURSEMENT','Caution bancaire — Pour compte client','Bank Caution — Client Account',NULL,'NONE',
  'Le client règle des frais pour utiliser une caution bancaire DÉJÀ déposée par un tiers. Aucun fonds propre engagé : simple débours refacturé à l''identique. The client pays a fee to use a bank caution ALREADY lodged by a third party. None of our money is at risk, so this is a pass-through, not a deposit.'),
 ('#D128','#A002','DISBURSEMENT','Frais sur caution permanente (PDF) — Pour compte client','Permanent Deposit Fees (PDF) — Client Account',NULL,'NONE',
  'Frais payés pour bénéficier d''une caution permanente détenue par un tiers, avancés puis refacturés. Fee paid to use a third party''s standing deposit, advanced and re-billed at cost.'),
 ('#D129','#A003','DISBURSEMENT','Caution ambassade — Pour compte client','Embassy Caution — Client Account',NULL,'NONE',
  'Frais réglés pour utiliser une caution ambassade déjà déposée par un tiers. Fee paid to use an embassy caution already lodged by a third party.')
ON CONFLICT (new_code) DO NOTHING;

-- 3b. Warehousing, three ways. Our warehouse (revenue), somebody else's
-- warehouse re-billed at cost (disbursement), or capacity we buy in on our own
-- PO (expense) — the case that arises every time our own warehouse is full.
INSERT INTO _rc_new VALUES
 ('#D139','#R006','DISBURSEMENT','Gestion des stocks — Pour compte client','Inventory Management — Client Account',NULL,'NONE',
  'Gestion des stocks assurée par un prestataire, avancée et refacturée à l''identique. Inventory management performed by a vendor, advanced and re-billed at cost.'),
 ('#E037','#R006','EXPENSE','Gestion des stocks — Charge propre','Inventory Management — Own Cost','6211','STD',
  'Gestion des stocks achetée sur notre propre bon de commande, refacturée avec marge via la ligne de revenu. Inventory management bought in on our own PO — the client is billed on the revenue sibling with our margin.'),
 ('#D140','#R007','DISBURSEMENT','Arrimage et saisissage — Pour compte client','Lashing — Client Account',NULL,'NONE',
  'Arrimage exécuté par un tiers, avancé et refacturé à l''identique. Lashing performed by a vendor, advanced and re-billed at cost.'),
 ('#E038','#R007','EXPENSE','Arrimage et saisissage — Charge propre','Lashing — Own Cost','6211','STD',
  'Arrimage acheté sur notre propre bon de commande. Lashing bought in on our own PO.'),
 ('#D141','#R008','DISBURSEMENT','Préparation de commandes — Pour compte client','Order Picking — Client Account',NULL,'NONE',
  'Préparation de commandes exécutée par un tiers, avancée et refacturée. Order picking performed by a vendor, advanced and re-billed at cost.'),
 ('#E039','#R008','EXPENSE','Préparation de commandes — Charge propre','Order Picking — Own Cost','6211','STD',
  'Préparation de commandes achetée sur notre propre bon de commande. Order picking bought in on our own PO.'),
 ('#D142','#R009','DISBURSEMENT','Reconditionnement — Pour compte client','Repackaging — Client Account',NULL,'NONE',
  'Reconditionnement exécuté par un tiers, avancé et refacturé. Repackaging performed by a vendor, advanced and re-billed at cost.'),
 ('#E040','#R009','EXPENSE','Reconditionnement — Charge propre','Repackaging — Own Cost','6211','STD',
  'Reconditionnement acheté sur notre propre bon de commande. Repackaging bought in on our own PO.'),
 ('#D143','#R011','DISBURSEMENT','Magasinage entrepôt — Pour compte client','Warehouse Storage per Day — Client Account',NULL,'NONE',
  'Magasinage dans l''entrepôt d''un tiers, avancé et refacturé à l''identique — le cas courant lorsque notre entrepôt est plein. Storage in a third party''s warehouse, advanced and re-billed at cost — the everyday case when our own warehouse is full.'),
 ('#E041','#R011','EXPENSE','Magasinage entrepôt — Charge propre','Warehouse Storage per Day — Own Cost','6272','STD',
  'Capacité de stockage achetée sur notre propre bon de commande et refacturée avec marge. Storage capacity bought in on our own PO and re-billed with margin.'),
 ('#D144','#R012','DISBURSEMENT','Manutention entrée entrepôt — Pour compte client','Warehouse Handling In — Client Account',NULL,'NONE',
  'Manutention à la réception exécutée par un tiers, avancée et refacturée. Inbound handling performed by a vendor, advanced and re-billed at cost.'),
 ('#E042','#R012','EXPENSE','Manutention entrée entrepôt — Charge propre','Warehouse Handling In — Own Cost','6211','STD',
  'Manutention à la réception achetée sur notre propre bon de commande. Inbound handling bought in on our own PO.'),
 ('#D145','#R013','DISBURSEMENT','Manutention sortie entrepôt — Pour compte client','Warehouse Handling Out — Client Account',NULL,'NONE',
  'Manutention à l''expédition exécutée par un tiers, avancée et refacturée. Outbound handling performed by a vendor, advanced and re-billed at cost.'),
 ('#E043','#R013','EXPENSE','Manutention sortie entrepôt — Charge propre','Warehouse Handling Out — Own Cost','6211','STD',
  'Manutention à l''expédition achetée sur notre propre bon de commande. Outbound handling bought in on our own PO.')
ON CONFLICT (new_code) DO NOTHING;

-- 3c. Transportation, completed. #D115 already held the disbursement mode
-- (renamed in §1); these are the two modes the catalogue never had.
INSERT INTO _rc_new VALUES
 ('#R021','#D115','REVENUE','Transport','Transportation','7063','STD',
  'Transport routier exécuté par NOTRE flotte : prestation vendue, revenu à part entière. Road movement performed by OUR OWN fleet — a service sold, and revenue in full. Also the line to invoice the client on when the movement was bought in on the "Own Cost" sibling, so the margin lands here.'),
 ('#E044','#D115','EXPENSE','Transport — Charge propre','Transportation — Own Cost','6131','STD_T',
  'Transport acheté sur notre propre bon de commande auprès d''un prestataire, puis facturé au client sur la ligne de revenu avec marge. Movement bought in on our own PO and invoiced to the client on the revenue sibling with our margin. Input VAT on transport is recoverable on 4453.')
ON CONFLICT (new_code) DO NOTHING;

-- 3d. The fourteen lines that are ours on one file and the client's on the
-- next. Each keeps its EXPENSE row unqualified and gains the pass-through.
INSERT INTO _rc_new VALUES
 ('#D147','#E002','DISBURSEMENT','Frais bancaires — Pour compte client','Bank Charges — Client Account',NULL,'NONE',
  'Frais bancaires engagés pour le compte du client sur son dossier (transferts, domiciliation), avancés et refacturés. Bank charges incurred on the client''s file and advanced on their behalf, re-billed at cost.'),
 ('#D148','#E005','DISBURSEMENT','Sécurité du convoi — Pour compte client','Convoy Security — Client Account',NULL,'NONE',
  'Sécurité du convoi assurée par un prestataire, avancée et refacturée au client. Convoy security provided by a vendor, advanced and re-billed to the client.'),
 ('#D149','#E006','DISBURSEMENT','Grutage et levage — Pour compte client','Crane and Lifting — Client Account',NULL,'NONE',
  'Grutage assuré par un tiers, avancé et refacturé. Crane and lifting provided by a vendor, advanced and re-billed at cost.'),
 ('#D150','#E007','DISBURSEMENT','Indemnité de route chauffeur — Pour compte client','Driver Allowance — Client Account',NULL,'NONE',
  'Indemnités de route refacturées au client lorsque le transport est à sa charge. Driver road allowances re-billed when the movement is on the client''s account.'),
 ('#D151','#E009','DISBURSEMENT','Négociation douane (facilitation) — Pour compte client','Facility Payment (customs negotiation) — Client Account',NULL,'NONE',
  'Somme réglée à la douane pour le compte du client et refacturée à l''identique. Amount settled with customs on the client''s behalf and re-billed at cost. Justification obligatoire — receipt always required.'),
 ('#D152','#E012','DISBURSEMENT','Suivi GPS et télématique — Pour compte client','GPS and Tracking — Client Account',NULL,'NONE',
  'Suivi GPS facturé par un prestataire pour le dossier du client, avancé et refacturé. GPS tracking billed by a vendor against the client''s file, advanced and re-billed.'),
 ('#D153','#E013','DISBURSEMENT','Saisie du ticket de livraison — Pour compte client','Gate-Pass Fee — Client Account',NULL,'NONE',
  'Frais de ticket de sortie réglés au terminal pour le compte du client. Gate-pass fee settled with the terminal on the client''s behalf.'),
 ('#D154','#E014','DISBURSEMENT','Escorte de colis lourds — Pour compte client','Heavy-lift Escort — Client Account',NULL,'NONE',
  'Escorte assurée par un tiers, avancée et refacturée. Heavy-lift escort provided by a vendor, advanced and re-billed at cost.'),
 ('#D155','#E023','DISBURSEMENT','Surcharge hors gabarit (OOG) — Pour compte client','Out-of-Gauge (OOG) Surcharge — Client Account',NULL,'NONE',
  'Surcharge hors gabarit facturée par la compagnie, avancée et refacturée à l''identique. OOG surcharge levied by the carrier, advanced and re-billed at cost.'),
 ('#D156','#E025','DISBURSEMENT','Transport routier au kilomètre — Pour compte client','Per-km Haulage — Client Account',NULL,'NONE',
  'Transport au kilomètre exécuté par un tiers, avancé et refacturé. Per-km haulage performed by a vendor, advanced and re-billed at cost.'),
 ('#D157','#E031','DISBURSEMENT','Assurance des stocks — Pour compte client','Stock Insurance — Client Account',NULL,'NONE',
  'Prime d''assurance souscrite pour le compte du client sur ses marchandises stockées, avancée et refacturée. Insurance placed on the client''s stored goods on their behalf, advanced and re-billed.'),
 ('#D158','#E032','DISBURSEMENT','Téléphonie — Pour compte client','Telephony — Client Account',NULL,'NONE',
  'Communications engagées pour le compte du client sur son dossier et refacturées. Communications incurred on the client''s file and re-billed.'),
 ('#D159','#E033','DISBURSEMENT','Péages et taxes routières — Pour compte client','Tolls and Road Fees — Client Account',NULL,'NONE',
  'Péages réglés en route pour le compte du client et refacturés à l''identique. Tolls settled en route on the client''s behalf and re-billed at cost.'),
 ('#D160','#E034','DISBURSEMENT','Location de camion — Pour compte client','Truck Rental — Client Account',NULL,'NONE',
  'Camion loué auprès d''un tiers pour le dossier du client, avancé et refacturé. Truck hired from a vendor against the client''s file, advanced and re-billed at cost.')
ON CONFLICT (new_code) DO NOTHING;

-- ── Materialise the siblings ────────────────────────────────────────────────
-- Everything not stated in _rc_new is inherited from the parent, so a later
-- edit to the parent's compliance settings is the obvious thing to mirror
-- rather than a silent divergence.
INSERT INTO dictionary_item (
  code, label_fr, label_en, description, category, direction, subcategory,
  unit_of_measure, applicability_mode, is_disbursement, is_billable, currency,
  provider_kind, proof_source, requires_justification, receipt_requirement,
  disbursement_vat_transparent, varies_by_equipment, is_active)
SELECT
  n.new_code, n.label_fr, n.label_en, n.descr,
  CASE n.direction WHEN 'DISBURSEMENT' THEN 'disbursement'
                   WHEN 'REVENUE' THEN 'service'
                   WHEN 'ASSET' THEN 'asset' ELSE 'overhead' END,
  n.direction, p.subcategory, p.unit_of_measure, p.applicability_mode,
  n.direction = 'DISBURSEMENT', p.is_billable, p.currency,
  -- A pass-through is by definition somebody else's invoice; an own-cost or
  -- own-fleet line is ours, so the provider attribution flips with the mode.
  CASE WHEN n.direction = 'DISBURSEMENT' THEN COALESCE(p.provider_kind,'OTHER') ELSE 'OTHER' END,
  CASE WHEN n.direction = 'DISBURSEMENT' THEN COALESCE(p.proof_source,'THIRD_PARTY_VENDOR')
       WHEN n.direction = 'REVENUE'      THEN 'INTERNAL_SERVICE'
       ELSE 'THIRD_PARTY_VENDOR' END,
  -- Money advanced for someone else always needs its proof.
  n.direction = 'DISBURSEMENT' OR p.requires_justification,
  CASE WHEN n.direction = 'DISBURSEMENT' THEN 'ALWAYS_REQUIRED' ELSE p.receipt_requirement END,
  n.direction = 'DISBURSEMENT', p.varies_by_equipment, true
  FROM _rc_new n
  JOIN dictionary_item p ON p.code = n.parent_code
ON CONFLICT (code) DO NOTHING;

-- Siblings surface wherever the parent surfaces: picking a service type must
-- offer all three modes, or the operator silently loses the one they need.
INSERT INTO service_type_dictionary_item (service_type_id, dictionary_item_id, tier, sort_order)
SELECT st.service_type_id, c.dictionary_item_id, st.tier, st.sort_order
  FROM _rc_new n
  JOIN dictionary_item p ON p.code = n.parent_code
  JOIN dictionary_item c ON c.code = n.new_code
  JOIN service_type_dictionary_item st ON st.dictionary_item_id = p.dictionary_item_id
ON CONFLICT (service_type_id, dictionary_item_id) DO NOTHING;

-- ══ 4. POSTING RULES ═══════════════════════════════════════════════════════
-- For every row this seed created or moved. The NOT EXISTS guard is the
-- idempotency key posting_rule lacks (an item legitimately carries both a sale
-- and a purchase rule, so there is no natural unique constraint).
CREATE TEMP TABLE _rc_rule (code text PRIMARY KEY, direction text NOT NULL, account text, vat text) ON COMMIT DROP;
INSERT INTO _rc_rule SELECT new_code, direction, account, vat FROM _rc_new
ON CONFLICT (code) DO NOTHING;
INSERT INTO _rc_rule SELECT new_code, direction, account, 'NONE' FROM _rc_move
ON CONFLICT (code) DO NOTHING;

-- DISBURSEMENT, purchase leg: the supplier's invoice lands in the client's
-- clearing account, never in a class-6 charge, and carries no tax of ours (§23.5).
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
SELECT d.dictionary_item_id, 'purchase', '4731', '4011', NULL, true
  FROM _rc_rule r JOIN dictionary_item d ON d.code = r.code
 WHERE r.direction = 'DISBURSEMENT'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr WHERE pr.dictionary_item_id = d.dictionary_item_id AND pr.applies_context = 'purchase')
ON CONFLICT DO NOTHING;

-- DISBURSEMENT, sale leg: re-billed at cost, clearing 4731 back out against
-- the client. Nothing touches class 7, because none of it is revenue.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
SELECT d.dictionary_item_id, 'sale', '4111', '4731', NULL, true
  FROM _rc_rule r JOIN dictionary_item d ON d.code = r.code
 WHERE r.direction = 'DISBURSEMENT'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr WHERE pr.dictionary_item_id = d.dictionary_item_id AND pr.applies_context = 'sale')
ON CONFLICT DO NOTHING;

-- REVENUE: our fee, invoiced with output VAT.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
SELECT d.dictionary_item_id, 'sale', '4111', r.account, t.tax_code_id, false
  FROM _rc_rule r
  JOIN dictionary_item d ON d.code = r.code
  LEFT JOIN _rc_tax t ON t.name = 'TVA_STD'
 WHERE r.direction = 'REVENUE'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr WHERE pr.dictionary_item_id = d.dictionary_item_id AND pr.applies_context = 'sale')
ON CONFLICT DO NOTHING;

-- EXPENSE: our own cost against the supplier, with recoverable input VAT.
-- Transport inputs use TVA_INPUT_TRANSPORT so the recoverable side lands on
-- 4453 rather than 4452.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
SELECT d.dictionary_item_id, 'purchase', r.account, '4011', t.tax_code_id, false
  FROM _rc_rule r
  JOIN dictionary_item d ON d.code = r.code
  LEFT JOIN _rc_tax t ON t.name = CASE r.vat WHEN 'STD_T' THEN 'TVA_INPUT_TRANSPORT'
                                             WHEN 'STD'   THEN 'TVA_INPUT_PURCH' END
 WHERE r.direction = 'EXPENSE'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr WHERE pr.dictionary_item_id = d.dictionary_item_id AND pr.applies_context = 'purchase')
ON CONFLICT DO NOTHING;

-- ══ 5. VERIFY ══════════════════════════════════════════════════════════════
-- The invariant from 0200 (§23.14) is a DEFERRABLE constraint trigger on
-- INSERT only, so it does NOT fire for the moved rows whose rules §2 deleted
-- and §4 rebuilt. Checked explicitly rather than trusted.
DO $$
DECLARE orphan text; n_new int; n_moved int;
BEGIN
  SELECT string_agg(d.code, ', ' ORDER BY d.code) INTO orphan
    FROM dictionary_item d
   WHERE d.code IN (SELECT new_code FROM _rc_new UNION SELECT new_code FROM _rc_move)
     AND NOT EXISTS (SELECT 1 FROM posting_rule pr WHERE pr.dictionary_item_id = d.dictionary_item_id);
  IF orphan IS NOT NULL THEN
    RAISE EXCEPTION '9082: dictionary items left without a posting rule (KB §23.14): %', orphan;
  END IF;

  SELECT count(*) INTO n_new   FROM dictionary_item WHERE code IN (SELECT new_code FROM _rc_new);
  SELECT count(*) INTO n_moved FROM dictionary_item WHERE code IN (SELECT new_code FROM _rc_move);
  IF n_new <> (SELECT count(*) FROM _rc_new) THEN
    RAISE EXCEPTION '9082: expected % sibling rows, found %', (SELECT count(*) FROM _rc_new), n_new;
  END IF;
  IF n_moved <> (SELECT count(*) FROM _rc_move) THEN
    RAISE EXCEPTION '9082: expected % moved rows, found %', (SELECT count(*) FROM _rc_move), n_moved;
  END IF;

  RAISE NOTICE '9082: % siblings created, % rows reclassified, catalogue now % active items',
    n_new, n_moved, (SELECT count(*) FROM dictionary_item WHERE is_active);
END $$;

-- DOWN
-- Reversible while the new rows are unused; one-way the moment anyone quotes or
-- invoices on a sibling. Run the guard first — it tells you which it is.
--
--   SELECT d.code, d.label_en, is_dictionary_item_used(d.dictionary_item_id) AS used
--     FROM dictionary_item d
--    WHERE d.code BETWEEN '#D127' AND '#D160' OR d.code BETWEEN '#E037' AND '#E044'
--       OR d.code = '#R021'
--    ORDER BY used DESC, d.code;
--
-- Any row coming back used = true cannot be deleted: a document references it.
-- RETIRE those instead (retire_dictionary_item, 0641) and delete only the rest.
--
-- 1. The 33 siblings — posting_rule and service_type_dictionary_item both
--    cascade on dictionary_item_id, so one DELETE clears all three tables.
-- DELETE FROM dictionary_item WHERE code IN
--   ('#D127','#D128','#D129','#D139','#D140','#D141','#D142','#D143','#D144','#D145',
--    '#D147','#D148','#D149','#D150','#D151','#D152','#D153','#D154','#D155','#D156',
--    '#D157','#D158','#D159','#D160','#E037','#E038','#E039','#E040','#E041','#E042',
--    '#E043','#E044','#R021');
--
-- 2. The 10 reclassified rows, back to their original codes and directions.
--    Their posting rules must be rebuilt too — §2 deleted the originals, so
--    re-running 9080's rule generation for these codes is the recovery step.
-- UPDATE dictionary_item SET code = v.old_code, direction = v.dir,
--        category = CASE v.dir WHEN 'REVENUE' THEN 'service' ELSE 'overhead' END,
--        is_disbursement = false, disbursement_vat_transparent = false
--   FROM (VALUES ('#D130','#R003','REVENUE'),('#D131','#R005','REVENUE'),
--                ('#D132','#R014','REVENUE'),('#D133','#R015','REVENUE'),
--                ('#D134','#R016','REVENUE'),('#D135','#R017','REVENUE'),
--                ('#D136','#R018','REVENUE'),('#D137','#R019','REVENUE'),
--                ('#D138','#R020','REVENUE'),('#D146','#E001','EXPENSE'))
--        AS v(new_code, old_code, dir)
--  WHERE dictionary_item.code = v.new_code;
--
-- 3. The six renames, back to the labels 9080/9081 wrote.
-- UPDATE dictionary_item SET label_en = v.old_en
--   FROM (VALUES ('#A001','Bank Caution'),('#A002','Permanent Deposit Fees (PDF)'),
--                ('#A003','Embassy Caution'),('#R011','Storage per Day'),
--                ('#E004','Computers'),('#D115','Third-party Trucking'))
--        AS v(code, old_en)
--  WHERE dictionary_item.code = v.code;
--
-- What CANNOT be undone either way: posted journal entries written against a
-- sibling. They carry their own account codes and stay correct, but the
-- classification decision behind them is already in the ledger.
