/**
 * Field confidentiality (spec §7.3 / §8.2, acceptance gate 14).
 *
 * Bank account numbers are masked in every serialized response unless the caller
 * has finance visibility — masking happens in the API serializer, never in CSS,
 * so a Sales/Ops user cannot read a full account number off the wire. "Finance
 * visibility" is proxied by a read grant on Treasury (MOD-09); the CEO sees all.
 */
"use strict";
const identityCache = require("../../../shared/cache/identity-cache");

/** Does this request's user get to see unmasked financial fields (bank numbers)? */
async function canSeeFinancials(req) {
  if (!req || !req.user) return false;
  if (req.user.is_ceo === true) return true;
  if (!req.identityDb || !Array.isArray(req.user.role_ids)) return false;
  const grants = await req.identityDb((c) => identityCache.getGrants(c, { role_ids: req.user.role_ids, module: "MOD-09" }));
  return grants.some((g) => g.can_read === true);
}

/** Mask all but the last 4 characters of a sensitive identifier. */
function maskAccount(v) {
  if (v === null || v === undefined || v === "") return v;
  const s = String(v);
  return s.length <= 4 ? "••••" : `••••${s.slice(-4)}`;
}

/** A bank row with account_number / iban / swift_bic masked unless allowed. */
function maskBank(row, canSee) {
  if (canSee || !row) return row;
  return {
    ...row,
    account_number: maskAccount(row.account_number),
    iban: maskAccount(row.iban),
    swift_bic: maskAccount(row.swift_bic),
    masked: true,
  };
}

module.exports = { canSeeFinancials, maskAccount, maskBank };
