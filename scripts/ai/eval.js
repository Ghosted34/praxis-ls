#!/usr/bin/env node
/**
 * The live eval pass — ask a real model the golden set against a real tenant.
 *
 *   node scripts/ai/eval.js --tenant=citenant           # run and report
 *   node scripts/ai/eval.js --tenant=citenant --json    # machine-readable
 *   node scripts/ai/eval.js --list                      # the set, no run
 *
 * ── WHAT THIS IS, AND WHAT THE GATE IS ──────────────────────────────────────
 *
 * Audit H1 asks for a repeatable eval, run in CI. The RULES are what CI gates
 * on — `tests/unit/ai-eval-grader.test.js` runs `eval/grade.js` against
 * recorded answers on every push, with no database and no vendor. This script
 * is the other half: it exercises the real orchestrator, against real seeded
 * rows, through a real model, and grades the answers with that same function.
 *
 * It is deliberately NOT a build gate, and that is a design decision rather
 * than an omission. It needs a provisioned tenant and a funded credential, and
 * a language model answers differently every time — so a build that goes red
 * because a model rephrased something is a build people learn to ignore. It
 * belongs where the other infrastructure-dependent checks live (see the SKIPS
 * header in `scripts/ci-local.js`): run before a model repoint (B3), after a
 * change to the prompt or the retrieval budgets, and on a schedule.
 *
 * ── IT ASSERTS ITS OWN FIXTURE FIRST ────────────────────────────────────────
 *
 * A golden set graded against data that is not there reports failures that say
 * nothing about the assistant — the classic way an eval becomes noise and then
 * gets switched off. So the seeded preconditions are checked before anything is
 * asked, and a missing fixture aborts rather than producing a red run.
 *
 * Exit code: 0 when every case passed, 1 on any failure or a missing fixture.
 */
"use strict";

const m = require("../../src/services/platform/migrator");
const orchestrator = require("../../src/services/ai/orchestrator.service");
const { buildExecutorMap } = require("../../src/services/ai/action-registrar");
const { GOLDEN_SET, A1_LARGE_RECEIVABLE, assertWellFormed } = require("../../src/services/ai/eval/golden-set");
const { gradeRun } = require("../../src/services/ai/eval/grade");

const argv = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const mm = s.match(/^--([^=]+)=(.*)$/);
    return mm ? [mm[1], mm[2]] : [s.replace(/^--/, ""), true];
  }),
);

/** Print the set and stop. Useful for review without any infrastructure. */
function listSet() {
  for (const c of GOLDEN_SET) {
    console.warn(`${c.id.padEnd(34)} [${c.finding}]  ${c.ask}`);
  }
  console.warn(`\n${GOLDEN_SET.length} case(s).`);
}

/**
 * The rows a case's expectations depend on.
 *
 * Read rather than written: this script does not seed, it VERIFIES. Seeding
 * from here would mean the eval could pass against data it invented for itself,
 * which measures nothing. The seed belongs in the tenant fixture, and the
 * A1 figure is asserted to be at least the audit's threshold because a
 * seven-digit receivable cannot reproduce a nine-digit blackout.
 */
async function checkFixture(client) {
  const problems = [];
  const { rows } = await client.query(
    "SELECT COALESCE(MAX(total_amount), 0) AS largest FROM client_invoice WHERE status <> 'PAID'",
  ).catch(() => ({ rows: [{ largest: 0 }] }));
  const largest = Number(rows[0] && rows[0].largest) || 0;
  if (largest < A1_LARGE_RECEIVABLE) {
    problems.push(
      `the largest unpaid client invoice is ${largest}, below the A1 threshold of ${A1_LARGE_RECEIVABLE}. ` +
        "Seed a receivable of at least that before running — a seven-digit figure cannot reproduce a nine-digit blackout.",
    );
  }
  return problems;
}

/** Ask one case, and shape the reply the way the grader expects it. */
async function runCase(client, user, registry, c, conversationId) {
  const out = await orchestrator.ask({
    client,
    user,
    registry,
    message: c.ask,
    mode: c.mode,
    conversationId: conversationId || undefined,
    allowed: ["normal"],
  });
  return {
    answer: out.answer || "",
    conversationId: out.conversation_id || null,
    // The trace records what was actually reached for; the action cards record
    // what was proposed and who it would run as.
    toolsUsed: (out.trace || [])
      .map((t) => (typeof t === "string" ? (t.match(/\b([a-z]+_[a-z_]+)\b/) || [])[1] : null))
      .filter(Boolean),
    writes: (out.actions || []).map((a) => ({
      actionKey: a.action_key,
      actorUserId: user.user_id,
    })),
  };
}

async function main() {
  const problems = assertWellFormed();
  if (problems.length) {
    console.error("The golden set is malformed:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  if (argv.list) return listSet();

  const slug = argv.tenant;
  if (!slug) {
    console.error("Usage: node scripts/ai/eval.js --tenant=<slug> [--json]\n" +
      "       node scripts/ai/eval.js --list");
    process.exit(1);
  }

  const client = m.client(m.tenantDbName(slug), { superuser: true });
  await client.connect();
  const results = {};
  try {
    await client.query("SET search_path = live, public");

    const fixtureProblems = await checkFixture(client);
    if (fixtureProblems.length) {
      console.error("Fixture is not ready — refusing to run:\n  " + fixtureProblems.join("\n  "));
      process.exit(1);
    }

    const { rows: users } = await client.query("SELECT user_id FROM app_user ORDER BY created_at LIMIT 1");
    if (!users.length) {
      console.error(`Tenant ${slug} has no users to run the eval as.`);
      process.exit(1);
    }
    const user = { user_id: users[0].user_id };
    const registry = buildExecutorMap();

    // Sequential, and a follow-up case reuses its parent's thread: the D3 case
    // is only meaningful inside the conversation that produced the figure.
    const threads = {};
    for (const c of GOLDEN_SET) {
      process.stderr.write(`· ${c.id} … `);
      try {
        // Sequential on purpose: a follow-up case reuses its parent's thread,
        // and asking a model twelve questions at once is not the shape a
        // conversation has.
        const r = await runCase(client, user, registry, c, c.followsOn ? threads[c.followsOn] : null);
        threads[c.id] = r.conversationId;
        results[c.id] = r;
        process.stderr.write("asked\n");
      } catch (err) {
        // A case that THREW is a failure, never a skip — `gradeRun` counts a
        // missing answer as failed, so recording the error keeps it honest.
        results[c.id] = { answer: "", error: err.message };
        process.stderr.write(`error: ${err.message}\n`);
      }
    }
  } finally {
    await client.end();
  }

  const run = gradeRun(GOLDEN_SET, results);
  if (argv.json) {
    // stdout, not console.log: the JSON is the output of this mode, and a
    // caller piping it must not have the progress lines (stderr) mixed in.
    process.stdout.write(`${JSON.stringify({ ...run, results }, null, 2)}\n`);
  } else {
    console.warn("");
    for (const c of run.cases) {
      if (c.passed) {
        console.warn(`  PASS  ${c.id}`);
      } else {
        console.warn(`  FAIL  ${c.id}`);
        for (const f of c.failures) console.warn(`          ${f.check}: ${f.detail}`);
      }
    }
    console.warn(`\n${run.passed}/${run.total} passed.`);
  }
  process.exit(run.failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
