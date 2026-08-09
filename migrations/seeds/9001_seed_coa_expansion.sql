-- ============================================================================
-- SEED (per tenant schema) — SYSCOHADA working-plan EXPANSION (MOD-05 support).
--
-- WHY A SEED, NOT A MIGRATION. chart_of_accounts is populated by the 9000-series
-- seeds, and seeds run AFTER every tenant migration (see migrator.js:
-- tenantSchema then tenantSeeds). CoA rows in a tenant migration (e.g. 0630)
-- therefore reference parent_code values that do not exist yet — the FK aborts
-- the whole migration. So this expansion lives here, ordered after
-- 9000_seed_coa.sql, where the 2-digit headings it hangs off already exist.
--
-- WHAT THIS ADDS. The 3-digit groupings and postable 4-digit leaves a Cameroon
-- freight forwarder binds financial-dictionary items to (the account picker in
-- the Financial Dictionary 360). ON CONFLICT DO NOTHING keeps it idempotent and
-- non-clashing with the working subset 9000 already seeded. is_postable=true
-- only on the leaves actually posted to. The exhaustive AUDCIF annex remains a
-- phase-2 data-load task; auto-mint-leaf covers any interim gap.
-- ============================================================================

-- 3-digit groupings (parent = 2-digit heading seeded in 9000) -----------------
INSERT INTO chart_of_accounts (code,parent_code,label_fr,label_en,class,normal_balance,is_postable,requires_analytic) VALUES
  ('218','21','Autres immobilisations incorporelles','Other intangible assets',2,'D',false,false),
  ('245','24','Matériel de transport','Transport equipment',2,'D',false,false),
  ('401','40','Fournisseurs','Suppliers — trade',4,'C',false,false),
  ('408','40','Fournisseurs, factures non parvenues','Suppliers — invoices not received',4,'C',false,false),
  ('409','40','Fournisseurs débiteurs (avances)','Suppliers — advances paid',4,'D',false,false),
  ('411','41','Clients','Customers — trade',4,'D',false,false),
  ('416','41','Clients douteux','Doubtful customers',4,'D',false,false),
  ('418','41','Clients, factures à établir','Customers — invoices to raise',4,'D',false,false),
  ('419','41','Clients créditeurs (avances reçues)','Customers — advances received',4,'C',false,false),
  ('421','42','Personnel, avances et acomptes','Personnel — advances',4,'D',false,false),
  ('431','43','Sécurité sociale','Social security',4,'C',false,false),
  ('441','44','État, impôt sur les bénéfices','State — income tax',4,'C',false,false),
  ('443','44','État, TVA facturée','State — output VAT',4,'C',false,false),
  ('445','44','État, TVA récupérable','State — recoverable VAT',4,'D',false,false),
  ('447','44','État, impôts retenus à la source','State — withholding tax',4,'C',false,false),
  ('471','47','Comptes d''attente','Suspense accounts',4,'D',false,false),
  ('473','47','Comptes de débours / transit','Débours / transit clearing',4,'D',false,false),
  ('521','52','Banques locales','Local banks',5,'D',false,false),
  ('531','53','Chèques postaux','Postal cheques',5,'D',false,false),
  ('538','53','Mobile money','Mobile money',5,'D',false,false),
  ('571','57','Caisse siège social','Cash — head office',5,'D',false,false),
  ('581','58','Régies d''avances','Imprest / cash advances',5,'D',false,false),
  ('601','60','Achats de marchandises','Purchases — goods',6,'D',false,false),
  ('604','60','Achats stockés de matières','Purchases — supplies',6,'D',false,false),
  ('605','60','Autres achats','Other purchases',6,'D',false,false),
  ('611','61','Transports sur achats','Freight-in',6,'D',false,false),
  ('612','61','Transports sur ventes','Freight-out',6,'D',false,false),
  ('613','61','Transports pour le compte de tiers','Transport on behalf of third parties',6,'D',false,false),
  ('616','61','Transport de plis','Courier / document transport',6,'D',false,false),
  ('618','61','Autres frais de transport','Other transport costs',6,'D',false,false),
  ('621','62','Sous-traitance générale','General subcontracting',6,'D',false,false),
  ('622','62','Locations et charges locatives','Rentals & leasing',6,'D',false,false),
  ('623','62','Redevances de crédit-bail','Leasing royalties',6,'D',false,false),
  ('624','62','Entretien, réparations','Maintenance & repairs',6,'D',false,false),
  ('625','62','Primes d''assurance','Insurance premiums',6,'D',false,false),
  ('627','62','Frais de transit / douane','Transit & customs charges',6,'D',false,false),
  ('628','62','Frais de télécommunications','Telecommunications',6,'D',false,false),
  ('631','63','Frais bancaires','Bank charges',6,'D',false,false),
  ('632','63','Rémunérations d''intermédiaires','Intermediary fees',6,'D',false,false),
  ('633','63','Frais de formation','Training costs',6,'D',false,false),
  ('638','63','Autres charges externes','Other external charges',6,'D',false,false),
  ('641','64','Impôts et taxes directs','Direct taxes',6,'D',false,false),
  ('646','64','Droits d''enregistrement','Registration duties',6,'D',false,false),
  ('661','66','Rémunérations du personnel','Personnel remuneration',6,'D',false,false),
  ('664','66','Charges sociales','Social charges',6,'D',false,false),
  ('671','67','Intérêts des emprunts','Loan interest',6,'D',false,false),
  ('701','70','Ventes de marchandises','Sales of goods',7,'C',false,false),
  ('706','70','Services vendus','Services rendered',7,'C',false,true),
  ('707','70','Produits accessoires','Ancillary income',7,'C',false,true),
  ('708','70','Produits des activités annexes','Income from ancillary activities',7,'C',false,false)
ON CONFLICT (code) DO NOTHING;

-- 4-digit postable leaves (parent = 3-digit above) ----------------------------
INSERT INTO chart_of_accounts (code,parent_code,label_fr,label_en,class,normal_balance,is_postable,requires_analytic) VALUES
  ('2451','245','Véhicules de transport','Transport vehicles',2,'D',true,false),
  ('4011','401','Fournisseurs locaux','Local suppliers',4,'C',true,false),
  ('4012','401','Fournisseurs étrangers','Foreign suppliers',4,'C',true,false),
  ('4111','411','Clients locaux','Local customers',4,'D',true,false),
  ('4112','411','Clients étrangers','Foreign customers',4,'D',true,false),
  ('4431','443','TVA facturée sur ventes','Output VAT on sales',4,'C',true,false),
  ('4432','443','TVA facturée sur prestations','Output VAT on services',4,'C',true,false),
  ('4451','445','TVA récupérable sur achats','Input VAT on purchases',4,'D',true,false),
  ('4452','445','TVA récupérable sur services','Input VAT on services',4,'D',true,false),
  ('4453','445','TVA récupérable sur immobilisations','Input VAT on assets',4,'D',true,false),
  ('4471','447','Retenue à la source (IRPP)','Withholding — payroll',4,'C',true,false),
  ('4472','447','Précompte sur achats','Advance tax on purchases',4,'C',true,false),
  ('4731','473','Débours refacturables','Re-billable débours',4,'D',true,true),
  ('4732','473','Transit — comptes clients','Transit — client clearing',4,'D',true,true),
  ('5211','521','Banque — compte courant XAF','Bank — current account XAF',5,'D',true,false),
  ('5212','521','Banque — compte devises','Bank — FX account',5,'D',true,false),
  ('5381','538','MTN Mobile Money','MTN Mobile Money',5,'D',true,false),
  ('5382','538','Orange Money','Orange Money',5,'D',true,false),
  ('5711','571','Caisse principale','Main cash box',5,'D',true,false),
  ('6111','611','Fret maritime import','Ocean freight — import',6,'D',true,true),
  ('6112','611','Fret aérien import','Air freight — import',6,'D',true,true),
  ('6131','613','Transport routier tiers','Third-party road transport',6,'D',true,true),
  ('6132','613','Transport ferroviaire tiers','Third-party rail transport',6,'D',true,true),
  ('6211','621','Manutention et acconage','Handling & stevedoring',6,'D',true,true),
  ('6212','621','Sous-traitance de transport','Transport subcontracting',6,'D',true,true),
  ('6271','627','Frais de douane / transit','Customs & transit charges',6,'D',true,true),
  ('6272','627','Frais portuaires (THC, magasinage)','Port charges (THC, storage)',6,'D',true,true),
  ('6273','627','Surestaries et détention','Demurrage & detention',6,'D',true,true),
  ('6274','627','Scanner et inspection','Scanning & inspection',6,'D',true,true),
  ('6311','631','Commissions et frais bancaires','Bank commissions & fees',6,'D',true,false),
  ('6321','632','Honoraires de commissionnaire','Freight-forwarder fees',6,'D',true,true),
  ('7061','706','Commission de transit','Transit commission',7,'C',true,true),
  ('7062','706','Honoraires de représentation','Agency / representation fees',7,'C',true,true),
  ('7063','706','Prestations logistiques','Logistics services',7,'C',true,true),
  ('7071','707','Refacturation de frais','Re-billed charges',7,'C',true,true)
ON CONFLICT (code) DO NOTHING;

-- Débours clearing accounts are analytic (need a dossier), like 706/707.
UPDATE chart_of_accounts SET requires_analytic = true WHERE code IN ('4731','4732') AND requires_analytic = false;

-- DOWN
-- Pure reference-data seed, all ON CONFLICT DO NOTHING — safe to re-run and it
-- clobbers nothing. An exact revert would DELETE only the codes this file adds
-- that no journal_line / posting_rule references; anything referenced must be
-- kept. Reference rows are normally left in place (restore from a dump if a
-- true revert is required), so this is documentation of intent, not automation.
--
--   DELETE FROM chart_of_accounts WHERE code IN (
--     '218','245','401','408','409','411','416','418','419','421','431','441',
--     '443','445','447','471','473','521','531','538','571','581','601','604',
--     '605','611','612','613','616','618','621','622','623','624','625','627',
--     '628','631','632','633','638','641','646','661','664','671','701','706',
--     '707','708','2451','4011','4012','4111','4112','4431','4432','4451','4452',
--     '4453','4471','4472','4731','4732','5211','5212','5381','5382','5711','6111',
--     '6112','6131','6132','6211','6212','6271','6272','6273','6274','6311','6321',
--     '7061','7062','7063','7071')
--   AND NOT EXISTS (SELECT 1 FROM posting_rule pr WHERE pr.debit_account = code OR pr.credit_account = code);
