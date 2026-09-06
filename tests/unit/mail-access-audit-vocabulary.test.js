"use strict";

/**
 * A CONSTRAINT GUARDED ON THE WRONG SCHEMA IS A CONSTRAINT THAT NEVER CHANGES.
 *
 * ── The finding ─────────────────────────────────────────────────────────────
 *
 * `mailbox.service.disconnect` ends by writing a MAILBOX_DISCONNECTED row to
 * `email_access_audit` — "when did we stop holding this password?" is the
 * question that table exists to answer. 10725 fixed the column to six verbs and
 * 12750 was written to add the seventh. It never did, on any tenant, because of
 * its guard:
 *
 *     IF to_regclass('public.email_access_audit') IS NULL THEN RETURN; END IF;
 *
 * Tenant tables are not in `public`. 0001 creates `live` and `sandbox`, and
 * provisioning applies every tenant migration twice — search_path=live,public
 * and search_path=sandbox,public. So the lookup was always NULL, the DO block
 * always took the early RETURN, and the file recorded itself as applied.
 *
 * Disconnecting a mailbox therefore raised 23514 on its LAST statement, after
 * the mailbox had already been archived and its credential already deleted:
 * the operator saw "A value violates a domain constraint" on a disconnect that
 * had in fact half-happened. 13779 is the repair.
 *
 * Same family as tests/security/signature-migration-scoping.test.js, which
 * pinned the `pg_constraint`-by-name form for the signature programme. This
 * pins the mail one, and the vocabulary itself — a verb added to a service with
 * no migration behind it fails here rather than on a customer's database.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const TENANT = path.join(ROOT, "migrations/tenant");
const MAIL = path.join(ROOT, "src/modules/mail/mail");

/** SQL with its comments removed — these files DOCUMENT the wrong form. */
const stripSql = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/**
 * The definition of `email_access_audit_action_check` a database ends up with:
 * the last migration, in the migrator's own filename order, that adds it.
 */
function effectiveActionVerbs() {
  const files = fs.readdirSync(TENANT).filter((f) => f.endsWith(".sql")).sort();
  let verbs = null;
  for (const f of files) {
    const sql = stripSql(fs.readFileSync(path.join(TENANT, f), "utf8"));
    // Only a file that actually reaches the ALTER counts. 12750 does not: its
    // guard returns first, which is exactly the bug this test exists for, so
    // the guard is asserted separately below.
    if (!/email_access_audit/.test(sql)) continue;
    const m = /action\s+IN\s*\(([^)]*)\)/i.exec(sql);
    if (!m) continue;
    if (/to_regclass\(\s*'public\./i.test(sql)) continue;
    verbs = m[1].match(/'([A-Z_]+)'/g).map((v) => v.replace(/'/g, ""));
  }
  return verbs;
}

/** Every verb the mail services write into that column. */
function verbsWrittenByCode() {
  const found = new Set();
  for (const f of fs.readdirSync(MAIL).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(MAIL, f), "utf8");
    // `recordAccessAudit({ … action: "X" … })` — the call spans lines, so match
    // the argument object rather than one line of it.
    for (const call of src.match(/recordAccessAudit\(client,\s*\{[\s\S]*?\}\)/g) || []) {
      for (const a of call.match(/action:\s*(?:existing\s*\?\s*)?"([A-Z_]+)"(?:\s*:\s*"([A-Z_]+)")?/g) || []) {
        for (const v of a.match(/"([A-Z_]+)"/g) || []) found.add(v.replace(/"/g, ""));
      }
    }
  }
  return [...found].sort();
}

test("the action check admits every verb a mail service writes", () => {
  const allowed = effectiveActionVerbs();
  expect(allowed).toContain("MAILBOX_DISCONNECTED");
  for (const verb of verbsWrittenByCode()) expect(allowed).toContain(verb);
});

test("no tenant migration looks a table up in `public` — it is in live/sandbox", () => {
  // 12750 is the file that proves the point and cannot be edited: the ledger
  // keys on filename, so a fix there would never re-run on a tenant that has
  // already applied it. 13779 carries the corrected constraint instead.
  const KNOWN_BROKEN = new Set(["12750_mail_access_audit_disconnect.sql"]);
  const offenders = [];
  for (const f of fs.readdirSync(TENANT).filter((n) => n.endsWith(".sql"))) {
    if (KNOWN_BROKEN.has(f)) continue;
    if (/to_regclass\(\s*'public\./i.test(stripSql(fs.readFileSync(path.join(TENANT, f), "utf8")))) {
      offenders.push(f);
    }
  }
  expect(offenders).toEqual([]);
});

test("the repair migration is schema-relative, so both passes see their own table", () => {
  const sql = stripSql(
    fs.readFileSync(path.join(TENANT, "13779_mail_access_audit_disconnect_repair.sql"), "utf8"),
  );
  expect(sql).toMatch(/to_regclass\(\s*'email_access_audit'\s*\)/);
  expect(sql).not.toMatch(/public\.|live\.|sandbox\./);
});
