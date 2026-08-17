/**
 * Drafting a standard operating procedure (MOD-16 / 0704).
 *
 * ── WHAT AN SOP WAS BEFORE THIS ────────────────────────────────────────────
 *
 *   sop_document(title, category, vault_id, version_no, is_active)
 *
 * A title and a file somebody remembered to upload elsewhere. There was no
 * document in the system — which matters more than it sounds, because
 * `hr_rule.sop_document_id` points at this row to answer "which page says I can
 * be charged for this?" A row with a title and no body cannot answer it, so
 * every deduction traced back to an empty reference.
 *
 * ── THE SAME SPLIT 0700 USES ON CONTRACTS ──────────────────────────────────
 *
 * The model writes the PROSE. It does not invent the FACTS. Everything that
 * binds anybody — the scope, the department, the owning role, the effective
 * date, the rules this procedure backs — is passed in and echoed, and the
 * caller stores those columns from its own input rather than from the draft.
 *
 * The reason is sharper here than for a contract. An SOP is what a lateness
 * deduction is justified by. A model that invents "staff must arrive fifteen
 * minutes early" has written a clause the company never agreed and that the
 * system will then charge people against.
 *
 * ── OPERATIONS IS NOT A DEPARTMENT ─────────────────────────────────────────
 *
 * A procedure for clearing customs binds whoever is clearing customs this week,
 * not a box on the org chart. The prompt is told which of the three scopes it is
 * writing for, because the register differs: a COMPANY policy addresses "all
 * staff", an OPERATIONS procedure addresses "the person performing this task",
 * and writing the second as the first produces a document nobody thinks applies
 * to them.
 *
 * ── IT NEVER THROWS ────────────────────────────────────────────────────────
 *
 * Same contract as 0700's drafter. A tenant with no AI vendor configured must
 * still get an editable procedure — the alternative is that the feature does not
 * exist for them — and the caller records WHICH produced it so nobody issues a
 * skeleton believing a model wrote it.
 */
"use strict";

const llm = require("../../../services/ai/llm.service");
const { logger } = require("../../../config/logger");

const SCOPES = ["COMPANY", "DEPARTMENT", "OPERATIONS"];

/** Who the document speaks to. Getting this wrong is how a procedure ends up
 *  addressed to nobody. */
const AUDIENCE = {
  COMPANY: "all staff of the company",
  DEPARTMENT: "staff working in the named department",
  OPERATIONS: "whoever is performing this operation, whatever their department",
};

/** The facts, normalised. Everything here is echoed into the document and
 *  written to its own column; the model decides none of them. */
function facts(input = {}) {
  const scope = SCOPES.includes(input.scope) ? input.scope : "COMPANY";
  return {
    title: String(input.title || "").trim() || "Standard operating procedure",
    scope,
    department: scope === "DEPARTMENT" ? String(input.department || "").trim() || null : (input.department || null),
    owner_role: String(input.owner_role || "").trim() || null,
    category: String(input.category || "").trim() || null,
    effective_on: input.effective_on || null,
    // What the tenant actually told us this procedure is for, in their words.
    // This is the substance; without it there is nothing to write from.
    purpose: String(input.purpose || "").trim(),
    // Steps they already know, in any shape. The model orders and expands them
    // rather than inventing a process it has never seen.
    steps: Array.isArray(input.steps)
      ? input.steps.map((s) => String(s || "").trim()).filter(Boolean)
      : String(input.steps || "").split("\n").map((s) => s.trim()).filter(Boolean),
    // House rules this procedure is the written basis for. Named so the
    // document says what it enforces, which is the whole point of the link.
    rules: Array.isArray(input.rules) ? input.rules.filter(Boolean) : [],
    entity_name: input.entity_name || null,
  };
}

function promptMessages(f) {
  const bits = [
    `Title: ${f.title}`,
    `Applies to: ${AUDIENCE[f.scope]}`,
    f.department ? `Department: ${f.department}` : null,
    f.owner_role ? `Owned by: ${f.owner_role}` : null,
    f.category ? `Category: ${f.category}` : null,
    f.effective_on ? `Effective from: ${f.effective_on}` : null,
    f.entity_name ? `Company: ${f.entity_name}` : null,
    f.rules.length ? `This procedure is the written basis for these house rules, which must be stated explicitly in the text: ${f.rules.join("; ")}` : null,
  ].filter(Boolean).join("\n");

  return [
    {
      role: "system",
      content: [
        "You write standard operating procedures for a freight and logistics company operating in Cameroon, under OHADA/CEMAC practice.",
        "",
        "WRITE THE PROSE. DO NOT INVENT THE POLICY. Use only the purpose and the steps supplied. Do not add obligations, deadlines, penalties or thresholds that are not in them — this document is what staff disciplinary deductions are justified against, so a rule you invent is one the company never agreed and will then charge people for.",
        "",
        "Where the supplied material is thin, write the section as far as it honestly goes and add a line beginning 'To be completed:' naming what the company still needs to decide. That is far more useful than a plausible paragraph nobody agreed.",
        "",
        "Structure, using markdown '##' headings, in this order:",
        "## Purpose — what this procedure is for, in two or three sentences.",
        "## Scope — who it binds, in the audience terms given above, and when it applies.",
        "## Responsibilities — who does what, by ROLE and never by name.",
        "## Procedure — the numbered steps, in order, each one an instruction somebody can follow.",
        "## Records — what must be recorded, and where.",
        "## Compliance — what happens if it is not followed. State only the house rules supplied, verbatim in substance; if none were supplied, say that non-compliance is handled under the company's general disciplinary policy.",
        "",
        "Plain British English, present tense, addressed to the person performing the work. Short sentences. No preamble, no closing remarks, no note about being an AI. Return markdown only.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `${bits}\n\nPurpose, in the company's own words:\n${f.purpose || "(not stated)"}\n\nSteps the company has given:\n${f.steps.length ? f.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") : "(none given)"}`,
    },
  ];
}

/** Strip the code fence a model wraps markdown in, and normalise blank runs. */
function tidy(text) {
  let s = String(text || "").trim();
  const m = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/.exec(s);
  if (m) s = m[1].trim();
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The fallback, and a real document rather than an apology.
 *
 * It reproduces the tenant's own steps under the same headings the model would
 * have used, so what comes back is editable and correctly shaped — the sections
 * that need a human are marked, which is honest about a skeleton in a way that
 * an empty box is not.
 */
function templateDraft(f) {
  const steps = f.steps.length
    ? f.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")
    : "To be completed: list the steps of this procedure, in order.";
  const compliance = f.rules.length
    ? f.rules.map((r) => `- ${r}`).join("\n")
    : "Non-compliance is handled under the company's general disciplinary policy.";
  return [
    `## Purpose`,
    f.purpose || "To be completed: state what this procedure is for.",
    ``,
    `## Scope`,
    `This procedure applies to ${AUDIENCE[f.scope]}${f.department ? ` (${f.department})` : ""}.`,
    f.effective_on ? `It takes effect on ${f.effective_on}.` : "",
    ``,
    `## Responsibilities`,
    f.owner_role ? `${f.owner_role} owns this procedure and is responsible for keeping it current.` : "To be completed: name the role that owns this procedure.",
    ``,
    `## Procedure`,
    steps,
    ``,
    `## Records`,
    "To be completed: state what must be recorded, and where it is kept.",
    ``,
    `## Compliance`,
    compliance,
  ].filter((l) => l !== "").join("\n");
}

/**
 * Draft the procedure.
 *
 * @returns { body_md, ai_generated, ai_model } — `ai_generated: false` means a
 *   template skeleton no model saw, and the caller must record that so nobody
 *   issues it believing otherwise.
 */
async function draft(client, input = {}) {
  const f = facts(input);
  try {
    const { text, provider } = await llm.chat({
      client,
      messages: promptMessages(f),
      // A procedure is not a place for invention. Same figure 0700 uses on a
      // contract, for the same reason.
      temperature: 0.3,
    });
    const body = tidy(text);
    // A model that returned four lines has not written a procedure. Falling
    // back beats handing somebody a document that looks finished and is not.
    if (body && body.length > 250) {
      return { body_md: body, ai_generated: true, ai_model: provider || "ai" };
    }
    logger.warn({ provider, length: body ? body.length : 0 }, "[sop] draft too short — falling back to the template");
  } catch (err) {
    logger.warn({ err }, "[sop] AI drafting failed — falling back to the template");
  }
  return { body_md: templateDraft(f), ai_generated: false, ai_model: "template" };
}

module.exports = { draft, templateDraft, facts, promptMessages, tidy, SCOPES, AUDIENCE };
