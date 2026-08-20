/**
 * Document template kit (doc/DOCUMENT_TEMPLATES_PLAN.md §3). Pure HTML builders —
 * no rendering, no DB. Every template composes these blocks; a resolved config
 * (`cfg`) + entity/branding drive all colour, logo, layout and copy, so beautify
 * is data, never a code edit. Bilingual FR/EN. Consumed by the registry builders
 * and rendered to PDF by services/pdf.service.js (Puppeteer) or previewed as raw
 * HTML by the documents/template module.
 */
"use strict";

const { fontFaceCss, PDF_FONT_BODY, PDF_FONT_MONO } = require("../../pdf.fonts");

const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Money in a currency (XAF default), fr-FR grouping. */
const money = (n, ccy = "XAF") => `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${ccy}`;
const xaf = (n) => money(n, "XAF");
const dateFmt = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toISOString().slice(0, 10);
};

/* ── amount in words (FR/EN) ────────────────────────────────────────────────
 * The legacy printed it on the PO ("… AND 00 CENTS") and the final invoice
 * ("ARRÊTÉE LA PRÉSENTE FACTURE À LA SOMME DE :"), and it is a convention of
 * OHADA-zone commercial documents. This is the shared implementation the PO,
 * supplier invoice and invoice family templates call — one number, two
 * languages, so a beautify language switch cannot change the amount.
 */
const WORDS_ONES = {
  en: ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"],
  fr: ["ZÉRO", "UN", "DEUX", "TROIS", "QUATRE", "CINQ", "SIX", "SEPT", "HUIT", "NEUF", "DIX", "ONZE", "DOUZE", "TREIZE", "QUATORZE", "QUINZE", "SEIZE", "DIX-SEPT", "DIX-HUIT", "DIX-NEUF"],
};
const WORDS_TENS = {
  en: ["", "TEN", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"],
  fr: ["", "DIX", "VINGT", "TRENTE", "QUARANTE", "CINQUANTE", "SOIXANTE", "SOIXANTE-DIX", "QUATRE-VINGT", "QUATRE-VINGT-DIX"],
};
const SCALE = {
  en: ["", "THOUSAND", "MILLION", "BILLION"],
  fr: ["", "MILLE", "MILLION", "MILLIARD"],
};

/** Integer part (< 1e12) in words. */
function wordsInt(n, lang) {
  if (n === 0) return WORDS_ONES[lang][0];
  const ones = WORDS_ONES[lang];
  const tens = WORDS_TENS[lang];
  const scale = SCALE[lang];
  const join = lang === "fr" ? " " : " ";
  const under100 = (x) => {
    if (x < 20) return ones[x];
    const ten = Math.floor(x / 10);
    const o = x % 10;
    if (o === 0) return tens[ten];
    if (lang === "fr") {
      if (ten === 7) return "SOIXANTE-" + ones[10 + o];
      if (ten === 9) return "QUATRE-VINGT-" + ones[10 + o];
      if (o === 1) return tens[ten] + " ET UN";
      return tens[ten] + "-" + ones[o];
    }
    return tens[ten] + "-" + ones[o];
  };
  const under1000 = (x) => {
    const h = Math.floor(x / 100);
    const rest = x % 100;
    let out = "";
    if (h > 0) out += (lang === "fr" && h === 1 ? "CENT" : ones[h] + " HUNDRED");
    if (rest > 0) out += join + under100(rest);
    return out.trim();
  };
  const groups = [];
  let v = n;
  while (v > 0) { groups.push(v % 1000); v = Math.floor(v / 1000); }
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const g = groups[i];
    if (g === 0) continue;
    const gWords = i === 0 ? under1000(g) : (lang === "fr" && g === 1 && i === 1 ? "MILLE" : under1000(g) + " " + scale[i]);
    parts.push(gWords);
  }
  return parts.join(join);
}

/**
 * Amount in words: "… AND 00/100" (en) / "… et 00/100" (fr), cents always two
 * digits so no amount can be misread between languages.
 */
function words(amount, lang = "en") {
  const n = Number(amount || 0);
  const neg = n < 0;
  const abs = Math.abs(Math.round(n * 100) / 100);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);
  const pad = String(cents).padStart(2, "0");
  const body = `${wordsInt(whole, lang)}${lang === "fr" ? " ET" : " AND"} ${pad}/100`;
  return neg ? "MOINS " + body : body;
}

/** Section block rendering the amount in words, e.g. "ARRÊTÉE … À LA SOMME DE". */
function wordsBlock(amount, ccy, cfg = {}) {
  const lang = cfg.language || "bilingual";
  const text = `${words(amount, lang === "fr" ? "fr" : "en")} ${ccy || "XAF"}`;
  return section(
    { fr: "Arrêtée la présente à la somme de :", en: "Amount in words" },
    `<div class="box"><strong>${esc(text)}</strong></div>`,
    cfg,
  );
}

/** Bilingual label: cfg.language ∈ fr | en | bilingual. */
function t(pair, lang = "bilingual") {
  const fr = pair.fr ?? pair.en ?? "";
  const en = pair.en ?? pair.fr ?? "";
  if (lang === "fr") return esc(fr);
  if (lang === "en") return esc(en);
  return fr === en ? esc(fr) : `${esc(fr)} / ${esc(en)}`;
}

/** Merge a saved config over the branding-derived defaults. */
function defaults(brand = {}) {
  return {
    accent: brand.accent || "#F5821F",
    ink: brand.ink || "#101E34",
    muted: "#6B7A90",
    line: "#E4ECF6",
    // Shipped library faces, embedded by pdf.fonts.js. Was
    // "'Noto Sans', 'Segoe UI', Arial" over "'Noto Sans Mono', ui-monospace":
    // Segoe UI is proprietary and Noto Sans Mono is not in the library, and none
    // of the four was present in the rendering container anyway.
    font: PDF_FONT_BODY,
    monoFont: PDF_FONT_MONO,
    paper: "A4",
    margin_mm: 16,
    language: "bilingual",
    logo: { url: brand.logo_url || null, show: true, height_mm: 15, align: "left" },
    show: { tax_breakdown: true, notes: true, bank: true, signature: true, terms: true, qr: true, words: true },
    footer_text: "",
    terms: "",
    signature: { name: "", title: "", image_url: "" },
    watermark: "",
  };
}
function mergeCfg(brand, saved = {}) {
  const d = defaults(brand);
  return {
    ...d, ...saved,
    logo: { ...d.logo, ...(saved.logo || {}) },
    show: { ...d.show, ...(saved.show || {}) },
    signature: { ...d.signature, ...(saved.signature || {}) },
  };
}

/** Full HTML document. `title` sets <title>; `cfg` themes it; `bodyHtml` is the doc. */
function shell(title, bodyHtml, cfg = {}) {
  const c = { ...defaults(), ...cfg };
  const css = `
    ${fontFaceCss()}
    @page { size: ${c.paper}; margin: ${c.margin_mm}mm; }
    * { box-sizing: border-box; }
    body { font-family: ${c.font}; color: ${c.ink}; font-size: 12px; line-height: 1.5; margin: 0; }
    .accent { color: ${c.accent}; }
    .muted { color: ${c.muted}; }
    .num { font-family: ${c.monoFont}; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.01em; }
    .doc { position: relative; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 14px; border-bottom: 2px solid ${c.accent}; }
    .head .lh { max-width: 60%; }
    .head .logo { max-height: ${c.logo.height_mm}mm; max-width: 200px; display: block; }
    .brandname { font-size: 15px; font-weight: 700; }
    .idlines { font-size: 10.5px; color: ${c.muted}; margin-top: 2px; }
    .meta { text-align: right; font-size: 11px; }
    .meta .n { font-size: 15px; font-weight: 700; color: ${c.accent}; }
    .meta div { margin-top: 1px; }
    .parties { display: flex; gap: 24px; margin: 18px 0; }
    .party { flex: 1; }
    .party .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: ${c.muted}; margin-bottom: 3px; }
    .party .nm { font-weight: 600; }
    table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
    table.items thead th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: ${c.muted}; padding: 8px 8px; border-bottom: 1px solid ${c.line}; background: ${c.accent}0d; }
    table.items thead th.num { text-align: right; }
    table.items tbody td { padding: 8px 8px; border-bottom: 1px solid ${c.line}; vertical-align: top; }
    .totals { margin-top: 10px; margin-left: auto; width: 300px; }
    .totals tr td { padding: 4px 8px; }
    .totals tr.grand td { border-top: 2px solid ${c.accent}; font-weight: 700; font-size: 13px; }
    .section-t { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: ${c.muted}; margin: 18px 0 4px; }
    .box { border: 1px solid ${c.line}; border-radius: 8px; padding: 10px 12px; font-size: 11px; }
    .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid ${c.line}; font-size: 9.5px; color: ${c.muted}; }
    .sig { display: flex; gap: 40px; margin-top: 30px; }
    .sig .b { flex: 1; }
    .sig .ln { border-top: 1px solid ${c.ink}; margin-top: 34px; padding-top: 3px; font-size: 10px; }
    .wm { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
    .wm span { font-size: 96px; font-weight: 800; color: ${c.accent}; opacity: 0.08; transform: rotate(-24deg); letter-spacing: 0.1em; }
    .qr { margin-top: 8px; font-size: 9px; color: ${c.muted}; }

    /* ── The electronic seal (SIGNATURE_ENGINEERING_GUIDE §3.12) ────────────
       Sized in millimetres, not pixels: this block has a hard 34mm height
       budget on a one-page document, and px would leave that at the mercy of
       the renderer's DPI assumptions.

       MONOCHROME-FIRST. Every value below is a grey except the 0.4mm accent
       rule, which is decoration. A logistics document is photocopied and faxed,
       so nothing may DEPEND on colour to be readable — the original mockup
       leaned on green to read as approved, and green photocopies to a grey
       blob. Designing in grey removes the failure mode instead of testing for
       it afterwards. */
    /* overflow:hidden is a BACKSTOP, not the layout. The sizes below are chosen
       so nothing overflows in the first place — but a signer with an unusually
       long name must never push the evidence rows outside the border, which is
       what an unclipped max-height does. Caught by rendering it, not by reading it. */
    .seal { width: 88mm; max-height: 34mm; overflow: hidden;
            border: 0.25mm solid #9aa0a6; padding: 2.5mm; box-sizing: border-box;
            display: flex; gap: 2.5mm; page-break-inside: avoid; break-inside: avoid; }
    .seal .body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .seal .for { font-size: 6pt; letter-spacing: 0.09em; text-transform: uppercase;
                 font-weight: 700; color: ${c.accent}; display: flex; justify-content: space-between; gap: 2mm; }
    .seal .pos { font-family: ${c.monoFont}; color: #4b5563; font-weight: 400; letter-spacing: 0.04em; white-space: nowrap; }
    .seal .rule { border-top: 0.4mm solid ${c.accent}; margin: 0.9mm 0 1.4mm; }
    .seal .reason { font-size: 9pt; font-weight: 600; color: #111827; line-height: 1.15; }
    .seal .who { font-size: 7.5pt; color: #1f2937; margin-top: 0.6mm; line-height: 1.2; }
    /* DRAWN: the image IS the headline, so the name stays at body size. Promoting
       it to 9pt semibold (the first attempt) made "Aïssatou Njoya · Procurement
       Manager" wrap to two lines and pushed the whole block past 34mm. */
    .seal .who-drawn { font-size: 7.5pt; font-weight: 600; color: #111827; line-height: 1.2; }
    .seal .reason-sub { font-size: 7pt; color: #374151; line-height: 1.2; margin-top: 0.3mm; }
    .seal .drawn { max-height: 8mm; max-width: 44mm; display: block; margin-bottom: 0.4mm; }
    /* Footnotes to the sentence above, and set as such.
       5.5pt, NOT 6pt: at 6pt a monospace character is ~1.27mm, so the 45-character
       date+method line needs ~58mm and the text column is 58.5mm — it wrapped, and
       orphaned the last word onto its own line. 5.5pt gives ~50 characters of room.
       #4b5563 is the lightest grey that survives a second-generation photocopy. */
    .seal .ev { margin-top: auto; padding-top: 1mm; font-family: ${c.monoFont};
                font-size: 5.5pt; color: #4b5563; line-height: 1.45; }
    .seal .vfy { width: 22mm; text-align: center; flex: none; }
    .seal .vfy svg { display: block; width: 22mm; height: 22mm; }
    .seal .vfy .code { font-family: ${c.monoFont}; font-size: 5.5pt; letter-spacing: 0.02em;
                       color: #4b5563; margin-top: 0.8mm; white-space: nowrap; }
    @media print { .wm span { opacity: 0.08; } }`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body><div class="doc">${cfg.watermark ? watermark(cfg.watermark) : ""}${bodyHtml}</div></body></html>`;
}

/** Letterhead: logo (or brand name) + the OHADA identity lines. */
function letterhead(entity = {}, cfg = {}) {
  const logo = cfg.logo && cfg.logo.show && cfg.logo.url
    ? `<img class="logo" src="${esc(cfg.logo.url)}" alt="">`
    : `<div class="brandname accent">${esc(entity.legal_name || "")}</div>`;
  const lines = [entity.legal_name, entity.address, entity.rccm ? `RCCM ${entity.rccm}` : null, entity.niu ? `NIU ${entity.niu}` : null, entity.email, entity.phone].filter(Boolean).map(esc).join(" · ");
  return `<div class="lh">${logo}<div class="idlines">${lines}</div></div>`;
}

/** Right-aligned title + meta (number, dates, refs). `meta` = [[label,value],…]. */
function titleMeta(title, number, meta = [], cfg = {}) {
  const rows = meta.filter((m) => m && m[1]).map((m) => `<div><span class="muted">${t(typeof m[0] === "string" ? { fr: m[0], en: m[0] } : m[0], cfg.language)}:</span> ${esc(m[1])}</div>`).join("");
  return `<div class="meta"><h1>${t(title, cfg.language)}</h1><div class="n">${esc(number || "")}</div>${rows}</div>`;
}

function head(entity, title, number, meta, cfg) {
  return `<div class="head">${letterhead(entity, cfg)}${titleMeta(title, number, meta, cfg)}</div>`;
}

/** Party blocks (Bill-to / Ship-to / Supplier / Employee). `parties`=[{label,name,lines[]}]. */
function parties(list = [], cfg = {}) {
  return `<div class="parties">${list.map((p) => `<div class="party"><div class="lbl">${t(typeof p.label === "string" ? { fr: p.label, en: p.label } : p.label, cfg.language)}</div><div class="nm">${esc(p.name || "—")}</div><div class="muted">${(p.lines || []).filter(Boolean).map(esc).join("<br>")}</div></div>`).join("")}</div>`;
}

/** Line-item table. `columns`=[{key,label,num?}], `rows`=[obj]. */
function lineTable(columns, rows = [], cfg = {}) {
  const th = columns.map((c) => `<th class="${c.num ? "num" : ""}">${t(typeof c.label === "string" ? { fr: c.label, en: c.label } : c.label, cfg.language)}</th>`).join("");
  const tb = rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? "num" : ""}">${c.num ? esc(r[c.key]) : esc(r[c.key])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}" class="muted">—</td></tr>`;
  return `<table class="items"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;
}

/** Totals block. `rows`=[[label,value,{grand?}]]. */
function totals(rows = [], cfg = {}) {
  return `<table class="totals">${rows.filter(Boolean).map((r) => `<tr class="${r[2] && r[2].grand ? "grand" : ""}"><td>${t(typeof r[0] === "string" ? { fr: r[0], en: r[0] } : r[0], cfg.language)}</td><td class="num">${esc(r[1])}</td></tr>`).join("")}</table>`;
}

function section(label, html, cfg = {}) {
  return `<div class="section-t">${t(typeof label === "string" ? { fr: label, en: label } : label, cfg.language)}</div>${html}`;
}

function bankBlock(entity = {}, cfg = {}) {
  const b = entity.bank_block || {};
  const parts = [b.bank && `${b.bank}`, b.account && `Compte / Acct: ${b.account}`, b.iban && `IBAN: ${b.iban}`, b.swift && `SWIFT: ${b.swift}`].filter(Boolean);
  if (!parts.length) return "";
  return section({ fr: "Coordonnées bancaires", en: "Bank details" }, `<div class="box">${parts.map(esc).join(" · ")}</div>`, cfg);
}

function termsBlock(cfg = {}) {
  if (!cfg.show || !cfg.show.terms || !cfg.terms) return "";
  return section({ fr: "Conditions", en: "Terms & conditions" }, `<div class="box">${esc(cfg.terms).replace(/\n/g, "<br>")}</div>`, cfg);
}

function signatureBlock(cfg = {}) {
  if (!cfg.show || !cfg.show.signature) return "";
  const s = cfg.signature || {};
  const who = [s.name, s.title].filter(Boolean).map(esc).join(" · ");
  return `<div class="sig"><div class="b"><div class="ln">${t({ fr: "Pour le client", en: "For the client" }, cfg.language)}</div></div><div class="b"><div class="ln">${who || t({ fr: "Pour la société", en: "For the company" }, cfg.language)}</div></div></div>`;
}

/**
 * The electronic seal — the visual mark of one signature
 * (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.12).
 *
 * It reads as a sentence, not a form: "For Smart Logistics, approved for
 * dispatch, by Jean Mbarga, Commercial Director, on 20 August 2026, verified by
 * email code." Everything below that sentence is a footnote and is typeset as
 * one. An earlier design laid the same facts out as label:value rows of equal
 * weight, which buried the only part a human actually needs.
 *
 * ── What this function deliberately CANNOT do ──────────────────────────────
 * There is no parameter for a verdict, and none for an IP address. Those are
 * not omissions to be validated against later; the function has no way to
 * render them:
 *
 *   NO VERDICT. A static PDF cannot know it is valid. Validity depends on
 *   amendment and revocation, both of which happen AFTER printing — so a
 *   revoked signature would carry a green "VALID" badge on every copy in
 *   existence, forever, contradicting the revocation model outright. The seal
 *   states what it IS; the portal behind the QR states what it EVALUATES TO.
 *
 *   NO IP. §3.13 — it is PII, and this page travels through a warehouse, a
 *   border post and a customer's filing cabinet.
 *
 * Nor is there a vendor name (the product is white-label, so the tenant's
 * client sees the tenant), and `method` must arrive already translated into
 * plain language — never "AES_OTP". A document a court reads should not need a
 * glossary.
 *
 * @param {object} sig
 * @param {string} sig.forParty     whose side this seal speaks for
 * @param {object} [sig.position]   { n, of } — omitted for a lone signature
 * @param {string} [sig.reason]     the attestation, from the controlled list
 * @param {string} sig.signerName
 * @param {string} [sig.signerRole]
 * @param {string} sig.signedAt     already formatted, with the zone named
 * @param {string} sig.method       plain language, already translated
 * @param {string} [sig.docRef]
 * @param {string} [sig.contentHash] full digest; truncated to 16 here
 * @param {string} sig.code         verify_code, unformatted
 * @param {string} sig.qrSvg        inline SVG from services/signatures/qr.js
 * @param {string} [sig.markImageB64] data URL, DRAWN only
 */
function sealBlock(sig = {}, cfg = {}) {
  const c = { ...defaults(), ...cfg };
  const lang = c.language;

  const pos = sig.position && sig.position.of > 1
    ? `<span class="pos">${esc(sig.position.n)} ${t({ fr: "sur", en: "of" }, lang)} ${esc(sig.position.of)}</span>`
    : "";

  // A drawn mark takes the attestation slot and the reason moves below the name,
  // so the block keeps one shape and one height whichever card was chosen.
  //
  // The name is NOT enlarged in the drawn variant: the image already carries the
  // hierarchy, and promoting the name to the reason's 9pt made a real-length
  // "Aïssatou Njoya · Procurement Manager" wrap and overflow the 34mm budget.
  const isDrawn = Boolean(sig.markImageB64);
  const drawn = isDrawn ? `<img class="drawn" src="${esc(sig.markImageB64)}" alt="">` : "";
  const reason = sig.reason
    ? `<div class="${isDrawn ? "reason-sub" : "reason"}">${esc(sig.reason)}</div>`
    : "";
  const who = `<div class="${isDrawn ? "who-drawn" : "who"}">${esc(sig.signerName)}${
    sig.signerRole ? ` · ${esc(sig.signerRole)}` : ""
  }</div>`;

  const hashFragment = sig.contentHash
    ? ` · ${t({ fr: "contenu", en: "content" }, lang)} ${esc(String(sig.contentHash).slice(0, 16))}`
    : "";

  // Order matters: drawn mark (if any), then the attestation, then who. For a
  // stamp the reason leads because it is the claim; for a drawn mark the image
  // leads because that is what the eye goes to first.
  const identity = isDrawn ? `${drawn}${who}${reason}` : `${reason}${who}`;

  return `<div class="seal">
  <div class="body">
    <div class="for"><span>${t({ fr: "Pour", en: "For" }, lang)} ${esc(sig.forParty)}</span>${pos}</div>
    <div class="rule"></div>
    ${identity}
    <div class="ev">${esc(sig.signedAt)} · ${esc(sig.method)}<br>${esc(sig.docRef || "")}${hashFragment}</div>
  </div>
  <div class="vfy">${sig.qrSvg || ""}<div class="code">${esc(formatVerifyCode(sig.code))}</div></div>
</div>`;
}

/** `A4B7K92MXQ1P` → `A4B7-K92M-XQ1P`. Duplicated from services/signatures/tokens
 *  so the kit stays free of service dependencies, per this file's contract. */
function formatVerifyCode(code) {
  return String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/(.{4})(?=.)/g, "$1-");
}

function watermark(text) {
  return `<div class="wm"><span>${esc(text)}</span></div>`;
}

/**
 * G2 — the watermark a document render should carry, given the connection it
 * is rendering for. Sandbox renders are forced to "TEST SANDBOX" (PRD §5.5
 * [RULE]: watermarked PDFs in Test mode) no matter what the tenant configured;
 * live renders keep the tenant's own watermark. The env is read off the pooled
 * client (registry tags it at acquire; tenant-context re-tags on switches), so
 * every render path is covered without threading `env` through callers.
 */
function watermarkFor(client, configured) {
  const env = client ? client[Symbol.for("praxis.conn.env")] : null;
  return env === "sandbox" ? "TEST SANDBOX" : configured || "";
}

function footer(entity = {}, cfg = {}, verify) {
  const legal = [entity.legal_name, entity.rccm ? `RCCM ${entity.rccm}` : null, entity.niu ? `NIU ${entity.niu}` : null, entity.address].filter(Boolean).map(esc).join(" · ");
  const custom = cfg.footer_text ? `<div>${esc(cfg.footer_text)}</div>` : "";
  const qr = verify && cfg.show && cfg.show.qr ? `<div class="qr">${t({ fr: "Vérifier l'authenticité", en: "Verify authenticity" }, cfg.language)}: ${esc(verify)}</div>` : "";
  return `<div class="foot">${legal}${custom}${qr}</div>`;
}

module.exports = {
  esc, money, xaf, dateFmt, t, defaults, mergeCfg, words, wordsBlock,
  shell, letterhead, titleMeta, head, parties, lineTable, totals, section,
  bankBlock, termsBlock, signatureBlock, sealBlock, formatVerifyCode, watermark, watermarkFor, footer,
};
