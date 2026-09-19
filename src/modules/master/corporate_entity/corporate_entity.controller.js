"use strict";
const service = require("./corporate_entity.service");
const calendar = require("./corporate_entity.calendar");
const dossierService = require("../entity-360.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { sendPaged } = require("../../../shared/http/paged");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  /*
   * PR-09 (CE-03 / CE-35): the list route reports the true match count in
   * `X-Total-Count` so the client can page and search server-side. The BODY is
   * unchanged — still `{ data: [...] }` — so every existing consumer (and the
   * AI read, which goes through `service.list` and its bare-array contract)
   * keeps working. A tenant with more entities than `page()`'s 200-row maximum
   * is now fully reachable: entity 201+ is findable through `q`.
   */
  list: asyncHandler(async (req, res) =>
    sendPaged(res, await req.tenantDb((c) => service.listPaged(c, req.query)))),

  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Entity not found", 404);
    res.json({ data: r });
  }),

  /**
   * The dossier the entity page renders. Governance visibility is resolved on
   * the REQUEST (not inside the tenant transaction) because it reads the
   * identity database — see entity-360.service.canSeeGovernance.
   */
  dossier: asyncHandler(async (req, res) => {
    // Both visibility questions are resolved on the REQUEST, not inside the
    // tenant transaction, because they read the identity database. Governance
    // gates the cap table; financials gates account numbers (gate 14) — an
    // entity's own bank details are finance data even though the route that
    // carries them is MOD-01. Capabilities (PR-01) are resolved the same way,
    // because the dossier must tell the UI which MOD-01 controls are honest
    // to offer rather than pointing it at predictable 403s.
    //
    // PR-04: `tax` is the caller's MOD-01 view capability, taken from the same
    // capabilities bundle so the SERIALIZER enforces the tax-number boundary
    // rather than relying on this route's `view` gate alone.
    const governance = await dossierService.canSeeGovernance(req);
    const financials = await dossierService.canSeeFinancials(req);
    const capabilities = await dossierService.capabilitiesFor(req);
    const data = await req.tenantDb((c) => dossierService.dossier(c, req.params.id, { governance, financials, capabilities, tax: capabilities.view === true }));
    res.json({ data });
  }),

  workingCalendar: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => calendar.get(c, req.params.id)) })),
  saveWorkingCalendar: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => calendar.save(c, req.params.id, { ...req.body, actor: req.user || {} })) })),
  resetWorkingCalendar: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => calendar.reset(c, req.params.id, { actor: req.user || {} })) })),
  letterhead: asyncHandler(async (req, res) => {
    // Gate 14 again: this route is MOD-01 `view`, and the payment block it
    // renders carries the account number. PR-04 adds the tax half: the
    // identifier line and the identifiers block are registration numbers,
    // gated on the caller's MOD-01 view capability (Decision Q3) — the same
    // can_read the /360 bundle reports as `capabilities.view`.
    const financials = await dossierService.canSeeFinancials(req);
    const tax = await dossierService.canSeeRegistrations(req);
    const data = await req.tenantDb((c) => service.letterhead(c, req.params.id, req.query.lang || null, { financials, tax }));
    res.json({ data });
  }),

  saveLetterhead: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.saveLetterhead(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),

  /*
   * The tenant's own letterhead lines (12760). One handler for all three verbs:
   * the service branches on `lineId` and `remove`, and every branch returns the
   * whole letterhead bundle — the editor's canvas has to reflect what was
   * STORED, and a line that changed the composed height has just changed the
   * page it sits on.
   */
  saveLetterheadLine: asyncHandler(async (req, res) =>
    res.json({
      data: await req.tenantDb((c) => service.saveLetterheadLine(c, {
        id: req.params.id,
        lineId: req.params.lineId || null,
        patch: req.body,
        remove: req.method === "DELETE",
        actor: actor(req),
      })),
    })),

  /*
   * MOD-01 `view`, like the dossier — and redacted the same way. A renewal
   * label falls back to the document's own reference, so the governance grant
   * has to be resolved here too or this route hands out what /360 withholds.
   * PR-04 adds the tax half of the same rule: registration and tax labels
   * carry the number itself, which the caller's MOD-01 view capability gates
   * (Decision Q3). `canSeeRegistrations` is that capability on its own — the
   * same can_read the /360 bundle reports as `capabilities.view` — so this
   * route pays one grant lookup, not the whole capability set.
   */
  renewals: asyncHandler(async (req, res) => {
    const governance = await dossierService.canSeeGovernance(req);
    const tax = await dossierService.canSeeRegistrations(req);
    const data = await req.tenantDb((c) => service.renewals(c, req.params.id, req.query.as_of || null, { governance, tax }));
    res.json({ data });
  }),

  capTable: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.capTable(c, req.params.id, req.query.as_of || null));
    res.json({ data });
  }),

  create: asyncHandler(async (req, res) => {
    // The body has already been validated (and pruned of unknown keys) by the
    // shared masterCreate schema, and service.create filters it through the
    // same WRITABLE allow-list PATCH uses. Passing it whole is what closed
    // DATA 2.7: the previous hand-written camelCase re-mapping listed 18 of
    // the schema's ~40 fields, and every field it forgot was silently dropped
    // on create while remaining editable on update.
    const data = await req.tenantDb((c) => service.create(c, { ...req.body, actor: actor(req) }));
    res.status(201).json({ data });
  }),

  update: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),

  setOpsReferencePrefix: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setOpsReferencePrefix(c, { id: req.params.id, prefix: req.body.ops_reference_prefix, actor: actor(req) })) })),

  setStatus: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, reason: req.body.reason || null, actor: actor(req) })) })),

  setStructure: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setStructure(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),

  setActive: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setActive(c, { id: req.params.id, active: req.body.active === true, actor: actor(req) })) })),

  uploadLogo: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.uploadLogo(c, { id: req.params.id, dataUrl: req.body.data_url, variant: req.body.variant || "light", slug: req.tenant.slug, actor: actor(req) })) })),
};
