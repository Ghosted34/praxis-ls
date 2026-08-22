"use strict";

/**
 * A CONSTRAINT GUARD THAT READS THE WRONG SCHEMA IS A CONSTRAINT THAT NEVER
 * GETS CREATED.
 *
 * ── The finding ─────────────────────────────────────────────────────────────
 *
 * `pg_constraint` is DATABASE-wide, not schema-wide. A Praxis tenant database
 * holds BOTH schemas — live and sandbox — and provisioning migrates live first.
 * So this, the idiom used throughout 10771:
 *
 *     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_party')
 *     THEN ALTER TABLE document_signature ADD CONSTRAINT ck_sig_party …
 *
 * finds LIVE's constraint during the SANDBOX pass and skips the ADD. The
 * sandbox schema ended up with no primary key and none of the seven check
 * constraints on `document_signature`, and nothing failed — the DO block did
 * exactly what it was told.
 *
 * It surfaced only when PR-2 added the first FOREIGN KEY to that table:
 * provisioning stopped with "there is no unique constraint matching given keys
 * for referenced table document_signature", on the sandbox pass. Every check
 * constraint had been quietly absent from every tenant's sandbox since PR-1
 * merged, which is the more expensive half of the bug — a sandbox that accepts
 * rows live would reject is a sandbox that lies about what will happen in
 * production.
 *
 * ── What this test does, and what it deliberately does not ──────────────────
 *
 * It gates THIS PROGRAMME's migrations. `migrations/tenant` carries ~190 other
 * unscoped lookups with the same latent hazard, and fixing all of them is a
 * separate change with its own blast radius — widening the net here would
 * either fail the build on unrelated files or force a baseline nobody reads.
 * Pinning the signature files means PR-3, PR-4 and PR-5 cannot reintroduce it,
 * which is the part this programme owns.
 *
 * The fix is `conrelid = '<table>'::regclass` — it resolves through
 * `search_path`, so it means "in the schema this migration is running in",
 * which is what every one of these checks meant all along. It is the form
 * 0493, 0650 and 0682 already use.
 */

const fs = require("fs");
const path = require("path");

const TENANT = path.resolve(__dirname, "../../migrations/tenant");

/** This programme's migrations, by the tables they touch. */
const FILES = fs
  .readdirSync(TENANT)
  .filter((f) => /^\d+_(signature|document_signature)/.test(f))
  .sort();

/**
 * Every `pg_constraint` existence check in a file, with the text of the
 * surrounding predicate so the assertion can say whether it is scoped.
 *
 * Comments are stripped first: these files DOCUMENT the unscoped form in order
 * to explain why it is wrong, and a grep that cannot tell an explanation from
 * an implementation would fail on the very comment warning about it.
 */
function constraintChecks(sql) {
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*--[^\n]*$/gm, " ");
  const out = [];
  const re = /FROM\s+pg_constraint\s+WHERE\s+([^)]*)\)/gi;
  let m;
  while ((m = re.exec(code)) !== null) out.push(m[1].replace(/\s+/g, " ").trim());
  return out;
}

const scoped = (predicate) => /conrelid\s*=\s*'[a-z_]+'::regclass/i.test(predicate)
  || /nspname\s*=\s*current_schema\(\)/i.test(predicate);

describe("the signature programme's migrations are schema-scoped", () => {
  test("this test is looking at the files it thinks it is", () => {
    // A glob that silently matches nothing passes every assertion below.
    expect(FILES.length).toBeGreaterThanOrEqual(6);
    expect(FILES).toContain("10771_signature_core.sql");
    expect(FILES).toContain("10779_signature_scan.sql");
  });

  test.each(FILES)("%s scopes every pg_constraint lookup to the current schema", (file) => {
    const sql = fs.readFileSync(path.join(TENANT, file), "utf8");
    const unscoped = constraintChecks(sql).filter((p) => !scoped(p));
    // Reported with the predicate itself, so a failure names the line to fix
    // rather than the file to go hunting through.
    expect({ file, unscoped }).toEqual({ file, unscoped: [] });
  });

  test("10771 declares the primary key the rest of the programme references", () => {
    // 10779's FOREIGN KEY needs it, and 10781/10783 add two more. If this ADD
    // ever moves or is renamed, provisioning fails on the sandbox pass with an
    // error that names neither this file nor the reason.
    const sql = fs.readFileSync(path.join(TENANT, "10771_signature_core.sql"), "utf8");
    expect(sql).toMatch(/ADD CONSTRAINT document_signature_pkey PRIMARY KEY \(signature_id\)/);
  });

  test("10779 repairs a tenant that already applied the broken 10771", () => {
    // Fixing 10771 settles every FUTURE provision. A tenant that already ran
    // the broken version has it recorded as applied and will never re-run it,
    // so the repair has to live in a file that has not run yet.
    const sql = fs.readFileSync(path.join(TENANT, "10779_signature_scan.sql"), "utf8");
    expect(sql).toMatch(/contype = 'p'/);
    for (const c of ["ck_sig_assurance", "ck_sig_mark", "ck_sig_party", "ck_sig_identity_source",
      "ck_sig_mark_payload", "ck_sig_external_verified", "ck_sig_revocation"]) {
      expect(sql).toContain(c);
    }
  });
});
