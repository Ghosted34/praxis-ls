"use strict";
/**
 * The platform's choice of primary chat vendor — the store side
 * (`ai-vendor.service.setChatPrimary` / `getChatPrimary`).
 *
 * What these pin:
 *   · only a vendor that answers /chat/completions can be made primary — Groq
 *     (voice) and "embeddings" are refused BEFORE any write, with the allowed
 *     list in the message;
 *   · the switch is one transaction: clear the old flag, set the new one, audit
 *     it, COMMIT — and a vendor with no row rolls back and 404s rather than
 *     leaving the deployment with NO primary flagged;
 *   · a failure mid-transaction rolls back and releases the client;
 *   · `getChatPrimary` ignores an INACTIVE flagged row (a vendor switched off is
 *     not one to try first) and returns null when nothing is flagged;
 *   · every read shape carries `chat_capable`, computed from the runtime's list.
 *
 * The pool is mocked at `platformDb.getPool().connect()` so the statements can
 * be asserted in order — the ORDER is the correctness property (see the
 * partial-unique-index note on `setChatPrimary`).
 */
jest.mock("../../src/services/platform/db", () => {
  const client = { query: jest.fn(), release: jest.fn() };
  return {
    query: jest.fn(),
    opsQuery: jest.fn(),
    getPool: jest.fn(() => ({ connect: jest.fn(async () => client) })),
    __client: client,
  };
});
jest.mock("../../src/services/encryption.service", () => ({ encrypt: (s) => "enc:" + s, decrypt: (s) => String(s).replace(/^enc:/, "") }));

const db = require("../../src/services/platform/db");
const svc = require("../../src/services/platform/ai-vendor.service");

const client = db.__client;
const ROW = { vendor: "gemini", display_name: "Google Gemini", endpoint_url: "https://generativelanguage.googleapis.com/v1beta/openai", default_model: "gemini-2.5-flash", current_model: "gemini-2.5-flash", is_active: true, has_key: true, last_rotated_at: null, is_chat_primary: true };

/** The SQL of every statement the transaction client ran, in order, whitespace-collapsed. */
const ran = () => client.query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " ").trim());

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue({ rows: [] });
  client.query.mockResolvedValue({ rows: [] });
});

describe("setChatPrimary", () => {
  test("refuses a vendor that does not answer chat calls, before touching the database", async () => {
    await expect(svc.setChatPrimary({ vendor: "groq" })).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    await expect(svc.setChatPrimary({ vendor: "embeddings" })).rejects.toMatchObject({ status: 422 });
    await expect(svc.setChatPrimary({ vendor: "groq" })).rejects.toThrow(/deepseek, gemini, openai/);
    expect(db.getPool).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });

  test("clears the old primary, sets the new one and audits it — in ONE transaction, in THAT order", async () => {
    client.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (/FOR UPDATE/.test(s)) return { rows: [{ vendor: "deepseek" }] };
      if (/is_chat_primary = true/.test(s)) return { rows: [ROW] };
      return { rows: [] };
    });

    const out = await svc.setChatPrimary({ vendor: "gemini", actorId: "user-1" });

    const sql = ran();
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toMatch(/SELECT vendor FROM ai_vendor_credential WHERE is_chat_primary FOR UPDATE/);
    // Clear FIRST, then set — a single UPDATE could trip the partial unique
    // index on the transient duplicate depending on row visit order.
    expect(sql[2]).toMatch(/SET is_chat_primary = false/);
    expect(sql[3]).toMatch(/SET is_chat_primary = true/);
    expect(client.query.mock.calls[3][1]).toEqual(["gemini"]);
    expect(sql[4]).toMatch(/INSERT INTO platform\.platform_audit/);
    expect(client.query.mock.calls[4][1]).toEqual(["user-1", "ai_vendor.chat_primary_set", "ai_vendor:gemini", { vendor: "gemini", previous: "deepseek" }]);
    expect(sql[5]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);

    // The safe row shape, decorated — never the key.
    expect(out).toEqual({ ...ROW, chat_capable: true });
    expect(out).not.toHaveProperty("api_key_enc");
  });

  test("the audit names the CODE default as 'previous' when nothing was flagged before (a first-ever choice)", async () => {
    client.query.mockImplementation(async (sql) => (/is_chat_primary = true/.test(String(sql)) ? { rows: [ROW] } : { rows: [] }));
    await svc.setChatPrimary({ vendor: "gemini" });
    const audit = client.query.mock.calls.find((c) => /platform_audit/.test(String(c[0])));
    expect(audit[1][3]).toEqual({ vendor: "gemini", previous: "deepseek" });
  });

  test("a vendor with no row rolls back and 404s — the deployment is never left with no primary", async () => {
    client.query.mockImplementation(async (sql) => {
      if (/FOR UPDATE/.test(String(sql))) return { rows: [{ vendor: "deepseek" }] };
      return { rows: [] }; // the SET matches nothing: no such row
    });
    await expect(svc.setChatPrimary({ vendor: "openai" })).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    const sql = ran();
    expect(sql).toContain("ROLLBACK");
    expect(sql).not.toContain("COMMIT");
    expect(sql.some((s) => /platform_audit/.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test("a failure mid-transaction rolls back, releases the client and surfaces the error", async () => {
    client.query.mockImplementation(async (sql) => {
      if (/is_chat_primary = false/.test(String(sql))) throw new Error("deadlock detected");
      return { rows: [] };
    });
    await expect(svc.setChatPrimary({ vendor: "gemini" })).rejects.toThrow("deadlock detected");
    expect(ran()).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe("getChatPrimary", () => {
  test("returns the flagged, ACTIVE vendor", async () => {
    db.query.mockResolvedValue({ rows: [{ vendor: "gemini" }] });
    expect(await svc.getChatPrimary()).toBe("gemini");
    expect(db.query.mock.calls[0][0]).toMatch(/WHERE is_chat_primary AND is_active/);
  });

  test("returns null when nothing is flagged (the runtime then uses its default)", async () => {
    db.query.mockResolvedValue({ rows: [] });
    expect(await svc.getChatPrimary()).toBeNull();
  });
});

describe("read shapes carry chat_capable", () => {
  test("list() marks the chat vendors and nothing else", async () => {
    db.query.mockResolvedValue({ rows: [
      { vendor: "deepseek", is_chat_primary: true },
      { vendor: "embeddings", is_chat_primary: false },
      { vendor: "gemini", is_chat_primary: false },
      { vendor: "groq", is_chat_primary: false },
    ] });
    const rows = await svc.list();
    expect(rows.map((r) => [r.vendor, r.chat_capable])).toEqual([
      ["deepseek", true], ["embeddings", false], ["gemini", true], ["groq", false],
    ]);
    // The list read includes the flag, so the console needs no second call.
    expect(db.query.mock.calls[0][0]).toMatch(/is_chat_primary/);
  });

  test("set() returns the decorated row too", async () => {
    db.query.mockResolvedValue({ rows: [{ ...ROW, vendor: "groq", is_chat_primary: false }] });
    const row = await svc.set({ vendor: "groq", patch: { is_active: true } });
    expect(row.chat_capable).toBe(false);
  });
});
