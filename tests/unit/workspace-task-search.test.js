"use strict";
/**
 * The Tasks search — what `q` finds, and that Board and List find the same.
 *
 * `q` matched `t.title` alone, which is the field people remember least
 * reliably: "the Brasseries one" is a client name, "the BL chase on SL3213" is
 * a file reference, "call before the scanner slot" is in the notes. The
 * predicate now covers the title, the notes, the linked file's reference and
 * client, and the titles of the steps under the task — bound ONCE and tested
 * against each column, on both the list and the board, so the one search box
 * on the Tasks page narrows whichever view is showing.
 *
 * Asserted the way the rest of tasks.repo is: the statement is captured and
 * its placeholders checked against its parameters.
 */

const repo = require("../../src/modules/dashboard/workspace/tasks.repo");
const validator = require("../../src/modules/dashboard/workspace/tasks.validator");

function mockClient(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    },
  };
}

const placeholders = (sql) =>
  [...new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);

const expectBound = ({ sql, params }) => {
  expect(placeholders(sql)).toEqual(params.map((_, i) => i + 1));
};

const VIS = { audience: "mine", userId: "u1" };

const SEARCHED_COLUMNS = ["t.title", "t.description", "dv.ref", "dcm.name", "sq.title"];

describe("tasks.repo — free-text search", () => {
  it("the list matches the title, the notes, the file reference, the client and step titles with ONE bound pattern", async () => {
    const c = mockClient();
    await repo.listTasks(c, { ...VIS, q: "brasseries", limit: 50, offset: 0 });
    const call = c.calls[0];
    expectBound(call);
    const n = call.params.indexOf("%brasseries%") + 1;
    expect(n).toBeGreaterThan(0);
    for (const col of SEARCHED_COLUMNS) {
      expect(call.sql).toContain(`${col} ILIKE $${n}`);
    }
    // Steps are reached through the task, never joined in — a join would
    // multiply the row by its step count and break COUNT(*) OVER().
    expect(call.sql).toContain("EXISTS (SELECT 1 FROM task_subtask sq WHERE sq.task_id = t.task_id");
    // The pattern is bound exactly once, however many columns test it.
    expect(call.params.filter((p) => p === "%brasseries%")).toHaveLength(1);
  });

  it("the board answers the SAME search, so Board↔List finds the same cards", async () => {
    const c = mockClient();
    await repo.boardTasks(c, { ...VIS, q: "SL3213" });
    const call = c.calls[0];
    expectBound(call);
    const n = call.params.indexOf("%SL3213%") + 1;
    expect(n).toBeGreaterThan(0);
    for (const col of SEARCHED_COLUMNS) {
      expect(call.sql).toContain(`${col} ILIKE $${n}`);
    }
  });

  it("no q, no predicate — an empty search box does not cost five ILIKEs per row", async () => {
    const c = mockClient();
    await repo.listTasks(c, { ...VIS, limit: 50, offset: 0 });
    expect(c.calls[0].sql).not.toContain("ILIKE");
    const b = mockClient();
    await repo.boardTasks(b, { ...VIS });
    expect(b.calls[0].sql).not.toContain("ILIKE");
  });

  it("escapes the user's % and _ so they search for themselves, not for anything", async () => {
    const c = mockClient();
    await repo.listTasks(c, { ...VIS, q: "100% a_b", limit: 50, offset: 0 });
    expect(c.calls[0].params).toContain("%100\\% a\\_b%");
  });

  it("the search sits beside every other filter without disturbing their numbering", async () => {
    const c = mockClient();
    await repo.listTasks(c, {
      ...VIS,
      status: "TO_DO",
      priority: "HIGH",
      assignedTo: "u2",
      dossierId: "d1",
      milestoneInstanceId: "m1",
      q: "bl",
      entity: { entity_type: "costing", entity_id: "e1" },
      limit: 20,
      offset: 40,
    });
    expectBound(c.calls[0]);
    expect(c.calls[0].params.slice(0, 2)).toEqual([20, 40]);
  });
});

describe("the calendar's deadline rows carry what its filter searches", () => {
  it("subtasksInRange reads the parent's notes, file reference and client beside the step", async () => {
    const c = mockClient();
    await repo.subtasksInRange(c, {
      from: "2026-01-01T00:00:00Z",
      to: "2026-02-01T00:00:00Z",
      visibility: VIS,
    });
    const { sql } = c.calls[0];
    expectBound(c.calls[0]);
    expect(sql).toContain("t.description AS task_description");
    expect(sql).toContain("dv.ref AS dossier_ref");
    expect(sql).toContain("dcm.name AS dossier_client_name");
    // Through the view, never the base table — a draft is not a file.
    expect(sql).toContain("dossier_visible dv");
    expect(sql).not.toMatch(/JOIN\s+dossier\b(?!_)/);
  });

  it("deadlinesInRange puts the searchable words on every item, a step's being its parent's", async () => {
    const service = require("../../src/modules/dashboard/workspace/tasks.service");
    const ctx = { user: { user_id: "u1" }, permission_scope: "all", scope_ids: null, audience: "mine" };
    const taskRow = {
      task_id: "t1", title: "Chase the BL", status: "TO_DO", priority: "HIGH", due_at: "2026-01-10T09:00:00Z",
      description: "Call the carrier first", dossier_id: "d1", dossier_ref: "SL3213", dossier_client_name: "Brasseries",
      milestones: [{ milestone_instance_id: "m1", label: "Shipping documents verified", stage_seq: 2, status: "PENDING" }],
    };
    const stepRow = {
      task_subtask_id: "s1", task_id: "t1", title: "Send the draft", due_at: "2026-01-09T09:00:00Z", is_done: false,
      task_title: "Chase the BL", task_status: "TO_DO", task_priority: "HIGH",
      task_description: "Call the carrier first", dossier_ref: "SL3213", dossier_client_name: "Brasseries",
    };
    const client = {
      query: async (sql) => {
        // The task select carries correlated step COUNTS, so it also mentions
        // task_subtask — the step read is told apart by what it SELECTs.
        if (/SELECT s\.task_subtask_id/.test(sql)) return { rows: [stepRow], rowCount: 1 };
        if (/FROM task t/.test(sql)) return { rows: [taskRow], rowCount: 1 };
        // tenant clock lookups and anything else: nothing configured
        return { rows: [], rowCount: 0 };
      },
    };
    const out = await service.deadlinesInRange(client, ctx, {
      from: "2026-01-01T00:00:00Z",
      to: "2026-02-01T00:00:00Z",
    });
    const step = out.items.find((i) => i.kind === "subtask");
    const task = out.items.find((i) => i.kind === "task");
    expect(task).toMatchObject({
      description: "Call the carrier first",
      dossier_ref: "SL3213",
      dossier_client_name: "Brasseries",
      milestone_labels: ["Shipping documents verified"],
    });
    expect(step).toMatchObject({
      task_title: "Chase the BL",
      description: "Call the carrier first",
      dossier_ref: "SL3213",
      dossier_client_name: "Brasseries",
      milestone_labels: [],
    });
  });
});

describe("tasks.validator — the stage set and the board search", () => {
  const ok = (schema, body) => {
    const r = schema.safeParse(body);
    if (!r.success) throw new Error(JSON.stringify(r.error.issues));
    return r.data;
  };

  it("taskCreate, taskUpdate and the child form accept milestone_instance_ids beside the single column", () => {
    const ids = ["7f0e7b5e-9d3c-4c7e-9d26-2a5b4a0c1e11", "1c9a7e2d-2b4f-4d0e-8f3a-6b7c8d9e0f12"];
    expect(ok(validator.schemas.taskCreate, { title: "x", milestone_instance_ids: ids }).milestone_instance_ids).toEqual(ids);
    expect(ok(validator.schemas.taskUpdate, { milestone_instance_ids: [] }).milestone_instance_ids).toEqual([]);
    expect(ok(validator.schemas.childCreate, { title: "child", milestone_instance_ids: ids }).milestone_instance_ids).toEqual(ids);
  });

  it("refuses a set that is not uuids, or that is larger than any chain", () => {
    expect(validator.schemas.taskCreate.safeParse({ title: "x", milestone_instance_ids: ["nope"] }).success).toBe(false);
    const tooMany = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(validator.schemas.taskCreate.safeParse({ title: "x", milestone_instance_ids: tooMany }).success).toBe(false);
  });

  it("the board query accepts q, like every list", () => {
    expect(ok(validator.schemas.boardQuery, { q: "brasseries" }).q).toBe("brasseries");
  });
});
