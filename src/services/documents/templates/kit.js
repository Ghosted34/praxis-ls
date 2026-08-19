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
  const under1000 = (x, hundredPlural) => {
    const h = Math.floor(x / 100);
    const rest = x % 100;
    let out = "";
    if (h > 0) {
      if (lang === "fr") {
        // "cent" takes the plural s only when it ends the whole numeral —
        // "deux cents" (200), "deux cent trois" (203, a number follows in the
        // group), "deux cent mille" (200 000, a higher group follows). The
        // `hundredPlural` flag carries whether this group is the final one.
        out += (h === 1 ? "CENT" : ones[h] + " CENT") + (hundredPlural && rest === 0 && h > 1 ? "S" : "");
      } else {
        out += ones[h] + " HUNDRED";
      }
    }
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
    const gWords = i === 0
      ? under1000(g, true)
      : (lang === "fr" && g === 1 && i === 1 ? "MILLE" : under1000(g, false) + " " + scale[i]);
    parts.push(gWords);
  }
  return parts.join(join);
}

/**
 * Amount in words: "… AND 00/100" (en) / "… et 00/100" (fr). `decimals` is the
 * currency's minor-unit count (currency.decimals, MOD-08); for a zero-decimal
 * currency (XAF) the fractional "/100" suffix is omitted entirely — "UN MILLION
 * DE FRANCS CFA", never "… ET 00/100 XAF" — because the currency has no
 * subdivision to express. The legacy (print-po.php) always appended "AND 00
 * CENTS" regardless, which is wrong for XAF; this honours the tenant's own
 * currency settings instead.
 */
function words(amount, lang = "en", decimals = 2) {
  const dec = Number.isInteger(decimals) && decimals >= 0 ? decimals : 2;
  const n = Number(amount || 0);
  const neg = n < 0;
  const scale = 10 ** dec;
  const abs = Math.abs(Math.round(n * scale) / scale);
  const whole = Math.floor(abs);
  const frac = Math.round((abs - whole) * scale);
  let body = wordsInt(whole, lang);
  if (dec > 0) {
    const pad = String(frac).padStart(dec, "0");
    body += `${lang === "fr" ? " ET" : " AND"} ${pad}/1${"0".repeat(dec)}`;
  }
  return neg ? "MOINS " + body : body;
}

/** Section block rendering the amount in words, e.g. "ARRÊTÉE … À LA SOMME DE". */
function wordsBlock(amount, ccy, cfg = {}, decimals = 2) {
  const lang = cfg.language || "bilingual";
  const text = `${words(amount, lang === "fr" ? "fr" : "en", decimals)} ${ccy || "XAF"}`;
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
    .sig .sig-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: ${c.muted}; }
    .sig .ln { border-top: 1px solid ${c.ink}; margin-top: 34px; padding-top: 3px; font-size: 10px; }
    .wm { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
    .wm span { font-size: 96px; font-weight: 800; color: ${c.accent}; opacity: 0.08; transform: rotate(-24deg); letter-spacing: 0.1em; }
    .qr { margin-top: 8px; font-size: 9px; color: ${c.muted}; }
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
 * Labelled multi-signatory block — the named-actor replacement for the static
 * `signatureBlock`. Each entry is a sign-off slot: an uppercase label (WHO is
 * signing), the space to sign, then the printed name + title of the actual
 * actor, resolved from the document's own columns (issuer/approver/received_by/
 * validated_by) rather than one `cfg.signature` name shared by every document.
 *
 * `signers` = [{ label: {fr,en}|string, name, title }]. An entry with no name
 * still renders its line, so a not-yet-recorded sign-off (e.g. the "received by"
 * of an unreceived cash request) prints as a ruled line to be filled by hand —
 * the same reason the delivery-note manifest pads to ruled lines.
 */
function signerBlock(signers = [], cfg = {}) {
  if (!cfg.show || !cfg.show.signature) return "";
  const list = (Array.isArray(signers) ? signers : []).filter((s) => s && (s.label || s.name || s.title));
  if (!list.length) return "";
  return `<div class="sig">${list.map((s) => {
    const lbl = s.label ? t(typeof s.label === "string" ? { fr: s.label, en: s.label } : s.label, cfg.language) : "";
    const name = [s.name, s.title].filter(Boolean).map(esc).join(" · ");
    return `<div class="b">${lbl ? `<div class="sig-lbl">${lbl}</div>` : ""}<div class="ln">${name}</div></div>`;
  }).join("")}</div>`;
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
  bankBlock, termsBlock, signatureBlock, signerBlock, watermark, watermarkFor, footer,
};
