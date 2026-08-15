/**
 * Drafting a vacancy from an interview.
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * A form. "New vacancy" used to be a title, a department and a description box
 * — which asks the recruiter to be a copywriter, and gets you a job description
 * that reads like a database row. The actual product is the other way round:
 * ask a person a few questions in their own words, then let the model write the
 * description, infer the department and employment type, and propose a salary
 * band. The recruiter edits a real draft instead of facing an empty box.
 *
 * ── GROUNDED IN THE CORPORATE ENTITY, NOT A SEPARATE CONTEXT PACK ──────────
 *
 * A generic model writes generic copy. It needs to know what the company does,
 * where it is and what it is called — and this product already holds all of
 * that on `corporate_entity` (0515): trading_name, description, industry,
 * legal_form, incorporation_place, headcount, payroll_country,
 * default_currency, timezone.
 *
 * So the grounding is a READ of the hiring entity, not a new table somebody has
 * to remember to fill in. That matters beyond tidiness: a bespoke "recruitment
 * context" would start accurate and drift, because nothing else in the product
 * would ever read it, whereas the entity record is maintained because invoicing,
 * payroll and the letterhead all depend on it being right.
 *
 * ── THREE TIERS, AND IT NEVER THROWS ───────────────────────────────────────
 *
 * DeepSeek (the deployment's primary) → Gemini (its fallback) → a deterministic
 * template. The template is not a nicety: drafting sits behind a button at the
 * end of a ten-question interview, and a recruiter who has just spent four
 * minutes answering questions must not be handed an error. They get a real,
 * editable draft built from their own answers, and `ai_provider: "template"`
 * records that no model was involved so nobody mistakes it for written copy.
 */
"use strict";

const llm = require("../../../services/ai/llm.service");
const { logger } = require("../../../config/logger");

/* ── Grounding ───────────────────────────────────────────────────────────── */

/**
 * The hiring entity as a prompt block.
 *
 * Only fields a recruiter would actually say out loud about their employer.
 * Deliberately NOT share capital, tax ids or registration numbers: they are on
 * the record, they are irrelevant to a job advert, and every one of them sent to
 * a third-party model is a disclosure nobody asked for.
 */
function entityContext(entity) {
  if (!entity) return "No entity details on file — write in a neutral, professional voice.";
  const lines = [
    `Name: ${entity.trading_name || entity.name || "the company"}`,
    entity.description && `About: ${entity.description}`,
    entity.industry && `Industry: ${entity.industry}`,
    entity.legal_form && `Legal form: ${entity.legal_form}`,
    entity.incorporation_place && `Based in: ${entity.incorporation_place}`,
    entity.incorporation_country && `Country: ${entity.incorporation_country}`,
    entity.headcount && `Current headcount: ${entity.headcount}`,
    entity.website && `Website: ${entity.website}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** The money the band should be quoted in, and the labour market to assume. */
const bandCurrency = (entity) => (entity && entity.default_currency) || "XAF";
const payrollCountry = (entity) => (entity && (entity.payroll_country || entity.incorporation_country)) || null;

/* ── The interview ───────────────────────────────────────────────────────── */

/**
 * The fixed opening questions.
 *
 * Fixed because they are the ones whose answers the MODEL needs before it can
 * ask anything intelligent — you cannot generate a good follow-up about a role
 * you have not been told the name of. Everything after these is generated.
 *
 * `key` is what lands in `intake_json`; `type` drives the control the wizard
 * renders. `hint` is shown under the question — it is where the interview gets
 * its answers to be useful rather than one-word ("BOTH" is a real answer to a
 * badly-hinted question about working pattern).
 */
const BASE_QUESTIONS = [
  { key: "title", type: "text", question: "What role are you hiring for?" },
  { key: "department", type: "text", question: "Which team or department does it sit in?" },
  { key: "headcount", type: "number", question: "How many people are you hiring?", min: 1, max: 500 },
  {
    key: "work_pattern", type: "textarea",
    question: "How will they work — on-site, hybrid or remote?",
    hint: "Say which days are on-site and what the working hours are.",
  },
  {
    key: "location", type: "textarea",
    question: "Where is the role based?",
    hint: "City, state, country — it matters for on-site and hybrid roles.",
  },
  {
    key: "salary", type: "salary",
    question: "What monthly salary range are you offering?",
    hint: "Leave it blank and the AI will propose a market band you can adjust.",
  },
  {
    key: "must_haves", type: "textarea",
    question: "What are the must-haves and key responsibilities?",
    hint: "The three to five things that really matter for this role.",
  },
  {
    key: "extras", type: "textarea", optional: true,
    question: "Anything else I should know? (optional)",
    hint: "Perks, reporting line, team, probation…",
  },
];

/** How many generated follow-ups sit after the fixed set. */
const FOLLOW_UP_COUNT = 2;
const TOTAL_QUESTIONS = BASE_QUESTIONS.length + FOLLOW_UP_COUNT;

/** Strip a fenced/prose-padded reply down to its JSON payload. */
function parseLoose(text, opener, closer) {
  const raw = String(text || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = raw.indexOf(opener);
  const end = raw.lastIndexOf(closer);
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Generate the follow-up questions from the answers so far.
 *
 * This is what makes it an interview rather than a form: having been told the
 * role is a Junior Stylist, the next question is about salon experience, not
 * about "requirements". Returns [] on any failure — the wizard simply finishes
 * early, which is a shorter interview and not a broken one.
 */
async function followUpQuestions(client, { entity, answers }) {
  const messages = [
    {
      role: "system",
      content:
        `You are interviewing a hiring manager so you can write a job advert. ` +
        `Ask exactly ${FOLLOW_UP_COUNT} short follow-up questions about THIS role that the ` +
        "answers so far have not already covered — the specifics that would change how the " +
        "advert reads, such as the level of experience expected, the tools or certifications " +
        "involved, or what the day-to-day actually looks like. " +
        "Name the role in each question so it does not sound like a form. " +
        "Never ask about age, sex, marital or family status, nationality, ethnicity, religion, " +
        "disability or health — those are unlawful to ask and irrelevant to the advert. " +
        'Reply with ONLY a JSON array: [{"question": string, "hint": string}]',
    },
    {
      role: "user",
      content: `THE COMPANY\n${entityContext(entity)}\n\nANSWERS SO FAR\n${JSON.stringify(answers, null, 2)}`,
    },
  ];

  try {
    const { text } = await llm.chat({ client, messages, temperature: 0.5 });
    const parsed = parseLoose(text, "[", "]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((q, i) => ({
        key: `followup_${i + 1}`,
        type: "textarea",
        optional: true,
        question: String((q && q.question) || (typeof q === "string" ? q : "")).trim().slice(0, 400),
        hint: q && q.hint ? String(q.hint).trim().slice(0, 200) : null,
      }))
      .filter((q) => q.question.length > 10)
      .slice(0, FOLLOW_UP_COUNT);
  } catch (err) {
    logger.warn({ err }, "[vacancy] follow-up question generation failed — continuing with the fixed set");
    return [];
  }
}

/* ── The draft ───────────────────────────────────────────────────────────── */

const DRAFT_SHAPE = `{
  "title": string,
  "department": string,
  "employment_type": "Full-time" | "Part-time" | "Contract" | "Internship" | "Temporary",
  "work_mode": "On-site" | "Hybrid" | "Remote",
  "location": string,
  "experience_years_min": integer,
  "skills_required": [string],
  "salary_min": number|null,
  "salary_max": number|null,
  "description": "the full job advert in markdown: what the role is, what success looks like, responsibilities, requirements, nice-to-haves"
}`;

function draftMessages({ entity, answers }) {
  const currency = bandCurrency(entity);
  const country = payrollCountry(entity);
  return [
    {
      role: "system",
      content:
        "You write job adverts. Be specific and results-focused; avoid vanity language and " +
        "avoid listing generic soft skills nobody screens for. Write in clear professional " +
        "English. Ground every claim about the company in the details given — invent nothing " +
        "about the employer. " +
        "Describe the role and its requirements only. Never state or imply a preference about " +
        "age, sex, marital or family status, nationality, ethnicity, religion or disability. " +
        `Salary figures are MONTHLY and in ${currency}` +
        (country ? `, for the ${country} labour market` : "") +
        ". If the hiring manager gave a band, use it exactly; if they did not, propose a " +
        "realistic one for that market and role. " +
        `Reply with ONLY a JSON object of this shape, no prose around it:\n${DRAFT_SHAPE}`,
    },
    {
      role: "user",
      content:
        `THE COMPANY\n${entityContext(entity)}\n\n` +
        `WHAT THE HIRING MANAGER TOLD ME\n${JSON.stringify(answers, null, 2)}`,
    },
  ];
}

const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
};
const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Coerce a model reply into the vacancy's columns.
 *
 * Everything is bounded and typed HERE rather than trusted, because this lands
 * in a row with CHECK constraints: an `experience_years_min` of 200 or an
 * inverted salary band would be rejected by Postgres and surface to the
 * recruiter as a 500 at the end of their interview.
 */
function shape(out, { entity, answers }) {
  if (!out || typeof out !== "object") return null;
  let salaryMin = money(out.salary_min);
  let salaryMax = money(out.salary_max);
  // The band arrives inverted often enough to be worth handling rather than
  // refusing — the recruiter said "150–200" and the model echoed it backwards.
  if (salaryMin !== null && salaryMax !== null && salaryMax < salaryMin) {
    [salaryMin, salaryMax] = [salaryMax, salaryMin];
  }
  const description = typeof out.description === "string" ? out.description.trim() : "";
  if (description.length < 60) return null; // not a usable advert

  return {
    title: String(out.title || answers.title || "New role").trim().slice(0, 200),
    department: out.department ? String(out.department).trim().slice(0, 120) : null,
    employment_type: out.employment_type ? String(out.employment_type).trim().slice(0, 60) : null,
    // `work_mode` has no column of its own — it belongs to the location line a
    // candidate reads ("Lekki, Lagos · Hybrid"), and inventing a column for a
    // three-value string the advert already states would be a migration for a
    // label.
    location: [out.location, out.work_mode].filter(Boolean).join(" · ").slice(0, 160) || null,
    experience_years_min: clampInt(out.experience_years_min, 0, 60),
    skills_required: Array.isArray(out.skills_required)
      ? [...new Set(out.skills_required.map((s) => String(s).trim()).filter(Boolean))].slice(0, 40)
      : [],
    salary_min: salaryMin,
    salary_max: salaryMax,
    salary_currency: bandCurrency(entity),
    description,
  };
}

/**
 * The deterministic fallback.
 *
 * Built from the recruiter's OWN WORDS, so it is a genuine starting draft
 * rather than an apology. It says less than a model would; it never says
 * anything untrue.
 */
function templateDraft({ entity, answers }) {
  const a = answers || {};
  const title = String(a.title || "New role").trim();
  const company = (entity && (entity.trading_name || entity.name)) || "our team";
  const bullets = (text) =>
    String(text || "")
      .split(/\n|;|(?<=\.)\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3)
      .slice(0, 8);

  const musts = bullets(a.must_haves);
  const extras = bullets(a.extras);

  const description = [
    `# ${title}`,
    "",
    `## About the role`,
    `${company} is hiring ${Number(a.headcount) > 1 ? `${a.headcount} people` : "one person"} for the role of **${title}**` +
      (a.department ? `, in the ${a.department} team` : "") +
      (a.location ? `, based in ${String(a.location).trim()}` : "") + ".",
    a.work_pattern ? `\n**Working pattern.** ${String(a.work_pattern).trim()}` : "",
    musts.length ? `\n## What matters in this role\n${musts.map((m) => `- ${m}`).join("\n")}` : "",
    extras.length ? `\n## Also worth knowing\n${extras.map((m) => `- ${m}`).join("\n")}` : "",
    "",
    "_This draft was written from the hiring brief without AI. Edit it before publishing._",
  ].filter(Boolean).join("\n");

  return {
    title: title.slice(0, 200),
    department: a.department ? String(a.department).trim().slice(0, 120) : null,
    employment_type: null,
    location: a.location ? String(a.location).trim().slice(0, 160) : null,
    experience_years_min: null,
    skills_required: [],
    salary_min: money(a.salary_min),
    salary_max: money(a.salary_max),
    salary_currency: bandCurrency(entity),
    description,
  };
}

/**
 * Draft a vacancy from the interview answers. NEVER throws.
 *
 * Call OUTSIDE a transaction — it is a model call of several seconds, and this
 * deployment runs a 12-connection-per-tenant ceiling.
 */
async function draft(client, { entity, answers }) {
  // A band the recruiter typed is a decision, not a suggestion: pass it through
  // untouched rather than letting the model "adjust" it.
  const stated = { salary_min: money(answers.salary_min), salary_max: money(answers.salary_max) };

  try {
    const { text, provider } = await llm.chat({
      client,
      messages: draftMessages({ entity, answers }),
      temperature: 0.6,
    });
    const shaped = shape(parseLoose(text, "{", "}"), { entity, answers });
    if (shaped) {
      return {
        ...shaped,
        ...(stated.salary_min !== null ? { salary_min: stated.salary_min } : {}),
        ...(stated.salary_max !== null ? { salary_max: stated.salary_max } : {}),
        ai_provider: provider || "ai",
      };
    }
    logger.warn({ provider }, "[vacancy] draft was not usable JSON — falling back to the template");
  } catch (err) {
    logger.warn({ err }, "[vacancy] AI drafting failed — falling back to the template");
  }
  return { ...templateDraft({ entity, answers }), ai_provider: "template" };
}

module.exports = {
  draft,
  followUpQuestions,
  templateDraft,
  entityContext,
  shape,
  parseLoose,
  BASE_QUESTIONS,
  FOLLOW_UP_COUNT,
  TOTAL_QUESTIONS,
};
