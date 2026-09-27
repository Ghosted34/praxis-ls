/**
 * Worker job: the daily platform call check (calls audit PR-7, O5). One run a
 * day, platform-wide, on the COMMS_CALL_CANARY_CRON / _TZ repeatable (default
 * 10:00 Africa/Douala). Results go to `platform.comms_call_canary_run`, the
 * console's Health page and its bell — never to a tenant app.
 */
"use strict";

const canary = require("../../services/platform/comms-call-canary.service");

module.exports = async function commsCallCanary(job) {
  return canary.run({ job });
};
