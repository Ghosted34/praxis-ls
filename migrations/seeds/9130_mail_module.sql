-- ============================================================================
-- SEED (PLATFORM DB) — catalogue entry for the Mail & Correspondence module.
--
-- 91xx = platform seed (migrator.files.platformSeeds), applied once to the
-- platform database; 90xx = tenant seed. Same shape and intent as
-- 9120_hr_discipline_module.sql.
--
-- WHY: src/modules/mail mounted 20 routes behind authMiddleware and nothing
-- else — no requirePermission, no feature gate — so any authenticated user
-- could read the inbox, any thread and its attachments, any client's full
-- correspondence timeline, and send mail AS the company mailbox. Gating it
-- needs a module_key, and a key that is absent from platform.module_catalogue
-- has grants for nobody: it never appears as a row in the permission matrix
-- (which is built from GET /catalogue/modules), so every non-CEO user would
-- 403 forever. Catalogue the key first, then gate. See
-- doc/ORGANOGRAMME_AUDIT_2026-08-02.md finding C2.
--
-- WHY NOT MOD-64: smartcomm rides MOD-64 (Smart Comms — internal, staff-to-
-- staff messaging). Mail is external client correspondence plus the stored
-- credentials to send as the company. Granting internal chat must not grant
-- the client mailbox.
--
-- NOTE this creates the 'comms' group_key in module_catalogue, which did not
-- exist before — 9021_seed_default_permissions.sql:27-31 records that gap as
-- the reason the "Comms & portals admin" matrix row could not be seeded. The
-- permission matrix groups by group_key and title-cases it for display
-- (permission-matrix-page.tsx:58), so no FE change is needed.
--
-- Idempotent: safe to re-run.
-- ============================================================================

INSERT INTO platform.module_catalogue (module_key, group_key, name, sort_order, is_core) VALUES
 ('MOD-72','comms','Mail & Correspondence',130,false)
ON CONFLICT (module_key) DO NOTHING;
