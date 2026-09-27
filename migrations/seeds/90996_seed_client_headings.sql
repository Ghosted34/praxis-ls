-- ============================================================================
-- SEED (per tenant schema) — 90996 the starter CLIENT HEADING list, and a
-- default heading for every catalogue line (the owner's answer to PR 2 Q11:
-- "seed a starter set, accountants adjust").
--
-- A seed, not a migration, for the reason 90995 gives: on a new tenant the
-- catalogue (9080/9082) only exists once the seeds run. Sorts after 90995 and
-- inside the /^90/ tenant-seed glob.
--
-- The mapping goes by SUBCATEGORY, the one classification every line already
-- has. It only fills a line whose heading is still empty, so a tenant that has
-- already chosen headings is never overwritten, and it skips lines that never
-- reach a client document (NON_OPERATIONAL overheads). A line nothing maps
-- prints under "Other Charges" until an accountant assigns it.
--
-- Headings follow the dictionary's Title Case with small words kept small.
-- ============================================================================

INSERT INTO dictionary_ref (kind, code, name_fr, name_en, sort_order, is_system, is_active) VALUES
  ('CLIENT_HEADING', 'CUSTOMS_FORMALITIES', 'Formalités Douanières',          'Customs Formalities',        10, true, true),
  ('CLIENT_HEADING', 'DUTIES_TAXES',        'Droits et Taxes',                'Duties & Taxes',             20, true, true),
  ('CLIENT_HEADING', 'FREIGHT_CARRIER',     'Fret et Frais du Transporteur',  'Freight & Carrier Charges',  30, true, true),
  ('CLIENT_HEADING', 'PORT_TERMINAL',       'Frais Portuaires et de Terminal','Port & Terminal Charges',    40, true, true),
  ('CLIENT_HEADING', 'TRANSPORT_DELIVERY',  'Transport et Livraison',         'Transport & Delivery',       50, true, true),
  ('CLIENT_HEADING', 'STORAGE',             'Magasinage et Entreposage',      'Storage & Warehousing',      60, true, true),
  ('CLIENT_HEADING', 'DOCUMENTATION',       'Documentation',                  'Documentation',              70, true, true),
  ('CLIENT_HEADING', 'AGENCY_FEES',         'Honoraires d''Agence',           'Agency Fees',                80, true, true),
  ('CLIENT_HEADING', 'INSURANCE',           'Assurance',                      'Insurance',                  90, true, true),
  ('CLIENT_HEADING', 'OTHER',               'Autres Frais',                   'Other Charges',            1000, true, true)
ON CONFLICT (kind, code) DO NOTHING;

CREATE TEMP TABLE _heading_map (subcategory text PRIMARY KEY, heading text NOT NULL) ON COMMIT DROP;
INSERT INTO _heading_map (subcategory, heading) VALUES
  ('DECLARATION',        'CUSTOMS_FORMALITIES'),
  ('CUSTOMS_INSPECTION', 'CUSTOMS_FORMALITIES'),
  ('SCANNING',           'CUSTOMS_FORMALITIES'),
  ('CUSTOMS_DUTIES',     'DUTIES_TAXES'),
  ('OCEAN_FREIGHT',      'FREIGHT_CARRIER'),
  ('AIR_FREIGHT',        'FREIGHT_CARRIER'),
  ('SURCHARGES',         'FREIGHT_CARRIER'),
  ('DEMURRAGE',          'FREIGHT_CARRIER'),
  ('THC',                'PORT_TERMINAL'),
  ('HANDLING',           'PORT_TERMINAL'),
  ('TRUCKING',           'TRANSPORT_DELIVERY'),
  ('RAIL',               'TRANSPORT_DELIVERY'),
  ('ESCORT',             'TRANSPORT_DELIVERY'),
  ('STORAGE',            'STORAGE'),
  ('DOCUMENTATION',      'DOCUMENTATION'),
  ('AGENCY_FEE',         'AGENCY_FEES')
ON CONFLICT (subcategory) DO NOTHING;

UPDATE dictionary_item di
   SET client_heading_ref_id = r.ref_id
  FROM dictionary_ref r
 WHERE r.kind = 'CLIENT_HEADING'
   AND di.client_heading_ref_id IS NULL
   AND di.applicability_mode IS DISTINCT FROM 'NON_OPERATIONAL'
   AND r.code = COALESCE(
         (SELECT m2.heading FROM _heading_map m2 WHERE m2.subcategory = di.subcategory),
         'OTHER');

-- DOWN
-- UPDATE dictionary_item SET client_heading_ref_id = NULL
--  WHERE client_heading_ref_id IN (SELECT ref_id FROM dictionary_ref WHERE kind = 'CLIENT_HEADING' AND is_system);
-- DELETE FROM dictionary_ref WHERE kind = 'CLIENT_HEADING' AND is_system;
