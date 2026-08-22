"use strict";

/**
 * The QES webhook THROUGH THE REAL STACK — the regression test for the audit
 * finding that every genuine SignWell delivery was rejected 401.
 *
 * The finding, in one sentence: `src/server.js` mounts `express.json()`
 * GLOBALLY before the tenant router, body-parser sets `req._body` once it has
 * parsed, and every downstream body parser bails on that flag — so the
 * route-level `express.text` never runs, `req.body` is a parsed object, and
 * `verifyWebhook` (which needs the raw text) returns false for every genuine
 * delivery, because no provider posts `text/plain`.
 *
 * The 395-line service test (qes-webhook.test.js) is correct and passed: it
 * hands `handleWebhook` a string and proves the SERVICE is right. This file
 * proves the ROUTE: a real signed payload, `Content-Type: application/json`,
 * through `buildApp()` — the same middleware chain production runs — must be
 * accepted, and a replay of it must settle exactly once.
 *
 * Written FIRST and watched fail against the current code (401), per the
 * lesson: a test that cannot fail is not a test.
 *
 * What is stubbed, and why that is the honest boundary: the TENANT REGISTRY
 * (host resolution + the tenant connection) — there is no Postgres in a unit
 * test, and the tenant's rows are the fixtures. Everything between the HTTP
 * socket and the SQL is the real thing: helmet, the global JSON parser, the
 * limiters, hostTenantResolver, tenantContext, the module router, the
 * signature check, the decline flow.
 */

const crypto = require("crypto");
const request = require("supertest");

const registry = require("../../src/services/tenant/registry.service");

const TENANT = {
  tenant_id: "tenant-qes-test",
  slug: "qestest",
  db_name: "praxis_qestest",
  name: "QES Test Tenant",
  status: "LIVE",
  is_live: true,
  live_schema: "live",
  sandbox_schema: "sandbox",
};

const WEBHOOK_ID = "11111111-2222-3333-4444-555555555555";
const PROVIDER_DOC = "sw-doc-1";

/**
 * A stateful tenant client — the fixtures the webhook's SQL will meet.
 *
 * `claimCount` is the envelope transition, `settleCount` the party
 * settlement. The idempotency assertion is on THOSE: a replayed event may
 * re-read everything, but it may settle nothing a second time.
 */
function makeTenantClient() {
  const state = {
    envelope: {
      envelope_id: "env-1", request_id: "req-1", party_id: "party-2",
      provider_key: "signwell", provider_ref: PROVIDER_DOC, status: "SENT",
      audit_vault_id: null, signed_vault_id: null, last_error: null,
    },
    party: {
      party_id: "party-2", request_id: "req-1", status: "SENT",
      full_name: "Aïssatou Njoya", party_role: "Procurement Manager",
      email: "aissatou@cimencam.cm", decline_reason: null,
    },
    req: {
      request_id: "req-1", entity_ref: "final_invoice:abc", doc_type: "FINAL_INVOICE",
      status: "SENT", content_hash: "a".repeat(64), payload_version: 1,
      document_vault_id: null, message: null, expires_at: null,
    },
    webhookSetting: {
      provider_key: "signwell",
      webhook_id: WEBHOOK_ID,
      callback_url: `https://qestest.example.com/public/qes/signwell/webhook`,
    },
    claimCount: 0,
    settleCount: 0,
  };

  const client = {
    state,
    release() {},
    async query(sql, params = []) {
      const s = String(sql);

      // The webhook's verification key (tenant setting qes.webhook).
      if (/\bFROM setting\b/.test(s)) return { rows: [{ value: state.webhookSetting }] };
      // Event-type lookups: a business event, not security-critical.
      if (/\bFROM event_type\b/.test(s)) return { rows: [{ is_security_critical: false, is_approvable: false }] };

      // Envelope by provider ref — the webhook's lookup.
      if (/\bFROM qes_envelope\b/.test(s)) return { rows: [state.envelope] };
      // The guarded transition — the claim. Only succeeds from an expected state.
      if (/^UPDATE qes_envelope\b/.test(s)) {
        const to = params[1];
        const expected = params[params.length - 1];
        if (Array.isArray(expected) && expected.includes(state.envelope.status)) {
          state.envelope = { ...state.envelope, status: to, last_error: params.length > 3 ? null : state.envelope.last_error };
          state.claimCount += 1;
          return { rows: [state.envelope] };
        }
        return { rows: [] };
      }

      // The party.
      if (/\bFROM signature_party\b/.test(s)) return { rows: [state.party] };
      if (/^UPDATE signature_party\b/.test(s)) {
        if (state.party.status === "SENT") {
          state.party = { ...state.party, status: params[1], decline_reason: params[2] ?? null };
          state.settleCount += 1;
          return { rows: [state.party] };
        }
        return { rows: [] };
      }

      // The request.
      if (/\bFROM signature_request\b/.test(s)) return { rows: [state.req] };
      if (/^UPDATE signature_request\b/.test(s)) {
        const to = params[1];
        const expected = params[params.length - 1];
        if (Array.isArray(expected) && expected.includes(state.req.status)) {
          state.req = { ...state.req, status: to };
          return { rows: [state.req] };
        }
        return { rows: [] };
      }

      // Inserts, advisory locks, and everything else: accepted, no rows.
      return { rows: [] };
    },
  };
  return client;
}

/** A genuine SignWell event: HMAC-SHA256 over `type@time`, keyed by the webhook id. */
function signedEvent(type, time = Math.floor(Date.now() / 1000)) {
  const hash = crypto.createHmac("sha256", WEBHOOK_ID).update(`${type}@${time}`).digest("hex");
  return { event: { hash, time, type }, data: { object: { id: PROVIDER_DOC }, account_id: "acct-1" } };
}

// buildApp mounts the real module routers, which require the qes modules,
// which require the registry — same module instance the spies patch. The
// spies are installed per-test (below) because a module-scope spy plus
// restoreAllMocks is torn down after the FIRST test, and the rest would hit
// the real registry with no database.
const { buildApp } = require("../../src/server");
const app = buildApp();

let clientState;

const postWebhook = (body) =>
  request(app)
    .post("/api/tenant/public/qes/signwell/webhook")
    .set("Host", "qestest.example.com")
    .set("Content-Type", "application/json")
    .send(JSON.stringify(body));

beforeEach(() => {
  clientState = makeTenantClient();
  jest.spyOn(registry, "resolveByHost").mockResolvedValue(TENANT);
  // The lease is used as the client (and released on response finish).
  jest.spyOn(registry, "acquire").mockImplementation(async () => clientState);
});

afterEach(() => jest.restoreAllMocks());

describe("the webhook through the real middleware chain", () => {
  test("a genuine signed delivery (application/json) is accepted and settles the chain", async () => {
    // THE regression: with the global JSON parser in front and no raw body
    // stashed, this request 401s — every real SignWell delivery, forever.
    const res = await postWebhook(signedEvent("document_declined"));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, ignored: false });
    // And it genuinely ran the flow, not a no-op 200.
    expect(clientState.state.envelope.status).toBe("DECLINED");
    expect(clientState.state.party.status).toBe("DECLINED");
    expect(clientState.state.req.status).toBe("DECLINED");
    expect(clientState.state.claimCount).toBe(1);
    expect(clientState.state.settleCount).toBe(1);
  }, 30000);

  test("a forged hash is rejected 401 and touches nothing (§7.6 criterion 4)", async () => {
    const body = signedEvent("document_declined");
    body.event.hash = "0".repeat(64);

    const res = await postWebhook(body);

    expect(res.status).toBe(401);
    expect(clientState.state.claimCount).toBe(0);
    expect(clientState.state.settleCount).toBe(0);
    expect(clientState.state.envelope.status).toBe("SENT");
  }, 30000);

  test("a replayed event is idempotent: one claim, one settlement, two 200s", async () => {
    const body = signedEvent("document_declined");

    const first = await postWebhook(body);
    expect(first.status).toBe(200);
    expect(first.body.ignored).toBe(false);

    // The provider retries until it gets 2xx — it did — and retries anyway
    // under network flake. The second delivery must settle nothing new.
    const second = await postWebhook(body);
    expect(second.status).toBe(200);
    expect(second.body.ignored).toBe(true);

    expect(clientState.state.claimCount).toBe(1);
    expect(clientState.state.settleCount).toBe(1);
  }, 30000);

  test("an unknown provider on the path is a 404, not a 401 or a 500", async () => {
    const res = await request(app)
      .post("/api/tenant/public/qes/nosuchprovider/webhook")
      .set("Host", "qestest.example.com")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(signedEvent("document_declined")));

    expect(res.status).toBe(404);
  }, 30000);
});
