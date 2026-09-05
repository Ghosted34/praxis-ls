-- ============================================================================
-- TENANT DB — 13775 The employee's tax identifier, and the working week as a
-- week rather than as a sentence.
--
-- ── 1. THE NIU ────────────────────────────────────────────────────────────
--
-- `corporate_entity`, `client_master` and `supplier_master` have all carried a
-- `niu` since 0300/0515 — the Numéro d'Identifiant Unique the DGI issues, which
-- every OHADA-Cameroon fiscal document quotes. The EMPLOYEE did not have one,
-- and an employee needs it for exactly the same reason a supplier does: the
-- annual DIPE return, the certificate of earnings a person is given at the end
-- of the year, and the IRPP deduction on their payslip are all filed against
-- their NIU. HR was recording it in whatever free-text field was nearest, or
-- not at all, and payroll had nowhere to read it from.
--
-- Text, not a CHECK. The current format is 14 alphanumeric characters
-- (P059812345678A), it has changed at least once, and a tenant importing staff
-- hired under the old one must still be able to store what is on the card. The
-- validator caps the length and normalises case; the shape is not the
-- database's opinion to hold.
--
-- ── 2. THE WORKING WEEK ───────────────────────────────────────────────────
--
-- `working_hours` (12763) is free text, printed verbatim into the contract:
-- « Mon–Fri, 08:00–17:00 ». That is enough while everybody works the same five
-- days in the same building, and it stops being enough the moment somebody
-- works Friday from home — there is nowhere to say so. The clerk types it into
-- the same string in whatever words occur to them, and everything that has to
-- ANSWER "is this person on site on Friday" (dispatch, attendance, a hybrid
-- allowance) is left parsing prose.
--
-- `work_schedule` records the week per day: worked or not, from when to when,
-- on site or remote.
--
--   [{"day":"MON","worked":true,"start":"09:00","end":"17:00","mode":"ON_SITE"}, …]
--
-- WORKING_HOURS STAYS, and stays the column the contract generator reads. It is
-- now DERIVED: packages/shared/rules/work-schedule.js `summarise()` renders the
-- grid into the printed line, and employees.service re-derives it on every
-- write that carries a schedule. One function, called by the form and by the
-- API, is what stops the sentence and the grid disagreeing — which is precisely
-- what two independently-typed fields would do by the second edit.
--
-- NULL means "no schedule recorded", which is NOT "works nothing". Every row
-- that exists today is in that state, and the form offers to replace their
-- free text rather than silently rewriting a term somebody agreed to. No
-- backfill, deliberately: guessing "Mon–Fri 09:00–17:00" for 3,000 imported
-- staff would assert a working pattern nobody at HR has ever confirmed.
--
-- ADDITIVE ONLY. Both statements are IF NOT EXISTS.
-- ============================================================================

ALTER TABLE employee
  ADD COLUMN IF NOT EXISTS niu           text,
  ADD COLUMN IF NOT EXISTS work_schedule jsonb;

COMMENT ON COLUMN employee.niu IS
  'Numéro d''Identifiant Unique (DGI tax identifier), as printed on the card. Quoted on the DIPE return, the payslip IRPP line and the annual certificate of earnings. Free text: the format has changed and an imported record must still be storable.';
COMMENT ON COLUMN employee.work_schedule IS
  'The working week per day: [{day,worked,start,end,mode}] — mode is ON_SITE or REMOTE. employee.working_hours is DERIVED from it by packages/shared/rules/work-schedule.js summarise(); NULL means no schedule recorded, which is not the same as working no days.';

-- DOWN
--   ALTER TABLE employee
--     DROP COLUMN IF EXISTS niu,
--     DROP COLUMN IF EXISTS work_schedule;
