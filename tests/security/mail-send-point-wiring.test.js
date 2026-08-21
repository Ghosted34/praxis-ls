/**
 * A SEND POINT THAT CLAIMS TO BE WIRED MUST HAVE A CALLER (§3.5).
 *
 * ── THE FINDING ─────────────────────────────────────────────────────────────
 *
 * `email.service.resolveMail` has accepted a `sendPoint` since PR-0, and
 * `sendpoint.service.resolve` implements the whole tiered lookup — a binding
 * for this send point and this corporate entity, then tenant-wide, then the
 * legacy section, then the purpose identity. The registry was seeded with
 * twenty-two rows. The console lets a tenant bind an identity to each one. The
 * client API to do it exists.
 *
 * NO CALLER IN `src/` EVER PASSED ONE.
 *
 * A repo-wide scan for a literal `sendPoint:` value outside the mail composer's
 * own `"user.compose"` default returned nothing. Every system-email caller
 * passed `purpose: "NOTIFICATIONS"` and stopped there, so tiers 1 and 2 — the
 * two the whole feature exists for — could never be reached. A tenant who
 * routed "Password reset" to security@ and "Document sent to a party" to
 * documents@ had both choices recorded and ignored.
 *
 * Nine of those rows declared `is_wired = true`, above a comment reading "the
 * eight true rows below were read off the code, not guessed", naming the exact
 * files. Those files did not do it. That is the audit's headline defect one
 * layer up, and worse than an orphan table, because a table nobody reads is
 * invisible while this actively invited the configuration.
 *
 * ── WHY THE GATE READS THE SOURCE ───────────────────────────────────────────
 *
 * The same reason as the orphan-table sweep: no functional test can see this.
 * Every send still worked, from a plausible address, and the only symptom was a
 * binding that did nothing — which looks identical to a tenant who never made
 * one.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "migrations/tenant");

/** The registry as the migrations leave it: seed, then any later UPDATE. */
function registry() {
  const seed = fs.readFileSync(path.join(MIGRATIONS, "10726_mail_send_point.sql"), "utf8");
  const block = seed.slice(
    seed.indexOf("INSERT INTO mail_send_point\n"),
    seed.indexOf("INSERT INTO mail_send_point_binding"),
  );
  const rows = new Map();
  for (const m of block.matchAll(/\(\s*'([a-z0-9_.]+)'[\s\S]*?,\s*(true|false),\s*\d+\)/g)) {
    rows.set(m[1], m[2] === "true");
  }
  // Later migrations may correct a claim — 10777 does exactly that for
  // `auth.otp`. Reading only the seed would make this gate assert against a
  // state the database has not been in since.
  for (const f of fs.readdirSync(MIGRATIONS).sort()) {
    if (f === "10726_mail_send_point.sql") continue;
    // The `-- DOWN` block is a rollback recipe, not a statement that has run.
    // Reading it as one made 10777's down-migration ("SET is_wired = true")
    // undo the up-migration this gate was checking for, in the gate only.
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8")
      .split(/^-- DOWN\s*$/m)[0]
      .replace(/^\s*--.*$/gm, "");
    if (!/UPDATE mail_send_point\b/.test(sql)) continue;
    for (const m of sql.matchAll(/UPDATE mail_send_point[\s\S]*?SET[\s\S]*?is_wired\s*=\s*(true|false)[\s\S]*?WHERE send_point_key = '([a-z0-9_.]+)'/g)) {
      rows.set(m[2], m[1] === "true");
    }
  }
  return rows;
}

const SRC = path.join(ROOT, "src");
const allSrc = (function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".js")) acc.push(fs.readFileSync(p, "utf8"));
  }
  return acc;
})(SRC).join("\n");

const ROWS = registry();
const WIRED = [...ROWS].filter(([, w]) => w).map(([k]) => k);

describe("the send-point registry describes the code", () => {
  test("the registry is readable and has the rows this gate thinks it does", () => {
    expect(ROWS.size).toBeGreaterThan(15);
    expect(ROWS.has("document.share")).toBe(true);
  });

  /**
   * The key must appear as a LITERAL inside a `sendPoint:` expression.
   *
   * Not `allSrc.includes(key)` — the string turns up in comments and in the
   * registry's own docs, and a gate that accepts a mention accepts a send point
   * nobody passes. Not a bare `sendPoint: "<key>"` either: the notification
   * pair is chosen by a ternary on the security flag, which is exactly right
   * and would fail an equality check. So: the assignment, then the literal
   * within the same expression.
   */
  const passes = (key) =>
    new RegExp(`sendPoint:[^;\\n]{0,160}"${key.replace(/\./g, "\\.")}"`).test(allSrc);

  test.each(WIRED)("%s claims is_wired and a caller passes it", (key) => {
    expect(passes(key)).toBe(true);
  });

  test("a mere mention of the key does not satisfy the gate", () => {
    // Guarding the guard: `invoice.issued` is a real registry row that nothing
    // sends yet, and it appears in prose in sendpoint.service's header.
    expect(passes("invoice.issued")).toBe(false);
  });

  test("auth.otp does not claim a sender the product does not have", () => {
    // Two-factor sign-in is TOTP through an authenticator app. There is no
    // emailed code, so there is nothing for a binding to route.
    expect(ROWS.get("auth.otp")).toBe(false);
  });

  test("the queue handler carries the key through Redis", () => {
    const handler = fs.readFileSync(path.join(ROOT, "src/jobs/handlers/email-send.js"), "utf8");
    // Campaigns and scheduled reports send from the worker. Without this, their
    // bindings are stored and dropped on the way to the send.
    expect(handler).toMatch(/sendPoint/);
    expect(handler).toMatch(/entityId/);
  });

  test("document.share passes the corporate entity, not just the key", () => {
    const tpl = fs.readFileSync(
      path.join(ROOT, "src/modules/documents/template/template.service.js"), "utf8",
    );
    // The per-entity tier is the reason this registry has two binding levels: a
    // group sends each company's paperwork from that company's address. Passing
    // the key without the entity collapses it to tenant-wide.
    expect(tpl).toMatch(/sendPoint: "document\.share", entityId:/);
  });
});

describe("passing a send point cannot re-route a tenant who has bound none", () => {
  test("the resolver still falls through to the section and the purpose", () => {
    const svc = fs.readFileSync(
      path.join(ROOT, "src/modules/mail/mail/sendpoint.service.js"), "utf8",
    );
    // This is what makes the change above safe to ship to live tenants: tiers 3
    // and 4 are exactly what `email.service` did before, so a tenant with no
    // bindings sends from precisely the address they sent from yesterday.
    expect(svc).toMatch(/LEGACY_SECTION/);
    expect(svc).toMatch(/LEGACY_PURPOSE/);
  });

  test("email.service asks the registry first and keeps everything below it", () => {
    const svc = fs.readFileSync(path.join(ROOT, "src/services/email.service.js"), "utf8");
    expect(svc).toMatch(/if \(sendPoint\)/);
    // A null send point must remain a no-op rather than an error: most sends in
    // the product still have no registry row, and they must keep working.
    expect(svc).toMatch(/sendPoint = null/);
  });
});
