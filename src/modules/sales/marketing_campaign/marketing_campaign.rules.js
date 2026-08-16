/**
 * Marketing campaign (MOD-22) — pure lifecycle, field-lock and KPI arithmetic.
 *
 * F8 (doc/SALES_CRM_FEATURES.md#F8) turns this from an email-sending record
 * into a budget-and-performance one. Three rules carry the feature, and all
 * three live here so a test can assert them rather than a screen implying them.
 *
 * 1. APPROVAL IS A DECISION, NOT A TRANSITION. `PENDING_APPROVAL` has no exits
 *    in NEXT at all. Leaving it goes through `assertDecision` — APPROVE to
 *    ACTIVE, REJECT back to DRAFT — because the two are gated differently
 *    (`approve` on MOD-22) from advancing a record, and a target-state map
 *    cannot tell them apart: PAUSED -> ACTIVE is a resume, which the campaign
 *    owner may do, while PENDING_APPROVAL -> ACTIVE is the approval itself,
 *    which they may not. Same target state, two different authorities. Routing
 *    them through one endpoint keyed on `to` is how a resume becomes a
 *    self-approval.
 *
 * 2. WHAT IS EDITABLE DEPENDS ON THE STATE, AND PLAN AND ACTUALS ARE OPPOSITE.
 *    Budget and targets are open while the campaign is being planned and shut
 *    the moment it is submitted — a budget that can be edited after approval is
 *    not a budget that was approved. The recorded figures are the mirror image:
 *    shut until the campaign runs, open once it does. The legacy has the same
 *    shape, but as `readOnly` attributes set by JS in the drawer
 *    (market-campaign-registration.php toggleInputLocking), so the API accepts
 *    every field in every state and the lock is decoration.
 *
 * 3. THE FIGURES ARE HAND-ENTERED AND THE MODEL SAYS SO. `actuals_updated_at`
 *    is stamped by the one path that writes them. Nothing here derives leads or
 *    wins from `lead` or `opportunity` rows — F8 settles that campaign
 *    attribution is out of scope, and a half-derived number that looks measured
 *    is worse than an honest hand-typed one.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const STATUSES = ["DRAFT", "PENDING_APPROVAL", "ACTIVE", "PAUSED", "ENDED"];

/** The legacy's platform set, unchanged (market-campaign-registration.php ~599). */
const PLATFORMS = ["META", "GOOGLE", "LINKEDIN", "EMAIL", "OFFLINE", "OTHER"];

/**
 * Ordinary lifecycle moves. Note what is NOT here:
 *   - DRAFT -> ACTIVE. Going live without approval is the whole thing F8 adds;
 *     leaving the old shortcut in place would make the approval optional, and
 *     an optional approval is a status value, not a control.
 *   - Any exit from PENDING_APPROVAL. See rule 1 above.
 */
const NEXT = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: [],
  ACTIVE: ["PAUSED", "ENDED"],
  PAUSED: ["ACTIVE", "ENDED"],
  ENDED: [],
};

/** The two decisions, and the only way out of PENDING_APPROVAL. */
const DECISIONS = { APPROVE: "ACTIVE", REJECT: "DRAFT" };

function assertTransition(from, to) {
  if (from === "PENDING_APPROVAL") {
    throw new AppError(
      "AWAITING_DECISION",
      "A campaign awaiting approval is approved or rejected, not transitioned",
      422,
    );
  }
  if (!NEXT[from] || !NEXT[from].includes(to)) {
    throw new AppError("BAD_STATE", `Cannot move campaign ${from} -> ${to}`, 422);
  }
  return true;
}

function assertDecision(from, decision) {
  if (!Object.prototype.hasOwnProperty.call(DECISIONS, decision)) {
    throw new AppError("BAD_DECISION", `Unknown decision ${decision}`, 422);
  }
  if (from !== "PENDING_APPROVAL") {
    throw new AppError(
      "NOT_PENDING",
      `Only a campaign awaiting approval can be ${decision.toLowerCase()}d — this one is ${from}`,
      422,
    );
  }
  return DECISIONS[decision];
}

/* ─── field locks ──────────────────────────────────────────────────────────── */

/** What the campaign says it will do. Locked once it is submitted. */
const PLAN_FIELDS = [
  "name", "channel", "platform", "target_service", "owner_user_id",
  "starts_on", "ends_on", "budget_amount", "budget_currency", "remarks",
  "assets_json", "target_leads", "target_opportunities", "target_won",
];

/** What it actually did. Hand-entered from the ad manager's report. */
const ACTUAL_FIELDS = ["actual_leads", "actual_opportunities", "actual_won"];

/**
 * Which of the two groups a given state accepts.
 *
 * PENDING_APPROVAL allows the PLAN group on purpose: the route gates a PATCH in
 * that state on the `approve` permission, so the only person who can reach it
 * is the approver, and an approver trimming a budget by 20% before approving is
 * the correction the legacy handles by rejecting with "reduce by 20%" and
 * waiting for the submitter to retype it. The campaign owner — `edit` and no
 * `approve` — is refused at the route, which is F8's "guard stopping a
 * sales-role user editing a campaign while it is pending approval".
 *
 * ENDED allows ACTUALS on purpose too, and the route gates that on `approve`.
 * Ad-manager reports arrive after a campaign stops; the legacy locks everything
 * on COMPLETED, so the final week's figures are never recorded and every
 * finished campaign understates itself permanently. Amending a closed record is
 * a supervised act, not an impossible one.
 */
const EDITABLE = {
  DRAFT: { plan: true, actuals: false },
  PENDING_APPROVAL: { plan: true, actuals: false },
  ACTIVE: { plan: false, actuals: true },
  PAUSED: { plan: false, actuals: true },
  ENDED: { plan: false, actuals: true },
};

const groupOf = (field) =>
  (PLAN_FIELDS.includes(field) ? "plan" : ACTUAL_FIELDS.includes(field) ? "actuals" : null);

/**
 * Turn a list of refused field names into the per-field error map every other
 * 422 in this codebase emits: `{ budget_amount: ["…"], target_won: ["…"] }`.
 *
 * WHY THIS EXISTS. The two throws below used to pass `{ fields: refused.plan }`
 * — the field NAMES as a value, under a literal key called "fields". Nothing
 * downstream understands that shape:
 *
 *   * `<Form>` (client/src/components/ui/form.tsx) walks `Object.entries` of
 *     the map and calls `setError(name, …)` for each key that the form has. Its
 *     only key was "fields", which is not an input, so nothing routed and every
 *     locked field was left unmarked — the exact thing the doc comment above
 *     claimed this error was for.
 *   * The error console showed `PLAN_LOCKED: fields`, naming the wrapper key
 *     instead of `budget_amount, target_won`. That is what surfaced it.
 *
 * `assertWritable` in shared/db/query-helpers.js is the convention; this now
 * matches it, so the drawer marks the offending inputs and the console names
 * them.
 */
const perField = (names, reason) =>
  names.reduce((acc, name) => ({ ...acc, [name]: [reason] }), {});

/**
 * Throw unless every field in `patch` is writable in `status`.
 *
 * Names the offending fields and the reason, because "422 LOCKED" on a drawer
 * with twenty inputs tells the operator nothing about which one to put back.
 */
function assertEditable(status, patch = {}) {
  const gates = EDITABLE[status];
  if (!gates) throw new AppError("BAD_STATE", `Unknown campaign status ${status}`, 422);
  const refused = { plan: [], actuals: [], unknown: [] };
  for (const field of Object.keys(patch)) {
    const group = groupOf(field);
    if (!group) { refused.unknown.push(field); continue; }
    if (!gates[group]) refused[group].push(field);
  }
  if (refused.plan.length) {
    throw new AppError(
      "PLAN_LOCKED",
      `A ${status} campaign's plan is fixed — ${refused.plan.join(", ")} cannot be changed`,
      422,
      perField(refused.plan, `cannot be changed while the campaign is ${status}`),
    );
  }
  if (refused.actuals.length) {
    throw new AppError(
      "ACTUALS_LOCKED",
      `A ${status} campaign has not run yet — ${refused.actuals.join(", ")} cannot be recorded`,
      422,
      perField(refused.actuals, `cannot be recorded while the campaign is ${status}`),
    );
  }
  return true;
}

/** True when this patch touches the recorded figures, so the caller stamps them. */
const touchesActuals = (patch = {}) => ACTUAL_FIELDS.some((f) => patch[f] !== undefined);

/* ─── KPI arithmetic ───────────────────────────────────────────────────────── */

/**
 * The four tiles the register renders, keyed and labelled here so the screen
 * does not keep its own copy.
 *
 * TOTAL_BUDGET is labelled "Total budget", NOT "Total spend" as the legacy
 * labels the identical SUM(budget_amount). Nothing in this system knows what
 * was actually disbursed against a campaign — that would be a cash_request
 * link, which F8 leaves out — so calling a sum of budgets "spend" states
 * something the data cannot support. The tile is honest about being planned
 * money, for the same reason the leads and wins tiles are labelled as
 * hand-entered.
 */
const KPI_TILES = ["TOTAL_BUDGET", "LEADS", "WON", "AVG_CONVERSION"];

const TILE_LABELS = {
  TOTAL_BUDGET: "Total budget",
  LEADS: "Leads generated",
  WON: "Deals won",
  AVG_CONVERSION: "Avg. conversion",
};

/** Every tile at zero, so a register with no rows renders 0 rather than blanks. */
const emptyKpi = () => ({ TOTAL_BUDGET: 0, LEADS: 0, WON: 0, AVG_CONVERSION: 0, CAMPAIGNS: 0 });

/**
 * Fold the repo's single aggregate row into the tiles.
 *
 * Conversion is computed from the TOTALS, never as an average of per-campaign
 * rates: a campaign with 1 lead and 1 win would otherwise contribute 100% with
 * the same weight as one with 900 leads and 90 wins, and the tile would read
 * far above the truth. It is wins over leads across the filtered set, which is
 * what "average conversion" has to mean for the number to be additive.
 *
 * Zero leads yields zero, not NaN and not a division by zero — a register with
 * no recorded figures reads 0.0%, which is true, rather than "—", which invites
 * someone to assume the tile is broken.
 */
function kpiFrom(agg = {}) {
  const budget = Number(agg.total_budget || 0);
  const leads = Number(agg.total_leads || 0);
  const won = Number(agg.total_won || 0);
  return {
    TOTAL_BUDGET: budget,
    LEADS: leads,
    WON: won,
    AVG_CONVERSION: leads > 0 ? Math.round((won / leads) * 1000) / 10 : 0,
    CAMPAIGNS: Number(agg.campaigns || 0),
  };
}

/**
 * Cost per lead, for a single campaign card.
 *
 * Null rather than zero or Infinity when no leads are recorded: "0 XAF per
 * lead" on a campaign that has produced nothing is the most flattering possible
 * reading of the worst possible result, and the screen renders null as "—".
 */
function costPerLead(campaign = {}) {
  const leads = Number(campaign.actual_leads || 0);
  if (leads <= 0) return null;
  return Math.round((Number(campaign.budget_amount || 0) / leads) * 100) / 100;
}

/** The same arithmetic against the plan, so the drawer can show both. */
function targetCostPerLead(campaign = {}) {
  const leads = Number(campaign.target_leads || 0);
  if (leads <= 0) return null;
  return Math.round((Number(campaign.budget_amount || 0) / leads) * 100) / 100;
}

module.exports = {
  STATUSES, PLATFORMS, NEXT, DECISIONS,
  assertTransition, assertDecision,
  PLAN_FIELDS, ACTUAL_FIELDS, EDITABLE, assertEditable, touchesActuals, groupOf,
  KPI_TILES, TILE_LABELS, emptyKpi, kpiFrom, costPerLead, targetCostPerLead,
};
