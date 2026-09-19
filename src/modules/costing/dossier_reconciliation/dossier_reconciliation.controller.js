"use strict";
const service = require("./dossier_reconciliation.service");
const statement = require("./dossier_reconciliation.statement");
const vault = require("../../vault/document_vault/document_vault.service");
const { fileMeta } = require("../../vault/document_vault/document_vault.controller");
const { exportFilename } = require("../../../services/spreadsheet");
const { canSeeRegistrations } = require("../../master/_shared/confidential");
const { asyncHandler } = require("../../../utils/errors");

const actor = (req) => req.user || { user_id: null };
const ip = (req) => req.ip || null;

module.exports = {
  sheet: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.sheetFor(c, { dossierId: req.params.dossierId })) })),

  get: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.get(c, req.params.id)) })),

  patchLine: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.patchLine(c, {
      dossierId: req.params.dossierId,
      costingLineId: req.params.costingLineId,
      // The service distinguishes an ABSENT key from an explicit null, so the
      // body is passed through rather than destructured into defaults.
      fields: req.body,
      actor: actor(req), ip: ip(req),
    })) })),

  applyReason: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.applyReason(c, {
      dossierId: req.params.dossierId,
      reason: req.body.reason,
      costingLineIds: req.body.costing_line_ids,
      actor: actor(req), ip: ip(req),
    })) })),

  attachDocument: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.attachDocument(c, {
      dossierId: req.params.dossierId,
      costingLineId: req.params.costingLineId,
      docId: req.body.doc_id,
      note: req.body.note,
      actor: actor(req), ip: ip(req),
    })) })),

  detachDocument: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.detachDocument(c, {
      dossierId: req.params.dossierId,
      costingLineId: req.params.costingLineId,
      docId: req.params.docId,
      actor: actor(req), ip: ip(req),
    })) })),

  submit: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.submit(c, {
      dossierId: req.params.dossierId, note: req.body.note, actor: actor(req), ip: ip(req),
    })) })),

  // §8.1 (owner decision B): the tray row's journal link — the lazy read, hit
  // when a row is expanded, never on the sheet GET.
  unaccountedEntry: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.unaccountedEntryFor(c, {
      dossierId: req.params.dossierId, costEntryId: req.params.costEntryId,
    })) })),

  // Map the entry to a budget line: the fix that clears the tray. The service
  // re-reads the sheet and returns it, so the caller's grid and tray update
  // together.
  mapUnaccounted: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.mapUnaccounted(c, {
      dossierId: req.params.dossierId,
      costEntryId: req.params.costEntryId,
      costingLineId: req.body.costing_line_id,
      actor: actor(req), ip: ip(req),
    })) })),

  reject: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.reject(c, {
      dossierId: req.params.dossierId, reason: req.body.reason, actor: actor(req), ip: ip(req),
    })) })),

  settle: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.settle(c, {
      dossierId: req.params.dossierId, returned: req.body.returned, actor: actor(req), ip: ip(req),
    })) })),

  // "Cash to account for". `/owed` is the CALLER'S own — ungated, like
  // hr_query's /mine: a person may always see what they personally owe.
  owedMine: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.receiptsOwed(c, { userId: (req.user || {}).user_id || null })) })),

  owedAll: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.receiptsOwed(c, { userId: null })) })),

  /**
   * THE STATEMENT DOWNLOAD (Q19). The operator picks the shape; both are
   * rendered from the same `statementData`, so the PDF the client is shown
   * and the spreadsheet the auditor works from cannot disagree on a number
   * — one model, two renderings, which is precisely where the legacy's
   * print-versus-email-body divergence lived.
   *
   * · pdf — through the documents kit: tenant letterhead, dd/mm/yyyy dates,
   *   the variance reasons and the proofs ON the page, and a vault capture
   *   under a stable ref (the first render of a settled round becomes the
   *   row `settlement.statement_doc_id` points at).
   * · xlsx — the same rows tabulated through services/spreadsheet, for the
   *   part of the audit that is done in Excel rather than on paper.
   *
   * Gated on `export` (Q19): a print is a publish.
   */
  statement: asyncHandler(async (req, res) => {
    const out = await req.tenantDb(async (c) => {
      if (req.query.format === "xlsx") {
        // registrationNumbers (PR-04): the cover's RCCM/NIU are our own entity's
        // statutory identifiers and follow the caller's MOD-01 view grant. The
        // PDF half keeps the documents kit's letterhead — a rendered statement
        // carries its statutory mentions by design (CE-18).
        const x = await statement.statementXlsx(c, { dossierId: req.params.dossierId, registrationNumbers: await canSeeRegistrations(req) });
        return {
          buffer: x.buffer,
          filename: exportFilename({ base: x.filenameBase, env: req.env, extension: "xlsx" }),
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
      }
      const data = await statement.statementData(c, { dossierId: req.params.dossierId });
      // When the settled round already has its render, serve THAT row — the
      // PDF of record, hash and all. Check the vault's own access rule FIRST
      // (401/403/404 with their honest statuses — a doc the caller may not
      // read must not become a 409 from fetchBytes' pending-row guard), then
      // reuse the bytes. Anything else renders fresh.
      if (data.statement_doc_id) {
        const identity = req.identityDb ? await req.identityDb((i) => i) : null;
        await vault.assertDocumentAccess(c, identity || c, data.statement_doc_id, req.user, "view");
        const { doc, buffer } = await vault.fetchBytes(c, data.statement_doc_id);
        const meta = fileMeta(doc);
        return { buffer, filename: meta.filename, contentType: meta.contentType };
      }
      const doc = await statement.statementPdf(c, { dossierId: req.params.dossierId, actor: actor(req) });
      const { buffer } = await vault.fetchBytes(c, doc.doc_id);
      return { buffer, filename: `${data.number}.pdf`, contentType: "application/pdf" };
    });
    res.setHeader("Content-Type", out.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", out.buffer.length);
    res.send(out.buffer);
  }),

  /** Post to the file's Smart Comms conversation (Q19-C). In-house only:
   *  the dossier thread or a direct message, never an email to the client —
   *  the vault attachment is a POINTER, and a pointer is secure exactly
   *  because it resolves back through the permission gate on every read. */
  sendStatement: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => statement.sendStatement(c, {
      dossierId: req.params.dossierId,
      target: req.body.target || "channel",
      userId: req.body.user_id || null,
      note: req.body.note || null,
      actor: actor(req), ip: ip(req),
    })) })),

  /**
   * Spend over the life of the file — the third chart of the Full view. A
   * separate endpoint rather than folded into the sheet: the sheet is read
   * constantly, this is read when the drawer opens, and the two never have
   * to race (drawer lazy-loads, §6.3).
   */
  timeline: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.timeline(c, { dossierId: req.params.dossierId })) })),
};
