"use strict";

/**
 * The SignWell adapter — doc/SIGNATURE_ENGINEERING_GUIDE.md §7.2, and §7.6
 * criterion 4 for the webhook half.
 *
 * These tests pin the WIRE FORMAT. The guide is specific that the wire format
 * was verified against the provider's current documentation at implementation
 * time, and the pin is what keeps it that way: a provider change that breaks
 * creation, status mapping or the webhook check fails HERE, in CI, rather
 * than in a counterparty's signing session.
 *
 * `axios` is mocked at the module boundary — no test in this repository calls
 * a live provider, and §7.7's task list is explicit about it.
 */

jest.mock("axios", () => jest.fn());

const axios = require("axios");
const crypto = require("crypto");
const adapter = require("../../src/services/qes/signwell.adapter");

const API_KEY = "sw_test_key_that_is_not_a_real_key";

const respond = (data, status = 200) => {
  axios.mockResolvedValue({ status, data });
};

const failWith = (status, body) => {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: body || {} };
  axios.mockRejectedValue(err);
};

afterEach(() => {
  axios.mockReset();
});

describe("the request shape — auth and paths, as the live docs describe them", () => {
  test("every call carries the X-Api-Key header and the v1 base", async () => {
    respond({ id: "doc-1", status: "sent", recipients: [] });
    await adapter.createEnvelope({
      apiKey: API_KEY,
      document: { name: "Invoice", fileName: "inv.pdf", dataBase64: "aGVsbG8=" },
      parties: [{ email: "j@acme.cm", name: "Jane", signingOrder: 1 }],
      callbackUrl: "https://t.example/public/qes/signwell/webhook",
      webhookId: "hook-1",
    });

    const call = axios.mock.calls[axios.mock.calls.length - 1][0];
    expect(call.headers["X-Api-Key"]).toBe(API_KEY);
    expect(call.url).toBe("https://www.signwell.com/api/v1/documents/");
  });

  test("create sends the file as base64, one recipient, in signing order", async () => {
    respond({ id: "doc-1", status: "sent", recipients: [{ signing_url: "https://sw/x" }] });
    const out = await adapter.createEnvelope({
      apiKey: API_KEY,
      document: { name: "Invoice", fileName: "inv.pdf", dataBase64: "aGVsbG8=" },
      parties: [{ email: "j@acme.cm", name: "Jane", role: "MD", signingOrder: 1 }],
      webhookId: "hook-1",
    });

    const call = axios.mock.calls[0][0];
    expect(call.method).toBe("POST");
    expect(call.data.files).toEqual([{ name: "inv.pdf", data: "aGVsbG8=" }]);
    expect(call.data.recipients).toEqual([
      expect.objectContaining({ email: "j@acme.cm", name: "Jane", signing_order: 1 }),
    ]);
    expect(call.data.apply_signing_order).toBe(true);
    expect(call.data.test_mode).toBe(false);
    // The role is OUR seal's business, not the provider's — it must not ride
    // along in the recipient object.
    expect(call.data.recipients[0].role).toBeUndefined();
    expect(out.envelopeId).toBe("doc-1");
    expect(out.partyLinks).toEqual(["https://sw/x"]);
  });

  test("the completed PDF comes back as bytes, with the audit page OFF for the signed copy", async () => {
    axios.mockResolvedValue({ status: 200, data: Buffer.from("%PDF-1.7 signed") });
    const buf = await adapter.fetchSignedDocument({ apiKey: API_KEY, envelopeId: "doc-1" });
    const call = axios.mock.calls[0][0];
    expect(call.url).toBe("https://www.signwell.com/api/v1/documents/doc-1/completed_pdf");
    expect(call.params).toEqual({ file_format: "pdf", audit_page: false });
    expect(call.responseType).toBe("arraybuffer");
    expect(buf.toString()).toBe("%PDF-1.7 signed");
  });

  test("the audit certificate is the SAME endpoint with the audit page ON", async () => {
    axios.mockResolvedValue({ status: 200, data: Buffer.from("%PDF-1.7 audit") });
    await adapter.fetchAuditCertificate({ apiKey: API_KEY, envelopeId: "doc-1" });
    const call = axios.mock.calls[0][0];
    expect(call.params).toEqual({ file_format: "pdf", audit_page: true });
  });

  test("cancel is the DELETE on the document — the provider's cancel primitive", async () => {
    respond({}, 204);
    await adapter.cancelEnvelope({ apiKey: API_KEY, envelopeId: "doc-1", reason: "request voided" });
    const call = axios.mock.calls[0][0];
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe("https://www.signwell.com/api/v1/documents/doc-1");
  });

  test("a 404 cancel means already gone, not an error", async () => {
    failWith(404, { meta: { message: "not found" } });
    const out = await adapter.cancelEnvelope({ apiKey: API_KEY, envelopeId: "doc-1" });
    expect(out).toEqual({ cancelled: true, alreadyGone: true });
  });
});

describe("status normalisation — the provider's words, our vocabulary", () => {
  const statusFor = async (providerStatus, extra = {}) => {
    respond({ id: "doc-1", status: providerStatus, recipients: [], ...extra });
    return adapter.getStatus({ apiKey: API_KEY, envelopeId: "doc-1" });
  };

  test.each([
    ["sent", "SENT"],
    ["viewed", "SENT"],
    ["pending", "SENT"], // SignWell's "in progress" is still an open envelope
    ["completed", "COMPLETED"],
    ["declined", "DECLINED"],
    ["canceled", "CANCELLED"],
  ])("%s → %s", async (from, to) => {
    expect((await statusFor(from)).status).toBe(to);
  });

  test("expired, bounced and error are terminal FAILEDs, with the reason kept", async () => {
    for (const [status, msg] of [["expired", "expired"], ["bounced", "bounced"], ["error", "something broke"]]) {
      const out = await statusFor(status, { error_message: msg });
      expect(out.status).toBe("FAILED");
      expect(out.error).toBe(msg);
    }
  });

  test("a 404 is a FAILED envelope that is gone, not a thrown error", async () => {
    failWith(404, { meta: { message: "no such document" } });
    const out = await adapter.getStatus({ apiKey: API_KEY, envelopeId: "gone" });
    expect(out.status).toBe("FAILED");
    expect(out.gone).toBe(true);
  });

  test("a 500 is a retryable provider error, not a terminal answer", async () => {
    failWith(500, { meta: { message: "provider is down" } });
    await expect(adapter.getStatus({ apiKey: API_KEY, envelopeId: "doc-1" })).rejects.toMatchObject({
      name: "ProviderError",
      retryable: true,
      status: 500,
    });
  });
});

describe("webhook verification — §7.6 criterion 4", () => {
  const WEBHOOK_ID = "550e8400-e29b-41d4-a716-446655440000";

  /** A genuine event: the documented HMAC over `type@time`, keyed by the webhook id. */
  const genuineEvent = (type = "document_completed", time = Math.floor(Date.now() / 1000)) => {
    const hash = crypto.createHmac("sha256", WEBHOOK_ID).update(`${type}@${time}`).digest("hex");
    return { event: { hash, time, type }, data: { object: { id: "doc-1" } } };
  };

  test("a genuine event verifies", () => {
    const body = JSON.stringify(genuineEvent());
    expect(adapter.verifyWebhook({ headers: {}, rawBody: body, secret: WEBHOOK_ID })).toBe(true);
  });

  test("a forged hash is refused", () => {
    const body = JSON.stringify(genuineEvent());
    const evil = JSON.parse(body);
    evil.event.hash = "0".repeat(64);
    expect(adapter.verifyWebhook({ headers: {}, rawBody: JSON.stringify(evil), secret: WEBHOOK_ID })).toBe(false);
  });

  test("a captured event re-sent LATER is refused by the freshness window", () => {
    // The scheme alone would accept a replayed capture forever: the hash is
    // still perfect. event.time is what the window checks, and it does not
    // move with the replay.
    const old = Math.floor(Date.now() / 1000) - 24 * 3600;
    const body = JSON.stringify(genuineEvent("document_completed", old));
    expect(adapter.verifyWebhook({ headers: {}, rawBody: body, secret: WEBHOOK_ID })).toBe(false);
  });

  test.each([
    ["not JSON at all", "this is not json"],
    ["missing the event", JSON.stringify({ data: { object: { id: "x" } } })],
    ["missing the hash", JSON.stringify({ event: { time: 1, type: "document_completed" } })],
    ["a non-numeric time", JSON.stringify({ event: { time: "now", type: "document_completed", hash: "ab" } })],
    ["an empty body", ""],
  ])("refused without throwing: %s", (_label, rawBody) => {
    expect(() => adapter.verifyWebhook({ headers: {}, rawBody, secret: WEBHOOK_ID })).not.toThrow();
    expect(adapter.verifyWebhook({ headers: {}, rawBody, secret: WEBHOOK_ID })).toBe(false);
  });

  test("a body that makes the parser throw is refused, not fatal", () => {
    expect(adapter.verifyWebhook({ headers: {}, rawBody: JSON.stringify({}), secret: null })).toBe(false);
    expect(adapter.verifyWebhook({ headers: {}, rawBody: null, secret: WEBHOOK_ID })).toBe(false);
  });

  test("verification is constant-time shaped: same-length digests are compared byte-wise", () => {
    const body = JSON.stringify(genuineEvent());
    const evil = JSON.parse(body);
    // Same length, different content — the timingSafeEqual path, not the
    // length-mismatch short circuit.
    evil.event.hash = (evil.event.hash.slice(0, -1) + (evil.event.hash.at(-1) === "0" ? "1" : "0"));
    expect(adapter.verifyWebhook({ headers: {}, rawBody: JSON.stringify(evil), secret: WEBHOOK_ID })).toBe(false);
  });
});

describe("webhook registration is idempotent on the URL", () => {
  test("an existing registration is found, not stacked", async () => {
    axios.mockResolvedValue({ status: 200, data: [{ id: "hook-9", callback_url: "https://t.example/hook" }] });
    const out = await adapter.ensureWebhook({ apiKey: API_KEY, callbackUrl: "https://t.example/hook" });
    expect(out).toEqual({ webhookId: "hook-9", created: false });
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test("a new URL is registered and its id returned", async () => {
    axios
      .mockResolvedValueOnce({ status: 200, data: [] })
      .mockResolvedValueOnce({ status: 201, data: { id: "hook-new" } });
    const out = await adapter.ensureWebhook({ apiKey: API_KEY, callbackUrl: "https://t.example/hook" });
    expect(out).toEqual({ webhookId: "hook-new", created: true });
    expect(axios).toHaveBeenCalledTimes(2);
  });
});

describe("the probe — the console's Test button", () => {
  test("a good key answers with the account name and plan tier", async () => {
    respond({
      account: { name: "Praxis Logistics", plan_tier: "free" },
      user: { email: "ops@praxisls.com" },
    });
    const out = await adapter.probe({ apiKey: API_KEY });
    expect(out).toMatchObject({ account: "Praxis Logistics", plan_tier: "free", checked: "/me" });
  });

  test("a bad key throws with the provider's message, for the console to render", async () => {
    failWith(401, { meta: { error: "api_key_unauthorized_error", message: "Not valid authorization token" } });
    await expect(adapter.probe({ apiKey: "wrong" })).rejects.toMatchObject({
      name: "ProviderError",
      status: 401,
    });
  });
});
