/**
 * Scheduled send and recipient-local delivery (§9.3, §9.11, §9.10 criterion 5).
 *
 * The send queue already had `release_at` and a flusher that drains what is
 * due; undo-send is that mechanism with a 20-second delay. Scheduling was
 * "nearly free once the send queue exists" (§1.4) and had simply never been
 * wired: `POST /mail/send` accepted no `send_at`, and `party.timezone` from
 * migration 10757 was read by nothing.
 *
 * Two claims are load-bearing here and neither is obvious from the signature:
 *
 *   1. DST is handled by the ZONE, not an offset. 09:00 Paris is 07:00Z in
 *      July and 08:00Z in January, and the criterion names that explicitly.
 *   2. Exactly ONE of scheduling and undo-send decides `release_at`. If both
 *      did, a message scheduled for Tuesday would also be undoable for twenty
 *      seconds and then not for six days — which is neither feature.
 *
 * And one negative claim, which §9.3 states as a MUST NOT: there is no "best
 * time to send". Q32 removed the open data that would need, and the code must
 * not pretend otherwise.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const schedule = require("../../src/modules/mail/mail/schedule");

function fakeClient(answers = []) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  };
}

const tzRow = (timezone) => ({ match: /FROM client_master/, rows: [{ timezone }] });

describe("an explicit send_at", () => {
  const now = new Date("2026-08-20T10:00:00Z");

  test("is taken as given", async () => {
    const at = "2026-08-25T14:30:00.000Z";
    const out = await schedule.resolveReleaseAt(fakeClient(), { send_at: at }, { now });
    expect(out.reason).toBe("EXPLICIT");
    expect(out.releaseAt.toISOString()).toBe(at);
  });

  test("in the past is refused — it would send immediately and look scheduled", async () => {
    await expect(
      schedule.resolveReleaseAt(fakeClient(), { send_at: "2026-08-19T10:00:00Z" }, { now }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("beyond 90 days is refused, and the message says why", async () => {
    // The payload is frozen at enqueue: a year-out schedule sends a message
    // written under a job title, an address and a price list that no longer
    // exist, and nobody would remember queuing it.
    await expect(
      schedule.resolveReleaseAt(fakeClient(), { send_at: "2027-08-20T10:00:00Z" }, { now }),
    ).rejects.toThrow(/90 days/);
  });

  test("a nonsense date is refused rather than becoming Invalid Date", async () => {
    await expect(
      schedule.resolveReleaseAt(fakeClient(), { send_at: "next tuesday" }, { now }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("the recipient's morning is a timezone conversion, not a prediction", () => {
  test("09:00 Paris is 07:00Z in summer", async () => {
    const out = await schedule.resolveReleaseAt(
      fakeClient([tzRow("Europe/Paris")]),
      { send_in_recipient_morning: true },
      { now: new Date("2026-07-14T04:00:00Z"), to: ["ops@paris.fr"] },
    );
    expect(out.releaseAt.toISOString()).toBe("2026-07-14T07:00:00.000Z");
  });

  test("and 08:00Z in winter — §9.10 criterion 5, handled by the IANA zone", async () => {
    const out = await schedule.resolveReleaseAt(
      fakeClient([tzRow("Europe/Paris")]),
      { send_in_recipient_morning: true },
      { now: new Date("2026-01-14T04:00:00Z"), to: ["ops@paris.fr"] },
    );
    expect(out.releaseAt.toISOString()).toBe("2026-01-14T08:00:00.000Z");
    // A fixed offset would have produced the same answer in both seasons, and
    // been an hour wrong in one of them for half the year.
  });

  test("asking after 09:00 their time means TOMORROW morning", async () => {
    const out = await schedule.resolveReleaseAt(
      fakeClient([tzRow("Europe/Paris")]),
      { send_in_recipient_morning: true },
      { now: new Date("2026-07-14T12:00:00Z"), to: ["ops@paris.fr"] }, // 14:00 Paris
    );
    expect(out.releaseAt.toISOString()).toBe("2026-07-15T07:00:00.000Z");
    // "Today's 09:00" would already have passed: the operator believes it is
    // scheduled and it has in fact gone.
  });

  test("the note says plainly what will happen", async () => {
    const out = await schedule.resolveReleaseAt(
      fakeClient([tzRow("Europe/Paris")]),
      { send_in_recipient_morning: true },
      { now: new Date("2026-07-14T04:00:00Z"), to: ["ops@paris.fr"] },
    );
    expect(out.note).toMatch(/09:00 Paris time/);
  });

  test("no timezone on file is REPORTED, never guessed", async () => {
    // A guessed timezone sends a "good morning" at three in the morning, which
    // is worse than sending it now.
    await expect(
      schedule.resolveReleaseAt(fakeClient(), { send_in_recipient_morning: true }, { to: ["x@unknown.cm"] }),
    ).rejects.toMatchObject({ code: "NO_RECIPIENT_TIMEZONE", status: 422 });
  });

  test("a zone ICU does not know is treated as no zone, not as UTC", async () => {
    await expect(
      schedule.resolveReleaseAt(
        fakeClient([tzRow("Mars/Olympus_Mons")]),
        { send_in_recipient_morning: true },
        { to: ["x@y.cm"] },
      ),
    ).rejects.toMatchObject({ code: "NO_RECIPIENT_TIMEZONE" });
  });

  test("the address is matched before the domain", async () => {
    const c = fakeClient([tzRow("Europe/Paris")]);
    await schedule.resolveReleaseAt(c, { send_in_recipient_morning: true }, { to: ["a@b.cm"] });
    const sql = c.calls[0].text;
    // Exact address wins over a domain match, so one contact in another country
    // does not inherit the head office's clock.
    expect(sql).toMatch(/1 AS rank/);
    expect(sql).toMatch(/ORDER BY rank/);
  });

  test("leads count as parties too — a first quote is scheduled like any other", async () => {
    const c = fakeClient();
    await schedule.recipientTimezone(c, "x@y.cm");
    expect(c.calls[0].text).toMatch(/FROM lead/);
  });
});

describe("scheduling and undo-send do not both decide release_at", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../src/modules/mail/mail/outbox.service.js"), "utf8",
  );

  test("the send path consults the scheduler", () => {
    expect(src).toMatch(/schedule\.resolveReleaseAt\(client, input/);
  });

  test("a scheduled release wins over the undo window", () => {
    expect(src).toMatch(/scheduled \? scheduled\.releaseAt : new Date\(Date\.now\(\) \+ seconds \* 1000\)/);
  });

  test("a scheduled message reports NO undo window", () => {
    // Otherwise the composer shows a 20-second "Undo" countdown for a message
    // going out on Tuesday.
    expect(src).toMatch(/undo_seconds: scheduled \? 0 : seconds/);
  });

  test("an immediate send is unaffected — the scheduler returns null", async () => {
    expect(await schedule.resolveReleaseAt(fakeClient(), {}, {})).toBeNull();
  });
});

describe("there is no 'best time to send' (§9.3 MUST NOT, Q32)", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../src/modules/mail/mail/schedule.js"), "utf8",
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("nothing here models, predicts or recommends a time", () => {
    for (const forbidden of [/open[_ ]?rate/i, /best[_ ]?time/i, /engagement/i, /predict/i, /optimal/i]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  test("the validator accepts exactly two shapes and no third", () => {
    const v = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/mail/mail.validator.js"), "utf8",
    );
    expect(v).toMatch(/send_at:/);
    expect(v).toMatch(/send_in_recipient_morning:/);
    expect(v).not.toMatch(/best_time|optimal_time|smart_send/);
  });

  test("asking for both at once is refused — they are different decisions", () => {
    const { schemas } = require("../../src/modules/mail/mail/mail.validator");
    const r = schemas.send.safeParse({
      connectionId: "11111111-1111-4111-8111-111111111111",
      to: ["a@b.cm"], subject: "x",
      send_at: "2026-08-25T14:30:00.000Z",
      send_in_recipient_morning: true,
    });
    expect(r.success).toBe(false);
  });
});
