/**
 * PR-5's administration surface (§9.9), and the rules attached to it.
 *
 * Ten endpoints from §9.9 did not exist. Most are ordinary CRUD; the ones that
 * are not are the reason this file is long, because each carries a rule that is
 * invisible in the route signature and silent when it breaks:
 *
 *   · a lock must never be STOLEN from a colleague who is still typing, and
 *     must never BLOCK one who has stopped;
 *   · a policy edit applies to the queue, not only to future mail;
 *   · `ADMIN_VERIFIED` is the only source an API may write, or the ingest path
 *     can launder itself into trust;
 *   · a snooze belongs to the person who set it.
 */
"use strict";

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
  resolveActorId: async (_c, id) => id || null,
}));

const { audit } = require("../../src/shared/events/emit");
const workflow = require("../../src/modules/mail/triage/workflow.service");

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

const ME = { user_id: "u-me" };
beforeEach(() => jest.clearAllMocks());

/* ── Soft locks ───────────────────────────────────────────────────────────── */

describe("soft locks are advisory, never a block", () => {
  const lockRow = (userId, secondsAhead = 120) => ({
    match: /INSERT INTO email_thread_lock/,
    rows: [{
      email_thread_id: "t-1", user_id: userId,
      expires_at: new Date(Date.now() + secondsAhead * 1000),
    }],
  });

  test("taking a free lock gives it to me", async () => {
    const c = fakeClient([lockRow("u-me")]);
    const out = await workflow.takeLock(c, "t-1", ME);
    expect(out.held_by_me).toBe(true);
    expect(out.held_by_other).toBe(false);
    expect(out.seconds_remaining).toBeGreaterThan(0);
  });

  test("a colleague's live lock is REPORTED, not an error", async () => {
    const c = fakeClient([
      lockRow("u-marie"),
      { match: /SELECT full_name FROM app_user/, rows: [{ full_name: "Marie" }] },
    ]);
    const out = await workflow.takeLock(c, "t-1", ME);
    // §9.2: "advisory, never a hard block, because a stale lock that blocks a
    // customer reply is worse than a duplicated one." The composer says who and
    // offers to continue anyway.
    expect(out.held_by_other).toBe(true);
    expect(out.holder_name).toBe("Marie");
  });

  test("the SQL refuses to steal a live lock but takes an expired one", async () => {
    const c = fakeClient([lockRow("u-me")]);
    await workflow.takeLock(c, "t-1", ME);
    const sql = c.written(/INSERT INTO email_thread_lock/)[0].text;
    // The condition that makes it safe: replace the holder only when the lock
    // has expired, or when it is already mine (the heartbeat case).
    expect(sql).toMatch(/expires_at <= now\(\)/);
    expect(sql).toMatch(/user_id = EXCLUDED\.user_id/);
  });

  test("take and heartbeat are the same call — one thing for the client to poll", async () => {
    const c = fakeClient([lockRow("u-me")]);
    await workflow.takeLock(c, "t-1", ME);
    await workflow.takeLock(c, "t-1", ME);
    expect(c.written(/INSERT INTO email_thread_lock/)).toHaveLength(2);
  });

  test("releasing only ever releases MY lock", async () => {
    const c = fakeClient();
    await workflow.releaseLock(c, "t-1", ME);
    const q = c.written(/DELETE FROM email_thread_lock/)[0];
    expect(q.text).toMatch(/user_id = \$2/);
    expect(q.params).toEqual(["t-1", "u-me"]);
  });

  test("a lock needs a holder", async () => {
    await expect(workflow.takeLock(fakeClient(), "t-1", {})).rejects.toMatchObject({ status: 422 });
  });
});

/* ── SLA policy ───────────────────────────────────────────────────────────── */

describe("editing a policy applies it to the threads already waiting", () => {
  const created = { match: /INSERT INTO mail_sla_policy/, rows: [{ mail_sla_policy_id: "p-1", name: "VIP" }] };
  const updated = { match: /UPDATE mail_sla_policy/, rows: [{ mail_sla_policy_id: "p-1", name: "VIP" }] };

  test("creating clears the computed due dates", async () => {
    const c = fakeClient([created]);
    await workflow.createPolicy(c, { name: "VIP", first_response_minutes: 60, resolution_minutes: 960 }, ME);
    expect(c.written(/first_response_due_at = NULL/)).toHaveLength(1);
  });

  test("updating clears them too — the change means the queue, not just new mail", async () => {
    const c = fakeClient([updated]);
    await workflow.updatePolicy(c, "p-1", { first_response_minutes: 60 }, ME);
    // A lead who shortens the VIP promise from four hours to one means the
    // threads sitting in the queue right now.
    expect(c.written(/first_response_due_at = NULL/)).toHaveLength(1);
  });

  test("the reset never re-opens a thread that was already answered", async () => {
    const c = fakeClient([updated]);
    await workflow.updatePolicy(c, "p-1", { first_response_minutes: 60 }, ME);
    expect(c.written(/first_response_due_at = NULL/)[0].text).toMatch(/first_responded_at IS NULL/);
  });

  test("both are audited", async () => {
    await workflow.createPolicy(fakeClient([created]), { name: "V", first_response_minutes: 1, resolution_minutes: 2 }, ME);
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "mail.sla_policy.created", actorUserId: "u-me",
    }));
  });

  test("an empty patch is refused rather than silently doing nothing", async () => {
    await expect(workflow.updatePolicy(fakeClient(), "p-1", {}, ME)).rejects.toMatchObject({ status: 422 });
  });

  test("a patch for a policy that does not exist is a 404", async () => {
    await expect(workflow.updatePolicy(fakeClient(), "p-1", { name: "x" }, ME)).rejects.toMatchObject({ status: 404 });
  });
});

/* ── The business calendar ────────────────────────────────────────────────── */

describe("the business calendar is edited as a week", () => {
  test("PUT replaces the week and re-arms the clocks", async () => {
    const c = fakeClient();
    await workflow.putBusinessHours(c, [
      { day_of_week: 1, opens_at: "08:00", closes_at: "17:00" },
      { day_of_week: 2, opens_at: "08:00", closes_at: "17:00" },
    ], ME);
    expect(c.written(/DELETE FROM business_hours/)).toHaveLength(1);
    expect(c.written(/INSERT INTO business_hours/)).toHaveLength(2);
    // Closing on Saturday changes every due date computed against it.
    expect(c.written(/first_response_due_at = NULL/)).toHaveLength(1);
  });

  test("a day with no timezone falls back to the tenant's, not to UTC", async () => {
    const c = fakeClient();
    await workflow.putBusinessHours(c, [{ day_of_week: 1, opens_at: "08:00", closes_at: "17:00" }], ME);
    expect(c.written(/INSERT INTO business_hours/)[0].text).toMatch(/'Africa\/Douala'/);
  });

  test("holidays likewise", async () => {
    const c = fakeClient();
    await workflow.putHolidays(c, [{ holiday_on: "2026-12-25", name: "Christmas" }], ME);
    expect(c.written(/DELETE FROM business_holiday/)).toHaveLength(1);
    expect(c.written(/first_response_due_at = NULL/)).toHaveLength(1);
  });

  test("a non-list is refused", async () => {
    await expect(workflow.putBusinessHours(fakeClient(), "monday", ME)).rejects.toMatchObject({ status: 422 });
  });
});

/* ── Thread sharing ───────────────────────────────────────────────────────── */

describe("sharing one Private thread with one colleague", () => {
  // C-1. `assertMaySteward` now runs before any share write. The caller is
  // the mailbox owner of a PRIVATE thread, which is the only person who may
  // hand one out.
  const steward = {
    match: /SELECT t\.visibility, c\.owner_user_id/,
    rows: [{ visibility: "PRIVATE", owner_user_id: "u-me", is_sharee: false }],
  };
  const shared = { match: /INSERT INTO email_thread_share/, rows: [{ email_thread_id: "t-1", user_id: "u-marie" }] };

  test("it is recorded with who granted it", async () => {
    const c = fakeClient([steward, shared]);
    await workflow.shareThread(c, "t-1", "u-marie", ME);
    expect(c.written(/INSERT INTO email_thread_share/)[0].params).toEqual(["t-1", "u-marie", "u-me"]);
  });

  test("it is audited as sensitive — a share is a disclosure", async () => {
    await workflow.shareThread(fakeClient([steward, shared]), "t-1", "u-marie", ME);
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "mail.thread.shared", isSensitive: true,
    }));
  });

  test("re-sharing is idempotent rather than an error", async () => {
    const c = fakeClient([steward, shared]);
    await workflow.shareThread(c, "t-1", "u-marie", ME);
    expect(c.written(/INSERT INTO email_thread_share/)[0].text).toMatch(/ON CONFLICT/);
  });

  test("withdrawing is audited too", async () => {
    await workflow.unshareThread(fakeClient([steward]), "t-1", "u-marie", ME);
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "mail.thread.unshared",
    }));
  });

  test("a mailbox member who is not the owner cannot hand a Private thread out", async () => {
    const c = fakeClient([{
      match: /SELECT t\.visibility, c\.owner_user_id/,
      rows: [{ visibility: "PRIVATE", owner_user_id: "u-owner", is_sharee: false }],
    }]);
    await expect(workflow.shareThread(c, "t-1", "u-marie", ME)).rejects.toMatchObject({ status: 404 });
    expect(c.written(/INSERT INTO email_thread_share/)).toHaveLength(0);
  });

  test("sharing with nobody is refused", async () => {
    await expect(workflow.shareThread(fakeClient(), "t-1", null, ME)).rejects.toMatchObject({ status: 422 });
  });

  /* The other two halves of C-1. `shareThread` is the obvious one and is
   * covered above; these are the two the finding also named and that are easy
   * to leave behind, because neither looks like a grant. */

  const notMine = [{
    match: /SELECT t\.visibility, c\.owner_user_id/,
    rows: [{ visibility: "PRIVATE", owner_user_id: "u-owner", is_sharee: false }],
  }];

  test("a non-owner cannot revoke somebody else's share", async () => {
    // Unshare is the half that ERASES evidence: an operator who granted
    // themselves sight and then withdrew it leaves the table exactly as they
    // found it. If anyone with edit rights can call this, the ledger row is
    // the only trace and the attacker chose when to write it.
    const c = fakeClient(notMine);
    await expect(workflow.unshareThread(c, "t-1", "u-marie", ME)).rejects.toMatchObject({ status: 404 });
    expect(c.written(/DELETE FROM email_thread_share/)).toHaveLength(0);
  });

  test("nor read who has been let in", async () => {
    // The share list is a disclosure in its own right — it names the people
    // trusted with a Private conversation.
    await expect(workflow.listShares(fakeClient(notMine), "t-1", ME))
      .rejects.toMatchObject({ status: 404 });
  });

  test("the refusal is NOT_FOUND, not FORBIDDEN", async () => {
    // A 403 would confirm that this specific Private thread exists and that
    // the caller merely is not its steward. For a conversation whose existence
    // is the sensitive part, that is most of the disclosure.
    const err = await workflow.shareThread(fakeClient(notMine), "t-1", "u-marie", ME).catch((e) => e);
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });

  test("a TEAM thread needs no stewardship — nothing is disclosed by sharing it", async () => {
    // Guards the other direction: over-gating would break the ordinary "put
    // this on Marie's radar" case for no security gain, because a share row on
    // a thread the team can already read grants nothing.
    const c = fakeClient([
      { match: /SELECT t\.visibility, c\.owner_user_id/,
        rows: [{ visibility: "TEAM", owner_user_id: "u-owner", is_sharee: false }] },
      shared,
    ]);
    await workflow.shareThread(c, "t-1", "u-marie", ME);
    expect(c.written(/INSERT INTO email_thread_share/)).toHaveLength(1);
  });

  test("an existing sharee may pass it on — that is what makes PRIVATE usable", async () => {
    const c = fakeClient([
      { match: /SELECT t\.visibility, c\.owner_user_id/,
        rows: [{ visibility: "PRIVATE", owner_user_id: "u-owner", is_sharee: true }] },
      shared,
    ]);
    await workflow.shareThread(c, "t-1", "u-marie", ME);
    expect(c.written(/INSERT INTO email_thread_share/)).toHaveLength(1);
  });
});

/* ── Verified domains ─────────────────────────────────────────────────────── */

describe("only a human can verify a domain", () => {
  const verified = {
    match: /INSERT INTO party_verified_domain/,
    rows: [{ party_verified_domain_id: "d-1", domain: "camrail.cm", party_kind: "CLIENT", party_id: "c-1" }],
  };

  test("the API can only ever write ADMIN_VERIFIED", async () => {
    const c = fakeClient([verified]);
    await workflow.verifyDomain(c, { partyKind: "client", partyId: "c-1", domain: "Camrail.CM" }, ME);
    const sql = c.written(/INSERT INTO party_verified_domain/)[0];
    // §9.7: OBSERVED "never confers VERIFIED on its own — that requires a human,
    // in the UI, once". An endpoint that could set OBSERVED would let the ingest
    // path launder itself into trust.
    expect(sql.text).toMatch(/'ADMIN_VERIFIED'/);
    expect(sql.text).not.toMatch(/'OBSERVED'/);
  });

  test("the domain is normalised, so Camrail.CM and camrail.cm are one row", async () => {
    const c = fakeClient([verified]);
    await workflow.verifyDomain(c, { partyKind: "client", partyId: "c-1", domain: "  Camrail.CM " }, ME);
    expect(c.written(/INSERT INTO party_verified_domain/)[0].params[2]).toBe("camrail.cm");
  });

  test("verifying names the human who did it", async () => {
    const c = fakeClient([verified]);
    await workflow.verifyDomain(c, { partyKind: "CLIENT", partyId: "c-1", domain: "camrail.cm" }, ME);
    expect(c.written(/INSERT INTO party_verified_domain/)[0].params[3]).toBe("u-me");
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "mail.domain.verified", isSensitive: true,
    }));
  });

  test("WITHDRAWING trust is audited as heavily as granting it", async () => {
    const c = fakeClient([{
      match: /DELETE FROM party_verified_domain/,
      rows: [{ party_kind: "CLIENT", party_id: "c-1", domain: "camrail.cm" }],
    }]);
    await workflow.unverifyDomain(c, "d-1", ME);
    // A domain that quietly stops being verified is how a lookalike gets a clean
    // banner, and it is the change an attacker with a foothold would most like
    // to make without anyone noticing.
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "mail.domain.unverified", isSensitive: true,
    }));
  });

  test("incomplete input is refused", async () => {
    await expect(
      workflow.verifyDomain(fakeClient(), { partyKind: "CLIENT", partyId: null, domain: "x.cm" }, ME),
    ).rejects.toMatchObject({ status: 422 });
  });
});

/* ── Bounces ──────────────────────────────────────────────────────────────── */

describe("bounces the composer can warn about", () => {
  test("the pre-send check returns only addresses worth warning about", async () => {
    const c = fakeClient([{
      match: /FROM client_contact/,
      rows: [{ email: "thierry@camrail.cm", email_status: "HARD_FAILED" }],
    }]);
    const out = await workflow.addressStatus(c, ["Thierry@Camrail.cm", "ok@x.cm"]);
    expect(out).toEqual([{ email: "thierry@camrail.cm", email_status: "HARD_FAILED" }]);
    expect(c.written(/email_status <> 'OK'/).length).toBeGreaterThan(0);
  });

  test("it lowercases and de-duplicates before asking", async () => {
    const c = fakeClient();
    await workflow.addressStatus(c, ["A@B.cm", "a@b.cm", "A@B.CM"]);
    expect(c.calls[0].params[0]).toEqual(["a@b.cm"]);
  });

  test("no addresses means no query at all", async () => {
    const c = fakeClient();
    expect(await workflow.addressStatus(c, [])).toEqual([]);
    expect(c.calls).toHaveLength(0);
  });

  test("A CHECK THAT COULD NOT RUN DOES NOT REPORT A CLEAN LIST", async () => {
    // This used to end `.catch(() => [])`, so a failed query and a clean
    // recipient list produced the identical answer — on the one endpoint whose
    // whole job is to say "do not send to this address". §13.5's rule for
    // anti-spoof verdicts applies verbatim here: an absent verdict renders
    // nothing, never a green tick. The composer treats a rejection as "not
    // checked" and shows nothing, and never blocks the send either way.
    const broken = { query: async () => { throw new Error("relation does not exist"); } };
    await expect(workflow.addressStatus(broken, ["a@b.cm"])).rejects.toThrow(/relation does not exist/);
  });
});

/* ── Follow-ups ───────────────────────────────────────────────────────────── */

describe("a follow-up belongs to the person who set it", () => {
  test("cancelling is scoped to the owner", async () => {
    const c = fakeClient([{ match: /SET status = 'CANCELLED'/, rows: [{ email_followup_id: "f-1" }] }]);
    await workflow.cancelFollowup(c, "f-1", ME);
    const q = c.written(/SET status = 'CANCELLED'/)[0];
    // A colleague cancelling your snooze means the thread never comes back for
    // someone who is still expecting it.
    expect(q.text).toMatch(/user_id = \$2/);
    expect(q.params).toEqual(["f-1", "u-me"]);
  });

  test("cancelling someone else's is a 404, not a silent no-op", async () => {
    await expect(workflow.cancelFollowup(fakeClient(), "f-1", ME)).rejects.toMatchObject({ status: 404 });
  });

  test("the list is the caller's own pending ones", async () => {
    const c = fakeClient();
    await workflow.listFollowups(c, ME);
    expect(c.calls[0].text).toMatch(/f\.user_id = \$1/);
    expect(c.calls[0].text).toMatch(/status = 'PENDING'/);
  });
});
