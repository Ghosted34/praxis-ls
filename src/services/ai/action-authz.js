/**
 * Authorization for AI-executed actions.
 *
 * Audit SEC H1 (High). The AI action catalogue has carried a
 * `required_permission` column from the start. The registrar populates it from
 * each module's manifest. The orchestrator even SELECTs it into the tool list.
 * IT WAS NEVER COMPARED AGAINST ANYTHING. Both execution sites called the
 * executor directly:
 *
 *     const out = fn ? await fn({ client, user, payload }) : { error: "no executor" };
 *     const result = await fn({ client, user, payload });
 *
 * Authorization in this codebase lives exclusively in route middleware —
 * services do not check grants. `action-registry.js` says of its executors
 * "Each calls a module SERVICE with the caller's client + identity (module
 * RBAC/audit applies)". The audit half was true. The RBAC half was not, and the
 * assistant router carries only `authMiddleware` plus a tenant-wide feature
 * flag. So the assistant was a general-purpose bypass around the module grant
 * matrix, available to every authenticated user in any tenant with AI enabled.
 *
 * Ten write actions were reachable that way: create_client, open_dossier,
 * update_dossier, transition_dossier, create_costing, draft_quotation,
 * draft_final_invoice, draft_purchase_order, draft_supplier_invoice,
 * draft_cash_request. A warehouse operator holding only WMS grants could ask
 * the assistant, in ordinary language, to draft a supplier invoice and a cash
 * request — creating financial documents they cannot create through any screen
 * or route available to them. Every one was faithfully written to the immutable
 * ledger, so the audit trail would have recorded the unauthorized action
 * accurately. Recording is not preventing.
 *
 * THE RULE HERE IS FAIL CLOSED
 *
 * An action whose `required_permission` is null does not execute. That is the
 * opposite of the usual instinct — "no requirement means no restriction" — and
 * it is deliberate: a missing requirement means the catalogue is incomplete,
 * and the safe reading of an incomplete authorization record is "no". A
 * registrar that forgets to declare a permission produces a visibly broken
 * action rather than an invisibly open one.
 *
 * Reads are gated too, not just writes. A read action returns tenant data the
 * caller may have no grant to see, and the audit's scenario only used writes
 * because writes were the sharper edge.
 */

"use strict";

const identityCache = require("../../shared/cache/identity-cache");
const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");
const metrics = require("../../shared/observability/metrics");

/**
 * Action verb -> permission column. Must stay in step with middleware/rbac.js;
 * divergence here would mean the AI path enforced a DIFFERENT rule from the
 * HTTP path, which is worse than enforcing none because it would look correct.
 */
const COLUMN = {
  view: "can_read",
  read: "can_read",
  create: "can_create",
  edit: "can_update",
  update: "can_update",
  delete: "can_delete",
  approve: "can_approve",
  // 12771 gave these three real columns. Kept in step with rbac.js on purpose:
  // an assistant gated more loosely than a person at a screen is the AI-only
  // capability failure this file exists to prevent.
  export: "can_export",
  validate: "can_validate",
  disburse: "can_disburse",
  publish: "can_update",
};

/**
 * `required_permission` is stored as "MOD-12:create".
 *
 * Returns null when it cannot be parsed, which the caller treats as a denial.
 */
function parseRequirement(required) {
  if (typeof required !== "string") return null;
  const [moduleKey, action] = required.split(":").map((x) => (x || "").trim());
  if (!moduleKey || !action) return null;
  const column = COLUMN[action.toLowerCase()];
  if (!column) return null;
  return { moduleKey, action: action.toLowerCase(), column };
}

function deny(actionKey, reason, required) {
  metrics.inc("praxis_ai_action_denials_total", { action: actionKey }, 1,
    "AI actions refused for want of a permission.");
  logger.warn({ ai_action: actionKey, required_permission: required || null, reason },
    "AI action denied");
  return new AppError(
    "AI_ACTION_FORBIDDEN",
    `You do not have permission to run "${actionKey}" (${reason}).`,
    403,
  );
}

/*
 * ── KNOWN GAP: THE AUTHORITY OVERLAY IS NOT CHECKED HERE ───────────────────
 *
 * `requirePermission` has a sibling — `requireCapability` — and four HTTP
 * routes demand both: a module grant AND an authority code (ISSUER / VALIDATOR
 * / APPROVER / LINE_MANAGER, optionally banded by document type and amount).
 * This path checks only the grant, so an assistant can run an action a person
 * at a screen would be refused for want of the capability.
 *
 * It is PRE-EXISTING and is not widened by 12771: `disburse_cash_request` moved
 * from `can_approve` to `can_disburse`, and the migration backfills the second
 * from the first, so exactly the same callers can run it today and an
 * administrator narrowing `can_disburse` narrows this path too.
 *
 * Closing it properly means carrying a required capability through
 * `action-registrar.buildCatalogue` and the `ai_action_catalogue` table it
 * persists to — a migration and a schema change, which does not belong in a
 * change about budgets. Recorded here, in the file that would host the fix,
 * rather than left for someone to rediscover from a manifest key that quietly
 * does nothing.
 */

/**
 * May `user` run `def`?
 *
 * Resolves grants through `identityCache.getGrants` — the same cache, the same
 * 30-second TTL and the same invalidation as `requirePermission`, so the two
 * paths cannot drift apart or disagree during a grant change.
 *
 * @param {{query: Function}} client   identity-schema client
 * @param {{user_id: string, role_ids: string[], is_ceo?: boolean}} user
 * @param {{action_key: string, required_permission: string|null}} def
 * @returns {Promise<true>} or throws AppError 403
 */
async function assertAllowed(client, user, def) {
  const actionKey = (def && def.action_key) || "unknown";

  if (!user) throw deny(actionKey, "not authenticated", null);

  // CEO bypass, matching rbac.js. PRD §3: the CEO sees everything by design.
  if (user.is_ceo) return true;

  const req = parseRequirement(def && def.required_permission);
  if (!req) {
    throw deny(
      actionKey,
      "this action declares no required permission, so it cannot be authorised",
      def && def.required_permission,
    );
  }

  const grants = await identityCache.getGrants(client, {
    role_ids: user.role_ids || [],
    module: req.moduleKey,
  });
  if (!grants.some((g) => g[req.column] === true)) {
    throw deny(actionKey, `requires ${req.moduleKey} ${req.action}`, def.required_permission);
  }
  return true;
}

/**
 * Filter a tool catalogue down to what this caller may actually run.
 *
 * Offering a tool the caller cannot execute is its own small harm: the model
 * proposes it, the user confirms it, and the refusal arrives at the end of the
 * interaction instead of the beginning. Filtering the OFFER keeps the
 * assistant's suggestions inside the user's authority.
 *
 * Never a substitute for assertAllowed at execution — the offer is advisory and
 * the caller controls what it sends back.
 */
async function filterAllowed(client, user, defs) {
  if (!Array.isArray(defs)) return [];
  if (user && user.is_ceo) return defs;
  const out = [];
  for (const def of defs) {
    try {
       
      await assertAllowed(client, user, def);
      out.push(def);
    } catch (err) {
      /*
       * A DENIAL IS THE ANSWER HERE, not a fault: this loop filters a catalogue
       * down to what the caller may run, and `assertAllowed` has already logged
       * and counted the refusal (see `deny` above).
       *
       * Anything else is re-raised. The bare catch-all this replaces swallowed
       * EVERY error — so a database outage inside the grant lookup produced an
       * empty catalogue, which is indistinguishable from a correct answer of
       * "you may run nothing" and is exactly the kind of failure that gets
       * diagnosed as a permissions problem for a day.
       */
      if (!(err instanceof AppError) || err.code !== "AI_ACTION_FORBIDDEN") throw err;
    }
  }
  return out;
}

module.exports = { assertAllowed, filterAllowed, parseRequirement, COLUMN };
