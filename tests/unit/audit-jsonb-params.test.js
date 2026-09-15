"use strict";

/**
 * `before_json` / `after_json` / `payload` are jsonb — and a LIST is a value
 * they must accept.
 *
 * ── THE DEFECT (2026-09-11) ────────────────────────────────────────────────
 *
 * Settings › Website › Social refused every save with "One of the values is in
 * the wrong format", naming no field. Nothing was wrong with any URL: the
 * banner is `error-handler.js`'s mapping for SQLSTATE 22P02, and the statement
 * that raised it was the AUDIT write, not the upsert.
 *
 * node-postgres serialises a JS object bound for a parameter with
 * `JSON.stringify`, but a JS ARRAY as a POSTGRES ARRAY LITERAL:
 *
 *   [{ platform: "x" }]  →  {"{\"platform\":\"x\"}"}
 *
 * which is not JSON, so a jsonb column refuses it — `invalid input syntax for
 * type json`, 22P02. `saveSocial` audits `listSocial()` before and after, and
 * `listSocial()` is `.rows`. So the ledger write 400'd, `atomically` rolled the
 * transaction back, and the links were never stored. The same shape reaches
 * `audit()` from the corporate-entity letterhead editor.
 *
 * An EMPTY list is why this survived review: `[]` serialises to `{}`, which IS
 * valid JSON, so a first save on a blank screen passed and only a save with
 * data failed.
 *
 * ── WHAT THESE ASSERT ──────────────────────────────────────────────────────
 *
 * The parameter, not the round trip. There is no Postgres here (these are the
 * no-infrastructure unit gates), so the test reads the bound value and requires
 * it to be text that `JSON.parse` returns the original structure from — which
 * is exactly the property the column needs and exactly the one an array literal
 * does not have.
 */

jest.mock("../../src/shared/notifications/notify-events", () => ({
  onEvent: jest.fn(async () => {}),
  NOTIFIABLE: {},
}));

const { audit, emitEvent, clearEventTypeCache } = require("../../src/shared/events/emit");

/** Records every statement and its bound parameters. Returns no rows, so
 *  `lookupEventType` resolves to "unknown key" — not critical, not approvable —
 *  and `emitEvent` takes its ordinary path. */
function recordingClient() {
  const calls = [];
  return {
    calls,
    async query(text, params = []) {
      calls.push({ text, params });
      return { rows: [] };
    },
    /** The parameters of the first statement writing to `table`. */
    paramsFor(table) {
      const hit = calls.find((c) => new RegExp(`INSERT INTO ${table}`).test(c.text));
      return hit ? hit.params : null;
    },
  };
}

/** The exact `before`/`after` shape `site_settings.saveSocial` hands over. */
const SOCIAL_ROWS = [
  { platform: "linkedin", url: "https://www.linkedin.com/company/smartls-ltd/" },
  { platform: "whatsapp", url: "https://wa.me/237696291800" },
];

const LEDGER_BEFORE = 7; // $8  before_json
const LEDGER_AFTER = 8; // $9  after_json
const LEDGER_METADATA = 12; // $13 metadata
const EVENT_PAYLOAD = 5; // $6  payload

beforeEach(() => clearEventTypeCache());

describe("audit() binds jsonb parameters as JSON", () => {
  test("a LIST of rows survives as JSON, not as a Postgres array literal", async () => {
    const client = recordingClient();
    await audit(client, {
      action: "site.social_updated",
      moduleKey: "MOD-29",
      entityRef: "site_social_link:all",
      before: [],
      after: SOCIAL_ROWS,
    });

    const params = client.paramsFor("immutable_ledger");
    expect(typeof params[LEDGER_AFTER]).toBe("string");
    // The regression in one line: the old binding produced `{"{\"platform\"…}"}`,
    // which throws here exactly as Postgres threw 22P02.
    expect(JSON.parse(params[LEDGER_AFTER])).toEqual(SOCIAL_ROWS);
    expect(JSON.parse(params[LEDGER_BEFORE])).toEqual([]);
  });

  test("a single row still binds as a JSON object", async () => {
    const client = recordingClient();
    const row = { entity_id: "e1", legal_name: "Smart Logistics" };
    await audit(client, { action: "entity.updated", before: null, after: row });

    const params = client.paramsFor("immutable_ledger");
    expect(JSON.parse(params[LEDGER_AFTER])).toEqual(row);
  });

  test("an absent before/after stays NULL rather than becoming the string 'null'", async () => {
    // `before_json` is nullable and a create genuinely has no before. Binding
    // the text "null" would store a jsonb null — a value — where the column
    // means "there was nothing here".
    const client = recordingClient();
    await audit(client, { action: "entity.created", after: { a: 1 } });

    const params = client.paramsFor("immutable_ledger");
    expect(params[LEDGER_BEFORE]).toBeNull();
    expect(params[LEDGER_METADATA]).toBeNull();
  });

  test("metadata binds as JSON when present", async () => {
    const client = recordingClient();
    await audit(client, { action: "comms.message_posted", metadata: { channel_name: "ops" } });

    const params = client.paramsFor("immutable_ledger");
    expect(JSON.parse(params[LEDGER_METADATA])).toEqual({ channel_name: "ops" });
  });
});

describe("emitEvent() binds its payload as JSON", () => {
  test("a list payload survives as JSON", async () => {
    const client = recordingClient();
    await emitEvent(client, {
      eventTypeKey: "site.social_updated",
      moduleKey: "MOD-29",
      payload: SOCIAL_ROWS,
    });

    const params = client.paramsFor("event_log");
    expect(JSON.parse(params[EVENT_PAYLOAD])).toEqual(SOCIAL_ROWS);
  });

  test("an omitted payload is the empty object the column defaults to", async () => {
    const client = recordingClient();
    await emitEvent(client, { eventTypeKey: "site.theme_updated" });

    const params = client.paramsFor("event_log");
    expect(JSON.parse(params[EVENT_PAYLOAD])).toEqual({});
  });
});

/**
 * ── AN EVENT WITHOUT A NAME IS A CALLER BUG, NOT A USER'S (2026-09-11) ─────
 *
 * `event_log.event_type_key` is `citext NOT NULL` (migration 0120). A caller
 * that spells the key wrong therefore does not emit a nameless event — it
 * raises SQLSTATE 23502, which `error-handler.js` maps to a 400 `MISSING_VALUE`
 * carrying "A required value was missing".
 *
 * That message is about the REQUEST BODY, and it is handed to a user who filled
 * the body in correctly. `insight.setCover` passed `event:` instead of
 * `eventTypeKey:` and the article cover upload failed with exactly that, under
 * a file-drop holding the file — while the gallery upload beside it, the same
 * call without an `emitEvent`, worked. Nothing in the message pointed at the
 * event write, so the screen blamed its own field.
 *
 * The guard converts that into a named failure at the call site. It cannot
 * break a working caller: a key-less call could only ever have hit the
 * constraint.
 */
describe("emitEvent refuses a call with no event type key", () => {
  beforeEach(() => clearEventTypeCache());

  it("throws rather than letting the NOT NULL column raise a 400", async () => {
    const c = recordingClient();
    await expect(emitEvent(c, { moduleKey: "MOD-29", entityRef: "insight_article:a1" }))
      .rejects.toThrow(/eventTypeKey is required/);
  });

  it("names the module and the entity, so the caller is findable", async () => {
    // The whole point: a 23502 says which COLUMN was null and nothing about
    // which of ~600 write paths wrote it.
    const c = recordingClient();
    await expect(emitEvent(c, { moduleKey: "MOD-29", entityRef: "insight_article:a1" }))
      .rejects.toThrow(/MOD-29.*insight_article:a1/);
  });

  it("writes nothing at all when the key is missing", async () => {
    // It must fail BEFORE the INSERT: inside `atomically`, a throw rolls the
    // caller's transaction back, and a half-written event_log row would be the
    // one artefact of a request that otherwise left no trace.
    const c = recordingClient();
    await expect(emitEvent(c, { moduleKey: "MOD-29" })).rejects.toThrow();
    expect(c.calls).toHaveLength(0);
  });

  it("still emits normally when the key is present", async () => {
    // The guard is a guard, not a new precondition on ordinary calls.
    const c = recordingClient();
    await emitEvent(c, { eventTypeKey: "insight.updated", moduleKey: "MOD-29" });
    expect(c.paramsFor("event_log")).not.toBeNull();
    expect(c.paramsFor("event_log")[0]).toBe("insight.updated");
  });
});
