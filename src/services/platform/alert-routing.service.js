/**
 * WS-ER1 — severity→channel routing, and the per-tenant error surface.
 *
 * The Error Command Center already exists: `error-reporter.js` posts to
 * ALERT_WEBHOOK_URL, `error-escalation.service.js` evaluates rules, and
 * `server.js` warns at boot when no destination is set. What was missing is
 * everything between "an error happened" and "the right person hears about it":
 *
 *   - ONE destination for everything means either the channel is noisy enough
 *     that people mute it, or it is quiet enough that it misses things. Routing
 *     by severity is what lets a fatal page someone while a warning goes to a
 *     channel nobody is woken by.
 *   - Ops events that are not application errors — a failed backup, a RED
 *     tenant, a failed restore drill — had no path to a channel at all. Those
 *     are the ones §3.2 and §3.1 exist to surface, and they were being written
 *     to a log nobody reads on a schedule.
 *
 * WHY A FAILED ALERT IS LOGGED AND NEVER THROWN
 *
 *   Alerting sits on the failure path by definition. If it can fail loudly it
 *   turns one incident into two, and the second one masks the first. Everything
 *   here resolves; nothing rejects.
 */
"use strict";

const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const platformSettings = require("./settings.service");

/**
 * Severity ladder. `page` is for things that should wake someone, `notify` for
 * things to read in the morning, `log` for the record only.
 */
const SEVERITIES = ["log", "notify", "page"];

/**
 * Route an ops event class to a severity.
 *
 * These are deliberate judgements, not a config table, because the reasoning
 * belongs next to them:
 *
 *   backup.failed          page   — the recovery window is shrinking and nobody
 *                                   finds out later; this is the alert whose
 *                                   absence §3.2 is about.
 *   restore.drill.failed   page   — the backups cannot be trusted. Worse than a
 *                                   failed backup: it means the ones you have
 *                                   may not restore.
 *   integrity.corrupt      page   — silent data corruption, and every hour it
 *                                   goes unnoticed is another backup cycle
 *                                   faithfully preserving the damage.
 *   tenant.red             page   — a tenant cannot serve.
 *   host.down              page   — an availability incident.
 *   backup.stale           notify — no backup in the RPO window, but no failure
 *                                   either: usually a job that stopped running.
 *   tenant.amber           notify — degraded, still serving.
 *   integrity.missing      notify — a document the app will fail to produce.
 *                                   Serious, but bounded and not spreading.
 *   drill.slow             notify — restored, but outside the RTO target.
 */
const EVENT_SEVERITY = {
  "backup.failed": "page",
  "restore.drill.failed": "page",
  "integrity.corrupt": "page",
  "tenant.red": "page",
  "host.down": "page",
  "backup.stale": "notify",
  "tenant.amber": "notify",
  "integrity.missing": "notify",
  "drill.slow": "notify",
  "maintenance.started": "log",
  "maintenance.ended": "log",
};

/**
 * The destination for a severity.
 *
 * RESOLUTION ORDER: platform settings vault → env.
 *
 *   The vault is the primary store and the console is how it is written — the
 *   same rule the AI vendor keys, S3, Geoapify and the mail fallback already
 *   follow. `.env` is the last-resort fallback for a fresh deploy that has not
 *   been configured yet, never the place a running deployment is expected to
 *   keep this.
 *
 *   That distinction matters more here than elsewhere: an alert destination is
 *   the setting you most need to be able to change at 3am, and requiring a
 *   redeploy to repoint a webhook means it does not get repointed.
 *
 * ALERT_WEBHOOK_PAGE_URL / `alerts.page` is optional: when unset, `page` falls
 * back to the general channel rather than going nowhere. A misconfiguration must
 * degrade to "too noisy", never to "silent" — silence is indistinguishable from
 * health, which is the exact failure `server.js` already warns about at boot.
 *
 * Never throws: a vault read that fails degrades to env rather than losing the
 * alert. Alerting sits on the failure path, so it must not add a failure.
 */
async function destinationFor(severity) {
  const fromVault = async (key) => {
    try {
      const row = await platformSettings.resolve("alerts", key);
      const url = row && row.secret ? String(row.secret).trim() : "";
      return url || null;
    } catch (err) {
      logger.warn({ err, key }, "alert destination vault read failed — falling back to env");
      return null;
    }
  };

  if (severity === "page") {
    const paged = (await fromVault("page")) || config.ALERT_WEBHOOK_PAGE_URL;
    if (paged) return { url: paged, channel: "page" };
  }
  const general = (await fromVault("default")) || config.ALERT_WEBHOOK_URL;
  if (general) return { url: general, channel: "default" };
  return null;
}

function formatOpsEvent({ event, severity, subject, detail, tenant }) {
  const head = severity === "page" ? "PAGE" : severity === "notify" ? "NOTICE" : "INFO";
  const lines = [
    `${head} · ${event}${tenant ? ` · ${tenant}` : ""}`,
    subject,
    detail ? (typeof detail === "string" ? detail : JSON.stringify(detail, null, 2).slice(0, 1500)) : null,
    config.APP_BASE_DOMAIN ? `platform: ${config.APP_BASE_DOMAIN}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Raise an operational alert. Fire-and-forget; always resolves.
 *
 * Returns a small result object rather than a boolean so a caller (and a test)
 * can tell "delivered" from "no destination configured" — the second is a
 * deployment problem worth surfacing distinctly, not a delivery failure.
 */
async function raise({ event, subject, detail = null, tenant = null, severity = null }) {
  const sev = severity || EVENT_SEVERITY[event] || "notify";
  if (!SEVERITIES.includes(sev)) throw new Error(`unknown severity "${sev}"`);

  const line = { event, severity: sev, subject, tenant };
  // Always logged, whatever happens to the delivery — the structured log is the
  // record of record, and the webhook is a convenience on top of it.
  logger[sev === "page" ? "error" : sev === "notify" ? "warn" : "info"](
    { ...line, detail },
    `ops alert: ${event}`,
  );

  if (sev === "log") return { ...line, delivered: false, reason: "log-only severity" };

  const dest = await destinationFor(sev);
  if (!dest) {
    logger.warn(line, "ops alert had no destination — set one in Platform Console → Integrations → Alerts");
    return { ...line, delivered: false, reason: "no destination configured" };
  }

  try {
    const res = await fetch(dest.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: formatOpsEvent({ event, severity: sev, subject, detail, tenant }),
        praxis: { ...line, detail },
      }),
      signal: AbortSignal.timeout(5000),
    });
    return { ...line, delivered: res.ok, channel: dest.channel };
  } catch (err) {
    // Swallowed on purpose — see the header. Visible in the log line above.
    logger.warn({ err, event }, "ops alert delivery failed");
    return { ...line, delivered: false, reason: err.message };
  }
}

/**
 * Evaluate the current ops state and raise whatever it warrants.
 *
 * Called after each ops sweep rather than from inside each service, so the
 * decision "is this worth waking someone for" lives in exactly one place and
 * can be reasoned about as a whole.
 */
async function evaluateAndAlert() {
  const raised = [];

  try {
    const health = require("./health-rollup.service");
    const fleet = await health.fleetHealth();
    for (const t of fleet.tenants.filter((x) => x.status === "RED")) {
      raised.push(
        await raise({
          event: "tenant.red",
          tenant: t.slug,
          subject: `Tenant ${t.slug} is RED`,
          detail: t.reasons,
        }),
      );
    }
    // AMBER tenants are summarised in ONE alert rather than one each: a
    // degraded fleet would otherwise produce a burst of messages that buries
    // the RED ones directly above it.
    const amber = fleet.tenants.filter((x) => x.status === "AMBER");
    if (amber.length) {
      raised.push(
        await raise({
          event: "tenant.amber",
          subject: `${amber.length} tenant(s) degraded`,
          detail: amber.map((t) => ({ slug: t.slug, reasons: t.reasons })),
        }),
      );
    }
  } catch (err) {
    logger.error({ err }, "health alert evaluation failed");
  }

  try {
    const backup = require("./backup.service");
    const s = await backup.backupStatus();
    const stale = s.tenants.filter((t) => t.stale);
    if (stale.length) {
      raised.push(
        await raise({
          event: "backup.stale",
          subject: `${stale.length} tenant(s) outside the ${s.rpo_hours}h backup RPO`,
          detail: stale.map((t) => ({
            slug: t.slug,
            last_ok_at: t.last_ok_at,
            never: t.never_backed_up,
          })),
        }),
      );
    }
  } catch (err) {
    logger.error({ err }, "backup alert evaluation failed");
  }

  return raised;
}

module.exports = { raise, evaluateAndAlert, destinationFor, EVENT_SEVERITY, SEVERITIES };
