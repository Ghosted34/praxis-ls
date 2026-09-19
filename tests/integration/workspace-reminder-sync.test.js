"use strict";
/**
 * Task and event writes that name their reminders, against a real Postgres.
 *
 * ── WHY A SCRIPTED CLIENT WAS NOT ENOUGH ────────────────────────────────────
 *
 * `POST /workspace/tasks` answered 500 INTERNAL_ERROR on the live tenant for
 * every task saved from the dialog (request 9d0a69d5-…): the dialog always
 * sends `reminders`, and the LAST statement of that path — the projection of
 * the first reminder onto `task.reminder_minutes/remind_at/reminder_sent_at` —
 * compared `owner_id` with the placeholder that carried `reminder_minutes`.
 * Postgres refused it at PARSE time (`42883 operator does not exist: text =
 * uuid`), whatever the values. Two earlier fixes went in with every unit test
 * green, because a scripted client accepts any SQL: only the database knows
 * what `$2` is. So this suite replays the failing request exactly — validator,
 * then service, on one pinned connection — against the real `task`,
 * `workspace_reminder`, `dossier` and `milestone_instance` tables.
 *
 * It also pins the second half of the symptom: the task row was COMMITTED
 * before the failing statement, so the board showed a card the form said had
 * not been created. `createTask` now runs its writes atomically, and a failure
 * after the insert must leave no task behind.
 *
 * Everything is written inside one transaction that is rolled back, so the
 * tenant is untouched. Skipped unless DATABASE_URL points at a migrated tenant
 * schema — same convention as the other integration suites.
 *
 *   DATABASE_URL   postgres connection string (search_path = the tenant schema)
 */
const { randomUUID } = require("crypto");

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const service = require("../../src/modules/dashboard/workspace/tasks.service");
const repo = require("../../src/modules/dashboard/workspace/tasks.repo");
const validator = require("../../src/modules/dashboard/workspace/tasks.validator");

/** The payload the dialog sent on 18 September 2026, ids swapped for fixtures. */
const dialogPayload = ({ dossierId, milestoneId }) => ({
  title: "Relancer le BL — Brasseries",
  description: "Première ligne\nDeuxième ligne",
  status: "TO_DO",
  priority: "URGENT",
  due_at: "2026-09-30T09:00",
  assigned_to: null,
  is_personal: false,
  dossier_id: dossierId,
  milestone_instance_id: milestoneId,
  reminders: [
    { reminder_minutes: 1440, remind_at: null, email: true, scope: "this", label: "1 day before" },
    { reminder_minutes: 60, remind_at: null, email: false, scope: "this", label: "1 hour before" },
  ],
});

d("workspace reminder projection (real Postgres)", () => {
  let pool;
  let client;
  let ctx;
  let dossierId;
  let stageIds;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("BEGIN");
    const userId = randomUUID();
    await client.query(
      "INSERT INTO app_user (user_id, email, full_name, password_hash) VALUES ($1, $2, 'Workspace Probe', 'x')",
      [userId, `workspace-probe-${userId}@example.test`],
    );
    dossierId = randomUUID();
    await client.query(
      "INSERT INTO dossier (dossier_id, ref, status) VALUES ($1, $2, 'OPEN')",
      [dossierId, `WSP${userId.slice(0, 8).toUpperCase()}`],
    );
    stageIds = [randomUUID(), randomUUID()];
    await client.query(
      `INSERT INTO milestone_instance (milestone_instance_id, dossier_id, stage_seq, code, label)
       VALUES ($1, $3, 1, 'PRE_ALERT', 'Pré-alerte et ordre de travail'),
              ($2, $3, 2, 'DOCS_VERIFIED', 'Documents d''expédition vérifiés')`,
      [stageIds[0], stageIds[1], dossierId],
    );
    ctx = { user: { user_id: userId }, permission_scope: "all", scope_ids: null, audience: "mine" };
  });

  afterAll(async () => {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    if (pool) await pool.end();
  });

  const parse = (schema, body) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    return parsed.data;
  };

  const parentColumns = async (taskId) => {
    const { rows } = await client.query(
      "SELECT reminder_minutes, remind_at, reminder_sent_at FROM task WHERE task_id = $1",
      [taskId],
    );
    return rows[0];
  };

  it("creates the task the dialog sends — file, stage and two reminders — and projects the first reminder", async () => {
    const input = parse(validator.schemas.taskCreate, dialogPayload({ dossierId, milestoneId: stageIds[0] }));
    const created = await service.createTask(client, ctx, input);

    expect(created.task_id).toBeTruthy();
    expect(created.dossier_id).toBe(dossierId);
    expect(created.milestone_instance_id).toBe(stageIds[0]);
    expect(created.milestone_label).toBe("Pré-alerte et ordre de travail");
    expect(created.reminders.map((r) => [r.ordinal, r.reminder_minutes, r.email])).toEqual([
      [1, 1440, true],
      [2, 60, false],
    ]);
    expect(await parentColumns(created.task_id)).toEqual({
      reminder_minutes: 1440,
      remind_at: null,
      reminder_sent_at: null,
    });
  });

  it("re-projects on every edit: clearing the set blanks the pair, an absolute reminder fills remind_at", async () => {
    const input = parse(validator.schemas.taskCreate, dialogPayload({ dossierId, milestoneId: stageIds[0] }));
    const created = await service.createTask(client, ctx, input);

    const cleared = await service.updateTask(client, ctx, created.task_id, parse(validator.schemas.taskUpdate, { reminders: [] }));
    expect(cleared.reminders).toEqual([]);
    expect(await parentColumns(created.task_id)).toEqual({ reminder_minutes: null, remind_at: null, reminder_sent_at: null });

    const moved = await service.updateTask(
      client,
      ctx,
      created.task_id,
      parse(validator.schemas.taskUpdate, {
        milestone_instance_id: stageIds[1],
        reminders: [{ remind_at: "2026-09-29T08:30:00Z", email: false, scope: "this" }],
      }),
    );
    expect(moved.milestone_label).toBe("Documents d'expédition vérifiés");
    const cols = await parentColumns(created.task_id);
    expect(cols.reminder_minutes).toBeNull();
    expect(new Date(cols.remind_at).toISOString()).toBe("2026-09-29T08:30:00.000Z");
  });

  it("carries a fired stamp from the first reminder onto the parent, and only then", async () => {
    const input = parse(validator.schemas.taskCreate, dialogPayload({ dossierId, milestoneId: null }));
    const created = await service.createTask(client, ctx, input);
    const sentAt = "2026-09-29T09:00:00.000Z";
    await client.query(
      `UPDATE workspace_reminder SET reminder_sent_at = $2
        WHERE owner_type = 'task' AND owner_id = $1 AND ordinal = 1 AND is_deleted = false`,
      [created.task_id, sentAt],
    );
    await repo.syncParentReminderColumns(client, "task", created.task_id);
    const cols = await parentColumns(created.task_id);
    expect(cols.reminder_minutes).toBe(1440);
    expect(new Date(cols.reminder_sent_at).toISOString()).toBe(sentAt);
  });

  it("projects a calendar event's reminders onto calendar_event the same way", async () => {
    const input = parse(validator.schemas.eventCreate, {
      title: "Comité opérations",
      start_at: "2026-10-01T09:00",
      end_at: "2026-10-01T10:00",
      reminders: [{ reminder_minutes: 15, email: false, scope: "this" }],
    });
    const event = await service.createEvent(client, ctx, input);
    const { rows } = await client.query(
      "SELECT reminder_minutes, remind_at FROM calendar_event WHERE calendar_event_id = $1",
      [event.calendar_event_id],
    );
    expect(rows[0]).toEqual({ reminder_minutes: 15, remind_at: null });
  });

  /**
   * The atomicity half needs a connection that is NOT inside this suite's
   * transaction: `atomically` joins an open one by design (shared/db/tx.js),
   * so only a top-level call shows whether the service opens and rolls back
   * its own. The probe user is committed and removed afterwards; when the
   * guarantee holds, nothing else of it ever reaches disk.
   */
  it("a failure after the insert leaves no task behind — the write is one transaction", async () => {
    const probe = await pool.connect();
    const probeUser = randomUUID();
    const title = `atomic-probe-${randomUUID()}`;
    try {
      await probe.query(
        "INSERT INTO app_user (user_id, email, full_name, password_hash) VALUES ($1, $2, 'Atomic Probe', 'x')",
        [probeUser, `atomic-probe-${probeUser}@example.test`],
      );
      // Passes the validator, fails in the service AFTER the row is in: a
      // relative reminder on a task with no due date to hang it off.
      const input = parse(validator.schemas.taskCreate, {
        title,
        due_at: null,
        reminders: [{ reminder_minutes: 60, email: false, scope: "this" }],
      });
      const probeCtx = { user: { user_id: probeUser }, permission_scope: "all", scope_ids: null, audience: "mine" };
      await expect(service.createTask(probe, probeCtx, input)).rejects.toMatchObject({ status: 400 });
      const { rows } = await probe.query("SELECT task_id FROM task WHERE title = $1", [title]);
      expect(rows).toEqual([]);
      // And the connection is usable again — no transaction left open or aborted.
      expect((await probe.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    } finally {
      await probe.query("DELETE FROM task WHERE created_by = $1", [probeUser]).catch(() => {});
      await probe.query("DELETE FROM app_user WHERE user_id = $1", [probeUser]).catch(() => {});
      probe.release();
    }
  });
});
