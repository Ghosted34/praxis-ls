/**
 * Drafting an employment contract (MOD-12 / 0700).
 *
 * ── WHAT THE MODEL IS AND IS NOT ASKED TO DO ───────────────────────────────
 *
 * It is asked to WRITE, not to DECIDE. Every term that binds either party —
 * the salary, the start date, the probation length, the notice period, the
 * job title, the entity — is passed in and echoed back verbatim. The model's
 * job is the prose around them: the clauses, the ordering, the register.
 *
 * That split is the whole design. A model that "adjusts" a salary band or
 * rounds a notice period has invented a term the employer never agreed, on a
 * document the employer will sign. So the terms go into the prompt as facts,
 * `shape()` overwrites whatever came back with the same facts, and the caller
 * stores those columns from its own input rather than from the draft.
 *
 * ── GROUNDED IN THE TENANT'S OWN HANDBOOK ──────────────────────────────────
 *
 * The SOP titles are passed in so the contract can refer to the documents the
 * employee is actually given ("as set out in the Staff Handbook"), rather than
 * inventing policies. Titles only — the bodies live in the vault as PDFs and
 * feeding them in would cost a great deal of context to produce a contract that
 * restates the handbook instead of referring to it.
 *
 * ── IT NEVER THROWS ────────────────────────────────────────────────────────
 *
 * A template draft is a real, editable contract that no model saw. An HR
 * manager with no AI vendor configured must still get a document to edit —
 * failing here would mean the feature simply does not exist for them — and the
 * caller records WHICH produced it so nobody signs a template believing a model
 * reviewed it.
 */
"use strict";

const llm = require("../../../services/ai/llm.service");
const { logger } = require("../../../config/logger");

/** Cameroon's statutory default. A tenant's own figure always wins. */
const DEFAULT_NOTICE_DAYS = 30;

const money = (v) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

const KIND_LABEL = {
  OFFER_LETTER: "offer letter",
  EMPLOYMENT: "employment contract",
  CONFIRMATION: "confirmation of employment letter",
  TERMINATION: "termination letter",
};

/** The facts, in one place, so the prompt and the fallback cannot disagree. */
function terms(input = {}) {
  return {
    kind: input.kind || "EMPLOYMENT",
    employee_name: input.employee_name || "the employee",
    job_title: input.job_title || null,
    department: input.department || null,
    entity_name: input.entity_name || null,
    entity_country: input.entity_country || null,
    effective_on: input.effective_on || null,
    end_on: input.end_on || null,
    gross_salary: money(input.gross_salary),
    salary_currency: input.salary_currency || "XAF",
    probation_months: input.probation_months ?? null,
    notice_days: input.notice_days ?? DEFAULT_NOTICE_DAYS,
    working_hours: input.working_hours || null,
    place_of_work: input.place_of_work || null,
    sop_titles: (input.sop_titles || []).filter(Boolean).slice(0, 12),
  };
}

function promptMessages(t) {
  const facts = [
    `Document type: ${KIND_LABEL[t.kind] || "employment contract"}`,
    `Employer: ${t.entity_name || "the employer"}${t.entity_country ? ` (${t.entity_country})` : ""}`,
    `Employee: ${t.employee_name}`,
    t.job_title ? `Job title: ${t.job_title}` : null,
    t.department ? `Department: ${t.department}` : null,
    t.effective_on ? `Start date: ${t.effective_on}` : null,
    t.end_on ? `Fixed term ending: ${t.end_on}` : "Term: indefinite",
    t.gross_salary !== null ? `Gross monthly salary: ${t.gross_salary} ${t.salary_currency}` : null,
    t.probation_months ? `Probation: ${t.probation_months} month(s)` : null,
    `Notice period: ${t.notice_days} days`,
    t.working_hours ? `Working hours: ${t.working_hours}` : null,
    t.place_of_work ? `Place of work: ${t.place_of_work}` : null,
    t.sop_titles.length ? `Company policies the employee is bound by: ${t.sop_titles.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "You draft employment documents for an employer in the OHADA/CEMAC region (Cameroon labour law).",
        "",
        "Write the document body as MARKDOWN. Use `##` for clause headings and numbered or plain paragraphs beneath them.",
        "",
        "RULES, in order of importance:",
        "1. Every figure, date and name given to you is a term the parties have agreed. Reproduce them EXACTLY. Never round, adjust, convert or omit one, and never introduce a term that was not given to you.",
        "2. Where a fact was not given, do not invent it and do not leave a blank line — omit the clause entirely. A contract with a fabricated clause is worse than one that is short.",
        "3. Refer to the company policies by the names given; do not restate or summarise their contents.",
        "4. No preamble, no commentary, no signature block, no letterhead, no date line — those are added by the template that renders this. Start at the first clause heading.",
        "5. Plain professional English. No placeholders like [NAME] or TBD.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `Draft the body of this document.\n\n${facts}`,
    },
  ];
}

/**
 * Strip what the model was told not to produce.
 *
 * Models reliably add a title line and a signature block however firmly they
 * are asked not to, and both are supplied by the letterhead template — leaving
 * them in produces a document with the company name twice and two places to
 * sign, which is precisely the sort of thing nobody notices until it is printed.
 */
function tidy(text) {
  if (!text) return null;
  let out = String(text).trim();
  // A fenced block around the whole answer.
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(out);
  if (fence) out = fence[1].trim();
  // A leading H1 title — the template prints the title.
  out = out.replace(/^#\s+.*\n+/, "");
  /* Everything from a signature block onwards.
   *
   * Two things this has to get right and an obvious pattern gets wrong: the
   * leading `\s*` (the heading sits after a BLANK line, so a pattern anchored
   * to one newline never reaches the `##`), and `signatures?` rather than
   * `signature\b` — the heading models actually write is the plural, and `\b`
   * between "signature" and "s" is not a boundary, so the whole block survived. */
  const sig = out.search(/\n\s*#{0,3}\s*(signatures?|signed by|signed:|for and on behalf|in witness whereof)/i);
  if (sig > 0) out = out.slice(0, sig).trim();
  return out || null;
}

/**
 * A real contract, written without a model.
 *
 * Deliberately complete rather than a stub: this is what a tenant with no AI
 * vendor gets, and it has to be signable after editing. It is short because
 * every clause here is one the facts support — the same rule the model is held
 * to.
 */
function templateDraft(t) {
  const s = [];
  const p = (heading, body) => {
    if (body) s.push(`## ${heading}\n\n${body}`);
  };

  p(
    "Parties",
    `This ${KIND_LABEL[t.kind] || "agreement"} is made between ${t.entity_name || "the Employer"} ("the Employer") and ${t.employee_name} ("the Employee").`,
  );
  p(
    "Position",
    t.job_title
      ? `The Employee is engaged as ${t.job_title}${t.department ? ` in the ${t.department} department` : ""}, and shall carry out the duties reasonably associated with that role.`
      : null,
  );
  p(
    "Term",
    t.effective_on
      ? t.end_on
        ? `Employment begins on ${t.effective_on} and ends on ${t.end_on} unless renewed in writing.`
        : `Employment begins on ${t.effective_on} and continues for an indefinite period.`
      : null,
  );
  p(
    "Probation",
    t.probation_months
      ? `The first ${t.probation_months} month(s) are a probationary period, during which either party may end this agreement on shorter notice as permitted by law. Confirmation in the role is by written notice from the Employer.`
      : null,
  );
  p(
    "Remuneration",
    t.gross_salary !== null
      ? `The Employee's gross monthly salary is ${t.gross_salary} ${t.salary_currency}, payable monthly in arrears, subject to the statutory deductions the Employer is required to make.`
      : null,
  );
  p("Hours of work", t.working_hours ? `Normal working hours are ${t.working_hours}.` : null);
  p("Place of work", t.place_of_work ? `The Employee's place of work is ${t.place_of_work}.` : null);
  p(
    "Notice",
    `Either party may end this agreement by giving ${t.notice_days} days' written notice, or such longer period as the law requires.`,
  );
  p(
    "Company policies",
    t.sop_titles.length
      ? `The Employee is bound by the Employer's policies and procedures, including: ${t.sop_titles.join("; ")}. These are provided to the Employee and may be amended from time to time.`
      : null,
  );

  return s.join("\n\n");
}

/**
 * Draft a contract body. NEVER throws.
 *
 * Call OUTSIDE a transaction — it is a model call of several seconds, and this
 * deployment runs a 12-connection-per-tenant ceiling.
 *
 * @returns { body_md, ai_generated, ai_model }
 */
async function draft(client, input = {}) {
  const t = terms(input);
  try {
    const { text, provider } = await llm.chat({
      client,
      messages: promptMessages(t),
      temperature: 0.3, // A contract is not a place for invention.
    });
    const body = tidy(text);
    // A model that returned three lines has not written a contract. Falling
    // back beats handing somebody a document that looks finished and is not.
    if (body && body.length > 200) {
      return { body_md: body, ai_generated: true, ai_model: provider || "ai" };
    }
    logger.warn({ provider, length: body ? body.length : 0 }, "[hr_contract] draft too short — falling back to the template");
  } catch (err) {
    logger.warn({ err }, "[hr_contract] AI drafting failed — falling back to the template");
  }
  return { body_md: templateDraft(t), ai_generated: false, ai_model: "template" };
}

module.exports = { draft, templateDraft, terms, tidy, promptMessages, DEFAULT_NOTICE_DAYS, KIND_LABEL };
