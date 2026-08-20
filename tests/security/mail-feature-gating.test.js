/**
 * Every mail surface is behind its flag (§3.3, Q5).
 *
 * Q5 is unambiguous: `mail.*` is "all on for Smart Logistics, **off for every
 * other tenant**". `10730_mail_defaults_and_flags` seeds all fourteen keys, the
 * Platform Console projects them, and an operator reading that panel would
 * reasonably believe a tenant showing OFF has no mailbox.
 *
 * Two of them gated nothing. `mail.core` and `mail.composer` — the flags over
 * the whole of PR-1, which is to say threads, folders, search, bulk actions,
 * drafts, attachments, slash commands, undo-send and the send queue — appeared
 * in the migration, in the flag index and in no line of routing code. 71 routes
 * in `mail.routes.js`, `feature: null` at the bottom, and not one
 * `requireFeature`. `mail.antispoof` gated nothing either, because verdicts are
 * computed on ingest where there is no route to gate.
 *
 * A flag that is projected, believed and inert is worse than no flag: it is a
 * control an operator will rely on.
 *
 * These tests read the routing table rather than issuing requests, because the
 * claim is about which middleware a route carries — and a route that quietly
 * loses its gate returns MORE data, never an error, which is the same silent
 * shape as the visibility predicate in the first pass.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "../../src");
const MIGRATIONS = path.resolve(__dirname, "../../migrations/tenant");

const routes = (rel) => fs.readFileSync(path.join(SRC, "modules/mail", rel), "utf8");

/** Every `router.<verb>("<path>", ...)` declaration, with its middleware list. */
function declarations(src) {
  const out = [];
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"([^\n]*)/g)) {
    out.push({ verb: m[1], path: m[2], rest: m[3] });
  }
  return out;
}

describe("mail.core gates the conversation surface", () => {
  const decls = declarations(routes("mail/mail.routes.js"));
  const CORE_PATHS = [
    "/folders", "/labels", "/labels/:id",
    "/threads", "/threads/bulk", "/threads/:id",
    "/threads/:id/read", "/threads/:id/star", "/threads/:id/move",
    "/threads/:id/stream", "/threads/:id/label",
    "/thread", "/thread/:id", "/thread/:id/attachments",
    "/client/:id/timeline", "/thread/:id/link", "/thread/:id/read",
    "/sent", "/inbox",
  ];

  test.each(CORE_PATHS)("%s carries the mail.core gate", (p) => {
    const hits = decls.filter((d) => d.path === p);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.rest).toMatch(/\bcore\b/);
  });

  test("search is the thread list, so gating /threads gates search too", () => {
    // §5's note: "Search has no endpoint of its own on purpose. It is
    // GET /threads?q=". If that ever changes, this test is the reminder that
    // the new endpoint needs the flag.
    expect(decls.some((d) => d.path === "/search")).toBe(false);
  });
});

describe("mail.composer gates composing and sending", () => {
  const decls = declarations(routes("mail/mail.routes.js"));
  const COMPOSER_PATHS = [
    "/drafts", "/drafts/:id", "/drafts/:id/attachments",
    "/drafts/:id/attachments/:attachmentId",
    "/outbox", "/send", "/send/:id/cancel",
    "/attachments/upload", "/attachments/from-vault",
    "/commands", "/commands/:key", "/thread/:id/reply",
  ];

  test.each(COMPOSER_PATHS)("%s carries the mail.composer gate", (p) => {
    const hits = decls.filter((d) => d.path === p);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.rest).toMatch(/\bcomposer\b/);
  });

  test("POST /send is gated — it is the one that reaches a customer", () => {
    const send = declarations(routes("mail/mail.routes.js")).find((d) => d.path === "/send" && d.verb === "post");
    expect(send.rest).toMatch(/\bcomposer\b/);
  });
});

describe("setup stays reachable while the flags are off", () => {
  const decls = declarations(routes("mail/mail.routes.js"));
  const SETUP_PATHS = [
    "/connections", "/connections/:id", "/connections/:id/test",
    "/mailboxes", "/mailboxes/mine", "/mailboxes/shared",
    "/catalogue", "/send-points", "/me", "/autodiscover", "/cpanel-preset",
  ];

  test.each(SETUP_PATHS)("%s is NOT behind mail.core or mail.composer", (p) => {
    // An admin has to be able to configure mail for a tenant they are about to
    // enable it for. Gating setup means the first thing the feature does is
    // lock them out of turning it on.
    for (const h of decls.filter((d) => d.path === p)) {
      expect(h.rest).not.toMatch(/\b(core|composer)\b/);
    }
  });
});

describe("every other chapter's routes carry their own flag", () => {
  const cases = [
    ["binding/binding.routes.js", ["mail.binding", "mail.notes"]],
    ["triage/triage.routes.js", ["mail.shared_inbox", "mail.followup", "mail.secure_links", "mail.archive"]],
    ["assist/assist.routes.js", ["mail.ai"]],
    ["deliverability/deliverability.routes.js", ["mail.deliverability"]],
    ["signature/signature.routes.js", ["mail.signatures"]],
  ];

  test.each(cases)("%s references %j", (file, flags) => {
    const src = routes(file);
    for (const f of flags) expect(src).toContain(f);
  });

  test("no chapter route file forgot requireFeature entirely", () => {
    for (const [file] of cases) {
      expect(routes(file)).toMatch(/requireFeature/);
    }
  });
});

describe("mail.antispoof gates the verdict, which has no route to gate", () => {
  const hooks = require("../../src/modules/mail/triage/ingest-hooks");

  const client = (flag) => {
    const calls = [];
    return {
      calls,
      written: (re) => calls.filter((c) => re.test(c.text)),
      query: async (text, params) => {
        calls.push({ text, params });
        if (/FROM feature_state/.test(text)) return { rows: flag === null ? [] : [{ state: flag }] };
        return { rows: [] };
      },
    };
  };
  const MSG = { email_message_id: "m-1", thread_id: "t-1", direction: "IN", from_address: "a@b.cm" };

  test("flag on → the verdict is computed and stored", async () => {
    const c = client("on");
    const out = await hooks.onMessageIngested(c, MSG, { raw: {} });
    expect(c.written(/UPDATE email_message SET auth_verdict/)).toHaveLength(1);
    expect(out.verdict).toBeTruthy();
  });

  test("flag off → no verdict, and no work done to produce one", async () => {
    const c = client("off");
    const out = await hooks.onMessageIngested(c, MSG, { raw: {} });
    expect(out.verdict).toBeNull();
    expect(c.written(/UPDATE email_message SET auth_verdict/)).toHaveLength(0);
    expect(c.written(/FROM party_verified_domain/)).toHaveLength(0);
  });

  test("no row at all → fails CLOSED, matching requireFeature", async () => {
    const c = client(null);
    const out = await hooks.onMessageIngested(c, MSG, { raw: {} });
    expect(out.verdict).toBeNull();
  });

  test("the ARCHIVE is not flag-gated — a record is not a surface", async () => {
    // A tenant who turns a flag off and back on must not be left with a hole in
    // a hash chain that reports itself intact.
    for (const flag of ["off", null]) {
      const c = client(flag);
      // eslint-disable-next-line no-await-in-loop
      await hooks.onMessageIngested(c, MSG, { raw: {} });
      expect(c.written(/INSERT INTO email_archive/)).toHaveLength(1);
    }
  });

  test("the flag is read once per run, not once per message", async () => {
    const c = client("on");
    const ctx = {};
    await hooks.onMessageIngested(c, { ...MSG, email_message_id: "m-1" }, { raw: {}, ctx });
    await hooks.onMessageIngested(c, { ...MSG, email_message_id: "m-2" }, { raw: {}, ctx });
    await hooks.onMessageIngested(c, { ...MSG, email_message_id: "m-3" }, { raw: {}, ctx });
    expect(c.written(/FROM feature_state/)).toHaveLength(1);
  });
});

describe("the flag index and the code agree", () => {
  const GUIDE_FLAGS = [
    "mail.core", "mail.composer", "mail.shared_inbox", "mail.signatures",
    "mail.deliverability", "mail.binding", "mail.notes", "mail.doc_intake",
    "mail.ai", "mail.followup", "mail.secure_links", "mail.archive",
    "mail.antispoof", "mail.provider.oauth",
  ];

  const seeded = fs.readdirSync(MIGRATIONS)
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8"))
    .join("\n");

  const allSrc = (function walk(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, acc);
      else if (e.name.endsWith(".js")) acc.push(fs.readFileSync(p, "utf8"));
    }
    return acc;
  })(SRC).join("\n");

  test.each(GUIDE_FLAGS)("%s is seeded", (flag) => {
    expect(seeded).toContain(`'${flag}'`);
  });

  /**
   * `mail.doc_intake` is the one exception, and it is a scope statement rather
   * than a hole: PR-3's inbound document intake is not built (§11.3 of the
   * audit), so there is nothing for it to gate yet. Building it means deleting
   * this line — which is the right amount of friction.
   */
  const UNBUILT = new Set(["mail.doc_intake"]);

  test("every seeded flag actually gates something", () => {
    const inert = GUIDE_FLAGS
      .filter((f) => !UNBUILT.has(f))
      .filter((f) => !allSrc.includes(`"${f}"`));
    // A flag that is projected to an operator, believed by them, and checked by
    // nothing is worse than no flag at all.
    expect(inert).toEqual([]);
  });

  test("nothing in UNBUILT has quietly started gating something", () => {
    expect([...UNBUILT].filter((f) => allSrc.includes(`"${f}"`))).toEqual([]);
  });
});
