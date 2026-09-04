/**
 * The cash-request worksheet's model layer — no JSX, no React.
 *
 * The same split, and for the same two reasons, as `costing-model.ts`: the
 * register imports `statusLabel` and `CASH_REQUEST_BASE`, and taking them from
 * the worksheet would drag the grid and every dialog into the register's chunk
 * and trip `react-refresh/only-export-components`.
 *
 * ── THE ARITHMETIC IS A MIRROR, AND IT MUST STAY ONE ───────────────────────
 *
 * `lineClaim` and `lineAmount` are the browser's copy of
 * `cash_request.rules.lineClaim` and the `budget_amount = qty × unit_cost`
 * derivation in `cash_request.service.lineFields`. The server is the authority
 * — every gate re-derives them, and a 422 is always the last word — but the
 * worksheet has to show a running total and a Remaining column BEFORE it saves,
 * and it cannot ask the server on every keystroke.
 *
 * So they are duplicated deliberately, and the tests pin them against the same
 * figures the server tests use. If they ever drift, the screen tells somebody
 * they are inside their budget and the approval refuses them.
 */
import { tr } from "@/lib/i18n";
import type { Tone } from "@/components/ui/pill";
import * as api from "@/lib/costing-api";

/** Where a cash request lives. One route, page or dialog — a pasted link has to
 *  land on the same request (FRONTEND_GUIDE §3.11). */
export const CASH_REQUEST_BASE = "/costing/cash-requests";

/** Statuses are said out loud, never shown raw (FRONTEND_GUIDE §5). */
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "To validate",
  VALIDATED: "To approve",
  APPROVED: "To disburse",
  PARTIALLY_DISBURSED: "Part paid",
  DISBURSED: "Disbursed",
  CLOSED_SHORT: "Settled short",
  JUSTIFIED: "Justified",
  REJECTED: "Rejected",
};

export const statusLabel = (s?: string | null) =>
  tr(STATUS_LABEL[String(s || "")] || String(s || "—"));

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "mute",
  SUBMITTED: "warn",
  VALIDATED: "warn",
  APPROVED: "ok",
  PARTIALLY_DISBURSED: "orange",
  DISBURSED: "ok",
  CLOSED_SHORT: "mute",
  JUSTIFIED: "ok",
  REJECTED: "bad",
};

export const statusTone = (s?: string | null): Tone =>
  STATUS_TONE[String(s || "")] || "mute";

/** Statuses in which the lines may still be edited. The server refuses the rest
 *  (`updateDraft` is DRAFT-only); this decides what to OFFER. */
export const isEditable = (s?: string | null) => String(s || "") === "DRAFT";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/* ── A line while it is being edited ───────────────────────────────────────── */

export type LineDraft = {
  /** Round-tripped so an edit survives a label and amount change together. */
  cash_request_line_id?: string;
  /** The budget line this claim draws down. Null only on an overhead request. */
  costing_line_id: string | null;
  dictionary_item_id: string | null;
  label: string;
  qty: number;
  unit_cost: number;
  vat_percent: number | null;
  is_disbursement: boolean;
  justification_required: boolean;
  /** Present on an imported line: what the budget line has left for this
   *  request. Undefined on a manual (overhead) line, which has no budget. */
  remaining?: number;
  budget?: number;
  /** Ticked lines are the ones this request is actually for. Local only. */
  picked: boolean;
};

export const BLANK_LINE: LineDraft = {
  costing_line_id: null,
  dictionary_item_id: null,
  label: "",
  qty: 1,
  unit_cost: 0,
  vat_percent: null,
  is_disbursement: false,
  justification_required: false,
  picked: true,
};

/**
 * A number from the SERVER, coerced.
 *
 * ── WHY THIS EXISTS, AND WHY THE TYPES DID NOT CATCH IT ────────────────────
 *
 * `pg` returns Postgres `numeric` as a STRING, deliberately — a float cannot
 * hold arbitrary precision, so the driver refuses to lose digits on your
 * behalf. Every `numeric` column on a cash request line therefore arrives here
 * as `"19.25"`, not `19.25`, while `api.CashLine` and `api.BudgetLine` both
 * declare `number`. TypeScript believes the declaration; the runtime does not.
 *
 * It hid because every READER wraps its input: `lineAmount` does
 * `Number(l.qty) * Number(l.unit_cost)`, so the grid, the totals and the
 * Remaining column were all correct on screen. Only SAVE failed.
 *
 * ONE FIELD caused it, on every line at once. `fromSaved` already coerced `qty`
 * and `unit_cost`; `vat_percent` alone was passed through raw. A worksheet
 * reloaded from the server therefore held `"19.25"`, and Zod answered
 * "lines: Expected number, received string" once per line — three times on a
 * three-line request, which reads like three separate problems and is one.
 *
 * The budget ledger was never the source: `costing.rules.summariseBudget`
 * coerces every figure server-side, so `api.BudgetLine` really does arrive as
 * numbers. `cash_request.repo.listLines` is a bare `SELECT *` and does not.
 *
 * So the fix is at the BOUNDARY rather than at each use: a value entering
 * `LineDraft` is made to match the type it is being given. `toPayload` coerces
 * again on the way out — belt and braces, because that is the edge where a
 * regression becomes a 422 in somebody's face rather than a wrong pixel.
 */
const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** The net a line claims — `qty × unit_cost`, the server's `budget_amount`. */
export const lineAmount = (l: Pick<LineDraft, "qty" | "unit_cost">) =>
  round2((Number(l.qty) || 0) * (Number(l.unit_cost) || 0));

/**
 * What a line claims against its budget line — TTC.
 *
 * TTC because the budget is TTC: a costing budgets the supplier's VAT on a
 * débours as cash it will spend, so a claim that ignored its own VAT would draw
 * down less than the money that actually leaves the treasury.
 *
 * Since the cash request stopped carrying a VAT rate of its own, an imported
 * line's `vat_percent` is null and this is the identity — the amount typed IS
 * the amount claimed. The expression is kept rather than simplified away
 * because pre-existing lines still hold a rate, and their claims must keep
 * meaning what they meant when they were approved.
 *
 * Mirrors `cash_request.rules.lineClaim`, rounded the same way — per line, not
 * once at the foot — because a per-line balance is what it is compared against.
 */
export const lineClaim = (l: Pick<LineDraft, "qty" | "unit_cost" | "vat_percent">) =>
  round2(lineAmount(l) * (1 + (Number(l.vat_percent) || 0) / 100));

/** What is left on this line for THIS request after what it already claims. */
export const lineRemainingAfter = (l: LineDraft) =>
  l.remaining === undefined ? null : round2(l.remaining - lineClaim(l));

/** A line claiming more than its budget line has left. */
export const isOverBudget = (l: LineDraft) => {
  const after = lineRemainingAfter(l);
  return after !== null && after < 0;
};

/** The voucher footer: Subtotal / VAT / TOTAL PAYABLE, over the picked lines
 *  only — an unticked line is not part of this request. */
export function computeTotals(lines: LineDraft[]) {
  let subtotal = 0;
  let vat = 0;
  for (const l of lines) {
    if (!l.picked) continue;
    const amt = lineAmount(l);
    subtotal += amt;
    vat += amt * ((Number(l.vat_percent) || 0) / 100);
  }
  return {
    subtotal: round2(subtotal),
    vat_total: round2(vat),
    total_payable: round2(round2(subtotal) + round2(vat)),
  };
}

/* ── Seeding, saving ───────────────────────────────────────────────────────── */

/** A line as the server returned it, ready to edit. */
export function fromSaved(l: api.CashLine, budget?: api.BudgetLine): LineDraft {
  return {
    cash_request_line_id: l.cash_request_line_id,
    costing_line_id: l.costing_line_id ?? null,
    dictionary_item_id: l.dictionary_item_id ?? null,
    label: l.label || "",
    qty: num(l.qty ?? 1, 1) || 1,
    unit_cost: num(l.unit_cost ?? l.budget_amount),
    // `numeric` arrives as a string; `null` stays null (no VAT is not 0% VAT).
    vat_percent:
      l.vat_percent === undefined || l.vat_percent === null ? null : num(l.vat_percent),
    is_disbursement: l.is_disbursement === true,
    justification_required: l.justification_required === true,
    // The ledger excludes THIS request, so `remaining` is what is available to
    // it — its own claim is not counted against itself.
    remaining: budget ? num(budget.remaining) : undefined,
    budget: budget ? num(budget.budget) : undefined,
    picked: true,
  };
}

/**
 * A budget line, as the claim a new request should default to.
 *
 * The default is what is LEFT, not what was budgeted — the whole point of the
 * ledger, and the thing neither the legacy nor the rebuild could do. When
 * nothing has been claimed the costing's own shape carries across verbatim, so
 * an approver can see a container count change; a partial top-up is not "1.4
 * containers", so it lands as one line at the remaining net.
 *
 * Mirrors `cash_request.service.claimFromBudgetLine`. The server re-derives it
 * on Import; this is what the screen shows before the user presses anything.
 */
export function fromBudgetLine(b: api.BudgetLine): LineDraft {
  const remaining = num(b.remaining);
  const budget = num(b.budget);
  const qty = num(b.qty, 1) || 1;
  const full = remaining >= budget;
  return {
    costing_line_id: b.costing_line_id,
    dictionary_item_id: b.dictionary_item_id ?? null,
    label: b.container_type_code ? `${b.label} — ${b.container_type_code}` : b.label,
    // The whole line free → keep the costing's SHAPE (two containers, not one
    // lump), at the TTC unit. A partial top-up is not "1.4 containers", so it
    // lands as one line at the balance.
    qty: full ? qty : 1,
    unit_cost: full ? Math.floor((budget / qty) * 100) / 100 : Math.max(remaining, 0),
    // No rate. The costing hands over an amount that is already TTC, so there
    // is nothing left to tax — see `claimFromBudgetLine`, which this mirrors.
    vat_percent: null,
    is_disbursement: b.is_disbursement === true,
    justification_required: false,
    remaining,
    budget,
    picked: remaining > 0,
  };
}

/** A draft line as the API wants it. Unticked lines are dropped by the caller,
 *  never sent as zero — a zero line is a claim for nothing, not an absence. */
export const toPayload = (l: LineDraft): api.CashLine => ({
  cash_request_line_id: l.cash_request_line_id,
  costing_line_id: l.costing_line_id,
  dictionary_item_id: l.dictionary_item_id,
  label: l.label || "Line",
  // Coerced again on the way out. The entry points above are the real fix;
  // this is the edge where a regression becomes a 422 in somebody's face
  // rather than a wrong pixel, so it is guarded twice on purpose.
  qty: num(l.qty, 1) || 1,
  unit_cost: num(l.unit_cost),
  vat_percent: l.vat_percent === null ? null : num(l.vat_percent),
  is_disbursement: l.is_disbursement,
  justification_required: l.justification_required,
});

/** The lines this request is actually for. */
export const pickedLines = (lines: LineDraft[]) => lines.filter((l) => l.picked);
