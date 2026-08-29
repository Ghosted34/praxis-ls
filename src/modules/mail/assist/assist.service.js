/**
 * THE MAIL AI ENGINE (§8).
 *
 * ── WHAT THIS FILE REPLACED ─────────────────────────────────────────────────
 *
 * The previous version of this file was a facade, and the shape is worth naming
 * precisely, because the shape is what made it look finished:
 *
 *   · `compose()` resolved a PROMPT STRING from `assist.prompts` and returned
 *     it. No model was called. The client received an instruction meant for a
 *     model and rendered it as a draft.
 *   · `draft()` returned whatever `facts` array it was handed — and the route
 *     never passed one, so EVERY draft request took the "this thread is not
 *     bound to a record" branch. That branch was correct code that could not be
 *     reached from any other state.
 *   · `assist.grounding` was required and then used only inside an `if` whose
 *     body was a comment. No whitelisted read ever ran.
 *   · The fact-fence therefore compared generated text against an EMPTY fact
 *     list on every call. An empty fence passes trivially when the draft is
 *     also empty, which it always was.
 *
 * Every leaf module around it — the fence, the glossary, the guardrails, the
 * prompt catalogue — was correct. There was simply no engine between them.
 *
 * ── THE ORDER OF OPERATIONS IS THE PRODUCT ──────────────────────────────────
 *
 * Every generating path in this file runs the same five steps in the same
 * order, and the order is not rearrangeable:
 *
 *   1. GATE      two-level, via `ai/governance`. §3.3: "an AI flag is a floor,
 *                not a ceiling." `mail.ai` ON with `ai.assistant.backend` OFF
 *                means AI stays OFF.
 *   2. GROUND    execute `assist.grounding.collect` — RBAC-checked, per source,
 *                against the caller. This is the only way a fact enters a
 *                prompt.
 *   3. GENERATE  `services/ai/llm.service.chat`, with the facts as the system
 *                message and an explicit instruction not to state anything
 *                absent from them.
 *   4. FENCE     `assist.factfence.fence(draft, facts)`. A model told not to
 *                invent still invents. The fence is mechanical, and it runs on
 *                the REAL generated text — which is the part that never
 *                happened before.
 *   5. METER     `governance.recordUsage` with `feature_key = 'mail_ai'` and a
 *                `call_type` sub-type, on success AND on failure (§8.2). A
 *                failed call still cost tokens; not recording it is how a
 *                budget silently under-reports.
 *
 * ── WHAT THIS FILE MAY NOT DO ───────────────────────────────────────────────
 *
 * Write a business record. Not one, on any path, at any confidence. The draft
 * lands in the composer and a human presses send. `tests/unit/mail-ai-nowrite`
 * asserts the absence of the requires that would make it possible.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");
const fence = require("./assist.factfence");
const glossary = require("./assist.glossary");
const grounding = require("./assist.grounding");
const guardrails = require("./assist.guardrails");
const prompts = require("./assist.prompts");
const { resolveLanguage } = require("../signature/language");
const governance = require("../../ai/governance/governance.service");
const llm = require("../../../services/ai/llm.service");
const transcription = require("../../../services/ai/transcription.service");
const { parseDataUrl } = require("../../../utils/data-url");
const { emitEvent } = require("../../../shared/events/emit");

/**
 * The metering key. §8.2 requires `feature = 'mail_ai'` with a sub-type, and
 * the sub-type is `call_type` — so a finance lead can see that the month's mail
 * spend was 80% translation and decide something about it, which a single
 * undifferentiated total does not let them do.
 */
const FEATURE = "mail_ai";

/** How many new messages force a stale summary to be regenerated (§8.5). */
const SUMMARY_TRIGGER = 5;

/* ── 1. The gate ───────────────────────────────────────────────────────────── */

/**
 * Two-level, and in this order.
 *
 * The FLOOR is mail's own `mail.ai` switch: a tenant that has AI generally but
 * does not want it in the mailbox turns this off. The CEILING is
 * `governance.canUseFeature`, which resolves the platform console's
 * `ai.assistant.backend` entitlement, the tenant's own `ai_feature_flag`
 * preference, the caller's access grant, the tenant budget cap AND the plan's
 * spend limit — five checks that already exist, and that a hand-rolled
 * `SELECT state FROM feature_state` reimplemented as one.
 *
 * The previous implementation queried `feature_state` for both keys directly.
 * That got the two-level SEMANTICS right and skipped the budget entirely, so a
 * tenant past their hard cap kept drafting.
 */
async function assertAiOn(client, user = null) {
  const floor = await client.query(
    "SELECT state FROM feature_state WHERE feature_key = 'mail.ai'",
  );
  if (!floor.rows[0] || floor.rows[0].state !== "on") {
    throw new AppError("FEATURE_DISABLED", "Mail AI is off for this tenant.", 403);
  }

  const gate = await governance.canUseFeature(client, {
    userId: user && user.user_id,
    featureKey: FEATURE,
  });
  if (!gate.allowed) {
    // The reason is surfaced verbatim: "the plan's AI spend limit for this
    // month has been reached" and "your access to this feature was revoked"
    // send the operator to two different people, and a generic
    // "AI unavailable" sends them to neither.
    throw new AppError("AI_UNAVAILABLE", `Mail AI is unavailable: ${gate.reason || "not enabled"}.`, 403);
  }
  return gate;
}

/* ── 2. Grounding ──────────────────────────────────────────────────────────── */

const CTX_SQL = `
  SELECT t.email_thread_id, t.subject, t.entity_ref,
         c.client_id, c.preferred_language AS client_language,
         d.dossier_id, d.client_id AS dossier_client_id,
         s.supplier_id
    FROM email_thread t
    LEFT JOIN client_master   c ON t.entity_ref = 'client:'   || c.client_id::text
    LEFT JOIN dossier_visible d ON t.entity_ref = 'dossier:'  || d.dossier_id::text
    LEFT JOIN supplier_master s ON t.entity_ref = 'supplier:' || s.supplier_id::text
   WHERE t.email_thread_id = $1`;

/**
 * What the thread is bound to, and nothing more.
 *
 * `dossier_visible` rather than `dossier` — the visibility view, so a draft
 * cannot be grounded in a file the caller is not entitled to see. Mail's §9.5
 * predicate and the AI path have to agree; joining the base table here would
 * have made the assistant the one place the rule did not hold.
 */
async function threadContext(client, threadId) {
  const { rows } = await client.query(CTX_SQL, [threadId]);
  const r = rows[0];
  if (!r) throw new AppError("NOT_FOUND", "Thread not found", 404);
  return {
    thread_id: r.email_thread_id,
    subject: r.subject,
    entity_ref: r.entity_ref,
    client_id: r.client_id || r.dossier_client_id || null,
    dossier_id: r.dossier_id || null,
    supplier_id: r.supplier_id || null,
    client_language: r.client_language || null,
  };
}

/** The last few messages, oldest first, as the conversation the model is in. */
async function threadMessages(client, threadId, limit = 12) {
  const { rows } = await client.query(
    `SELECT email_message_id, direction, from_address, subject, body_text, received_at
       FROM email_message
      WHERE email_thread_id = $1
      ORDER BY received_at DESC
      LIMIT $2`,
    [threadId, limit],
  );
  return rows.reverse();
}

const transcriptOf = (msgs) => msgs
  .map((m) => `[${m.direction === "OUT" ? "us" : "them"}] ${m.from_address || ""}: ` +
    `${String(m.body_text || "").slice(0, 2000)}`)
  .join("\n---\n");

/* ── 3–5. Generate, fence, meter ───────────────────────────────────────────── */

/**
 * ONE metered call. Every generating function in this file goes through here.
 *
 * Why a single choke point: §8.2's metering requirement is the kind that decays
 * by omission. A second call site that forgot `recordUsage` would not fail any
 * test, would not raise any error, and would silently under-report spend until
 * someone reconciled a vendor invoice by hand. There is one call site, so there
 * is one thing to get right.
 *
 * The `finally` is load-bearing: a vendor timeout after the model has generated
 * still consumed input tokens. Recording only successes is how a budget drifts.
 */
async function generate(client, { user, callType, system, prompt, temperature = 0.2 }) {
  const started = Date.now();
  let out = null;
  let error = null;
  try {
    out = await llm.chat({
      client,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      temperature,
    });
    return out;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    try {
      await governance.recordUsage(client, {
        userId: (user && user.user_id) || null,
        featureKey: FEATURE,
        provider: (out && out.provider) || null,
        callType,
        inputTokens: Number((out && out.usage && out.usage.prompt_tokens) || 0),
        outputTokens: Number((out && out.usage && out.usage.completion_tokens) || 0),
        latencyMs: Date.now() - started,
        wasSuccessful: !error,
        errorCode: error ? (error.code || "LLM_FAILED") : null,
        errorMessage: error ? String(error.message).slice(0, 500) : null,
      });
    } catch (meterErr) {
      // Metering must never be the reason a user loses a draft they can already
      // see on screen. Logged loudly instead, because a silent metering failure
      // is a budget that quietly stops counting.
      logger.error({ err: meterErr, callType }, "mail AI: usage was NOT metered");
    }
  }
}

/**
 * The instruction every generating path shares.
 *
 * The prohibition is stated in the prompt AND enforced by the fence. Neither is
 * sufficient: the prompt reduces how often the model invents, the fence catches
 * it when the prompt does not work, and a system with only the prompt is one
 * that ships fabricated invoice numbers to clients on the tail of the
 * distribution.
 */
function systemFor({ lang, facts, styleInstruction, extra = "" }) {
  const factBlock = facts.length
    ? `FACTS FROM THE RECORD — these are the only facts you may state:\n${facts.map((f) => `· ${f}`).join("\n")}`
    : "FACTS FROM THE RECORD: none are available for this thread.";
  return [
    "You draft business email for a Central African freight forwarder.",
    styleInstruction,
    `Write in ${lang === "fr" ? "French" : "English"}.`,
    factBlock,
    "Do NOT state any reference number, amount, date or percentage that does not appear verbatim above.",
    "If you need a fact you do not have, write the sentence without it rather than estimating.",
    "Preserve Incoterms, container types, currency codes and document references exactly as written.",
    "Return only the body of the email. No subject line, no commentary.",
    extra,
  ].filter(Boolean).join("\n\n");
}

/**
 * Fence + glossary, applied to real generated text, in that order.
 *
 * Fence first because the glossary APPENDS protected terms the model dropped,
 * and a term it appends is by definition not a fabrication — running the fence
 * afterwards would flag our own repair.
 *
 * ── WHY `preserveFrom` IS OPT-IN AND USUALLY NULL ───────────────────────────
 *
 * The glossary's guarantee is about TRANSFORMATION: `assist.glossary`'s own
 * header says protected terms "MUST survive rewriting and translation
 * byte-for-byte". It compares an input text with its transformed output and
 * puts back what the model lost. That relationship only exists when there IS an
 * input text.
 *
 * The first version of this function defaulted `preserveFrom` to the FACT LIST,
 * which looked harmless and was not: on a fresh composition it read every
 * Incoterm, container code and document reference out of the grounding facts,
 * found them absent from a perfectly good two-line email, concluded the model
 * had dropped them, and appended `FOB XAF SLAS-2026-0042 INV-2026-0311` to the
 * end of the draft. A repair mechanism pointed at something it was not
 * repairing produces exactly that: confident, mechanical nonsense.
 *
 * So: `rewrite` and `translate` pass the operator's text. Everything that
 * GENERATES — compose, draft, voice, summary — passes nothing.
 */
function finish(generated, factStrings, preserveFrom = null) {
  const verdict = fence.fence(generated, factStrings);
  const restored = preserveFrom
    ? glossary.restore(preserveFrom, generated)
    : { text: generated, missing: [] };
  return {
    text: restored.text,
    fence: verdict,
    protected_terms_restored: restored.missing,
    // Surfaced, not swallowed. §8.3's contract with the operator is that a
    // fenced draft still arrives — with the unsupported values MARKED — because
    // a blank composer teaches people to stop using the feature, while a marked
    // one teaches them what the assistant does not know.
    needs_review: !verdict.ok,
  };
}

/* ── The endpoints ─────────────────────────────────────────────────────────── */

/**
 * Compose from a tone preset or a rewrite action.
 *
 * Still accepts `action` (grammar / shorten / expand / to_fr / to_en) because
 * the composer toolbar sends one, but it now GENERATES rather than returning
 * the instruction. `prompt` is still returned alongside the draft so the UI can
 * show what was asked — that part of the old contract was fine.
 */
async function compose(client, input = {}, user = null) {
  await assertAiOn(client, user);
  const ctx = input.thread_id ? await threadContext(client, input.thread_id) : {};
  const lang = resolveLanguage({ explicit: input.language, partyLanguage: ctx.client_language });

  const styleInstruction = input.action
    ? prompts.resolveAction(input.action, lang)
    : prompts.resolvePrompt(input.tone || "formal", lang);
  if (!styleInstruction) throw new AppError("UNKNOWN_ACTION", `No such assist action: ${input.action}`, 422);

  const ground = input.thread_id
    ? await grounding.collect(client, ctx, user)
    : { facts: [], sources: [], withheld: [] };
  const factStrings = grounding.factText(ground.facts);

  const seed = input.draft || (input.thread_id
    ? transcriptOf(await threadMessages(client, input.thread_id, 6))
    : "");

  /* ── What the assistant is actually writing ABOUT ─────────────────────────
   *
   * The subject line and the free-text brief (§8.3's "Other…") are the only
   * things a NEW message carries before anyone has typed a body, and neither
   * used to reach this function. So "Write it for me" on a blank composer with
   * `Subject: Demurrage on MSKU4567890 — request for waiver` got no material at
   * all and produced a tone preset applied to nothing: a courteous, fluent
   * email about no subject. Operators read that once and stop pressing the
   * button, which is the worst outcome for a feature that works as soon as it
   * is told what it is for.
   *
   * They go in the SYSTEM message rather than the prompt because they are the
   * assignment, not the material. `seed` is material — text to transform — and
   * a subject line pasted in beside a draft reads to the model as something to
   * rewrite. The recipients follow the same rule and for a stronger reason:
   * addressing a customs broker is not the same letter as addressing a client,
   * and the domain is the only signal available before a thread exists. */
  const brief = [
    input.subject ? `The subject line the operator has already written: "${String(input.subject).trim()}". Write a body that belongs under it, and do not repeat it as a heading.` : "",
    input.to && input.to.length ? `It is addressed to: ${input.to.slice(0, 10).join(", ")}.` : "",
    input.instruction ? `The operator asks specifically: ${String(input.instruction).trim()}` : "",
  ].filter(Boolean).join("\n");

  /* Nothing to write about is not a draft request, and a model call that spends
   * the tenant's budget on it returns the same courteous nothing every time.
   * Say what is missing instead — the operator is one subject line away. */
  if (!seed && !brief) {
    return {
      draft_text: "",
      prompt: styleInstruction,
      language: lang,
      mode: input.mode || "compose",
      tone: input.tone || null,
      action: input.action || null,
      facts: [],
      sources: [],
      withheld: ground.withheld,
      fence: null,
      protected_terms_restored: [],
      needs_review: false,
      note: "Give it something to work from — a subject line, a sentence of your own, or a note in “What should it say?”.",
    };
  }

  const out = await generate(client, {
    user,
    callType: input.action ? `compose.${input.action}` : `compose.${input.tone || "formal"}`,
    system: systemFor({ lang, facts: factStrings, styleInstruction, extra: brief }),
    prompt: seed
      ? `Here is the material to work from:\n\n${seed}`
      : "Draft the email described by the instruction above.",
  });

  // `input.draft` — the operator's own text when they asked for a rewrite via
  // this endpoint — is the only thing here worth preserving terms from. A
  // compose with no draft transforms nothing, so there is nothing to preserve.
  const done = finish(out.text || "", factStrings, input.draft || null);
  return {
    draft_text: done.text,
    prompt: styleInstruction,
    language: lang,
    mode: input.mode || "compose",
    tone: input.tone || null,
    action: input.action || null,
    facts: ground.facts,
    sources: ground.sources,
    withheld: ground.withheld,
    fence: done.fence,
    protected_terms_restored: done.protected_terms_restored,
    needs_review: done.needs_review,
    provider: out.provider,
  };
}

/**
 * Draft a reply to a bound thread — the §8.11(1)(2) path.
 *
 * The unbound case still returns the honest note it always did. The difference
 * is that it is now REACHABLE FROM THE OTHER SIDE: a bound thread produces
 * facts, and a thread with no binding produces the note. Previously only the
 * note existed.
 */
async function draft(client, { threadId, tone, language, instruction } = {}, user = null) {
  await assertAiOn(client, user);
  const ctx = await threadContext(client, threadId);
  const lang = resolveLanguage({ explicit: language, partyLanguage: ctx.client_language });

  const ground = await grounding.collect(client, ctx, user);
  const factStrings = grounding.factText(ground.facts);

  if (!factStrings.length) {
    return {
      draft_text: "",
      facts: [],
      sources: [],
      withheld: ground.withheld,
      confidence: 0,
      language: lang,
      // The two cases are distinguished because they are different problems
      // with different fixes: bind the thread, versus ask an administrator for
      // a grant.
      note: ctx.entity_ref
        ? "This thread is bound, but no ERP source answered — every source was withheld or empty."
        : "This thread is not bound to a record, so no ERP facts were used.",
    };
  }

  const msgs = await threadMessages(client, threadId, 8);
  const out = await generate(client, {
    user,
    callType: "draft.reply",
    system: systemFor({
      lang,
      facts: factStrings,
      styleInstruction: prompts.resolvePrompt(tone || "formal", lang),
      extra: instruction ? `The operator asks specifically: ${instruction}` : "",
    }),
    prompt: `Draft the next reply in this thread. Subject: ${ctx.subject || "(none)"}\n\n${transcriptOf(msgs)}`,
  });

  // No `preserveFrom`: a reply is not a transformation of the incoming email.
  // Appending the client's Incoterms to OUR answer because we did not repeat
  // them would put words in our own mouth.
  const done = finish(out.text || "", factStrings);

  await emitEvent(client, {
    eventTypeKey: "mail.ai.drafted",
    moduleKey: "MOD-72",
    entityRef: `email_thread:${threadId}`,
    actorUserId: (user && user.user_id) || null,
  }).catch(() => ({}));

  return {
    draft_text: done.text,
    facts: ground.facts,
    sources: ground.sources,
    withheld: ground.withheld,
    language: lang,
    tone: tone || "formal",
    fence: done.fence,
    protected_terms_restored: done.protected_terms_restored,
    needs_review: done.needs_review,
    provider: out.provider,
    // Not a model-reported confidence — those are decorative. This says whether
    // every factual token in the draft is supported by the record.
    confidence: done.fence.ok ? 1 : 0.5,
  };
}

/**
 * Rewrite text the operator already wrote (grammar / shorten / expand).
 *
 * Grounded against the thread when one is given, because "shorten this" on a
 * paragraph containing an invoice number must not be free to change the invoice
 * number, and the fence needs the real number to know that it did not.
 */
async function rewrite(client, { threadId, text, action, language } = {}, user = null) {
  await assertAiOn(client, user);
  if (!text || !String(text).trim()) throw new AppError("EMPTY_DRAFT", "There is nothing to rewrite.", 422);
  const ctx = threadId ? await threadContext(client, threadId) : {};
  const lang = resolveLanguage({ explicit: language, partyLanguage: ctx.client_language });

  const styleInstruction = prompts.resolveAction(action, lang);
  if (!styleInstruction) throw new AppError("UNKNOWN_ACTION", `No such assist action: ${action}`, 422);

  const ground = threadId ? await grounding.collect(client, ctx, user) : { facts: [], sources: [], withheld: [] };
  // The operator's own text is itself a fact source for a REWRITE: they are
  // entitled to state whatever they typed, and fencing them against the ERP
  // alone would flag every number they legitimately knew and we did not.
  const factStrings = [...grounding.factText(ground.facts), String(text)];

  const out = await generate(client, {
    user,
    callType: `rewrite.${action}`,
    system: systemFor({ lang, facts: factStrings, styleInstruction }),
    prompt: String(text),
  });

  const done = finish(out.text || "", factStrings, String(text));
  return {
    draft_text: done.text,
    action,
    language: lang,
    fence: done.fence,
    protected_terms_restored: done.protected_terms_restored,
    needs_review: done.needs_review,
    sources: ground.sources,
    provider: out.provider,
  };
}

/**
 * Translate, with the glossary's byte-for-byte guarantee enforced on output.
 *
 * §8.4: an LLM "improving" FOB Douala is the class of error that reaches a
 * customs broker and costs money. `glossary.restore` compares the ORIGINAL's
 * protected terms against the translation and puts back anything the model
 * dropped or localised. That check was written, tested, and never run on real
 * model output — because no model output existed.
 */
async function translate(client, { threadId, text, to, language } = {}, user = null) {
  await assertAiOn(client, user);
  if (!text || !String(text).trim()) throw new AppError("EMPTY_DRAFT", "There is nothing to translate.", 422);
  const target = to === "fr" || to === "en" ? to : null;
  if (!target) throw new AppError("BAD_TARGET", "Translate to 'en' or 'fr'.", 422);

  const ctx = threadId ? await threadContext(client, threadId) : {};
  const styleInstruction = prompts.resolveAction(target === "fr" ? "to_fr" : "to_en",
    resolveLanguage({ explicit: language, partyLanguage: ctx.client_language }));

  const factStrings = [String(text)];
  const out = await generate(client, {
    user,
    callType: `translate.${target}`,
    system: systemFor({ lang: target, facts: factStrings, styleInstruction }),
    prompt: String(text),
  });

  const restored = glossary.restore(String(text), out.text || "");
  return {
    draft_text: restored.text,
    language: target,
    // Named separately from the fence: these are terms the model LOST, which is
    // a translation defect rather than a fabrication.
    protected_terms_restored: restored.missing,
    protected_terms: glossary.termsIn(String(text)),
    fence: fence.fence(out.text || "", factStrings),
    provider: out.provider,
  };
}

/* ── Thread summaries (§8.5) ───────────────────────────────────────────────── */

/**
 * An executive summary of a long thread, cached in `email_thread_summary`.
 *
 * The cache is not an optimisation, it is the feature: §8.5's trigger is that a
 * thread past five messages gets a summary, and that it is REGENERATED when
 * five more arrive. Summarising on every open would cost a model call per read
 * of every long thread in the mailbox — the version of this feature a finance
 * lead switches off in week two.
 *
 * `message_count_at_generation` is what makes the trigger checkable: the row
 * knows how stale it is, so nothing has to remember to invalidate it.
 */
async function summary(client, { threadId, language, force = false } = {}, user = null) {
  await assertAiOn(client, user);
  const ctx = await threadContext(client, threadId);
  const lang = resolveLanguage({ explicit: language, partyLanguage: ctx.client_language });

  const { rows: countRows } = await client.query(
    "SELECT count(*)::int AS n FROM email_message WHERE email_thread_id = $1",
    [threadId],
  );
  const n = (countRows[0] && countRows[0].n) || 0;

  const { rows: cached } = await client.query(
    "SELECT * FROM email_thread_summary WHERE email_thread_id = $1",
    [threadId],
  );
  const have = cached[0];
  const fresh = have
    && have.language === lang
    && (n - have.message_count_at_generation) < SUMMARY_TRIGGER;
  if (have && fresh && !force) {
    return { ...have, cached: true, message_count: n, stale_by: n - have.message_count_at_generation };
  }

  // Below the trigger and never summarised: say so, rather than spending a
  // model call on a two-message thread the operator can read faster than we can
  // summarise it.
  if (!have && n < SUMMARY_TRIGGER && !force) {
    return {
      email_thread_id: threadId, summary: null, language: lang, cached: false,
      message_count: n, not_needed: true,
      note: `Summaries start at ${SUMMARY_TRIGGER} messages. This thread has ${n}.`,
    };
  }

  const msgs = await threadMessages(client, threadId, 40);
  const ground = await grounding.collect(client, ctx, user);
  const factStrings = grounding.factText(ground.facts);
  const convo = transcriptOf(msgs);

  const out = await generate(client, {
    user,
    callType: "summary.thread",
    system: systemFor({
      lang,
      facts: factStrings,
      styleInstruction: "Summarise this email thread for an executive who has not read it. " +
        "Lead with what is being asked of us and by when. Then what was agreed. Then what is outstanding. " +
        "Six sentences at most.",
    }),
    prompt: `Subject: ${ctx.subject || "(none)"}\n\n${convo}`,
  });

  // The THREAD ITSELF is a fact source for a summary — a date someone wrote in
  // an email is a real thing the summary is allowed to repeat, even when no ERP
  // record carries it. Fencing a summary against the ERP alone would flag the
  // correspondence for quoting itself.
  const done = finish(out.text || "", [...factStrings, convo]);

  const { rows } = await client.query(
    `INSERT INTO email_thread_summary
       (email_thread_id, language, summary, message_count_at_generation, model)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email_thread_id) DO UPDATE
        SET language = EXCLUDED.language,
            summary = EXCLUDED.summary,
            message_count_at_generation = EXCLUDED.message_count_at_generation,
            model = EXCLUDED.model,
            generated_at = now()
     RETURNING *`,
    [threadId, lang, done.text, n, out.provider || null],
  );

  await emitEvent(client, {
    eventTypeKey: "mail.ai.summarised",
    moduleKey: "MOD-72",
    entityRef: `email_thread:${threadId}`,
    actorUserId: (user && user.user_id) || null,
  }).catch(() => ({}));

  return { ...rows[0], cached: false, message_count: n, stale_by: 0, needs_review: done.needs_review };
}

/* ── Voice (§8.11(8)) ──────────────────────────────────────────────────────── */

/**
 * Dictated draft: transcript in, email out.
 *
 * The AUDIO is not handled here. `jobs/handlers/ai-transcribe.js` already owns
 * speech-to-text for the whole product, is already metered against its own
 * feature, and already handles the vendor. A second transcription path living
 * in the mail module would be a second thing to keep configured, and the first
 * time they diverged the mailbox would be the one that broke. This endpoint
 * takes the TEXT and turns dictation into correspondence, which is the part
 * that is specific to mail.
 */
/**
 * Speech → text, so that "Dictate" dictates.
 *
 * ── WHY THIS ROUTE EXISTS WHEN `voice` TAKES A TRANSCRIPT ───────────────────
 *
 * `voice` below is the SECOND half of §8.7: transcript → cleaned, toned email.
 * It was built, tested and reachable. The first half — the microphone — was
 * not, so the composer shipped a button labelled "Dictate" over a textarea you
 * had to TYPE into. That is not a smaller version of dictation; it is the
 * opposite of it, and the label promised the thing it could not do.
 *
 * ── THIS IS NOT A SECOND TRANSCRIPTION PATH ─────────────────────────────────
 *
 * `assist.routes` warns against one, and rightly: a second Whisper client with
 * its own key resolution is a second thing to keep configured and the first to
 * break. This is the SAME `services/ai/transcription.service` the HR intake
 * wizard uses — one implementation, one vendor config, one place to change the
 * model. What is new here is only the route in front of it, because
 * `/vacancies/intake/transcribe` is gated on MOD-31 and a mail user has no
 * business holding a recruitment grant to speak into their own composer.
 * `vacancy.routes` anticipated exactly this ("when the second caller appears
 * … it should move"); this is that caller.
 *
 * ── THE AUDIO IS NOT RETAINED (Q30) ─────────────────────────────────────────
 *
 * The buffer lives in this function and nowhere else: no vault write, no
 * temporary file, no column. Only the text comes back, and the caller shows the
 * raw transcript beside the cleaned version so the speaker can see what the
 * tidy-up changed.
 */
async function transcribe(client, { audioDataUrl } = {}, user = null) {
  await assertAiOn(client, user);
  const parsed = parseDataUrl(audioDataUrl);
  if (!parsed) throw new AppError("BAD_AUDIO", "Expected a base64 audio data URL.", 422);
  if (!parsed.buffer.length) {
    throw new AppError("EMPTY_AUDIO", "Nothing was recorded — hold the button while you speak.", 422);
  }
  if (!/^audio\//.test(parsed.mimeType)) {
    throw new AppError("BAD_AUDIO", `Expected audio, got ${parsed.mimeType || "an unlabelled file"}.`, 422);
  }

  const started = Date.now();
  let text = "";
  let error = null;
  try {
    const out = await transcription.transcribe({ audio: parsed.buffer, mimeType: parsed.mimeType });
    text = String((out && out.text) || "").trim();
    return { transcript: text };
  } catch (err) {
    error = err;
    // "Not configured" is the administrator's problem and "the provider failed"
    // is nobody's fault; both have to reach the operator as a sentence they can
    // act on, because a mic button that returns a 500 is one people press until
    // they conclude the product is broken.
    throw new AppError(
      "TRANSCRIPTION_UNAVAILABLE",
      /not configured/i.test((err && err.message) || "")
        ? "Voice input is not set up on this workspace — type your message, or ask an administrator to configure it."
        : "That recording could not be transcribed. Try again, or type your message.",
      502,
    );
  } finally {
    // Metered like every other model call: transcription costs money, and a
    // budget that counts drafting but not dictation under-reports silently.
    try {
      await governance.recordUsage(client, {
        userId: (user && user.user_id) || null,
        featureKey: FEATURE,
        provider: "groq",
        callType: "voice.transcribe",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - started,
        wasSuccessful: !error,
        errorCode: error ? "TRANSCRIPTION_FAILED" : null,
        errorMessage: error ? String(error.message).slice(0, 500) : null,
      });
    } catch (meterErr) {
      logger.error({ err: meterErr }, "mail AI: dictation was NOT metered");
    }
  }
}

async function voice(client, { threadId, transcript: spoken, tone, language } = {}, user = null) {
  await assertAiOn(client, user);
  if (!spoken || !String(spoken).trim()) throw new AppError("EMPTY_TRANSCRIPT", "Nothing was dictated.", 422);
  const ctx = threadId ? await threadContext(client, threadId) : {};
  const lang = resolveLanguage({ explicit: language, partyLanguage: ctx.client_language });

  const ground = threadId ? await grounding.collect(client, ctx, user) : { facts: [], sources: [], withheld: [] };
  const factStrings = [...grounding.factText(ground.facts), String(spoken)];

  const out = await generate(client, {
    user,
    callType: "voice.draft",
    system: systemFor({
      lang,
      facts: factStrings,
      styleInstruction: prompts.resolvePrompt(tone || "formal", lang),
      extra: "The input is a spoken dictation. Remove filler and false starts. " +
        "Do not add substance the speaker did not say.",
    }),
    prompt: String(spoken),
  });

  // Dictation is transcribed, not translated: the speaker said what they said,
  // and a term they used that the tidy-up dropped should come back.
  const done = finish(out.text || "", factStrings, String(spoken));
  return {
    draft_text: done.text,
    language: lang,
    transcript: String(spoken),
    fence: done.fence,
    needs_review: done.needs_review,
    sources: ground.sources,
    provider: out.provider,
  };
}

/* ── Pure re-exports, unchanged ────────────────────────────────────────────── */

const runFence = (draftText, facts) => fence.fence(draftText, facts);
const runGlossary = (original, rewritten) => glossary.restore(original, rewritten);
const runGuardrails = (message, ctx) => guardrails.check(message, ctx);

module.exports = {
  compose, draft, rewrite, translate, summary, voice, transcribe,
  runFence, runGlossary, runGuardrails,
  assertAiOn, threadContext, threadMessages,
  FEATURE, SUMMARY_TRIGGER,
};
