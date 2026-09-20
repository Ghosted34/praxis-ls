/**
 * Letterhead & footer assembly (MOD-01).
 *
 * Turns an entity's stored facts into the blocks a document header and footer
 * print. ONE implementation, used by three callers that must agree:
 *   - the dossier's live preview, as the operator edits;
 *   - the invoice / quotation / credit-note renderers;
 *   - anything that emails a PDF.
 *
 * WHY IT IS ASSEMBLED AND NOT TYPED. The mandatory mentions on a commercial
 * document differ by jurisdiction — a French invoice must carry the legal form,
 * share capital, RCS and intra-community VAT number, a Cameroonian one the NIU
 * and RCCM — and every one of those already exists on the entity. Retyping them
 * into a template is how a letterhead ends up quoting share capital from three
 * years ago. The operator chooses WHICH blocks appear; the CONTENT is derived.
 *
 * Only the wording that cannot be derived — a strapline, late-payment terms, a
 * jurisdiction clause — is authored, and that is per language so a French
 * document never falls back to English small print.
 *
 * PURE. No I/O: the repo supplies the rows, this shapes them. That is what makes
 * the preview honest — it runs the same function the renderer will.
 */
"use strict";

/** Blank-safe join: drops nulls, empties and whitespace-only parts. */
const join = (parts, sep = " · ") =>
  parts.map((p) => (p === null || p === undefined ? "" : String(p).trim())).filter(Boolean).join(sep);

const pick = (lang, fr, en) => (lang === "fr" ? fr || en : en || fr) || null;

/** A number as a plain grouped string. Currency formatting belongs to the client. */
function formatAmount(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** One address row as a single printed line. */
function addressLine(a) {
  if (!a) return null;
  return join(
    [a.line1, a.line2, a.po_box, join([a.postal_code, a.city], " "), a.region, a.country_code],
    ", ",
  ) || null;
}

/**
 * The same address as a LETTERHEAD BLOCK — the postal lines somebody would
 * actually write on an envelope, in order.
 *
 *   1030, Avenue Douala Manga Bell, Bali     ← street: line1 + line2
 *   PO Box 5120, 00237 Douala, Cameroun      ← delivery: po box, postcode, city…
 *
 * `addressLine` above comma-joins the whole thing into ONE string, which is
 * right for a footer running along the bottom of an invoice and wrong for a
 * letterhead, where the address is the block under the company name and reads
 * as three or four short lines. Same fields, same precedence, two shapes — so a
 * template never has to re-derive either.
 *
 * ── Why a country NAME and not the ISO code ────────────────────────────────
 * `country_code` is 'CM'. A letterhead prints "Cameroun", and a document
 * crossing a border prints it in the document's own language. `countryName` is
 * injected rather than imported so this file stays pure and stays testable
 * without the country catalogue; callers pass `countries.nameFor`.
 *
 * Falls back to the legacy free-text `corporate_entity.address` column when the
 * entity has no structured row yet — split on the tenant's own line breaks,
 * because that column is all some tenants have ever filled in.
 */
function addressLines(entity, addresses = [], { countryName = null, language = "en" } = {}) {
  const active = (addresses || []).filter((a) => a && a.is_active !== false);
  const a = active.find((x) => x.type === "REGISTERED") || active.find((x) => x.is_primary) || active[0];
  if (!a) {
    return String((entity && entity.address) || "")
      .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  const country = a.country_code
    ? (typeof countryName === "function" ? countryName(a.country_code, language) : null) || a.country_code
    : null;
  return [
    join([a.line1, a.line2], ", "),
    join([a.po_box, join([a.postal_code, a.city], " "), a.region, country], ", "),
  ].filter(Boolean);
}

/**
 * The structured row the registered office is printed from: an active
 * `REGISTERED` row, then an active primary one, then any active row.
 *
 * EXPORTED, because the public entity card now publishes the same address from
 * the same precedence (Decision Q2, audit CE-28): the stranger-facing read and
 * the letterhead resolve the registered office through THIS function, so the
 * shop window and the invoice footer cannot disagree about which row is the
 * statutory seat — the "one structured source" the decision asks for. The
 * public side also uses the row to avoid publishing it twice when an operator
 * marks the registered row public as well as a second one.
 */
function registeredAddressRow(addresses = []) {
  const active = (addresses || []).filter((a) => a && a.is_active !== false);
  return active.find((a) => a.type === "REGISTERED") || active.find((a) => a.is_primary) || active[0] || null;
}

/**
 * The registered office as one line, preferring a REGISTERED row, then the
 * primary one, then the legacy free-text column that predates entity_address.
 */
function registeredAddress(entity, addresses = []) {
  const reg = registeredAddressRow(addresses);
  return addressLine(reg) || (entity && entity.address ? String(entity.address).trim() : null);
}

/**
 * The establishment a document is issued FROM.
 *
 * Not the same fact as the registered office: a branch invoices under the
 * company's legal identity but from its own site, and several jurisdictions want
 * that site's own reference on the document (France's établissement SIRET, a
 * customs office code on a transit document). Head office wins, then whatever
 * else is open — a closed site must never appear on a document being issued now.
 */
function issuingEstablishment(establishments = []) {
  const open = establishments.filter((s) => s.is_active !== false && !s.closed_on);
  return open.find((s) => s.kind === "HEAD_OFFICE") || open[0] || null;
}

/** One establishment as its printed line, or null when there is nothing to print. */
function establishmentLine(s) {
  if (!s) return null;
  return join([s.name, join([s.address_line, s.city], ", "), s.tax_office_ref, s.customs_office]) || null;
}

/**
 * Tax and trade identifiers, registration rows winning over the legacy niu/rccm
 * columns. 0512 backfilled those columns into rows, so a divergence means
 * somebody edited the row — which is the newer intent.
 *
 * TRADE-REGISTER ROWS ONLY (PR-10 / A3): NIU, RCCM, EORI, SIREN… A VAT number
 * used to be loop-added from the tax registrations here, which put a
 * tax-registration fact on the trade-register line — and, worse, made the
 * letterhead print a number the TAX module owns from a join the letterhead
 * does not control. The tax registration carries it; a document that must
 * print it composes it on the tax module's authority, not this one.
 */
function identifiers(entity, registrations = []) {
  const out = [];
  const seen = new Set();
  const add = (kind, number) => {
    const k = String(kind || "").toUpperCase();
    if (!k || !number || seen.has(k)) return;
    seen.add(k);
    out.push({ kind: k, number: String(number).trim() });
  };

  for (const r of registrations) if (r.number) add(r.kind, r.number);
  add("NIU", entity.niu);
  add("RCCM", entity.rccm);
  return out;
}

/**
 * THE PRIMARY-ACCOUNT RESOLVER (PR-10 / A1) — the one rule both the Banking &
 * treasury tab and the letterhead payment block ask.
 *
 *   1. `entity.remittance_account_id`, when it resolves to an ACTIVE account —
 *      the operator's explicit choice, edited from the letterhead panel;
 *   2. else the account flagged `is_primary`, but only when EXACTLY ONE
 *      exists for the entity;
 *   3. else nothing — `unset` when no account is flagged, `ambiguous` when
 *      several are.
 *
 * WHY AMBIGUITY IS A STATE AND NOT A PICK. The Treasury module's primary
 * clearing used to scope to (entity_id, category_id), so six accounts across
 * six categories could each be "primary" at once. Picking any one of them
 * would print an account the operator never chose; printing all six is the
 * six-payment-blocks defect this resolver exists to end. So ambiguity renders
 * NOTHING and surfaces as an explicit "no primary" state the tab can explain.
 *
 * WHY THE is_primary LEG IS NOT FILTERED ON is_active. 0516's migration creates
 * the bank_block-carrying row `is_active = false, is_primary = true` — frozen
 * for review until a treasurer activates it. Its details are the bank_block's
 * own bytes, so printing it keeps those tenants' invoices unchanged; the
 * remittance leg above stays strictly active because a pointer at a CLOSED
 * account is a defect, not a fallback.
 *
 * PURE, like everything here: the tab, the letterhead endpoint, the preview
 * and the invoice renderer all call this one function, so they cannot disagree
 * about which account leads.
 *
 * @returns {{state: "account", account: object} | {state: "unset" | "ambiguous", account: null}}
 */
function resolvePrimaryAccount(entity, treasuryAccounts = []) {
  const accounts = treasuryAccounts || [];
  const e = entity || {};

  if (e.remittance_account_id) {
    const chosen = accounts.find(
      (t) => String(t.treasury_account_id) === String(e.remittance_account_id),
    );
    if (chosen && chosen.is_active !== false) {
      return { state: "account", account: chosen };
    }
    // A dangling or closed pointer falls through to the flag below rather than
    // blanking the payment block: the letterhead panel still shows the stale
    // pointer, and the operator can fix it with one save.
  }

  const primaries = accounts.filter((t) => t.is_primary === true);
  if (primaries.length === 1) return { state: "account", account: primaries[0] };
  if (primaries.length > 1) return { state: "ambiguous", account: null };
  return { state: "unset", account: null };
}

/**
 * The payment block.
 *
 * Reads treasury_account — the source of truth since 0516 — and prints THE
 * PRIMARY ACCOUNT ONLY (PR-10 / A0+A1), resolved by `resolvePrimaryAccount`
 * above. Never every flagged account: a tenant with six accounts gets one
 * payment block, and an entity whose primaries are ambiguous gets an explicit
 * `no_primary` empty state so the designer says what is missing instead of
 * printing a page of banks.
 *
 * The frozen `bank_block` jsonb remains the fallback for an entity with NO
 * treasury accounts at all — the compatibility contract that kept existing
 * tenants' invoices rendering unchanged the day 0516 shipped. Once Treasury
 * owns a row for the entity, the resolver is the only path: printing a legacy
 * block beside live Treasury accounts is exactly the drift this module stops.
 */
function paymentBlock(entity, treasuryAccounts = []) {
  const e = entity || {};
  const primary = resolvePrimaryAccount(e, treasuryAccounts);

  if (primary.state === "account") {
    const t = primary.account;
    return {
      source: "treasury",
      primary_state: "account",
      accounts: [{
        treasury_account_id: t.treasury_account_id,
        label: t.label,
        bank_name: t.bank_name || null,
        branch: t.branch || null,
        account_number: t.account_number || null,
        iban: t.iban || null,
        swift_bic: t.swift_bic || null,
        currency: t.currency || null,
        // PR-10 / A2: holder_name is what Treasury writes (0520);
        // beneficiary_name (0516) is the legacy spelling some rows still
        // carry; the legal name is the last resort, as it always was.
        holder_name: t.holder_name || t.beneficiary_name || e.legal_name || null,
      }],
    };
  }

  if (primary.state === "ambiguous" || (treasuryAccounts || []).length > 0) {
    // `no_primary` and not `none`: the designer can tell the operator WHICH
    // problem to fix (pick a primary in Treasury) rather than just "blank".
    return { source: "no_primary", primary_state: primary.state, accounts: [] };
  }

  const b = e.bank_block && typeof e.bank_block === "object" ? e.bank_block : {};
  const legacy = {
    bank_name: b.bank_name || null,
    branch: b.branch || null,
    account_number: b.account_number || null,
    iban: b.iban || null,
    swift_bic: b.swift || b.swift_bic || null,
    currency: e.default_currency || null,
    holder_name: e.legal_name || null,
    beneficiary_name: e.legal_name,
    label: b.bank_name || "Bank account",
  };
  const hasAny = [legacy.bank_name, legacy.account_number, legacy.iban].some((v) => v && String(v).trim());
  return hasAny
    // `legacy` marks the fallback so the dossier can prompt the operator to move
    // it into Treasury rather than leaving it invisible forever.
    ? { source: "bank_block_legacy", primary_state: "unset", accounts: [legacy] }
    : { source: "none", primary_state: "unset", accounts: [] };
}

const DEFAULT_CONFIG = {
  show_legal_form: true, show_share_capital: true, show_registered_address: true,
  show_postal_address: true, show_po_box: true,
  show_registrations: true, show_contact: true, show_bank_block: true, show_establishment: false,
  logo_position: "LEFT", paper_size: "A4",
};

/** PO Box from the registered address, if any. */
function poBox(entity, addresses = []) {
  const active = (addresses || []).filter((a) => a && a.is_active !== false);
  const reg = active.find((a) => a.type === "REGISTERED") || active.find((a) => a.is_primary) || active[0];
  if (!reg) return null;
  const pb = String(reg.po_box || "").trim();
  return pb || null;
}

/**
 * Build the rendered letterhead for one entity in one language.
 *
 * @param {object}   input.entity            corporate_entity row
 * @param {object}   [input.config]          entity_letterhead row (defaults applied)
 * @param {object[]} [input.addresses]       entity_address rows
 * @param {object[]} [input.registrations]   entity_registration rows
 * @param {object[]} [input.treasuryAccounts] treasury_account rows
 * @param {object[]} [input.establishments]  entity_establishment rows
 * @param {string}   [lang]                  'fr' | 'en'; defaults to the entity's
 */
function render({ entity, config, addresses = [], registrations = [], treasuryAccounts = [], establishments = [] }, lang) {
  const e = entity || {};
  const c = { ...DEFAULT_CONFIG, ...(config || {}) };
  const language = lang || e.default_language || "en";

  const ids = identifiers(e, registrations);
  const address = registeredAddress(e, addresses);
  const capital = formatAmount(e.share_capital);
  const payment = paymentBlock(e, treasuryAccounts);
  const establishment = c.show_establishment ? establishmentLine(issuingEstablishment(establishments)) : null;

  // The company line as it appears under the logo: "Smart Logistics SARL au
  // capital de 100 000 000 XAF". Assembled rather than typed.
  const companyLine = join(
    [
      e.legal_name,
      c.show_legal_form ? e.legal_form : null,
      c.show_share_capital && capital
        ? (language === "fr" ? `au capital de ${capital} ${e.share_capital_currency || ""}`.trim()
                             : `share capital ${capital} ${e.share_capital_currency || ""}`.trim())
        : null,
    ],
    " ",
  );

  const contactLine = c.show_contact
    ? join([e.phone, e.email, e.website])
    : null;

  const identifierLine = c.show_registrations
    ? join(ids.map((i) => `${i.kind} ${i.number}`))
    : null;

  return {
    language,
    paper_size: c.paper_size,
    logo_position: c.logo_position,
    brand_color: c.brand_color || null,
    accent_color: c.accent_color || null,
    header: {
      logo: e.logo_light_ref || null,
      logo_dark: e.logo_dark_ref || null,
      company_line: companyLine || null,
      trading_name: e.trading_name || null,
      address_line: c.show_registered_address ? address : null,
      contact_line: contactLine || null,
      note: pick(language, c.header_note_fr, c.header_note_en),
    },
    footer: {
      company_line: companyLine || null,
      address_line: c.show_registered_address ? address : null,
      identifier_line: identifierLine || null,
      contact_line: contactLine || null,
      // The issuing site sits in the FOOTER, beside the identifiers it belongs
      // with — a branch's own reference is a statutory mention, not branding.
      establishment_line: establishment,
      note: pick(language, c.footer_note_fr, c.footer_note_en),
      legal_mentions: pick(language, c.legal_mentions_fr, c.legal_mentions_en),
    },
    payment_block: c.show_bank_block ? payment : { source: "hidden", accounts: [] },
    identifiers: ids,
    // What is configured but has nothing behind it — the designer shows these as
    // "switched on, but blank", which is the failure a preview alone would hide.
    empty_blocks: [
      c.show_registered_address && !address ? "registered_address" : null,
      c.show_registrations && !ids.length ? "registrations" : null,
      c.show_share_capital && !capital ? "share_capital" : null,
      c.show_contact && !contactLine ? "contact" : null,
      // `no_primary` is reported too (PR-10 / A1): "switched on, but no primary
      // account was selected" is a different fix from "nothing behind it".
      c.show_bank_block && (payment.source === "none" || payment.source === "no_primary") ? "payment_block" : null,
      c.show_legal_form && !e.legal_form ? "legal_form" : null,
      c.show_establishment && !establishment ? "establishment" : null,
    ].filter(Boolean),
  };
}

module.exports = {
  render, registeredAddress, registeredAddressRow, identifiers, paymentBlock,
  resolvePrimaryAccount, addressLine, addressLines, formatAmount, poBox,
  issuingEstablishment, establishmentLine, DEFAULT_CONFIG,
};
