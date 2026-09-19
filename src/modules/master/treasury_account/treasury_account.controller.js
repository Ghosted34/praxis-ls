"use strict";
const service = require("./treasury_account.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

// Explicit field lists. The zod validator already strips unknown keys, but
// enumerating what we hand to the service is worth its lines for two reasons:
// (1) mass-assignment guarantees against a body field that would shadow
//     `actor`/`entityId` on the service side — earlier drafts splatted `...b`,
//     which CodeQL flagged as prototype-polluting assignment and which would
//     have let a request override the resolved actor via spread order,
// (2) the service parameter surface is one place, not "the union of every
//     field validator plus whatever we happen to forward" — a new column on
//     the schema won't quietly become writable from the API.
const CREATE_FIELDS = [
  "label", "currency",
  "bank_name", "branch", "account_number", "iban", "swift_bic", "routing_code", "holder_name",
  "opening_balance", "opening_date", "statement_day",
  "custodian_user_id", "location", "float_limit",
  "momo_number", "momo_till", "momo_agent", "momo_network", "momo_fee_account",
];
const UPDATE_FIELDS = [
  ...CREATE_FIELDS,
  "opening_balance_reason",
];

/** Copy an explicit allow-list of keys from src → out. Skips undefined so a
 *  patch keeps its "unchanged" semantics rather than clearing columns. */
function pick(src, keys) {
  const out = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

module.exports = {
  list: asyncHandler(async (req, res) => {
    const rows = await req.tenantDb((c) => service.list(c, req.query));
    if (rows && rows.total !== undefined) {
      res.set("X-Total-Count", String(rows.total));
      return res.json({
        data: rows,
        pagination: {
          total: rows.total,
          limit: rows.limit,
          offset: rows.offset,
          page: Math.floor(rows.offset / rows.limit) + 1,
          total_pages: Math.ceil(rows.total / rows.limit) || 1,
        },
      });
    }
    return res.json({ data: rows });
  }),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
    res.json({ data: r });
  }),

  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, {
      entityId: b.entity_id,
      categoryId: b.category_id,
      actor: actor(req),
      ...pick(b, CREATE_FIELDS),
    }));
    res.status(201).json({ data });
  }),

  update: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.update(c, {
      id: req.params.id,
      patch: pick(req.body, UPDATE_FIELDS),
      actor: actor(req),
    })) });
  }),

  setActive: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.setActive(c, {
      id: req.params.id,
      active: req.body.active === true,
      forceClearPrimary: req.body.force_clear_primary === true,
      replacementAccountId: req.body.replacement_account_id || null,
      actor: actor(req),
    })) });
  }),

  setPrimary: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.setPrimary(c, {
      id: req.params.id, actor: actor(req),
    })) });
  }),

  verify: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.verify(c, {
      id: req.params.id, actor: actor(req),
    })) });
  }),

  unverify: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.unverify(c, {
      id: req.params.id, actor: actor(req),
    })) });
  }),

  reverseEntry: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.reverseEntry(c, {
      accountId: req.params.id,
      entryId: req.body.entry_id,
      reason: req.body.reason,
      actor: actor(req),
    })) });
  }),

  // Documents (PR-03, Audit #1, #2)
  listDocuments: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.listDocuments(c, req.params.id)) });
  }),
  createDocument: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.addDocument(c, {
      accountId: req.params.id,
      actor: actor(req),
      ...req.body,
    }));
    res.status(201).json({ data });
  }),
  removeDocument: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.removeDocument(c, {
      accountId: req.params.id,
      documentId: req.params.docId,
      actor: actor(req),
    })) });
  }),
  verifyDocument: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.verifyDocument(c, {
      accountId: req.params.id,
      documentId: req.params.docId,
      actor: actor(req),
    })) });
  }),

  // Signatories (PR-03, Audit #3)
  listSignatories: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.listSignatories(c, req.params.id)) });
  }),
  createSignatory: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.addSignatory(c, {
      accountId: req.params.id,
      actor: actor(req),
      ...req.body,
    }));
    res.status(201).json({ data });
  }),
  updateSignatory: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.updateSignatory(c, {
      accountId: req.params.id,
      signatoryId: req.params.sigId,
      patch: req.body,
      actor: actor(req),
    })) });
  }),
  removeSignatory: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.removeSignatory(c, {
      accountId: req.params.id,
      signatoryId: req.params.sigId,
      actor: actor(req),
    })) });
  }),

  // 360 aggregation — one call feeds the whole dossier page.
  dossier: asyncHandler(async (req, res) => {
    const treasury360 = require("../treasury-360.service");
    const data = await req.tenantDb((c) => treasury360.load(c, {
      id: req.params.id, actor: actor(req),
    }));
    if (!data) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
    res.json({ data });
  }),

  // Payment gateways (2.3)
  listGateways: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listGateways(c)) })),
  getGateway:   asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getGateway(c, req.params.provider)) })),
  upsertGateway: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({ data: await req.tenantDb((c) => service.upsertGateway(c, {
      provider: b.provider, active: b.active, role: b.role, credentials: b.credentials, actor: actor(req),
    })) });
  }),
  setGatewayActive: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setGatewayActive(c, { provider: req.params.provider, active: req.body.active === true, actor: actor(req) })) })),
  setGatewayRole:   asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setGatewayRole(c, { provider: req.params.provider, role: req.body.role, actor: actor(req) })) })),
  deleteGateway:    asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.deleteGateway(c, { provider: req.params.provider, actor: actor(req) })) })),
};
