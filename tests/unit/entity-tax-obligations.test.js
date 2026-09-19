"use strict";
/**
 * PR-05 — the tax obligation generator (audit CE-16, Decision Q4).
 *
 * FOUR PROPERTIES ARE LOAD-BEARING, and none of them is visible from the happy
 * path:
 *
 *   RE-RUNNING IS FREE. This runs nightly and will also be run by hand. A
 *   second pass must write nothing. The enforcement is
 *   `ux_tax_calendar_generation_key` (13970), so the fake repo below
 *   implements that unique index rather than merely recording inserts — a fake
 *   that let a duplicate through would prove nothing about the property the
 *   acceptance condition is actually about.
 *
 *   MONTH-END IS A DATE THAT DOES NOT EXIST. "File by the 31st" against April
 *   or February has no correct answer that keeps the filing in its own period
 *   except the last day of that month. Rolling forward puts it in the next
 *   period; the 1st puts it a month early. Both are wrong in a way that looks
 *   fine in a unit test written against January.
 *
 *   CLOSING A REGISTRATION RETIRES ITS FUTURE. A deregistered number has no
 *   more returns to file, and an obligation left PENDING on it is a task the
 *   reminder engine will ask for forever.
 *
 *   NOBODY IS INVENTED AS RESPONSIBLE. An obligation inherits its
 *   registration's owner or has none, and "has none" is reported. Guessing an
 *   owner for a statutory filing is worse than admitting one is missing.
 *
 * The repo is faked rather than mocked at the SQL level, for the reason
 * `leave-accrual.test.js` gives: what is under test is the loop's arithmetic
 * and its stopping conditions, and a fake that enforces the unique index is a
 * truer stand-in for Postgres than a query spy.
 */

/*
 * The emit helpers are mocked at MODULE level rather than spied on, and that is
 * not a stylistic choice: `corporate_entity.tax-calendar.js` destructures
 * `emitEvent` at require time, so `jest.spyOn(emit, "emitEvent")` replaces a
 * property the generator is no longer reading and every assertion below would
 * pass against a spy nothing called.
 */
/*
 * `MOCK_USERS` is the tenant's app_user table: anything not in it does not
 * resolve, exactly as the `(SELECT user_id FROM app_user WHERE user_id = $n)`
 * sub-select returns no row. `resolveActorId` is that sub-select in JS form, so
 * it must respect the same set — a mock that echoed back any id it was handed
 * would let the generator's own existence checks pass against a user who is
 * not there. The `mock` prefix is not decoration: babel-plugin-jest-hoist
 * lifts this factory above the requires and refuses any other outer binding.
 */
const MOCK_USERS = new Set(["u-ada", "u-bill"]);

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn().mockResolvedValue(undefined),
  audit: jest.fn().mockResolvedValue(undefined),
  resolveActorId: jest.fn().mockImplementation(async (_c, id) => (id && MOCK_USERS.has(id) ? id : null)),
}));

const repo = require("../../src/modules/master/corporate_entity/corporate_entity.repo");
const emit = require("../../src/shared/events/emit");
const tc = require("../../src/modules/master/corporate_entity/corporate_entity.tax-calendar");

/* ── The fake tenant ────────────────────────────────────────────────────────
 *
 * `obligations` is the whole of `tax_calendar` as far as these tests are
 * concerned. `insertObligation` implements the partial unique index, which is
 * the only database behaviour the generator's correctness depends on.
 */
function fakeTenant({ entity = { entity_id: "e1", code: "SLAS", legal_name: "Smart Logistics and Services" }, registrations = [], seed = [] } = {}) {
  const obligations = [...seed];
  let nextId = 1;

  jest.spyOn(repo, "get").mockResolvedValue(entity);
  jest.spyOn(repo, "entitiesWithRegistrations").mockResolvedValue(
    [{ entity_id: entity.entity_id, code: entity.code, legal_name: entity.legal_name }],
  );
  jest.spyOn(repo, "taxRegistrationsForGeneration").mockResolvedValue(registrations);

  jest.spyOn(repo, "insertObligation").mockImplementation(async (_c, row) => {
    // ux_tax_calendar_generation_key: one row per generation key.
    if (obligations.some((o) => o.generation_key === row.generation_key)) return null;
    const inserted = { tax_calendar_id: `cal-${nextId++}`, status: "PENDING", generated: true, ...row };
    obligations.push(inserted);
    return inserted;
  });

  jest.spyOn(repo, "supersedeOpenForRegistration").mockImplementation(async (_c, regId, { reason }) => {
    const hit = obligations.filter(
      (o) => o.tax_registration_id === regId && o.generated && ["PENDING", "LATE"].includes(o.status),
    );
    hit.forEach((o) => { o.status = "SUPERSEDED"; o.status_reason = reason; });
    return hit.map((o) => ({ tax_calendar_id: o.tax_calendar_id }));
  });

  jest.spyOn(repo, "supersedeUnexpectedForRegistration").mockImplementation(
    async (_c, regId, { keys, windowStart, windowEnd, reason }) => {
      const hit = obligations.filter(
        (o) =>
          o.tax_registration_id === regId &&
          o.generated &&
          ["PENDING", "LATE"].includes(o.status) &&
          o.generation_key &&
          !keys.includes(o.generation_key) &&
          o.period_start <= windowEnd &&
          o.period_end >= windowStart,
      );
      hit.forEach((o) => { o.status = "SUPERSEDED"; o.status_reason = reason; });
      return hit.map((o) => ({ tax_calendar_id: o.tax_calendar_id, generation_key: o.generation_key }));
    },
  );

  jest.spyOn(repo, "markOverdue").mockImplementation(async (_c, entityId, today) => {
    const hit = obligations.filter((o) => o.entity_id === entityId && o.status === "PENDING" && o.due_on < today);
    hit.forEach((o) => { o.status = "LATE"; o.status_reason = "past_due_on"; });
    return hit;
  });

  /*
   * Reads return COPIES, the way pg does. Each `client.query` in production
   * builds fresh row objects, so a caller holding the result of one query
   * cannot watch it change under a later UPDATE. A fake that handed back the
   * stored object would make `before`/`after` in an audit entry compare an
   * object with itself — and pass while testing nothing.
   */
  jest.spyOn(repo, "obligationById").mockImplementation(async (_c, id) => {
    const row = obligations.find((o) => o.tax_calendar_id === id);
    return row ? { ...row } : null;
  });

  jest.spyOn(repo, "setObligationStatus").mockImplementation(async (_c, id, { status, reason }) => {
    const row = obligations.find((o) => o.tax_calendar_id === id);
    row.status = status;
    row.status_reason = reason;
    return { ...row };
  });

  // Models the `(SELECT user_id FROM app_user WHERE user_id = $n)` sub-select:
  // 13970 could not add a FOREIGN KEY to a table it did not create, so an id
  // that does not resolve stores NULL rather than raising. A fake that stored
  // whatever it was handed would let a mistyped assignee pass unnoticed.
  jest.spyOn(repo, "setObligationResponsible").mockImplementation(async (_c, id, { responsibleUserId }) => {
    const row = obligations.find((o) => o.tax_calendar_id === id);
    row.responsible_user_id = MOCK_USERS.has(responsibleUserId) ? responsibleUserId : null;
    return { ...row };
  });

  const reminded = [];
  jest.spyOn(repo, "markReminded").mockImplementation(async (_c, id, step) => {
    obligations.find((o) => o.tax_calendar_id === id).last_reminder_step = step;
    reminded.push({ id, step });
  });

  jest.spyOn(repo, "obligationsDueWithin").mockImplementation(async (_c, { today, days }) =>
    obligations
      .filter((o) => o.status === "PENDING" && o.due_on >= today && o.due_on <= tc.addDays(today, days))
      .map((o) => ({ ...o, entity_code: entity.code, entity_name: entity.legal_name })));

  return { obligations, reminded };
}

/*
 * A stand-in pg client. Every read and write goes through the faked repo, so
 * the only thing that reaches this is transaction control — which is exactly
 * what makes it worth having: the generator opens one transaction per entity,
 * and a per-entity boundary is the useful one because a tenant-wide sweep must
 * not lose nine entities' calendars because the tenth had a bad row.
 */
function fakeClient() {
  const tx = [];
  return { tx, query: async (sql) => { tx.push(sql); return { rows: [] }; } };
}

const CLIENT = fakeClient();

/** A monthly VAT registration in Cameroon, owned by Ada. */
const VAT_CM = {
  tax_registration_id: "tr1",
  entity_id: "e1",
  jurisdiction_id: "j1",
  country_code: "CM",
  tax_kind: "VAT",
  tax_number: "P012345678901X",
  regime: "REEL",
  filing_frequency: "MONTHLY",
  filing_due_day: 15,
  is_active: true,
  deregistered_on: null,
  registered_on: null,
  responsible_user_id: "u-ada",
};

/** 19 September 2026 — the audit date, and a mid-month so backfill is visible. */
const TODAY = "2026-09-19";

/** Every event the run emitted, by key. */
const eventsOf = (key) => emit.emitEvent.mock.calls.map((c) => c[1]).filter((e) => e.eventTypeKey === key);

describe("tax obligation generator (PR-05)", () => {
  // `clearMocks: true` in jest.config.js empties the emit mocks' recorded calls
  // between tests; the implementations from the factory above survive it.
  afterEach(() => jest.restoreAllMocks());

  describe("cadence derivation", () => {
    it("derives the obligation kind from the tax kind and cadence", () => {
      expect(tc.obligationKindFor("VAT", "MONTHLY")).toBe("VAT_RETURN");
      expect(tc.obligationKindFor("WHT", "MONTHLY")).toBe("WHT_RETURN");
      expect(tc.obligationKindFor("PAYROLL", "MONTHLY")).toBe("PAYROLL_RETURN");
      expect(tc.obligationKindFor("CUSTOMS", "MONTHLY")).toBe("CUSTOMS_RETURN");
      expect(tc.obligationKindFor("LOCAL", "MONTHLY")).toBe("LOCAL_TAX_RETURN");
      expect(tc.obligationKindFor("OTHER", "MONTHLY")).toBe("TAX_RETURN");
      // Income splits on cadence: the annual return is a return, the rest are
      // instalments — 0342's own vocabulary makes that distinction.
      expect(tc.obligationKindFor("INCOME", "ANNUAL")).toBe("IS_RETURN");
      expect(tc.obligationKindFor("INCOME", "QUARTERLY")).toBe("IS_INSTALMENT");
    });

    it("uses the jurisdiction rule for a kind Cameroon names differently", () => {
      // DSF/DIPE are 0342's obligation vocabulary, reached through the CM rule
      // rather than a second lookup table.
      const dsf = tc.resolveCadence({ country_code: "CM", tax_kind: "INCOME", regime: "REEL" });
      expect(dsf.obligation).toBe("DSF");
      const dipe = tc.resolveCadence({ country_code: "CM", tax_kind: "INCOME", regime: "SIMPLIFIE" });
      expect(dipe.obligation).toBe("DIPE");
    });

    it("prefers the registration over the jurisdiction default, and says when it did not", () => {
      const own = tc.resolveCadence({ country_code: "CM", tax_kind: "VAT", filing_frequency: "QUARTERLY", filing_due_day: 25 });
      expect(own.frequency).toBe("QUARTERLY");
      expect(own.due_day).toBe(25);
      expect(own.defaults_used).toEqual({ filing_frequency: null, filing_due_day: null });

      const assumed = tc.resolveCadence({ country_code: "CM", tax_kind: "VAT" });
      expect(assumed.frequency).toBe("MONTHLY");
      expect(assumed.due_day).toBe(15);
      // The run has to be able to tell an obligation resting on an assumption
      // from one resting on a fact.
      expect(assumed.defaults_used).toEqual({ filing_frequency: "MONTHLY", filing_due_day: 15 });
    });

    it("reports an ON_EVENT registration rather than silently skipping it", () => {
      const onEvent = tc.resolveCadence({ country_code: "CM", tax_kind: "CUSTOMS", filing_frequency: "ON_EVENT" });
      expect(onEvent.schedulable).toBe(false);
      expect(onEvent.reason).toBe("on_event_has_no_period");
      // A customs duty that arises when a shipment clears has no period to
      // enumerate, and the enumeration agrees.
      expect(tc.periodsFor("ON_EVENT", "2026-01-01", "2026-12-31")).toEqual([]);
    });

    it("surfaces an unschedulable registration as a finding on the run", async () => {
      const t = fakeTenant({
        registrations: [{ ...VAT_CM, tax_registration_id: "tr9", tax_kind: "CUSTOMS", filing_frequency: "ON_EVENT" }],
      });

      const out = await tc.generateForEntity(CLIENT, "e1", { today: TODAY });

      expect(out.created).toBe(0);
      expect(out.skipped).toEqual([
        expect.objectContaining({ tax_registration_id: "tr9", reason: "on_event_has_no_period" }),
      ]);
      // The finding rides on the emitted event too — a skip nobody is told
      // about is indistinguishable from a registration the generator never saw.
      const gen = eventsOf("entity.tax_obligation_generated");
      expect(gen).toHaveLength(1);
      expect(gen[0].payload.skipped).toHaveLength(1);
      expect(t.obligations).toHaveLength(0);
    });
  });

  describe("month-end handling", () => {
    it("clamps a due day to the last day of a shorter month", () => {
      // The case the acceptance condition names. A 31st does not exist in
      // February or April, and the only answer that keeps the filing inside its
      // own period is the last day of that month.
      expect(tc.clampDay(2026, 2, 31)).toBe("2026-02-28");
      expect(tc.clampDay(2024, 2, 31)).toBe("2024-02-29"); // leap
      expect(tc.clampDay(2026, 4, 31)).toBe("2026-04-30");
      expect(tc.clampDay(2026, 6, 31)).toBe("2026-06-30");
      expect(tc.clampDay(2026, 12, 31)).toBe("2026-12-31"); // a month that does have it
      expect(tc.clampDay(2026, 3, 15)).toBe("2026-03-15");  // and one that needs no clamping
    });

    it("files a 31st-of-the-month registration at the end of February, not in March", async () => {
      const t = fakeTenant({
        registrations: [{ ...VAT_CM, filing_due_day: 31, registered_on: "2026-01-01" }],
      });

      // Window: backfill 1 period (August) through horizon 3 (December).
      const out = await tc.generateForEntity(CLIENT, "e1", { today: "2026-09-19", backfill: 1, horizon: 3 });

      const byPeriod = Object.fromEntries(t.obligations.map((o) => [o.period_code, o.due_on]));
      // Period 2026-08 is due in September; 2026-09 in October. Both months
      // have 30 days, so both clamp to the 30th — not to the 1st of the month
      // after, which would silently move the filing a month early.
      expect(byPeriod["2026-08"]).toBe("2026-09-30");
      expect(byPeriod["2026-09"]).toBe("2026-10-31"); // October HAS a 31st
      expect(byPeriod["2026-10"]).toBe("2026-11-30"); // November does not
      expect(byPeriod["2026-11"]).toBe("2026-12-31");
      expect(out.created).toBe(5); // Aug..Dec
      // Every obligation stays inside the month after its own period.
      for (const o of t.obligations) {
        expect(o.due_on.slice(0, 7)).not.toBe(o.period_code);
      }
    });

    it("clamps a February period end in a leap year", () => {
      const periods = tc.periodsFor("MONTHLY", "2024-02-01", "2024-02-29");
      expect(periods).toEqual([
        { period_code: "2024-02", period_start: "2024-02-01", period_end: "2024-02-29" },
      ]);
    });

    it("puts the annual return three months after the year it covers", () => {
      const period = tc.periodsFor("ANNUAL", "2025-01-01", "2025-12-31")[0];
      expect(period).toEqual({ period_code: "2025", period_start: "2025-01-01", period_end: "2025-12-31" });
      expect(tc.dueDateFor(period, { frequency: "ANNUAL", due_day: 15, due_month_offset: 3 })).toBe("2026-03-15");
    });
  });

  describe("period codes", () => {
    it("labels each cadence the way a person reads it", () => {
      expect(tc.periodsFor("MONTHLY", "2026-03-01", "2026-03-31").map((p) => p.period_code)).toEqual(["2026-03"]);
      expect(tc.periodsFor("QUARTERLY", "2026-01-01", "2026-12-31").map((p) => p.period_code))
        .toEqual(["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
      expect(tc.periodsFor("BIMONTHLY", "2026-01-01", "2026-12-31").map((p) => p.period_code))
        .toEqual(["2026-B1", "2026-B2", "2026-B3", "2026-B4", "2026-B5", "2026-B6"]);
      expect(tc.periodsFor("ANNUAL", "2026-01-01", "2026-12-31").map((p) => p.period_code)).toEqual(["2026"]);
    });

    it("aligns a window that starts mid-period to the period containing it", () => {
      // A window opening on 10 May must still yield Q2, or the quarter the
      // entity is currently inside would be missing from its own calendar.
      expect(tc.periodsFor("QUARTERLY", "2026-05-10", "2026-07-02").map((p) => p.period_code))
        .toEqual(["2026-Q2", "2026-Q3"]);
      expect(tc.periodsFor("BIMONTHLY", "2026-04-05", "2026-04-06").map((p) => p.period_code))
        .toEqual(["2026-B2"]);
    });

    it("generates nothing for a period that predates the registration", async () => {
      const t = fakeTenant({
        registrations: [{ ...VAT_CM, registered_on: "2026-11-01" }],
      });
      const out = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 1, horizon: 3 });
      // registered_on (Nov) is inside the window, so only Nov and Dec are owed.
      expect(t.obligations.map((o) => o.period_code).sort()).toEqual(["2026-11", "2026-12"]);
      expect(out.created).toBe(2);
    });
  });

  describe("idempotent re-run", () => {
    it("creates the obligations, then creates nothing on the second run", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });

      const first = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 1, horizon: 3 });
      expect(first.created).toBe(5);   // Aug, Sep, Oct, Nov, Dec
      expect(first.existing).toBe(0);
      const countAfterFirst = t.obligations.length;

      const second = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 1, horizon: 3 });
      expect(second.created).toBe(0);
      expect(second.existing).toBe(5);
      // THE acceptance condition: no duplicates. Enforced by the unique index
      // the fake implements, not by the generator noticing.
      expect(t.obligations).toHaveLength(countAfterFirst);

      const third = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 1, horizon: 3 });
      expect(third.created).toBe(0);
      expect(t.obligations).toHaveLength(countAfterFirst);
    });

    it("keys on the cadence, so a stable registration keeps one row per period", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 1 });

      const keys = t.obligations.map((o) => o.generation_key);
      expect(new Set(keys).size).toBe(keys.length);
      // The key names the entity, the registration, the obligation, the period
      // and the cadence — the last of which is what makes a cadence change a
      // new obligation rather than a silent edit of an old one.
      expect(keys[0]).toBe(["e1", "tr1", "VAT_RETURN", "2026-09", "MONTHLY", 15].join("|"));
    });

    it("supersedes and regenerates when the due day changes", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 1 });
      const before = t.obligations.map((o) => ({ period: o.period_code, due: o.due_on }));
      expect(before.find((b) => b.period === "2026-09").due).toBe("2026-10-15");

      // The deadline moves from the 15th to the 20th.
      repo.taxRegistrationsForGeneration.mockResolvedValue([{ ...VAT_CM, filing_due_day: 20 }]);
      const out = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 1 });

      // Both periods in the window are replaced, and both say why.
      const superseded = t.obligations.filter((o) => o.status === "SUPERSEDED");
      expect(superseded.map((o) => o.status_reason)).toEqual(["cadence_changed", "cadence_changed"]);
      expect(out.created).toBe(2);
      expect(out.superseded).toBe(2);

      const live = t.obligations.filter((o) => o.status === "PENDING");
      expect(live.find((o) => o.period_code === "2026-09").due_on).toBe("2026-10-20");
      // One live obligation per period — the old one is retired, not deleted.
      expect(live.map((o) => o.period_code).sort()).toEqual(["2026-09", "2026-10"]);
    });

    it("never supersedes an obligation a person has already acted on", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 1 });

      // Somebody filed August and waived September by hand.
      const august = t.obligations.find((o) => o.period_code === "2026-09");
      august.status = "DONE";
      const september = t.obligations.find((o) => o.period_code === "2026-10");
      september.status = "WAIVED";

      repo.taxRegistrationsForGeneration.mockResolvedValue([{ ...VAT_CM, filing_due_day: 20 }]);
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 1 });

      // You cannot un-file a return, and a waiver was a human decision. Both
      // survive a cadence change; only their PENDING siblings are replaced.
      expect(august.status).toBe("DONE");
      expect(september.status).toBe("WAIVED");
      expect(t.obligations.filter((o) => o.status === "SUPERSEDED")).toHaveLength(0);
      expect(t.obligations.filter((o) => o.status === "PENDING")).toHaveLength(2);
    });
  });

  describe("deregistration and closure", () => {
    it("honours is_active=false by retiring the registration's open obligations", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 2 });
      expect(t.obligations.filter((o) => o.status === "PENDING")).toHaveLength(3);

      repo.taxRegistrationsForGeneration.mockResolvedValue([{ ...VAT_CM, is_active: false }]);
      const out = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 2 });

      expect(out.superseded).toBe(3);
      expect(out.created).toBe(0);
      expect(t.obligations.every((o) => o.status === "SUPERSEDED")).toBe(true);
      expect(t.obligations[0].status_reason).toBe("registration_inactive");
    });

    it("honours a past deregistered_on the same way", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 2 });

      repo.taxRegistrationsForGeneration.mockResolvedValue([{ ...VAT_CM, deregistered_on: "2026-08-31" }]);
      const out = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 2 });

      expect(out.created).toBe(0);
      expect(t.obligations[0].status_reason).toBe("registration_deregistered");
    });

    it("generates up to a FUTURE deregistration and no further", async () => {
      const t = fakeTenant({
        // Still active, but the authority has been told this closes on 1 Nov.
        registrations: [{ ...VAT_CM, deregistered_on: "2026-11-01" }],
      });

      const out = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 3 });

      // Sep and Oct are owed: the entity is registered for those periods. Nov
      // starts on the deregistration date, so nothing is owed for it.
      expect(t.obligations.map((o) => o.period_code).sort()).toEqual(["2026-09", "2026-10"]);
      expect(out.created).toBe(2);
    });

    it("still owes the final part-period, because it was registered for part of it", async () => {
      const t = fakeTenant({
        // Closes mid-November: the entity WAS registered during November.
        registrations: [{ ...VAT_CM, deregistered_on: "2026-11-15" }],
      });

      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 3 });

      expect(t.obligations.map((o) => o.period_code).sort())
        .toEqual(["2026-09", "2026-10", "2026-11"]);
    });

    it("reports the closure state rather than guessing from one flag", () => {
      expect(tc.registrationState({ is_active: true }, "2026-09-19")).toEqual({ open: true, closes_on: null });
      expect(tc.registrationState({ is_active: false }, "2026-09-19").reason).toBe("registration_inactive");
      expect(tc.registrationState({ is_active: true, deregistered_on: "2026-01-01" }, "2026-09-19"))
        .toEqual({ open: false, reason: "registration_deregistered", closed_on: "2026-01-01" });
      // A future closure is still open, with the date carried for the caller.
      expect(tc.registrationState({ is_active: true, deregistered_on: "2026-12-31" }, "2026-09-19"))
        .toEqual({ open: true, closes_on: "2026-12-31" });
    });
  });

  describe("responsible assignment", () => {
    it("inherits the registration's owner onto every obligation it generates", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 2 });

      expect(t.obligations).toHaveLength(3);
      expect(t.obligations.every((o) => o.responsible_user_id === "u-ada")).toBe(true);
    });

    it("leaves an obligation unassigned rather than inventing an owner, and says so", async () => {
      const t = fakeTenant({ registrations: [{ ...VAT_CM, responsible_user_id: null }] });
      const out = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 2 });

      expect(t.obligations.every((o) => o.responsible_user_id === null)).toBe(true);
      // Reported, not swallowed: an obligation nobody has been told about is a
      // finding, and guessing an owner for a statutory filing is worse.
      expect(out.unassigned).toBe(3);
      expect(eventsOf("entity.tax_obligation_generated")[0].payload.unassigned).toBe(3);
    });

    it("assigns one obligation without re-assigning the registration", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 1 });
      const target = t.obligations[0];

      const after = await tc.assign(CLIENT, target.tax_calendar_id, {
        responsible_user_id: "u-bill", actor: { user_id: "u-ada" },
      });

      expect(after.responsible_user_id).toBe("u-bill");
      // One quarter delegated; the registration's own owner is untouched, so
      // next quarter's generated obligations still inherit Ada.
      expect(t.obligations[1].responsible_user_id).toBe("u-ada");
      const audits = emit.audit.mock.calls.map((c) => c[1]);
      expect(audits).toContainEqual(expect.objectContaining({
        action: "tax_obligation.assigned",
        before: { responsible_user_id: "u-ada" },
        after: { responsible_user_id: "u-bill" },
      }));
    });

    it("can take an assignment off again", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 0 });
      const after = await tc.assign(CLIENT, t.obligations[0].tax_calendar_id, { responsible_user_id: null, actor: {} });
      expect(after.responsible_user_id).toBe(null);
    });

    it("refuses an assignee who is not a user of this tenant", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 0 });
      // There is no FK to lean on (13970 could not add one to a table it did
      // not create), so the NULL the sub-select produces has to be caught here
      // — a filing silently left un-assigned is the finding this module
      // reports, not something a typo may quietly cause.
      await expect(
        tc.assign(CLIENT, t.obligations[0].tax_calendar_id, { responsible_user_id: "u-ghost", actor: {} }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(t.obligations[0].responsible_user_id).toBe("u-ada");
    });

    it("refuses to assign an obligation that does not exist", async () => {
      fakeTenant({ registrations: [VAT_CM] });
      await expect(tc.assign(CLIENT, "nope", { responsible_user_id: "u-bill" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("overdue handling", () => {
    it("marks a passed deadline LATE and says so, once, at HIGH priority", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      // Backfill one period: August's return was due 15 September and has not
      // been filed. A generator that only looked forward would make a missed
      // deadline invisible — the failure this module exists to prevent.
      const out = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 1, horizon: 0 });

      const august = t.obligations.find((o) => o.period_code === "2026-08");
      expect(august.status).toBe("LATE");
      expect(august.status_reason).toBe("past_due_on");
      expect(out.marked_late).toBe(1);

      const overdue = eventsOf("entity.tax_obligation_overdue");
      expect(overdue).toHaveLength(1);
      expect(overdue[0].priority).toBe("HIGH");
      expect(overdue[0].payload.days_late).toBe(4);
      expect(overdue[0].payload.responsible_user_id).toBe("u-ada");
    });

    it("does not re-mark an obligation that is already LATE", async () => {
      fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 1, horizon: 0 });
      emit.emitEvent.mockClear();

      const second = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 1, horizon: 0 });
      expect(second.marked_late).toBe(0);
      expect(eventsOf("entity.tax_obligation_overdue")).toHaveLength(0);
    });

    it("stays advisory: a LATE obligation blocks nothing and asserts nothing", async () => {
      fakeTenant({ registrations: [VAT_CM] });
      const out = await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 1, horizon: 0 });
      // The run reports; it does not throw, and the severity ladder never
      // reaches a hard block. Same posture as corporate_entity.renewals.js.
      expect(out.marked_late).toBe(1);
      expect(out).not.toHaveProperty("blocked");
    });
  });

  describe("reminders", () => {
    it("emits once per rung of the ladder as a deadline approaches", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      // ONE obligation, so the rung arithmetic below is not entangled with a
      // neighbouring period's. backfill 0 / horizon 0 generates September only,
      // whose return is due 2026-10-15.
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 0 });
      expect(t.obligations).toHaveLength(1);
      expect(t.obligations[0].due_on).toBe("2026-10-15");

      const at = (day) => tc.remindOpen(CLIENT, { today: day });

      expect((await at("2026-09-01")).reminded).toBe(0);   // 44 days out: no rung
      expect((await at("2026-09-20")).reminded).toBe(1);   // 25 days: D30
      expect(t.obligations[0].last_reminder_step).toBe("D30");
      expect((await at("2026-09-21")).reminded).toBe(0);   // 24 days, same rung: silent
      expect((await at("2026-10-02")).reminded).toBe(1);   // 13 days: D14
      expect((await at("2026-10-09")).reminded).toBe(1);   // 6 days: D7
      expect((await at("2026-10-14")).reminded).toBe(1);   // 1 day: D1
      expect((await at("2026-10-15")).reminded).toBe(0);   // due today, 0 days: still D1

      // A warning that arrives every morning for a month is a warning everybody
      // filters. Four messages over six weeks is the whole point.
      expect(t.reminded.map((r) => r.step)).toEqual(["D30", "D14", "D7", "D1"]);
    });

    it("names the responsible person on the reminder, in words", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 0 });
      // CE-33: a reminder naming a UUID is a reminder nobody can act on. The
      // join supplies the name; the payload carries it.
      repo.obligationsDueWithin.mockImplementation(async () =>
        t.obligations.map((o) => ({
          ...o, entity_code: "SLAS", entity_name: "Smart Logistics", responsible_name: "Ada Lovelace",
        })));

      await tc.remindOpen(CLIENT, { today: "2026-09-25" }); // 20 days out: D30
      const reminder = eventsOf("entity.tax_obligation_reminder")[0];
      expect(reminder.payload.responsible_user_id).toBe("u-ada");
      expect(reminder.payload.responsible_name).toBe("Ada Lovelace");
      expect(reminder.payload.unassigned).toBe(false);
      expect(reminder.payload.step).toBe("D30");
      expect(reminder.entityRef).toBe("corporate_entity:e1");
    });

    it("flags an unassigned obligation on the reminder it emits", async () => {
      fakeTenant({ registrations: [{ ...VAT_CM, responsible_user_id: null }] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 0 });

      await tc.remindOpen(CLIENT, { today: "2026-09-25" });
      expect(eventsOf("entity.tax_obligation_reminder")[0].payload.unassigned).toBe(true);
    });

    it("escalates to HIGH inside a week", async () => {
      fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 0 });

      await tc.remindOpen(CLIENT, { today: "2026-09-01" });  // 44 days: no rung, no event
      await tc.remindOpen(CLIENT, { today: "2026-09-20" });  // 25 days: D30
      await tc.remindOpen(CLIENT, { today: "2026-10-09" });  // 6 days: D7
      const reminders = eventsOf("entity.tax_obligation_reminder");
      expect(reminders.map((r) => r.payload.step)).toEqual(["D30", "D7"]);
      expect(reminders.map((r) => r.priority)).toEqual(["NORMAL", "HIGH"]);
    });

    it("does not remind on an obligation that is LATE, DONE or WAIVED", () => {
      // Overdue is the LATE transition's event, not a reminder rung — one
      // message per fact, and the two facts are different.
      expect(tc.reminderStepFor(-1)).toBe(null);
      expect(tc.reminderStepFor(0).step).toBe("D1");
      expect(tc.reminderStepFor(45)).toBe(null);
      expect(tc.reminderStepFor(30).step).toBe("D30");
    });
  });

  describe("manual transitions are audited", () => {
    it("waives with a reason, and records who and why", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 0 });
      const target = t.obligations[0];

      const after = await tc.setStatus(CLIENT, target.tax_calendar_id, {
        status: "WAIVED", reason: "Nil return accepted by the DGI in writing", actor: { user_id: "u-ada" },
      });

      expect(after.status).toBe("WAIVED");
      expect(emit.audit.mock.calls.map((c) => c[1])).toContainEqual(expect.objectContaining({
        action: "tax_obligation.status_changed",
        before: { status: "PENDING", status_reason: null },
        after: { status: "WAIVED", status_reason: "Nil return accepted by the DGI in writing" },
      }));
      expect(eventsOf("entity.tax_obligation_status_changed")[0].payload)
        .toMatchObject({ from: "PENDING", to: "WAIVED" });
    });

    it("refuses a waiver with no reason", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 0 });
      // A waiver is the one transition after which nothing will ever chase this
      // filing again. Without a reason there is nothing for the next person to
      // read at the point they wonder why.
      await expect(
        tc.setStatus(CLIENT, t.obligations[0].tax_calendar_id, { status: "WAIVED", reason: "  ", actor: {} }),
      ).rejects.toMatchObject({ code: "MISSING_VALUE" });
      expect(t.obligations[0].status).toBe("PENDING");
    });

    it("does not require a reason to complete or reopen one", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 0 });
      const id = t.obligations[0].tax_calendar_id;
      expect((await tc.setStatus(CLIENT, id, { status: "DONE", actor: {} })).status).toBe("DONE");
      expect((await tc.setStatus(CLIENT, id, { status: "PENDING", actor: {} })).status).toBe("PENDING");
    });

    it("refuses to let a person assert SUPERSEDED", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 0 });
      // SUPERSEDED means the generator's own plan was overtaken. If a person
      // could write it, the reconciliation pass could no longer tell a row that
      // was replaced from one merely declared replaced.
      await expect(
        tc.setStatus(CLIENT, t.obligations[0].tax_calendar_id, { status: "SUPERSEDED", reason: "because", actor: {} }),
      ).rejects.toMatchObject({ code: "BAD_STATUS" });
      expect(tc.MANUAL_STATUSES).toEqual(["PENDING", "DONE", "WAIVED"]);
    });

    it("refuses an obligation that does not exist", async () => {
      fakeTenant({ registrations: [VAT_CM] });
      await expect(tc.setStatus(CLIENT, "nope", { status: "DONE", actor: {} })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("the audit trail", () => {
    it("audits every superseding transition with its reason", async () => {
      fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 1 });
      emit.audit.mockClear();

      repo.taxRegistrationsForGeneration.mockResolvedValue([{ ...VAT_CM, is_active: false }]);
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 1 });

      const audits = emit.audit.mock.calls.map((c) => c[1]);
      const superseded = audits.filter((a) => a.action === "tax_obligation.superseded");
      expect(superseded).toHaveLength(1);
      expect(superseded[0].after).toMatchObject({ reason: "registration_inactive", count: 2 });
      expect(superseded[0].entityRef).toBe("entity_tax_registration:tr1");
    });

    it("audits the run itself, with the actor the run had", async () => {
      fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 0, horizon: 1, actor: { user_id: "u-ada" } });

      expect(emit.audit.mock.calls.map((c) => c[1])).toContainEqual(expect.objectContaining({
        action: "tax_obligation.generated",
        moduleKey: "MOD-01",
        entityRef: "corporate_entity:e1",
        actorUserId: "u-ada",
        after: expect.objectContaining({ created: 2, superseded: 0, unassigned: 0 }),
      }));
    });

    it("summarises one run per entity rather than one event per obligation", async () => {
      fakeTenant({ registrations: [VAT_CM] });
      await tc.generateForEntity(CLIENT, "e1", { today: TODAY, backfill: 1, horizon: 3 });
      // Five obligations, one generated event. Twenty filings arriving as
      // twenty notifications is how a feed gets muted.
      expect(eventsOf("entity.tax_obligation_generated")).toHaveLength(1);
    });
  });

  describe("tenant-wide sweep", () => {
    it("continues past an entity that fails and reports it", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      repo.entitiesWithRegistrations.mockResolvedValue([
        { entity_id: "e1", code: "SLAS", legal_name: "Smart Logistics" },
        { entity_id: "e2", code: "SLFR", legal_name: "Smart Logistics France" },
      ]);
      repo.get.mockImplementation(async (_c, id) =>
        id === "e2" ? null : { entity_id: "e1", code: "SLAS", legal_name: "Smart Logistics" });

      const out = await tc.generateAll(CLIENT, { today: TODAY });

      // One bad entity does not cost the other its calendar, and the failure is
      // reported rather than swallowed — a clean summary over a defect is how a
      // defect stays invisible.
      expect(out.entities).toBe(2);
      expect(out.created).toBeGreaterThan(0);
      expect(out.failed).toEqual([expect.objectContaining({ entity_id: "e2", code: "SLFR" })]);
      expect(t.obligations.length).toBeGreaterThan(0);
    });
  });

  describe("transaction discipline", () => {
    it("commits a run, and rolls the whole entity back on failure", async () => {
      const t = fakeTenant({ registrations: [VAT_CM] });
      const client = fakeClient();

      await tc.generateForEntity(client, "e1", { today: TODAY, backfill: 0, horizon: 1 });
      expect(client.tx).toEqual(["BEGIN", "COMMIT"]);
      expect(t.obligations).toHaveLength(2);

      // A failure part way through must not leave a half-written calendar: the
      // obligations already inserted in this transaction roll back with it.
      const failing = fakeClient();
      repo.insertObligation.mockRejectedValueOnce(new Error("23505 duplicate key"));
      await expect(
        tc.generateForEntity(failing, "e1", { today: TODAY, backfill: 0, horizon: 1 }),
      ).rejects.toThrow("23505");
      expect(failing.tx).toEqual(["BEGIN", "ROLLBACK"]);
    });

    it("joins the caller's transaction when it already has one", async () => {
      fakeTenant({ registrations: [VAT_CM] });
      const client = fakeClient();
      // `own: false` is how generateAll's per-entity call and any future caller
      // that already holds a transaction keeps one boundary instead of nesting
      // a BEGIN Postgres would reject.
      await tc.generateForEntity(client, "e1", { today: TODAY, backfill: 0, horizon: 0, own: false });
      expect(client.tx).toEqual([]);
    });

    it("refuses an entity that does not exist rather than generating into the void", async () => {
      fakeTenant({ registrations: [VAT_CM] });
      repo.get.mockResolvedValue(null);
      await expect(
        tc.generateForEntity(fakeClient(), "nope", { today: TODAY }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("it does not invent a statutory-registration current-row rule", () => {
    it("reads only entity_tax_registration state", () => {
      // PR-03's doc/CORPORATE_ENTITY_REGISTRATION_CURRENT_ROW.md settles which
      // STATUTORY registration is current, and corporate_entity.renewals
      // consumes it. The generator must not grow a second, different answer:
      // `entity_registration` has no is_active/deregistered_on, so any rule
      // here would be invented.
      const src = require("fs").readFileSync(
        require.resolve("../../src/modules/master/corporate_entity/corporate_entity.tax-calendar"),
        "utf8",
      );
      expect(src).not.toMatch(/FROM\s+entity_registration/i);
      expect(src).not.toMatch(/JOIN\s+entity_registration/i);
      // And it says so, pointing at the contract rather than restating it.
      expect(src).toMatch(/CORPORATE_ENTITY_REGISTRATION_CURRENT_ROW\.md/);
    });
  });
});
