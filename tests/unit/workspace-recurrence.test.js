/**
 * recurrence — the RRULE subset the repeat picker can produce (13840).
 *
 * ── WHY THE ZONE CASES ARE THE POINT ───────────────────────────────────────
 *
 * Every expectation here was computed from the IANA offset for that zone on
 * that date rather than read off the code, for the reason workspace.time.test.js
 * gives: an engine that does its month arithmetic in UTC passes every test
 * written in UTC and drifts by an hour — or, across a month boundary, by a day —
 * for every tenant not on UTC+0. "The 14th of every month" landing on the 13th
 * is not a rendering bug; the stored instant is wrong.
 *
 * The Europe/London case below is the one that fails loudly: 09:00 in Douala is
 * always 08:00Z because Cameroon has no DST, but 09:00 in London is 08:00Z in
 * October and 09:00Z in November. A monthly repeat that kept the INSTANT rather
 * than the WALL CLOCK would fire at 10:00 local from November onward.
 */
"use strict";

const {
  parseRule,
  canonicalise,
  nextOccurrence,
  weekdayName,
  RecurrenceError,
  MAX_STEPS,
} = require("../../src/modules/dashboard/workspace/recurrence");

const DOUALA = "Africa/Douala"; // UTC+1, no DST
const LONDON = "Europe/London"; // BST (UTC+1) → GMT (UTC+0) on 25 Oct 2026

describe("nextOccurrence — monthly, the case the feature exists for", () => {
  it("lands on the same day of the next month, at the same wall-clock time", () => {
    // 14 Sep 2026 17:00 in Douala is 16:00Z; 14 Oct 17:00 is also 16:00Z.
    expect(
      nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=14", {
        after: "2026-09-14T16:00:00.000Z",
        timeZone: DOUALA,
      }),
    ).toBe("2026-10-14T16:00:00.000Z");
  });

  it("chains: each step from the previous occurrence, not from a fixed epoch", () => {
    let at = "2026-09-14T16:00:00.000Z";
    const seen = [];
    for (let i = 0; i < 4; i += 1) {
      at = nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=14", { after: at, timeZone: DOUALA });
      seen.push(at.slice(0, 10));
    }
    expect(seen).toEqual(["2026-10-14", "2026-11-14", "2026-12-14", "2027-01-14"]);
  });

  it("skips a month that does not have the day, rather than clipping to its last", () => {
    // 31 January 2026 → February has 28 days → 31 March. Clipping to 28
    // February would move the deadline three days EARLIER and then never move
    // it back, because the next step would anchor on the 28th.
    expect(
      nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=31", {
        after: "2026-01-31T16:00:00.000Z",
        timeZone: DOUALA,
      }),
    ).toBe("2026-03-31T16:00:00.000Z");
  });

  it("fires twice a month when the rule names two days", () => {
    const rule = "FREQ=MONTHLY;BYMONTHDAY=1,15";
    expect(nextOccurrence(rule, { after: "2026-09-01T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2026-09-15T16:00:00.000Z");
    expect(nextOccurrence(rule, { after: "2026-09-15T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2026-10-01T16:00:00.000Z");
  });

  it("defaults BYMONTHDAY to the anchor's own day of the month", () => {
    expect(nextOccurrence("FREQ=MONTHLY", { after: "2026-09-14T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2026-10-14T16:00:00.000Z");
  });

  it("honours INTERVAL=3 as a quarter", () => {
    expect(
      nextOccurrence("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=14", {
        after: "2026-09-14T16:00:00.000Z",
        timeZone: DOUALA,
      }),
    ).toBe("2026-12-14T16:00:00.000Z");
  });
});

describe("nextOccurrence — the wall clock is preserved across a DST change", () => {
  it("keeps 09:00 London time, which is a different instant either side of 25 Oct", () => {
    const rule = "FREQ=MONTHLY;BYMONTHDAY=14";
    // 14 Oct 09:00 BST = 08:00Z.
    const october = nextOccurrence(rule, { after: "2026-09-14T08:00:00.000Z", timeZone: LONDON });
    expect(october).toBe("2026-10-14T08:00:00.000Z");
    // 14 Nov 09:00 GMT = 09:00Z. Same wall clock, one hour later in UTC — a
    // UTC-anchored step would return 08:00Z and fire at 08:00 local.
    expect(nextOccurrence(rule, { after: october, timeZone: LONDON })).toBe("2026-11-14T09:00:00.000Z");
  });
});

describe("nextOccurrence — weekly and daily", () => {
  it("lands on the same weekday a week later with no BYDAY", () => {
    // 14 Sep 2026 is a Monday; the next Monday is the 21st.
    expect(nextOccurrence("FREQ=WEEKLY", { after: "2026-09-14T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2026-09-21T16:00:00.000Z");
  });

  it("lands on the named weekday", () => {
    // Monday 14 Sep → Friday 18 Sep, the same week.
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=FR", { after: "2026-09-14T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2026-09-18T16:00:00.000Z");
    // …and from that Friday, the next one.
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=FR", { after: "2026-09-18T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2026-09-25T16:00:00.000Z");
  });

  it("steps whole weeks for INTERVAL=2", () => {
    expect(
      nextOccurrence("FREQ=WEEKLY;INTERVAL=2", { after: "2026-09-14T16:00:00.000Z", timeZone: DOUALA }),
    ).toBe("2026-09-28T16:00:00.000Z");
  });

  it("steps days for DAILY", () => {
    expect(nextOccurrence("FREQ=DAILY", { after: "2026-09-14T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2026-09-15T16:00:00.000Z");
    expect(nextOccurrence("FREQ=DAILY;INTERVAL=3", { after: "2026-09-14T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2026-09-17T16:00:00.000Z");
  });

  it("crosses a month and a year boundary without help", () => {
    expect(nextOccurrence("FREQ=DAILY", { after: "2026-12-31T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2027-01-01T16:00:00.000Z");
  });
});

describe("nextOccurrence — yearly", () => {
  it("lands a year later", () => {
    expect(nextOccurrence("FREQ=YEARLY", { after: "2026-09-14T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2027-09-14T16:00:00.000Z");
  });

  it("waits for the next leap year rather than moving 29 February to 1 March", () => {
    expect(nextOccurrence("FREQ=YEARLY", { after: "2024-02-29T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2028-02-29T16:00:00.000Z");
  });
});

describe("nextOccurrence — a series that ends", () => {
  it("returns null once UNTIL has passed", () => {
    const rule = "FREQ=MONTHLY;BYMONTHDAY=14;UNTIL=20261014T235959Z";
    // The October occurrence is still inside the window…
    expect(nextOccurrence(rule, { after: "2026-09-14T16:00:00.000Z", timeZone: DOUALA }))
      .toBe("2026-10-14T16:00:00.000Z");
    // …and November is not, so the sweep clears the rule and the series stops.
    expect(nextOccurrence(rule, { after: "2026-10-14T16:00:00.000Z", timeZone: DOUALA })).toBeNull();
  });

  it("treats a bare-date UNTIL as the end of that day", () => {
    // "Repeat until 14/10" must include the 14th, not stop at its midnight.
    expect(
      nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=14;UNTIL=20261014", {
        after: "2026-09-14T16:00:00.000Z",
        timeZone: DOUALA,
      }),
    ).toBe("2026-10-14T16:00:00.000Z");
  });

  it("counts OCCURRENCES, not further repetitions, for COUNT", () => {
    const rule = "FREQ=MONTHLY;BYMONTHDAY=14;COUNT=3";
    // Three rows already exist, so the third is the last one.
    expect(
      nextOccurrence(rule, { after: "2026-09-14T16:00:00.000Z", timeZone: DOUALA, existingCount: 3 }),
    ).toBeNull();
    expect(
      nextOccurrence(rule, { after: "2026-09-14T16:00:00.000Z", timeZone: DOUALA, existingCount: 2 }),
    ).toBe("2026-10-14T16:00:00.000Z");
  });

  it("gives up rather than looping when no month can ever match", () => {
    // Unreachable through the picker (BYMONTHDAY is capped at 31) and so only
    // constructible by handing `nextOccurrence` a parsed object directly — but
    // the search is bounded, so a bad rule yields null instead of a worker that
    // never returns. This is the test MAX_STEPS exists for.
    expect(MAX_STEPS).toBeGreaterThan(1);
    expect(
      nextOccurrence(
        { freq: "MONTHLY", interval: 1, byMonthDay: [32], byDay: [], until: null, count: null },
        { after: "2026-09-14T16:00:00.000Z", timeZone: DOUALA },
      ),
    ).toBeNull();
  });

  it("returns null for a missing anchor rather than throwing", () => {
    expect(nextOccurrence("FREQ=MONTHLY", { after: null, timeZone: DOUALA })).toBeNull();
  });
});

describe("parseRule — it rejects what it does not implement", () => {
  const rejects = (rule, part) => {
    let thrown = null;
    try {
      parseRule(rule);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RecurrenceError);
    if (part) expect(thrown.part).toBe(part);
    return thrown;
  };

  it("refuses a frequency this product does not repeat on", () => {
    // Accepted-and-ignored would be worse: the rule would read as "monthly".
    expect(rejects("FREQ=HOURLY", "FREQ").message).toMatch(/daily, weekly, monthly or yearly/);
  });

  it("refuses an RRULE part it cannot honour", () => {
    rejects("FREQ=MONTHLY;BYSETPOS=-1", "BYSETPOS");
    rejects("FREQ=WEEKLY;WKST=SU", "WKST");
  });

  it("refuses a multi-day weekly rule rather than mis-stepping it", () => {
    // "Every Monday AND Thursday" needs a week cursor to stay aligned with
    // INTERVAL; silently taking the first day would fire half as often.
    expect(rejects("FREQ=WEEKLY;BYDAY=MO,TH", "BYDAY").message).toMatch(/one weekday/);
  });

  it("refuses a part on the wrong frequency", () => {
    rejects("FREQ=WEEKLY;BYMONTHDAY=14", "BYMONTHDAY");
    rejects("FREQ=MONTHLY;BYDAY=MO", "BYDAY");
  });

  it("refuses both endings at once", () => {
    expect(rejects("FREQ=MONTHLY;COUNT=3;UNTIL=20270101").message).toMatch(/not both/);
  });

  it("refuses nonsense values", () => {
    rejects("FREQ=MONTHLY;INTERVAL=0", "INTERVAL");
    rejects("FREQ=MONTHLY;BYMONTHDAY=32", "BYMONTHDAY");
    rejects("FREQ=MONTHLY;COUNT=0", "COUNT");
    rejects("FREQ=MONTHLY;UNTIL=yesterday", "UNTIL");
    rejects("FREQ", undefined);
    rejects("BYMONTHDAY=14", "FREQ");
    rejects("", undefined);
  });

  it("accepts the RRULE: prefix a calendar export would carry", () => {
    expect(parseRule("RRULE:FREQ=MONTHLY;BYMONTHDAY=14").freq).toBe("MONTHLY");
  });
});

describe("canonicalise — two rules that mean the same thing compare equal", () => {
  it("normalises case, order and defaults", () => {
    expect(canonicalise("bymonthday=14;freq=monthly")).toBe("FREQ=MONTHLY;BYMONTHDAY=14");
    expect(canonicalise("FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=14")).toBe("FREQ=MONTHLY;BYMONTHDAY=14");
    expect(canonicalise("FREQ=MONTHLY;BYMONTHDAY=15,1;INTERVAL=2")).toBe(
      "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1,15",
    );
  });

  it("keeps a weekly weekday in iCal's own two letters", () => {
    expect(canonicalise("FREQ=WEEKLY;BYDAY=fr")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(weekdayName("FREQ=WEEKLY;BYDAY=FR")).toBe("Friday");
    expect(weekdayName("FREQ=MONTHLY")).toBeNull();
  });
});
