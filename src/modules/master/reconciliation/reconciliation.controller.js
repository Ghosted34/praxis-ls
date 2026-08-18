/**
 * Reconciliation HTTP handlers (MOD-09). Thin: resolve the actor, call the
 * service on the request's tenant connection, shape the response.
 *
 * Field lists are explicit rather than spread, for the same reason
 * treasury_account.controller.js enumerates its own: a spread of req.body can
 * shadow `actor` through key order, and a new column should not become writable
 * from the API by virtue of existing.
 */
"use strict";

const service = require("./reconciliation.service");
const { asyncHandler, AppError } = require("../../../utils/errors");

const actor = (req) => req.user || { user_id: null };

module.exports = {
  /* ── ingest ────────────────────────────────────────────────────────────── */

  // Dry run. Parses in memory, writes nothing, and returns either a ready
  // preview or a mapping proposal to confirm.
  preview: asyncHandler(async (req, res) => {
    res.json({
      // No actor: preview is a pure read that stores nothing, so there is
      // nothing to attribute. The RBAC gate on the route is what guards it.
      data: await req.tenantDb((c) => service.preview(c, {
        treasuryAccountId: req.body.treasury_account_id,
        file: req.body.file,
        filename: req.body.filename,
      })),
    });
  }),

  confirmProfile: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({
      data: await req.tenantDb((c) => service.confirmProfile(c, {
        entityId: b.entity_id,
        sourceKind: b.source_kind,
        actor: actor(req),
        data: {
          institution: b.institution,
          label: b.label,
          header_signature: b.header_signature,
          column_map: b.column_map,
          sign_convention: b.sign_convention,
          debit_indicators: b.debit_indicators,
          date_format: b.date_format,
          decimal_separator: b.decimal_separator,
          thousands_separator: b.thousands_separator,
          encoding: b.encoding,
          delimiter: b.delimiter,
          header_row_index: b.header_row_index,
          data_start_row: b.data_start_row,
          proposed_by_ai: b.proposed_by_ai,
          ai_confidence: b.ai_confidence,
        },
      })),
    });
  }),

  importStatement: asyncHandler(async (req, res) => {
    res.status(201).json({
      data: await req.tenantDb((c) => service.importStatement(c, {
        treasuryAccountId: req.body.treasury_account_id,
        file: req.body.file,
        filename: req.body.filename,
        profileId: req.body.statement_profile_id,
        actor: actor(req),
      })),
    });
  }),

  /* ── reads ─────────────────────────────────────────────────────────────── */

  listProfiles: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listProfiles(c, req.query)) })),

  listStatements: asyncHandler(async (req, res) => {
    if (!req.query.treasury_account_id) {
      throw new AppError("VALIDATION_ERROR", "treasury_account_id is required", 422);
    }
    res.json({ data: await req.tenantDb((c) => service.listStatements(c, req.query)) });
  }),

  getStatement: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.getStatement(c, req.params.id, req.query));
    if (!r) throw new AppError("NOT_FOUND", "Statement not found", 404);
    res.json({ data: r });
  }),

  lineMatches: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.lineMatches(c, req.params.lineId)) })),

  /* ── matching ──────────────────────────────────────────────────────────── */

  runMatcher: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) => service.runMatcher(c, {
        statementId: req.params.id, actor: actor(req), options: req.body || {},
      })),
    });
  }),

  confirmMatch: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.confirmMatch(c, { matchId: req.params.matchId, actor: actor(req) })) })),

  rejectMatch: asyncHandler(async (req, res) =>
    res.json({
      data: await req.tenantDb((c) => service.rejectMatch(c, {
        matchId: req.params.matchId, reason: req.body.reason, actor: actor(req),
      })),
    })),

  manualMatch: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await req.tenantDb((c) => service.manualMatch(c, {
        statementLineId: req.body.statement_line_id,
        journalLineId: req.body.journal_line_id,
        actor: actor(req),
      })),
    })),

  ignoreLine: asyncHandler(async (req, res) =>
    res.json({
      data: await req.tenantDb((c) => service.ignoreLine(c, {
        statementLineId: req.params.lineId, reason: req.body.reason, actor: actor(req),
      })),
    })),

  /* ── the etat de rapprochement ─────────────────────────────────────────── */

  buildReconciliation: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await req.tenantDb((c) => service.buildReconciliation(c, {
        treasuryAccountId: req.body.treasury_account_id,
        statementId: req.body.statement_id,
        periodStart: req.body.period_start,
        periodEnd: req.body.period_end,
        actor: actor(req),
      })),
    })),

  listReconciliations: asyncHandler(async (req, res) => {
    if (!req.query.treasury_account_id) {
      throw new AppError("VALIDATION_ERROR", "treasury_account_id is required", 422);
    }
    res.json({ data: await req.tenantDb((c) => service.listReconciliations(c, req.query)) });
  }),

  getReconciliation: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.getReconciliation(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
    res.json({ data: r });
  }),

  approveReconciliation: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.approveReconciliation(c, { reconciliationId: req.params.id, actor: actor(req) })) })),

  // Renders, stores and vaults the signed document. Returns the vault
  // reference rather than the bytes: the viewer already knows how to fetch a
  // document by doc_id, and streaming a PDF through this route would give the
  // product a second way to read the same file.
  renderReconciliationDocument: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await req.tenantDb((c) => service.renderReconciliationDocument(c, {
        reconciliationId: req.params.id, actor: actor(req),
      })),
    })),

  renderCashCountDocument: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await req.tenantDb((c) => service.renderCashCountDocument(c, {
        cashCountId: req.params.id, actor: actor(req),
      })),
    })),

  /* ── cash census ───────────────────────────────────────────────────────── */

  recordCashCount: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await req.tenantDb((c) => service.recordCashCount(c, {
        treasuryAccountId: req.body.treasury_account_id,
        countedOn: req.body.counted_on,
        denominations: req.body.denominations,
        countedTotal: req.body.counted_total,
        witnessUserId: req.body.witness_user_id,
        varianceReason: req.body.variance_reason,
        actor: actor(req),
      })),
    })),

  attestCashCount: asyncHandler(async (req, res) =>
    res.json({
      data: await req.tenantDb((c) => service.attestCashCount(c, {
        cashCountId: req.params.id, varianceReason: req.body.variance_reason, actor: actor(req),
      })),
    })),

  listCashCounts: asyncHandler(async (req, res) => {
    if (!req.query.treasury_account_id) {
      throw new AppError("VALIDATION_ERROR", "treasury_account_id is required", 422);
    }
    res.json({ data: await req.tenantDb((c) => service.listCashCounts(c, req.query)) });
  }),
};
