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
 * The registered office, preferring a REGISTERED row, then the primary one, then
 * the legacy free-text column that predates entity_address.
 */
function registeredAddress(entity, addresses = []) {
  const active = addresses.filter((a) => a.is_active !== false);
  const reg = active.find((a) => a.type === "REGISTERED") || active.find((a) => a.is_primary) || active[0];
  return addressLine(reg) || (entity.address ? String(entity.address).trim() : null);
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
 */
function identifiers(entity, registrations = [], taxRegistrations = []) {
  const out = [];
  const seen = new Set();
  const add = (kind, number) => {
    const k = String(kind || "").toUpperCase();
    if (!k || !number || seen.has(k)) return;
    seen.add(k);
    out.push({ kind: k, number: String(number).trim() });
  };

  for (const r of registrations) if (r.number) add(r.kind, r.number);
  // A VAT number lives on the tax registration, not the trade register.
  for (const t of taxRegistrations) {
    if (t.is_active === false || t.deregistered_on) continue;
    if (t.tax_number) add(t.tax_kind === "VAT" ? "VAT" : t.tax_kind, t.tax_number);
  }
  add("NIU", entity.niu);
  add("RCCM", entity.rccm);
  return out;
}

/**
 * The payment block.
 *
 * Reads treasury_account — the source of truth since 0516 — and falls back to the
 * frozen `bank_block` jsonb only when no account is flagged for documents. The
 * fallback is what keeps existing tenants' invoices rendering unchanged on the
 * day this ships; it is not a second source of truth, because nothing writes it.
 */
function paymentBlock(entity, treasuryAccounts = []) {
  const flagged = treasuryAccounts.filter((t) => t.show_on_documents && t.is_active !== false);
  const remittance = entity.remittance_account_id
    ? flagged.find((t) => String(t.treasury_account_id) === String(entity.remittance_account_id))
    : null;
  const ordered = remittance ? [remittance, ...flagged.filter((t) => t !== remittance)] : flagged;

  if (ordered.length) {
    return {
      source: "treasury",
      accounts: ordered.map((t) => ({
        label: t.label,
        bank_name: t.bank_name || null,
        branch: t.branch || null,
        account_number: t.account_number || null,
        iban: t.iban || null,
        swift_bic: t.swift_bic || null,
        currency: t.currency || null,
        beneficiary_name: t.beneficiary_name || entity.legal_name,
      })),
    };
  }

  const b = entity.bank_block && typeof entity.bank_block === "object" ? entity.bank_block : {};
  const legacy = {
    bank_name: b.bank_name || null,
    branch: b.branch || null,
    account_number: b.account_number || null,
    iban: b.iban || null,
    swift_bic: b.swift || b.swift_bic || null,
    currency: entity.default_currency || null,
    beneficiary_name: entity.legal_name,
    label: b.bank_name || "Bank account",
  };
  const hasAny = [legacy.bank_name, legacy.account_number, legacy.iban].some((v) => v && String(v).trim());
  return hasAny
    // `legacy` marks the fallback so the dossier can prompt the operator to move
    // it into Treasury rather than leaving it invisible forever.
    ? { source: "bank_block_legacy", accounts: [legacy] }
    : { source: "none", accounts: [] };
}

const DEFAULT_CONFIG = {
  show_legal_form: true, show_share_capital: true, show_registered_address: true,
  show_registrations: true, show_contact: true, show_bank_block: true, show_establishment: false,
  logo_position: "LEFT", paper_size: "A4",
};

/**
 * Build the rendered letterhead for one entity in one language.
 *
 * @param {object}   input.entity            corporate_entity row
 * @param {object}   [input.config]          entity_letterhead row (defaults applied)
 * @param {object[]} [input.addresses]       entity_address rows
 * @param {object[]} [input.registrations]   entity_registration rows
 * @param {object[]} [input.taxRegistrations] entity_tax_registration rows
 * @param {object[]} [input.treasuryAccounts] treasury_account rows
 * @param {object[]} [input.establishments]  entity_establishment rows
 * @param {string}   [lang]                  'fr' | 'en'; defaults to the entity's
 */
function render({ entity, config, addresses = [], registrations = [], taxRegistrations = [], treasuryAccounts = [], establishments = [] }, lang) {
  const e = entity || {};
  const c = { ...DEFAULT_CONFIG, ...(config || {}) };
  const language = lang || e.default_language || "en";

  const ids = identifiers(e, registrations, taxRegistrations);
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
      c.show_bank_block && payment.source === "none" ? "payment_block" : null,
      c.show_legal_form && !e.legal_form ? "legal_form" : null,
      c.show_establishment && !establishment ? "establishment" : null,
    ].filter(Boolean),
  };
}

module.exports = {
  render, registeredAddress, identifiers, paymentBlock, addressLine, addressLines, formatAmount,
  issuingEstablishment, establishmentLine, DEFAULT_CONFIG,
};
