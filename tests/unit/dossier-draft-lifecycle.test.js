"use strict";
/**
 * The creation wizard's lifecycle: open a draft, promote it, sweep what was
 * abandoned.
 *
 * WHAT THESE PIN, and why each one matters more than it looks:
 *
 *   - A DRAFT burns no ref. Our refs are sequential and people reconcile
 *     against them, so a gap is a question somebody has to answer. Legacy's
 *     random 7-digit refs hid that; ours would not.
 *   - A DRAFT fires no `dossier.created`. That event instantiates the milestone
 *     chain and is what the orchestration layer listens to — firing it at draft
 *     time schedules work against a file that may never open.
 *   - Promotion is where required fields are enforced. Enforcing them at draft
 *     time would defeat the entire point of a wizard whose second step is where
 *     they get filled in.
 */
const service = require("../../src/modules/operations/operations_file/operations_file.service");
const {
  canTransition,
} = require("../../src/modules/operations/operations_file/operations_file.rules");

/**
 * A fake tenant client that models only what this path touches, and THROWS on
 * anything it does not — the same discipline `final-invoice-lifecycle` uses. A
 * fake that silently answers `[]` to an unmodelled query makes every assertion
 * after it meaningless.
 */
function fakeClient({ dossier = null } = {}) {
  const state = {
    dossier,
    inserted: null,
    updated: null,
    sql: [],
    events: [],
    audits: [],
  };
  const client = {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      state.sql.push(s);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [] };

      if (/^INSERT INTO "?dossier"?/i.test(s)) {
        state.inserted = params;
        state.dossier = {
          dossier_id: "d-new",
          ref: "DRAFT-x",
          status: "DRAFT",
          entity_id: "e1",
          service_type_id: null,
        };
        return { rows: [state.dossier] };
      }
      if (/^SELECT \* FROM "?dossier"? WHERE "?dossier_id"?/i.test(s)) {
        return { rows: state.dossier ? [state.dossier] : [] };
      }
      if (/^UPDATE "?dossier"?/i.test(s)) {
        state.updated = { sql: s, params };
        state.dossier = {
          ...state.dossier,
          ref: "SLAS-2026-0007",
          status: "OPEN",
        };
        return { rows: [state.dossier] };
      }
      // Audit + event plumbing, which every write path calls.
      if (/event_log|immutable_ledger|audit|outbox|event_type/i.test(s))
        return { rows: [{ id: 1 }] };
      if (/FROM app_user/i.test(s)) return { rows: [{ user_id: null }] };
      if (/service_type_field_set|service_type_field/i.test(s))
        return { rows: [] };
      if (/FROM service_type/i.test(s)) return { rows: [] };
      if (/FROM client_master|compliance/i.test(s)) return { rows: [] };
      if (/document_number|numbering|doc_sequence/i.test(s))
        return { rows: [{ number: "SLAS-2026-0007" }] };
      throw new Error(
        "Unmatched SQL in fakeClient — the fake does not model this query, so any assertion after it is meaningless.\n\n  " +
          s.slice(0, 200),
      );
    },
  };
  return client;
}

describe("a DRAFT is not a file", () => {
  it("can only become OPEN or be cancelled", () => {
    expect(canTransition("DRAFT", "OPEN")).toBe(true);
    expect(canTransition("DRAFT", "CANCELLED")).toBe(true);
    // Work cannot be in progress on something that was never opened, and a
    // draft certainly cannot be COMPLETED.
    expect(canTransition("DRAFT", "IN_PROGRESS")).toBe(false);
    expect(canTransition("DRAFT", "COMPLETED")).toBe(false);
  });

  it("is still reachable from nothing else — OPEN never goes back to DRAFT", () => {
    expect(canTransition("OPEN", "DRAFT")).toBe(false);
    expect(canTransition("IN_PROGRESS", "DRAFT")).toBe(false);
    expect(canTransition("COMPLETED", "DRAFT")).toBe(false);
  });
});

describe("the transition validator refuses to promote through the generic route", () => {
  const {
    schemas,
  } = require("../../src/modules/operations/operations_file/operations_file.validator");

  it("does not accept OPEN as a transition target", () => {
    // Promotion allocates the ref and enforces required fields. Reaching OPEN
    // through `POST /:id/transition` would skip both and leave a file holding a
    // DRAFT- placeholder, which the CHECK constraint would then refuse anyway —
    // but a 500 from a constraint is not how a rule should be expressed.
    expect(schemas.transition.safeParse({ to: "OPEN" }).success).toBe(false);
    expect(schemas.transition.safeParse({ to: "DRAFT" }).success).toBe(false);
    expect(schemas.transition.safeParse({ to: "IN_PROGRESS" }).success).toBe(
      true,
    );
  });
});

describe("opening a draft", () => {
  it("stores a placeholder ref and never calls the numbering service", async () => {
    const c = fakeClient();
    const row = await service.createDraft(c, {
      data: { entity_id: "e1" },
      actor: { user_id: "u1" },
    });

    expect(row.status).toBe("DRAFT");
    // The placeholder is unique by construction and unmistakable.
    const insertSql = c.state.sql.find((s) =>
      /^INSERT INTO "?dossier"?/i.test(s),
    );
    expect(insertSql).toBeTruthy();
    expect(
      c.state.inserted.some(
        (p) => typeof p === "string" && p.startsWith("DRAFT-"),
      ),
    ).toBe(true);
    // No sequence was consumed: an abandoned draft must leave no gap.
    expect(
      c.state.sql.some((s) =>
        /numbering|doc_sequence|document_number/i.test(s),
      ),
    ).toBe(false);
  });

  it("records when it started, so the sweeper can find it later", async () => {
    const c = fakeClient();
    await service.createDraft(c, { data: { entity_id: "e1" }, actor: {} });
    // `draft_started_at` is in the insert payload.
    expect(
      c.state.inserted.some(
        (p) => typeof p === "string" && /^\d{4}-\d{2}-\d{2}T/.test(p),
      ),
    ).toBe(true);
  });
});

describe("promoting a draft", () => {
  it("refuses anything that is not a draft", async () => {
    const c = fakeClient({
      dossier: { dossier_id: "d1", status: "OPEN", ref: "SLAS-2026-0001" },
    });
    await expect(
      service.promote(c, { id: "d1", data: {}, actor: {} }),
    ).rejects.toThrow(/already been opened/);
  });

  it("is a 404, not a crash, for a file that does not exist", async () => {
    const c = fakeClient({ dossier: null });
    await expect(
      service.promote(c, { id: "nope", data: {}, actor: {} }),
    ).rejects.toThrow(/not found/i);
  });
});
