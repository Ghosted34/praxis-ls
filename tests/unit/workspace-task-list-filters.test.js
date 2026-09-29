"use strict";
/**
 * The operations file's Tasks tab listed OTHER files' tasks (28 Sep 2026).
 *
 * A brand-new file opened on its Tasks tab and showed work filed under older
 * files — "SL3213P44RG55ZSM · Livraison au destinataire" under a file whose
 * reference was nothing like it. The tab asks for `?dossier_id=<this file>`,
 * the validator accepted it, the service and the repo both honoured it — and
 * the HTTP handler in between never passed it on. So the list answered with
 * every task the reader could see, and nothing on screen said the filter had
 * been dropped: the answer looked complete.
 *
 * Each layer had its own test and each one was green, which is the reason
 * this suite drives the REAL handler → service → repo chain and asserts on the
 * SQL that reaches the driver. A filter dropped at ANY hop is caught here.
 *
 * The same file pins the create-path holes found beside it: a plain
 * `POST /tasks` carrying `parent_task_id` skipped every rule the `/children`
 * route enforces.
 */

const controller = require("../../src/modules/dashboard/workspace/tasks.controller");
const service = require("../../src/modules/dashboard/workspace/tasks.service");

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const FILE = "33333333-3333-3333-3333-333333333333";
const STAGE = "44444444-4444-4444-4444-444444444444";
const ENTITY = "55555555-5555-5555-5555-555555555555";

/** Records every statement and returns no rows (or what `answer` says). */
function recordingClient(answer = () => []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      const rows = answer(sql, params) || [];
      return { rows, rowCount: rows.length };
    },
  };
}

/** A request as the router hands it over: validated query, a user, a tenant connection. */
function reqWith(query, client) {
  return {
    query,
    user: { user_id: ME },
    permission_scope: "all",
    scope_ids: null,
    tenantDb: (fn) => fn(client),
  };
}

function resRecorder() {
  const res = { headers: {}, body: undefined, statusCode: 200 };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

/** Run a handler to completion, surfacing an error passed to `next`. */
async function run(handler, req) {
  const res = resRecorder();
  let failure = null;
  await handler(req, res, (err) => { failure = err; });
  if (failure) throw failure;
  return res;
}

/** The list statement — the one carrying the pre-LIMIT total. */
const listCall = (client) => client.calls.find((c) => /COUNT\(\*\) OVER\(\) AS _total/.test(c.sql));

/** The value bound to the placeholder a fragment of the WHERE uses. */
function boundTo(call, fragment) {
  const m = call.sql.match(new RegExp(`${fragment} = \\$(\\d+)`));
  return m ? call.params[Number(m[1]) - 1] : undefined;
}

describe("GET /workspace/tasks — every filter reaches the SQL", () => {
  it("dossier_id narrows the list to that file (the Tasks-tab regression)", async () => {
    const client = recordingClient();
    await run(controller.listTasks, reqWith({ audience: "all", dossier_id: FILE, limit: 50, offset: 0 }, client));
    const call = listCall(client);
    expect(call).toBeTruthy();
    expect(boundTo(call, "t\\.dossier_id")).toBe(FILE);
  });

  it("milestone_instance_id narrows to one stage, against the stage SET", async () => {
    const client = recordingClient();
    await run(
      controller.listTasks,
      reqWith({ audience: "all", dossier_id: FILE, milestone_instance_id: STAGE, limit: 50, offset: 0 }, client),
    );
    const call = listCall(client);
    expect(call.sql).toMatch(/tm\.milestone_instance_id = \$\d+/);
    expect(boundTo(call, "tm\\.milestone_instance_id")).toBe(STAGE);
  });

  it("entity_type + entity_id narrow to the record a task hangs off", async () => {
    const client = recordingClient();
    await run(
      controller.listTasks,
      reqWith({ audience: "mine", entity_type: "costing", entity_id: ENTITY, limit: 50, offset: 0 }, client),
    );
    const call = listCall(client);
    expect(boundTo(call, "t\\.entity_type")).toBe("costing");
    expect(boundTo(call, "t\\.entity_id")).toBe(ENTITY);
  });

  it("no file asked for means no file predicate — the Workspace list is unchanged", async () => {
    const client = recordingClient();
    await run(controller.listTasks, reqWith({ audience: "mine", limit: 50, offset: 0 }, client));
    expect(listCall(client).sql).not.toMatch(/t\.dossier_id = \$/);
  });
});

describe("tasks.service.listTasks — the AI read path, which has no validator", () => {
  const aiCtx = { user: { user_id: ME }, permission_scope: null, scope_ids: null, audience: "mine" };

  it("honours the flat entity_type + entity_id pair the manifest advertises", async () => {
    const client = recordingClient();
    await service.listTasks(client, aiCtx, { entity_type: "costing", entity_id: ENTITY });
    const call = listCall(client);
    expect(boundTo(call, "t\\.entity_type")).toBe("costing");
    expect(boundTo(call, "t\\.entity_id")).toBe(ENTITY);
  });

  it("half an entity pair is no filter, not a filter on NULL", async () => {
    const client = recordingClient();
    await service.listTasks(client, aiCtx, { entity_type: "costing" });
    expect(listCall(client).sql).not.toMatch(/t\.entity_type = \$/);
  });

  it("bounds LIMIT and OFFSET — a chat message is not a tenant-wide read", async () => {
    const client = recordingClient();
    await service.listTasks(client, aiCtx, { limit: 1e9, offset: -5 });
    const call = listCall(client);
    expect(call.params[0]).toBe(200);
    expect(call.params[1]).toBe(0);

    const junk = recordingClient();
    await service.listTasks(junk, aiCtx, { limit: "lots", offset: "later" });
    expect(listCall(junk).params.slice(0, 2)).toEqual([50, 0]);
  });

  it("the dossier filter is applied ON TOP of 'mine', never instead of it", async () => {
    const client = recordingClient();
    await service.listTasks(client, aiCtx, { dossier_id: FILE, audience: "all" });
    const call = listCall(client);
    expect(boundTo(call, "t\\.dossier_id")).toBe(FILE);
    // No reach on the AI path: "all" is narrowed to the caller's own work.
    expect(call.sql).toMatch(/t\.assigned_to = \$\d+ OR t\.created_by = \$\d+/);
  });
});

describe("POST /workspace/tasks with parent_task_id — the child rules apply", () => {
  const ctx = { user: { user_id: ME }, permission_scope: "all", scope_ids: null, audience: "mine" };

  /** A tenant whose only tasks are the ones given, served to `findTask`. */
  function tenantWith(tasks) {
    return recordingClient((sql, params) => {
      if (/WHERE t\.task_id = \$1 AND t\.is_deleted = false/.test(sql)) {
        const t = tasks[params[0]];
        return t ? [t] : [];
      }
      return [];
    });
  }
  const inserted = (client) => client.calls.some((c) => /INSERT INTO task\b/.test(c.sql));

  it("refuses a parent the caller cannot see, with the same 404 as a missing one", async () => {
    const client = tenantWith({
      p1: { task_id: "p1", created_by: OTHER, assigned_to: OTHER, is_personal: false, parent_task_id: null },
    });
    await expect(
      service.createTask(client, ctx, { title: "Hang this off someone else's task", parent_task_id: "p1" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(inserted(client)).toBe(false);
  });

  it("refuses a third level — a child task cannot itself have children", async () => {
    const client = tenantWith({
      c1: { task_id: "c1", created_by: ME, assigned_to: ME, is_personal: false, parent_task_id: "p0", status: "TO_DO" },
      p0: { task_id: "p0", created_by: ME, assigned_to: ME, is_personal: false, parent_task_id: null, status: "TO_DO" },
    });
    await expect(
      service.createTask(client, ctx, { title: "Grandchild", parent_task_id: "c1" }),
    ).rejects.toMatchObject({ status: 422 });
    expect(inserted(client)).toBe(false);
  });

  it("refuses a parent that does not exist", async () => {
    const client = tenantWith({});
    await expect(
      service.createTask(client, ctx, { title: "Orphan", parent_task_id: "nope" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(inserted(client)).toBe(false);
  });
});
