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
  export: "can_read",
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
      // eslint-disable-next-line no-await-in-loop
      await assertAllowed(client, user, def);
      out.push(def);
    } catch {
      /* not offered */
    }
  }
  return out;
}

module.exports = { assertAllowed, filterAllowed, parseRequirement, COLUMN };
