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

/**
 * This programme's migrations, by the tables they touch.
 *
 * `qes` is in the net too (PR-4, remediation): `10785_qes_envelope.sql` and
 * `10787_qes_events.sql` did not match the original pattern, so they were
 * outside this gate for every future edit — no live hazard today (10785's
 * constraints are all inline in the CREATE TABLE and its one pg_trigger
 * lookup is scoped with tgrelid), but a gate that does not cover the files
 * is a gate that has not been written. The applied files are not renamed —
 * the ledger keys on filename and a rename reads as a new migration.
 */
const FILES = fs
  .readdirSync(TENANT)
  .filter((f) => /^\d+_(signature|document_signature|qes)/.test(f))
  .sort();

/**
 * Every existence check against the DATABASE-WIDE catalog tables in a file,
 * with the table and the text of the surrounding predicate, so the assertion
 * can say whether it is scoped to the running schema.
 *
 * pg_constraint and pg_trigger are both database-wide: the sandbox pass sees
 * live's rows. The constraint form was the one that emptied every tenant's
 * sandbox (the header); the trigger form is its quieter twin — 10781's
 * name-only pg_trigger check skipped the sandbox trigger on every provision,
 * leaving signature_request.updated_at dead in the sandbox. Both are checked
 * here now.
 *
 * Comments are stripped first: these files DOCUMENT the unscoped form in order
 * to explain why it is wrong, and a grep that cannot tell an explanation from
 * an implementation would fail on the very comment warning about it.
 */
function catalogChecks(sql) {
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*--[^\n]*$/gm, " ");
  const out = [];
  const re = /FROM\s+(pg_constraint|pg_trigger)\s+WHERE\s+([^)]*)\)/gi;
  let m;
  while ((m = re.exec(code)) !== null) {
    out.push({ table: m[1], predicate: m[2].replace(/\s+/g, " ").trim() });
  }
  return out;
}

const scoped = (table, predicate) =>
  (table === "pg_constraint" && /conrelid\s*=\s*'[a-z_]+'::regclass/i.test(predicate))
  || (table === "pg_trigger" && /tgrelid\s*=\s*'[a-z_]+'::regclass/i.test(predicate))
  || /nspname\s*=\s*current_schema\(\)/i.test(predicate);

/**
 * Applied migrations are immutable (the idempotency gate freezes them), so a
 * known unscoped lookup in an applied file is grandfathered HERE — with the
 * repair it points at, and a test below that asserts the repair exists. The
 * exemption cannot outlive the fix, which is the only shape of grandfather
 * that does not become folklore.
 */
const GRANDFATHERED = new Map([
  // Name-only pg_trigger check (line 101). Skipped the sandbox trigger on
  // every provisioned tenant; the scoped repair is in 10787, section 2.
  ["10781_signature_request.sql", "10787_qes_events.sql"],
]);

describe("the signature programme's migrations are schema-scoped", () => {
  test("this test is looking at the files it thinks it is", () => {
    // A glob that silently matches nothing passes every assertion below.
    expect(FILES.length).toBeGreaterThanOrEqual(9);
    expect(FILES).toContain("10771_signature_core.sql");
    expect(FILES).toContain("10779_signature_scan.sql");
    // The PR-4 files: the ones that slipped the old pattern.
    expect(FILES).toContain("10785_qes_envelope.sql");
    expect(FILES).toContain("10787_qes_events.sql");
  });

  test.each(FILES)("%s scopes every database-wide catalog lookup to the current schema", (file) => {
    const sql = fs.readFileSync(path.join(TENANT, file), "utf8");
    const unscoped = catalogChecks(sql).filter(({ table, predicate }) => !scoped(table, predicate));
    // The grandfathered lookups are the applied files that cannot be edited
    // in place; everything else must be scoped, full stop.
    const excused = GRANDFATHERED.has(file);
    expect({ file, unscoped: excused ? [] : unscoped }).toEqual({ file, unscoped: [] });
  });

  test("every grandfathered lookup still has its repair in place", () => {
    // The exemption is a bridge, not a destination: the file it names must
    // carry the scoped fix, or the grandfather silently outlives the repair
    // and the sandbox is broken again on the next fresh provision.
    for (const [broken, repair] of GRANDFATHERED) {
      const sql = fs.readFileSync(path.join(TENANT, repair), "utf8");
      expect({ broken, repair, hasScopedRepair: sql.includes("tgname = 'trg_sigreq_updated' AND tgrelid = 'signature_request'::regclass") })
        .toEqual({ broken, repair, hasScopedRepair: true });
    }
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
