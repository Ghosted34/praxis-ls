/**
 * The corporate-entity dossier aggregation (MOD-01). One call returns everything
 * the entity page renders: the master record, its group position, its child
 * collections, the cap-table reconciliation, a read-only view of its treasury
 * accounts, how much history hangs off it, and the readiness checklist.
 *
 * Modelled on party-360.service.js, and built to render for a BRAND-NEW entity
 * with zero data — every collection defaults to [] and every figure to 0, so the
 * page after "create entity" is a working page, not an error.
 *
 * TREASURY IS READ-ONLY HERE. `treasury_account` belongs to MOD-09; this returns
 * a list and the client deep-links to the Treasury tab to create one. Two forms
 * writing the same table is how the letterhead's bank block and the GL-mapped
 * cash account drift apart, which is the bug this module exists to stop.
 *
 * CONFIDENTIALITY. The cap table and the people collection are the most sensitive
 * things a company holds. They are returned only to a caller who can see them
 * (see `canSeeGovernance`); everyone else gets a count and a redaction marker, so
 * the tab still renders and explains itself rather than 403-ing the whole page.
 */
"use strict";
const repo = require("./corporate_entity/corporate_entity.repo");
const rules = require("./corporate_entity/corporate_entity.rules");
const identityCache = require("../../shared/cache/identity-cache");
const { canSeeFinancials, maskAccount } = require("./_shared/confidential");
const { AppError } = require("../../utils/errors");

/**
 * May this caller read governance data — the cap table, shareholders, directors
 * and personal identifiers on them?
 *
 * Proxied by an UPDATE grant on MOD-01 rather than a read grant: everyone with
 * the module can see that an entity exists and what its letterhead says, but the
 * ownership structure is not general-staff information. The CEO sees all.
 *
 * The grant column is `can_update` — identity-cache selects
 * can_create/can_read/can_update/can_delete/can_approve, and there is no
 * `can_edit`, so testing for one silently denies everybody but the CEO.
 */
async function canSeeGovernance(req) {
  if (!req || !req.user) return false;
  if (req.user.is_ceo === true) return true;
  if (!req.identityDb || !Array.isArray(req.user.role_ids)) return false;
  const grants = await req.identityDb((c) =>
    identityCache.getGrants(c, { role_ids: req.user.role_ids, module: "MOD-01" }),
  );
  return grants.some((g) => g.can_update === true);
}

/**
 * Personal identifiers a redacted view must not carry off the server.
 *
 * `is_pep` is in the list and nationality is not, which looks arbitrary until
 * you check what the registers publish: the UK's Companies House shows a
 * director's nationality and country of residence, so hiding those protects
 * nothing. Whether we have assessed someone as politically exposed is our own
 * AML judgement and appears on no register.
 */
const PERSONAL_FIELDS = ["date_of_birth", "id_type", "id_number", "email", "phone",
  "share_count", "share_nominal_value", "ownership_percent", "voting_percent",
  "signature_limit_amount", "signature_limit_currency", "is_pep", "notes"];

/**
 * The entity row with its bank block masked.
 *
 * `corporate_entity` is read with `SELECT *`, so `bank_block` — which holds an
 * account number, an IBAN and a SWIFT code — rides along on every response.
 * These endpoints are gated MOD-01 `view`, which Sales and Ops hold; the account
 * number is finance data, and `_shared/confidential.js` already establishes that
 * it is masked in the SERIALIZER unless the caller has Treasury read (gate 14).
 * The party masters mask their bank rows for exactly this reason — an entity's
 * own account deserves the same treatment, not less.
 */
function maskEntityBank(entity, canSee) {
  if (canSee || !entity || !entity.bank_block || typeof entity.bank_block !== "object") return entity;
  const b = entity.bank_block;
  return {
    ...entity,
    bank_block: {
      ...b,
      account_number: maskAccount(b.account_number),
      iban: maskAccount(b.iban),
      swift: maskAccount(b.swift),
      swift_bic: maskAccount(b.swift_bic),
      masked: true,
    },
  };
}

/** The rendered payment block with every account identifier masked. */
function maskPaymentBlock(preview, canSee) {
  if (canSee || !preview || !preview.payment_block) return preview;
  return {
    ...preview,
    payment_block: {
      ...preview.payment_block,
      accounts: (preview.payment_block.accounts || []).map((a) => ({
        ...a,
        account_number: maskAccount(a.account_number),
        iban: maskAccount(a.iban),
        swift_bic: maskAccount(a.swift_bic),
        masked: true,
      })),
    },
  };
}

/**
 * A person row reduced to what a non-governance caller may see: that the role is
 * filled, and by whom. Names stay — a director's name is on the public trade
 * register in every jurisdiction we operate in, so hiding it protects nothing
 * while making the page useless.
 */
function redactPerson(p) {
  const out = { ...p };
  for (const f of PERSONAL_FIELDS) delete out[f];
  out.redacted = true;
  return out;
}

/**
 * The letterhead source block: the fields a document header/footer is assembled
 * from, resolved once here so the client is not re-deriving "registered address
 * or the legacy free-text one" in three components.
 *
 * PR 2 turns this into the rendered header/footer with a live preview; returning
 * the resolved inputs now means the dossier's Overview can already show what a
 * document would print, and shows what is missing.
 */
function letterheadSource(entity, { addresses, registrations }) {
  const registered = addresses.find((a) => a.type === "REGISTERED" && a.is_active !== false)
    || addresses.find((a) => a.is_primary) || null;

  const composed = registered
    ? [registered.line1, registered.line2, [registered.postal_code, registered.city].filter(Boolean).join(" "),
       registered.region, registered.country_code].filter((s) => s && String(s).trim()).join(", ")
    : entity.address || null;

  // Registrations win over the legacy niu/rccm columns when present — 0515
  // backfilled those columns into rows, so a divergence means someone edited the
  // row, which is the newer intent.
  const byKind = {};
  for (const r of registrations) if (r.number) byKind[String(r.kind).toUpperCase()] = r.number;

  return {
    legal_name: entity.legal_name,
    trading_name: entity.trading_name || null,
    legal_form: entity.legal_form || null,
    share_capital: entity.share_capital ?? null,
    share_capital_currency: entity.share_capital_currency || entity.default_currency || null,
    registered_address: composed,
    country_code: entity.country_code,
    niu: byKind.NIU || entity.niu || null,
    rccm: byKind.RCCM || entity.rccm || null,
    vat_number: byKind.VAT || null,
    eori: byKind.EORI || null,
    other_registrations: registrations
      .filter((r) => r.number && !["NIU", "RCCM", "VAT", "EORI"].includes(String(r.kind).toUpperCase()))
      .map((r) => ({ kind: r.kind, number: r.number })),
    email: entity.email || null,
    phone: entity.phone || null,
    website: entity.website || null,
    logo_light_ref: entity.logo_light_ref || null,
    logo_dark_ref: entity.logo_dark_ref || null,
  };
}

/**
 * @param {object} c        tenant db client
 * @param {string} id       entity_id
 * @param {object} opts     { governance, financials } — see canSeeGovernance and
 *                          _shared/confidential.canSeeFinancials
 */
async function dossier(c, id, { governance = false, financials = false } = {}) {
  const entity = await repo.get(c, id);
  if (!entity) throw new AppError("NOT_FOUND", "Entity not found", 404);

  // Sequential, not Promise.all: every one of these runs on the SAME tenant
  // client (one per request), and a pg client cannot execute two queries at
  // once — see the same note in compliance.service.js.
  const collections = await repo.collections(c, id);
  const children = await repo.children(c, id);
  const ancestors = await repo.ancestors(c, id);
  const usage = await repo.usage(c, id);
  const treasury = await repo.treasuryAccounts(c, id);

  const { people, contacts, addresses, registrations, establishments } = collections;

  // Reconciled against the full people list regardless of visibility — the
  // TOTALS are not sensitive, the per-holder breakdown is. A caller without
  // governance still gets to know the cap table balances.
  const cap = rules.reconcileCapTable(people, entity);

  const now = new Date().toISOString().slice(0, 10);
  const horizon = addDays(now, 90);
  const expiringRegistrations = registrations
    .map((r) => ({ r, on: isoDate(r.expires_on) }))
    .filter(({ on }) => on && on <= horizon)
    .map(({ r, on }) => ({
      registration_id: r.registration_id, kind: r.kind, number: r.number,
      expires_on: on,
      expired: on < now,
    }));

  return {
    entity: maskEntityBank(entity, financials),
    structure: {
      parent_entity_id: entity.parent_entity_id || null,
      relationship_type: entity.relationship_type || null,
      ownership_percent: entity.ownership_percent ?? null,
      consolidates: entity.consolidates !== false,
      is_group_parent: entity.is_group_parent === true,
      ancestors,
      children,
    },
    people: governance ? people : people.map(redactPerson),
    contacts,
    addresses,
    registrations,
    establishments,
    // Read-only. The client renders these with a deep link to MOD-09 rather than
    // an edit form; see the module header.
    treasury_accounts: treasury,
    treasury_is_read_only: true,
    cap_table: governance
      ? cap
      : { ...cap, findings: cap.findings.map((f) => ({ ...f, person_id: undefined })), redacted: true },
    usage,
    // The resolved inputs a document header/footer is built from. PR 2 renders
    // these; the Overview already shows them so "what will an invoice print"
    // is answerable before the designer exists.
    letterhead_source: letterheadSource(entity, { addresses, registrations }),
    readiness: rules.readiness(entity, { registrations, addresses, people }),
    expiring_registrations: expiringRegistrations,
    can_see_governance: governance,
  };
}

/**
 * A `date` column as `YYYY-MM-DD`.
 *
 * node-postgres hands back a JS Date for `date`/`timestamp` columns, and
 * `String(new Date(...))` is `"Tue Sep 05 2026 …"` — slicing ten characters off
 * THAT yields `"Tue Sep 0"`, which compares lexicographically against a real ISO
 * date as greater than any string starting with a digit. An expiry filter built
 * on it silently matches nothing, which is the worst possible failure for a
 * renewals warning: no error, no rows, and a certificate quietly lapses.
 */
function isoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** `2026-08-06` + 90 days, as an ISO date. Small enough not to earn a dependency. */
function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  dossier, canSeeGovernance, canSeeFinancials, letterheadSource, redactPerson,
  maskEntityBank, maskPaymentBlock, isoDate,
};
