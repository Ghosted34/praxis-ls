-- 0508 — Give `dossier` the `title` column two services have always written to.
--
-- WHAT WAS BROKEN
--
-- `dossier` has never had a `title` column. 0310 created it without one and the
-- only ALTER since (0479) adds pol_place_id/pod_place_id. Two call sites
-- nevertheless pass one:
--
--   src/orchestration/handlers/opportunity-won-open-dossier.js:48
--   src/modules/sales/opportunity/opportunity.service.js:62   (win({createDossier}))
--
-- Both reach `insertOne(client, "dossier", data)`, which builds its column list
-- from `Object.keys(data)` and declares no allow-list — so `title` went into the
-- INSERT verbatim and Postgres answered:
--
--     column "title" of relation "dossier" does not exist   (SQLSTATE 42703)
--
-- CONSEQUENCE, and it is not small. The sales→operations handoff has never
-- worked, by either route:
--
--   * the EVENT route fails inside the outbox. `dossierSvc.create` rolls back
--     and rethrows, the dispatcher marks the row FAILED, retries, and lands it
--     in DEAD. The user who clicked "Won" gets a 200. The opportunity is marked
--     won, no dossier exists, and nothing links them. Sales believes it handed
--     the job over; Operations never sees it. Nothing surfaces but a dead outbox
--     row nobody reads.
--   * the SYNCHRONOUS route — `POST .../opportunities/:id/win` with
--     `createDossier: true` — is not swallowed at all. It 500s. That flag has
--     never once succeeded.
--
-- The downstream costing failures (`dossier_id` NOT NULL) are the same defect
-- seen one step later: the dossier that should exist does not.
--
-- WHY ADD THE COLUMN RATHER THAN DROP THE ARGUMENT
--
-- Both call sites are carrying `opportunity.name` — the human label for the
-- deal — across the sales/operations boundary. `dossier` has nowhere to put it:
-- its only name-like column is `ref`, a machine-allocated number
-- ('SLAS-2026-0001'). So the authors were not inventing a column at random; they
-- were writing to the field the model is missing, and neither ever ran against a
-- real Postgres to find out it was not there.
--
-- Deleting `title:` from both call sites would also make the flow work, and
-- would lose the deal name at exactly the handoff where Operations most needs to
-- know what the job is. `details_json` would preserve it while making it
-- invisible to search and to every list query. Adding the column is the option
-- that matches what the code has been trying to do since it was written.
--
-- NULLABLE, deliberately: every dossier that already exists has no title, and
-- the REST create path does not require one. A NOT NULL column would need a
-- backfill that invents data.
--
-- WHY THIS WAS INVISIBLE. `insertOne`'s identifier check passes `title` — it is
-- a perfectly legal identifier, and the check exists to stop injection, not to
-- know the schema. The layer that would have caught it is the `writable`
-- allow-list, which `dossier` did not declare; it does now
-- (operations_file.repo.js). And the unit tests fake the client, so a fake
-- accepted the column happily. Only a real database ever said no, which is why
-- this surfaced the first time the integration job actually ran (TC-CI6).
--
-- ROLLBACK:
--   ALTER TABLE dossier DROP COLUMN IF EXISTS title;
--   -- destroys the titles; the two call sites must lose `title:` first or the
--   -- handoff breaks again exactly as described above.

DO $$
DECLARE
  v_backfilled int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'dossier'
  ) THEN
    RAISE WARNING '[0508] %: dossier table absent — title not added. The sales handoff stays broken on this tenant.', current_schema();
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'dossier' AND column_name = 'title'
  ) THEN
    RAISE NOTICE '[0508] %: dossier.title already present, nothing to do.', current_schema();
    RETURN;
  END IF;

  -- EXECUTE throughout, not static SQL. PL/pgSQL plans a static statement the
  -- first time the block runs, and every statement below names a column that
  -- does not exist yet at that moment — a static UPDATE referencing `d.title`
  -- would fail to plan before the ALTER above it ever ran.
  EXECUTE 'ALTER TABLE dossier ADD COLUMN title text';

  EXECUTE format(
    'COMMENT ON COLUMN %I.dossier.title IS %L',
    current_schema(),
    'Human label for the job, distinct from `ref` (the allocated number). '
    || 'Set from opportunity.name when a dossier is opened from a won '
    || 'opportunity. Optional: dossiers created directly have none.'
  );

  -- Recover what can be recovered. This reaches only dossiers that were linked
  -- to an opportunity BY HAND — an automatic link implies a create that carried
  -- `title`, and every one of those failed, so no such dossier exists. Expect a
  -- small number or zero; it is here because the rows it does find are the ones
  -- whose names would otherwise be lost for good.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'opportunity' AND column_name = 'dossier_id'
  ) THEN
    EXECUTE '
      UPDATE dossier d
         SET title = o.name
        FROM opportunity o
       WHERE o.dossier_id = d.dossier_id
         AND d.title IS NULL
         AND o.name IS NOT NULL';
    GET DIAGNOSTICS v_backfilled = ROW_COUNT;
  END IF;

  RAISE NOTICE '[0508] %: dossier.title added; % row(s) backfilled from opportunity.name.',
               current_schema(), v_backfilled;
END $$;

-- DOWN
-- ALTER TABLE dossier DROP COLUMN IF EXISTS title;
-- Drops the titles irrecoverably. Remove `title:` from
-- orchestration/handlers/opportunity-won-open-dossier.js and
-- modules/sales/opportunity/opportunity.service.js in the same change, or
-- opportunity.won starts failing into the dead-letter queue again.
