/**
 * VISIBILITY IS APPLIED, not merely defined.
 *
 * `tests/security/mail-visibility.test.js` asserts that the predicate in
 * `triage/visibility.js` decides correctly. It passed for the whole of the
 * PR-2→PR-5 merge while `visibility.clause` was imported by nothing and every
 * thread read returned rows regardless of `visibility` — a Private thread was
 * visible to any colleague holding MOD-72 view, and no test noticed, because
 * every test called the predicate itself.
 *
 * That is the general shape of the defect this file exists to stop: a predicate
 * that is dropped from a query returns MORE rows, never an error, so nothing
 * fails. The only reliable gate is one that looks at the CALL SITE.
 *
 * These tests therefore run the repo's real query builders against a recording
 * fake client and assert on the SQL that reaches the driver. They deliberately
 * do not mock the repo — mocking the thing under test is how the original gap
 * survived four review passes.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const repo = require("../../src/modules/mail/mail/thread.repo");
const visibility = require("../../src/modules/mail/triage/visibility");

const SRC = path.resolve(__dirname, "../../src");

/** Records every statement instead of running it. */
function recorder(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows };
    },
    sql: () => calls.map((c) => c.text).join("\n---\n"),
  };
}

/**
 * The three things that make a query visibility-aware, checked together so a
 * half-applied clause (predicate present, `c` never joined) cannot pass.
 */
function expectVisibilityApplied(sql) {
  expect(sql).toMatch(/t\.visibility = 'COMPANY'/);
  expect(sql).toMatch(/email_thread_share/);
  expect(sql).toMatch(/c\.owner_user_id/);
  expect(sql).toMatch(/JOIN email_connection c/);
}

describe("every thread read path carries the visibility predicate", () => {
  test("listThreads — the inbox list", async () => {
    const c = recorder();
    await repo.listThreads(c, "user-1", {});
    expectVisibilityApplied(c.sql());
  });

  test("listThreads — full-text search goes through the same builder", async () => {
    const c = recorder();
    await repo.listThreads(c, "user-1", { tsquery: "demurrage" });
    const sql = c.sql();
    expect(sql).toMatch(/search_tsv @@ to_tsquery/);
    expectVisibilityApplied(sql);
  });

  test("listThreads — every filter combination keeps it", async () => {
    const c = recorder();
    await repo.listThreads(c, "user-1", {
      connectionId: "conn-1", stream: "HUMAN", vip: true, entityRef: "client:1",
      folder: "INBOX", hasAttachment: true, label: "urgent", unread: true, starred: true,
      from: ["a@b.cm"], to: ["c@d.cm"], subject: ["BL"],
    });
    expectVisibilityApplied(c.sql());
  });

  test("getThread — opening one conversation", async () => {
    const c = recorder([{ email_thread_id: "t1", participants: [] }]);
    await repo.getThread(c, "user-1", "t1");
    expectVisibilityApplied(c.calls[0].text);
  });

  test("streamUnread — the folder rail counts", async () => {
    const c = recorder();
    await repo.streamUnread(c, "user-1", null);
    expectVisibilityApplied(c.sql());
  });

  test("applyLabel — labelling is a write gated by a read", async () => {
    const c = recorder();
    await repo.applyLabel(c, "user-1", "t1", "l1", true);
    expectVisibilityApplied(c.sql());
  });

  test("timelineByEntity — the CRM timeline, outside the mailbox", async () => {
    const c = recorder();
    await repo.timelineByEntity(c, "client:1", { userId: "user-1" });
    expectVisibilityApplied(c.sql());
  });

  test("timelineByEntity fails CLOSED when no caller is supplied", async () => {
    const c = recorder([{ email_message_id: "m1" }]);
    const rows = await repo.timelineByEntity(c, "client:1", {});
    // No user id must mean no rows, not every row. An anonymous caller here is
    // a bug in the caller, and the safe answer to a bug is nothing.
    expect(rows).toEqual([]);
    expect(c.calls).toHaveLength(0);
  });
});

describe("the caller reaches the read paths that need one", () => {
  test("the AI read adapter passes the actor as a third argument", () => {
    // §9.5: "the AI grounding layer and the search index respect the same
    // predicate". They cannot if the adapter never tells the service who asked.
    const src = fs.readFileSync(path.join(SRC, "services/ai/action-registrar.js"), "utf8");
    expect(src).toMatch(/service\(client,\s*arg,\s*\{\s*user_id/);
  });

  test("mail.service reads take the actor and hand it to the repo", () => {
    const src = fs.readFileSync(path.join(SRC, "modules/mail/mail/mail.service.js"), "utf8");
    expect(src).toMatch(/const listThread = \(client, q = \{\}, actor = null\)/);
    expect(src).toMatch(/const clientTimeline = \(client, \{[^}]*user_id[^}]*\} = \{\}, actor = null\)/);
  });

  test("the HTTP controller passes the authenticated user to both", () => {
    const src = fs.readFileSync(path.join(SRC, "modules/mail/mail/mail.controller.js"), "utf8");
    const thread = src.match(/thread: asyncHandler.*/)[0];
    const timeline = src.match(/clientTimeline: asyncHandler.*/)[0];
    expect(thread).toMatch(/req\.user/);
    expect(timeline).toMatch(/req\.user/);
  });
});

describe("exactly one read bypasses the predicate, and it is ledgered", () => {
  test("getThreadUnrestricted is called only by the break-glass route", () => {
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js") && fs.readFileSync(p, "utf8").includes("getThreadUnrestricted")) hits.push(p);
      }
    };
    walk(SRC);
    const callers = hits.filter((p) => !p.endsWith("thread.repo.js"));
    expect(callers.map((p) => path.basename(p))).toEqual(["triage.routes.js"]);
  });

  test("break-glass is CEO-gated and writes the ledger row before it reads", () => {
    const src = fs.readFileSync(path.join(SRC, "modules/mail/triage/triage.routes.js"), "utf8");
    const route = src.slice(src.indexOf('router.post("/threads/:id/breakglass"'));
    const block = route.slice(0, route.indexOf("\nrouter."));
    expect(block).toMatch(/requireCeo\(\)/);
    // The audit call must precede the read, so an interrupted request cannot
    // produce a read that was never attributed.
    expect(block.indexOf("audit(c,")).toBeGreaterThan(-1);
    expect(block.indexOf("audit(c,")).toBeLessThan(block.indexOf("getThreadUnrestricted"));
    expect(block).toMatch(/action: "mail\.breakglass\.read"/);
    expect(block).toMatch(/isSensitive: true/);
  });
});

describe("the predicate itself is still defined once", () => {
  test("no second copy of the visibility SQL exists in src", () => {
    const copies = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js")) {
          const s = fs.readFileSync(p, "utf8");
          // The literal shape of the rule, not the reference to it.
          if (/visibility = 'TEAM'[\s\S]{0,200}email_connection_member/.test(s)) copies.push(p);
        }
      }
    };
    walk(SRC);
    expect(copies.map((p) => path.basename(p))).toEqual(["visibility.js"]);
  });

  test("clause() interpolates the parameter it is given, everywhere", () => {
    expect(visibility.clause("$7")).toContain("$7");
    expect(visibility.clause("$7")).not.toContain("$USER");
  });
});
