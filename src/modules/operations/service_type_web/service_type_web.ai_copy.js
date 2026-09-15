"use strict";
/**
 * AI drafting for a service type's website copy.
 *
 * ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
 *
 * A service page is the longest thing anyone writes in this product. The copy
 * arrives as prose — composed in a document, pasted into the box — and prose is
 * exactly what a reader will not read: twenty undifferentiated paragraphs with
 * no headings, no bullets and nothing to scan. The words are usually good. The
 * shape is what is missing, and asking an author to hand-write `##` in a plain
 * textarea was never going to produce it.
 *
 * So this turns prose into a page: section headings, a scannable highlights
 * layer, a short description, and the meta fields — from what the author wrote,
 * or from nothing when they have not written it yet.
 *
 * ── THE THREE LICENCES, AND WHY "STRUCTURE" IS BUILT DIFFERENTLY ───────────
 *
 * `structure` promises the author's sentences come back byte for byte. That is
 * a promise about text an LLM is holding, and the ordinary way to keep it — ask
 * for the structured document, then diff it against the original — is a promise
 * you discover you have broken AFTER the model has already rewritten a clause.
 * Worse, it fails in the direction nobody checks: the output reads well, so it
 * ships, and the tenant's chosen SEO phrasing is quietly gone.
 *
 * This does not ask for the prose back at all. It splits the body into
 * paragraphs HERE, sends the numbered paragraphs, and asks only WHERE the
 * headings belong — `{ start_paragraph, title }`. The long description is then
 * rebuilt in this file by inserting those headings between the author's own
 * untouched paragraphs. The model never holds the prose it is structuring, so
 * preservation is a property of the construction rather than something we hope
 * for and audit. `assembleStructured` is that step, and its test pins it.
 *
 * `tighten` and `rewrite` DO return prose, because that is what the author
 * asked for, and this file makes no preservation claim about either.
 *
 * ── TONE ───────────────────────────────────────────────────────────────────
 *
 * Weighted axes rather than a single "voice" label, and deliberately NOT
 * percentages. "50% technical, 20% marketing" reads like control and is not:
 * nothing downstream can honour the arithmetic, the numbers have to be made to
 * sum to a hundred, and the model treats them as vibes regardless. Three
 * settings per axis is what an instruction can actually carry.
 *
 * `corridor` and `plain` are the two that matter most here and are the two
 * nobody asks for. Corridor relevance is the only axis a competitor cannot copy
 * — Douala, the hinterland, OHADA, francophone trade. Plain language is the one
 * that serves the reason this feature exists at all.
 */
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const llm = require("../../../services/ai/llm.service");
const governance = require("../../ai/governance/governance.service");
/* Required lazily. `service_type_web.validator` is the natural home for these
   numbers, but binding this module's own request schema onto a route means the
   validator ends up wanting THIS file — and a plain cycle leaves whichever
   loads second holding `undefined` for LIMITS, at require time, which is a
   crash on boot rather than a test failure. */
let _limits = null;
function limits() {
  if (!_limits) _limits = require("./service_type_web.validator").LIMITS;
  return _limits;
}

const FEATURE_KEY = "service_page_copy";

/**
 * FAQs asked of the model per language.
 *
 * Four, not twelve. The column allows twelve, but a FAQ block is read by
 * someone scanning for one specific worry, and a wall of twelve is the same
 * wall of text this whole feature exists to break up. Four the author can
 * actually review, and they can add more by hand.
 */
const FAQ_TARGET = 4;

/** Axis → the sentence the model is actually given. */
const TONE_AXES = {
  operational: {
    label: "operational and technical accuracy",
    light: "Name the real stages and what happens at each. Do not drift into abstraction.",
    strong:
      "Lead with process. Name every stage, document and hand-off precisely, in the order it happens. Accuracy outranks polish.",
  },
  commercial: {
    label: "commercial persuasion",
    light: "State the benefit plainly once per section. No superlatives.",
    strong:
      "Make the reason to choose this provider explicit: what the reader avoids, what they gain, what reassurance they get. Never invent a claim, a figure, a client or a credential.",
  },
  seo: {
    label: "search coverage",
    light: "Use the service's natural terms in headings without forcing them.",
    strong:
      "Cover the terms a buyer would search: the service name, its synonyms, the stages, the cargo types and the places served. Put them in headings and opening sentences. Never keyword-stuff — a sentence that reads badly has failed.",
  },
  corridor: {
    label: "corridor and local relevance",
    light: "Mention the corridor served where it is genuinely relevant.",
    strong:
      "Ground the copy in the corridor this operator actually serves — Douala and the Cameroonian ports, the hinterland and the landlocked destinations beyond it, OHADA-region trade and francophone business practice. Only where it is true of the service described.",
  },
  plain: {
    label: "plain language",
    light: "Prefer short sentences. Explain jargon on first use.",
    strong:
      "Write for a reader in a hurry. Short sentences, one idea each. No jargon without a plain gloss. No sentence over about twenty-five words. Cut every phrase that carries no information.",
  },
};

const LEVEL = z.enum(["off", "light", "strong"]);
const LANG = z.enum(["en", "fr"]);

const aiCopySchema = z
  .object({
    /** `existing` works from what is in the boxes; `scratch` ignores them. */
    source: z.enum(["existing", "scratch"]),
    /** Meaningless for `scratch`, which has no prose to preserve. */
    licence: z.enum(["structure", "tighten", "rewrite"]).optional(),
    /**
     * `each` reads and structures each language in its own right, so the French
     * keeps its own register rather than reading as a translation. `extend`
     * uses `primary` as the source and produces the other side from it — which
     * is what you want when only one language has been written.
     */
    language_mode: z.enum(["each", "extend"]).default("each"),
    primary: LANG.default("en"),
    tone: z
      .object({
        operational: LEVEL.default("strong"),
        commercial: LEVEL.default("light"),
        seo: LEVEL.default("strong"),
        corridor: LEVEL.default("light"),
        plain: LEVEL.default("strong"),
      })
      // Strict, like every other body shape here: an axis this file does not
      // know is a caller that thinks it is asking for something, and dropping
      // it silently means the draft comes back in a tone nobody chose.
      .strict()
      .default({}),
    /** Anything the author wants to say to the model in their own words. */
    instructions: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((v) => v.source === "scratch" || Boolean(v.licence), {
    message: "licence is required when working from existing content",
    path: ["licence"],
  });

/* ── paragraph handling ─────────────────────────────────────────────────── */

/**
 * Split a body into paragraphs, keeping any heading the author already wrote as
 * a paragraph of its own so re-running does not stack `##` on `##`.
 */
function toParagraphs(src) {
  return String(src || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Strip markdown a previous run added, so a re-run structures the prose afresh. */
function stripStructure(src) {
  return toParagraphs(src)
    .filter((p) => !/^#{1,6}\s/.test(p))
    .join("\n\n");
}

/**
 * Rebuild the body by inserting headings between the author's own paragraphs.
 *
 * THE AUTHOR'S TEXT IS COPIED, NEVER REGENERATED — this function is the entire
 * basis of the `structure` licence's promise, and the reason the model is not
 * asked for prose at all. Anything it returns that is not a position and a
 * title is discarded here.
 */
function assembleStructured(paragraphs, sections) {
  const at = new Map();
  for (const s of sections || []) {
    const i = Number(s && s.start_paragraph);
    const title = String((s && s.title) || "").trim().replace(/^#+\s*/, "");
    // Out-of-range or duplicate positions are dropped rather than clamped: a
    // heading in the wrong place is worse than a heading missing, and the
    // author can add it themselves.
    if (!Number.isInteger(i) || i < 0 || i >= paragraphs.length) continue;
    if (!title || at.has(i)) continue;
    at.set(i, title);
  }
  const out = [];
  paragraphs.forEach((p, i) => {
    if (at.has(i)) out.push(`## ${at.get(i)}`);
    out.push(p);
  });
  return out.join("\n\n");
}

/* ── prompt ─────────────────────────────────────────────────────────────── */

function toneLines(tone) {
  const lines = [];
  for (const [key, axis] of Object.entries(TONE_AXES)) {
    const level = (tone && tone[key]) || "off";
    if (level === "off") continue;
    lines.push(`- ${axis.label}: ${axis[level]}`);
  }
  return lines.length
    ? `Emphasis, strongest first:\n${lines.join("\n")}`
    : "No particular emphasis.";
}

const houseRules = () => [
  "Never invent a figure, a transit time, a tonnage, a certification, a client name or a year in business. If you do not have it, do not write it.",
  "Write for a freight forwarder's own website, in the first person plural.",
  `Headings are plain sentence-case labels — no numbering, no markdown inside them.`,
  `Highlights are short noun phrases, ${limits().HIGHLIGHTS_MAX} at the very most, one line each.`,
  `The short description is at most ${limits().SHORT_DESCRIPTION_MAX} characters and works as a card teaser and a meta-description fallback.`,
  `meta_title is at most ${limits().META_TITLE_MAX} characters; meta_description at most ${limits().META_DESCRIPTION_MAX}.`,
  `claim is ONE sentence, at most ${limits().CLAIM_MAX} characters — the line the services-page card closes on.`,
  `Exactly ${FAQ_TARGET} FAQ entries. Answer what a buyer actually asks before committing — what is included, what it costs them in time, what documents they must provide, what happens when something goes wrong. Never a question whose answer is a figure you would have to invent.`,
  `A FAQ question is at most ${limits().QUESTION_MAX} characters and an answer at most ${limits().ANSWER_MAX}; keep answers to a short paragraph.`,
];

function languageName(lang) {
  return lang === "fr" ? "French" : "English";
}

/**
 * The derived layer — everything that is NOT the body prose. Asked for in every
 * mode, because it is the scannable half of the page and no licence protects it
 * (there is nothing to protect: these fields are usually empty).
 */
const DERIVED_SHAPE =
  `"short_description":"","highlights":["",""],"coverage":"","meta_title":"","meta_description":"","claim":"",` +
  `"faq":[{"question":"","answer":""}]`;

function buildStructurePrompt({ lang, paragraphs, tone, instructions }) {
  const numbered = paragraphs.map((p, i) => `[${i}] ${p}`).join("\n\n");
  return [
    `You are structuring an existing ${languageName(lang)} service page for a logistics company.`,
    "",
    "YOU MUST NOT REWRITE, REORDER, SHORTEN OR TRANSLATE ANY PARAGRAPH. The paragraphs are numbered and will be re-assembled from the originals; nothing you write replaces them.",
    "",
    "Your job is to say where section headings belong and to write the scannable layer around them.",
    "",
    toneLines(tone),
    instructions ? `\nThe author adds: ${instructions}` : "",
    "",
    "RULES:",
    ...houseRules().map((r) => `- ${r}`),
    `- Every heading must be in ${languageName(lang)}.`,
    "- A heading marks the START of the paragraph whose index you give. Do not put one at index 0 unless the very first paragraph truly opens a section.",
    "- Aim for a heading every three to five paragraphs. Long runs with no heading are the problem you are solving.",
    "- The highlights and the short description must describe what the paragraphs actually say. Do not introduce a service, a place or a capability that is not in them.",
    "",
    "PARAGRAPHS:",
    numbered,
    "",
    `Return ONLY JSON: {"sections":[{"start_paragraph":0,"title":""}],${DERIVED_SHAPE}}`,
  ].join("\n");
}

function buildProsePrompt({ lang, body, licence, tone, instructions, serviceName, fromLang, fromBody }) {
  const rewriting = licence === "rewrite";
  const translating = Boolean(fromBody);
  const head = translating
    ? `Write the ${languageName(lang)} version of a logistics service page. The ${languageName(fromLang)} version is given below as the source. Produce ${languageName(lang)} that reads as though it were written in ${languageName(lang)} — not as a translation. Keep the same sections and the same facts.`
    : rewriting
      ? `Rewrite an existing ${languageName(lang)} service page for a logistics company. You may restructure and rephrase freely; keep every fact.`
      : `Tighten an existing ${languageName(lang)} service page for a logistics company. Cut repetition, split overlong paragraphs and add section headings. Keep the author's voice and every fact; do not add new claims.`;
  return [
    head,
    serviceName ? `The service is: ${serviceName}.` : "",
    "",
    toneLines(tone),
    instructions ? `\nThe author adds: ${instructions}` : "",
    "",
    "RULES:",
    ...houseRules().map((r) => `- ${r}`),
    `- The body uses markdown: "## " for section headings, "- " for bullets, "**" for emphasis. Separate every block with a blank line.`,
    "- Do not write a level-1 heading; the page prints its own title.",
    `- Everything you write must be in ${languageName(lang)}.`,
    "",
    translating ? `SOURCE (${languageName(fromLang)}):` : "CURRENT TEXT:",
    String(fromBody || body || "").slice(0, 40000),
    "",
    `Return ONLY JSON: {"long_description":"",${DERIVED_SHAPE}}`,
  ].join("\n");
}

function buildScratchPrompt({ lang, tone, instructions, serviceName, serviceKey }) {
  return [
    `Write a ${languageName(lang)} service page for a logistics company (freight forwarding, customs and transport).`,
    `The service is: ${serviceName || serviceKey}.`,
    "",
    toneLines(tone),
    instructions ? `\nThe author adds: ${instructions}` : "",
    "",
    "RULES:",
    ...houseRules().map((r) => `- ${r}`),
    `- The body uses markdown: "## " for section headings, "- " for bullets. Separate every block with a blank line.`,
    "- Do not write a level-1 heading; the page prints its own title.",
    "- Six to ten sections. Describe what the service IS and how it runs, stage by stage.",
    "- Everything must be true of any competent operator selling this service. This is a first draft for a human to correct, not a set of promises.",
    `- Everything you write must be in ${languageName(lang)}.`,
    "",
    `Return ONLY JSON: {"long_description":"",${DERIVED_SHAPE}}`,
  ].join("\n");
}

/* ── model call ─────────────────────────────────────────────────────────── */

const faqSchema = z
  .array(
    z.object({
      question: z.string().trim().min(1),
      answer: z.string().trim().min(1),
    }).passthrough(),
  )
  .optional();

const derivedSchema = z.object({
  faq: faqSchema,
  short_description: z.string().trim().max(limits().SHORT_DESCRIPTION_MAX * 2).optional(),
  highlights: z.array(z.string().trim().min(1)).optional(),
  coverage: z.string().trim().max(limits().COVERAGE_MAX * 2).optional(),
  meta_title: z.string().trim().max(limits().META_TITLE_MAX * 3).optional(),
  meta_description: z.string().trim().max(limits().META_DESCRIPTION_MAX * 3).optional(),
  claim: z.string().trim().max(limits().CLAIM_MAX * 3).optional(),
});
const structureSchema = derivedSchema.extend({
  sections: z
    .array(z.object({ start_paragraph: z.number(), title: z.string() }).passthrough())
    .optional(),
});
const proseSchema = derivedSchema.extend({
  long_description: z.string().trim().min(1),
});

/** Models fence their JSON however they feel like it. */
function parseJson(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(raw);
  } catch {
    // A model that wrapped the object in a sentence — take the outermost braces.
    const a = raw.indexOf("{");
    const b = raw.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try {
      return JSON.parse(raw.slice(a, b + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Trim the derived fields to what the column will actually accept.
 *
 * Cut on a word boundary rather than mid-word: these land in a review panel the
 * author reads, and `…logistics coordina` reads as a bug in the product rather
 * than as a draft to edit.
 */
function clip(text, max) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

/** The FAQ the model returned for one language, clipped to the columns. */
function shapeFaq(out) {
  if (!Array.isArray(out.faq)) return [];
  return out.faq
    .map((r) => ({
      question: clip(r && r.question, limits().QUESTION_MAX),
      answer: clip(r && r.answer, limits().ANSWER_MAX),
    }))
    .filter((r) => r.question && r.answer)
    .slice(0, limits().FAQ_MAX);
}

function shapeDerived(out, lang) {
  const suffix = `_${lang}`;
  const result = {};
  if (out.short_description) result[`short_description${suffix}`] = clip(out.short_description, limits().SHORT_DESCRIPTION_MAX);
  if (out.coverage) result[`coverage${suffix}`] = clip(out.coverage, limits().COVERAGE_MAX);
  if (out.meta_title) result[`meta_title${suffix}`] = clip(out.meta_title, limits().META_TITLE_MAX);
  if (out.meta_description) result[`meta_description${suffix}`] = clip(out.meta_description, limits().META_DESCRIPTION_MAX);
  if (out.claim) result[`claim${suffix}`] = clip(out.claim, limits().CLAIM_MAX);
  if (Array.isArray(out.highlights) && out.highlights.length) {
    result[`highlights${suffix}`] = out.highlights
      .map((h) => clip(h, 280))
      .filter(Boolean)
      .slice(0, limits().HIGHLIGHTS_MAX);
  }
  return result;
}

async function callModel(client, prompt) {
  const out = await llm.chat({
    client,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    responseFormat: { type: "json_object" },
  });
  return { parsed: parseJson(out && out.text), raw: out };
}

/**
 * Draft one language.
 *
 * Returns the profile-shaped patch for that language plus whether the prose was
 * preserved by construction — which is only ever true on the `structure` path,
 * and is what the review panel tells the author.
 */
async function draftLanguage(client, { lang, body, opts, serviceName, serviceKey, fromLang, fromBody }) {
  const { source, licence, tone, instructions } = opts;

  // `!fromBody` is load-bearing. The structure licence preserves EXISTING
  // prose, and the target of an "extend one to the other" has none — that is
  // what makes it the target. Without this guard the French job entered the
  // structure branch with `body` undefined, found zero paragraphs, returned
  // null without ever calling the model, and was reported to the author as
  // "one language did not come back". The extend target belongs on the prose
  // path below, where `fromBody` is the source it is written from.
  if (source === "existing" && licence === "structure" && !fromBody) {
    const paragraphs = toParagraphs(stripStructure(body));
    // Nothing to work from is not a failure — say so distinctly, so the review
    // step does not warn about a language the author simply had not written.
    if (!paragraphs.length) return { skipped: true };
    const { parsed, raw } = await callModel(
      client,
      buildStructurePrompt({ lang, paragraphs, tone, instructions }),
    );
    const ok = parsed && structureSchema.safeParse(parsed);
    if (!ok || !ok.success) return { failed: true, raw };
    return {
      raw,
      mode: "structured",
      faq: shapeFaq(ok.data),
      patch: {
        [`long_description_${lang}`]: assembleStructured(paragraphs, ok.data.sections),
        ...shapeDerived(ok.data, lang),
      },
    };
  }

  const prompt =
    source === "scratch"
      ? buildScratchPrompt({ lang, tone, instructions, serviceName, serviceKey })
      : buildProsePrompt({ lang, body, licence, tone, instructions, serviceName, fromLang, fromBody });
  const { parsed, raw } = await callModel(client, prompt);
  const ok = parsed && proseSchema.safeParse(parsed);
  if (!ok || !ok.success) return { failed: true, raw };
  return {
    raw,
    // "written" had no prose of the author's to preserve (drafted from scratch,
    // or the target of an extend); "rewritten" did and changed it. The
    // difference is the whole of what the review banner promises, so it is not
    // collapsed into one boolean here.
    mode: source === "scratch" || fromBody ? "written" : "rewritten",
    faq: shapeFaq(ok.data),
    patch: {
      [`long_description_${lang}`]: clip(ok.data.long_description, limits().LONG_DESCRIPTION_MAX),
      ...shapeDerived(ok.data, lang),
    },
  };
}

/**
 * Draft website copy for one service type. NOTHING IS WRITTEN — the proposal
 * goes back to the tab for the author to accept field by field, because a
 * generator that saves is a generator that overwrites, which is the defect this
 * whole screen was just repaired for.
 */
async function draft(client, { profile, serviceType, input, actor = {}, env = "live" }) {
  const parsed = aiCopySchema.safeParse(input || {});
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid body", 422, parsed.error.flatten().fieldErrors);
  }
  const opts = parsed.data;

  // Sandbox has no vendor keys and should never spend a live budget.
  if (env !== "live") {
    return { manual_required: true, reason: "AI drafting is not available in the test environment.", sandbox: true };
  }
  const gate = await governance.canUseFeature(client, {
    userId: actor.user_id,
    featureKey: FEATURE_KEY,
  });
  if (!gate.allowed) throw new AppError("AI_UNAVAILABLE", gate.reason || "AI drafting unavailable", 403);

  const serviceName = (serviceType && (serviceType.name_en || serviceType.name_fr)) || "";
  const serviceKey = (serviceType && serviceType.service_type_key) || "";
  const bodies = {
    en: (profile && profile.long_description_en) || "",
    fr: (profile && profile.long_description_fr) || "",
  };

  // Which languages to produce, and from what.
  const jobs = [];
  if (opts.source === "scratch") {
    jobs.push({ lang: "en" }, { lang: "fr" });
  } else if (opts.language_mode === "extend") {
    const from = opts.primary;
    const to = from === "en" ? "fr" : "en";
    if (bodies[from].trim()) {
      jobs.push({ lang: from, body: bodies[from] });
      jobs.push({ lang: to, fromLang: from, fromBody: bodies[from] });
    }
  } else {
    for (const lang of ["en", "fr"]) {
      if (bodies[lang].trim()) jobs.push({ lang, body: bodies[lang] });
    }
  }

  if (!jobs.length) {
    throw new AppError(
      "VALIDATION_ERROR",
      "There is no copy to work from. Write something first, or choose to draft from scratch.",
      422,
    );
  }

  const results = await Promise.all(
    jobs.map((j) =>
      draftLanguage(client, { ...j, opts, serviceName, serviceKey }).catch((e) => ({ error: e })),
    ),
  );

  const patch = {};
  const faqByLang = { en: [], fr: [] };
  const languages = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let provider = null;
  // "Nothing of yours was reworded." A language WRITTEN from scratch or
  // extended from the other had no prose of the author's to preserve, so it
  // does not falsify the claim; only a "rewritten" one does. Collapsing those
  // two into a single boolean is what would make the banner lie in both
  // directions at once.
  let reworded = false;

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    if (r && r.skipped) {
      // The author had written nothing in this language. Not a failure, and
      // warning about it would teach them to ignore the warning.
      languages.push({ lang: jobs[i].lang, ok: true, mode: "skipped" });
      continue;
    }
    if (!r || r.error || r.failed || !r.patch) {
      languages.push({ lang: jobs[i].lang, ok: false });
      if (r && r.raw) {
        inputTokens += Number(r.raw.usage?.prompt_tokens || 0);
        outputTokens += Number(r.raw.usage?.completion_tokens || 0);
        provider = provider || r.raw.provider;
      }
      continue;
    }
    Object.assign(patch, r.patch);
    if (Array.isArray(r.faq) && r.faq.length) faqByLang[jobs[i].lang] = r.faq;
    languages.push({ lang: jobs[i].lang, ok: true, mode: r.mode });
    if (r.mode === "rewritten") reworded = true;
    inputTokens += Number(r.raw?.usage?.prompt_tokens || 0);
    outputTokens += Number(r.raw?.usage?.completion_tokens || 0);
    provider = provider || r.raw?.provider || null;
  }

  const any = languages.some((l) => l.ok && l.mode !== "skipped");
  await governance.recordUsage(client, {
    userId: actor.user_id || null,
    featureKey: FEATURE_KEY,
    provider,
    callType: FEATURE_KEY,
    inputTokens,
    outputTokens,
    wasSuccessful: any,
    errorCode: any ? null : "INVALID_GENERATION",
  });

  if (!any) {
    return {
      manual_required: true,
      reason: "The draft came back in a shape we could not use. Nothing has been changed — try again.",
      provider,
    };
  }

  /**
   * One FAQ row carries BOTH languages — `replaceFaq` requires all four fields
   * — so a row can only be offered where the English and the French both came
   * back. Paired by position, which is sound because each language was asked
   * for the same questions in the same order, and truncated to the shorter
   * side rather than padded: a row with an empty French answer is a row the
   * server refuses, and offering it would put the failure at Save time.
   *
   * When only one language was drafted there is no FAQ to propose. That is
   * stated in the result rather than left as a silently missing section.
   */
  const pairs = Math.min(faqByLang.en.length, faqByLang.fr.length);
  const faq = Array.from({ length: pairs }, (_, i) => ({
    question_en: faqByLang.en[i].question,
    question_fr: faqByLang.fr[i].question,
    answer_en: faqByLang.en[i].answer,
    answer_fr: faqByLang.fr[i].answer,
    sort_order: i * 10,
  }));

  return {
    manual_required: false,
    provider,
    languages,
    faq,
    /** Why there is no FAQ, when there is copy but no pair to build one from. */
    faq_unavailable:
      pairs === 0 && (faqByLang.en.length > 0 || faqByLang.fr.length > 0)
        ? "single_language"
        : undefined,
    // "Nothing you wrote was reworded" — true when no language took a rewrite
    // path over the author's own prose.
    prose_preserved: !reworded,
    proposal: patch,
  };
}

/**
 * Request validator for the drafting endpoint.
 *
 * Bound here rather than in `service_type_web.validator` because that file is
 * about what a COLUMN accepts and this is about prompts and tone axes — and
 * because the two requiring each other is the cycle the lazy `limits()` above
 * exists to survive. The route binds it as `validateAiCopy`, which is the name
 * the write-route gate looks for.
 */
function validateAiCopy(req, _res, next) {
  const parsed = aiCopySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return next(
      new AppError("VALIDATION_ERROR", "Invalid body", 422, parsed.error.flatten().fieldErrors),
    );
  }
  req.body = parsed.data;
  return next();
}

module.exports = {
  draft,
  schema: aiCopySchema,
  validateAiCopy,
  FEATURE_KEY,
  TONE_AXES,
  // Exported for the tests that pin the preservation guarantee.
  assembleStructured,
  toParagraphs,
  stripStructure,
  clip,
  parseJson,
};
