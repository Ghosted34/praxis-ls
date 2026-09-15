"use strict";

/**
 * Chasing an approver, without becoming a nuisance (12774).
 *
 * WHAT THESE PIN.
 *
 * 1. THE CEILING IS THREE, AND IT IS CODE. The owner's instruction was
 *    "thrice a day. No more! To avoid mounting pressure on CEO." A configurable
 *    ceiling on nagging is a ceiling that gets raised, so it lives in the rules
 *    beside the lifecycle rather than in a setting.
 *
 * 2. ONLY A PENDING SHEET CAN BE CHASED. A DRAFT has nobody waiting on it and
 *    an APPROVED one is done; a reminder about either is a message that wastes
 *    the recipient's one moment of attention.
 *
 * 3. THE QUOTA IS PER COSTING, NOT PER RECIPIENT. A director with ten sheets
 *    waiting has ten real decisions and should hear about each; what must not
 *    happen is one sheet arriving eleven times. Keying on the recipient would
 *    also let a noisy file silently spend everyone else's quota.
 */

const rules = require("../../src/modules/costing/costing/costing.rules");
const events = require("../../src/modules/costing/costing/costing.events");

describe("the reminder ceiling", () => {
  test("three a day, in code rather than in a setting", () => {
    expect(rules.NUDGE_DAILY_LIMIT).toBe(3);
  });

  test("only the two waiting states can be chased", () => {
    expect(rules.NUDGE_STAGE.SUBMITTED_FOR_VALIDATION).toBe("VALIDATION");
    expect(rules.NUDGE_STAGE.SUBMITTED_FOR_APPROVAL).toBe("APPROVAL");
    // A draft has nobody waiting; an approved sheet is finished; a rejected one
    // is back with its author. None of them is somebody's queue.
    expect(rules.NUDGE_STAGE.DRAFT).toBeUndefined();
    expect(rules.NUDGE_STAGE.APPROVED_LOCKED).toBeUndefined();
    expect(rules.NUDGE_STAGE.REJECTED).toBeUndefined();
  });

  test("a reminder is its own event, not a status change", () => {
    // Nothing about the costing moved — this records that somebody was ASKED to
    // look at it, which is a different fact and belongs on its own key.
    expect(events.NUDGED).toBe("costing.nudged");
    expect(events.statusChange("APPROVED_LOCKED")).not.toBe(events.NUDGED);
  });
});

describe("the quota table", () => {
  const sql = require("fs").readFileSync(
    require("path").join(__dirname, "../../migrations/tenant/12774_costing_nudge.sql"),
    "utf8",
  );

  test("the count is keyed on the costing and the day", () => {
    // Per costing per day. The index has to serve exactly the read the quota
    // makes, or the check becomes a sequential scan on every dialog open.
    expect(sql).toMatch(/costing_nudge \(costing_id, sent_on\)/);
  });

  test("a reminder survives having no single recipient", () => {
    // A workflow step assigned to a ROLE notifies everyone holding it; the row
    // still records that the nudge happened, so the quota still counts it.
    expect(sql).toMatch(/recipient_user_id uuid REFERENCES app_user\(user_id\)/);
    expect(sql).not.toMatch(/recipient_user_id uuid NOT NULL/);
  });

  test("the stage is constrained to the two queues", () => {
    expect(sql).toMatch(/CHECK \(stage IN \('VALIDATION','APPROVAL'\)\)/);
  });

  test("deleting a costing takes its reminders with it", () => {
    expect(sql).toMatch(/REFERENCES costing\(costing_id\) ON DELETE CASCADE/);
  });
});

describe("the gate the dialog reads", () => {
  const repo = require("../../src/modules/costing/costing/costing.repo");
  const spy = () => { const sql = []; return { sql, query: async (q) => { sql.push(q); return { rows: [] }; } }; };

  test("the file's costing is resolved deterministically", async () => {
    // `LIMIT 1` with no ORDER BY was non-deterministic: a file that had been
    // through an unlock could answer with either version depending on the plan,
    // so the dialog could attach a request to a superseded budget.
    const c = spy();
    await repo.liveForDossier(c, "d");
    expect(c.sql[0]).toContain("ORDER BY (status = 'APPROVED_LOCKED') DESC, created_at DESC");
  });

  test("the gate names whoever is actually blocking, person or role", async () => {
    const c = spy();
    await repo.gateForDossier(c, "d");
    const q = c.sql[0];
    // The OLDEST pending step is the one blocking — a chain with two open steps
    // is waiting on the first of them.
    expect(q).toContain("status = 'PENDING'");
    expect(q).toContain("ORDER BY created_at LIMIT 1");
    // A step can name a role rather than a person, and then the people to chase
    // are everyone holding it — not nobody.
    expect(q).toContain("assigned_role_id");
    // And it carries today's count, so the dialog paints its status line in one
    // round trip rather than three.
    expect(q).toContain("sent_on = current_date");
  });

  test("a role names its ACTIVE holders, through the join table", async () => {
    // Roles are `user_role`, not a column on app_user; and a suspended or
    // locked account is not somebody to chase.
    const c = spy();
    await repo.usersInRole(c, "r");
    expect(c.sql[0]).toContain("JOIN user_role");
    expect(c.sql[0]).toContain("u.status = 'ACTIVE'");
  });

  test("no role means no query and no recipients", async () => {
    let called = false;
    const c = { query: async () => { called = true; return { rows: [] }; } };
    await expect(repo.usersInRole(c, null)).resolves.toEqual([]);
    expect(called).toBe(false);
  });
});
