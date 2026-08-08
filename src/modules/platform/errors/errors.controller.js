/**
 * Error Command Center HTTP controller. Thin — delegates to the services.
 * Response envelope matches the rest of /api/platform: { data }.
 */
"use strict";

const errors = require("../../../services/platform/errors.service");
const explainer = require("../../../services/platform/error-explain.service");
const escalation = require("../../../services/platform/error-escalation.service");
const share = require("../../../services/platform/error-share.service");
const notifications = require("../../../services/platform/notifications.service");
const health = require("../../../services/platform/health.service");
const platformNs = require("../../../realtime/platform-ns");
const { asyncHandler } = require("../../../utils/errors");

const actor = (req) => (req.platformUser ? req.platformUser.platform_user_id : null);

const list = asyncHandler(async (req, res) => res.json({ data: await errors.list(req.query) }));

const recent = asyncHandler(async (req, res) =>
  res.json({
    data: await errors.recent({
      since: req.query.since,
      limit: req.query.limit,
      scope: req.query.scope,
      tenant: req.query.tenant,
    }),
  }),
);

const stats = asyncHandler(async (req, res) => res.json({ data: await errors.stats(req.query) }));

const trends = asyncHandler(async (req, res) => res.json({ data: await errors.trends(req.query) }));

const modules = asyncHandler(async (_req, res) => res.json({ data: await errors.modules() }));

const get = asyncHandler(async (req, res) => res.json({ data: await errors.get(req.params.id) }));

/**
 * Resolution also pushes `error_resolved` to every connected console, so a
 * second admin looking at the same feed sees it disappear rather than
 * discovering on click that somebody already fixed it.
 */
const resolve = asyncHandler(async (req, res) => {
  const result = await errors.resolve(req.params.id, actor(req));
  platformNs.broadcastResolved({
    id: result.id,
    signature: result.signature,
    resolved_by: result.resolved_by,
    resolved_at: result.resolved_at,
  });
  res.json({ data: result });
});

const reopen = asyncHandler(async (req, res) => res.json({ data: await errors.reopen(req.params.id, actor(req)) }));

const explain = asyncHandler(async (req, res) =>
  res.json({
    data: await explainer.explain({
      errorId: req.params.id,
      actorId: actor(req),
      force: req.body && req.body.force === true,
    }),
  }),
);

/** Pre-rendered share payloads (§3.3 / Appendix B) — built server-side so the
 *  WhatsApp, email and clipboard forms cannot drift apart across clients. */
const shareTargets = asyncHandler(async (req, res) => {
  const row = await errors.get(req.params.id);
  // §11 — "audit log for error resolutions and shares". Building the payload IS
  // the share: the WhatsApp and mailto legs leave the browser without touching
  // the server again, so this endpoint is the last point at which "who took a
  // stack trace out of the console" can be recorded at all.
  await errors.audit(actor(req), "error.shared", row.signature, { error_id: row.id, tenant: row.tenant_slug || null });
  res.json({ data: share.build(row, { baseUrl: share.consoleBaseUrl(req) }) });
});

/**
 * GET /errors/export — CSV or JSON (§6).
 * CSV is the default because the request is nearly always "put this in a
 * spreadsheet"; JSON is there for re-import and scripting.
 */
const exportErrors = asyncHandler(async (req, res) => {
  const rows = await errors.exportAll(req.query);
  const stamp = new Date().toISOString().slice(0, 10);

  if (String(req.query.format || "csv").toLowerCase() === "json") {
    res.setHeader("Content-Disposition", `attachment; filename="praxis-errors-${stamp}.json"`);
    return res.json({ data: rows });
  }

  const cols = [
    "id", "signature", "level", "origin", "tenant_slug", "module", "route",
    "file_path", "line_number", "occurrence_count", "first_seen", "last_seen",
    "resolved_at", "resolved_by_name", "message",
  ];
  // RFC 4180: quote everything and double embedded quotes. Error messages
  // routinely contain commas, quotes and newlines — an unquoted CSV of error
  // text is corrupt on roughly the first interesting row.
  const esc = (v) => `"${String(v === null || v === undefined ? "" : v).replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="praxis-errors-${stamp}.csv"`);
  return res.send(csv);
});

// ── Escalation rules (§5) ───────────────────────────────────────────────────
const rulesList = asyncHandler(async (_req, res) => res.json({ data: await escalation.listRules() }));
const ruleCreate = asyncHandler(async (req, res) =>
  res.status(201).json({ data: await escalation.createRule(req.body, actor(req)) }),
);
const ruleUpdate = asyncHandler(async (req, res) =>
  res.json({ data: await escalation.updateRule(req.params.id, req.body) }),
);
const ruleDelete = asyncHandler(async (req, res) =>
  res.json({ data: await escalation.deleteRule(req.params.id) }),
);
const ruleLog = asyncHandler(async (req, res) =>
  res.json({ data: await escalation.ruleLog(req.query.rule_id, Number(req.query.limit) || 50) }),
);
/** Dry-run a rule against live data before saving it — "would this have paged
 *  me?" is the question every threshold rule needs answered before it is armed. */
const rulePreview = asyncHandler(async (req, res) =>
  res.json({ data: await escalation.previewMatches(req.body) }),
);

// ── In-house notifications (§3.3) ───────────────────────────────────────────

/**
 * The spec's `POST /admin/notifications/push`.
 *
 * Gated on `errors.read` at the route, not on a notifications capability: the
 * thing being shared is an error, so the question "may you send this" is the
 * same question as "may you see this". A separate capability would let someone
 * forward an error they are not allowed to open.
 *
 * The title and body are built SERVER-SIDE from the error id when one is given,
 * for the same reason the share templates are — a client-supplied title on an
 * error notification is a way to put arbitrary text in a colleague's alert
 * feed attributed to the system.
 */
const notificationSend = asyncHandler(async (req, res) => {
  const { to_user_id: toUserId, error_id: errorId, note } = req.body;

  let title = "Shared with you";
  let body = String(note || "").slice(0, 500);
  let metadata = {};

  if (errorId) {
    const row = await errors.get(errorId);
    const built = share.build(row, { baseUrl: share.consoleBaseUrl(req) });
    title = built.in_house.title;
    body = note ? `${built.in_house.body}\n\n— ${String(note).slice(0, 500)}` : built.in_house.body;
    metadata = built.in_house.metadata;
  }

  const created = await notifications.create({
    toUserId,
    fromUserId: actor(req),
    type: errorId ? "error_share" : "system",
    title,
    body,
    metadata,
  });
  res.status(201).json({ data: created });
});

/** Everything below is scoped to the CALLER — there is no "read someone else's". */
const notificationList = asyncHandler(async (req, res) =>
  res.json({
    data: await notifications.list(actor(req), {
      status: req.query.status,
      limit: req.query.limit,
      before: req.query.before,
    }),
  }),
);

const notificationUnread = asyncHandler(async (req, res) =>
  res.json({ data: await notifications.unreadCount(actor(req)) }),
);

const notificationRead = asyncHandler(async (req, res) =>
  res.json({ data: await notifications.markRead(req.params.id, actor(req)) }),
);

const notificationReadAll = asyncHandler(async (req, res) =>
  res.json({ data: await notifications.markAllRead(actor(req)) }),
);

// ── Platform health (§8.2) ──────────────────────────────────────────────────

/**
 * The spec's `GET /admin/health` — uptime % and dependency latency for the
 * Overview widget.
 *
 * Distinct from the unauthenticated `/api/health/ready`, which answers "can
 * this process serve RIGHT NOW" for a load balancer. This one answers "how has
 * the platform behaved over the last 30 days" and is therefore historical,
 * authenticated, and reads a table rather than probing anything.
 */
const healthSummary = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || undefined;
  const [uptime, incidents, capture] = await Promise.all([
    health.uptime({ days }),
    health.incidents({ days, limit: 10 }),
    // Appendix A.5. Bundled here rather than given its own endpoint because the
    // caller that needs it is the same widget, and a separate poll for "is the
    // thing that tells me about problems still working" is a poll people forget
    // to add.
    health.captureHealth({}),
  ]);
  res.json({ data: { ...uptime, incidents, capture } });
});

module.exports = {
  list, recent, stats, trends, modules, get, resolve, reopen,
  explain, shareTargets, exportErrors,
  rulesList, ruleCreate, ruleUpdate, ruleDelete, ruleLog, rulePreview,
  notificationSend, notificationList, notificationUnread, notificationRead, notificationReadAll,
  healthSummary,
};
