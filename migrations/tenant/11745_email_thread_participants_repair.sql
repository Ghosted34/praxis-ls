-- ── RENUMBERED 11743 → 11745 (2026-08-22) ──────────────────────────────────
--
-- This file and `11743_seed_rail_transportation.sql` both landed as 11743 from
-- two parallel streams, which `scripts/db/check-migration-numbers.js` fails the
-- build on: the migrator keys its ledger on FILENAME and sorts alphabetically,
-- so two files sharing a number apply in whatever order their descriptive
-- suffixes happen to sort — an accident, not a decision.
--
-- THIS file moved rather than the rail seed, for one reason: `11744` opens with
-- "11743 added the three rail service_type rows" and backfills them. The rail
-- seed must stay below its own backfill. This repair, by contrast, is a
-- self-contained data fix over `email_thread` that depends only on 10731 having
-- run; nothing orders against it, so it is the half that can move for free.
-- Note that it already applied AFTER the rail seed under the old alphabetical
-- tie-break, so the relative order of the two is unchanged by this move.
--
-- SAFETY OF THE RENAME. The standing rule is "never renumber a migration that
-- has already run" — because the ledger keys on filename, a rename makes the
-- migrator treat this as a new file and apply it again. That is safe here, and
-- only here, because the statement below is idempotent by construction (see the
-- last paragraph of the original header): after one run no participant element
-- contains a comma, so the WHERE matches nothing and the re-run updates zero
-- rows. The old `11743_…` ledger row stays behind pointing at a filename that no
-- longer exists; `migrator.contentDrift` skips rows whose file is absent, so it
-- reports nothing and no fleet status is affected.
-- ───────────────────────────────────────────────────────────────────────────

-- §5.9 — 10731's backfill split the recipients on the MESSAGE and not on the
-- THREAD, so a conversation with two recipients has one participant that is
-- both of them, and neither of them.
--
-- ── WHAT 10731 DID ──────────────────────────────────────────────────────────
--
-- The pre-10731 table held recipients as one `citext` scalar, comma-joined.
-- Its backfill handles that correctly for `email_message`:
--
--   string_to_array(b.to_address::text, ', ')::citext[]
--
-- and does not, four lines earlier, for `email_thread.participants`:
--
--   ARRAY(SELECT DISTINCT x FROM unnest(
--           array_agg(b.from_address) || array_agg(COALESCE(b.to_address,'')::citext)
--         ) AS x WHERE x <> '')
--
-- So a legacy row addressed to "client@maersk.cm, ops@maersk.cm" produced a
-- thread whose participants are
--
--   {client@maersk.cm, "client@maersk.cm, ops@maersk.cm", billing@smartls.cm}
--
-- — an element that is not an address, and a real correspondent
-- (ops@maersk.cm) that appears nowhere in the set. Verified against a real
-- Postgres, not read off the SQL; `tests/integration/mail-model-backfill.test.js`
-- is the test that found it and now pins it.
--
-- ── WHY IT MATTERS BEYOND LOOKING WRONG ─────────────────────────────────────
--
-- `participants` is the thread's own recipient set, and three things read it:
-- the thread list renders it, `binding/cards/_facts.js` hands it to the
-- assistant as grounded fact, and `binding/convert.service.js` takes
-- `participants[0]` as the address to create a client or lead FROM when the
-- thread has no `from_address`. That last one is the sharp end: converting such
-- a thread would mint a party whose e-mail is the string
-- "client@maersk.cm, ops@maersk.cm", which no duplicate check will ever match
-- and no message will ever reach.
--
-- Message-level `to_address` is correct throughout and is what search indexes,
-- so nothing here touches it.
--
-- ── WHY A REPAIR AND NOT AN EDIT TO 10731 ───────────────────────────────────
--
-- 10731 is applied. The migrator keys its ledger on filename and verifies the
-- recorded sha256 (`contentDrift`), so editing an applied file does not re-run
-- it and does raise drift on every tenant that has it. And it would fix
-- nothing: on a fresh tenant the backfill's `legacy_exists` guard means that
-- expression never runs at all. The only tenants carrying the defect are the
-- ones that had mail before 10731, and this is what reaches them.
--
-- IDEMPOTENT by construction: after one run no element contains a comma, so the
-- WHERE matches nothing and the second run updates zero rows.
UPDATE email_thread t
   SET participants = ARRAY(
         SELECT DISTINCT btrim(part)::citext
           FROM unnest(t.participants) AS p,
                LATERAL regexp_split_to_table(p::text, '\s*,\s*') AS part
          WHERE btrim(part) <> ''
       )
 WHERE EXISTS (SELECT 1 FROM unnest(t.participants) AS p WHERE p::text LIKE '%,%');

-- DOWN
--   Not reversible, and deliberately so: the pre-repair value is a corrupted
--   encoding of the same information, so "restoring" it would mean re-joining
--   addresses that were never meant to be one string. The rows this touches are
--   identifiable after the fact by nothing — which is the point, they now look
--   like every correctly-ingested thread.
