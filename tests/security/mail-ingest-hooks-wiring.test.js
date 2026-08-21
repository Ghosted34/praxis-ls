/**
 * THE PR-5 CONTROLS RUN. They are not merely defined.
 *
 * `mail-antispoof.test.js`, `mail-archive-chain.test.js` and
 * `mail-bounce-parse.test.js` all passed while `antispoof.evaluate`,
 * `archive-chain.append` and `bounce-parse.parseDsn` had no caller anywhere in
 * `src/`. `email_archive`, `party_verified_domain` and `email_bounce` were
 * created by migrations 10760–10762 and touched by nothing. Three tables, three
 * correct algorithms, three green suites, and none of the three features
 * existed at runtime.
 *
 * This file tests the hook against a fake client that records statements, and
 * then tests that the ingest and send paths actually call the hook. Both halves
 * are needed: a hook nobody calls is the exact defect being fixed.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const hooks = require("../../src/modules/mail/triage/ingest-hooks");

const SRC = path.resolve(__dirname, "../../src");

/**
 * Answers each statement from a table of matchers, and records everything.
 * Matching on the SQL rather than call order keeps the test readable when the
 * hook reorders its reads.
 */
/**
 * `mail.antispoof` answers "on" unless a test says otherwise.
 *
 * The verdict is flag-gated (§3.3), so a fixture that cannot answer
 * `feature_state` would report every verdict path as correctly skipped and
 * assert nothing — the mock-shaped-differently-from-the-runtime problem again.
 */
const FLAG_ON = { match: /FROM feature_state/, rows: [{ state: "on" }] };

function fakeClient(answers = []) {
  const calls = [];
  const table = [...answers, FLAG_ON];
  return {
    calls,
    written: (re) => calls.filter((c) => re.test(c.text)),
    query: async (text, params) => {
      calls.push({ text, params });
      const hit = table.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  };
}

const INBOUND = {
  email_message_id: "m-1",
  thread_id: "t-1",
  direction: "IN",
  from_address: "billing@smartlogistics-cm.com",
  from_name: "Smart Logistics",
  to_address: ["ops@smartlogistics.cm"],
  subject: "Invoice 2026-0311",
  body_text: "Please find the invoice attached.",
  body_html: "<p>Please find the invoice attached.</p>",
  message_id_header: "<a@b>",
  received_at: new Date("2026-08-18T09:12:00Z"),
};

describe("archive — every message joins the chain", () => {
  test("an ingested message is appended with a content hash and a chain hash", async () => {
    const c = fakeClient();
    await hooks.onMessageIngested(c, INBOUND, { raw: {} });
    const inserts = c.written(/INSERT INTO email_archive/);
    expect(inserts).toHaveLength(1);
    const [msgId, contentHash, prevHash, chainHash] = inserts[0].params;
    expect(msgId).toBe("m-1");
    expect(contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(chainHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prevHash).toBeNull(); // first row in an empty chain
  });

  test("it links to the previous row rather than restarting the chain", async () => {
    const c = fakeClient([{ match: /FROM email_archive ORDER BY seq DESC/, rows: [{ chain_hash: "deadbeef" }] }]);
    await hooks.onMessageIngested(c, INBOUND, { raw: {} });
    const [, , prevHash] = c.written(/INSERT INTO email_archive/)[0].params;
    expect(prevHash).toBe("deadbeef");
  });

  test("the tail row is locked, so two concurrent archives cannot claim one predecessor", async () => {
    const c = fakeClient();
    await hooks.onMessageIngested(c, INBOUND, { raw: {} });
    expect(c.written(/FROM email_archive ORDER BY seq DESC/)[0].text).toMatch(/FOR UPDATE/);
  });

  test("outbound is archived too", async () => {
    const c = fakeClient();
    await hooks.onMessageSent(c, { ...INBOUND, direction: "OUT", email_message_id: "m-out" });
    expect(c.written(/INSERT INTO email_archive/)).toHaveLength(1);
  });

  test("an archive failure is NOT swallowed — a gap in the chain is not enrichment", async () => {
    const c = {
      query: async (text) => {
        if (/INSERT INTO email_archive/.test(text)) throw new Error("disk full");
        return { rows: [] };
      },
    };
    await expect(hooks.onMessageIngested(c, INBOUND, { raw: {} })).rejects.toThrow("disk full");
  });
});

describe("anti-spoof — the verdict is computed and stored", () => {
  test("a lookalike domain is stamped LIKELY_IMPERSONATION on the message row", async () => {
    const c = fakeClient([
      { match: /SELECT entity_ref FROM email_thread/, rows: [{ entity_ref: "client:c-1" }] },
      { match: /SELECT DISTINCT domain/, rows: [{ domain: "smartlogistics.cm" }] },
    ]);
    await hooks.onMessageIngested(c, INBOUND, { raw: {} });
    const update = c.written(/UPDATE email_message SET auth_verdict/)[0];
    expect(update).toBeDefined();
    expect(update.params[1]).toBe("LIKELY_IMPERSONATION");
  });

  test("only ADMIN_VERIFIED domains are trusted — OBSERVED never confers trust", async () => {
    const c = fakeClient([{ match: /SELECT entity_ref FROM email_thread/, rows: [{ entity_ref: "client:c-1" }] }]);
    await hooks.onMessageIngested(c, INBOUND, { raw: {} });
    const read = c.written(/FROM party_verified_domain\s+WHERE party_kind/)[0];
    expect(read.text).toMatch(/source = 'ADMIN_VERIFIED'/);
  });

  test("the sending domain is recorded as OBSERVED, with a counter", async () => {
    const c = fakeClient([{ match: /SELECT entity_ref FROM email_thread/, rows: [{ entity_ref: "client:c-1" }] }]);
    await hooks.onMessageIngested(c, INBOUND, { raw: {} });
    const ins = c.written(/INSERT INTO party_verified_domain/)[0];
    expect(ins.text).toMatch(/'OBSERVED'/);
    expect(ins.text).toMatch(/message_count \+ 1/);
    expect(ins.params).toEqual(["CLIENT", "c-1", "smartlogistics-cm.com"]);
  });

  test("outbound mail is not given a verdict — we are not spoofing ourselves", async () => {
    const c = fakeClient();
    await hooks.onMessageIngested(c, { ...INBOUND, direction: "OUT" }, { raw: {} });
    expect(c.written(/UPDATE email_message SET auth_verdict/)).toHaveLength(0);
  });

  test("a verdict failure does not abort the ingest", async () => {
    const c = {
      query: async (text) => {
        if (/SELECT entity_ref FROM email_thread/.test(text)) throw new Error("boom");
        return { rows: [] };
      },
    };
    const out = await hooks.onMessageIngested(c, INBOUND, { raw: {} });
    expect(out.archived).toBe(true);
    expect(out.verdict).toBeNull();
  });
});

describe("bounces — a DSN becomes a record, not a message in the inbox", () => {
  const DSN = {
    ...INBOUND,
    email_message_id: "m-dsn",
    body_text: [
      "Final-Recipient: rfc822; thierry@camrail.cm",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 5.1.1 user unknown",
      "Original-Message-ID: <sent-42@smartlogistics.cm>",
    ].join("\n"),
  };
  const raw = { headers: { "content-type": "multipart/report; report-type=delivery-status" } };

  test("a hard DSN is recorded and correlated to the original message", async () => {
    const c = fakeClient([
      { match: /FROM email_message WHERE message_id_header/, rows: [{ email_message_id: "m-orig" }] },
    ]);
    await hooks.onMessageIngested(c, DSN, { raw });
    const ins = c.written(/INSERT INTO email_bounce/)[0];
    expect(ins).toBeDefined();
    expect(ins.params[0]).toBe("m-orig");
    expect(ins.params[2]).toBe("thierry@camrail.cm");
    expect(ins.params[3]).toBe("HARD");
    expect(ins.params[4]).toBe("5.1.1");
  });

  test("a hard bounce marks the contact, so the composer can warn next time", async () => {
    const c = fakeClient();
    await hooks.onMessageIngested(c, DSN, { raw });
    const marks = c.written(/SET email_status/);
    expect(marks.map((m) => m.params[1])).toEqual(["HARD_FAILED", "HARD_FAILED"]); // client + supplier
  });

  test("a soft bounce never downgrades an address already known hard-failed", async () => {
    const c = fakeClient();
    await hooks.onMessageIngested(c, { ...DSN, body_text: DSN.body_text.replace("5.1.1", "4.2.2") }, { raw });
    const mark = c.written(/SET email_status/)[0];
    expect(mark.params[1]).toBe("SOFT_FAILING");
    expect(mark.text).toMatch(/NOT \(email_status = 'HARD_FAILED'/);
  });

  test("ordinary mail produces no bounce row", async () => {
    const c = fakeClient();
    const out = await hooks.onMessageIngested(c, INBOUND, { raw: {} });
    expect(out.bounce).toBeNull();
    expect(c.written(/INSERT INTO email_bounce/)).toHaveLength(0);
  });
});

describe("the hook is actually called", () => {
  const svc = fs.readFileSync(path.join(SRC, "modules/mail/mail/mail.service.js"), "utf8");

  test("the sync loop calls it for every ingested message", () => {
    expect(svc).toMatch(/triageHooks\.onMessageIngested\(client, row/);
    // Inside the per-message loop, not once per folder or per connection.
    const loop = svc.slice(svc.indexOf("for (const m of messages)"));
    expect(loop.slice(0, loop.indexOf("await threadRepo.setFolderCursor")))
      .toMatch(/onMessageIngested/);
  });

  test("recordOutbound archives the sent message", () => {
    const fn = svc.slice(svc.indexOf("async function recordOutbound"));
    expect(fn.slice(0, fn.indexOf("\nasync function ") + 1)).toMatch(/triageHooks\.onMessageSent/);
  });

  test("archive/verify reports coverage, not just chain integrity", () => {
    // `verify([])` is `{ ok: true }`. Reporting that over an empty table for a
    // mailbox with 40 000 messages is how this gap stayed invisible.
    const routes = fs.readFileSync(path.join(SRC, "modules/mail/triage/triage.routes.js"), "utf8");
    const route = routes.slice(routes.indexOf('router.get("/archive/verify"'));
    expect(route).toMatch(/coverage/);
    expect(route).toMatch(/INCOMPLETE/);
  });
});
