"use strict";
const service = require("./expense_rate.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { exportFilename } = require("../../../services/spreadsheet");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Expense rate not found", 404); res.json({ data: r }); }),
  resolve: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.resolve(c, {
      dictionaryItemId: req.query.dictionary_item_id,
      date: req.query.date,
      rateProviderId: req.query.rate_provider_id,
      containerTypeRefId: req.query.container_type_ref_id,
    })),
  })),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, {
      dictionaryItemId: b.dictionary_item_id,
      rateProviderId: b.rate_provider_id,
      containerTypeRefId: b.container_type_ref_id,
      rate: b.rate, currency: b.currency,
      effectiveFrom: b.effective_from, effectiveTo: b.effective_to,
      note: b.note,
      actor: actor(req),
    }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  remove: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.remove(c, { id: req.params.id, actor: actor(req) })) })),

  // ── G7: bulk Excel import ────────────────────────────────────────────────
  importTemplate: asyncHandler(async (req, res) => {
    const buffer = await req.tenantDb((c) => service.importTemplate(c));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename({ base: "expense-rate-template", env: req.env, extension: "xlsx" })}"`);
    res.send(Buffer.from(buffer));
  }),
  importValidate: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.importValidate(c, { buffer: decodeUpload(req.body.file) })) })),
  importCommit: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.importCommit(c, { rows: req.body.rows, actor: actor(req) })) })),
};

/** Decode the base64 data-URL the client sends (same convention as the vault
 *  and the financial-dictionary importer). */
function decodeUpload(file) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(file || ""));
  const b64 = m ? m[2] : String(file || "");
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length === 0) {
    const e = new Error("Expected a base64-encoded .xlsx workbook");
    e.status = 400;
    throw e;
  }
  return buffer;
}
