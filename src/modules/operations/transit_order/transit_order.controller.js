"use strict";
const service = require("./transit_order.service");
const { asyncHandler, AppError } = require("../../../utils/errors");

const actor = (req) => req.user || { user_id: null };
const lang = (req) => (req.query && req.query.lang === "fr" ? "fr" : "en");

/** Request body → service arguments. One place, so five endpoints agree. */
const headArgs = (b) => ({
  entityId: b.entity_id,
  dossierId: b.dossier_id,
  customsRegime: b.customs_regime,
  customsRegimeOther: b.customs_regime_other,
  serviceDirection: b.service_direction,
  declaredValue: b.declared_value,
  declaredCurrency: b.declared_currency,
  declaredFxToXaf: b.declared_fx_to_xaf,
  insuranceType: b.insurance_type,
  surveyorParty: b.surveyor_party,
  departureDate: b.departure_date,
  instructions: b.instructions,
  submittedDocs: b.submitted_docs,
});

/** Only the keys the caller actually sent — an absent key must not blank a column. */
const patchOf = (b) => {
  const out = {};
  const keys = [
    "entity_id", "dossier_id", "customs_regime", "customs_regime_other", "service_direction",
    "declared_value", "declared_currency", "declared_fx_to_xaf", "insurance_type",
    "surveyor_party", "departure_date", "instructions", "submitted_docs",
  ];
  for (const k of keys) if (b[k] !== undefined) out[k] = b[k];
  return out;
};

module.exports = {
  list: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),

  /** KPI tiles, counted in the database rather than over one loaded page. */
  summary: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.summary(c, req.query)) })),

  /** The checklist vocabulary, so the form is not a hard-coded copy of it. */
  docTypes: asyncHandler(async (_req, res) => res.json({ data: service.docTypes() })),

  /** The currency picker's vocabulary — the active master-data currencies with
   *  their live rate to XAF already resolved, so the form's rate field is a
   *  derived read-out rather than a second number an operator can mistype. */
  currencies: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.currencies(c)) })),

  /** A create body prefilled from the operations file — see the service. */
  prefill: asyncHandler(async (req, res) => {
    const dossierId = String(req.query.dossier_id || "");
    if (!dossierId) throw new AppError("VALIDATION_ERROR", "dossier_id is required", 422, { dossier_id: ["required"] });
    res.json({ data: await req.tenantDb((c) => service.prefill(c, { dossier_id: dossierId })) });
  }),

  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id, { lang: lang(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Transit order not found", 404);
    res.json({ data: row });
  }),

  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, {
      ...headArgs(b), lines: b.lines, allowDuplicate: b.allow_duplicate === true, actor: actor(req),
    }));
    res.status(201).json({ data });
  }),

  update: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.update(c, {
      id: req.params.id, patch: patchOf(b), lines: b.lines ?? null, actor: actor(req),
    }));
    res.json({ data });
  }),

  /**
   * PATCH /:id/documents — the legacy PATCH body, kept at its own path.
   *
   * The old `PATCH /:id` accepted `{ submitted_docs }` and nothing else. That
   * route now takes a full patch, so this preserves the narrow behaviour for
   * callers (and the AI action) that only tick boxes.
   */
  updateDocs: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.updateDocs(c, {
      transitOrderId: req.params.id, submittedDocs: req.body.submitted_docs, actor: actor(req),
    })) })),

  issue: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.issue(c, {
      id: req.params.id, date: req.body.date, actor: actor(req),
    })) })),

  sign: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.sign(c, {
      id: req.params.id, signatureVaultId: req.body.signature_vault_id,
      signedByName: req.body.signed_by_name, signedAt: req.body.signed_at, actor: actor(req),
    })) })),

  lodge: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.lodge(c, {
      id: req.params.id, declarationRef: req.body.declaration_ref,
      lodgedAt: req.body.lodged_at, actor: actor(req),
    })) })),

  cancel: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.cancel(c, {
      id: req.params.id, reason: req.body.reason, actor: actor(req),
    })) })),

  transition: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.transition(c, {
      id: req.params.id, to: b.to, date: b.date,
      declarationRef: b.declaration_ref, signatureVaultId: b.signature_vault_id,
      signedByName: b.signed_by_name, reason: b.reason, actor: actor(req),
    }));
    res.json({ data });
  }),
};
