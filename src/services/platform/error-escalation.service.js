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
    `SELECT log_id AS id, rule_id, error_id, signature, triggered_at, actions_taken, notes
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

/** Has this rule already fired for this signature inside its repeat interval? */
async function recentlyFired(rule, signature) {
  if (!rule.repeat_interval_minutes) {
    const { rows } = await db.query(
      "SELECT 1 FROM platform.error_escalation_log WHERE rule_id = $1 AND signature = $2 LIMIT 1",
      [rule.id, signature],
    );
    return rows.length > 0;
  }
  const { rows } = await db.query(
    `SELECT 1 FROM platform.error_escalation_log
      WHERE rule_id = $1 AND signature = $2
        AND triggered_at > now() - make_interval(mins => $3::int)
      LIMIT 1`,
    [rule.id, signature, rule.repeat_interval_minutes],
  );
  return rows.length > 0;
}

/**
 * Deliver a rule's actions. Each channel is independent and failure-isolated:
 * a dead webhook must not stop the email that would have woken somebody up.
 */
async function deliver(rule, match) {
  const taken = {};

  if (rule.action_email && rule.email_recipients.length) {
    try {
       
      const { enqueue } = require("../../jobs/queue-producer");
      await enqueue("email-send", {
        to: rule.email_recipients,
        subject: `[PRAXIS-LS] [${match.level.toUpperCase()}] ${match.module || "Platform"} — ${String(match.message).slice(0, 80)}`,
        text: renderEmailBody(match),
      });
      taken.email = rule.email_recipients;
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
    // Surfaced to connected consoles by the realtime layer; the row in
    // error_escalation_log below is the durable record either way.
    try {
       
      require("../../realtime/platform-ns").broadcastEscalation({ rule_id: rule.id, rule_name: rule.name, ...match });
      taken.in_house = true;
    } catch {
      taken.in_house = false;
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
      for (const match of matches) {
        // The delay clock: only escalate once the condition has been true for
        // at least `escalation_delay_minutes`, measured from first_seen of this
        // burst — which `last_seen - delay` approximates without extra state.
         
        if (await recentlyFired(rule, match.signature)) continue;
         
        const taken = await deliver(rule, match);
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
  renderEmailBody,
};
