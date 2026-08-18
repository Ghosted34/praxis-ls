"use strict";

/**
 * Every default GL account a posting service falls back to must be POSTABLE.
 *
 * WHY THIS FILE EXISTS. Seven call sites carried a hardcoded account as a JS
 * default parameter, and two of those accounts could not be posted to:
 *
 *   521  Banques locales        is_postable = false (9000:77) — a 3-digit
 *                               grouping whose leaves are 5211 / 5212
 *   671  Intérêts des emprunts  is_postable = false (9001) — a CHILDLESS leaf,
 *                               so the flag was simply wrong
 *
 * `journal_line.account_code` is `REFERENCES chart_of_accounts(code)`
 * (0220:56) and `assert_line_valid()` (0640:150) raises
 * `'account % is not postable (KB §23.3)'`. So régie issuance, cash-request
 * disbursal, cost tracking, proforma payments, loan drawdown/repayment and
 * bank/cheque/MoMo receipts ALL failed at the moment money moved — and only
 * then, because the defaults are reached exactly when the caller omits the
 * optional `treasury_coa` field, which is the normal case.
 *
 * The unit suite could not catch it: the code was a string in a JS default and
 * the flag lives in a SQL seed, so nothing compared the two. This file does the
 * comparison. It parses the seeds rather than talking to a database, so it runs
 * in the DB-free suite.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const SEEDS = path.join(REPO, "migrations", "seeds");

/**
 * Parse `chart_of_accounts` rows out of the seed files, honouring seed order.
 *
 * ORDER MATTERS AND IS THE SUBTLE PART. `9000_seed_coa.sql` has NO
 * `ON CONFLICT` clause and runs first (migrator sorts by filename); every later
 * seed is `ON CONFLICT (code) DO NOTHING`. So for any code present in 9000,
 * 9000's row is the one that survives — which is why 9001's `('521', …, true)`
 * does NOT make 521 postable. First writer wins.
 */
function chartOfAccounts() {
  const files = fs
    .readdirSync(SEEDS)
    .filter((f) => /^90\d\d.*\.sql$/.test(f))
    .sort();

  const ROW =
    /\(\s*'([0-9]+)'\s*,\s*('[^']*'|NULL)\s*,\s*'((?:[^']|'')*)'\s*,\s*'(?:(?:[^']|'')*)'\s*,\s*(\d)\s*,\s*'([DC])'\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/g;

  const accounts = new Map();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SEEDS, f), "utf8");
    // Only look at chart_of_accounts inserts, not other tables' tuples.
    const blocks = sql
      .split(/INSERT\s+INTO\s+/i)
      .filter((b) => /^chart_of_accounts/i.test(b));
    for (const block of blocks) {
      for (const m of block.matchAll(ROW)) {
        const [, code, parent, labelFr, , , postable, analytic] = m;
        if (accounts.has(code)) continue; // first writer wins — see above
        accounts.set(code, {
          code,
          parent: parent === "NULL" ? null : parent.slice(1, -1),
          label: labelFr.replace(/''/g, "'"),
          postable: postable === "true",
          analytic: analytic === "true",
          source: f,
        });
      }
    }
  }

  // Later corrections. 9095 flips 671 once it is established that it has no
  // children; applying it here keeps this model faithful to the applied schema.
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SEEDS, f), "utf8");
    for (const m of sql.matchAll(
      /UPDATE\s+chart_of_accounts\s+SET\s+is_postable\s*=\s*true\s+WHERE\s+code\s*=\s*'([0-9]+)'/gi,
    )) {
      const row = accounts.get(m[1]);
      if (row) row.postable = true;
    }
  }
  return accounts;
}

const COA = chartOfAccounts();

describe("the chart of accounts these tests reason about", () => {
  test("parsed a plausible chart from the seeds", () => {
    expect(COA.size).toBeGreaterThan(80);
    expect(COA.get("581")).toBeDefined();
  });

  test("521 is a non-postable grouping WITH children — the flag is correct", () => {
    // Documenting why the fix was "change the default", not "flip the flag".
    expect(COA.get("521").postable).toBe(false);
    const children = [...COA.values()].filter((a) => a.parent === "521");
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((c) => c.postable)).toBe(true);
  });

  test("671 is a childless leaf, so seed 9095 correctly makes it postable", () => {
    expect([...COA.values()].filter((a) => a.parent === "671")).toHaveLength(0);
    expect(COA.get("671").postable).toBe(true);
  });

  test("4731 requires an analytic dimension", () => {
    // Any line posted to it needs a dossier_id or assert_line_valid rejects it.
    expect(COA.get("4731").analytic).toBe(true);
  });
});

describe("shared/config/finance-accounts FALLBACK map", () => {
  const { FALLBACK } = require("../../src/shared/config/finance-accounts");

  test.each(Object.entries(FALLBACK))(
    "%s → %s is a real account",
    (role, code) => {
      expect(COA.get(code)).toBeDefined();
    },
  );

  test.each(Object.entries(FALLBACK))("%s → %s is POSTABLE", (role, code) => {
    // The invariant this whole file exists to protect.
    expect(COA.get(code).postable).toBe(true);
  });

  test("treasury is 5211, never the 521 grouping", () => {
    expect(FALLBACK.treasury).toBe("5211");
    expect(FALLBACK.treasury).not.toBe("521");
  });
});

describe("the seeded ('finance','accounts') settings row", () => {
  const sql = fs.readFileSync(
    path.join(SEEDS, "9095_seed_finance_accounts.sql"),
    "utf8",
  );
  const blocks = [...sql.matchAll(/'(\{[^']*\})'::jsonb/g)].map((m) =>
    JSON.parse(m[1]),
  );

  test("every jsonb literal in the seed parses", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  test("every seeded account is postable", () => {
    const bad = [];
    for (const block of blocks) {
      for (const [role, code] of Object.entries(block)) {
        // Reported as a list so a failure names the offending role and code,
        // which a bare toBe(true) would not.
        const row = COA.get(code);
        if (!row) bad.push(`${role} → ${code} (not in chart)`);
        else if (!row.postable)
          bad.push(`${role} → ${code} (${row.label} — NOT POSTABLE)`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("the INSERT and the merge-UPDATE agree on every shared role", () => {
    // They are two copies of the same map; a divergence would mean an existing
    // tenant and a fresh one get different accounts.
    const [insert, update] = blocks;
    for (const role of Object.keys(update)) {
      if (role in insert) expect(update[role]).toBe(insert[role]);
    }
  });

  test("the settings map and the JS fallback map do not disagree", () => {
    const { FALLBACK } = require("../../src/shared/config/finance-accounts");
    for (const [role, code] of Object.entries(blocks[0])) {
      if (role in FALLBACK) expect(FALLBACK[role]).toBe(code);
    }
  });
});

describe("no posting service falls back to a non-postable account", () => {
  /** Every .js under src/, so a new service cannot quietly reintroduce this. */
  function sourceFiles(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) sourceFiles(p, out);
      else if (e.name.endsWith(".js")) out.push(p);
    }
    return out;
  }

  const FILES = sourceFiles(path.join(REPO, "src"));

  test("scanned a meaningful number of files", () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  /**
   * Catch `somethingCoa = "1234"` / `someAccount = "1234"` defaults.
   *
   * Comments are stripped first so the explanatory prose in this fix — which
   * necessarily quotes "521" and "671" — is not mistaken for live code.
   */
  test("every hardcoded account default resolves to a postable account", () => {
    const offenders = [];
    for (const file of FILES) {
      const src = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

      for (const m of src.matchAll(
        /(\w*(?:Coa|Account|account))\s*=\s*"(\d{3,6})"/g,
      )) {
        const [, name, code] = m;
        const row = COA.get(code);
        if (!row)
          offenders.push(
            `${path.relative(REPO, file)}: ${name} = "${code}" (not in chart)`,
          );
        else if (!row.postable) {
          offenders.push(
            `${path.relative(REPO, file)}: ${name} = "${code}" (${row.label} — NOT POSTABLE)`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("account codes in ledger line literals are postable too", () => {
    // `{ account_code: "4731", … }` written inline rather than via a parameter.
    const offenders = [];
    for (const file of FILES) {
      const src = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

      for (const m of src.matchAll(/account_code:\s*"(\d{3,6})"/g)) {
        const code = m[1];
        const row = COA.get(code);
        if (!row)
          offenders.push(
            `${path.relative(REPO, file)}: account_code "${code}" (not in chart)`,
          );
        else if (!row.postable) {
          offenders.push(
            `${path.relative(REPO, file)}: account_code "${code}" (${row.label} — NOT POSTABLE)`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("régie policy accounts (seed 9094) are postable", () => {
  const sql = fs.readFileSync(
    path.join(SEEDS, "9094_seed_regie_policy.sql"),
    "utf8",
  );
  const blocks = [...sql.matchAll(/'(\{[^']*\})'::jsonb/g)].map((m) =>
    JSON.parse(m[1]),
  );

  test("every account in every régie settings block is postable", () => {
    const bad = [];
    for (const block of blocks) {
      for (const [role, code] of Object.entries(block.accounts || {})) {
        const row = COA.get(code);
        if (!row) bad.push(`régie ${role} → ${code} (not in chart)`);
        else if (!row.postable)
          bad.push(`régie ${role} → ${code} (${row.label} — NOT POSTABLE)`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("the régie treasury account is the 5211 leaf, not the 521 grouping", () => {
    expect(blocks[0].accounts.treasury).toBe("5211");
  });

  test("658 exists and is postable — KB §6.8 step 5 write-off", () => {
    // It was absent from the chart entirely before 9094; a write-off would have
    // failed on the FK and again on the trigger.
    expect(COA.get("658")).toBeDefined();
    expect(COA.get("658").postable).toBe(true);
  });

  test("the régie dossier account requires an analytic dimension", () => {
    expect(COA.get(blocks[0].accounts.dossier_mandant).analytic).toBe(true);
  });
});
