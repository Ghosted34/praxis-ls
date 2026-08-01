-- ============================================================================
-- 0480 — postal address on the party masters (client + supplier).
--
-- WHY. Neither `client_master` nor `supplier_master` had an address column at
-- all (0300_masterdata.sql) — only name, NIU, RCCM and commercial terms. So the
-- "bill to" side of every document could show a name and a tax number and
-- nothing else, while `corporate_entity` (the "from" side) has carried `address`
-- since 0100. Surfaced 2026-08-01 during a fresh-tenant walkthrough: the client
-- form has no address field because there was nowhere to put one.
--
-- This is not cosmetic. Under OHADA a compliant invoice identifies the
-- counterparty — name, taxpayer number AND address — so an invoice rendered from
-- this data is missing a required element. It also blocks delivery notes, which
-- need a consignee address to be useful to a driver.
--
-- SHAPE. Mirrors corporate_entity: free-text `address` plus a separate
-- `country_code`, rather than a structured block. Consistent with the "from"
-- side, and OHADA-zone addressing is not reliably structured enough for
-- line1/line2/postcode to be worth enforcing. `city` is split out because it is
-- the one component that gets filtered and grouped on.
--
-- Nullable and additive: every existing party keeps working, and the fields fill
-- in as records are edited. Idempotent.
-- ============================================================================

ALTER TABLE client_master   ADD COLUMN IF NOT EXISTS address      text;
ALTER TABLE client_master   ADD COLUMN IF NOT EXISTS city         text;
ALTER TABLE client_master   ADD COLUMN IF NOT EXISTS country_code char(2) DEFAULT 'CM';

ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS address      text;
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS city         text;
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS country_code char(2) DEFAULT 'CM';
