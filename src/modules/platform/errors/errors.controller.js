/**
 * Error Command Center HTTP controller. Thin — delegates to the services.
 * Response envelope matches the rest of /api/platform: { data }.
 */
"use strict";

const errors = require("../../../services/platform/errors.service");
const explainer = require("../../../services/platform/error-explain.service");
const escalation = require("../../../services/platform/error-escalation.service");
const share = require("../../../services/platform/error-share.service");
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

const reopen = asyncHandler(async (req, res) => res.json({ data: await errors.reopen(req.params.id) }));

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
  res.json({
    data: await escalation.matchesFor({
      tenant_id: null,
      level_filter: req.body.level_filter || ["fatal"],
      threshold_count: req.body.threshold_count ?? 5,
      threshold_window_minutes: req.body.threshold_window_minutes ?? 15,
    }),
  }),
);

module.exports = {
  list, recent, stats, trends, modules, get, resolve, reopen,
  explain, shareTargets, exportErrors,
  rulesList, ruleCreate, ruleUpdate, ruleDelete, ruleLog, rulePreview,
};
