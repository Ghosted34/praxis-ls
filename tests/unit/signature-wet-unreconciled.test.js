"use strict";

/**
 * §8.8 CRITERION 7 — the unreconciled control.
 *
 *   "A print job untouched for longer than `unreconciled_days` raises exactly
 *    one RED `signature.wet_unreconciled` flag; reconciling it clears the flag
 *    on the next checker run."
 *
 * This is the criterion that turns Tier 4 from "we printed it and hoped" into
 * an auditable control (§8.7), and it was the last of §8.8's eight with no
 * test. The others are covered in signature-wet-reconciliation.test.js and
 * signature-wet-wiring.test.js.
 *
 * Both halves of the sentence are asserted, and the second half matters more:
 * a rule that raises is easy, a rule that CLEARS is what stops an operator
 * learning to ignore the flags screen. Clearing is not code in the wet module
 * at all — compliance_flag.service.run clears each rule's open flags and
 * re-raises from a fresh scan, so "reconciled" clears a flag by no longer
 * appearing in the scan. That is only true if the scan reads the job's live
 * state, so the run loop is exercised here rather than trusted.
 */

const { severityOf, ruleKeys } = require("../../src/modules/vault/compliance_flag/compliance_flag.rules");

const RULE = "signature.wet_unreconciled";
const DAY = 24 * 60 * 60 * 1000;

/**
 * Print jobs as the repo would return them. `unreconciled()` filters in SQL —
 * `status IN ('ISSUED','PRINTED') AND created_at < now() - $1 days` — so the
 * stub applies exactly that predicate rather than returning a fixed list, and
 * a test that changes the status or the age gets the real consequence.
 */
function repoWith(jobs) {
  return {
    unreconciled: jest.fn(async (_client, days) =>
      jobs
        .filter((j) => ["ISSUED", "PRINTED"].includes(j.status))
        .filter((j) => j.created_at < new Date(Date.now() - days * DAY))
        .sort((a, b) => a.created_at - b.created_at)),
  };
}

function loadWith({ jobs, days = 7 }) {
  jest.resetModules();
  const repo = repoWith(jobs);
  jest.doMock("../../src/modules/vault/signature_wet/signature_wet.repo", () => repo);
  jest.doMock("../../src/shared/config/settings", () => ({ getSetting: jest.fn(async () => days) }));
  const service = require("../../src/modules/vault/signature_wet/signature_wet.service");
  return { service, repo };
}

const job = (over = {}) => ({
  print_job_id: "job-1",
  entity_ref: "delivery_note:DN-2026-0042",
  doc_type: "DELIVERY_NOTE",
  status: "PRINTED",
  created_at: new Date(Date.now() - 30 * DAY),
  ...over,
});

describe("§8.7 the unreconciled wet-signature control", () => {
  test("the rule is RED and in the catalogue the checker iterates", () => {
    // A rule the catalogue does not list is never scanned: compliance_flag
    // .service.run iterates ruleKeys(). Severity is the difference between a
    // control and a note.
    expect(ruleKeys()).toContain(RULE);
    expect(severityOf(RULE)).toBe("RED");
  });

  test("an overdue printed job produces exactly one offender, named and dated", async () => {
    const { service } = loadWith({ jobs: [job()] });
    const out = await service.unreconciledOffenders({});

    expect(out).toHaveLength(1);
    expect(out[0].entity_ref).toBe("signature_print_job:job-1");
    // §8.7 fixes the wording: doc type, reference, the date it was printed.
    // An operator who cannot tell WHICH delivery note has not come back
    // cannot act on the flag.
    expect(out[0].message).toContain("DELIVERY_NOTE");
    expect(out[0].message).toContain("delivery_note:DN-2026-0042");
    expect(out[0].message).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(out[0].message).toContain("has not come back");
  });

  test("one job raises one flag, not one per checker run", async () => {
    const { service } = loadWith({ jobs: [job()] });
    // Idempotence at the scan level. The service clears and re-raises, so a
    // scan that returned a row per elapsed day would still LOOK right after
    // one run and produce a growing pile after five.
    const first = await service.unreconciledOffenders({});
    const second = await service.unreconciledOffenders({});
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].entity_ref).toBe(first[0].entity_ref);
  });

  test("a job inside the window is not yet overdue", async () => {
    const { service } = loadWith({ jobs: [job({ created_at: new Date(Date.now() - 3 * DAY) })], days: 7 });
    expect(await service.unreconciledOffenders({})).toHaveLength(0);
  });

  test("the tenant's unreconciled_days setting is what decides overdue", async () => {
    const tenDayOldJob = [job({ created_at: new Date(Date.now() - 10 * DAY) })];
    // The control is tenant-tunable (§8.7). A tenant on a 14-day cycle must
    // not be flagged at 10, and one on 7 days must be.
    expect(await loadWith({ jobs: tenDayOldJob, days: 14 }).service.unreconciledOffenders({})).toHaveLength(0);
    expect(await loadWith({ jobs: tenDayOldJob, days: 7 }).service.unreconciledOffenders({})).toHaveLength(1);
  });

  test("a nonsense setting falls back to seven days rather than flagging everything", async () => {
    // getSetting reads a jsonb column a human can edit. A negative or
    // unparseable value must not turn the control into noise on every job.
    const { service, repo } = loadWith({ jobs: [job()], days: "not-a-number" });
    await service.unreconciledOffenders({});
    expect(repo.unreconciled).toHaveBeenCalledWith({}, 7);
  });

  test.each([
    ["RECONCILED", "the scan came back and was matched"],
    ["REJECTED", "an operator rejected the returned scan"],
    ["VOIDED", "the print job was voided"],
  ])("a %s job raises nothing — %s", async (status) => {
    const { service } = loadWith({ jobs: [job({ status })] });
    expect(await service.unreconciledOffenders({})).toHaveLength(0);
  });

  test("reconciling clears the flag on the next checker run", async () => {
    // The whole second half of criterion 7, through the real run loop.
    jest.resetModules();

    const flags = [];
    let jobStatus = "PRINTED";

    const complianceRepo = {
      clearOpenByRule: jest.fn(async () => { flags.length = 0; }),
      scan: jest.fn(async (_client, ruleKey) => {
        if (ruleKey !== RULE) return [];
        // Delegating to the wet service is what compliance_flag.repo does;
        // the point under test is that the answer tracks the job's live state.
        return jobStatus === "PRINTED"
          ? [{ entity_ref: "signature_print_job:job-1", message: "DELIVERY_NOTE delivery_note:DN-2026-0042 …" }]
          : [];
      }),
      insertFlag: jest.fn(async (_client, f) => { flags.push(f); return { ...f, flag_id: `flag-${flags.length}` }; }),
    };

    jest.doMock("../../src/modules/vault/compliance_flag/compliance_flag.repo", () => complianceRepo);
    jest.doMock("../../src/shared/events/emit", () => ({
      emitEvent: jest.fn(async () => null),
      audit: jest.fn(async () => null),
    }));

    const compliance = require("../../src/modules/vault/compliance_flag/compliance_flag.service");
    const client = { query: jest.fn(async () => ({ rows: [] })) };

    const before = await compliance.run(client, { rules: [RULE] });
    expect(before.flags).toHaveLength(1);
    expect(before.flags[0].severity).toBe("RED");
    expect(before.flags[0].rule_key).toBe(RULE);

    // The scan comes back and reconciles the job.
    jobStatus = "RECONCILED";

    const after = await compliance.run(client, { rules: [RULE] });
    expect(after.flags).toHaveLength(0);
    // Cleared, not merely un-re-raised: the prior run's open flags are dropped
    // first, which is why resolving the data is enough and no wet-module code
    // has to remember to close anything.
    expect(complianceRepo.clearOpenByRule).toHaveBeenCalledTimes(2);
    expect(flags).toHaveLength(0);
  });
});
