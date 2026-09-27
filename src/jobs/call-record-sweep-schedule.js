/**
 * The daily call-record sweep's schedule (Smart Comms audit A1).
 *
 * A cron in the corridor's timezone, during working hours. It was
 * `repeat: { every: 24h }`, which BullMQ aligns to the Unix epoch, so every
 * tenant's reprocess, LLM calls and pushes landed at 00:00 UTC (01:00 WAT).
 *
 * BullMQ keeps a repeatable registered under its old key until it is removed.
 * `removeStaleRepeatables` removes every repeatable on the queue that is not
 * the one about to be registered (the old `every` entry, or a cron an operator
 * changed); `removeRepeatableByKey` also deletes that entry's pending next run.
 * The registration itself stays in workers.js `scheduleRecurring`, next to
 * every other periodic job.
 */
"use strict";

async function removeStaleRepeatables(queue, { pattern, tz, every }) {
  const existing = await queue.getRepeatableJobs();
  let removed = 0;
  for (const r of existing) {
    // Also used for the calls safety sweep, which repeats by interval.
    const current = every
      ? Number(r.every) === Number(every) && !r.pattern
      : !r.every && r.pattern === pattern && (r.tz || null) === (tz || null);
    if (current) continue;
    await queue.removeRepeatableByKey(r.key);
    removed += 1;
  }
  return removed;
}

module.exports = { removeStaleRepeatables };
