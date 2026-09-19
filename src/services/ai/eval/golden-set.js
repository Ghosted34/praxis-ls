/**
 * The golden set — the questions the assistant has to keep getting right.
 *
 * ── WHAT BELONGS HERE ───────────────────────────────────────────────────────
 *
 * One case per BEHAVIOUR THE AUDIT PAID FOR, not a survey of the product. The
 * point of a golden set is that a regression in something already fixed shows
 * up as a named failure rather than as a vague sense that the assistant got
 * worse. So every case below cites the finding it defends, and a case with no
 * finding behind it does not belong — a set that grows to cover everything gets
 * slow, gets skipped, and stops defending anything.
 *
 * ── THE SEEDED FIGURES ARE PART OF THE CONTRACT ─────────────────────────────
 *
 * `A1_LARGE_RECEIVABLE` is ≥ 100,000,000 XAF on purpose. That is the audit's
 * own acceptance test for PR 1, and the threshold is not arbitrary: the bug was
 * a blanket `\d{9,}` blackout, so a figure needs nine digits before it
 * reproduces. A seven-digit receivable would pass whether or not the fix is
 * still in place, which is the worst kind of test — one that is green for the
 * wrong reason.
 *
 * The runner (`scripts/ai/eval.js`) is responsible for seeding these values
 * into the fixture tenant before it asks anything, and it asserts they are
 * present rather than assuming: a golden set graded against data that is not
 * there reports failures that say nothing about the assistant.
 */
"use strict";

/**
 * Nine digits, so the A1 blackout reproduces if it ever returns. Held as a
 * constant because the seeder and the expectation must be the same number —
 * two literals that drift is how this test starts lying.
 */
const A1_LARGE_RECEIVABLE = 102_500_000;

/** @type {Array<Record<string, unknown>>} */
const GOLDEN_SET = [
  // ── A1 · grounding integrity — the audit's named acceptance test ─────────
  {
    id: "a1-largest-receivable",
    finding: "A1",
    ask: "What is our largest outstanding receivable?",
    seed: { largestReceivableXaf: A1_LARGE_RECEIVABLE },
    reportsExactly: [A1_LARGE_RECEIVABLE],
    usesTools: ["list_client_invoices"],
    // The write surface must not be touched by a question.
    neverTools: ["create_client_invoice"],
  },
  {
    id: "a1-figure-survives-a-follow-up",
    finding: "A1,D3",
    ask: "And what was that figure again?",
    // The replay window is what makes this answerable; D3 widened it.
    followsOn: "a1-largest-receivable",
    reportsExactly: [A1_LARGE_RECEIVABLE],
  },

  // ── A2 · the OHADA boost must not fire on the English word "is" ──────────
  {
    id: "a2-non-accounting-question",
    finding: "A2",
    ask: "Which vehicle is due for service first?",
    usesTools: ["list_vehicles"],
    // A fleet question grounded on the accounting knowledge base is the
    // mis-fire; the KB's own name appearing in the answer is the symptom.
    forbids: ["OHADA"],
  },

  // ── A4 · a tenant answer is never grounded on this repository ────────────
  {
    id: "a4-no-codebase-in-a-tenant-answer",
    finding: "A4",
    ask: "How do I record a supplier invoice?",
    forbids: ["orchestrator.service", "src/modules", "node_modules"],
  },

  // ── B1 · an answer long enough to hit the old ceiling still completes ────
  {
    id: "b1-long-memo-is-complete",
    finding: "B1",
    ask: "Draft a full memo to the operations team covering this month's overdue files, what is blocking each one, and what you recommend we do about them.",
    mode: "draft",
    notTruncated: true,
    minChars: 1200,
  },

  // ── B6 · the style contract holds ────────────────────────────────────────
  {
    id: "b6-tabular-answer-is-a-table",
    finding: "B6",
    ask: "List our five largest outstanding client invoices with their amounts and due dates.",
    mode: "analyse",
    expectsTable: true,
    usesTools: ["list_client_invoices"],
  },
  {
    id: "b6-dates-are-unambiguous",
    finding: "B6",
    ask: "When is the next customs deadline, and what is it for?",
    // `style` covers it: an ambiguous dd/mm date is a style failure, because
    // `check-date-format.js` cannot reach a sentence the model composed.
  },

  // ── C1-C3 · "create anything" — the write contract, with the actor ───────
  {
    id: "c1-create-supplier",
    finding: "C1",
    ask: "Create a supplier called Atlantique Transit, contact Marie Ngono.",
    mode: "act",
    proposesWrite: ["create_supplier"],
    mentions: ["Atlantique Transit"],
  },
  {
    id: "c2-create-lead-carries-the-actor",
    finding: "C2",
    ask: "Add a lead for Cameroon Cocoa Exporters, they want groupage to Antwerp.",
    mode: "act",
    proposesWrite: ["create_lead"],
  },
  {
    id: "c3-create-purchase-request",
    finding: "C3",
    ask: "Raise a purchase request for two pallets of shrink wrap for the Douala warehouse.",
    mode: "act",
    proposesWrite: ["create_purchase_request"],
  },

  // ── D5/G1 · the composer's modes change the SHAPE of the answer ──────────
  {
    id: "d5-ask-mode-proposes-nothing",
    finding: "D5",
    ask: "How many open operation files do we have?",
    mode: "ask",
    // Ask is read-only: a count must never come back as a proposed write.
    proposesWrite: [],
    neverTools: ["create_operation_file"],
    usesTools: ["list_operation_files"],
  },

  // ── E3/F1 · a multi-hop question completes rather than timing out ───────
  {
    id: "e1-multi-hop-completes",
    finding: "E1",
    ask: "For the client with the most overdue invoices, tell me which operation files are open for them and what the total exposure is.",
    notTruncated: true,
    // Several reads in sequence — this is the shape that used to trip the
    // per-call cap and get misread as a transient failure.
    minTools: 2,
  },
];

/** Case ids must be unique — they key the results map in `gradeRun`. */
function assertWellFormed(cases = GOLDEN_SET) {
  const seen = new Set();
  const problems = [];
  for (const c of cases) {
    if (!c.id) problems.push("a case has no id");
    else if (seen.has(c.id)) problems.push(`duplicate case id: ${c.id}`);
    else seen.add(c.id);
    if (!c.ask) problems.push(`${c.id}: no question to ask`);
    if (!c.finding) problems.push(`${c.id}: no audit finding cited`);
    if (c.followsOn && !cases.some((p) => p.id === c.followsOn)) {
      problems.push(`${c.id}: followsOn names a case that is not in the set (${c.followsOn})`);
    }
  }
  return problems;
}

/** The findings this set currently defends, for the coverage gate. */
const findingsCovered = (cases = GOLDEN_SET) => [
  ...new Set(cases.flatMap((c) => String(c.finding || "").split(",").map((f) => f.trim()).filter(Boolean))),
];

module.exports = { GOLDEN_SET, A1_LARGE_RECEIVABLE, assertWellFormed, findingsCovered };
