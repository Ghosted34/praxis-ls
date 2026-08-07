/**
 * The party-level action handlers shared by both masters: the 360° dossier, the
 * manual block/unblock, the verification gate, and the Smart Copy conversion.
 * Built per kind and re-exported from each master's controller so the routes
 * read `controller.block` etc. (and the write-route gate can resolve them).
 */
"use strict";
const party360 = require("../party-360.service");
const lifecycle = require("../party-lifecycle.service");
const dedup = require("./dedup.service");
const { canSeeFinancials } = require("./confidential");
const { asyncHandler } = require("../../../utils/errors");

const actorOf = (req) => req.user || { user_id: null };
const opposite = (kind) => (kind === "client" ? "supplier" : "client");

function build(kind) {
  const dossier = kind === "client" ? party360.clientDossier : party360.supplierDossier;
  return {
    dossier: asyncHandler(async (req, res) => {
      const canSee = await canSeeFinancials(req);
      res.json({ data: await req.tenantDb((c) => dossier(c, { partyId: req.params.id, canSeeFinancials: canSee })) });
    }),
    block: asyncHandler(async (req, res) =>
      res.json({ data: await req.tenantDb((c) => lifecycle.block(c, { kind, partyId: req.params.id, reason: req.body.reason, actor: actorOf(req) })) })),
    unblock: asyncHandler(async (req, res) =>
      res.json({ data: await req.tenantDb((c) => lifecycle.unblock(c, { kind, partyId: req.params.id, actor: actorOf(req) })) })),
    verify: asyncHandler(async (req, res) =>
      res.json({ data: await req.tenantDb((c) => lifecycle.verify(c, { kind, partyId: req.params.id, actor: actorOf(req) })) })),
    // Converts FROM the opposite kind: /clients/convert-from-supplier/:id reads a
    // supplier id and returns a draft client (Hard Rule 2).
    convert: asyncHandler(async (req, res) =>
      res.status(201).json({ data: await req.tenantDb((c) => lifecycle.convert(c, { fromKind: opposite(kind), sourceId: req.params.id, actor: actorOf(req) })) })),
    // Non-blocking duplicate detection (§5.1). `excludeId` (the record being
    // edited) is dropped so the 360 does not flag a party as its own duplicate.
    dedupeCheck: asyncHandler(async (req, res) =>
      res.json({ data: await req.tenantDb((c) => dedup.findDuplicates(c, { kind, input: req.body, excludeId: req.body.exclude_id || null })) })),
  };
}

module.exports = { build };
