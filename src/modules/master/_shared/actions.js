/**
 * The party-level action handlers shared by both masters: the 360° dossier, the
 * manual block/unblock, the verification gate, the Smart Copy conversion, the
 * non-blocking dedup check, the governed merge (§5.2), the sensitive-field
 * maker-checker approve/reject (§8), the masked-bank reveal audit (§3.5) and the
 * copy-from-origin clone (§6). Built per kind and re-exported from each master's
 * controller so the routes read `controller.merge` etc.
 */
"use strict";
const party360 = require("../party-360.service");
const lifecycle = require("../party-lifecycle.service");
const dedup = require("./dedup.service");
const merge = require("../party_merge/party_merge.service");
const changeRequest = require("./change-request.service");
const { canSeeFinancials, maskBank } = require("./confidential");
const { audit } = require("../../../shared/events/emit");
const { asyncHandler, AppError } = require("../../../utils/errors");

const actorOf = (req) => req.user || { user_id: null };
const opposite = (kind) => (kind === "client" ? "supplier" : "client");
const MODULE_KEY = { client: "MOD-03", supplier: "MOD-04" };

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
    // Copy chosen sections from this converted party's linked origin (§6).
    cloneFromOrigin: asyncHandler(async (req, res) =>
      res.json({ data: await req.tenantDb((c) => lifecycle.cloneFromOrigin(c, { kind, targetId: req.params.id, sections: req.body.sections, actor: actorOf(req) })) })),

    // Non-blocking duplicate detection (§5.1). `excludeId` (the record being
    // edited) is dropped so the 360 does not flag a party as its own duplicate.
    dedupeCheck: asyncHandler(async (req, res) =>
      res.json({ data: await req.tenantDb((c) => dedup.findDuplicates(c, { kind, input: req.body, excludeId: req.body.exclude_id || null })) })),

    // Governed merge (§5.2). CEO/Admin (`approve`) at the route. In LIVE the
    // merge is written as a PENDING change request that a SECOND authorizer
    // approves (maker-checker); in TEST/sandbox it runs directly.
    mergePreview: asyncHandler(async (req, res) =>
      res.json({ data: await req.tenantDb((c) => merge.mergePreview(c, { kind, survivorId: req.body.survivor_id, loserId: req.body.loser_id })) })),
    merge: asyncHandler(async (req, res) => {
      const actor = actorOf(req);
      const { survivor_id: survivorId, loser_id: loserId } = req.body;
      if (changeRequest.isGoverned(req.env)) {
        const data = await req.tenantDb((c) => changeRequest.open(c, {
          kind, partyId: survivorId, changeType: "MERGE", payload: { survivor_id: survivorId, loser_id: loserId },
          reason: `Merge ${loserId} into ${survivorId}`, actor,
        }));
        return res.status(202).json({ data });
      }
      const data = await req.tenantDb((c) => merge.merge(c, { kind, survivorId, loserId, actor }));
      return res.json({ data });
    }),

    // Sensitive-field / merge maker-checker decisions (§8) — a second authorizer.
    approveChange: asyncHandler(async (req, res) =>
      res.json({ data: await req.tenantDb((c) => changeRequest.approve(c, { kind, partyId: req.params.id, changeRequestId: req.params.crid, actor: actorOf(req) })) })),
    rejectChange: asyncHandler(async (req, res) =>
      res.json({ data: await req.tenantDb((c) => changeRequest.reject(c, { kind, partyId: req.params.id, changeRequestId: req.params.crid, actor: actorOf(req) })) })),

    // Masked-bank reveal (§3.5) — finance/CEO only; the reveal is audited on the
    // immutable ledger (who / when / which account) and returns the unmasked
    // number for that ONE account, never the whole list.
    revealBank: asyncHandler(async (req, res) => {
      const canSee = await canSeeFinancials(req);
      if (!canSee) throw new AppError("FORBIDDEN", "You do not have finance visibility to reveal bank details.", 403);
      const data = await req.tenantDb(async (c) => {
        const { rows } = await c.query(
          `SELECT bank_account_id, ${kind}_id AS party_id, beneficiary_name, bank_name, account_number, iban, swift_bic
             FROM ${kind}_bank_account WHERE bank_account_id = $1`,
          [req.params.bankId],
        );
        const row = rows[0];
        if (!row || String(row.party_id) !== String(req.params.id)) throw new AppError("NOT_FOUND", "Bank account not found", 404);
        await audit(c, {
          actorUserId: actorOf(req).user_id || null, action: `${kind}.bank_revealed`, moduleKey: MODULE_KEY[kind],
          entityRef: `${kind}:${req.params.id}`, isSensitive: true,
          metadata: { bank_account_id: row.bank_account_id, bank_name: row.bank_name || null },
        });
        return { bank_account_id: row.bank_account_id, account_number: row.account_number, iban: row.iban, swift_bic: row.swift_bic, revealed: true };
      });
      res.json({ data });
    }),
  };
}

module.exports = { build, maskBank };
