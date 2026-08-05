-- ============================================================================
-- Regroup the module catalogue onto the six workflow verbs, and fix MOD-64.
--
-- WHY group_key CHANGES AT ALL. The new application shell is a ribbon with six
-- top-level tabs, and its taxonomy is driven ENTIRELY by this column — there is
-- deliberately no second mapping in the client. That rules out the alternative
-- of leaving thirteen groups here and folding them in the frontend, which would
-- have meant two places to edit and one of them silently authoritative.
--
-- The verbs describe what a user is trying to DO rather than where a feature
-- lives:
--   monitor    see the business — dashboard, workspace, comms, support
--   engage     the relationship side, both directions — sales, commercial,
--              procurement. Buying and selling are the same skill.
--   fulfill    move and store the goods — operations, warehouse, fleet
--   transact   money — finance, costing
--   empower    people — HR
--   configure  the back office — master data, security, vault, governance,
--              settings, god mode
--
-- MOD-64 IS A CORRECTION, NOT A REGROUPING. The catalogue called it
-- "File Repository (Vault)" and filed it under the vault. Everything that
-- actually runs disagrees: `smartcomm.routes.js` gates Smart Comms on MOD-64,
-- `document_vault.types.js` maps the certified comms export to it, and the
-- feature catalogue below binds both `comms` and `signatures` to it. So the
-- name and group were the outlier, and the practical consequences were real —
-- the IAM permission matrix reads this table, so an administrator granting
-- "File Repository (Vault)" was in fact granting Smart Comms.
--
-- Code wins, because changing the code to match the catalogue would revoke
-- Comms from anyone who had it. The Vault's file repository gets a new key
-- (MOD-73) rather than reclaiming MOD-64.
--
-- MOD-74/75 ADD ROWS THAT WERE NEVER THERE. `/support` and `/governance` are
-- routed screens with no catalogue entry at all, so a catalogue-driven ribbon
-- could not have placed them without a hardcoded exception. Now it can.
--
-- Idempotent: safe to re-run, and produces the same state as a fresh seed.
-- ============================================================================

-- 1. The six verbs. Written as an explicit map rather than a rename so a group
--    that no longer exists fails loudly here instead of silently keeping its
--    old value and disappearing from the ribbon.
UPDATE platform.module_catalogue SET group_key = m.verb
  FROM (VALUES
    ('dashboard','monitor'),
    ('master','configure'),
    ('hr','empower'),
    ('sales','engage'),
    ('commercial','engage'),
    ('procurement','engage'),
    ('operations','fulfill'),
    ('wms','fulfill'),
    ('fleet','fulfill'),
    ('finance','transact'),
    ('costing','transact'),
    ('vault','configure'),
    ('security','configure'),
    ('comms','monitor')
  ) AS m(old, verb)
 WHERE platform.module_catalogue.group_key = m.old;

-- 2. Two modules whose verb is not their old group's verb. God Mode is an
--    administration console that happened to be filed with the dashboard.
UPDATE platform.module_catalogue SET group_key = 'configure' WHERE module_key = 'MOD-00B';

-- 3. The MOD-64 correction (see the header).
UPDATE platform.module_catalogue
   SET name = 'Smart Comms & Signatures', group_key = 'monitor'
 WHERE module_key = 'MOD-64';

-- 4. Rows the catalogue never had. `is_core` on the two frontend areas because
--    every user reaches them regardless of plan — support and approvals are not
--    upsell surfaces.
INSERT INTO platform.module_catalogue (module_key, group_key, name, sort_order, is_core) VALUES
  ('MOD-73','configure','File Repository (Vault)',73,false),
  ('MOD-74','monitor','Support & Feedback',74,true),
  ('MOD-75','configure','Governance & Approvals',75,true)
ON CONFLICT (module_key) DO UPDATE
  SET group_key = EXCLUDED.group_key,
      name      = EXCLUDED.name,
      is_core   = EXCLUDED.is_core;

-- 5. Guard. The ribbon renders one tab per distinct group_key, so a stray value
--    would appear as a seventh tab with one module in it — visible, wrong, and
--    nobody's job to notice. Fail the migration instead.
DO $$
DECLARE stray text;
BEGIN
  SELECT string_agg(DISTINCT group_key, ', ') INTO stray
    FROM platform.module_catalogue
   WHERE group_key NOT IN ('monitor','engage','fulfill','transact','empower','configure');
  IF stray IS NOT NULL THEN
    RAISE EXCEPTION 'module_catalogue.group_key outside the six verbs: %', stray;
  END IF;
END $$;

-- DOWN
-- Restores the thirteen original groups and the MOD-64 label. Safe as written:
-- this migration only relabels and regroups, and adds three rows that nothing
-- referenced before it. No grants, plans or features key off group_key.
--
-- The one thing this does NOT undo is a grant made against MOD-73/74/75 after
-- the fact — deleting those rows would cascade to `platform.feature_catalogue`
-- and any tenant grant referencing them, so they are left in place. An orphan
-- module row is inert; a cascaded grant deletion is not.
--
-- UPDATE platform.module_catalogue SET group_key = m.old
--   FROM (VALUES
--     ('MOD-00A','dashboard'),('MOD-00B','dashboard'),
--     ('MOD-01','master'),('MOD-02','master'),('MOD-03','master'),('MOD-04','master'),
--     ('MOD-05','master'),('MOD-06','master'),('MOD-07','master'),('MOD-08','master'),
--     ('MOD-09','master'),('MOD-10','master'),
--     ('MOD-11','hr'),('MOD-12','hr'),('MOD-13','hr'),('MOD-14','hr'),('MOD-15','hr'),
--     ('MOD-16','hr'),('MOD-17','hr'),('MOD-18','hr'),('MOD-19','hr'),
--     ('MOD-20','sales'),('MOD-21','sales'),('MOD-22','sales'),('MOD-23','sales'),
--     ('MOD-24','sales'),('MOD-25','sales'),('MOD-26','sales'),
--     ('MOD-27','commercial'),('MOD-28','commercial'),
--     ('MOD-29','operations'),('MOD-30','operations'),('MOD-31','operations'),('MOD-32','operations'),
--     ('MOD-33','wms'),('MOD-34','wms'),('MOD-35','wms'),('MOD-36','wms'),('MOD-37','wms'),('MOD-38','wms'),
--     ('MOD-39','fleet'),('MOD-40','fleet'),('MOD-41','fleet'),('MOD-42','fleet'),
--     ('MOD-43','fleet'),('MOD-44','fleet'),('MOD-45','fleet'),
--     ('MOD-46','costing'),('MOD-47','costing'),('MOD-48','costing'),('MOD-49','costing'),
--     ('MOD-50','finance'),('MOD-51','finance'),('MOD-52','finance'),('MOD-53','finance'),
--     ('MOD-54','finance'),('MOD-55','finance'),('MOD-56','finance'),('MOD-57','finance'),
--     ('MOD-58','finance'),('MOD-59','finance'),
--     ('MOD-60','procurement'),('MOD-61','procurement'),('MOD-62','procurement'),
--     ('MOD-63','vault'),('MOD-64','vault'),('MOD-65','vault'),('MOD-66','vault'),
--     ('MOD-67','security'),('MOD-68','security'),('MOD-69','security'),('MOD-70','security'),
--     ('MOD-71','hr'),('MOD-72','comms')
--   ) AS m(key, old)
--  WHERE platform.module_catalogue.module_key = m.key;
--
-- UPDATE platform.module_catalogue
--    SET name = 'File Repository (Vault)'
--  WHERE module_key = 'MOD-64';
