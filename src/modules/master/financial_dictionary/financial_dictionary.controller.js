"use strict";
const service = require("./financial_dictionary.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
const stamp = () => new Date().toISOString().slice(0, 10);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Decode the uploaded workbook.
 *
 * Same base64 data-URL convention as the document vault (document_vault.service
 * :97) — one upload shape across the product, and no multipart middleware to
 * mount for a single endpoint. Express caps the JSON body at 2 MB
 * (server.js:169), which is a ~1.5 MB workbook: comfortably more than the
 * 2000-row ceiling the parser enforces, and a hard stop on someone uploading
 * their whole ledger by accident.
 *
 * A bare base64 string is accepted as well as a full data URL, because the two
 * browser paths (FileReader.readAsDataURL vs a manual btoa) produce different
 * shapes and rejecting one of them is a bug report, not a security control.
 *
 * 400, not 422 — matching document_vault, which raises BAD_FILE/400 for this
 * exact condition. The transport was malformed, so there is nothing to process;
 * the 422s live one level down in the parser, where the bytes decoded fine and
 * the WORKBOOK is what is wrong (unreadable as .xlsx, no recognised headers).
 */
function decodeUpload(file) {
  const s = String(file || "");
  const m = /^data:([^;]*);base64,(.+)$/s.exec(s);
  const b64 = m ? m[2] : s;
  if (!/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(b64.slice(0, 4096))) {
    throw new AppError("BAD_FILE", "Expected a base64-encoded .xlsx workbook", 400);
  }
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length === 0) throw new AppError("BAD_FILE", "The uploaded file is empty", 400);
  return buffer;
}

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listItems(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.json({ data: r });
  }),
  dossier: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.dossier(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.json({ data: r });
  }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) }));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.json({ data: r });
  }),

  /* ── PR2: spend, cost evolution ─────────────────────────────────────────── */
  spend: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.spend(c, req.params.id, {
      from: req.query.from, to: req.query.to,
      include_documents: req.query.include_documents !== "false",
    }));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.json({ data: r });
  }),
  rateEvolution: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.rateEvolution(c, req.params.id, { as_of: req.query.as_of }));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.json({ data: r });
  }),
  supersedeRate: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.supersedeRate(c, { id: req.params.id, data: req.body, actor: actor(req) }));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.status(201).json({ data: r });
  }),

  /* ── PR2: bulk Excel import ─────────────────────────────────────────────── */
  // Streams the workbook rather than vaulting it: a template is generated fresh
  // from the tenant's CURRENT accounts and service keys every time, so a stored
  // copy would go stale the first time someone adds an account.
  importTemplate: asyncHandler(async (req, res) => {
    const buffer = await req.tenantDb((c) => service.importTemplate(c));
    res.setHeader("Content-Type", XLSX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="financial-dictionary-template-${stamp()}.xlsx"`);
    res.send(buffer);
  }),
  importValidate: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.importValidate(c, { buffer: decodeUpload(req.body.file) }));
    res.json({ data: r });
  }),
  importCommit: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.importCommit(c, { rows: req.body.rows, actor: actor(req) }));
    res.status(201).json({ data: r });
  }),
  importErrors: asyncHandler(async (req, res) => {
    const buffer = await service.importErrorFile(req.body.rows);
    res.setHeader("Content-Type", XLSX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="financial-dictionary-rejected-${stamp()}.xlsx"`);
    res.send(buffer);
  }),

  // dictionary_ref registry (the seeded-but-editable dropdown values).
  listRefs: asyncHandler(async (req, res) => {
    const kind = String(req.query.kind || "").toUpperCase();
    if (!kind) throw new AppError("VALIDATION_ERROR", "kind is required", 422);
    const includeInactive = req.query.include_inactive === "true";
    res.json({ data: await req.tenantDb((c) => service.listRefs(c, kind, includeInactive)) });
  }),
  createRef: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createRef(c, { data: req.body, actor: actor(req) })) })),
  updateRef: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.updateRef(c, { id: req.params.id, patch: req.body, actor: actor(req) }));
    if (!r) throw new AppError("NOT_FOUND", "Reference value not found", 404);
    res.json({ data: r });
  }),
};
