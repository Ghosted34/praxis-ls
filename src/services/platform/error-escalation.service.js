/**
 * Escalation engine (spec §5) — rules CRUD + the evaluator that fires them.
 *
 * A rule says "N errors of these levels within M minutes → notify". The
 * evaluator runs on a timer rather than on every persisted error, because
 * evaluating per-error during an incident means evaluating thousands of times a
 * second at exactly the moment the database is least able to afford it.
 *
 * TWO SEPARATE CLOCKS, which is where this kind of engine usually goes wrong:
 *
 *   `escalation_delay_minutes` — wait before the FIRST notification, then
 *   re-check that the condition still holds. This is what stops a 30-second
 *   blip from paging anyone.
 *
 *   `repeat_interval_minutes` — the floor between repeat notifications while
 *   the condition persists. Enforced against platform.error_escalation_log, not
 *   an in-memory timestamp, so a deploy or a crash-loop cannot reset it and
 *   turn a page-once rule into a page-every-30-seconds rule.
 */

"use strict";

const db = require("./db");
const { logger } = require("../../config/logger");
const { AppError } = require("../../utils/errors");

const RULE_COLUMNS = `
  rule_id AS id, tenant_id, name, level_filter, threshold_count,
  threshold_window_minutes, action_email, action_inhouse, action_webhook_url,
  email_recipients, escalation_delay_minutes, repeat_interval_minutes,
  active, created_at, updated_at`;

async function listRules() {
  const { rows } = await db.query(
    `SELECT ${RULE_COLUMNS}, (SELECT slug FROM platform.tenant t WHERE t.tenant_id = r.tenant_id) AS tenant_slug
       FROM platform.error_escalation_rule r
      ORDER BY active DESC, created_at DESC`,
  );
  return rows;
}

async function createRule(body, actorId) {
  const { rows } = await db.query(
    `INSERT INTO platform.error_escalation_rule
       (tenant_id, name, level_filter, threshold_count, threshold_window_minutes,
        action_email, action_inhouse, action_webhook_url, email_recipients,
        escalation_delay_minutes, repeat_interval_minutes, active, created_by)
     VALUES ((SELECT tenant_id FROM platform.tenant WHERE slug = $1),
             $2, $3::text[], $4, $5, $6, $7, $8, $9::text[], $10, $11, $12, $13)
     RETURNING ${RULE_COLUMNS}`,
    [
      body.tenant || null,
      body.name,
      body.level_filter || ["fatal"],
      body.threshold_count ?? 5,
      body.threshold_window_minutes ?? 15,
      body.action_email ?? true,
      body.action_inhouse ?? true,
      body.action_webhook_url || null,
      body.email_recipients || [],
      body.escalation_delay_minutes ?? 0,
      body.repeat_interval_minutes ?? 60,
      body.active ?? true,
      actorId,
    ],
  );
  return rows[0];
}

/** PATCH-style partial update: only supplied keys move. */
async function updateRule(id, body) {
  const sets = [];
  const params = [id];
  const put = (sql, value) => {
    params.push(value);
    sets.push(`${sql} = $${params.length}`);
  };

  if (body.name !== undefined) put("name", body.name);
  if (body.level_filter !== undefined) put("level_filter", body.level_filter);
  if (body.threshold_count !== undefined) put("threshold_count", body.threshold_count);
  if (body.threshold_window_minutes !== undefined) put("threshold_window_minutes", body.threshold_window_minutes);
  if (body.action_email !== undefined) put("action_email", body.action_email);
  if (body.action_inhouse !== undefined) put("action_inhouse", body.action_inhouse);
  if (body.action_webhook_url !== undefined) put("action_webhook_url", body.action_webhook_url);
  if (body.email_recipients !== undefined) put("email_recipients", body.email_recipients);
  if (body.escalation_delay_minutes !== undefined) put("escalation_delay_minutes", body.escalation_delay_minutes);
  if (body.repeat_interval_minutes !== undefined) put("repeat_interval_minutes", body.repeat_interval_minutes);
  if (body.active !== undefined) put("active", body.active);

  if (!sets.length) throw new AppError("NO_CHANGES", "Nothing to update", 400);

  const { rows } = await db.query(
    `UPDATE platform.error_escalation_rule SET ${sets.join(", ")}
      WHERE rule_id = $1 RETURNING ${RULE_COLUMNS}`,
    params,
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Rule not found", 404);
  return rows[0];
}

async function deleteRule(id) {
  const { rowCount } = await db.query("DELETE FROM platform.error_escalation_rule WHERE rule_id = $1", [id]);
  if (!rowCount) throw new AppError("NOT_FOUND", "Rule not found", 404);
  return { id, deleted: true };
}

async function ruleLog(ruleId, limit = 50) {
  const { rows } = await db.query(
    `SELECT log_id AS id, rule_id, error_id, signature, triggered_at, actions_taken, notes,
            (actions_taken @> '{"pending":true}'::jsonb) AS pending
       FROM platform.error_escalation_log
      WHERE ($1::uuid IS NULL OR rule_id = $1)
      ORDER BY triggered_at DESC LIMIT $2`,
    [ruleId || null, Math.min(200, limit)],
  );
  return rows;
}

/**
 * Which error groups currently satisfy a rule.
 *
 * Counts OCCURRENCES inside the window, not rows: "5 fatals in 10 minutes" means
 * five times it happened, and one group that fired five times is exactly the
 * situation the rule is for. Counting rows would need five DISTINCT bugs before
 * it ever fired, which is not what anyone means by a threshold.
 */
async function matchesFor(rule) {
  const { rows } = await db.query(
    `SELECT e.error_id, e.signature, e.level, e.message, e.module, e.route,
            e.occurrence_count, e.last_seen, t.slug AS tenant_slug
       FROM platform.error_event e
       LEFT JOIN platform.tenant t ON t.tenant_id = e.tenant_id
      WHERE e.resolved_at IS NULL
        AND e.level = ANY($1::text[])
        AND e.last_seen >= now() - make_interval(mins => $2::int)
        AND e.occurrence_count >= $3
        AND ($4::uuid IS NULL OR e.tenant_id = $4)
      ORDER BY e.occurrence_count DESC`,
    [rule.level_filter, rule.threshold_window_minutes, rule.threshold_count, rule.tenant_id],
  );
  return rows;
}

/**
 * A row in error_escalation_log is a DELIVERY unless it carries `pending:true`,
 * in which case it is an ARMING record for the delay clock below. Every query
 * that asks "did this already fire" has to say which of the two it means —
 * conflating them is what makes a delayed rule either fire immediately or never
 * fire at all.
 */
const DELIVERED = `NOT (actions_taken @> '{"pending":true}'::jsonb)`;
const PENDING = `actions_taken @> '{"pending":true}'::jsonb`;

/**
 * Dry-run an unsaved rule (POST /escalation/rules/preview).
 *
 * Takes a tenant SLUG rather than an id because that is what the settings form
 * holds, and resolves it here so `matchesFor` keeps its single input shape. An
 * unknown slug resolves to NULL, which would silently widen the preview to
 * platform-wide — so it is rejected instead. A dry-run that quietly answers a
 * different question than the one asked is worse than an error.
 */
async function previewMatches(body = {}) {
  let tenantId = null;
  if (body.tenant) {
    const { rows } = await db.query("SELECT tenant_id FROM platform.tenant WHERE slug = $1", [body.tenant]);
    if (!rows[0]) throw new AppError("NOT_FOUND", `No tenant with slug "${body.tenant}"`, 404);
    tenantId = rows[0].tenant_id;
  }
  return matchesFor({
    tenant_id: tenantId,
    level_filter: body.level_filter || ["fatal"],
    threshold_count: body.threshold_count ?? 5,
    threshold_window_minutes: body.threshold_window_minutes ?? 15,
  });
}

/** Has this rule already DELIVERED for this signature inside its repeat interval? */
async function recentlyFired(rule, signature) {
  if (!rule.repeat_interval_minutes) {
    const { rows } = await db.query(
      `SELECT 1 FROM platform.error_escalation_log
        WHERE rule_id = $1 AND signature = $2 AND ${DELIVERED} LIMIT 1`,
      [rule.id, signature],
    );
    return rows.length > 0;
  }
  const { rows } = await db.query(
    `SELECT 1 FROM platform.error_escalation_log
      WHERE rule_id = $1 AND signature = $2 AND ${DELIVERED}
        AND triggered_at > now() - make_interval(mins => $3::int)
      LIMIT 1`,
    [rule.id, signature, rule.repeat_interval_minutes],
  );
  return rows.length > 0;
}

/**
 * ── The delay clock ─────────────────────────────────────────────────────────
 *
 * `escalation_delay_minutes` means "wait D minutes, and only page if the
 * condition is STILL true". It was stored, validated and shown in the UI, but
 * the evaluator gated on `repeat_interval_minutes` alone — so a rule with a
 * 10-minute delay paged on the first sweep, and the field was decoration.
 *
 * The state has to be durable. The obvious implementation is a Map of
 * first-matched timestamps, and it is wrong for the same reason the repeat
 * interval is not held in memory: the sweeps that matter happen during an
 * incident, which is exactly when the process restarts. A crash-loop would
 * re-arm from zero on every boot and the delay would never elapse — a rule that
 * silently never fires, which is the worst failure an alerting path has.
 *
 * So arming is a row, in the table that already exists for "why was I paged":
 * `actions_taken = {"pending":true}`. The sweep that first sees a match writes
 * it; a later sweep delivers once D has elapsed, and replaces it. If the
 * condition stops matching in between, the arming row is deleted — that is the
 * "still true" half of the semantics, and it is what makes a 30-second blip
 * cost nothing.
 */
async function armedSince(rule, signature) {
  const { rows } = await db.query(
    `SELECT triggered_at FROM platform.error_escalation_log
      WHERE rule_id = $1 AND signature = $2 AND ${PENDING}
      ORDER BY triggered_at DESC LIMIT 1`,
    [rule.id, signature],
  );
  return rows[0] ? rows[0].triggered_at : null;
}

async function arm(rule, match) {
  await db.query(
    `INSERT INTO platform.error_escalation_log (rule_id, error_id, signature, actions_taken, notes)
     VALUES ($1, $2, $3, '{"pending":true}'::jsonb, $4)`,
    [rule.id, match.error_id, match.signature, `armed — waiting ${rule.escalation_delay_minutes}m for the condition to persist`],
  );
}

/**
 * Drop arming rows for signatures this rule no longer matches. Called once per
 * rule per sweep with the current match set, so recovery disarms the rule
 * without anybody being paged.
 */
async function clearStaleArming(rule, signatures) {
  await db.query(
    `DELETE FROM platform.error_escalation_log
      WHERE rule_id = $1 AND ${PENDING}
        AND NOT (signature = ANY($2::text[]))`,
    [rule.id, signatures],
  );
}

/** Consume the arming row once the delivery it was waiting for has happened. */
async function disarm(rule, signature) {
  await db.query(
    `DELETE FROM platform.error_escalation_log
      WHERE rule_id = $1 AND signature = $2 AND ${PENDING}`,
    [rule.id, signature],
  );
}

/**
 * Deliver a rule's actions. Each channel is independent and failure-isolated:
 * a dead webhook must not stop the email that would have woken somebody up.
 */
async function deliver(rule, match) {
  const taken = {};

  if (rule.action_email && rule.email_recipients.length) {
    // Sent through the PLATFORM mailer, not the tenant email queue.
    //
    // This was `enqueue("email-send", { to, subject, text })`, which was wrong
    // three ways and silent about all of them: the queue is registered as
    // "email" (email-send is the handler FILE), `enqueue` takes
    // (name, jobName, data) so the payload landed in the jobName slot, and
    // handlers/email-send.js throws without `tenantMeta` — which a platform-wide
    // escalation can never have.
    //
    // The damage was not the missing email; it was that `enqueue` RESOLVED, so
    // `taken.email` recorded a success and error_escalation_log said the page
    // went out. See services/platform/platform-mail.service.js.
    try {

      const platformMail = require("./platform-mail.service");
      const result = await platformMail.send({
        to: rule.email_recipients,
        subject: `[PRAXIS-LS] [${String(match.level).toUpperCase()}] ${match.module || "Platform"} — ${String(match.message).slice(0, 80)}`,
        text: renderEmailBody(match),
      });
      // Record what HAPPENED, not what was attempted. A rule whose recipients
      // are configured but whose relay is not must read as a failure here, or
      // the log becomes a record of intentions.
      if (result.ok) taken.email = rule.email_recipients;
      else taken.email_error = result.reason;
    } catch (err) {
      logger.warn({ err, rule: rule.id }, "escalation: email dispatch failed");
      taken.email_error = String(err.message || err);
    }
  }

  if (rule.action_webhook_url) {
    try {
      const res = await fetch(rule.action_webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: renderEmailBody(match), praxis: match }),
        signal: AbortSignal.timeout(5000),
      });
      taken.webhook = res.ok ? "ok" : `status_${res.status}`;
    } catch (err) {
      logger.warn({ err, rule: rule.id }, "escalation: webhook failed");
      taken.webhook = "failed";
    }
  }

  if (rule.action_inhouse) {
    // TWO deliveries, and the order is the point.
    //
    // This used to be the socket broadcast ALONE. A socket reaches whoever has
    // the console open at that instant — which, for a rule whose whole purpose
    // is to catch a 3am outage, is nobody — and socket.io does not queue for
    // absent clients, so the event was simply gone. The feature demonstrated
    // perfectly and delivered nothing.
    //
    // The durable notification is now the delivery; the broadcast is the live
    // nudge for anyone already watching. Failures are isolated from each other
    // and from the email/webhook channels above.
    try {

      const notifications = require("./notifications.service");
      const result = await notifications.notifyCapable({
        title: `[${String(match.level).toUpperCase()}] ${match.module || "Platform"} — ${rule.name}`,
        body: `${String(match.message).slice(0, 200)} — ${match.occurrence_count} occurrence${match.occurrence_count === 1 ? "" : "s"}`,
        metadata: {
          error_id: match.error_id,
          error_signature: match.signature,
          module: match.module,
          route: match.route,
          rule_id: rule.id,
          rule_name: rule.name,
          tenant: match.tenant_slug || null,
        },
      });
      taken.in_house = result.sent;
      if (result.suppressed) taken.in_house_suppressed = result.suppressed;
    } catch (err) {
      logger.warn({ err, rule: rule.id }, "escalation: in-house notification failed");
      taken.in_house = false;
    }

    try {

      require("../../realtime/platform-ns").broadcastEscalation({ rule_id: rule.id, rule_name: rule.name, ...match });
    } catch {
      /* The notification row is the delivery; a dead socket changes nothing. */
    }
  }

  await db.query(
    `INSERT INTO platform.error_escalation_log (rule_id, error_id, signature, actions_taken)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [rule.id, match.error_id, match.signature, JSON.stringify(taken)],
  );

  return taken;
}

/** Appendix B email body template. */
function renderEmailBody(m) {
  return [
    `Error Level: ${m.level}`,
    `Module: ${m.module || "—"}`,
    `Route: ${m.route || "—"}`,
    `Occurrence Count: ${m.occurrence_count}`,
    `Last Occurrence: ${m.last_seen}`,
    m.tenant_slug ? `Tenant: ${m.tenant_slug}` : "Scope: platform-wide",
    "",
    m.message,
  ].join("\n");
}

/**
 * One evaluation pass across all active rules. Called by the scheduled job.
 * Never throws — a broken rule must not stop the others being evaluated.
 */
async function evaluate() {
  const fired = [];
  let rules = [];
  try {
    const { rows } = await db.query(
      `SELECT ${RULE_COLUMNS} FROM platform.error_escalation_rule r WHERE active`,
    );
    rules = rows;
  } catch (err) {
    logger.warn({ err }, "escalation: could not load rules");
    return { fired: [], rules: 0 };
  }

  for (const rule of rules) {
    try {
       
      const matches = await matchesFor(rule);
      const delay = Number(rule.escalation_delay_minutes) || 0;

      // Disarm first. A rule that has recovered must lose its pending rows even
      // on a sweep where it matches nothing at all, or the next unrelated blip
      // inherits a clock that started during the previous incident.

      if (delay > 0) await clearStaleArming(rule, matches.map((m) => m.signature));

      for (const match of matches) {

        if (await recentlyFired(rule, match.signature)) continue;

        if (delay > 0) {

          const since = await armedSince(rule, match.signature);
          if (!since) {

            await arm(rule, match);
            continue;
          }
          if (Date.now() - new Date(since).getTime() < delay * 60000) continue;
        }


        const taken = await deliver(rule, match);

        if (delay > 0) await disarm(rule, match.signature);
        fired.push({ rule: rule.name, signature: match.signature, taken });
      }
    } catch (err) {
      logger.warn({ err, rule: rule.id }, "escalation: rule evaluation failed");
    }
  }

  return { fired, rules: rules.length };
}

module.exports = {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  ruleLog,
  evaluate,
  matchesFor,
  previewMatches,
  renderEmailBody,
  // Exported for the delay-clock tests — the arming lifecycle is the part of
  // this engine with no HTTP surface, so it is otherwise unreachable.
  recentlyFired,
  armedSince,
  clearStaleArming,
};
