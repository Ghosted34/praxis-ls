"use strict";
/**
 * EVERY TEST FILE THE GUIDE NAMES EXISTS, OR SAYS WHERE IT WENT.
 *
 * ── WHY THIS IS A GATE AND NOT A CHECKLIST ──────────────────────────────────
 *
 * `SMART_MAIL_ENGINEERING_GUIDE.md` names about thirty test files by filename —
 * §3.7's table and each chapter's own test plan. Nothing enforced them, and the
 * cost of that came due twice:
 *
 *   · §17 (fourth sweep) found `mail-search.test.js` and
 *     `mail-shared-inbox.test.js` had never been written. Both chapters read as
 *     complete without them, and writing them turned up two production defects
 *     — a search operator that silently did nothing, and four triage writes
 *     leaking through `RETURNING *`.
 *   · §18 (fifth sweep) asked the same question of the WHOLE guide and found
 *     ten more absent filenames. Nine were naming mismatches — the behaviour is
 *     covered, under another name — and one, `mail-model-backfill.test.js`, was
 *     a real gap on the migration that moved every existing message into the
 *     new three-table model.
 *
 * Nine false alarms and one real one, indistinguishable by reading. That is the
 * whole argument for this file: the expensive part was never writing the tests,
 * it was working out which of the ten mattered, and doing it twice.
 *
 * ── THE TWO WAYS TO SATISFY IT ──────────────────────────────────────────────
 *
 * Write the file, or map the name to the file that covers it. A mapping is a
 * claim someone made once and it is checked: the target must exist. What the
 * gate refuses is the third option — a name in the plan of record that
 * corresponds to nothing, which reads as a gap for as long as nobody checks.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const GUIDE = path.join(ROOT, "doc", "SMART_MAIL_ENGINEERING_GUIDE.md");

/**
 * Names the guide uses that are covered somewhere else, and where.
 *
 * Each was verified by reading the target, not by matching the subject line.
 * Adding a row here is a statement that the behaviour the guide asked for is
 * actually asserted in the file named — if it is not, this map is the lie
 * rather than the guide.
 */
const COVERED_ELSEWHERE = {
  // §5.9's split-inbox classifier: the known-party override, a tenant regex
  // that throws, the unknown-sender residue.
  "mail-stream.test.js": "tests/unit/mail-threading.test.js",
  // The mini-language parser, end to end into the SQL that reaches the driver.
  "mail-search-parse.test.js": "tests/integration/mail-search.test.js",
  // The undo race, the idempotency key, the retry plan.
  "mail-send-queue.test.js": "tests/unit/mail-outbox.test.js",
  // §7's claim verbatim: ingest writes a suggestion and never sets entity_ref
  // while auto-accept is off.
  "mail-binding.test.js": "tests/unit/mail-binding-suggest-only.test.js",
  // §3.7's outbound-HTML row — 61 tests including the 102 KB clip threshold and
  // the plain-text part. Recorded in the audit at §11.2.
  "mail-html-serializer.test.js": "tests/unit/mail-compose.test.js",
  // The notes panel and its mention pre-flight are one component and one test.
  "notes-tab.test.tsx": "client/src/features/comms/inbox/work/notes.test.tsx",
  "mention-picker.test.tsx": "client/src/features/comms/inbox/work/notes.test.tsx",
  // The drawer is rendered and asserted inside the work-rail suite.
  "dossier-drawer.test.tsx": "client/src/features/comms/inbox/work/work.test.tsx",
  // The signature screen goes through the per-screen sweep, which renders it in
  // all four states and runs axe over each.
  "signature-profile.test.tsx": "client/src/features/screens.axe.test.tsx",
};

/** Every `*.test.js|ts|tsx` filename the guide mentions. */
function namedInGuide() {
  const md = fs.readFileSync(GUIDE, "utf8");
  const found = new Set();
  // `tsx` BEFORE `ts`: alternation is first-match-wins, so `js|ts|tsx` clips
  // every `.tsx` name to `.ts` and then reports four client tests as missing
  // that are named right there in the guide. The first draft of this file did
  // exactly that, which is a small demonstration of why the gate exists.
  const re = /[A-Za-z0-9_.-]+\.(?:test|spec)\.(?:tsx|ts|js)\b/g;
  let m;
  while ((m = re.exec(md))) found.add(m[0]);
  return [...found].sort();
}

/** Basenames present anywhere under tests/ or client/src/. */
function inTree() {
  const seen = new Map();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        walk(p);
      } else if (/\.(test|spec)\.(js|ts|tsx)$/.test(e.name)) {
        seen.set(e.name, path.relative(ROOT, p).replace(/\\/g, "/"));
      }
    }
  };
  walk(path.join(ROOT, "tests"));
  walk(path.join(ROOT, "client", "src"));
  return seen;
}

const NAMED = namedInGuide();
const TREE = inTree();

describe("the guide's test plan is a manifest, not a wish", () => {
  test("the guide still names a plausible number of test files", () => {
    // If the scrape ever silently matches nothing, every assertion below
    // passes vacuously — which is the failure mode this whole file is about.
    expect(NAMED.length).toBeGreaterThan(20);
  });

  test("EVERY NAMED TEST FILE EXISTS, OR IS MAPPED TO THE ONE THAT COVERS IT", () => {
    const unaccounted = NAMED.filter(
      (n) => !TREE.has(n) && !Object.hasOwn(COVERED_ELSEWHERE, n),
    );
    expect(unaccounted).toEqual([]);
  });

  test("every mapping points at a file that is really there", () => {
    const broken = Object.entries(COVERED_ELSEWHERE)
      .filter(([, target]) => !fs.existsSync(path.join(ROOT, target)))
      .map(([name, target]) => `${name} -> ${target}`);
    expect(broken).toEqual([]);
  });

  test("nothing is mapped that has since been written under its own name", () => {
    // A mapping that outlives its reason sends the next reader to the wrong
    // file. If someone writes `mail-stream.test.js`, the row must go.
    const stale = Object.keys(COVERED_ELSEWHERE).filter((n) => TREE.has(n));
    expect(stale).toEqual([]);
  });

  test("nothing is mapped that the guide no longer names", () => {
    const orphaned = Object.keys(COVERED_ELSEWHERE).filter((n) => !NAMED.includes(n));
    expect(orphaned).toEqual([]);
  });

  test("the mapping list can only shrink", () => {
    // Same ratchet as every other allowance in this directory: it exists so
    // names get reconciled, not so new plans can be written against files that
    // will not be created.
    expect(Object.keys(COVERED_ELSEWHERE)).toHaveLength(9);
  });
});

describe("the one that was a real gap", () => {
  test("10731's backfill has a test, and it is DB-backed", () => {
    // §5.9 named `mail-model-backfill.test.js` and it did not exist — the only
    // one of the ten §18 triaged that was not a naming mismatch. It is the sole
    // test of the migration that moved every existing message into
    // email_thread / email_message / email_message_state.
    const file = path.join(ROOT, "tests/integration/mail-model-backfill.test.js");
    expect(fs.existsSync(file)).toBe(true);
    const src = fs.readFileSync(file, "utf8");
    // It must self-skip rather than pass without a database — a green run on a
    // machine with no DB would put this straight back where it was.
    expect(src).toMatch(/process\.env\.DATABASE_URL/);
    expect(src).toMatch(/describe\.skip/);
    // And it must roll back: it runs in the same pass as every other
    // integration suite, against the tenant DB they all share.
    expect(src).toMatch(/ROLLBACK/);
  });

  test("CI fails if that suite silently stops running", () => {
    const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yaml"), "utf8");
    expect(ci).toMatch(/mail-model-backfill\.test\.js/);
  });
});
