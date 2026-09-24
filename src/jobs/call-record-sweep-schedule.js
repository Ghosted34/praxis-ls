/**
 * The daily call-record sweep's schedule (Smart Comms audit A1).
 *
 * A cron in the corridor's timezone, during working hours. It was
 * `repeat: { every: 24h }`, which BullMQ aligns to the Unix epoch, so every
 * tenant's reprocess, LLM calls and pushes landed at 00:00 UTC (01:00 WAT).
 *
 * BullMQ keeps a repeatable registered under its old key until it is removed,
 * so registration first removes every repeatable on this queue that is not the
 * one being registered (the old `every` entry, or a cron an operator changed).
 * `removeRepeatableByKey` also deletes that entry's already-scheduled next run.
 */
"use strict";

const QUEUE = "comms-call-record-sweep-scheduler";

async function scheduleCallRecordSweep({ getQueue, enqueue, pattern, tz }) {
  const queue = getQueue(QUEUE);
  const existing = await queue.getRepeatableJobs();
  let removed = 0;
  for (const r of existing) {
    const current = !r.every && r.pattern === pattern && (r.tz || null) === (tz || null);
    if (current) continue;
    await queue.removeRepeatableByKey(r.key);
    removed += 1;
  }
  await enqueue(QUEUE, "tick", {}, {
    repeat: { pattern, tz },
    removeOnComplete: true,
    removeOnFail: 50,
  });
  return { removed };
}

module.exports = { scheduleCallRecordSweep, QUEUE };
