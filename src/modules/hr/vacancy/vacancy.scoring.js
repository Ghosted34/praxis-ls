/**
 * Applicant scoring — TWO TIERS, and the difference between them is the point.
 *
 * ── WHY TWO ────────────────────────────────────────────────────────────────
 *
 * A recruiter opening a vacancy with ninety applications needs an ordering
 * immediately, and cannot wait on ninety model calls against ninety PDFs. But an
 * ordering computed from the fields a candidate typed about themselves is a
 * measure of how well they described themselves — nothing in it has opened a CV.
 * Those are two different claims and the expensive one is not always worth
 * paying for.
 *
 * So: `estimate()` is arithmetic, runs in microseconds, costs nothing, and is
 * marked PROVISIONAL. `assess()` reads the résumé against the job description
 * and the recruiter's own criteria, costs a model call, and is marked final.
 * Both write the same columns; `ai_provisional` is what tells them apart, and
 * every surface that renders a score is required to render that flag with it.
 *
 * The failure this exists to prevent is specific and has a name in the schema
 * comment: a recruiter rejecting somebody on the strength of "97% match" that
 * never looked at their CV.
 *
 * ── WHY THE HEURISTIC IS DELIBERATELY CRUDE ────────────────────────────────
 *
 * There is a temptation to make `estimate()` clever — fuzzy skill matching,
 * synonym tables, a small local model. Every step in that direction makes it
 * better at LOOKING like the real assessment while remaining a summary of
 * self-reported fields, which widens the gap between what the number implies and
 * what it knows. Crude and legible is the safer failure: a recruiter who can see
 * that it counted four of six listed skills understands exactly what they are
 * being told.
 *
 * ── WHAT NEITHER TIER DOES ─────────────────────────────────────────────────
 *
 * Decide. Nothing here moves an applicant's status, rejects anybody, or filters
 * a list. The score is an ordering aid attached to a row a person still has to
 * open. That is a product decision, and it is enforced by this module simply not
 * exposing anything that could act on the number.
 */
"use strict";

const llm = require("../../../services/ai/llm.service");
const vision = require("../../../services/ai/vision.service");
const vault = require("../../vault/document_vault/document_vault.service");
const { logger } = require("../../../config/logger");

/** Clamp to the 0..100 the column checks, tolerating whatever a model returned. */
const pct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
};

const norm = (s) => String(s || "").trim().toLowerCase();

/**
 * "The candidate did not answer this" — and it MUST be asked before coercing.
 *
 * `Number(null)` and `Number("")` are both 0, so the obvious
 * `const n = Number(v); if (!Number.isFinite(n)) return null;` treats a blank
 * field as a stated ZERO. That is not a subtle difference here: it turns "we do
 * not know how much experience they have" into "they have none", which scores 0
 * and drags every incompletely-filled application to the bottom of the list —
 * exactly the failure `composite()` excludes nulls to avoid, reintroduced one
 * level down where the exclusion cannot see it.
 *
 * The same trap, in the same shape, is documented in geoapify.service's
 * `normaliseCandidate`. Reject the absent value first, then coerce.
 */
const blank = (v) => v === null || v === undefined || v === "";

/**
 * How many of the role's required skills the candidate claims.
 *
 * Substring both ways, and that is the whole of the cleverness: "customs
 * clearance" should match a candidate who wrote "customs clearance (sea)", and
 * "SQL" should match "PostgreSQL". It will also over-match occasionally — "art"
 * inside "cartography" — which is a known and accepted cost of not building a
 * synonym table into a number that is labelled provisional anyway.
 *
 * A vacancy that lists NO required skills returns null, not 100: "we did not ask
 * for anything" is not "they have everything", and scoring it as a perfect match
 * would let an empty vacancy hand every applicant a free dimension.
 */
function skillsScore(required, claimed) {
  const req = (required || []).map(norm).filter(Boolean);
  if (!req.length) return null;
  const have = (claimed || []).map(norm).filter(Boolean);
  const hit = req.filter((r) => have.some((h) => h.includes(r) || r.includes(h)));
  return pct((hit.length / req.length) * 100);
}

/**
 * Experience against the role's minimum.
 *
 * Capped at 100 rather than rewarding excess: someone with twenty years against
 * a three-year minimum is not seven times better suited, and letting the
 * dimension run away would make seniority dominate a composite it is only one
 * part of. Under the minimum it degrades proportionally rather than falling to
 * zero — two years against three is most of the way there, and a cliff would
 * discard candidates a human would happily interview.
 */
function experienceScore(minYears, years) {
  // Blank BEFORE coerce — see `blank` above. Without this, an applicant who
  // left the years field empty scores 0 rather than being left unassessed.
  if (blank(years)) return null;
  const has = Number(years);
  if (!Number.isFinite(has)) return null;
  const need = blank(minYears) ? NaN : Number(minYears);
  if (!Number.isFinite(need) || need <= 0) return has > 0 ? 100 : null;
  return pct(Math.min(1, has / need) * 100);
}

/**
 * Expected salary against the band.
 *
 * INSIDE the band is 100 — including at the very top, because a candidate who
 * asks for the maximum the company already decided to pay is a perfect fit for
 * the band by definition, not a marginal one. Below it is also 100: the band is
 * what the role is worth, and someone asking less is not a worse candidate.
 * Above it decays over one further band-width, so asking 10% over is a near-miss
 * and asking double is zero.
 */
function salaryScore(min, max, expected) {
  if (blank(expected)) return null;
  const want = Number(expected);
  if (!Number.isFinite(want) || want <= 0) return null;
  // Blank before coerce on BOTH bounds. `Number(null)` is 0, so a vacancy with
  // no salary band read as a band of 0–0 and scored every candidate who named a
  // figure at 0% salary fit — a whole dimension silently against them for a
  // question the role never asked.
  const bound = (v) => (blank(v) || !Number.isFinite(Number(v)) ? null : Number(v));
  const lo = bound(min);
  const hi = bound(max);
  if (lo === null && hi === null) return null;
  const top = hi ?? lo;
  if (want <= top) return 100;
  // The span, or the band's own magnitude when only one bound was given —
  // otherwise a vacancy with min === max would divide by zero and every
  // over-ask, however slight, would score 0.
  const span = lo !== null && hi !== null && hi > lo ? hi - lo : top;
  return pct(Math.max(0, 1 - (want - top) / span) * 100);
}

/** Did they give us something to look at beyond the form? */
function portfolioScore({ portfolio_url, cv_vault_id, cover_note }) {
  // Thirds rather than a boolean: a CV and a portfolio and a covering note is a
  // materially more considered application than a bare form, and the dimension
  // exists to say so.
  let n = 0;
  if (cv_vault_id) n += 1;
  if (portfolio_url) n += 1;
  if (cover_note && String(cover_note).trim().length > 40) n += 1;
  return pct((n / 3) * 100);
}

/** Mean of the dimensions that had anything to say. Null dimensions are absent
 *  from the average, not zero — "we could not tell" must not read as "bad". */
function composite(dims) {
  const vals = Object.values(dims).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  return pct(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * TIER 1 — instant, free, provisional. Reads only what the applicant typed.
 *
 * Pure and synchronous on purpose: no client, no network, no I/O. It can be run
 * over a whole pipeline on every list render without anybody having to think
 * about cost, and it can be unit-tested without a database.
 */
function estimate(vacancy, applicant) {
  const dims = {
    skills: skillsScore(vacancy.skills_required, applicant.skills),
    experience: experienceScore(vacancy.experience_years_min, applicant.experience_years),
    salary_fit: salaryScore(vacancy.salary_min, vacancy.salary_max, applicant.expected_salary),
    portfolio: portfolioScore(applicant),
  };
  return {
    ai_score: composite(dims),
    ai_breakdown: { ...dims, criteria: [] },
    ai_summary:
      "Estimate from stated skills, experience and salary — a full AI read of the CV is still pending (tap Score to run it).",
    ai_provisional: true,
    ai_model: null,
  };
}

/* ── TIER 2 ──────────────────────────────────────────────────────────────── */

/** Ask the vision model to read the CV. Best-effort: a CV we cannot open is a
 *  reason to score without it and SAY so, not a reason to fail the request. */
async function readCv(client, cvVaultId) {
  if (!cvVaultId) return { text: null, reason: null };
  try {
    const { doc, buffer } = await vault.fetchBytes(client, cvVaultId);
    const mimeType = doc.mime_type || doc.content_type || "application/pdf";
    /*
     * The vendor comes from the tenant's own AI Control config, not from the
     * process env alone.
     *
     * `vision.extract` fell back to `GEMINI_API_KEY` and nothing else, so on a
     * deployment whose models are configured in AI Control — which is the point
     * of AI Control — reading a CV threw "provider not configured" and every
     * assessment came back "scored without the CV". The recruiter was then told
     * the CANDIDATE's file could not be read, which is a lie about a PDF that
     * is sitting in the vault, marked Verified, and opens fine.
     */
    const vendor = await llm.resolveVendor(client, "gemini");
    const { raw } = await vision.extract({
      image: buffer,
      mimeType,
      vendor,
      prompt:
        "This is a job applicant's CV. Transcribe its substance as JSON with keys " +
        "summary, total_years_experience, roles (array of {title, employer, years}), " +
        "skills (array of strings), education (array of strings), certifications (array of strings)",
    });
    // The RAW text, not the parsed fields: the assessor is a language model and
    // reads a slightly-malformed JSON blob perfectly well, whereas
    // `JSON.parse` failing would throw away a good transcription over a stray
    // trailing comma.
    const text = String(raw || "").slice(0, 20000) || null;
    return { text, reason: text ? null : "unreadable" };
  } catch (err) {
    // Two different problems wear the same face here, and only one of them is
    // the candidate's: a provider nobody configured is an ADMINISTRATOR's to
    // fix, and saying "the file could not be read" about it sends a recruiter
    // chasing a PDF that was never the problem.
    const reason = /not configured/i.test(err && err.message) ? "no_provider" : "unreadable";
    logger.warn({ err, cvVaultId, reason }, "[recruitment] could not read the CV — scoring without it");
    // Returned, not stashed on the function: two assessments can be in flight
    // at once and a shared slot would report one candidate's reason on another.
    return { text: null, reason };
  }
}

/**
 * The JSON contract the model is held to.
 *
 * Stated as a schema in the prompt AND validated on the way back, because a
 * model that returns prose instead of JSON must degrade to "we could not score
 * this" rather than writing a null into a column the UI renders as a percentage.
 */
const ASSESS_SCHEMA = `{
  "skills": 0-100,
  "experience": 0-100,
  "salary_fit": 0-100,
  "portfolio": 0-100,
  "criteria": [{ "label": string, "score": 0-100, "note": string }],
  "overall": 0-100,
  "summary": string
}`;

function buildPrompt({ vacancy, applicant, criteria, cvText }) {
  const band = [vacancy.salary_min, vacancy.salary_max].filter((v) => v !== null && v !== undefined);
  const role = [
    `Title: ${vacancy.title}`,
    vacancy.department ? `Department: ${vacancy.department}` : null,
    vacancy.employment_type ? `Employment type: ${vacancy.employment_type}` : null,
    vacancy.location ? `Location: ${vacancy.location}` : null,
    vacancy.experience_years_min ? `Minimum experience: ${vacancy.experience_years_min} years` : null,
    (vacancy.skills_required || []).length ? `Required skills: ${vacancy.skills_required.join(", ")}` : null,
    band.length ? `Salary band: ${band.join(" – ")} ${vacancy.salary_currency || ""}`.trim() : null,
    vacancy.description ? `Description:\n${vacancy.description}` : null,
  ].filter(Boolean).join("\n");

  const person = [
    `Name: ${applicant.full_name}`,
    (applicant.skills || []).length ? `Stated skills: ${applicant.skills.join(", ")}` : null,
    applicant.experience_years ? `Stated experience: ${applicant.experience_years} years` : null,
    applicant.expected_salary ? `Expected salary: ${applicant.expected_salary}` : null,
    applicant.portfolio_url ? `Portfolio: ${applicant.portfolio_url}` : null,
    applicant.cover_note ? `Covering note:\n${applicant.cover_note}` : null,
  ].filter(Boolean).join("\n");

  const extra = criteria.length
    ? "\n\nThe recruiter added these criteria. Score EACH one and return it in `criteria`, " +
      "using the exact label given:\n" +
      criteria.map((c) => `- ${c.label} (weight ${c.weight})${c.guidance ? ` — ${c.guidance}` : ""}`).join("\n")
    : "";

  return [
    {
      role: "system",
      content:
        "You assess job applicants against a role. Be sceptical and specific: reward evidence, " +
        "not adjectives, and do not infer seniority from job titles alone. " +
        "You are producing an ordering aid for a human recruiter, not a decision — " +
        "say plainly in `summary` what you could NOT verify. " +
        "Judge only what is relevant to doing the job. Ignore and never comment on age, sex, " +
        "marital or family status, nationality, ethnicity, religion, disability or any photograph. " +
        `Reply with ONLY a JSON object of this shape, no prose around it:\n${ASSESS_SCHEMA}`,
    },
    {
      role: "user",
      content:
        `ROLE\n${role}\n\nAPPLICANT (self-reported)\n${person}${extra}\n\n` +
        (cvText
          ? `CV, as transcribed from the uploaded file:\n${cvText}`
          : "No CV was readable for this applicant. Score on the self-reported information " +
            "alone, cap `portfolio` accordingly, and say so in `summary`."),
    },
  ];
}

/** Pull the JSON object out of a reply that may be fenced or padded with prose. */
function parseAssessment(text) {
  const raw = String(text || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1));
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

/**
 * TIER 2 — the full read. Costs a model call; marks the score final.
 *
 * MUST BE CALLED OUTSIDE A TRANSACTION for the vault read and the model call
 * (both are network waits, and this deployment runs a 12-connection-per-tenant
 * ceiling); the caller persists the result in its own short write.
 *
 * Returns null when there is no usable answer — the caller keeps whatever score
 * was already there rather than overwriting a real assessment with a blank.
 */
async function assess(client, { vacancy, applicant, criteria = [] }) {
  const { text: cvText, reason: cvUnreadReason } = await readCv(client, applicant.cv_vault_id);
  const { text, provider } = await llm.chat({
    client,
    messages: buildPrompt({ vacancy, applicant, criteria, cvText }),
    temperature: 0.1,
  });
  const out = parseAssessment(text);
  if (!out) {
    logger.warn({ applicantId: applicant.applicant_id, provider }, "[recruitment] assessment was not JSON — leaving the previous score");
    return null;
  }

  const dims = {
    skills: pct(out.skills),
    experience: pct(out.experience),
    salary_fit: pct(out.salary_fit),
    portfolio: pct(out.portfolio),
  };
  // The model's own labels are NOT trusted to match: it is asked to echo them
  // exactly, and mostly does, but a criterion the UI cannot line up with a row
  // is a criterion that silently disappears from the panel. Match on the label
  // we sent, and keep the recruiter's text rather than the model's paraphrase.
  const byLabel = new Map((Array.isArray(out.criteria) ? out.criteria : []).map((c) => [norm(c && c.label), c]));
  const scoredCriteria = criteria.map((c) => {
    const hit = byLabel.get(norm(c.label));
    return {
      label: c.label,
      weight: Number(c.weight) || 1,
      score: hit ? pct(hit.score) : null,
      note: hit && hit.note ? String(hit.note).slice(0, 500) : null,
    };
  });

  /*
   * WEIGHTED, and the weights apply ONLY to the custom criteria.
   *
   * The four standard dimensions are the role as written; the criteria are what
   * this particular recruiter said also matters, with their own relative
   * importance. Folding weights across both sets would let a single weight-5
   * criterion swamp the job description itself. So the standard dimensions form
   * one half-weight and the weighted criteria the other, and a vacancy with no
   * criteria simply falls back to the plain mean.
   */
  const base = composite(dims);
  const weighted = scoredCriteria.filter((c) => c.score !== null);
  let overall = base;
  if (weighted.length) {
    const wSum = weighted.reduce((a, c) => a + c.weight, 0);
    const cScore = weighted.reduce((a, c) => a + c.score * c.weight, 0) / wSum;
    overall = base === null ? pct(cScore) : pct(base * 0.5 + cScore * 0.5);
  }
  // The model's own `overall` is the fallback, not the answer: it is not
  // reproducible and it has not seen the recruiter's weights.
  if (overall === null) overall = pct(out.overall);

  return {
    ai_score: overall,
    ai_breakdown: {
      ...dims,
      criteria: scoredCriteria,
      // One key per line, and `cv_read` in particular must stay at the start of
      // one. check-response-contract.js discovers server-emitted JSON keys with
      // a line-anchored regex (`/^\s*([a-z][a-z0-9_]*)\s*:/gm`), so a key folded
      // into a single-line object literal is invisible to it — and because
      // `cv_read` lives inside a jsonb column rather than being a column of its
      // own, the schema scan cannot find it either. Collapse this object and the
      // client's `AiBreakdown.cv_read` is reported as drift.
      cv_read: !!cvText,
      // Only when it was not read AND we know why. The UI says something
      // different for each, because the two have different owners.
      ...(cvUnreadReason ? { cv_unread_reason: cvUnreadReason } : {}),
    },
    ai_summary: out.summary ? String(out.summary).slice(0, 2000) : null,
    ai_provisional: false,
    ai_model: provider || null,
  };
}

module.exports = {
  // Exported for its test: the two reasons a CV goes unread have different
  // owners, and the panel branches on which.
  readCv,
  estimate,
  assess,
  // Exported for the unit tests — each is a decision with a rationale above it
  // and each is worth pinning independently of the composite.
  skillsScore,
  experienceScore,
  salaryScore,
  portfolioScore,
  composite,
  parseAssessment,
};
