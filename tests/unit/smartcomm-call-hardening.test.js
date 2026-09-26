"use strict";
/**
 * Calls audit PR-3: security hardening of the call state machine and the relay
 * credentials. Each block names its finding; every test here failed on the
 * code before PR-3.
 */
const crypto = require("crypto");

jest.mock("../../src/config/env", () => {
  const real = jest.requireActual("../../src/config/env");
  return { ...real, config: { ...real.config } };
});
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn(async () => ({})) }));
// No vault row: these tests are about the env fallback and the URL assembly.
// `relay()` below resolves through the REAL runtime config rather than
// rebuilding the mapping here — a reconstruction would pass while the mapping
// callers actually use was wrong.
jest.mock("../../src/services/platform/settings.service", () => ({ resolve: jest.fn(async () => null) }));
jest.mock("../../src/shared/push/push.service", () => ({
  sendToUser: jest.fn(async () => ({ sent: 1, failed: 0, total: 1 })),
}));
const mockCounters = new Map();
jest.mock("../../src/config/redis", () => ({
  getClient: () => ({
    incr: async (k) => { const n = (mockCounters.get(k) || 0) + 1; mockCounters.set(k, n); return n; },
    expire: async () => 1,
  }),
}));

const { config } = require("../../src/config/env");
const requestContext = require("../../src/config/request-context");
const realtime = require("../../src/realtime");
const turn = require("../../src/modules/smartcomm/smartcomm.turn.service");
const service = require("../../src/modules/smartcomm/smartcomm.call.service");

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const U3 = "44444444-4444-4444-4444-444444444444";
const G1 = "33333333-3333-3333-3333-333333333333";
const CALL = "55555555-5555-5555-5555-555555555555";

const TURN_KEYS = ["STUN_URLS", "TURN_HOST", "TURN_CREDENTIAL_SECRET", "TURN_PORT_UDP", "TURN_PORT_TCP", "TURN_TRANSPORTS", "TURN_TLS_PORT"];
const saved = Object.fromEntries(TURN_KEYS.map((k) => [k, config[k]]));
function withTurn(overrides) {
  Object.assign(config, {
    STUN_URLS: "", TURN_HOST: "", TURN_CREDENTIAL_SECRET: "", TURN_PORT_UDP: 3478,
    TURN_PORT_TCP: 3478, TURN_TRANSPORTS: "udp,tcp", TURN_TLS_PORT: 0,
  }, overrides);
}
const runtimeConfig = require("../../src/services/platform/runtime-config.service");
/** The resolved relay for whatever `withTurn` just set (cache dropped first). */
const relay = () => {
  runtimeConfig.invalidate();
  return runtimeConfig.turn();
};
afterEach(() => { Object.assign(config, saved); runtimeConfig.invalidate(); });

/**
 * One call row plus the few statements the paths under test issue. The
 * guarded writes behave like Postgres: they match only the status they name.
 */
function makeDb({ call = null, settings = {}, members = [], partner = { user_id: U2, status: "ACTIVE" } } = {}) {
  const state = { call: call ? { ...call } : null, audits: [], events: [], inserted: null };
  const client = {
    state,
    query: async (sql, params = []) => {
      if (/SET turn_token = COALESCE\(turn_token, \$2\)/.test(sql)) {
        const c = state.call;
        if (!c || c.call_id !== params[0] || !["RINGING", "IN_CALL"].includes(c.status)) return { rows: [] };
        c.turn_token = c.turn_token || params[1];
        return { rows: [{ turn_token: c.turn_token }] };
      }
      if (/SELECT \* FROM comms_call WHERE call_id = \$1/.test(sql)) {
        return { rows: state.call && state.call.call_id === params[0] ? [state.call] : [] };
      }
      if (/SELECT 1 AS ok FROM comms_call/.test(sql)) {
        const c = state.call;
        return { rows: c && c.call_id === params[0] && (c.caller_id === params[1] || c.callee_id === params[1]) ? [{ ok: 1 }] : [] };
      }
      if (/FROM setting WHERE section = 'comms'/.test(sql)) {
        return { rows: Object.entries(settings).map(([key, value]) => ({ key, value })) };
      }
      if (/FROM feature_state/.test(sql)) return { rows: [{ state: "on" }] };
      if (/FROM comms_member WHERE group_id/.test(sql)) {
        const m = members.find((x) => x.group_id === params[0] && x.user_id === params[1]);
        return { rows: m ? [m] : [] };
      }
      if (/FROM comms_group g\s+JOIN comms_member m/.test(sql)) {
        return { rows: partner ? [partner] : [] };
      }
      if (/WHERE \(caller_id = \$1 OR callee_id = \$1\) AND status IN/.test(sql)) return { rows: [] };
      if (/INSERT INTO comms_call/.test(sql)) {
        state.call = {
          call_id: CALL, group_id: params[0], caller_id: params[1], callee_id: params[2],
          status: "RINGING", started_at: new Date().toISOString(), connected_at: null, turn_token: params[3] || null,
        };
        const inserted = { ...state.call };
        if (state.afterInsert) state.afterInsert(state.call);
        return { rows: [inserted] };
      }
      if (/UPDATE comms_call SET status = \$3/.test(sql)) {
        const c = state.call;
        if (!c || c.call_id !== params[0] || c.status !== params[1]) return { rows: [] };
        const setClause = sql.split("SET ")[1].split(" WHERE")[0];
        c.status = params[2];
        for (const part of setClause.split(",").map((x) => x.trim())) {
          const m = part.match(/^(\w+) = \$(\d+)$/);
          if (m && m[1] !== "status") c[m[1]] = params[Number(m[2]) - 1];
        }
        const moved = { ...c };
        if (state.afterTransition) state.afterTransition(c);
        return { rows: [moved] };
      }
      if (/INSERT INTO immutable_ledger/.test(sql)) { state.audits.push(params); return { rows: [] }; }
      if (/INSERT INTO event_log/.test(sql)) { state.events.push(params); return { rows: [] }; }
      if (/FROM app_user/.test(sql)) return { rows: [{ user_id: params[0], full_name: "Ada", status: "ACTIVE" }] };
      return { rows: [] };
    },
  };
  return client;
}

const inTenant = (fn, env = "live") => requestContext.run({ tenant: "acme", userId: U1, env }, fn);
let publishSpy;
beforeEach(() => {
  mockCounters.clear();
  publishSpy = jest.spyOn(realtime, "publishToUser").mockImplementation(() => {});
});
afterEach(() => publishSpy.mockRestore());

const ringing = (extra = {}) => ({
  call_id: CALL, group_id: G1, caller_id: U1, callee_id: U2, status: "RINGING",
  started_at: new Date().toISOString(), connected_at: null, turn_token: null, ...extra,
});
const inCall = (connectedSecondsAgo, extra = {}) => ringing({
  status: "IN_CALL",
  connected_at: new Date(Date.now() - connectedSecondsAgo * 1000).toISOString(),
  ...extra,
});
const turnServers = (ice) => ice.iceServers.filter((s) => s.username);

/* ── C2 · relay credentials are tied to one live call ─────────────────────── */

describe("C2: TURN credentials are minted only for a live call, and name it", () => {
  beforeEach(() => withTurn({ TURN_HOST: "turn.example.com", TURN_CREDENTIAL_SECRET: "k" }));

  test.each(["ENDED", "FAILED", "NO_ANSWER", "DECLINED", "CANCELLED"])(
    "a credential request for a %s call is 404",
    async (status) => {
      const db = makeDb({ call: ringing({ status }) });
      await expect(service.turnFor(db, { id: CALL, actor: { user_id: U1 } }))
        .rejects.toMatchObject({ status: 404 });
    },
  );

  test("a stranger gets the same 404 as a missing call", async () => {
    const db = makeDb({ call: inCall(10) });
    await expect(service.turnFor(db, { id: CALL, actor: { user_id: U3 } }))
      .rejects.toMatchObject({ status: 404 });
  });

  test("the username is <expiry>:<the call's own random token>, and holds no user id", async () => {
    const db = makeDb({ call: inCall(10) });
    const ice = await service.turnFor(db, { id: CALL, actor: { user_id: U1 } });
    const token = db.state.call.turn_token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    for (const s of turnServers(ice)) {
      expect(s.username).toMatch(new RegExp(`^\\d+:${token}$`));
      expect(s.username).not.toContain(U1);
      // coturn's REST scheme: HMAC-SHA1 over the WHOLE username, rebuilt here
      // from the expiry and the token rather than read back from it.
      const label = `${Date.parse(ice.expiresAt) / 1000}:${token}`;
      expect(s.username).toBe(label);
      expect(s.credential).toBe(crypto.createHmac("sha1", "k").update(label).digest("base64"));
    }
  });

  test("both participants get the call's one token; another call gets another", async () => {
    const db = makeDb({ call: inCall(10) });
    const a = await service.turnFor(db, { id: CALL, actor: { user_id: U1 } });
    const b = await service.turnFor(db, { id: CALL, actor: { user_id: U2 } });
    const tokenOf = (ice) => turnServers(ice)[0].username.split(":")[1];
    expect(tokenOf(a)).toBe(tokenOf(b));
    const other = makeDb({ call: inCall(10) });
    expect(tokenOf(await service.turnFor(other, { id: CALL, actor: { user_id: U1 } }))).not.toBe(tokenOf(a));
  });

  test("the TTL is the call's remaining allowance plus 60 s", async () => {
    const db = makeDb({ call: inCall(600) });
    const ice = await service.turnFor(db, { id: CALL, actor: { user_id: U1 } });
    const expiry = Number(turnServers(ice)[0].username.split(":")[0]);
    const expected = Math.floor(Date.now() / 1000) + (1800 - 600) + 60;
    expect(Math.abs(expiry - expected)).toBeLessThanOrEqual(2);
  });

  test("a ringing call's credential lasts the rest of the ring plus a full call", async () => {
    const db = makeDb({ call: ringing({ started_at: new Date(Date.now() - 20_000).toISOString() }) });
    const ice = await service.turnFor(db, { id: CALL, actor: { user_id: U2 } });
    const expiry = Number(turnServers(ice)[0].username.split(":")[0]);
    const expected = Math.floor(Date.now() / 1000) + (60 - 20) + 1800 + 60;
    expect(Math.abs(expiry - expected)).toBeLessThanOrEqual(2);
  });

  test("the dial response carries a credential for the new call", async () => {
    const db = makeDb({ members: [{ group_id: G1, user_id: U1 }] });
    const out = await inTenant(() => service.createCall(db, { groupId: G1, actor: { user_id: U1 } }));
    expect(turnServers(out.ice)[0].username).toMatch(new RegExp(`:${db.state.call.turn_token}$`));
  });

  test("a callee who declines before the dial response lands does not turn the dial into a 404", async () => {
    const db = makeDb({ members: [{ group_id: G1, user_id: U1 }] });
    db.state.afterInsert = (row) => { row.status = "DECLINED"; };
    const out = await inTenant(() => service.createCall(db, { groupId: G1, actor: { user_id: U1 } }));
    expect(turnServers(out.ice)[0].username).toMatch(/^\d+:[A-Za-z0-9_-]{16,}$/);
  });

  test("a hang-up between the answer and its response does not turn the answer into a 404", async () => {
    const db = makeDb({ call: ringing({ turn_token: "tok-from-the-dial-aaaa" }) });
    db.state.afterTransition = (row) => { row.status = "ENDED"; };
    const out = await inTenant(() => service.acceptCall(db, { id: CALL, actor: { user_id: U2 } }));
    expect(turnServers(out.ice)[0].username).toMatch(/:tok-from-the-dial-aaaa$/);
  });

  test("the call row a client reads never carries the token", async () => {
    const db = makeDb({ call: inCall(10, { turn_token: "secret-token-value" }) });
    db.query = ((orig) => async (sql, params) => {
      if (/SELECT c\.\*, g\.name AS channel_name/.test(sql)) return { rows: [{ ...db.state.call, transcription_error: "groq: 401 invalid key sk-live-abc" }] };
      return orig(sql, params);
    })(db.query);
    const row = await service.getCall(db, { id: CALL, actor: { user_id: U1 } });
    expect(row.turn_token).toBeUndefined();
    expect(JSON.stringify(row)).not.toMatch(/secret-token-value|sk-live-abc/);
  });
});

/* ── C12 · STUN only from configuration ───────────────────────────────────── */

describe("C12: STUN from configuration; Google only as the unconfigured fallback", () => {
  // Owner decision (2026-09-24, PR-3): keep Google's STUN while no STUN or
  // TURN is configured, so calls between networks keep working until the
  // self-hosted relay is up. It must never be used once either is set.
  test("nothing configured: Google's STUN, as the stopgap fallback", async () => {
    withTurn({});
    const ice = turn.iceConfigFor({ token: "t", ttlSeconds: 120, relay: await relay() });
    expect(ice.iceServers).toEqual([{ urls: ["stun:stun.l.google.com:19302"] }]);
  });

  test("with TURN configured, never Google", async () => {
    withTurn({ TURN_HOST: "turn.example.com", TURN_CREDENTIAL_SECRET: "k" });
    expect(JSON.stringify(turn.iceConfigFor({ token: "t", ttlSeconds: 120, relay: await relay() }))).not.toMatch(/google/);
  });

  test("with TURN configured, its own port serves STUN", async () => {
    withTurn({ TURN_HOST: "turn.example.com", TURN_CREDENTIAL_SECRET: "k", TURN_PORT_UDP: 3478 });
    const ice = turn.iceConfigFor({ token: "t", ttlSeconds: 120, relay: await relay() });
    expect(ice.iceServers[0]).toEqual({ urls: ["stun:turn.example.com:3478"] });
  });

  test("STUN_URLS, when set, is used as given", async () => {
    withTurn({ STUN_URLS: "stun:a.example:3478, stun:b.example:3478" });
    const ice = turn.iceConfigFor({ token: "t", ttlSeconds: 120, relay: await relay() });
    expect(ice.iceServers[0]).toEqual({ urls: ["stun:a.example:3478", "stun:b.example:3478"] });
  });

  test("a TLS port adds a turns: URL for networks that block UDP", async () => {
    withTurn({ TURN_HOST: "turn.example.com", TURN_CREDENTIAL_SECRET: "k", TURN_TLS_PORT: 5349 });
    const ice = turn.iceConfigFor({ token: "t", ttlSeconds: 120, relay: await relay() });
    expect(turnServers(ice).map((s) => s.urls[0])).toContain("turns:turn.example.com:5349?transport=tcp");
  });
});

/* ── C13 · relay-only calls hide each side's IP address ───────────────────── */

describe("C13: the tenant's relay-only setting", () => {
  beforeEach(() => withTurn({ TURN_HOST: "turn.example.com", TURN_CREDENTIAL_SECRET: "k" }));

  test("off by default: the browser may use every candidate", async () => {
    const db = makeDb({ call: inCall(5) });
    const ice = await service.turnFor(db, { id: CALL, actor: { user_id: U1 } });
    expect(ice.iceTransportPolicy).toBe("all");
  });

  test("on: iceTransportPolicy is relay for both participants", async () => {
    const db = makeDb({ call: inCall(5), settings: { call_privacy: { relay_only: true } } });
    const a = await service.turnFor(db, { id: CALL, actor: { user_id: U1 } });
    const b = await service.turnFor(db, { id: CALL, actor: { user_id: U2 } });
    expect(a.iceTransportPolicy).toBe("relay");
    expect(b.iceTransportPolicy).toBe("relay");
  });

  test("the setting is read through callSettings", async () => {
    const db = makeDb({ settings: { call_privacy: { relay_only: true } } });
    await expect(service.callSettings(db)).resolves.toMatchObject({ relay_only: true });
  });
});

/* ── C4 · a chat attachment cannot surface someone else's call ────────────── */

describe("C4: CALL attachments come only from sendSummary", () => {
  const validator = require("../../src/modules/smartcomm/smartcomm.validator");
  const callAttachment = { attachment_kind: "CALL", call_id: CALL };

  test("the message route's schema refuses a CALL attachment", () => {
    expect(validator.schemas.message.safeParse({ body: "hi", attachments: [callAttachment] }).success).toBe(false);
    // Other kinds still pass.
    expect(validator.schemas.message.safeParse({ body: "hi", attachments: [{ attachment_kind: "ERP", erp_kind: "INVOICE", erp_id: CALL }] }).success).toBe(true);
  });

  test("the scheduled-message schema refuses one too", () => {
    const body = {
      request_id: CALL, body: "later", attachments: [callAttachment],
      send_at: new Date(Date.now() + 3_600_000).toISOString(), timezone: "Africa/Douala",
    };
    expect(validator.schemas.scheduled.safeParse(body).success).toBe(false);
  });

  test("an edit carries a body and nothing else", () => {
    expect(validator.schemas.editMessage.safeParse({ body: "x", attachments: [callAttachment] }).success).toBe(false);
    expect(validator.schemas.editMessage.safeParse({ body: "x" }).success).toBe(true);
  });

  test("a stored schedule with a CALL attachment is refused at send time, even with a real vault id", async () => {
    const schedule = require("../../src/modules/smartcomm/smartcomm.schedule.service");
    const c = { query: async () => ({ rows: [{ doc_id: CALL }], rowCount: 1 }) };
    await expect(schedule.validateAttachments(c, G1, [{ ...callAttachment, vault_id: CALL }], null))
      .rejects.toMatchObject({ status: 422 });
  });

  test("the AI's post_comms_message uses the same refusing schema", () => {
    const manifest = require("../../src/modules/smartcomm/smartcomm.ai");
    const write = manifest.writes.find((w) => w.key === "post_comms_message");
    expect(write.schema.safeParse({ group_id: G1, body: "x", attachments: [callAttachment] }).success).toBe(false);
  });
});

describe("C4: a call card resolves only for the message that sent it", () => {
  const pipeline = require("../../src/modules/smartcomm/smartcomm.call.pipeline.service");
  const MSG_SENT = "66666666-6666-6666-6666-666666666666";
  const MSG_UPDATE = "77777777-7777-7777-7777-777777777777";
  const MSG_FORGED = "88888888-8888-8888-8888-888888888888";

  // A permissive database: it returns the summary whatever the WHERE says, so
  // the function's own check is what is under test. The SQL is asserted too.
  function db(summary) {
    const seen = [];
    return {
      seen,
      query: async (sql, params) => {
        seen.push({ sql, params });
        return { rows: [{ call_id: CALL, summary_text: "secret minutes", transcription_error: "groq: 401 key sk-x", ...summary }] };
      },
    };
  }

  test("the message that posted the summary gets the card", async () => {
    const cards = await pipeline.cardsForCallIds(db({ draft_status: "SENT", sent_message_id: MSG_SENT }), [{ call_id: CALL, message_id: MSG_SENT }]);
    expect(cards.get(`${MSG_SENT}:${CALL}`)).toMatchObject({ summary_text: "secret minutes" });
  });

  test("the update message gets it too", async () => {
    const cards = await pipeline.cardsForCallIds(
      db({ draft_status: "SENT", sent_message_id: MSG_SENT, update_message_id: MSG_UPDATE }),
      [{ call_id: CALL, message_id: MSG_UPDATE }],
    );
    expect(cards.get(`${MSG_UPDATE}:${CALL}`)).toBeTruthy();
  });

  test("another message pointing at the same call gets nothing", async () => {
    const cards = await pipeline.cardsForCallIds(db({ draft_status: "SENT", sent_message_id: MSG_SENT }), [{ call_id: CALL, message_id: MSG_FORGED }]);
    expect(cards.size).toBe(0);
  });

  test.each(["PENDING_REVIEW", "DISCARDED", "SENDING"])("a %s draft never resolves", async (draftStatus) => {
    const cards = await pipeline.cardsForCallIds(db({ draft_status: draftStatus, sent_message_id: MSG_SENT }), [{ call_id: CALL, message_id: MSG_SENT }]);
    expect(cards.size).toBe(0);
  });

  test("the query itself filters on SENT and the message ids, and returns no vendor text", async () => {
    const d = db({ draft_status: "SENT", sent_message_id: MSG_SENT });
    const cards = await pipeline.cardsForCallIds(d, [{ call_id: CALL, message_id: MSG_SENT }]);
    expect(d.seen[0].sql).toMatch(/draft_status = 'SENT'/);
    expect(d.seen[0].sql).toMatch(/sent_message_id|update_message_id/);
    expect(JSON.stringify([...cards.values()])).not.toMatch(/sk-x|transcription_error/);
  });
});

/* ── B8 · who ended the call is recorded ──────────────────────────────────── */

describe("B8: terminal transitions record the actor", () => {
  const actorOf = (db) => db.state.events.map((p) => p[3]);

  test("a hang-up records the person who hung up, in the event and the audit", async () => {
    const db = makeDb({ call: inCall(30) });
    await inTenant(() => service.hangup(db, { id: CALL, actor: { user_id: U2 } }));
    expect(actorOf(db)).toContain(U2);
    expect(db.state.audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(db.state.audits)).toContain(U2);
  });

  test("a decline records the callee", async () => {
    const db = makeDb({ call: ringing() });
    await inTenant(() => service.declineCall(db, { id: CALL, actor: { user_id: U2 } }));
    expect(actorOf(db)).toContain(U2);
  });

  test("an engine failure report records the reporter", async () => {
    const db = makeDb({ call: inCall(5) });
    await inTenant(() => service.reportFailure(db, { id: CALL, actor: { user_id: U1 } }));
    expect(actorOf(db)).toContain(U1);
  });

  test("the sweep acts for nobody", async () => {
    const db = makeDb({ call: ringing({ started_at: new Date(Date.now() - 61_000).toISOString() }) });
    db.query = ((orig) => async (sql, params) => {
      if (/WHERE \(status = 'RINGING' AND started_at/.test(sql)) return { rows: [db.state.call] };
      return orig(sql, params);
    })(db.query);
    await service.sweep(db, { tenantSlug: null });
    expect(db.state.call.status).toBe("NO_ANSWER");
    expect(actorOf(db)).toEqual([null]);
  });
});

/* ── B9 · the server decides the end reason ───────────────────────────────── */

describe("B9: the recorded end reason is the server's", () => {
  test("a client claiming max_duration after 30 s records hangup", async () => {
    const db = makeDb({ call: inCall(30) });
    const out = await inTenant(() => service.hangup(db, { id: CALL, actor: { user_id: U1 }, reason: "max_duration" }));
    expect(out.end_reason).toBe("hangup");
    expect(db.state.call.end_reason).toBe("hangup");
  });

  test("the controller passes no reason from the body", async () => {
    const controller = require("../../src/modules/smartcomm/smartcomm.controller");
    const spy = jest.spyOn(service, "hangup").mockResolvedValue({ ok: true });
    const req = {
      params: { id: CALL }, body: { reason: "max_duration" }, user: { user_id: U1 }, tenant: { slug: "acme" }, env: "live",
      tenantDb: (fn) => fn({}),
    };
    const res = { json: jest.fn(), status: jest.fn(() => res) };
    await new Promise((resolve) => { res.json.mockImplementation(resolve); controller.hangupCall(req, res, resolve); });
    expect(spy.mock.calls[0][1].reason).toBeUndefined();
    spy.mockRestore();
  });
});

/* ── C6 · dialing cannot be used to harass, or reach a departed employee ──── */

describe("C6: dial limits and an ACTIVE callee", () => {
  const MEMBERS = [{ group_id: G1, user_id: U1 }];

  test("a deactivated employee is never rung", async () => {
    const db = makeDb({ members: MEMBERS, partner: { user_id: U2, status: "SUSPENDED" } });
    db.query = ((orig) => async (sql, params) => {
      // The real WHERE: a partner query that requires ACTIVE finds nobody.
      if (/FROM comms_group g\s+JOIN comms_member m/.test(sql) && /status = 'ACTIVE'/.test(sql)) return { rows: [] };
      return orig(sql, params);
    })(db.query);
    await expect(inTenant(() => service.createCall(db, { groupId: G1, actor: { user_id: U1 } })))
      .rejects.toMatchObject({ status: 422 });
    expect(db.state.call).toBeNull();
    expect(publishSpy.mock.calls.filter((c) => c[3] === "call:ringing")).toHaveLength(0);
  });

  test("one person rung too often in a minute: the next dial is 429 and rings nobody", async () => {
    const limit = service.DIAL_LIMITS.perCalleePerMinute;
    for (let i = 0; i < limit; i += 1) {
      const db = makeDb({ members: MEMBERS });
      await inTenant(() => service.createCall(db, { groupId: G1, actor: { user_id: U1 } }));
    }
    publishSpy.mockClear();
    const db = makeDb({ members: MEMBERS });
    await expect(inTenant(() => service.createCall(db, { groupId: G1, actor: { user_id: U1 } })))
      .rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    // The message must not tell this caller that other people have been
    // calling that colleague.
    await expect(inTenant(() => service.createCall(makeDb({ members: MEMBERS }), { groupId: G1, actor: { user_id: U1 } })))
      .rejects.toThrow(/^Too many calls just now/);
    expect(db.state.call).toBeNull();
    expect(publishSpy).not.toHaveBeenCalled();
  });
});

describe("C6: a deactivated user's devices stop receiving pushes", () => {
  const load = () => require("../../src/orchestration/handlers/user-deactivated-drop-push");

  test("their push subscriptions are deleted", async () => {
    const seen = [];
    const client = {
      query: async (sql) => {
        seen.push(sql);
        if (/SELECT status FROM app_user/.test(sql)) return { rows: [{ status: "SUSPENDED" }] };
        if (/to_regclass\('sandbox.push_subscription'\)/.test(sql)) return { rows: [{ ok: true }] };
        if (/DELETE FROM push_subscription WHERE user_id = \$1/.test(sql)) return { rowCount: 2, rows: [] };
        if (/DELETE FROM sandbox\.push_subscription WHERE user_id = \$1/.test(sql)) return { rowCount: 1, rows: [] };
        return { rows: [] };
      },
    };
    const out = await load().run(client, { entity_ref: `app_user:${U2}` });
    // Live devices and Test-mode (sandbox) devices alike.
    expect(out).toEqual({ deleted: 3 });
    expect(seen.some((x) => /DELETE FROM sandbox\.push_subscription/.test(x))).toBe(true);
  });

  test("an active user keeps theirs", async () => {
    const client = { query: async (sql) => (/SELECT status/.test(sql) ? { rows: [{ status: "ACTIVE" }] } : { rows: [] }) };
    await expect(load().run(client, { entity_ref: `app_user:${U2}` })).resolves.toEqual({ skipped: "still active" });
  });

  test("it is registered on app_user.updated", () => {
    expect(load().eventKey).toBe("app_user.updated");
    const src = require("fs").readFileSync(require.resolve("../../src/orchestration/handlers/index.js"), "utf8");
    expect(src).toMatch(/require\("\.\/user-deactivated-drop-push"\)/);
  });
});

/* ── C10 · the AI reads honour the recording kill switch ──────────────────── */

describe("C10: Praxis AI cannot read call records when recording is off", () => {
  const manifest = require("../../src/modules/smartcomm/smartcomm.ai");
  const off = { query: async (sql) => (/FROM feature_state/.test(sql) ? { rows: [{ state: "off" }] } : { rows: [] }) };

  test.each(["comms_call_transcript", "comms_call_summary"])("%s is refused with FEATURE_DISABLED", async (key) => {
    const read = manifest.reads.find((r) => r.key === key);
    await expect(read.service(off, { call_id: CALL }, { user_id: U1 })).rejects.toMatchObject({ status: 403, code: "FEATURE_DISABLED" });
  });

  test("the call list needs the calls feature", async () => {
    const read = manifest.reads.find((r) => r.key === "list_comms_calls");
    await expect(read.service(off, {}, { user_id: U1 })).rejects.toMatchObject({ status: 403, code: "FEATURE_DISABLED" });
  });
});
