/**
 * Signature block model — PURE.
 *
 * Modelled on entity-letterhead.service.js: the operator chooses which blocks
 * appear, the CONTENT is derived. A missing P.O. Box must not leave a dangling
 * separator, which is why every join goes through `join()` rather than
 * interpolating fields into a template string.
 *
 * Desk and mobile phone are typed by the user because `employee` has no phone
 * columns today (Q14). That is a real master-data gap: HR cannot record a
 * staff phone number anywhere. If it is ever fixed, prefer `employee.phone_*`
 * and fall back to the profile — one change, nothing else.
 */
"use strict";

const crypto = require("crypto");

const join = (parts, sep = " · ") =>
  parts.map((p) => (p === null || p === undefined ? "" : String(p).trim())).filter(Boolean).join(sep);

const pick = (lang, fr, en) => (lang === "fr" ? fr || en : en || fr) || "";

const CLASSIC_LAYOUT = {
  kind: "classic",
  width_px: 650,
  height_px: 325,
  brand_color: "#0f4c81",
  accent_color: "#c9a227",
  show_logo: true,
  show_motto_bar: true,
  show_legal: false,
};

function hex(c) {
  const s = String(c || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return null;
}

function httpsUrl(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^https:\/\//i.test(s)) return s;
  return null;
}

/**
 * @param {object} input
 * @param {object} [input.employee]   { full_name, job_title, department }
 * @param {object} [input.user]       { full_name }
 * @param {object} [input.entity]     corporate_entity row + address_line, po_box, phone, website, logo_url
 * @param {object} [input.profile]    user_signature_profile row
 * @param {object} [input.template]   signature_template row
 * @param {object} [input.mailbox]    { email_address }
 * @param {object} [input.identity]   { purpose, from_address } — SYSTEM renders
 * @param {'en'|'fr'} lang
 */
function resolve(input = {}, lang = "en") {
  const language = lang === "fr" ? "fr" : "en";
  const template = input.template || {};
  const layout = { ...CLASSIC_LAYOUT, ...(template.layout || {}) };
  const copy = language === "fr" ? (template.copy_fr || {}) : (template.copy_en || {});
  const employee = input.employee || {};
  const user = input.user || {};
  const profile = input.profile || {};
  const entity = input.entity || {};
  const mailbox = input.mailbox || {};
  const identity = input.identity || {};
  const system = Boolean(input.system);

  const fullName = system
    ? null
    : (employee.full_name || user.full_name || null);
  const jobTitle = system ? null : (employee.job_title || null);
  const department = system
    ? departmentLabel(identity.purpose, language)
    : (employee.department || null);

  const email = mailbox.email_address || identity.from_address || null;

  // Typed fields. A SYSTEM render never carries a person's mobile.
  const phoneDesk = system ? null : (profile.phone_desk || null);
  const phoneMobile = system ? null : (profile.phone_mobile || null);
  const whatsapp = system ? null : (profile.whatsapp || null);
  const pronouns = system ? null : (profile.pronouns || null);
  const credentials = system ? null : (profile.credentials || null);
  const bookingUrl = system ? null : httpsUrl(profile.booking_url);

  const companyName = entity.legal_name || entity.trading_name || null;
  const addressLine = join(
    [entity.address_line, entity.po_box, join([entity.postal_code, entity.city], " "), entity.country],
    ", ",
  ) || null;
  const companyPhone = entity.phone || null;
  const website = entity.website || null;
  const logoUrl = httpsUrl(entity.logo_url || entity.logo_light_ref);

  const legalLine = layout.show_legal
    ? join([
      entity.legal_form,
      entity.share_capital
        ? (language === "fr"
          ? `au capital de ${entity.share_capital} ${entity.share_capital_currency || ""}`.trim()
          : `share capital ${entity.share_capital} ${entity.share_capital_currency || ""}`.trim())
        : null,
      entity.rccm ? `RCCM ${entity.rccm}` : null,
      entity.niu ? `NIU ${entity.niu}` : null,
    ]) || null
    : null;

  const motto = pick(language, copy.motto, copy.motto) || "";
  const confidentiality = copy.confidentiality || "";

  const contactLine = join([
    phoneDesk && (language === "fr" ? `Tél. ${phoneDesk}` : `T ${phoneDesk}`),
    phoneMobile && (language === "fr" ? `Port. ${phoneMobile}` : `M ${phoneMobile}`),
    email,
  ]);

  const personLine = join([fullName, pronouns && `(${pronouns})`, credentials]);

  return {
    language,
    system,
    kind: layout.kind || "classic",
    width_px: Number(layout.width_px) || 650,
    height_px: Number(layout.height_px) || 325,
    brand_color: hex(layout.brand_color) || CLASSIC_LAYOUT.brand_color,
    accent_color: hex(layout.accent_color) || CLASSIC_LAYOUT.accent_color,
    show_logo: layout.show_logo !== false && Boolean(logoUrl),
    show_motto_bar: layout.show_motto_bar !== false && Boolean(motto),
    show_legal: Boolean(layout.show_legal) && Boolean(legalLine),
    person: {
      full_name: fullName,
      job_title: jobTitle,
      department,
      pronouns,
      credentials,
      person_line: personLine || null,
    },
    contact: {
      email,
      phone_desk: phoneDesk,
      phone_mobile: phoneMobile,
      whatsapp,
      booking_url: bookingUrl,
      contact_line: contactLine || null,
    },
    company: {
      legal_name: companyName,
      address_line: addressLine,
      phone: companyPhone,
      website,
      logo_url: logoUrl,
      legal_line: legalLine,
      motto: motto || null,
      confidentiality: confidentiality || null,
    },
    empty: [
      !fullName && !system ? "full_name" : null,
      !jobTitle && !system ? "job_title" : null,
      !email ? "email" : null,
      !companyName ? "company" : null,
    ].filter(Boolean),
  };
}

function departmentLabel(purpose, lang) {
  const map = {
    OPERATIONS: { en: "Operations", fr: "Exploitation" },
    BILLING: { en: "Billing", fr: "Facturation" },
    SUPPORT: { en: "Customer Support", fr: "Service client" },
    HR: { en: "Human Resources", fr: "Ressources humaines" },
    DOCUMENTS: { en: "Documents", fr: "Documents" },
    NOTIFICATIONS: { en: null, fr: null },
  };
  const row = map[String(purpose || "").toUpperCase()];
  if (!row) return null;
  return lang === "fr" ? row.fr : row.en;
}

/**
 * Hash of every input the render depends on. A mismatch means the cache is
 * stale. Includes versions/updated_at rather than the rendered text, so a
 * promotion invalidates without anyone having to compare HTML.
 */
function sourceHash(parts) {
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify(parts === null || parts === undefined ? {} : parts));
  return h.digest("hex");
}

/** Plain text of a resolved model — what the PNG parity test compares against. */
function textContent(model) {
  if (!model) return "";
  const p = model.person || {};
  const c = model.contact || {};
  const co = model.company || {};
  return [
    p.person_line,
    p.job_title,
    p.department,
    c.contact_line,
    c.whatsapp && `WhatsApp ${c.whatsapp}`,
    c.booking_url,
    co.legal_name,
    co.address_line,
    co.phone,
    co.website,
    co.legal_line,
    co.motto,
    co.confidentiality,
  ].map((x) => (x === null || x === undefined ? "" : String(x).trim())).filter(Boolean).join("\n");
}

module.exports = {
  resolve, sourceHash, textContent, join, departmentLabel, CLASSIC_LAYOUT,
};
