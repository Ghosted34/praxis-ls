/**
 * Citations and a reasoning trace, derived from what the orchestrator ACTUALLY
 * READ — never from what the answer happens to say.
 *
 * THE BUG THIS FIXES. Three surfaces were built to show an answer's grounding —
 * the Sources tab, the Record tab and the footer under every reply
 * (`client/src/features/ai/right-pane.tsx`, `components/ai/turn.tsx`) — and none
 * of them had ever rendered. They derived their citations from markdown links in
 * the prose (`components/ai/grounding.ts`), on the assumption that the model
 * writes `[INV-2026-0031](/finance/invoices/8f2c)`. It does not, and it is told
 * not to: the system prompt in `orchestrator.service.js` says to refer to records
 * by name and to NEVER show raw identifiers. So the footer's only input was a
 * thing the prompt actively suppresses.
 *
 * WHY NOT A PROMPT CHANGE, AND WHY NOT A REGEX.
 *
 *   A prompt change asks the model to be a citation index. It would work often
 *   enough to look fixed and fail silently the rest of the time, and every
 *   failure is a *missing* citation on an answer that reads exactly as confident.
 *
 *   A regex over document references cannot work here even in principle.
 *   Numbering is a per-tenant SETTING — prefix, code, padding and separator are
 *   configured per document type (`client/src/features/settings/numbering.tsx`,
 *   MOD-70) — so a pattern tuned to `SBX-INV-0001` returns nothing for the next
 *   white-label tenant. And it answers the wrong question anyway: matching prose
 *   tells you what the model MENTIONED, which is not what it read. An invoice it
 *   named from conversation history would be cited; a table it read and
 *   summarised without naming a row would not.
 *
 * SO: the orchestrator executes the read actions and holds their results. That
 * is the ground truth, it is already in memory, and it is the same regardless of
 * tenant, model or phrasing. This module turns it into sources and steps.
 *
 * WHAT AN `href` IS, AND WHY IT IS NOT A RECORD URL. The app is hub-based:
 * `app.tsx` routes `/finance/:section`, `/fleet/:section` and so on, and the only
 * record-addressable routes in the whole product are
 * `/master/corporate-entities/:entityId` and `/documents/:docType/:id`. A chip
 * pointing at `/finance/invoices/8f2c` would match no route and land the user on
 * the catch-all redirect to `/` — a citation that silently throws away their
 * place. So the href is the SCREEN the record lives on (which is real and
 * navigable) and the record's identity is carried by the LABEL. When list screens
 * become deep-linkable, `hrefFor` is the one place that changes.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { logger } = require("../../config/logger");

const REGISTRY_PATH = path.resolve(__dirname, "../../../client/src/app/screen-registry.json");

/**
 * `action_key → screen`, the inversion of `screens[].actions[]`.
 *
 * Built once at first use: the registry is a checked-in file, so re-reading it
 * per turn would be I/O for a constant. Best-effort like the rest of the AI
 * layer's file reads (`knowledge/codebase.js` does the same) — a deployment that
 * ships the server without `client/` loses citations, not answers.
 *
 * First declaration wins. An action listed on two screens is a registry bug
 * (`tests/unit/ai-readiness.test.js` fails on it); picking deterministically
 * here means the bug shows up as a consistently odd link rather than one that
 * moves between deploys.
 */
let screenByAction = null;
function actionIndex() {
  if (screenByAction) return screenByAction;
  screenByAction = new Map();
  try {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
    for (const s of reg.screens || []) {
      for (const key of s.actions || []) {
        if (!screenByAction.has(key)) screenByAction.set(key, { title: s.title, route: s.route, purpose: s.purpose });
      }
    }
  } catch (err) {
    logger.warn({ err }, "[ai] screen registry unreadable — answers will carry no sources");
  }
  return screenByAction;
}

/** Test seam: drop the memoised index so a fixture registry can be loaded. */
function resetIndex() {
  screenByAction = null;
}

/** The screen an action reaches, or null when the registry does not declare one. */
const screenFor = (actionKey) => actionIndex().get(actionKey) || null;

/**
 * The rows a read returned, as an array.
 *
 * Reads come back in three shapes across the module services: a bare array
 * (`final_invoice.list`), a wrapper around one (`{ rows }`, `{ data }`,
 * `{ items }`), or a single object — either one record (`get_*`) or a COMPUTED
 * view with no rows at all (`smart_receivables.ageing` returns ageing buckets
 * plus a count). The third case is why this returns `null` rather than `[]` for
 * a non-record result: "a read that produced no records" and "a read that
 * produced a computed total" are different things, and the caller draws them
 * differently.
 */
function rowsOf(result) {
  if (result === null || result === undefined) return null;
  if (Array.isArray(result)) return result;
  if (typeof result !== "object") return null;
  for (const k of ["rows", "data", "items", "results"]) {
    if (Array.isArray(result[k])) return result[k];
  }
  // A single record is a record; a bag of totals is not. The discriminator is
  // whether the object carries an identity of its own — a human reference, or
  // the `*_id` key every row in this schema has. `smart_receivables.ageing`
  // (buckets + a count) and `final_invoice.previewTotals` (totals + a line
  // count) have neither, which is exactly right: they computed, they did not
  // fetch. A DRAFT invoice with no `doc_number` yet still has `invoice_id`, so
  // it stays a record rather than being demoted for being unnumbered.
  return isRecord(result) ? [result] : null;
}

/** A database row rather than a computed view: it has an identity of its own. */
function isRecord(o) {
  if (humanRef(o)) return true;
  return Object.keys(o).some((k) => k === "id" || k.endsWith("_id"));
}

/**
 * The columns a person identifies a record by, in the order they'd reach for.
 *
 * The same instinct as the SALIENT list in `orchestrator.confirmAction`, but
 * narrower on purpose: that one summarises what an action DID (status, amount,
 * recipient), this one has to name a thing in a chip roughly twenty characters
 * wide, so it is identity only.
 */
const IDENTITY = ["doc_number", "ref", "reference", "number", "code", "name", "full_name", "title", "label", "subject"];

/** A UUID, which is exactly what a citation must never show the user. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How a person would name this row, or null if the row has no human name.
 *
 * Null rather than the id, deliberately. The house rule the system prompt states
 * ("NEVER show the user raw database identifiers") is not a prompt-only rule —
 * a chip reading `d69be65d-…` is the same leak whether a model or this function
 * wrote it. A row with no human reference falls back to the screen's own title,
 * which is truthful and readable.
 */
function humanRef(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  for (const k of IDENTITY) {
    const v = row[k];
    if (typeof v === "string" && v.trim() && !UUID.test(v.trim())) return v.trim().slice(0, 60);
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * One citation per SCREEN, not per row — because the href is the screen.
 *
 * Twenty overdue invoices are one chip, and that is not a compromise: the client
 * dedupes on `href` too (`grounding.mergeSources`, `SourcesView`'s React key), so
 * twenty chips pointing at `/finance/invoices` would collapse to one anyway,
 * arbitrarily keeping whichever arrived last. Grouping here means the label is
 * chosen with all the rows in view instead.
 *
 * @param reads [{ actionKey, result, failed }] in execution order.
 * @returns [{ label, href, kind }] — the wire shape of `AskResult.sources`.
 */
function buildSources(reads) {
  /** @type {Map<string, {screen: object, rows: number|null, names: Set<string>}>} */
  const byRoute = new Map();

  for (const r of reads) {
    // A read that threw or was refused grounds nothing. It still belongs in the
    // TRACE (a user who is told "no overdue invoices" deserves to know the read
    // was denied rather than empty) — it just must not become a citation.
    if (r.failed) continue;
    const screen = screenFor(r.actionKey);
    if (!screen) continue;

    let e = byRoute.get(screen.route);
    if (!e) byRoute.set(screen.route, (e = { screen, rows: null, names: new Set() }));

    const rows = rowsOf(r.result);
    if (rows) {
      e.rows = (e.rows || 0) + rows.length;
      for (const row of rows) {
        const name = humanRef(row);
        if (name) e.names.add(name);
      }
    }
  }

  const out = [];
  for (const { screen, rows, names } of byRoute.values()) {
    out.push({
      label: labelFor(screen, rows, names),
      href: hrefFor(screen),
      // Records vs a computed view, decided by the RESULT rather than by the
      // route. The footer draws them differently — "I read invoice 31" against
      // "I ran the ageing report" — and only the result knows which happened:
      // `/finance/receivables` serves both `list_receipts` (rows) and
      // `receivables_ageing` (buckets). `rows === null` is the computed case.
      kind: rows === null ? "report" : "record",
    });
  }
  return out;
}

/**
 * What the chip reads. It has ~15rem and truncates, so: identity first, count
 * second, and never both.
 */
function labelFor(screen, rows, names) {
  if (names.size === 1) return [...names][0];
  if (rows === null) return screen.title;
  if (rows === 0) return `${screen.title} · none`;
  return `${screen.title} · ${rows}`;
}

/**
 * The route a citation navigates to.
 *
 * The screen, not the record — see the header. Isolated as a function so that
 * when a list screen learns to honour a record deep-link, this is the only edit.
 */
const hrefFor = (screen) => screen.route;

/**
 * The steps that produced this answer, in the order they happened.
 *
 * DERIVED, NEVER NARRATED. Asking a model to describe its own reasoning after
 * the fact produces something that reads like provenance and is not — and a
 * plausible false trace is worse than an absent one, because the trace is what a
 * user opens precisely when they have started to doubt the answer. Every line
 * below is a fact the orchestrator observed: which action ran, what it was
 * filtered by, how many rows came back, whether it failed.
 *
 * Filters come from the payload the model sent, which is the real question that
 * was asked of the data — "filtered to overdue" is only honest if something
 * actually filtered to overdue.
 */
function buildTrace({ reads = [], writes = [], recalled = 0, nudged = false }) {
  // No tool call, no trace. Retrieval runs on every turn, so counting it alone
  // would hang a "Trace · 1 step" disclosure under "hello" — a control that is
  // always present and never worth opening, which teaches people to ignore it
  // before the turn arrives where it matters. The recall line is context for the
  // reads below it, not a step in its own right.
  if (!reads.length && !writes.length) return [];

  const steps = [];
  if (recalled > 0) steps.push(`Searched the knowledge base — ${recalled} passage${recalled === 1 ? "" : "s"} recalled`);
  if (nudged) steps.push("Re-prompted: the first reply announced an action without taking it");

  for (const r of reads) {
    const what = phrase(r.actionKey);
    const filters = filterPhrase(r.payload);
    const head = `Read ${what}${filters ? ` (${filters})` : ""}`;
    if (r.failed) {
      steps.push(`${head} — failed: ${String(r.error || "unknown error").slice(0, 120)}`);
      continue;
    }
    const rows = rowsOf(r.result);
    if (rows === null) steps.push(`${head} — computed`);
    else if (rows.length === 0) steps.push(`${head} — nothing matched`);
    else steps.push(`${head} — ${rows.length} record${rows.length === 1 ? "" : "s"}`);
  }

  for (const w of writes) steps.push(`Proposed ${phrase(w.actionKey)} for your confirmation`);
  return steps;
}

/**
 * An action key as English. `list_final_invoices` → "final invoices",
 * `receivables_ageing` → "receivables ageing", `get_trial_balance` → "trial
 * balance". The `list_`/`get_` prefix is dropped because the step already starts
 * with "Read"; everything else is the action's own words, so a module that names
 * an action well reads well here for free.
 */
function phrase(actionKey) {
  return String(actionKey || "").replace(/^(list|get|fetch|effective)_/, "").replace(/_/g, " ");
}

/**
 * The read's filters, as the user would say them.
 *
 * Paging controls are dropped — "limit: 50" is how the query was bounded, not
 * what was asked. Values are truncated rather than redacted: this goes to the
 * one person who asked the question, over the same response as the answer
 * itself, and the values are ones they can already see in the rows.
 */
const NOISE = new Set(["limit", "offset", "page", "page_size", "per_page", "cursor", "sort", "order", "q"]);
function filterPhrase(payload) {
  if (!payload || typeof payload !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(payload)) {
    if (NOISE.has(k) || v === null || v === undefined || v === "") continue;
    if (typeof v === "object") continue; // nested filters are not a phrase
    const val = String(v);
    // An id filter says "this one record", which the row count already says
    // better, and printing the uuid breaks the same rule `humanRef` keeps.
    if (UUID.test(val)) continue;
    parts.push(`${k.replace(/_/g, " ")}: ${val.slice(0, 40)}`);
    if (parts.length === 3) break; // a step, not a query log
  }
  return parts.join(", ");
}

module.exports = { buildSources, buildTrace, screenFor, rowsOf, humanRef, resetIndex };
