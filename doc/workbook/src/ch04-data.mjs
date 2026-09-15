import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 4 &mdash; DATA &amp; MIGRATIONS &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(4);
  const out = [];

  out.push(page("", F("THE DATABASE LAYER"), [
    band("04", "Data &amp; Migrations", "WEEK 2 &middot; <b>TEACH + LAB</b> &middot; ~6 HOURS &middot; <b>YOUR HOME TURF</b>"),
    lead("You are a data engineer. This is the chapter where your existing skill is worth the most &mdash; and where the gap between &ldquo;writes good SQL&rdquo; and &ldquo;writes good SQL inside a multi-tenant application&rdquo; is widest. Five CI gates guard this layer. By the end you will know why each exists."),

    h2("What is different here"),
    table("mst", ["In a data pipeline", "In this application"], [
      ["You own the warehouse; you can rebuild it", "313 migrations of client data that can never be recreated"],
      ["A failed job reruns tomorrow", "A failed migration blocks a deploy for every tenant at once"],
      ["Schema changes are coordinated with a few analysts", "Schema changes must work on N tenant schemas, some with data you have never seen"],
      ["<code>SELECT *</code> is fine", "A dropped column breaks a running API mid-deploy"],
      ["You control the query text", "Column names can arrive from an HTTP body"],
    ]),

    callout("<strong>That last row is the one to sit with.</strong> In a pipeline, the SQL is written by you and reviewed by a human. In an application with generic CRUD helpers, part of the SQL &mdash; the column list &mdash; is built from a JavaScript object whose keys came from the internet. That single fact produced the most serious defect in this repo's history, and it is the first thing we look at.", "red"),

    h2("The four things this chapter covers"),
    flow([
      { t: "SAFETY", b: "<code>ident()</code>, <code>assertWritable()</code>, the three-layer defence" },
      { t: "TRANSACTIONS", b: "<code>atomically()</code>, one owner, the SAVEPOINT probe" },
      { t: "MIGRATIONS", b: "Numbering, reversibility, idempotency, destructive" },
      { t: "PROSE", b: "How to write a migration a stranger can trust" },
    ]),
  ].join("\n")));

  // -------------------------------------------------------------- SEC H3
  out.push(page("", F("SEC H3 &mdash; THE THREE-LAYER DEFENCE"), [
    h1("SEC H3: When The Comment Was The Bug"),
    lead("Open <code>src/shared/db/query-helpers.js</code> and read the header. It is the best security lesson in the codebase, and it starts by admitting that the previous version of itself lied."),

    val("<strong>The old header said:</strong> &ldquo;Table/column names are always code-provided (never user input).&rdquo; <strong>That was not true &mdash; and the assertion is why nobody looked.</strong>"),

    h2("How the untruth happened"),
    lete([
      ["1", "<code>insertOne</code> and <code>updateOne</code> build their column list from <code>Object.keys(data)</code>."],
      ["2", "That is <b>safe for a module with a Zod validator</b>, because <code>z.object</code> strips unknown keys and the middleware reassigns <code>req.body = p.data</code>. So for 121 modules the claim held."],
      ["3", "But <b>ten modules were on <code>passthrough</code></b> &mdash; a pair of no-op middlewares. <code>makeController.create/update</code> handed <code>req.body</code> through untouched."],
      ["4", "For those ten, the keys of an attacker's JSON body became the column list of a live SQL statement."],
    ]),

    h2("The two defects that followed"),
    cards([
      { name: "MASS ASSIGNMENT", role: "ANY COLUMN WRITABLE", color: "#EF4444", items: [
        "A holder of MOD-67 <code>edit</code> could clear <code>killed_at</code> on a revoked session",
        "&mdash; resurrecting an admin session security staff believed they had terminated",
        "Or repoint a session's <code>user_id</code> entirely",
      ]},
      { name: "IDENTIFIER INJECTION", role: "A KEY <i>WAS</i> SQL", color: "#EF4444", items: [
        "Keys were concatenated with no quoting and no validation",
        "So a key was a SQL fragment, not a name",
        "Turning a tenant-admin grant into <b>arbitrary SQL</b> on the tenant database, under the shared application role",
      ]},
    ]),

    h2("The fix: three layers, because any one alone leaves a gap"),
    cmd(`const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function ident(name, ctx) {
  if (typeof name !== "string" || !IDENT_RE.test(name)) {
    throw new AppError("INVALID_FIELD",
      \`"\${String(name).slice(0, 40)}" is not a valid column name\`, 422,
      { [ctx || "body"]: [\`unrecognised field "\${String(name).slice(0, 40)}"\`] });
  }
  return \`"\${name}"\`;     // ← 2. quoted, AFTER being validated
}`),
    lete([
      ["L1", "<b>Validate</b> against a strict pattern and reject. This is what closes injection, and <b>it cannot be forgotten by a module author because it lives here</b>, not at 131 call sites."],
      ["L2", "<b>Quote</b>, so even a valid-but-reserved word behaves. Note the order: quoting alone is <i>not</i> sufficient, because a key containing a double quote would escape it. Pattern first, then quote, in one place that cannot be bypassed."],
      ["L3", "<b>Allow-list</b> &mdash; <code>makeRepo</code> may declare <code>writable</code>, which closes mass assignment <i>independently</i> of injection."],
    ]),

    callout("<strong>The regex is deliberately narrower than Postgres allows.</strong> No dollar signs, no unicode, no embedded quotes, 63 characters. Every column in this schema fits it. Anything that does not is either a mistake or an attack, and both should stop here. <b>When you write a validator, validate against what your system actually uses, not against what the underlying technology permits.</b>", "gold"),

    quiz("Why does <code>assertWritable</code> <i>reject</i> a non-writable field instead of silently dropping it?",
      ["Rejecting is faster",
       "Because a caller who sends <code>killed_at</code> should be told it is not writable, rather than getting a success response for a change that never happened",
       "Because Postgres would error anyway",
       "To make the audit log complete"],
      1,
      "Silent dropping produces the worst possible outcome: a 200 response describing a mutation that did not occur. The caller believes it worked. The comment names the precedent &mdash; &ldquo;silent dropping is how F-16's unknown-filter bug went unnoticed for so long&rdquo;. A filter that is silently ignored returns <i>more</i> rows than asked for, and looks like success."),
  ].join("\n")));

  // -------------------------------------------------------------- transactions
  out.push(page("", F("TRANSACTIONS"), [
    h1("One Owner of the Transaction Boundary"),
    lead("<code>src/shared/db/tx.js</code> is 90 lines and solves a problem most codebases never notice they have. It exists because two Critical audit findings shared a root cause: nothing wrapped anything."),

    h2("The findings"),
    bl([
      "<b>DATA 5.2</b> &mdash; the shared CRUD kit did not wrap its statements.",
      "<b>DATA 5.1</b> &mdash; nor did the inventory balance path.",
      "And no controller wrapped them either. <b>Verified: zero <code>transaction(</code> calls in any <code>*.controller.js</code></b>.",
      "Consequence: a business row could commit while its audit entry did not. A stock balance could move with no movement record.",
    ]),

    h2("Why a shared helper, not BEGIN/COMMIT at each site"),
    callout("<strong>Postgres has no nested transactions.</strong> A second <code>BEGIN</code> inside an open transaction is a warning and a no-op &mdash; and then the inner <code>COMMIT</code> <b>commits the outer transaction early</b>. That is far worse than the bug being fixed: the caller believes it still holds a transaction it can roll back, and it does not.", "red"),

    val("Detecting that reliably needs <strong>one owner of the boundary</strong>. Every path that opens a transaction goes through <code>atomically()</code>, so the depth counter is always accurate. A nested call runs inline and lets the outermost caller decide the outcome &mdash; which is the semantics callers actually expect."),

  ].join("\n")));

  out.push(page("", F("THE SAVEPOINT PROBE"), [
    h1("The SAVEPOINT Probe"),
    lead("The depth counter only knows about transactions opened through the helper. Here is how it copes with the 76 that are not."),

    cmd(`async function inForeignTransaction(client) {
  try {
    await client.query("SAVEPOINT praxis_tx_probe");
    await client.query("RELEASE SAVEPOINT praxis_tx_probe");
    return true;
  } catch {
    return false;   // 25P01 — "SAVEPOINT can only be used in transaction blocks"
  }
}`),
    lete([
      ["Q", "<b>The problem:</b> the depth counter only knows about transactions opened <i>through here</i>. There are <b>76 raw <code>client.query(\"BEGIN\")</code> sites</b> in <code>src/</code>. If one of those calls a function that uses this helper, the naive path breaks in exactly the way described above."],
      ["A", "<b>The probe:</b> <code>SAVEPOINT</code> is only legal inside a transaction block. Outside one, Postgres raises <code>25P01</code>. So attempting one is a <b>reliable, one-round-trip test</b> for &ldquo;am I already inside someone else's transaction?&rdquo; The savepoint is released immediately and changes nothing."],
      ["C", "<b>The cost:</b> one round-trip on write paths that were already doing several. Worth it, because it makes the helper <b>safe to call from anywhere</b> &mdash; and that property is what lets the 76 raw sites be converted <i>gradually</i> rather than in one risky sweep."],
    ]),

    callout("<strong>That last point is a lesson about changing large systems.</strong> The pure fix is &ldquo;convert all 76 sites&rdquo; &mdash; one enormous, unreviewable, all-or-nothing pull request. Instead, the helper was made safe in the presence of the old pattern, so the migration can happen one site at a time, each independently reviewable and revertible. <b>Design your fix so the transition can be incremental,</b> and you will actually finish it.", "green"),

    h2("Also note: a <code>Symbol</code>, not a string key"),
    cmd(`const DEPTH = Symbol.for("praxis.tx.depth");`),
    bl([
      "Pooled clients are long-lived and shared across requests.",
      "A string property like <code>client.__txDepth</code> risks collision with <code>pg</code> internals or another library.",
      "<code>Symbol.for</code> keeps it in the global registry, so the same symbol resolves even across module instances.",
    ]),

    quiz("Your service calls <code>atomically()</code> and inside it calls another service that also calls <code>atomically()</code>. What happens?",
      ["Two transactions; the inner one commits first",
       "The inner call sees depth > 0, runs inline without BEGIN/COMMIT, and the outermost caller decides commit or rollback for everything",
       "An error is thrown to prevent nesting",
       "A SAVEPOINT is created for the inner call"],
      1,
      "Nested calls join the outer transaction. A throw anywhere propagates and the outermost handler rolls everything back &mdash; which is what a caller composing two services actually wants. The comment notes SAVEPOINTs would enable genuine partial rollback and are the right upgrade <i>if a caller ever needs it</i>; nothing does today, and a savepoint per nested call costs a round-trip each."),
  ].join("\n")));

  // -------------------------------------------------------------- migrations
  out.push(page("", F("MIGRATIONS &mdash; FIVE GATES"), [
    h1("Migrations, and Their Five Gates"),
    lead("313 migrations, applied in order, to every tenant schema. Five separate CI gates check them before a human even reviews. Here is what each one wants from you."),

    table("mst", ["Gate", "Script", "What it enforces"], [
      ["<b>Numbering</b>", "<code>check-migration-numbers.js</code>", "Filenames carry a unique, ordered number. Two engineers cannot both claim <code>00314</code> and have the ordering depend on who merged first."],
      ["<b>Reversibility</b>", "<code>check-migration-reversibility.js</code>", "Every migration declares how to undo itself &mdash; a <code>-- DOWN</code> block, even if only to state what would be lost."],
      ["<b>Idempotency</b>", "<code>check-migration-idempotency.js</code>", "Re-running must not fail. <code>IF NOT EXISTS</code>, <code>IF EXISTS</code>, guarded inserts. Half-applied migrations happen, and the recovery path is to run it again."],
      ["<b>Destructive</b>", "<code>check-destructive-migrations.js</code>", "A <code>DROP</code>, a <code>TRUNCATE</code>, a narrowing <code>ALTER TYPE</code> must be <b>explicitly declared</b>, so nobody deletes a column by accident during review."],
      ["<b>Schema drift</b>", "<code>check-schema-drift.js</code>", "The schema the migrations produce matches the schema the code expects. Paired with <code>check-query-columns.js</code>, which verifies every column named in a query exists."],
    ]),

    callout("<strong><code>check-query-columns.js</code> is the gate that would have caught the <code>client_type</code> bug from Chapter 3.</strong> The convert path queried a column that did not exist; the unit test mocked the boundary and passed; production returned 42703 for every conversion. A gate that reads your SQL and checks the columns against the real schema catches that class of bug without needing anyone to write a test for it.", "green"),

  ].join("\n")));

  out.push(page("", F("MIGRATIONS &mdash; THE WORKFLOW"), [
    h1("The Migration Workflow"),
    lead("Five gates, run in the order you will actually meet them."),

    cmd(`# 1. Create the file. Numbering convention: check the highest existing number.
ls migrations/tenant/ | sort | tail -3

# 2. Write it (see the next page for the house prose style).

# 3. Apply locally
npm run db:migrate:platform      # platform schema
npm run db:migrate:tenants       # every tenant schema

# 4. Run the gates before you even think about a PR
node scripts/db/check-migration-numbers.js
node scripts/db/check-migration-reversibility.js
npm run db:check:idempotency
node scripts/db/check-destructive-migrations.js
npm run db:check:columns

# 5. Or just run them all
npm run ci:backend`),

    h2("Platform vs tenant migrations"),
    stack([
      ["<code>migrations/platform/</code>", "The JBS-owned schema: the tenant registry, error events, feature flags. Applied once."],
      ["<code>migrations/tenant/</code>", "The per-client schema. Applied to <b>every tenant schema</b>, including ones provisioned next year. Your migration must work on a brand-new empty schema <i>and</i> on a three-year-old one full of data."],
    ]),

    quiz("Why must a tenant migration be idempotent when the migration runner already tracks which have been applied?",
      ["It doesn't really; the gate is over-cautious",
       "Because the tracking row and the DDL are not always committed together — an interrupted run can leave a migration half-applied and unrecorded, and the only safe recovery is to run it again",
       "Because Postgres re-runs migrations automatically",
       "To support rollbacks"],
      1,
      "Anything that can be interrupted &mdash; a killed container, a network partition, a statement timeout &mdash; can leave you between states. If re-running is safe, recovery is trivial and boring. If it is not, recovery is a human writing ad-hoc SQL against a client's production database at midnight, which is where real data loss comes from."),
  ].join("\n")));

  // -------------------------------------------------------------- prose
  out.push(page("", F("HOW TO WRITE A MIGRATION"), [
    h1("The House Migration Style"),
    lead("This is a JBS Praxis standard, and it is not optional. A migration is the one artefact that a stranger will read years later, under pressure, trying to work out whether they can undo it. Open <code>migrations/tenant/12743_hr_contract_doc_number.sql</code> &mdash; this is the model."),

    h2("The five required sections"),
    lete([
      ["1", "<b>Banner comment</b> &mdash; what this migration does, in one line."],
      ["2", "<b><code>WHAT WAS WRONG</code></b> &mdash; the real symptom, not the abstract problem. In the example: contracts printed a document number derived as <code>String(id).slice(0,8)</code>."],
      ["3", "<b><code>WHY A COLUMN AND NOT A DERIVATION</code></b> &mdash; the alternative you rejected, and why. Here: a document number is <i>allocated once and quoted in letters</i>; deriving it renumbers the document on every render."],
      ["4", "<b>The nullability reasoning</b> &mdash; why nullable with a partial unique index, rather than <code>NOT NULL</code> with a backfill. Because backfilling would <b>invent a reference nobody was ever given</b>."],
      ["5", "<b><code>COMMENT ON COLUMN</code></b>, then a commented <b><code>-- DOWN</code></b> block stating exactly what is lost if you reverse it."],
    ]),

    cmd(`-- 00314_add_lead_score.sql
-- Adds a persisted lead score to the sales lead record.
--
-- WHAT WAS WRONG
--   The pipeline board sorted leads by a score computed in the browser from
--   whatever fields happened to be loaded. Two users with different column
--   sets saw different orderings of the same board, and neither ordering
--   survived a page refresh.
--
-- WHY A COLUMN AND NOT A DERIVATION
--   The score is an input to a human decision that gets recorded elsewhere
--   ("we prioritised this lead on Tuesday"). A derived score changes silently
--   when the formula changes, which rewrites the reason for a past decision.
--   Storing it means the score that drove a decision is still visible after
--   the model is retuned.
--
-- NULLABLE, NOT DEFAULTED
--   A lead scored before this column existed has no score, and 0 is not the
--   same as "unscored" — 0 would sort it to the bottom as though it had been
--   assessed and rejected. Nullable, and the board sorts NULLs last.

ALTER TABLE lead ADD COLUMN IF NOT EXISTS score integer;

COMMENT ON COLUMN lead.score IS
  'Prioritisation score at the time of assessment. NULL = never scored. '
  'Deliberately persisted, not derived: see migration header.';

-- DOWN
--   ALTER TABLE lead DROP COLUMN score;
--   LOSES: every historical score, and therefore the ability to explain why
--   any past prioritisation decision was made. Not recoverable from backups
--   without a full restore.`),

    callout("<strong>The <code>-- DOWN</code> block is commented out on purpose.</strong> It is documentation of the reversal, not an executable rollback. Production is forward-only: you fix a bad migration with a <i>new</i> migration. The block exists so that the person considering the reversal knows the cost before they start &mdash; and &ldquo;LOSES: …&rdquo; is the most important line in the file.", "gold"),

    ex("Write the header before the SQL", "20 min",
      "<p>You are adding a <code>closed_at timestamptz</code> to a support ticket table. Write the <code>WHAT WAS WRONG</code> and <code>WHY A COLUMN AND NOT A DERIVATION</code> sections <b>before</b> writing any SQL. If you cannot fill in section 3 convincingly, that is a signal &mdash; say what it is a signal of.</p>",
      "WHAT WAS WRONG: … / WHY A COLUMN: … / If I can't justify it, that means …"),
  ].join("\n")));

  // -------------------------------------------------------------- lab
  out.push(page("", F("LAB 4 &mdash; BREAK IT ON PURPOSE"), [
    band("L4", "Lab &mdash; Break Each Gate On Purpose", "WEEK 2 &middot; <b>HANDS ON</b> &middot; ~90 MIN &middot; ON A SCRATCH BRANCH", "lab"),
    lead("The fastest way to trust a gate is to watch it catch you. You will deliberately write five bad migrations, confirm each gate fires, then throw them all away. <b>Do this on a scratch branch and do not commit.</b>"),

    h2("Setup"),
    cmd(`git status                        # must be clean
git checkout -b scratch/gate-lab   # local only, never pushed`),

    h2("The five breakages"),
    rgroup("4.1", "Numbering", [
      "Copy an existing migration and give it a number that already exists.",
      "Run <code>node scripts/db/check-migration-numbers.js</code>.",
      "<b>Record the exact error message.</b>",
    ]),
    rgroup("4.2", "Reversibility", [
      "Write a valid <code>ALTER TABLE … ADD COLUMN</code> with <b>no</b> <code>-- DOWN</code> block.",
      "Run <code>node scripts/db/check-migration-reversibility.js</code>.",
      "Note what minimum content satisfies it.",
    ]),
    rgroup("4.3", "Idempotency", [
      "Write <code>ALTER TABLE lead ADD COLUMN scratch_col text;</code> &mdash; no <code>IF NOT EXISTS</code>.",
      "Run <code>npm run db:check:idempotency</code>.",
      "Fix it and confirm it passes.",
    ]),
    rgroup("4.4", "Destructive", [
      "Write a <code>DROP COLUMN</code> with no declaration.",
      "Run <code>node scripts/db/check-destructive-migrations.js</code>.",
      "Find out from the script's source how a legitimate drop is declared.",
    ]),
    rgroup("4.5", "Query columns", [
      "In any repo file, add <code>SELECT nonexistent_col FROM lead</code>.",
      "Run <code>npm run db:check:columns</code>.",
      "Then run <code>npm run db:check:columns:report</code> and note the difference.",
    ]),

    ex("The gate report", "30 min",
      "<p>For each of the five gates: paste the error message it produced, and rate how quickly a new engineer could act on it (1 = baffling, 5 = tells me exactly what to do). Then pick the <b>worst</b> one and write the message you would replace it with.</p>",
      "4.1 [ /5]: … 4.2 [ /5]: … 4.3 [ /5]: … 4.4 [ /5]: … 4.5 [ /5]: … / Worst was …, I would say: …"),

    callout("<strong>That last exercise is real work, not a drill.</strong> If you find a gate whose message is genuinely unhelpful, improving it is an excellent first pull request &mdash; small, safe, obviously valuable, and it makes you the person who improved the tool everyone uses. Mention it at Gate 2.", "green"),

    h2("Clean up"),
    cmd(`git checkout -- .
git clean -fd migrations/
git checkout arena/01a029d1-praxis-ls
git branch -D scratch/gate-lab`),
  ].join("\n")));

  // -------------------------------------------------------------- real migration
  out.push(page("", F("LAB 4B &mdash; A REAL MIGRATION"), [
    band("L4B", "Lab &mdash; Ship A Real Migration", "WEEK 2 &middot; <b>HANDS ON</b> &middot; ~60 MIN &middot; THIS ONE YOU KEEP", "lab"),
    lead("Chapter 5 builds a module, and that module needs a table. Write it now, to the house standard, and get it through all five gates. This is the first artefact of your graduation PR."),

    h2("The feature"),
    val("<strong>Onboarding Task.</strong> When a new client is signed, the team runs a checklist of onboarding tasks. Each task belongs to a client, has a title, an owner, a due date, a status (<code>PENDING</code> &rarr; <code>IN_PROGRESS</code> &rarr; <code>DONE</code>, or <code>CANCELLED</code>), and optional notes. This is a small, real, self-contained feature &mdash; and one this workbook's own subject matter cares about, since Chapter 13 is client onboarding."),

    h2("Requirements"),
    req([
      "Table <code>onboarding_task</code> in the <b>tenant</b> schema.",
      "A UUID primary key, defaulted &mdash; match the convention other tables use.",
      "<code>client_id</code> referencing the client master, with a considered <code>ON DELETE</code> behaviour.",
      "<code>title text NOT NULL</code>, with a check that it is not blank.",
      "<code>status</code> with a default of <code>PENDING</code> and a constraint restricting it to the four values.",
      "<code>owner_user_id</code> nullable &mdash; a task can exist before it is assigned.",
      "<code>due_date date</code> nullable, <code>notes text</code> nullable.",
      "<code>created_at</code> and <code>updated_at</code>, defaulted, matching the house pattern.",
      "An index on the column your list screen will filter by most.",
      "<code>COMMENT ON</code> the table and on at least two columns.",
      "A full header with all five prose sections.",
      "A commented <code>-- DOWN</code> block naming exactly what is lost.",
    ]),

    callout("<strong>Copy the conventions, do not invent them.</strong> Before writing a line, open three existing tenant migrations and note: how UUIDs are defaulted, how timestamps are named and defaulted, how check constraints are named, and whether they use <code>text</code> or <code>varchar</code>. <b>Consistency with the codebase beats your personal preference every time</b> &mdash; and reviewers will say so.", "gold"),

    h2("Verify"),
    cmd(`npm run db:migrate:tenants
npm run ci:backend

# Then confirm the table is really there, in the right schema:
psql "$DATABASE_URL" -c "\\d smartls.onboarding_task"`),

    ex("Justify three decisions", "20 min",
      "<p>Write down: (1) which <code>ON DELETE</code> you chose for <code>client_id</code> and what happens to tasks when a client is deleted; (2) whether <code>status</code> is a check constraint or a lookup table, and why; (3) which column you indexed and what query you expect it to serve. For each, name the alternative you rejected.</p>",
      "1. ON DELETE … because … (rejected: …) / 2. … / 3. …"),

    quiz("You chose <code>ON DELETE CASCADE</code> for <code>client_id</code>. What have you also decided?",
      ["Nothing — it just tidies up",
       "That deleting a client silently destroys the audit trail of their onboarding, with no record that the tasks existed",
       "That clients can never be deleted",
       "That the tasks move to another client"],
      1,
      "CASCADE is a decision about history, disguised as a housekeeping convenience. In a system with an audit obligation, <code>RESTRICT</code> (forcing an explicit decision) or a soft-delete column is usually right. There is no universally correct answer &mdash; the point is that you make the choice knowingly and write it in the migration header."),
  ].join("\n")));

  return out;
}
