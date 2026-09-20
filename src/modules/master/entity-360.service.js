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
 *
 * Tax and registration NUMBERS sit one rung lower (Decision Q3, PR-04): a
 * caller with MOD-01 `view` may see them in full — the dossier, the nested
 * child routes, the renewals labels and the letterhead source all say the same
 * thing to that caller — while a caller without the grant gets the rows with
 * the numbers deleted (`redactRegistration` & co). Documents and vault
 * references keep their stronger governance redaction; only the numbers moved
 * to the view boundary, and the serializer enforces it so a route-gate change
 * can never quietly widen it.
 */
"use strict";
const repo = require("./corporate_entity/corporate_entity.repo");
const rules = require("./corporate_entity/corporate_entity.rules");
const renewalRules = require("./corporate_entity/corporate_entity.renewals");
const letterheadService = require("./entity-letterhead.service");
const identityCache = require("../../shared/cache/identity-cache");
const { canSeeFinancials, canSeeRegistrations, maskAccount, maskBank } = require("./_shared/confidential");
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
 * The MOD-01 view/edit/approve capabilities of the caller, resolved against
 * the identity database (not the tenant database) and the same grant cache the
 * RBAC gate uses.
 *
 * WHY THE DOSSIER REPORTS THESE. The 360 page is one aggregation behind one
 * `view` route, but its controls are not one capability: status/child/
 * letterhead/calendar writes need `edit`, document & registration verification
 * needs `approve`, and the Public Story needs MOD-01 `edit` OR MOD-29 `edit`
 * (Decision Q10). The server is authoritative either way — every route gates
 * itself — but the PR-01 defect is the UI offering controls that 403, so the
 * dossier tells the client which controls are honest to show. `can_see_governance`
 * remains a separate question (who may read the cap table) and is unchanged.
 *
 * The shape is additive: `capabilities` is a new field; absence of an entry
 * must be read by the client as "the caller cannot do this".
 */
async function capabilitiesFor(req) {
  const none = { view: false, edit: false, approve: false, public_story: false };
  if (!req || !req.user) return none;
  if (req.user.is_ceo === true) return { view: true, edit: true, approve: true, public_story: true };
  if (!req.identityDb || !Array.isArray(req.user.role_ids)) return none;

  const grants = await req.identityDb(async (c) => ({
    entity: await identityCache.getGrants(c, { role_ids: req.user.role_ids, module: "MOD-01" }),
    site: await identityCache.getGrants(c, { role_ids: req.user.role_ids, module: "MOD-29" }),
  }));

  const entity = grants.entity;
  const site = grants.site;
  return {
    view: entity.some((g) => g.can_read === true),
    edit: entity.some((g) => g.can_update === true),
    approve: entity.some((g) => g.can_approve === true),
    // MOD-01 edit owns the Story (Q10); MOD-29 edit keeps writing it as today.
    public_story: entity.some((g) => g.can_update === true) || site.some((g) => g.can_update === true),
  };
}

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

/*
 * PR-10 / A0 removed `maskPaymentBlock` — the rendered-payment-block mask that
 * used to sit between the letterhead renderers and the response. Its only two
 * call sites were the two surfaces the owner deliberately UNmasked (the
 * Entity-360 Banking & treasury tab and the letterhead endpoint, both MOD-01
 * `view` routes); nothing else serialized a rendered payment block, so the
 * function was dead the moment the relaxation landed. `maskBank` — the ROW
 * mask — remains: the Treasury module's own dossier, the party bank rows and
 * the nested banks route keep gate 14, and `maskEntityBank` still masks the
 * entity master's legacy `bank_block` jsonb. The relaxation is pinned by
 * tests/unit/entity-primary-account.test.js.
 */

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
 * What a document row must not carry to a caller without the governance grant.
 *
 * THE HOLE THIS CLOSES. `GET /entities/:id/documents` is gated at MOD-01 `edit`,
 * and the comment on that gate (nested.js) says why: documents carry "the
 * statutes and tax certificates", so the collection needs "the same UPDATE grant
 * that entity-360's redaction tests, or the collection endpoint becomes a way to
 * read around the dossier's redaction entirely". That was half true. `people`
 * IS redacted here; `documents` never was — the dossier returned every row in
 * full at MOD-01 `view`, so the harder gate on the collection protected nothing
 * and the sentence explaining it described a check that did not exist.
 *
 * WHAT STAYS. That a document exists, what type it is, when it expires and
 * whether it has been scanned and verified: a person who can see the entity
 * should be able to see that its tax clearance lapses in March, which is the
 * whole point of the renewals list. What goes is the document's IDENTITY and
 * the route to its contents — the number itself, where the paper is filed, the
 * vault reference, and the hash that would confirm a copy is the same file.
 */
const DOCUMENT_CONFIDENTIAL_FIELDS = [
  "document_number",
  "issuing_authority",
  "physical_ref",
  "notes",
  "rejection_reason",
  "vault_id",
  "storage_path",
  "vault_hash",
  "content_hash",
];

/** A document row reduced to what a non-governance caller may see. */
function redactDocument(d) {
  const out = { ...d };
  for (const f of DOCUMENT_CONFIDENTIAL_FIELDS) delete out[f];
  out.redacted = true;
  return out;
}

/*
 * ── Tax/registration numbers (Decision Q3, PR-04) ──────────────────────────
 *
 * The audit's selected policy separates THREE audiences, and the middle one is
 * what these helpers implement: a caller with MOD-01 `view` may see full tax
 * and registration numbers — they are what a compliance officer works with and
 * what the renewals list has to name — while a caller WITHOUT that grant (and
 * every public route) must not obtain them. Documents, vault references and
 * the cap table stay behind the harder governance grant exactly as before;
 * only the NUMBERS move to the view boundary.
 *
 * Like redactDocument, these DELETE rather than mask: "••••9012" is four
 * characters of a statutory identifier handed to a caller the policy says
 * must not have any of it, and a deleted field cannot be half-leaked by a
 * future refactor that stops calling the marker-aware formatter. The row keeps
 * its kind, country, dates and cadence so the surface it renders on can still
 * say "a VAT registration in France lapses in March" — which is compliance
 * information, not an identifier.
 */

/** A statutory registration row reduced to what a no-MOD-01-view caller may see. */
function redactRegistration(r) {
  const out = { ...r };
  delete out.number;
  out.redacted = true;
  return out;
}

/** A tax registration row reduced to what a no-MOD-01-view caller may see. */
function redactTaxRegistration(t) {
  const out = { ...t };
  delete out.tax_number;
  out.redacted = true;
  return out;
}

/**
 * A tax-calendar obligation row with the joined registration number removed.
 *
 * `repo.taxObligations` joins `tr.tax_number` onto the obligation so a person
 * chasing a filing can see WHICH number files it — useful at MOD-01 view,
 * and exactly the field that must not ride along for anyone else.
 */
function redactTaxObligation(o) {
  const out = { ...o };
  delete out.tax_number;
  out.redacted = true;
  return out;
}

/**
 * The entity row with its legacy statutory identifier columns removed.
 *
 * `corporate_entity` is read with `SELECT *`, so `niu` and `rccm` — the
 * pre-0515 spelling of the registration numbers, still authoritative whenever
 * no `entity_registration` row exists — ride along on every response. The
 * registration ROWS are redacted by the helpers above; without this the same
 * numbers would come back through the columns.
 */
function maskEntityRegistrations(entity, canSee) {
  if (canSee || !entity) return entity;
  return { ...entity, niu: null, rccm: null, registrations_redacted: true };
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
    ? [registered.line1, registered.line2, registered.po_box ? `PO Box ${registered.po_box}` : null, [registered.postal_code, registered.city].filter(Boolean).join(" "),
       registered.region, registered.country_code].filter((s) => s && String(s).trim()).join(", ")
    : entity.address || null;

  const poBox = registered ? (registered.po_box ? String(registered.po_box).trim() : null) : null;

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
    po_box: poBox,
    // Structured lines for letterhead block that already prints PO Box
    address_lines: registered
      ? [
          [registered.line1, registered.line2].filter(Boolean).join(", ") || null,
          [registered.po_box ? `PO Box ${registered.po_box}` : null, [registered.postal_code, registered.city].filter(Boolean).join(" "), registered.region, registered.country_code].filter(Boolean).join(", ") || null,
        ].filter(Boolean)
      : entity.address ? String(entity.address).split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [],
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
 * @param {object} opts     { governance, financials, capabilities, tax } — see
 *                          canSeeGovernance, _shared/confidential.canSeeFinancials,
 *                          capabilitiesFor, and canSeeRegistrations
 */
async function dossier(c, id, { governance = false, financials = false, capabilities = null, tax = false } = {}) {
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
  // PR-10 / A1: the Banking & treasury tab asks THE resolver — the same
  // function the letterhead's payment block runs — which account is primary.
  // Serialized beside the rows so the client never re-derives the rule (and
  // cannot drift from the invoice).
  const treasuryPrimary = letterheadService.resolvePrimaryAccount(entity, treasury);
  const { documents, tax_registrations: taxRegistrations, letterhead } = await repo.documentsAndTax(c, id);
  const obligations = await repo.taxObligations(c, id);

  const { people, contacts, addresses, registrations, establishments } = collections;

  // Redacted ONCE, and the renewals list is computed from the redacted rows
  // rather than the raw ones. Deriving renewals from the full set and returning
  // the redacted set would put the document number back on the wire inside a
  // renewal label — the same leak by a longer route. `renewals` reads title,
  // type name, dates and lead days, all of which survive redaction; a document
  // with neither title nor type degrades to "Document", which is the honest
  // label for a row this caller is not allowed to identify.
  const visibleDocuments = governance ? documents : documents.map(redactDocument);

  // The same rule for tax/registration numbers (Decision Q3, PR-04), and the
  // same shape: every derived surface below — the letterhead source, the
  // rendered preview, the renewals labels, the expiring list — is computed
  // from THESE rows, so a redacted caller cannot get a number back through a
  // label the way the document number once leaked. `tax` is the caller's
  // MOD-01 view capability: the HTTP controller resolves it from the same
  // capabilities bundle PR-01 ships, so the SERIALIZER is the authority and
  // the route gate is defence in depth rather than the only door. It defaults
  // to false so a new call site fails closed.
  const visibleRegistrations = tax ? registrations : registrations.map(redactRegistration);
  const visibleTaxRegistrations = tax ? taxRegistrations : taxRegistrations.map(redactTaxRegistration);
  const visibleObligations = tax ? obligations : obligations.map(redactTaxObligation);
  // The legacy columns are the other spelling of the same numbers — see
  // maskEntityRegistrations. Sanitised here, once, and everything downstream
  // (letterhead source, preview, readiness) receives the sanitised row.
  const visibleEntity = maskEntityRegistrations(entity, tax);

  // Reconciled against the full people list regardless of visibility — the
  // TOTALS are not sensitive, the per-holder breakdown is. A caller without
  // governance still gets to know the cap table balances.
  const cap = rules.reconcileCapTable(people, entity);

  const now = new Date().toISOString().slice(0, 10);
  const horizon = addDays(now, 90);
  // The current-row rule (doc/CORPORATE_ENTITY_REGISTRATION_CURRENT_ROW.md):
  // only the SELECTED registration per (country, kind) is monitored. An expired
  // selected row stays on the list — expiry must not promote a historical row —
  // and a key with no selectable row (ambiguous history) contributes nothing
  // here; the renewals result carries that as a data-quality finding.
  const expiringRegistrations = renewalRules.selectedRegistrations(visibleRegistrations).selected
    .map((r) => ({ r, on: isoDate(r.expires_on) }))
    .filter(({ on }) => on && on <= horizon)
    .map(({ r, on }) => ({
      registration_id: r.registration_id, kind: r.kind,
      number: r.number || null,
      expires_on: on,
      expired: on < now,
    }));

  return {
    entity: maskEntityBank(visibleEntity, financials),
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
    registrations: visibleRegistrations,
    establishments,
    // Read-only. The client renders these with a deep link to MOD-09 rather than
    // an edit form; see the module header.
    //
    // PR-10 / A0 — NOT masked here. This route is MOD-01 `view`, and the
    // owner's binding decision is that a MOD-01 viewer sees the bank details
    // their own invoices print: bank name, account number and holder are
    // visible on the Banking & treasury tab and the letterhead payment block
    // to every caller of this endpoint. The financials (MOD-09 read) grant no
    // longer widens or narrows these two surfaces — it still governs the
    // Treasury module's own dossier and the party bank rows, which keep
    // gate 14. The tab prints the PRIMARY account's identifiers only
    // (`treasury_primary`); the other rows stay listed for discovery.
    treasury_accounts: treasury,
    // The resolver's answer: { state: "account", account } | { state: "unset"
    // | "ambiguous", account: null }. "unset"/"ambiguous" is what the tab turns
    // into the explicit "No primary account selected" hint.
    treasury_primary: treasuryPrimary,
    treasury_is_read_only: true,
    cap_table: governance
      ? cap
      : { ...cap, findings: cap.findings.map((f) => ({ ...f, person_id: undefined })), redacted: true },
    usage,
    documents: visibleDocuments,
    tax_registrations: visibleTaxRegistrations,
    tax_obligations: visibleObligations,
    // The resolved inputs a document header/footer is built from, plus the
    // rendered result in the entity's own language — the designer previews the
    // same function the invoice renderer will call, so the preview cannot lie.
    // Both are fed the REDACTED rows for a caller without MOD-01 view: the
    // source block and the preview are API reads of the same numbers the
    // collections above just redacted, not a print path — the invoice renderer
    // keeps composing from the raw rows, because a commercial document MUST
    // carry its statutory mentions (CE-18).
    //
    // PR-10 / A0: the preview's PAYMENT BLOCK is NOT masked — the letterhead
    // surface is one of the two places a MOD-01 viewer deliberately sees the
    // bank details (the other is the Banking & treasury tab above), so the
    // preview shows exactly what the document prints.
    letterhead_source: letterheadSource(visibleEntity, { addresses, registrations: visibleRegistrations }),
    letterhead_config: letterhead,
    letterhead_preview: letterheadService.render(
      { entity: visibleEntity, config: letterhead, addresses, registrations: visibleRegistrations, treasuryAccounts: treasury, establishments },
      entity.default_language,
    ),
    renewals: renewalRules.renewals({ documents: visibleDocuments, registrations: visibleRegistrations, taxRegistrations: visibleTaxRegistrations }),
    readiness: rules.readiness(visibleEntity, { registrations: visibleRegistrations, addresses, people }),
    expiring_registrations: expiringRegistrations,
    can_see_governance: governance,
    // PR-01: what THIS caller may do on this dossier. The routes gate
    // themselves; this is the answer the UI reads to hide/disable controls
    // that would otherwise 403. Absent (AI reads) = no capabilities.
    capabilities: capabilities || null,
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
  dossier, canSeeGovernance, canSeeFinancials, canSeeRegistrations, capabilitiesFor, letterheadSource,
  redactPerson, redactDocument, DOCUMENT_CONFIDENTIAL_FIELDS,
  redactRegistration, redactTaxRegistration, redactTaxObligation, maskEntityRegistrations,
  maskEntityBank, isoDate,
};
