"use strict";

/**
 * The constraint-guard gate, and the properties of the migration that repairs
 * what the guard cost.
 *
 * ── WHY THESE, AND NOT A TEST OF THE SQL ──────────────────────────────────
 *
 * The repair itself needs a two-schema database and is exercised by CI's
 * `migrations` job via `check-schema-parity.js`. What CAN be pinned here is
 * everything that decides whether that job ever gets a chance to run: the
 * static gate's own behaviour, and the handful of textual properties of 13791
 * that make it safe to point at a production tenant.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const GATE = path.join(ROOT, "scripts/db/check-constraint-guards.js");
const BASELINE = path.join(ROOT, "scripts/db/constraint-guards.baseline.json");
const REPAIR = path.join(ROOT, "migrations/tenant/13791_sandbox_constraint_repair.sql");
const PROBE = path.join(ROOT, "migrations/tenant/99999_gate_probe.sql");

const run = () => {
  try {
    return { code: 0, out: execFileSync("node", [GATE], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
};

afterEach(() => fs.rmSync(PROBE, { force: true }));

describe("the constraint-guard gate", () => {
  it("passes on the tree as committed", () => {
    expect(run().code).toBe(0);
  });

  it("fails on a NEW migration that guards ADD CONSTRAINT on conname alone", () => {
    fs.writeFileSync(
      PROBE,
      `DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_probe') THEN\n` +
        `    ALTER TABLE t ADD CONSTRAINT chk_probe CHECK (x > 0);\n  END IF;\nEND $$;\n`,
    );
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("chk_probe");
  });

  it("accepts the schema-qualified form", () => {
    // The shape 13790 uses and the one the error message asks for. If this ever
    // starts failing, the gate is telling people to write something it rejects.
    fs.writeFileSync(
      PROBE,
      `DO $$\nBEGIN\n  IF NOT EXISTS (\n    SELECT 1 FROM pg_constraint c\n` +
        `      JOIN pg_class t ON t.oid = c.conrelid\n` +
        `      JOIN pg_namespace n ON n.oid = t.relnamespace\n` +
        `     WHERE c.conname = 'chk_probe' AND t.relname = 't'\n` +
        `       AND n.nspname = current_schema()\n  ) THEN\n` +
        `    ALTER TABLE t ADD CONSTRAINT chk_probe CHECK (x > 0);\n  END IF;\nEND $$;\n`,
    );
    expect(run().code).toBe(0);
  });

  it("does not flag a file for QUOTING the bad pattern in a comment", () => {
    // The first version of this gate flagged 13791 — the migration that fixes
    // the bug — because its header quotes the broken shape to explain it. A
    // gate that punishes documenting the defect teaches people to stop.
    fs.writeFileSync(
      PROBE,
      `-- Never write this:\n` +
        `--   IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'x')\n` +
        `--     THEN ALTER TABLE t ADD CONSTRAINT x CHECK (true);\n` +
        `SELECT 1;\n`,
    );
    expect(run().code).toBe(0);
  });

  it("freezes the historical offenders rather than pretending they are clean", () => {
    const { frozen } = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
    expect(frozen.length).toBeGreaterThan(60);
    // 12753 is the one whose missing CHECK was found first, and the reason the
    // audit happened at all.
    expect(frozen).toContain("migrations/tenant/12753_site_page_blocks.sql");
    // The repair must never be frozen: it does not carry the pattern.
    expect(frozen).not.toContain("migrations/tenant/13791_sandbox_constraint_repair.sql");
  });
});

describe("13791, the repair", () => {
  const sql = fs.readFileSync(REPAIR, "utf8");
  const body = sql.split("-- VERIFY")[0];

  it("never repairs live from itself", () => {
    // Without this the file would try to mirror live onto live on every
    // provision, and `live` is the reference — there is nothing to copy.
    expect(body).toMatch(/IF target = ref THEN\s*\n\s*RETURN;/);
  });

  it("retargets foreign keys to the schema being repaired", () => {
    // All four missing FKs resolved as `REFERENCES live.<table>`. Copied
    // verbatim into sandbox that is a foreign key from TEST data to PRODUCTION
    // rows — worse than the gap it would be closing.
    expect(body).toContain("replace(r.cdef, 'REFERENCES ' || ref || '.', 'REFERENCES ' || target || '.')");
  });

  it("refuses any definition still naming the reference schema", () => {
    // Fail closed. The retarget above is a string replace, so the assertion
    // after it is what turns "probably fine" into "cannot happen".
    expect(body).toMatch(/IF def ~ .*ref.*THEN[\s\S]*?CONTINUE;/);
  });

  it("falls back to NOT VALID instead of failing a deploy on test data", () => {
    // Sandbox was unconstrained for its whole life and may hold violating rows.
    expect(body).toMatch(/WHEN check_violation OR foreign_key_violation THEN/);
    expect(body).toContain("NOT VALID");
  });

  it("touches only CHECK and FOREIGN KEY constraints", () => {
    // Primary keys and uniques arrive with an index and were never subject to
    // the guard; recreating one here would mean inventing an index.
    expect(body).toMatch(/con\.contype IN \('c', 'f'\)/);
  });
});
