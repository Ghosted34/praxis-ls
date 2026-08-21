/**
 * The second sweep: things that were still declared and not called.
 *
 * The first QC pass fixed the big three. A second pass over the same question —
 * *what did a migration create, or a module export, that nothing reaches?* —
 * turned up five more, four of them shipped by the mega-commit and one
 * introduced by the first pass itself. This file is the regression net for all
 * five, plus the standing gate that stops the class recurring.
 *
 *   1. `email_attachment.checksum_sha256` was written on the OUTBOUND path and
 *      left null on ingest, so the archive chain's "headers + body + attachment
 *      hashes" covered the covering letter and not the invoice.
 *   2. `mailbox.service.offboardUser` — written, idempotent, audited, and called
 *      by nothing, so a suspended user kept every shared-mailbox grant.
 *   3. `signature.repo.deleteCachedForIdentity` — no caller, so the corporate
 *      block on system mail never re-rendered after the company changed.
 *   4. `mailbox.repo.sweepSendWindows` — no caller, so throttle counters grew
 *      without bound.
 *   5. The first pass's own `stampVerdict` read the party corpus PER MESSAGE.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "../../src");
const MIGRATIONS = path.resolve(__dirname, "../../migrations/tenant");

/** `mail.antispoof` on by default — the verdict path is flag-gated (§3.3). */
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
      return { rows: hit ? hit.rows : [], rowCount: hit ? hit.rows.length : 0 };
    },
  };
}

/* ── 1. The archive seals the attachments too ─────────────────────────────── */

describe("attachment hashes reach the archive chain", () => {
  const hooks = require("../../src/modules/mail/triage/ingest-hooks");

  test("the content hash changes when an attachment hash changes", async () => {
    const msg = {
      email_message_id: "m-1", thread_id: "t-1", direction: "IN",
      from_address: "a@b.cm", subject: "Invoice", body_text: "see attached",
    };
    const a = fakeClient();
    await hooks.onMessageIngested(a, msg, { raw: {}, attachmentHashes: ["aaa"] });
    const b = fakeClient();
    await hooks.onMessageIngested(b, msg, { raw: {}, attachmentHashes: ["bbb"] });

    const hashA = a.written(/INSERT INTO email_archive/)[0].params[1];
    const hashB = b.written(/INSERT INTO email_archive/)[0].params[1];
    // If these matched, swapping the attached PDF in the vault would leave
    // /mail/archive/verify reporting an intact chain — the one thing an auditor
    // is relying on it not to do.
    expect(hashA).not.toBe(hashB);
  });

  test("the hashes are stored on the row as well as folded into the hash", async () => {
    const c = fakeClient();
    await hooks.onMessageIngested(c, { email_message_id: "m-1", direction: "IN" }, {
      raw: {}, attachmentHashes: ["aaa", "bbb"],
    });
    expect(c.written(/INSERT INTO email_archive/)[0].params[4]).toEqual(["aaa", "bbb"]);
  });

  test("persistAttachments computes a sha256 per attachment and returns them", () => {
    const src = fs.readFileSync(path.join(SRC, "modules/mail/mail/mail.service.js"), "utf8");
    const fn = src.slice(src.indexOf("async function persistAttachments"));
    const body = fn.slice(0, fn.indexOf("\n/**", 10));
    expect(body).toMatch(/createHash\("sha256"\)/);
    expect(body).toMatch(/checksum_sha256: checksum/);
    expect(body).toMatch(/return \{ saved, hashes \}/);
  });

  test("the sync loop persists attachments BEFORE it archives, and passes the hashes", () => {
    const src = fs.readFileSync(path.join(SRC, "modules/mail/mail/mail.service.js"), "utf8");
    const loop = src.slice(src.indexOf("for (const m of messages)"));
    const window = loop.slice(0, loop.indexOf("await threadRepo.setFolderCursor"));
    // Order matters: archiving first would seal the message with its
    // attachments left outside the seal.
    expect(window.indexOf("persistAttachments")).toBeLessThan(window.indexOf("onMessageIngested"));
    expect(window).toMatch(/attachmentHashes: att\.hashes/);
  });
});

/* ── 2. Mail access follows the account ───────────────────────────────────── */

describe("a deactivated user loses their mailbox access", () => {
  const handler = require("../../src/orchestration/handlers/user-deactivated-offboard-mail");

  test("it is registered against app_user.updated", () => {
    expect(handler.eventKey).toBe("app_user.updated");
    const index = fs.readFileSync(path.join(SRC, "orchestration/handlers/index.js"), "utf8");
    expect(index).toMatch(/user-deactivated-offboard-mail/);
  });

  test("a SUSPENDED user is offboarded — personal mailbox archived, grants revoked", async () => {
    const mailbox = require("../../src/modules/mail/mail/mailbox.service");
    const spy = jest.spyOn(mailbox, "offboardUser").mockResolvedValue({ archived_personal: true, grants_revoked: 3 });
    const c = fakeClient([{ match: /SELECT status FROM app_user/, rows: [{ status: "SUSPENDED" }] }]);

    const out = await handler.run(c, { entity_ref: "app_user:u-1", actor_user_id: "admin" });

    expect(spy).toHaveBeenCalledWith(c, "u-1", { user_id: "admin" });
    expect(out.grants_revoked).toBe(3);
    spy.mockRestore();
  });

  test("an ACTIVE user is untouched — app_user.updated fires on every change", async () => {
    const mailbox = require("../../src/modules/mail/mail/mailbox.service");
    const spy = jest.spyOn(mailbox, "offboardUser").mockResolvedValue({});
    const c = fakeClient([{ match: /SELECT status FROM app_user/, rows: [{ status: "ACTIVE" }] }]);
    const out = await handler.run(c, { entity_ref: "app_user:u-1" });
    expect(out.skipped).toBe("still active");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("status is re-read, never trusted from the payload", async () => {
    const c = fakeClient([{ match: /SELECT status FROM app_user/, rows: [{ status: "ACTIVE" }] }]);
    await handler.run(c, { entity_ref: "app_user:u-1", payload: { status: "SUSPENDED" } });
    expect(c.written(/SELECT status FROM app_user/)).toHaveLength(1);
  });

  test("it does not become a hard dependency of the security module", () => {
    // Locking a compromised account must not be blockable by a mailbox archive
    // failing for its own reasons.
    const src = fs.readFileSync(path.join(SRC, "modules/security/app_user/app_user.service.js"), "utf8");
    expect(src).not.toMatch(/mailbox\.service|offboardUser/);
  });
});

/* ── 3. System signature renders are invalidated ──────────────────────────── */

describe("an entity change clears the SYSTEM signature blocks too", () => {
  test("invalidateForEntity drops identity renders, not only user renders", async () => {
    const service = require("../../src/modules/mail/signature/signature.service");
    const c = fakeClient([{ match: /SELECT u\.user_id FROM app_user/, rows: [{ user_id: "u-1" }] }]);
    const out = await service.invalidateForEntity(c, "e-1");
    expect(c.written(/DELETE FROM signature_render WHERE user_id/)).toHaveLength(1);
    // The half that was missing: the corporate block on every OTP, notification
    // and invoice mail is derived from corporate_entity and is keyed by
    // identity_key, so deleteCachedForUser never reached it — and
    // signature_render has no TTL, so "never" meant forever.
    expect(c.written(/DELETE FROM signature_render WHERE identity_key IS NOT NULL/)).toHaveLength(1);
    expect(out).toHaveProperty("identities");
  });
});

/* ── 4. Throttle counters are pruned ──────────────────────────────────────── */

describe("send-window counters do not grow without bound", () => {
  test("the daily per-tenant job sweeps them", () => {
    const src = fs.readFileSync(path.join(SRC, "jobs/handlers/deliverability-check.js"), "utf8");
    expect(src).toMatch(/sweepSendWindows/);
  });

  test("retention still runs when the health check throws", async () => {
    // A DNS lookup failing is a normal Tuesday and is not a reason to stop
    // pruning — but the job must still report the failure.
    const src = fs.readFileSync(path.join(SRC, "jobs/handlers/deliverability-check.js"), "utf8");
    expect(src.indexOf("sweepSendWindows")).toBeLessThan(src.indexOf("if (error) throw"));
  });
});

/* ── 5. The corpus is read once per run, not once per message ─────────────── */

describe("anti-spoof does not re-read the world for every message", () => {
  const hooks = require("../../src/modules/mail/triage/ingest-hooks");

  test("two messages in one sync run share one corpus read", async () => {
    const c = fakeClient([
      { match: /SELECT entity_ref FROM email_thread/, rows: [{ entity_ref: null }] },
    ]);
    const ctx = {};
    const msg = (id) => ({ email_message_id: id, thread_id: "t-1", direction: "IN", from_address: "a@b.cm" });
    await hooks.onMessageIngested(c, msg("m-1"), { raw: {}, ctx });
    await hooks.onMessageIngested(c, msg("m-2"), { raw: {}, ctx });
    await hooks.onMessageIngested(c, msg("m-3"), { raw: {}, ctx });

    // On a first sync at the 90-day default depth this is thousands of scans of
    // client_master to answer one unchanging question.
    expect(c.written(/FROM party_verified_domain WHERE source = 'ADMIN_VERIFIED'/)).toHaveLength(1);
    expect(c.written(/FROM client_master WHERE is_active/)).toHaveLength(1);
  });

  test("a fresh run reads it again — the memo cannot go stale across runs", async () => {
    const c = fakeClient([{ match: /SELECT entity_ref FROM email_thread/, rows: [{ entity_ref: null }] }]);
    await hooks.onMessageIngested(c, { email_message_id: "m-1", thread_id: "t-1", direction: "IN" }, { raw: {}, ctx: {} });
    await hooks.onMessageIngested(c, { email_message_id: "m-2", thread_id: "t-1", direction: "IN" }, { raw: {}, ctx: {} });
    expect(c.written(/FROM client_master WHERE is_active/)).toHaveLength(2);
  });

  test("the per-thread verified domains ARE still read per message", async () => {
    // They are per-thread, so memoising them would apply one thread's trusted
    // domains to another's — the opposite mistake, and a worse one.
    const c = fakeClient([{ match: /SELECT entity_ref FROM email_thread/, rows: [{ entity_ref: "client:c-1" }] }]);
    const ctx = {};
    await hooks.onMessageIngested(c, { email_message_id: "m-1", thread_id: "t-1", direction: "IN", from_address: "a@b.cm" }, { raw: {}, ctx });
    await hooks.onMessageIngested(c, { email_message_id: "m-2", thread_id: "t-2", direction: "IN", from_address: "a@b.cm" }, { raw: {}, ctx });
    expect(c.written(/FROM party_verified_domain\s+WHERE party_kind/)).toHaveLength(2);
  });
});

/* ── The standing gate ────────────────────────────────────────────────────── */

describe("no mail-programme table is created and then never read", () => {
  /**
   * The finding that opened this whole QC pass, as a test.
   *
   * Every table a migration in the mail programme's reserved ranges creates
   * must be referenced by at least one line of `src/`. A table nothing reads is
   * a feature that exists in the tree and not in the product, and it is
   * invisible to every other kind of test.
   *
   * `KNOWN_UNBUILT` is the honest escape hatch: these belong to chapters that
   * are genuinely not built yet (§11.3 of the audit), and listing them here is
   * a statement about scope rather than a hole in the gate. Building one means
   * deleting its line, which is the right amount of friction.
   */
  const KNOWN_UNBUILT = new Set([
    // EMPTY, and that is the finding.
    //
    // Every entry this set has ever held has been deleted by the commit that
    // built the thing it described: `email_thread_lock` and `secure_link_view`
    // in PR-5's pass, then `attachment_extraction` (§8.6, the OCR staging
    // table) and `email_thread_summary` (§8.5) in PR-4's. Each deletion was
    // forced — the "nothing in KNOWN_UNBUILT has quietly been built" test below
    // fails the build while a stale claim sits here.
    //
    // Leave it empty. An entry added later is a scope statement someone has to
    // defend in review, which is the only reason the hatch exists.
  ]);

  const RANGES = /^(107[2-9]\d|1076\d|1077\d)_/;

  const created = new Set();
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => RANGES.test(n))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)) created.add(m[1]);
  }

  const allSrc = (function walk(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, acc);
      else if (e.name.endsWith(".js")) acc.push(fs.readFileSync(p, "utf8"));
    }
    return acc;
  })(SRC).join("\n");

  test("the migrations really do create the tables this gate thinks they do", () => {
    expect(created.size).toBeGreaterThan(15);
    expect(created.has("email_archive")).toBe(true);
  });

  test("every table is read or written by application code", () => {
    const orphans = [...created]
      .filter((t) => !KNOWN_UNBUILT.has(t))
      .filter((t) => !new RegExp(`\\b${t}\\b`).test(allSrc));
    expect(orphans).toEqual([]);
  });

  test("nothing in KNOWN_UNBUILT has quietly been built — remove it from the list", () => {
    const built = [...KNOWN_UNBUILT].filter((t) => new RegExp(`\\b${t}\\b`).test(allSrc));
    expect(built).toEqual([]);
  });

  test("the escape hatch stays short — a growing one means the gate is being routed around", () => {
    expect(KNOWN_UNBUILT.size).toBeLessThanOrEqual(6);
  });
});
