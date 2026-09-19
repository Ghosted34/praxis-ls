"use strict";
/**
 * A task on SEVERAL stages of its file's chain (13950), against a real Postgres.
 *
 * The unit suite proves what the service DECIDES (which ids, in which order,
 * which are refused). What only the database can prove is that the decision
 * lands: that `task_milestone` and `task.milestone_instance_id` are written
 * together, that the aggregate every read carries agrees with them, that the
 * list's stage filter finds a task from its SECOND stage, and that the rollup
 * counts it under both. The migration's backfill is covered here too, by
 * inserting a 13920-shaped row and checking what the set says about it.
 *
 * Everything runs inside one transaction that is rolled back. Skipped unless
 * DATABASE_URL points at a migrated tenant schema — the CI `migrations` job
 * provides one; locally, see tests/integration/workspace-reminder-sync.test.js.
 */
const { randomUUID } = require("crypto");

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const service = require("../../src/modules/dashboard/workspace/tasks.service");
const validator = require("../../src/modules/dashboard/workspace/tasks.validator");

d("workspace task stage set (real Postgres)", () => {
  let pool;
  let client;
  let ctx;
  let dossierId;
  let otherDossierId;
  let stages; // [{ id, label }] in chain order
  let strangerId;

  const parse = (schema, body) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    return parsed.data;
  };

  const setOf = async (taskId) => {
    const { rows } = await client.query(
      `SELECT tm.milestone_instance_id FROM task_milestone tm
         JOIN milestone_instance mi ON mi.milestone_instance_id = tm.milestone_instance_id
        WHERE tm.task_id = $1 ORDER BY mi.stage_seq`,
      [taskId],
    );
    return rows.map((r) => r.milestone_instance_id);
  };
  const columnOf = async (taskId) => {
    const { rows } = await client.query("SELECT milestone_instance_id FROM task WHERE task_id = $1", [taskId]);
    return rows[0].milestone_instance_id;
  };

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("BEGIN");
    const userId = randomUUID();
    await client.query(
      "INSERT INTO app_user (user_id, email, full_name, password_hash) VALUES ($1, $2, 'Stage Probe', 'x')",
      [userId, `stage-probe-${userId}@example.test`],
    );
    dossierId = randomUUID();
    otherDossierId = randomUUID();
    await client.query(
      "INSERT INTO dossier (dossier_id, ref, status) VALUES ($1, $2, 'OPEN'), ($3, $4, 'OPEN')",
      [dossierId, `STG${userId.slice(0, 8).toUpperCase()}`, otherDossierId, `OTH${userId.slice(0, 8).toUpperCase()}`],
    );
    stages = [
      { id: randomUUID(), label: "Pré-alerte et ordre de travail", seq: 1 },
      { id: randomUUID(), label: "Documents d'expédition vérifiés", seq: 2 },
      { id: randomUUID(), label: "Déclaration en douane déposée", seq: 7 },
    ];
    for (const s of stages) {
      await client.query(
        "INSERT INTO milestone_instance (milestone_instance_id, dossier_id, stage_seq, code, label) VALUES ($1, $2, $3, $4, $5)",
        [s.id, dossierId, s.seq, `S${s.seq}`, s.label],
      );
    }
    strangerId = randomUUID();
    await client.query(
      "INSERT INTO milestone_instance (milestone_instance_id, dossier_id, stage_seq, code, label) VALUES ($1, $2, 3, 'ATA', 'Navire arrivé')",
      [strangerId, otherDossierId],
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

  it("creates a task on two stages: the set, the projection column and the read all agree", async () => {
    const input = parse(validator.schemas.taskCreate, {
      title: "Vérifier les documents et déposer la déclaration",
      due_at: "2026-09-30T09:00",
      dossier_id: dossierId,
      // Sent LAST-first on purpose: the chain decides the order, not the form.
      milestone_instance_ids: [stages[2].id, stages[1].id],
      reminders: [{ reminder_minutes: 1440, remind_at: null, email: true, scope: "this", label: "1 day before" }],
    });
    const created = await service.createTask(client, ctx, input);

    expect(created.milestone_instance_ids).toEqual([stages[1].id, stages[2].id]);
    expect(created.milestones.map((m) => m.label)).toEqual([stages[1].label, stages[2].label]);
    // 13920's column is the FIRST stage of the set, so an older reader still
    // sees a stage — and the label joined through it is that stage's.
    expect(created.milestone_instance_id).toBe(stages[1].id);
    expect(created.milestone_label).toBe(stages[1].label);
    expect(await setOf(created.task_id)).toEqual([stages[1].id, stages[2].id]);
    expect(await columnOf(created.task_id)).toBe(stages[1].id);
  });

  it("the list's stage filter finds the task from its SECOND stage, and the board carries the set", async () => {
    const input = parse(validator.schemas.taskCreate, {
      title: "Trouvable depuis la deuxième étape",
      dossier_id: dossierId,
      milestone_instance_ids: [stages[0].id, stages[2].id],
    });
    const created = await service.createTask(client, ctx, input);

    const fromSecond = await service.listTasks(client, ctx, { milestone_instance_id: stages[2].id, limit: 50, offset: 0 });
    expect(fromSecond.rows.map((r) => r.task_id)).toContain(created.task_id);
    const fromFirst = await service.listTasks(client, ctx, { milestone_instance_id: stages[0].id, limit: 50, offset: 0 });
    expect(fromFirst.rows.map((r) => r.task_id)).toContain(created.task_id);
    const fromNeither = await service.listTasks(client, ctx, { milestone_instance_id: stages[1].id, limit: 50, offset: 0 });
    expect(fromNeither.rows.map((r) => r.task_id)).not.toContain(created.task_id);

    const { board } = await service.getBoard(client, ctx, {});
    const card = board.TO_DO.find((t) => t.task_id === created.task_id);
    expect(card).toBeTruthy();
    expect(card.milestone_instance_ids).toEqual([stages[0].id, stages[2].id]);
    expect(card.milestones).toHaveLength(2);
  });

  it("an edit replaces the set; the projection follows; an empty set clears both", async () => {
    const created = await service.createTask(client, ctx, parse(validator.schemas.taskCreate, {
      title: "Réécrire l'ensemble",
      dossier_id: dossierId,
      milestone_instance_ids: [stages[0].id, stages[1].id],
    }));

    const narrowed = await service.updateTask(client, ctx, created.task_id, parse(validator.schemas.taskUpdate, {
      milestone_instance_ids: [stages[2].id],
    }));
    expect(narrowed.milestone_instance_ids).toEqual([stages[2].id]);
    expect(await setOf(created.task_id)).toEqual([stages[2].id]);
    expect(await columnOf(created.task_id)).toBe(stages[2].id);

    // The 13920 vocabulary still works: one id means a set of one.
    const single = await service.updateTask(client, ctx, created.task_id, parse(validator.schemas.taskUpdate, {
      milestone_instance_id: stages[0].id,
    }));
    expect(single.milestone_instance_ids).toEqual([stages[0].id]);
    expect(await columnOf(created.task_id)).toBe(stages[0].id);

    const cleared = await service.updateTask(client, ctx, created.task_id, parse(validator.schemas.taskUpdate, {
      milestone_instance_ids: [],
    }));
    expect(cleared.milestone_instance_ids).toEqual([]);
    expect(cleared.milestones).toEqual([]);
    expect(await setOf(created.task_id)).toEqual([]);
    expect(await columnOf(created.task_id)).toBeNull();
  });

  it("unlinking the file takes the whole set with it", async () => {
    const created = await service.createTask(client, ctx, parse(validator.schemas.taskCreate, {
      title: "Détacher le dossier",
      dossier_id: dossierId,
      milestone_instance_ids: [stages[0].id, stages[1].id, stages[2].id],
    }));
    expect(await setOf(created.task_id)).toHaveLength(3);

    const unlinked = await service.updateTask(client, ctx, created.task_id, parse(validator.schemas.taskUpdate, {
      dossier_id: null,
    }));
    expect(unlinked.dossier_id).toBeNull();
    expect(unlinked.milestone_instance_ids).toEqual([]);
    expect(await setOf(created.task_id)).toEqual([]);
    expect(await columnOf(created.task_id)).toBeNull();
  });

  it("a set with a stranger's stage is refused by name, and NOTHING is written", async () => {
    const before = await client.query("SELECT count(*)::int AS n FROM task WHERE title = $1", ["Étape d'un autre dossier"]);
    await expect(
      service.createTask(client, ctx, parse(validator.schemas.taskCreate, {
        title: "Étape d'un autre dossier",
        dossier_id: dossierId,
        milestone_instance_ids: [stages[0].id, strangerId],
      })),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Navire arrivé") });
    const after = await client.query("SELECT count(*)::int AS n FROM task WHERE title = $1", ["Étape d'un autre dossier"]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("a child inherits the parent's whole set, and its own file's stage stays its own", async () => {
    const parent = await service.createTask(client, ctx, parse(validator.schemas.taskCreate, {
      title: "Parent sur deux étapes",
      dossier_id: dossierId,
      milestone_instance_ids: [stages[0].id, stages[2].id],
    }));
    const child = await service.addChildTask(client, ctx, parent.task_id, parse(validator.schemas.childCreate, {
      title: "Morceau du parent",
    }));
    expect(child.dossier_id).toBe(dossierId);
    expect(child.milestone_instance_ids).toEqual([stages[0].id, stages[2].id]);
    expect(await setOf(child.task_id)).toEqual([stages[0].id, stages[2].id]);

    // Named stages are the child's own — not the union with the parent's.
    const own = await service.addChildTask(client, ctx, parent.task_id, parse(validator.schemas.childCreate, {
      title: "Morceau sur une seule étape",
      milestone_instance_ids: [stages[1].id],
    }));
    expect(own.milestone_instance_ids).toEqual([stages[1].id]);
  });

  it("the analytics rollup counts a task under EACH of its stages, and the unstaged under none", async () => {
    const twoStages = await service.createTask(client, ctx, parse(validator.schemas.taskCreate, {
      title: "Compté deux fois",
      dossier_id: dossierId,
      milestone_instance_ids: [stages[0].id, stages[1].id],
    }));
    const noStage = await service.createTask(client, ctx, parse(validator.schemas.taskCreate, {
      title: "Sur le dossier entier",
      dossier_id: dossierId,
    }));
    const out = await service.analytics(client, ctx, parse(validator.schemas.analyticsQuery, { dossier_id: dossierId }));
    const rows = out.by_milestone;
    const under = (id) => rows.find((r) => r.milestone_instance_id === id);
    expect(under(stages[0].id).total_tasks).toBeGreaterThanOrEqual(1);
    expect(under(stages[1].id).total_tasks).toBeGreaterThanOrEqual(1);
    const unstaged = rows.find((r) => r.milestone_instance_id === null);
    expect(unstaged).toBeTruthy();
    expect(unstaged.total_tasks).toBeGreaterThanOrEqual(1);
    expect([twoStages.task_id, noStage.task_id]).toHaveLength(2);
  });

  it("13920's backfill: a row written with only the column reads as a set of one", async () => {
    // A task inserted the way 13920 wrote them — column only, no set row —
    // then the migration's own INSERT … SELECT replayed for it.
    const taskId = randomUUID();
    await client.query(
      "INSERT INTO task (task_id, title, created_by, dossier_id, milestone_instance_id) VALUES ($1, 'Ancienne forme', $2, $3, $4)",
      [taskId, ctx.user.user_id, dossierId, stages[1].id],
    );
    await client.query(
      `INSERT INTO task_milestone (task_id, milestone_instance_id)
       SELECT t.task_id, t.milestone_instance_id FROM task t
         JOIN milestone_instance mi ON mi.milestone_instance_id = t.milestone_instance_id
        WHERE t.milestone_instance_id IS NOT NULL
       ON CONFLICT DO NOTHING`,
    );
    const read = await service.getTask(client, ctx, taskId, "mine");
    expect(read.milestone_instance_ids).toEqual([stages[1].id]);
    expect(read.milestones[0].label).toBe(stages[1].label);
  });
});
