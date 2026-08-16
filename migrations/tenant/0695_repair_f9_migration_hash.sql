-- 0695 Repair the migration-ledger hash for the in-place 0689 ordering fix.
--
-- 0689 was applied successfully to an empty/live schema, then failed on a
-- sandbox that contained TRIAGED rows because its old CHECK was still active
-- during TRIAGED -> READ. The file must be corrected in place because a later
-- migration is never reached after 0689 fails. That deliberately changes its
-- hash. This one-time compare-and-swap acknowledges ONLY that exact reviewed
-- old hash; any other drift remains visible and is not blessed accidentally.
UPDATE public.schema_migration
   SET sha256 = 'f9ba6b8410e5bed64054e8cd1b55dc2841f68acd42882f9c6adfdf854aa8ea12'
 WHERE filename = 'tenant/0689_sales_crm_f9_contact_enquiries.sql'
   AND sha256 = 'e50193fb2e78b1f2261cf591dbabdbf6f4dd7f016a22935661195af56bd3a180';

-- IRREVERSIBLE: this records an intentional correction to an already-applied
-- migration. Restoring the old hash would falsely report the repaired file as
-- drifted and does not restore any schema or customer data.
