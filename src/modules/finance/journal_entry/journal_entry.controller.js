"use strict";
const service = require("./journal_entry.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { sendPaged } = require("../../../shared/http/paged");

const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) =>
    sendPaged(res, await req.tenantDb((c) => service.listPaged(c, req.query))),
  ),

  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Journal entry not found", 404);
    res.json({ data: row });
  }),

  post: asyncHandler(async (req, res) => {
    const b = req.body;
    const result = await req.tenantDb((c) =>
      service.post(c, {
        journalCode: b.journal_code,
        journalId: b.journal_id,
        entityId: b.entity_id,
        entryDate: b.entry_date,
        description: b.description,
        sourceDocRef: b.source_doc_ref,
        source: b.source,
        validate: b.validate !== false,
        lines: b.lines,
        actor: actor(req),
        ip: req.ip,
      }),
    );
    res.status(201).json({ data: result });
  }),

  reverse: asyncHandler(async (req, res) => {
    const result = await req.tenantDb((c) =>
      service.reverse(c, {
        entryId: req.params.id,
        reason: req.body.reason,
        entryDate: req.body.entry_date,
        actor: actor(req),
        ip: req.ip,
      }),
    );
    res.status(201).json({ data: result });
  }),
};
