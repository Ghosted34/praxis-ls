/**
 * Clash normalisation — create and update are the same check (B-12 / guide PR 3).
 *
 * What must hold and is pinned here:
 *
 *   - the clash SELECT never sees a caller's zoneless wall clock: both paths
 *     resolve the input on the tenant's clock first, so "14:00" means the
 *     same instants as every other read of that day;
 *   - both paths answer `force: true` with NO select at all — the force is
 *     a decision, not a slower way to the same refusal;
 *   - the update excludes its OWN row, so re-saving an event unchanged does
 *     not clash with itself;
 *   - the update checks only when the slot-moving inputs moved — a title edit
 *     is not a booking decision.
 *
 * Scripted client, no tenant: the statements ARE the contract.
 */
"use strict";

const service = require("../../src/modules/dashboard/workspace/tasks.service");
const { AppError } = require("../../src/utils/errors");

const ORGANISER = "u-organiser";
const ORG_EVENT = {
  calendar_event_id: "e1",
  title: "Client fitting",
  event_type: "meeting",
  location: "Board room",
  description: null,
  start_at: "2026-09-15T13:00:00.000Z",
  end_at: "2026-09-15T14:00:00.000Z",
  all_day: false,
  recurrence_rule: null,
  recurrence_series_id: null,
  created_by: ORGANISER,
  is_deleted: false,
  scope_id: null,
  entity_type: null,
  entity_id: null,
};

const clashRow = {
  calendar_event_id: "e-other",
  title: "Already booked",
  start_at: "2026-09-15T08:00:00.000Z",
  end_at: "2026-09-15T09:00:00.000Z",
  location: "Board room",
};

function mockClient({ clashes = [], event = ORG_EVENT } = {}) {
  const statements = [];
  return {
    statements,
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      if (/SELECT value FROM setting/.test(sql)) return { rows: [], rowCount: 0 };
      // The overlap predicate of repo.findEventClashes: location-scoped and
      // endpoint-strict. Matched loosely, deliberately, so a cosmetic SQL
      // re-decoration is not a test edit.
      if (/e\.location IS NOT NULL/.test(sql) && /e\.start_at < \$3/.test(sql)) {
        return { rows: clashes };
      }
      if (/FROM calendar_event e\s+LEFT JOIN app_user c/.test(sql)) return { rows: [event] };
      return { rows: [], rowCount: 0 };
    },
  };
}

const ctx = { user: { user_id: ORGANISER }, audience: "mine", permission_scope: "scoped", scope_ids: [] };

/** The clash SELECTs this client saw, with their parameters. */
const clashReads = (c) => c.statements.filter((s) => /e\.location IS NOT NULL/.test(s.sql));

describe("event clash — normalised instants on both writes", () => {
  it("create compares resolved instants, never the raw wall string", async () => {
    const c = mockClient({ clashes: [clashRow] });
    await expect(
      service.createEvent(c, ctx, {
        title: "Another booking",
        location: "Board room",
        start_at: "2026-09-15T09:00",
        end_at: "2026-09-15T10:00",
      }),
    ).rejects.toMatchObject({ code: "CLASH_DETECTED" });
    const reads = clashReads(c);
    expect(reads).toHaveLength(1);
    // 09:00 wall on Africa/Douala is 08:00Z — the same instant the calendar,
    // Today and the reminder sweep already agree on. [location, start, end].
    expect(reads[0].params[1]).toBe("2026-09-15T08:00:00.000Z");
    expect(reads[0].params[2]).toBe("2026-09-15T09:00:00.000Z");
  });

  it("update resolves the same way and excludes the event's own row", async () => {
    const c = mockClient({ clashes: [clashRow] });
    await expect(
      service.updateEvent(c, ctx, "e1", {
        location: "Board room",
        start_at: "2026-09-15T09:00",
        end_at: "2026-09-15T10:00",
      }),
    ).rejects.toMatchObject({ code: "CLASH_DETECTED" });
    const reads = clashReads(c);
    expect(reads).toHaveLength(1);
    expect(reads[0].params[1]).toBe("2026-09-15T08:00:00.000Z");
    expect(reads[0].params[2]).toBe("2026-09-15T09:00:00.000Z");
    // params[3] is the self-exclusion. Without it, moving an event an hour
    // into its own slot would clash with ITS OWN three o'clock self.
    expect(reads[0].params[3]).toBe("e1");
  });

  it("force skips the check entirely on create", async () => {
    const c = mockClient({ clashes: [clashRow] });
    // The insert path needs the created row back; the mock's default empty
    // row is enough to finish createEvent after it skips the clash gate.
    // findEvent (getEvent) then re-reads it — the event fixture answers.
    const out = await service
      .createEvent(c, ctx, {
        title: "Another booking",
        location: "Board room",
        start_at: "2026-09-15T09:00",
        end_at: "2026-09-15T10:00",
        force: true,
      })
      .catch((err) => err);
    expect(out).not.toBeInstanceOf(AppError);
    expect(clashReads(c)).toHaveLength(0);
  });

  it("update with a new title but no slot change never checks", async () => {
    const c = mockClient({ clashes: [clashRow] });
    await service.updateEvent(c, ctx, "e1", { title: "Client fitting — moved to their office" });
    expect(clashReads(c)).toHaveLength(0);
  });
});
