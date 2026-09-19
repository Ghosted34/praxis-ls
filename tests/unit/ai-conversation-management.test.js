/**
 * Conversation management — pin, rename, archive, delete (13920, audit J1–J3).
 *
 * The audit's J1 is the one that matters: a thread could not be removed, so
 * sensitive research typed into the copilot stayed there. `clearHistory` looked
 * like a delete and was not — it started a NEW thread and retained the old one,
 * because `ai_action_run.conversation_id` has no `ON DELETE` clause.
 *
 * These pin the properties that are easy to get subtly wrong and impossible to
 * notice from the screen:
 *
 *   - every mutation is scoped to the caller IN THE SQL, so a borrowed id
 *     cannot reach another user's thread;
 *   - a deleted thread stops being loadable by id, not just listable — a stale
 *     `?c=` must not put a removed transcript back on screen;
 *   - the purge DETACHES executed action runs and DELETES the rest, because an
 *     executed run is the only record of a real ERP change and a proposed one
 *     is verbatim thread content;
 *   - the dynamic SET names only columns written out in the repo.
 */
"use strict";

const repo = require("../../src/modules/ai/assistant/assistant.repo");

const CONV = "9c1f0a10-0000-4000-8000-0000000000aa";
const USER = "9c1f0a10-0000-4000-8000-0000000000cc";
const OTHER = "9c1f0a10-0000-4000-8000-0000000000dd";

/**
 * `rowsFor` maps a matched SQL fragment to the rows that statement returns.
 *
 * The SAVEPOINT probe THROWS, which is what a real connection outside a
 * transaction does (25P01) — `shared/db/tx.atomically` uses it to tell "already
 * in someone else's transaction" from "open my own". A fake that answers the
 * probe happily would make every purge test silently skip BEGIN/COMMIT.
 */
function fakeClient(rowsFor = {}) {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql, params) => {
      if (sql.includes("SAVEPOINT")) throw new Error("25P01 not in a transaction block");
      queries.push({ sql, params });
      const key = Object.keys(rowsFor).find((k) => sql.includes(k));
      const rows = key ? rowsFor[key] : [];
      return { rows, rowCount: rows.length };
    }),
  };
}

const sqlOf = (c, i = 0) => c.queries[i].sql.replace(/\s+/g, " ");

describe("updateConversation — one PATCH, three properties", () => {
  it("sets only what was asked for", async () => {
    const c = fakeClient({ UPDATE: [{}] });
    await repo.updateConversation(c, CONV, USER, { pinned: true });
    expect(sqlOf(c)).toContain("SET pinned_at = now()");
    expect(sqlOf(c)).not.toContain("archived_at");
    expect(sqlOf(c)).not.toContain("title =");
  });

  it("clears a flag with NULL rather than a falsy timestamp", async () => {
    const c = fakeClient({ UPDATE: [{}] });
    await repo.updateConversation(c, CONV, USER, { pinned: false, archived: false });
    expect(sqlOf(c)).toContain("pinned_at = NULL");
    expect(sqlOf(c)).toContain("archived_at = NULL");
  });

  it("combines a rename with a flag in ONE statement", async () => {
    const c = fakeClient({ UPDATE: [{}] });
    await repo.updateConversation(c, CONV, USER, { title: "Douala file", archived: false });
    expect(c.queries).toHaveLength(1);
    expect(sqlOf(c)).toContain("title = $3");
    expect(sqlOf(c)).toContain("archived_at = NULL");
    expect(c.queries[0].params[2]).toBe("Douala file");
  });

  it("binds the title as a parameter — it is the only caller-supplied value", async () => {
    const c = fakeClient({ UPDATE: [{}] });
    await repo.updateConversation(c, CONV, USER, { title: "'; DROP TABLE ai_message; --" });
    expect(sqlOf(c)).not.toContain("DROP TABLE");
    expect(c.queries[0].params[2]).toBe("'; DROP TABLE ai_message; --");
  });

  it("stores an empty or whitespace title as NULL, so the derived one comes back", async () => {
    for (const title of ["", "   "]) {
      const c = fakeClient({ UPDATE: [{}] });
      await repo.updateConversation(c, CONV, USER, { title });
      expect(c.queries[0].params[2]).toBeNull();
    }
  });

  it("trims a title — three spaces would defeat the NULLIF in the list query", async () => {
    const c = fakeClient({ UPDATE: [{}] });
    await repo.updateConversation(c, CONV, USER, { title: "  Customs 2026  " });
    expect(c.queries[0].params[2]).toBe("Customs 2026");
  });

  it("issues no statement at all for an empty patch, and reports false", async () => {
    const c = fakeClient({ UPDATE: [{}] });
    expect(await repo.updateConversation(c, CONV, USER, {})).toBe(false);
    expect(c.queries).toHaveLength(0);
  });

  it("scopes to the caller and skips deleted rows", async () => {
    const c = fakeClient({ UPDATE: [{}] });
    await repo.updateConversation(c, CONV, USER, { pinned: true });
    expect(sqlOf(c)).toContain("WHERE conversation_id = $1 AND user_id = $2 AND deleted_at IS NULL");
    expect(c.queries[0].params.slice(0, 2)).toEqual([CONV, USER]);
  });

  it("reports false when nothing matched — the service's 404", async () => {
    const c = fakeClient(); // no rows
    expect(await repo.updateConversation(c, CONV, OTHER, { pinned: true })).toBe(false);
  });
});

describe("listConversations", () => {
  it("hides deleted threads and, by default, archived ones", async () => {
    const c = fakeClient();
    await repo.listConversations(c, USER, {});
    const sql = sqlOf(c);
    expect(sql).toContain("c.deleted_at IS NULL");
    expect(sql).toContain("($3 OR c.archived_at IS NULL)");
    expect(c.queries[0].params[2]).toBe(false);
  });

  it("includes archived threads only when asked", async () => {
    const c = fakeClient();
    await repo.listConversations(c, USER, { includeArchived: true });
    expect(c.queries[0].params[2]).toBe(true);
  });

  it("orders pinned above the time buckets", async () => {
    const c = fakeClient();
    await repo.listConversations(c, USER, {});
    // Pinned first, then recency — the rail groups on what arrives, so the
    // order has to be settled before the LIMIT.
    expect(sqlOf(c)).toContain("ORDER BY c.pinned_at DESC NULLS LAST, last_at DESC");
  });

  it("returns the pin and archive timestamps the rail renders from", async () => {
    const c = fakeClient();
    await repo.listConversations(c, USER, {});
    expect(sqlOf(c)).toContain("c.pinned_at");
    expect(sqlOf(c)).toContain("c.archived_at");
  });
});

describe("conversationMeta — the read-back after a mutation", () => {
  it("applies the SAME derived-title COALESCE as the list", async () => {
    const list = fakeClient();
    const meta = fakeClient();
    await repo.listConversations(list, USER, {});
    await repo.conversationMeta(meta, CONV, USER);
    // Both are built from CONVERSATION_ROW, so a cleared title reads back as
    // the first user message rather than as null.
    expect(sqlOf(meta)).toContain("COALESCE(NULLIF(c.title, ''),");
    expect(sqlOf(list)).toContain("COALESCE(NULLIF(c.title, ''),");
  });

  it("is ownership- and delete-scoped like everything else", async () => {
    const c = fakeClient();
    await repo.conversationMeta(c, CONV, USER);
    expect(sqlOf(c)).toContain("WHERE c.conversation_id = $1 AND c.user_id = $2 AND c.deleted_at IS NULL");
  });
});

describe("a removed thread stops being reachable", () => {
  it("currentConversation will not resume into a deleted or archived thread", async () => {
    const c = fakeClient({ SELECT: [{ conversation_id: CONV }] });
    await repo.currentConversation(c, USER);
    expect(sqlOf(c)).toContain("deleted_at IS NULL AND archived_at IS NULL");
  });

  it("conversationBelongsToUser rejects a soft-deleted thread", async () => {
    // The stale-`?c=` case: the transcript must not come back after delete.
    const c = fakeClient();
    expect(await repo.conversationBelongsToUser(c, CONV, USER)).toBe(false);
    expect(sqlOf(c)).toContain("deleted_at IS NULL");
  });

  it("softDelete refuses to re-stamp an already deleted thread", async () => {
    const c = fakeClient();
    expect(await repo.softDeleteConversation(c, CONV, USER)).toBe(false);
    expect(sqlOf(c)).toContain("SET deleted_at = now()");
    expect(sqlOf(c)).toContain("AND deleted_at IS NULL");
  });
});

describe("purgeConversation — the irreversible half", () => {
  /** `atomically` issues its own BEGIN/COMMIT unless already in one. */
  const purgeClient = (owned = true) =>
    fakeClient({
      "SELECT 1 FROM ai_conversation": owned ? [{ "?column?": 1 }] : [],
      "DELETE FROM ai_conversation": owned ? [{}] : [],
    });

  const statements = (c) =>
    c.queries.map((q) => q.sql.replace(/\s+/g, " ").trim()).filter((s) => !/^(BEGIN|COMMIT|ROLLBACK)/.test(s));

  it("verifies ownership before touching anything", async () => {
    const c = purgeClient(false);
    expect(await repo.purgeConversation(c, CONV, OTHER)).toBe(false);
    const s = statements(c);
    expect(s).toHaveLength(1);
    expect(s[0]).toContain("SELECT 1 FROM ai_conversation");
    expect(s.some((x) => x.includes("ai_action_run"))).toBe(false);
  });

  it("DETACHES executed runs, then deletes the rest, then the conversation", async () => {
    const c = purgeClient();
    expect(await repo.purgeConversation(c, CONV, USER)).toBe(true);
    const s = statements(c);
    // An executed run is the only record of a real ERP change, and there is no
    // second audit table behind it — deleting the chat must not erase the
    // provenance of the lead it created.
    expect(s[1]).toContain("UPDATE ai_action_run SET conversation_id = NULL");
    expect(s[1]).toContain("status = 'EXECUTED'");
    // Everything else is a proposal the user never took: nothing points at it
    // and its payload is verbatim thread content.
    expect(s[2]).toBe("DELETE FROM ai_action_run WHERE conversation_id = $1");
    expect(s[3]).toContain("DELETE FROM ai_conversation");
  });

  it("detaches BEFORE deleting, or the executed rows would go with the rest", async () => {
    const c = purgeClient();
    await repo.purgeConversation(c, CONV, USER);
    const s = statements(c);
    const detach = s.findIndex((x) => x.includes("SET conversation_id = NULL"));
    const drop = s.findIndex((x) => x.startsWith("DELETE FROM ai_action_run"));
    expect(detach).toBeGreaterThan(-1);
    expect(detach).toBeLessThan(drop);
  });

  it("runs in a transaction — a half-purge leaves orphaned runs", async () => {
    const c = purgeClient();
    await repo.purgeConversation(c, CONV, USER);
    const all = c.queries.map((q) => q.sql.trim());
    expect(all).toContain("BEGIN");
    expect(all).toContain("COMMIT");
  });

  it("scopes the final delete to the caller as well as the ownership check", async () => {
    const c = purgeClient();
    await repo.purgeConversation(c, CONV, USER);
    const del = statements(c).find((x) => x.startsWith("DELETE FROM ai_conversation"));
    expect(del).toContain("AND user_id = $2");
  });
});

describe("service layer — what the HTTP surface actually answers", () => {
  const service = require("../../src/modules/ai/assistant/assistant.service");
  const user = { user_id: USER };

  it("404s rather than 403s on a thread that is not the caller's", async () => {
    // The repo statements are user-scoped, so "not yours" and "does not exist"
    // are the same miss here — and 403 would confirm the id belongs to SOMEBODY.
    const c = fakeClient();
    await expect(
      service.updateConversation(c, { user, conversationId: CONV, patch: { pinned: true } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("answers a successful patch with the row in the rail's shape", async () => {
    const row = { conversation_id: CONV, title: "Douala file", pinned_at: "2026-09-19T00:00:00Z" };
    const c = fakeClient({ UPDATE: [{}], "SELECT c.conversation_id": [row] });
    await expect(
      service.updateConversation(c, { user, conversationId: CONV, patch: { pinned: true } }),
    ).resolves.toEqual(row);
  });

  it("takes the soft path unless purge is exactly true", async () => {
    for (const purge of [undefined, false, "true"]) {
      const c = fakeClient({ "SET deleted_at": [{}] });
      await service.removeConversation(c, { user, conversationId: CONV, purge });
      expect(sqlOf(c)).toContain("SET deleted_at = now()");
      expect(c.queries.some((q) => q.sql.includes("ai_action_run"))).toBe(false);
    }
  });

  it("purges only on an explicit true, and says so in the reply", async () => {
    const c = fakeClient({
      "SELECT 1 FROM ai_conversation": [{ "?column?": 1 }],
      "DELETE FROM ai_conversation": [{}],
    });
    await expect(
      service.removeConversation(c, { user, conversationId: CONV, purge: true }),
    ).resolves.toEqual({ conversation_id: CONV, purged: true });
    expect(c.queries.some((q) => q.sql.includes("ai_action_run"))).toBe(true);
  });

  it("caps the list at 200 however large a limit is asked for", async () => {
    const c = fakeClient();
    await service.conversations(c, { user, limit: 5000 });
    expect(c.queries[0].params[1]).toBe(200);
  });
});

describe("the ask path honours ownership and the delete (J1)", () => {
  /**
   * `conversation_id` arrives in the ask body validated only as a uuid. It used
   * to be passed straight to the history loader, so a borrowed id replayed
   * another user's transcript into the caller's prompt and appended this turn
   * to their thread — and, once a thread could be deleted, a stale `?c=` or a
   * second open tab would have gone on writing to a conversation the user had
   * removed. `history_.resolveId` is where both stop.
   */
  const orchestrator = require("../../src/services/ai/orchestrator.service");
  const user = { user_id: USER };

  /** The ownership probe answers `owned`; `currentConversation` answers FALLBACK. */
  const FALLBACK = "9c1f0a10-0000-4000-8000-0000000000ee";
  const askClient = (owned) =>
    fakeClient({
      "SELECT 1 FROM ai_conversation": owned ? [{ "?column?": 1 }] : [],
      "SELECT conversation_id FROM ai_conversation": [{ conversation_id: FALLBACK }],
    });

  it("keeps a thread the caller owns", async () => {
    const c = askClient(true);
    await expect(
      orchestrator.history_.resolveId(c, { user, conversationId: CONV }),
    ).resolves.toBe(CONV);
  });

  it("falls back to the caller's own thread for an id that is not theirs", async () => {
    const c = askClient(false);
    await expect(
      orchestrator.history_.resolveId(c, { user, conversationId: CONV }),
    ).resolves.toBe(FALLBACK);
  });

  it("checks ownership through the delete-aware gate, so a removed thread is refused", async () => {
    const c = askClient(true);
    await orchestrator.history_.resolveId(c, { user, conversationId: CONV });
    const probe = c.queries.find((q) => q.sql.includes("SELECT 1 FROM ai_conversation"));
    expect(probe.sql).toContain("deleted_at IS NULL");
    expect(probe.params).toEqual([CONV, USER]);
  });

  it("resolves the caller's current thread when no id is sent", async () => {
    const c = askClient(false);
    await expect(
      orchestrator.history_.resolveId(c, { user, conversationId: null }),
    ).resolves.toBe(FALLBACK);
    // No point probing ownership of an id that was not supplied.
    expect(c.queries.some((q) => q.sql.includes("SELECT 1 FROM ai_conversation"))).toBe(false);
  });
});
