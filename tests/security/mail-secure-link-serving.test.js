/**
 * Secure links actually serve the document, and every open is recorded
 * (§9.4, §9.10 criterion 6).
 *
 * `GET /public/secure/:token` returned `{ label, target_kind, expires_at }` and
 * stopped. The recipient got a JSON description of a file they could not have.
 * `secure_link_view` — created by migration 10758, with columns for IP and
 * user-agent — was written by nothing, and nothing reached the CRM timeline.
 *
 * That last part is the commercially load-bearing one. §9.4 calls link views
 * "the ONLY open signal in the product ... precise, first-party and unaffected
 * by image blocking. It is the reason Q32's answer costs you nothing
 * commercially." Q32 dropped open tracking on the strength of this existing.
 *
 * This suite also pins the things that keep an unauthenticated endpoint safe,
 * because each of them is invisible when it regresses.
 */
"use strict";

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  assertDocumentAccess: jest.fn(async () => ({ doc_id: "v-1" })),
  fetchBytes: jest.fn(async () => ({
    doc: { doc_id: "v-1", original_name: "Invoice INV-2026-0311.pdf", content_type: "application/pdf" },
    buffer: Buffer.from("%PDF-1.4 pretend"),
  })),
}));

const fs = require("fs");
const path = require("path");
const { emitEvent } = require("../../src/shared/events/emit");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const links = require("../../src/modules/mail/triage/secure-link.service");
const token = require("../../src/modules/mail/triage/secure-link");

function fakeClient(answers = []) {
  const calls = [];
  return {
    calls,
    written: (re) => calls.filter((c) => re.test(c.text)),
    query: async (text, params) => {
      calls.push({ text, params });
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  };
}

const live = (over = {}) => ({
  secure_link_id: "l-1", target_kind: "VAULT_DOC", target_ref: "v-1",
  entity_ref: "client:c-1", label: "Invoice INV-2026-0311",
  expires_at: new Date(Date.now() + 86400000), revoked_at: null, view_count: 0,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe("the token is never stored", () => {
  test("minting stores only the SHA-256, and returns the plaintext once", async () => {
    const c = fakeClient([{ match: /INSERT INTO secure_link/, rows: [live()] }]);
    const out = await links.mint(c, { targetKind: "VAULT_DOC", targetRef: "v-1" }, { user_id: "u-1" });

    const stored = c.written(/INSERT INTO secure_link/)[0].params[0];
    expect(vault.assertDocumentAccess).toHaveBeenCalledWith(c, c, "v-1", { user_id: "u-1" }, "view");
    expect(out.token).toBeTruthy();
    expect(stored).toBe(token.hashToken(out.token));
    expect(stored).not.toBe(out.token);
    // A dump of secure_link yields nothing usable.
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });

  test("lookup hashes what was presented rather than searching for it", async () => {
    const c = fakeClient([{ match: /WHERE token_hash/, rows: [live()] }]);
    await links.resolve(c, "abc123");
    expect(c.written(/WHERE token_hash/)[0].params[0]).toBe(token.hashToken("abc123"));
  });
});

describe("expired, revoked and never-existed are indistinguishable", () => {
  const cases = [
    ["never existed", []],
    ["expired", [live({ expires_at: new Date(Date.now() - 1000) })]],
    ["revoked", [live({ revoked_at: new Date() })]],
  ];

  test.each(cases)("%s answers the same 404 with the same words", async (_name, rows) => {
    const c = fakeClient([{ match: /WHERE token_hash/, rows }]);
    await expect(links.resolve(c, "t")).rejects.toMatchObject({
      status: 404,
      message: "This link has expired or been revoked.",
    });
  });

  test("which matters because telling them apart says whether a document existed", async () => {
    // Three different messages would let an anonymous caller confirm that a
    // token they found in a forwarded email once pointed at something real.
    const msgs = [];
    for (const [, rows] of cases) {
      const c = fakeClient([{ match: /WHERE token_hash/, rows }]);
      // eslint-disable-next-line no-await-in-loop
      await links.resolve(c, "t").catch((e) => msgs.push(`${e.status}:${e.message}`));
    }
    expect(new Set(msgs).size).toBe(1);
  });
});

describe("opening records the view and serves the bytes", () => {
  test("a secure_link_view row is written with IP and user-agent", async () => {
    const c = fakeClient();
    await links.open(c, live(), { ip: "41.202.1.9", userAgent: "Mozilla/5.0" });
    const v = c.written(/INSERT INTO secure_link_view/)[0];
    expect(v).toBeDefined();
    expect(v.params).toEqual(["l-1", "41.202.1.9", "Mozilla/5.0"]);
  });

  test("the counter advances and first_viewed_at keeps the FIRST open", async () => {
    const c = fakeClient();
    await links.open(c, live(), {});
    const u = c.written(/UPDATE secure_link/)[0];
    expect(u.text).toMatch(/view_count = view_count \+ 1/);
    // COALESCE, not assignment: the interesting fact is when they first opened
    // it, not when they last did.
    expect(u.text).toMatch(/first_viewed_at = COALESCE\(first_viewed_at, now\(\)\)/);
  });

  test("the view lands on the client's CRM timeline", async () => {
    await links.open(fakeClient(), live(), {});
    expect(emitEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventTypeKey: "mail.secure_link.viewed",
      entityRef: "client:c-1",
    }));
  });

  test("but the timeline does not carry the IP", async () => {
    await links.open(fakeClient(), live(), { ip: "41.202.1.9" });
    const payload = emitEvent.mock.calls[0][1].payload;
    // The operator needs to know it was opened, not where the recipient was
    // sitting when they opened it.
    expect(JSON.stringify(payload)).not.toContain("41.202.1.9");
  });

  test("a link bound to no entity still records the view, just not a timeline entry", async () => {
    const c = fakeClient();
    await links.open(c, live({ entity_ref: null }), {});
    expect(c.written(/INSERT INTO secure_link_view/)).toHaveLength(1);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  test("the view is recorded BEFORE the bytes are fetched", async () => {
    const c = fakeClient();
    await links.open(c, live(), {});
    // A download that dies mid-transfer still counts as an open: reaching it is
    // the signal, finishing the read is not.
    const viewIdx = c.calls.findIndex((q) => /INSERT INTO secure_link_view/.test(q.text));
    expect(viewIdx).toBe(0);
    expect(vault.fetchBytes).toHaveBeenCalled();
  });

  test("the document comes back with its real name and type", async () => {
    const out = await links.open(fakeClient(), live(), {});
    expect(out.kind).toBe("VAULT_DOC");
    expect(out.filename).toBe("Invoice INV-2026-0311.pdf");
    expect(out.content_type).toBe("application/pdf");
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
  });

  test("a failed view record does not stop the document being served", async () => {
    const c = {
      query: async (text) => {
        if (/INSERT INTO secure_link_view/.test(text)) throw new Error("inet parse");
        return { rows: [] };
      },
    };
    const out = await links.open(c, live(), { ip: "not-an-ip" });
    expect(out.kind).toBe("VAULT_DOC");
  });

  test("it goes through the vault service, not around it", () => {
    // A secure link is a delegation of the sender's access, not a second way
    // into storage — so the vault's own permissions, backend and retention
    // apply.
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/triage/secure-link.service.js"), "utf8",
    );
    expect(src).toMatch(/document_vault\.service/);
    expect(src).not.toMatch(/storage\.get\(/);
  });
});

describe("the public route stays unhelpful to strangers", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../src/modules/mail/public_secure/public_secure.routes.js"), "utf8",
  );

  test("it is rate-limited", () => {
    expect(src).toMatch(/makeLimiter/);
    expect(src).toMatch(/max: 60/);
  });

  test("it is unindexable and uncacheable", () => {
    expect(src).toMatch(/X-Robots-Tag.*noindex/);
    expect(src).toMatch(/Cache-Control.*no-store/);
    expect(src).toMatch(/Referrer-Policy.*no-referrer/);
  });

  test("a not-yet-rendered document answers the same 404 as a bad token", () => {
    // fetchBytes throws 409 NOT_READY internally; outwardly it must not be
    // distinguishable, or it confirms the document exists.
    expect(src).toMatch(/err\.status === 409.*\n?.*gone\(\)|status === 409\) throw gone\(\)/);
  });

  test("the filename is sanitised before it reaches a response header", () => {
    expect(src).toMatch(/replace\(\/\[\^\\w\. -\]\+\/g, "_"\)/);
  });

  test("there is no route that lists or enumerates anything", () => {
    const paths = [...src.matchAll(/router\.\w+\("([^"]+)"/g)].map((m) => m[1]);
    expect(paths.sort()).toEqual(["/:token", "/:token/download"]);
  });

  test("it does not require auth — the token is the authorisation", () => {
    expect(src).not.toMatch(/authMiddleware|requirePermission/);
  });
});

describe("listing and revoking, for the sender", () => {
  test("the list never returns the token or its hash", async () => {
    const c = fakeClient();
    await links.list(c, {});
    const cols = c.calls[0].text;
    expect(cols).not.toMatch(/token_hash/);
    expect(cols).toMatch(/is_live/);
  });

  test("live-only by default; expired ones are opt-in", async () => {
    const c = fakeClient();
    await links.list(c, {});
    expect(c.calls[0].params[1]).toBe(false);
    await links.list(c, { includeExpired: true });
    expect(c.calls[1].params[1]).toBe(true);
  });

  test("revoking twice is not an error the second time — it returns nothing", async () => {
    const c = fakeClient();
    expect(await links.revoke(c, "l-1")).toBeNull();
    expect(c.calls[0].text).toMatch(/revoked_at IS NULL/);
  });

  test("views are readable, so an operator can answer 'did they get it?'", async () => {
    const c = fakeClient();
    await links.views(c, "l-1");
    expect(c.calls[0].text).toMatch(/FROM secure_link_view/);
    expect(c.calls[0].text).toMatch(/ip::text/);
  });
});
