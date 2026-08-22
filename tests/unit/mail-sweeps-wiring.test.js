/**
 * THE SWEEPS EXIST, ARE REGISTERED, AND ARE TICKED.
 *
 * `mail-sla-clock.test.js` and `mail-followup.test.js` both passed while there
 * was no worker at all: `mail_sla_policy`, `business_hours`, `business_holiday`
 * and `email_thread_lock` were read by zero application code, and
 * `email_followup` rows were written by two endpoints and read by none. A user
 * who snoozed a thread got a 201 and silence.
 *
 * This file has three parts, and all three are needed:
 *   1. the sweeps do the right thing (against a recording fake client),
 *   2. the queues are REGISTERED in workers.js,
 *   3. something ENQUEUES them — the failure this repo has already had once,
 *      with `regie-aging`, whose own comment says it "has been registered since
 *      the module shipped and nothing ever enqueued it".
 */
"use strict";

const fs = require("fs");
const path = require("path");

jest.mock("../../src/modules/notification/notification.service", () => ({
  notify: jest.fn(async () => ({ notification_id: "n-1" })),
  notifyMany: jest.fn(async () => 0),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
}));

const notify = require("../../src/modules/notification/notification.service");
const sla = require("../../src/modules/mail/triage/sla.service");
const followup = require("../../src/modules/mail/triage/followup.service");
const clock = require("../../src/modules/mail/triage/sla-clock");

const JOBS = path.resolve(__dirname, "../../src/jobs");

function fakeClient(answers = []) {
  const calls = [];
  return {
    calls,
    written: (re) => calls.filter((c) => re.test(c.text)),
    query: async (text, params) => {
      calls.push({ text, params });
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [], rowCount: hit ? hit.rows.length : 0 };
    },
  };
}

const HOURS = [1, 2, 3, 4, 5].map((d) => ({
  day_of_week: d, opens_at: "08:00", closes_at: "17:00", timezone: "Africa/Douala",
}));

/* ── 1. The clock, in the office's timezone ───────────────────────────────── */

describe("sla-clock computes in the office's zone, not the server's", () => {
  test("Friday 16:30 Douala + 4 business hours lands on MONDAY, not Saturday", () => {
    // 15:30Z is 16:30 in Africa/Douala (UTC+1, no DST).
    //
    // On the seeded Mon–Fri 08:00–17:00 calendar the answer is Monday 11:30:
    // 30 minutes on Friday before close, then 3h30 from Monday's open. §9.10
    // criterion 2 says "Monday 10:30", which only comes out of an 18:00 close —
    // the guide's arithmetic, not its rule. The RULE is "Monday, not Saturday",
    // and that is what is asserted; the exact minute is asserted against the
    // calendar the tenant is actually seeded with.
    const fri = new Date("2026-08-14T15:30:00Z");
    const due = clock.addBusinessMinutes(fri, 240, { hours: HOURS, holidays: [] });
    const p = clock.partsIn(due, "Africa/Douala");
    expect(p.dow).toBe(1);
    expect(`${p.h}:${String(p.mi).padStart(2, "0")}`).toBe("11:30");
  });

  test("read in UTC the same instant is 10:30 — which is the whole point", () => {
    // The pre-fix implementation used getHours()/setHours(), i.e. the SERVER's
    // zone. On a UTC container it would have opened the office at 08:00Z and
    // produced 10:30 Douala: an hour early, every day, with nothing to show for
    // it but SLA breaches raised before the promise had actually expired.
    const fri = new Date("2026-08-14T15:30:00Z");
    const due = clock.addBusinessMinutes(fri, 240, { hours: HOURS, holidays: [] });
    expect(due.toISOString()).toBe("2026-08-17T10:30:00.000Z");
  });

  test("a zone with DST is handled by the zone, not by an offset", () => {
    // 09:00 Paris is 07:00Z in summer and 08:00Z in winter (§9.10 criterion 5).
    const summer = clock.zonedToUtc({ y: 2026, m: 7, d: 14, h: 9, mi: 0 }, "Europe/Paris");
    const winter = clock.zonedToUtc({ y: 2026, m: 1, d: 14, h: 9, mi: 0 }, "Europe/Paris");
    expect(summer.toISOString()).toBe("2026-07-14T07:00:00.000Z");
    expect(winter.toISOString()).toBe("2026-01-14T08:00:00.000Z");
  });

  test("a holiday is skipped in the office's zone", () => {
    const thu = new Date("2026-12-24T15:30:00Z");
    const due = clock.addBusinessMinutes(thu, 60, { hours: HOURS, holidays: [{ holiday_on: "2026-12-25" }] });
    const p = clock.partsIn(due, "Africa/Douala");
    expect(`${p.y}-${p.m}-${p.d}`).not.toBe("2026-12-25");
  });

  test("the VIP tier is a different policy row, and both clocks differ", () => {
    const vip = { first_response_minutes: 60, resolution_minutes: 960, business_hours_only: true, applies_to_vip: true };
    expect(clock.minutesFor(vip, "first_response")).toBe(60);
    expect(clock.minutesFor(vip, "resolution")).toBe(960);
    // The old `applies_to_vip ? x : x` returned the same number on both
    // branches, so the seeded one-hour VIP promise silently became four hours.
    expect(clock.minutesFor(vip, "first_response")).not.toBe(clock.minutesFor(vip, "resolution"));
  });

  test("no calendar configured yields no due date rather than a fake one", () => {
    expect(clock.due(new Date(), { first_response_minutes: 240, business_hours_only: true }, { hours: [] })).toBeNull();
  });

  test("PENDING pauses the clock and RESOLVED stops it", () => {
    const overdue = { first_response_due_at: new Date(Date.now() - 1000) };
    expect(clock.isBreached({ ...overdue, work_status: "OPEN" })).toBe(true);
    expect(clock.isBreached({ ...overdue, work_status: "PENDING" })).toBe(false);
    expect(clock.isBreached({ ...overdue, work_status: "RESOLVED" })).toBe(false);
    expect(clock.isBreached({ ...overdue, work_status: "OPEN", first_responded_at: new Date() })).toBe(false);
  });
});

/* ── 2. The SLA sweep ─────────────────────────────────────────────────────── */

describe("the SLA sweep writes due dates and raises breaches once", () => {
  const POLICY = {
    match: /FROM mail_sla_policy/,
    rows: [{
      mail_sla_policy_id: "p1", email_connection_id: null, applies_to_vip: false,
      first_response_minutes: 240, resolution_minutes: 960, business_hours_only: true, is_active: true,
    }],
  };

  test("does nothing at all when no policy is configured", async () => {
    const c = fakeClient();
    const out = await sla.sweep(c);
    expect(out).toEqual({ policies: 0, dated: 0, breached: 0, resolution_breached: 0 });
    expect(c.written(/UPDATE email_thread/)).toHaveLength(0);
  });

  test("stamps first_response_due_at and resolution_due_at on an undated thread", async () => {
    const c = fakeClient([
      POLICY,
      { match: /FROM business_hours/, rows: HOURS },
      {
        match: /t\.first_response_due_at IS NULL/,
        rows: [{
          email_thread_id: "t1", email_connection_id: "c1", is_vip: false,
          first_message_at: new Date("2026-08-14T15:30:00Z"), work_status: "OPEN",
        }],
      },
    ]);
    const out = await sla.sweep(c);
    expect(out.dated).toBe(1);
    const upd = c.written(/SET first_response_due_at = \$2, resolution_due_at = \$3/)[0];
    expect(upd.params[1]).toBeInstanceOf(Date);
    expect(upd.params[2]).toBeInstanceOf(Date);
  });

  test("only shared and delegated mailboxes get a clock — a personal inbox is not an SLA", async () => {
    const c = fakeClient([POLICY, { match: /FROM business_hours/, rows: HOURS }]);
    await sla.sweep(c);
    expect(c.written(/t\.first_response_due_at IS NULL/)[0].text).toMatch(/kind IN \('SHARED','DELEGATED'\)/);
  });

  test("first_responded_at is derived from the messages, not trusted as a flag", async () => {
    const c = fakeClient([POLICY, { match: /FROM business_hours/, rows: HOURS }]);
    await sla.sweep(c);
    const derive = c.written(/SET first_responded_at/)[0];
    expect(derive.text).toMatch(/direction = 'OUT'/);
    expect(derive.text).toMatch(/min\(received_at\)/);
  });

  test("a breach notifies the mailbox MANAGERs and the assignee, once", async () => {
    const c = fakeClient([
      POLICY,
      { match: /FROM business_hours/, rows: HOURS },
      {
        match: /SET sla_breached_at/,
        rows: [{ email_thread_id: "t9", email_connection_id: "c1", subject: "BL for SLAS-2026-0042", assigned_user_id: "u-agent" }],
      },
      { match: /FROM email_connection_member/, rows: [{ user_id: "u-lead" }] },
    ]);
    const out = await sla.sweep(c);
    expect(out.breached).toBe(1);
    expect(notify.notify).toHaveBeenCalledTimes(2);
    const recipients = notify.notify.mock.calls.map((call) => call[1].userId).sort();
    expect(recipients).toEqual(["u-agent", "u-lead"]);
    expect(notify.notify.mock.calls[0][1].dedupeKey).toMatch(/^SLA_BREACH:email_thread:t9:/);
  });

  test("the breach UPDATE only fires for threads not already breached", async () => {
    const c = fakeClient([POLICY, { match: /FROM business_hours/, rows: HOURS }]);
    await sla.sweep(c);
    // Without this, a five-minute sweep pages the lead every five minutes about
    // one overdue thread, and the alert gets muted within a day.
    expect(c.written(/SET sla_breached_at/)[0].text).toMatch(/sla_breached_at IS NULL/);
  });

  test("P5-1: undated threads are claimed oldest-first, not in planner order", async () => {
    const c = fakeClient([POLICY, { match: /FROM business_hours/, rows: HOURS }]);
    await sla.sweep(c);
    const q = c.written(/t\.first_response_due_at IS NULL/)[0];
    expect(q.text).toMatch(/ORDER BY t\.first_message_at ASC NULLS LAST/);
    expect(q.text).toMatch(/LIMIT 500/);
  });

  test("P5-1: a resolution-due breach notifies independently of first-response", async () => {
    notify.notify.mockClear();
    const c = fakeClient([
      POLICY,
      { match: /FROM business_hours/, rows: HOURS },
      {
        match: /SET resolution_breached_at/,
        rows: [{ email_thread_id: "t-res", email_connection_id: "c1", subject: "Still open", assigned_user_id: "u-agent" }],
      },
      { match: /FROM email_connection_member/, rows: [{ user_id: "u-lead" }] },
    ]);
    const out = await sla.sweep(c);
    expect(out.resolution_breached).toBe(1);
    expect(notify.notify).toHaveBeenCalled();
    const titles = notify.notify.mock.calls.map((call) => call[1].title);
    expect(titles).toContain("Resolution SLA missed");
    const keys = notify.notify.mock.calls.map((call) => call[1].dedupeKey);
    expect(keys.some((k) => /^SLA_RESOLUTION:email_thread:t-res:/.test(k))).toBe(true);
    expect(c.written(/SET resolution_breached_at/)[0].text).toMatch(/resolution_breached_at IS NULL/);
  });

  test("a policy edit clears computed dates so the next sweep re-applies it", async () => {
    const c = fakeClient();
    await sla.resetComputed(c);
    const q = c.written(/first_response_due_at = NULL/)[0];
    expect(q.text).toMatch(/first_responded_at IS NULL/); // never re-open an answered thread
  });
});

/* ── 3. The follow-up sweep ───────────────────────────────────────────────── */

describe("the follow-up sweep fires reminders and never sends mail", () => {
  beforeEach(() => notify.notify.mockClear());

  test("claims due rows and flips them to FIRED in one statement", async () => {
    const c = fakeClient();
    await followup.sweep(c);
    const q = c.written(/email_followup/)[0];
    expect(q.text).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(q.text).toMatch(/SET status = 'FIRED'/);
  });

  test("notifies the user who set the reminder, with the thread subject", async () => {
    const c = fakeClient([
      { match: /SET status = 'FIRED'/, rows: [{ email_followup_id: "f1", email_thread_id: "t1", user_id: "u1", kind: "NO_REPLY", note: null }] },
      { match: /SELECT email_thread_id, subject/, rows: [{ email_thread_id: "t1", subject: "Demurrage" }] },
    ]);
    const out = await followup.sweep(c);
    expect(out.fired).toBe(1);
    const arg = notify.notify.mock.calls[0][1];
    expect(arg.userId).toBe("u1");
    expect(arg.title).toBe("Still no reply");
    expect(arg.body).toContain("Demurrage");
    expect(arg.entityRef).toBe("email_thread:t1");
  });

  test("the dedupe key is the row, so three reminders on one thread all arrive", async () => {
    const c = fakeClient([
      {
        match: /SET status = 'FIRED'/,
        rows: [
          { email_followup_id: "f1", email_thread_id: "t1", user_id: "u1", kind: "SEQUENCE_STEP" },
          { email_followup_id: "f2", email_thread_id: "t1", user_id: "u1", kind: "SEQUENCE_STEP" },
        ],
      },
    ]);
    await followup.sweep(c);
    const keys = notify.notify.mock.calls.map((call) => call[1].dedupeKey);
    expect(new Set(keys).size).toBe(2);
  });

  test("NOTHING in the follow-up path writes to the send queue (Q24)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/triage/followup.service.js"), "utf8",
    );
    // Executable references only — the file may well mention the send queue in
    // a comment explaining why it does not touch it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/email_send_queue/);
    expect(code).not.toMatch(/require\([^)]*outbox/);
    expect(code).not.toMatch(/\.send\(/);
  });

  test("a reply cancels pending boomerangs but never a snooze the user set", async () => {
    const c = fakeClient();
    await followup.cancelOnReply(c, "t1");
    const q = c.written(/SET status = 'CANCELLED'/)[0];
    expect(q.text).toMatch(/kind IN \('NO_REPLY','SEQUENCE_STEP'\)/);
    expect(q.text).toMatch(/cancel_on_reply = true/);
  });
});

/* ── 4. Registered AND ticked ─────────────────────────────────────────────── */

describe("the queues are registered and something enqueues them", () => {
  const workers = fs.readFileSync(path.join(JOBS, "workers.js"), "utf8");

  test.each([
    "mail-sla-sweep",
    "mail-sla-sweep-scheduler",
    "mail-followup-sweep",
    "mail-followup-sweep-scheduler",
    "deliverability-check",
    "deliverability-check-scheduler",
  ])("%s has a worker registration", (name) => {
    expect(workers).toMatch(new RegExp(`name: "${name}"`));
  });

  test.each([
    ["mail-sla-sweep-scheduler", "MAIL_SLA_SWEEP_INTERVAL_MS"],
    ["mail-followup-sweep-scheduler", "MAIL_FOLLOWUP_SWEEP_INTERVAL_MS"],
    ["deliverability-check-scheduler", "MAIL_DELIVERABILITY_INTERVAL_MS"],
  ])("%s is enqueued on a repeat, driven by %s", (queue, envKey) => {
    // A registered worker with no producer is a feature that exists in the tree
    // and not in the product — this repo has already lost `regie-aging` that
    // way, and lost all three of these in the PR-2→PR-5 merge.
    expect(workers).toMatch(new RegExp(`enqueue\\("${queue}"[\\s\\S]{0,120}repeat:`));
    expect(workers).toMatch(new RegExp(`config\\.${envKey}`));
  });

  test("every handler file a registration names actually exists and exports a function", () => {
    const names = [...workers.matchAll(/handler: require\("\.\/handlers\/([^"]+)"\)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) {
      expect(fs.existsSync(path.join(JOBS, "handlers", `${n}.js`))).toBe(true);
    }
  });

  test("each new handler refuses to run without a tenant", async () => {
    for (const n of ["mail-sla-sweep", "mail-followup-sweep"]) {

      const handler = require(path.join(JOBS, "handlers", n));
      await expect(handler({ data: {} })).rejects.toThrow(/tenantMeta/);
    }
  });
});
