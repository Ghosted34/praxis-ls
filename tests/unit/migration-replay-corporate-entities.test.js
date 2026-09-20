"use strict";

/**
 * PR-10 / B.1 — migration replay for the corporate-entities programme.
 *
 * The audit's release-evidence line (§7, PR-10) names this gap plainly: no
 * migration replay was ever performed, so every "the migrations are fine"
 * rested on static inspection. There is no Postgres in this environment (and
 * none in unit CI), so this suite replays the programme's migrations against
 * a fake pg client that implements the ONE piece of Postgres the replay
 * depends on: the `public.schema_migration(scope, filename, sha256)` ledger.
 *
 * The migrator under test is the real one — real files, real bytes, real
 * hashes. Only the database is a fake, and the fake's whole job is to be
 * honest about what the ledger already holds, which is exactly the question
 * a replay answers: what runs on a database that has never seen these files,
 * and what runs on one that has.
 *
 * The programme migrations, in the order a fresh tenant meets them:
 *
 *   0515  corporate_entity_rich          (PR-01, baselined & frozen)
 *   0516  corporate_entity_documents_tax (PR-02, baselined & frozen)
 *   13787 entity_public_story            (PR-04)
 *   13963 entity_public_address          (PR-06)
 *   13970 tax_obligation_generation      (PR-05)
 *   13980 media_attachment_outbox        (PR-07)
 *
 * 0520 (Treasury) is deliberately not replayed here — it belongs to the
 * treasury programme, and its per-category primary comment is a frozen
 * historical artifact, not a contract this PR re-proves.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const m = require("../../src/services/platform/migrator");

const PROGRAMME = [
  "0515_corporate_entity_rich.sql",
  "0516_corporate_entity_documents_tax.sql",
  "13787_entity_public_story.sql",
  "13963_entity_public_address.sql",
  "13970_tax_obligation_generation.sql",
  "13980_media_attachment_outbox.sql",
].map((f) => path.join(m.MIGRATIONS, "tenant", f));

const BASELINE = path.join(
  __dirname,
  "../../scripts/db/migration-idempotency-baseline.json",
);

/**
 * A pg client whose `public.schema_migration` is a Map rather than a table.
 *
 * It answers the queries applyTracked actually issues — ensureLedger's two
 * DDL statements, appliedSet's SELECT, the per-file BEGIN/COMMIT, the
 * migration SQL itself (prefixed with SET search_path) and the ledger
 * INSERT — and records enough about each to let the tests below say not
 * just "how many" but "which file, with which hash, and in what order".
 */
function ledgerClient() {
  const applied = new Map(); // scope -> Map(filename -> sha256)
  const out = {
    applied,
    ddl: [], // every migration-SQL execution, in order
    inserts: [], // every ledger INSERT's params, in order
    begins: 0,
    commits: 0,
    rollbacks: 0,
    failOnDdl: null, // 1-based index into `ddl` that throws (failure injection)
    async query(text, params) {
      if (/CREATE TABLE IF NOT EXISTS public\.schema_migration/.test(text)) {
        return { rows: [] }; // the table "exists" from the first call on
      }
      if (/ALTER TABLE public\.schema_migration ADD COLUMN IF NOT EXISTS sha256/.test(text)) {
        return { rows: [] };
      }
      if (/SELECT filename FROM public\.schema_migration WHERE scope=\$1/.test(text)) {
        const scope = params[0];
        const rows = [...(applied.get(scope) || [])].map(([filename]) => ({ filename }));
        return { rows };
      }
      if (/INSERT INTO public\.schema_migration\(scope, filename, sha256\)/.test(text)) {
        const [scope, filename, sha256] = params;
        if (!applied.has(scope)) applied.set(scope, new Map());
        applied.get(scope).set(filename, sha256);
        out.inserts.push({ scope, filename, sha256 });
        return { rows: [] };
      }
      if (/^\s*BEGIN\b/i.test(text)) {
        out.begins += 1;
        return { rows: [] };
      }
      if (/^\s*COMMIT\b/i.test(text)) {
        out.commits += 1;
        return { rows: [] };
      }
      if (/^\s*ROLLBACK\b/i.test(text)) {
        out.rollbacks += 1;
        return { rows: [] };
      }
      // Everything else is a migration file's SQL, prefixed with its
      // SET search_path — the thing a replay must prove runs exactly once.
      out.ddl.push(text);
      if (out.failOnDdl === out.ddl.length) {
        throw new Error(`injected failure on ddl #${out.ddl.length}`);
      }
      return { rows: [] };
    },
  };
  return out;
}

describe("migration replay — the corporate-entities programme (PR-10 / B.1)", () => {
  test("pass 1 applies every programme migration once, ascending, hashed into the ledger", async () => {
    const cli = ledgerClient();

    const applied = await m.applyTracked(cli, PROGRAMME, {
      scope: "live",
      searchPath: "live,public",
    });

    expect(applied).toBe(6);
    // Every file's SQL executed exactly once…
    expect(cli.ddl).toHaveLength(6);
    // …each inside its own transaction, with its ledger row (DATA 3.1:
    // the DDL and the row commit together — BEGIN < DDL < INSERT < COMMIT).
    expect(cli.begins).toBe(6);
    expect(cli.commits).toBe(6);
    expect(cli.inserts).toHaveLength(6);

    // Ascending order — the order a fresh tenant meets them in, and the
    // order the sorted file list guarantees.
    const names = cli.inserts.map((i) => i.filename);
    expect(names).toEqual([
      "tenant/0515_corporate_entity_rich.sql",
      "tenant/0516_corporate_entity_documents_tax.sql",
      "tenant/13787_entity_public_story.sql",
      "tenant/13963_entity_public_address.sql",
      "tenant/13970_tax_obligation_generation.sql",
      "tenant/13980_media_attachment_outbox.sql",
    ]);

    // The hash recorded is the hash of the bytes that ran — the content
    // drift check (WS-S4) is only as good as this being true.
    for (const file of PROGRAMME) {
      const key = path.relative(m.MIGRATIONS, file).split(path.sep).join("/");
      const row = cli.inserts.find((i) => i.filename === key);
      expect(row.sha256).toBe(m.hashFile(file));
    }
  });

  test("pass 2 applies nothing and executes no SQL — the ledger is the whole answer", async () => {
    const cli = ledgerClient();

    await m.applyTracked(cli, PROGRAMME, { scope: "live", searchPath: "live,public" });
    const ddlAfterFirst = cli.ddl.length;
    const insertsAfterFirst = cli.inserts.length;

    // CI applies the tenant set twice on purpose; a tenant upgraded on
    // Monday and again on Tuesday hits the same path. The second pass must
    // be a no-op: nothing applied, no file's SQL executed, no ledger row.
    const second = await m.applyTracked(cli, PROGRAMME, {
      scope: "live",
      searchPath: "live,public",
    });

    expect(second).toBe(0);
    expect(cli.ddl).toHaveLength(ddlAfterFirst);
    expect(cli.inserts).toHaveLength(insertsAfterFirst);
    // And a THIRD pass changes nothing either — idempotence is not a
    // two-data-point coincidence.
    const third = await m.applyTracked(cli, PROGRAMME, { scope: "live", searchPath: "live,public" });
    expect(third).toBe(0);
    expect(cli.ddl).toHaveLength(ddlAfterFirst);
  });

  test("live and sandbox scopes hold independent ledgers", async () => {
    const cli = ledgerClient();

    await m.applyTracked(cli, PROGRAMME, { scope: "live", searchPath: "live,public" });
    // The same database, the sandbox schema: a full replay of its own.
    const sandbox = await m.applyTracked(cli, PROGRAMME, {
      scope: "sandbox",
      searchPath: "sandbox,public",
    });

    expect(sandbox).toBe(6);
    expect(cli.inserts.filter((i) => i.scope === "sandbox")).toHaveLength(6);
    expect(cli.inserts.filter((i) => i.scope === "live")).toHaveLength(6);
    // …and the sandbox replay did not disturb the live ledger.
    const liveAgain = await m.applyTracked(cli, PROGRAMME, { scope: "live", searchPath: "live,public" });
    expect(liveAgain).toBe(0);
  });

  test("a file that fails part way leaves no ledger row, and ONLY that file re-runs", async () => {
    const cli = ledgerClient();
    // 13963 (4th in ascending order) fails mid-run.
    cli.failOnDdl = 4;

    await expect(
      m.applyTracked(cli, PROGRAMME, { scope: "live", searchPath: "live,public" }),
    ).rejects.toThrow(/13963_entity_public_address/);

    // Three files committed with their ledger rows; the fourth left nothing
    // behind — which is precisely why re-running it after the fix is safe.
    expect(cli.inserts.map((i) => i.filename)).toEqual([
      "tenant/0515_corporate_entity_rich.sql",
      "tenant/0516_corporate_entity_documents_tax.sql",
      "tenant/13787_entity_public_story.sql",
    ]);

    // The replay after the failure: the three committed files are skipped by
    // the ledger, and the three never-applied files run. SQL round-trips
    // across both passes: 3 + 1 (the attempt that failed) + 3 = 7 — the
    // failed file ran TWICE, in full, which is exactly why its statements
    // had to be idempotent. What never happens is a committed file running
    // again: 7, not 12.
    cli.failOnDdl = null;
    const replay = await m.applyTracked(cli, PROGRAMME, { scope: "live", searchPath: "live,public" });
    expect(replay).toBe(3);
    expect(cli.ddl).toHaveLength(7);
    expect(cli.inserts).toHaveLength(6);
  });
});

/* ── the idempotency gate's side of the bargain ─────────────────────────────*/

/**
 * The rule engine is not exported (the script is a CLI that calls
 * `process.exit`), so — like tests/unit/migration-idempotency.test.js — it is
 * loaded by reading the file and evaluating it with a stubbed exit, from a
 * mkdtempSync directory (CodeQL: a predictable name in the shared temp dir is
 * a symlink away from running someone else's code inside this process).
 */
function loadViolations() {
  const script = path.join(__dirname, "../../scripts/db/check-migration-idempotency.js");
  const src = fs
    .readFileSync(script, "utf8")
    .replace(/process\.exit\(main\(\)\);?\s*$/, "module.exports = { violations };");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "praxis-replay-"));
  const tmp = path.join(dir, "rules.js");
  fs.writeFileSync(tmp, src);
  const mod = require(tmp);
  fs.rmSync(dir, { recursive: true, force: true });
  return mod.violations;
}

describe("the programme migrations and the idempotency gate (PR-10 / B.1)", () => {
  const violations = loadViolations();
  const sha16 = (s) =>
    crypto.createHash("sha256").update(String(s).replace(/\r\n/g, "\n"), "utf8").digest("hex").slice(0, 16);

  test("the four post-baseline programme migrations are safe to run twice", () => {
    // 0515/0516 predate the gate and are grandfathered; these four are the
    // programme's own and had to pass the rules the day they landed. A
    // violation here is not a test failure — it is a migration that would
    // damage a database it re-runs against (a part-way failure, a
    // provision replay, CI's deliberate double-apply).
    for (const f of [
      "13787_entity_public_story.sql",
      "13963_entity_public_address.sql",
      "13970_tax_obligation_generation.sql",
      "13980_media_attachment_outbox.sql",
    ]) {
      const sql = fs.readFileSync(path.join(m.MIGRATIONS, "tenant", f), "utf8");
      const found = violations(sql);
      expect({ file: f, found }).toEqual({ file: f, found: [] });
    }
  });

  test("0515/0516 are baselined and frozen — their bytes have not moved", () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
    const files = baseline.files || {};

    // The grandfather split the programme relies on: the two pre-gate
    // migrations are frozen rather than rules-checked; the four above are
    // rules-checked rather than frozen.
    expect(Object.prototype.hasOwnProperty.call(files, "tenant/0515_corporate_entity_rich.sql")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(files, "tenant/0516_corporate_entity_documents_tax.sql")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(files, "tenant/13787_entity_public_story.sql")).toBe(false);

    // The freeze itself, asserted against today's bytes: an edited
    // baselined migration changes what a FRESH database gets and not what
    // an existing one has — the silent divergence the gate exists for.
    for (const f of ["0515_corporate_entity_rich.sql", "0516_corporate_entity_documents_tax.sql"]) {
      const sql = fs.readFileSync(path.join(m.MIGRATIONS, "tenant", f), "utf8");
      expect(files[`tenant/${f}`]).toBe(sha16(sql));
    }
  });
});
