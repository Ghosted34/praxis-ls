-- ============================================================================
-- TENANT DB — 0524 registered devices for the time clock
--
-- WHAT WAS MISSING, AND WHY THE GEOFENCE DID NOT COVER IT. 0465 made a punch
-- answer "where was this person?" It cannot answer "was it this person?" — a
-- browser tab is a browser tab, and an employee who hands their credentials to a
-- colleague standing inside the yard produces a punch that is on-site, on time
-- and entirely fictional. Buddy punching is the oldest attendance fraud there
-- is, and geofencing is orthogonal to it: both punches come from inside the
-- radius. What distinguishes them is the HARDWARE.
--
-- THE SHAPE, AND WHAT IT DELIBERATELY IS NOT. This is a REGISTER, not an
-- authentication factor. The fingerprint is a client-generated opaque token
-- persisted in the device's own storage — it is trivially copyable by anyone who
-- wants to, and nothing here should be read as claiming otherwise. What it buys
-- is that the fraud has to become deliberate and leaves a trace: a second device
-- appearing against one employee is a row a manager can see, on a date, next to
-- the punches it produced. That is the honest claim, and it is why the default
-- policy below is `warn` rather than `block`.
--
-- ONE ROW PER (employee, device), not per user. The clock is an EMPLOYEE
-- surface — `attendance_log.employee_id` is what a shift hangs off, and a user
-- with no linked employee cannot punch at all (attendance.service.resolveEmployee).
-- Keying on employee also means a shared tablet in the yard registers once per
-- person who punches from it, which is the correct reading: the pairing is what
-- is being attested, not the tablet in isolation.
--
-- STATUS RATHER THAN A BOOLEAN. `is_trusted` would have collapsed two different
-- facts — "nobody has looked at this yet" and "somebody looked and said no" —
-- into the same false, and the second must never silently decay back into the
-- first when a device reappears. REVOKED is therefore terminal for that row: a
-- returning revoked device stays revoked until a human moves it.
--
-- THE SNAPSHOT ON attendance_log IS NOT DERIVABLE. `hr_device_id` alone would
-- let a later trust decision rewrite history — trust a device today and every
-- punch it ever made silently becomes trusted, including the ones a manager
-- queried last month. `device_trusted` records what was true AT PUNCH TIME, the
-- same way `within_geofence` does, so the attendance log stays an account of
-- what happened rather than a view over current configuration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS hr_device (
  hr_device_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  -- Opaque, client-generated, stored in the device's own storage. Length-capped
  -- so a hostile client cannot use it as free storage; format is not asserted.
  fingerprint   text NOT NULL CHECK (length(fingerprint) BETWEEN 8 AND 200),
  -- What the employee calls it ("Yard tablet", "My phone"). Seeded from the
  -- user agent on first sight and renameable, because "Mozilla/5.0 (Linux;
  -- Android 13; SM-A536B)" is not a thing anyone recognises in a list.
  label         text NOT NULL,
  user_agent    text,
  platform      text,
  status        text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'TRUSTED', 'REVOKED')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The pairing is the identity of the row: seeing the same device again must
-- UPDATE it (bump last_seen_at) rather than accumulate a row per punch, and the
-- upsert in hr_device.repo depends on this constraint by name.
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_device_employee_fingerprint
  ON hr_device(employee_id, fingerprint);

-- The manager's question: "what is waiting for me to approve?" Partial, because
-- the answer is a handful of rows against a table that is otherwise only ever
-- read by primary key.
CREATE INDEX IF NOT EXISTS ix_hr_device_pending
  ON hr_device(employee_id) WHERE status = 'PENDING';

COMMENT ON TABLE hr_device IS
  'Devices registered against an employee for the time clock. A REGISTER, not an authentication factor: the fingerprint is client-generated and copyable, so its value is that a second device is visible and dated, not that it cannot be forged. Status PENDING -> TRUSTED | REVOKED; REVOKED is terminal for the row.';

-- Which device made the punch, and whether it was trusted AT THE TIME. The
-- second is a snapshot on purpose — see the header.
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS hr_device_id   uuid REFERENCES hr_device(hr_device_id);
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS device_trusted boolean;

COMMENT ON COLUMN attendance_log.device_trusted IS
  'Was the punching device TRUSTED when the punch was made. Snapshot, not a join: trusting a device later must not retroactively rewrite the punches it already made. NULL = no device was presented (an older client, or the policy is off).';

-- "Which punches came from this device" — the query a manager runs after
-- revoking one. Partial: the column is NULL for every punch made before this
-- migration and for every client that sends no fingerprint.
CREATE INDEX IF NOT EXISTS ix_attendance_log_device
  ON attendance_log(hr_device_id) WHERE hr_device_id IS NOT NULL;

-- DOWN
-- DROP INDEX IF EXISTS ix_attendance_log_device;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS device_trusted;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS hr_device_id;
-- DROP TABLE IF EXISTS hr_device;
--
-- NOT clean, and the difference from 0507 is worth stating plainly: that one
-- discarded preferences, this one discards a record. Dropping the two columns
-- destroys the device provenance of every punch already taken — an attendance
-- row that was disputed on the grounds of "that was not my phone" loses the
-- evidence on both sides of the argument. If the reason for the rollback is a
-- code fault rather than a schema fault, set hr.device_policy = 'off' and leave
-- the tables in place: the clock ignores devices entirely at that setting, and
-- nothing already recorded is lost.
--
-- Ordering, if the drop is genuinely wanted: take the code that writes
-- hr_device_id out FIRST. A rollback that drops the column while the previous
-- deploy is still serving POST /attendance/clock-in fails every punch in the
-- company.
