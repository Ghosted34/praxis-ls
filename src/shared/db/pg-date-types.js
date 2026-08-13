/**
 * How a Postgres `date` column reaches JSON.
 *
 * THE BUG THIS FIXES. node-postgres parses OID 1082 (`date`) into a JS `Date`
 * at midnight IN THE PROCESS TIMEZONE. `res.json()` then serialises that with
 * `toISOString()`, so a registration issued on 2021-09-21 leaves the API as
 * `"2021-09-20T23:00:00.000Z"` when the server runs on Africa/Douala. Two
 * separate defects fall out of that one conversion:
 *
 *   1. `<input type="date">` accepts ONLY `YYYY-MM-DD`. Handed a timestamp it
 *      renders BLANK — while the form's state still holds the timestamp. So
 *      every edit form showed an empty date for a date that was saved, and
 *      saving again posted the timestamp back, which the shared `isoDate`
 *      schema correctly rejected with "Use the format YYYY-MM-DD., That date
 *      doesn't exist." A user could not re-save a row they had not touched.
 *   2. The UTC shift moves the day itself. A date has no time and no timezone —
 *      21 September is 21 September in every timezone — so any conversion
 *      through an instant is wrong by construction, and wrong in the direction
 *      that makes an expiry lapse a day early.
 *
 * THE FIX. Hand back the string Postgres already sent. `date` is a calendar
 * date, its wire format IS `YYYY-MM-DD`, and that is exactly the format the
 * shared schemas validate and the date inputs expect — so the column
 * round-trips through the API and back into the form unchanged.
 *
 * SCOPE. `date` only. `timestamp`/`timestamptz` (1114/1184) name an instant,
 * where a `Date` is the right representation, and they keep their default
 * parsers. The several `isoDate()` helpers already in this codebase
 * (entity-360.service, corporate_entity.renewals, compliance.rules…) accept a
 * string as readily as a `Date`, so nothing downstream has to change.
 *
 * WHY IT LIVES HERE AND IS REQUIRED BY THE POOLS. `setTypeParser` mutates the
 * `pg` module singleton, so it must run before the first query on ANY pool —
 * tenant or platform — and it must not depend on which entrypoint booted
 * (server, jobs, a script). Requiring this from the two modules that build
 * pools makes that ordering a property of the code rather than of the boot
 * sequence.
 */
"use strict";

const { types } = require("pg");

/** OID of Postgres `date`. `timestamp` (1114) and `timestamptz` (1184) are left alone. */
const DATE_OID = 1082;

let applied = false;

/**
 * Register the passthrough parser. Idempotent: every pool module calls it, and
 * the second call must not undo anything.
 *
 * `infinity` / `-infinity` pass through as those literal strings, which is what
 * they already did in every string-tolerant consumer — the previous behaviour
 * turned them into `Invalid Date`.
 */
function applyDateTypeParsers() {
  if (applied) return;
  types.setTypeParser(DATE_OID, (value) => value);
  applied = true;
}

applyDateTypeParsers();

module.exports = { applyDateTypeParsers, DATE_OID };
