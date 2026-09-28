"use strict";
const service = require("./financial_dictionary.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { readPermissions } = require("../../../middleware/rbac");
const { exportFilename } = require("../../../services/spreadsheet");
const { sendPaged } = require("../../../shared/http/paged");
const actor = (req) => req.user || { user_id: null };
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

/**
 * A price on a dictionary write is an EXPENSE-RATE write (MOD-10), whichever
 * screen it came from. The dictionary routes only check MOD-05, so a payload
 * that carries a price is checked here too — otherwise the create wizard and
 * the import would be a side door around the gate on the rate endpoints.
 */
async function assertCanPrice(req) {
  const [ok] = await readPermissions(req, [["MOD-10", "create"]]);
  if (!ok) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Setting a price needs the Expense rates permission. Save the line without a price and ask someone who manages rates to set its standard rate.",
      403,
    );
  }
}
const hasPrice = (v) => v !== null && v !== undefined && String(v).trim() !== "";

/**
 * Who may open each usage drill-in, and what the refusal says.
 *
 * The 360's tile COUNTS need only the dictionary (MOD-05): "used on 14 costing
 * lines" is a fact about the line. The ROWS behind them are not — they name the
 * client, the file and the amount of documents another module owns — so each
 * list asks for that module's own view grant, the one its screen asks for. A
 * drill-in must not be a side door around the Costing or Invoices permission.
 *
 * Invoices are two modules: finals and credit notes are MOD-51, proformas are
 * MOD-50. The list is narrowed to the types the viewer may open rather than
 * refused whole, so someone who handles proformas still sees theirs.
 *
 * Rates carry no extra gate: they are the line's own price history, and the
 * Cost & evolution tab already shows every one of them on MOD-05 alone.
 */
const USAGE_GATE = {
  costings: { module: "MOD-46", name: "Costing" },
  cash_requests: { module: "MOD-49", name: "Cash requests" },
  purchase_orders: { module: "MOD-60", name: "Purchase orders" },
};
const denied = (name) => new AppError(
  "PERMISSION_DENIED",
  `Listing these needs the ${name} permission. The count on the tile is all this screen can show you.`,
  403,
);
async function usageInvoiceTypes(req) {
  const [finals, proformas] = await readPermissions(req, [["MOD-51", "view"], ["MOD-50", "view"]]);
  const types = [];
  if (finals) types.push("FINAL", "CREDIT_NOTE");
  if (proformas) types.push("PROFORMA");
  if (!types.length) throw denied("Invoices");
  return types;
}

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listItems(c, req.query)) })),
  // The shared finder (DictionaryFinder). Returns [] for a blank term rather
  // than the whole catalogue: a picker that dumps 176 rows before you type is
  // not a finder, and the caller already has `list` if it wants to browse.
  search: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.searchItems(c, {
      q: req.query.q,
      limit: req.query.limit,
      direction: req.query.direction,
      service_type_id: req.query.service_type_id,
      include_inactive: req.query.include_inactive === "true",
    })),
  })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.json({ data: r });
  }),
  dossier: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.dossier(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    // Whether this viewer may change the line's price — the overview's pencil
    // is shown only when the rate endpoints would accept the save.
    const [editRates] = await readPermissions(req, [["MOD-10", "edit"]]);
    res.json({ data: { ...r, capabilities: { edit_rates: editRates === true } } });
  }),
  // One page of the rows behind a 360 usage tile (`X-Total-Count` carries the
  // total). `:kind` was checked by the validator.
  usage: asyncHandler(async (req, res) => {
    const kind = req.params.kind;
    let invoiceTypes = [];
    const gate = USAGE_GATE[kind];
    if (kind === "invoices") {
      invoiceTypes = await usageInvoiceTypes(req);
    } else if (gate) {
      const [ok] = await readPermissions(req, [[gate.module, "view"]]);
      if (!ok) throw denied(gate.name);
    }
    const r = await req.tenantDb((c) => service.listUsage(c, req.params.id, kind, req.query, { invoiceTypes }));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    sendPaged(res, r);
  }),
  create: asyncHandler(async (req, res) => {
    if (hasPrice(req.body.default_price)) await assertCanPrice(req);
    res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) });
  }),
  update: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) }));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.json({ data: r });
  }),

  /* ── PR2: spend, cost evolution ─────────────────────────────────────────── */
  spend: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.spend(c, req.params.id, {
      from: req.query.from, to: req.query.to,
      dossier_id: req.query.dossier_id || null,
      include_documents: req.query.include_documents !== "false",
    }));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    res.json({ data: r });
  }),
  spendDocuments: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.spendDocumentsPage(c, req.params.id, req.query));
    if (!r) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    sendPaged(res, r);
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
  applyRateToProviders: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.applyRateToProviders(c, { id: req.params.id, data: req.body, actor: actor(req) }));
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
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename({ base: "financial-dictionary-template", env: req.env, extension: "xlsx" })}"`);
    res.send(buffer);
  }),
  importValidate: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.importValidate(c, { buffer: decodeUpload(req.body.file) }));
    res.json({ data: r });
  }),
  importCommit: asyncHandler(async (req, res) => {
    if ((req.body.rows || []).some((row) => hasPrice(row && row.raw && row.raw.default_price))) await assertCanPrice(req);
    const r = await req.tenantDb((c) => service.importCommit(c, { rows: req.body.rows, actor: actor(req) }));
    res.status(201).json({ data: r });
  }),
  importErrors: asyncHandler(async (req, res) => {
    // req.tenantDb, not a bare call: the error file is branded like the template
    // it answers, which needs the tenant context resolved on the connection.
    const buffer = await req.tenantDb((c) => service.importErrorFile(c, req.body.rows));
    res.setHeader("Content-Type", XLSX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename({ base: "financial-dictionary-rejected", env: req.env, extension: "xlsx" })}"`);
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
