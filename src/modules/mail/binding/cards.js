/**
 * Read-only ERP action cards (§7.3).
 *
 * v1 cards READ. They never write. What they offer is a deep-link into the
 * owning module's screen with prefilled query parameters, so the record is
 * created there, under its own lifecycle, numbering, approval chain and audit —
 * exactly as `BUILD_CONVENTIONS.md` §1–§5 requires.
 *
 * ── THE MISSING-DATA RULE, WHICH IS THE POINT OF THE FILE ───────────────────
 *
 * Before offering an action a card asks whether it could actually be completed,
 * and answers in one of exactly two ways — never a third:
 *
 *   ready: true   → "Create proforma" opens the module screen prefilled.
 *   ready: false  → "I can start a proforma but I need 2 things: Incoterm,
 *                    Place of delivery", with inline inputs, and the button
 *                    STILL says "Create proforma".
 *
 * §7.3, verbatim: it MUST NOT "guess a missing value, substitute a default, or
 * open a form silently missing fields. If the thread does not say the incoterm,
 * the card says the thread does not say the incoterm."
 *
 * A disabled button with no explanation is the third way, and it is the one
 * users complain about, because it gives them nothing to act on.
 *
 * ── ONE FILE PER CARD ───────────────────────────────────────────────────────
 *
 * §7.3: "Each declares its readiness rule in
 * src/modules/mail/binding/cards/<card>.js — one file per card, so adding a
 * card is a file." Two of the seven existed and both were inline here. The
 * registry below is now a directory read, so a new card is a new file and
 * nothing else.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { factsFor } = require("./cards/_facts");

const DIR = path.join(__dirname, "cards");

/**
 * Load every card, once.
 *
 * Files beginning `_` are shared helpers, not cards. A card with no `key` is a
 * mistake worth failing loudly at boot rather than a card that never appears.
 */
const CARDS = fs.readdirSync(DIR)
  .filter((f) => f.endsWith(".js") && !f.startsWith("_"))
   
  .map((f) => require(path.join(DIR, f)))
  .reduce((acc, card) => {
    if (!card || !card.key) throw new Error(`mail card in ${DIR} has no key`);
    acc[card.key] = card;
    return acc;
  }, {});

const KEYS = Object.keys(CARDS).sort();

/**
 * Pure: facts + a card → what the UI should draw.
 *
 * `why` comes from the card's own declaration rather than being generated from
 * the field name, because "not stated in this thread" and "the dossier has no
 * delivery place yet" are different sentences that send the operator to
 * different places. A generated string would say neither.
 */
function readinessFrom(facts, cardKey) {
  const card = CARDS[cardKey];
  if (!card) {
    return { ready: false, missing: [{ field: "card", label: cardKey, why: "unknown card" }] };
  }

  const prefill = {};
  const missing = [];
  for (const f of card.fields) {
    const v = facts[f.field];
    if (v === null || v === undefined || v === "") {
      missing.push({ field: f.field, label: f.label, why: f.why });
    } else {
      prefill[f.field] = v;
    }
  }

  return {
    card: card.key,
    label_en: card.label_en,
    label_fr: card.label_fr,
    ready: missing.length === 0,
    target: card.target,
    prefill,
    missing,
    // Stated in the payload rather than left to the UI to remember. A client
    // that forgets would be the only thing standing between a card and a write.
    read_only: card.readOnly !== false,
  };
}

/** Every card that makes sense for this thread, with its readiness. */
async function forThread(client, threadId) {
  const facts = await factsFor(client, threadId);
  if (!facts) return { thread_id: threadId, cards: [] };

  const cards = KEYS
    .filter((k) => (typeof CARDS[k].appliesTo === "function" ? CARDS[k].appliesTo(facts) : true))
    .map((k) => readinessFrom(facts, k));

  return { thread_id: threadId, entity_ref: facts.entity_ref, cards };
}

/** One card, for the "I need 2 things" panel when the user expands it. */
async function readiness(client, threadId, cardKey) {
  const facts = await factsFor(client, threadId);
  return readinessFrom(facts || {}, cardKey);
}

module.exports = { CARDS, KEYS, readinessFrom, readiness, forThread, factsFor };
