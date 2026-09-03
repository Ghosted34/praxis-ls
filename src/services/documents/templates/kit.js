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
const blocks = require("./letterhead-blocks");

const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * Money in a currency (XAF default), fr-FR grouping. `cfg.currencies` is the
 * tenant's active-currency catalogue (code → { symbol, decimals }); when it is
 * present the DISPLAYED unit is the currency's symbol (e.g. "FCFA") rather than
 * the raw ISO code, and the fraction digits honour the currency's own decimals
 * (0 for XAF, 2 for USD/EUR). Without a catalogue the code is shown unchanged,
 * so this stays safe for callers that never see a resolved config.
 */
/**
 * Money, as it prints.
 *
 * A whole amount keeps no decimals — "1 000 000 XAF", which is how a
 * Cameroonian document is written and why `minimumFractionDigits` is not
 * simply `dec`. A fractional one keeps the currency's FULL precision: with a
 * minimum of 0 and a maximum of 2, a VAT total of 312812.5 printed as
 * "312 812,5 XAF" — one decimal, on a signed document, which reads as a
 * truncation and is the kind of thing a client queries.
 */
const money = (n, ccy = "XAF", cfg = {}) => {
  const cur = (cfg && cfg.currencies && cfg.currencies[ccy]) || null;
  const unit = (cur && cur.symbol) || ccy;
  const dec = cur && Number.isInteger(cur.decimals) ? cur.decimals : 2;
  const v = Number(n || 0);
  const min = Number.isInteger(v) ? 0 : dec;
  return `${v.toLocaleString("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: dec })} ${unit}`;
};
const xaf = (n, cfg) => money(n, "XAF", cfg);
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
  const cur = (cfg && cfg.currencies && cfg.currencies[ccy]) || null;
  const unit = (cur && cur.symbol) || ccy || "XAF";
  const text = `${words(amount, lang === "fr" ? "fr" : "en", decimals)} ${unit}`;
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

/**
 * The fit scale — the single number that keeps an instrument sheet on one page.
 *
 * Every compressible metric in the sheet stylesheet is `calc(N * var(--k))`, so
 * a template that knows it is about to render nine cargo lines instead of one
 * sets `k` below 1 and the whole page tightens. Nothing is dropped, nothing is
 * summarised, nothing is measured at render time — the value is computed from
 * the record, which is what makes it unit-testable.
 *
 * `FIT_FLOOR` is deliberately far below what anyone would call comfortable.
 * A one-page instrument is a CONTRACT, not a preference: the transit order is
 * signed, stamped and filed as a single sheet, and the second sheet is the one
 * that never comes back stamped. So an order with forty cargo lines comes out
 * small rather than coming out as two sheets, and the floor exists only to stop
 * the arithmetic running away with itself — not to decide, on the operator's
 * behalf, that their cargo list is too long.
 *
 * Shrinking stops helping before the floor is reached anyway: a QR has a
 * physical size below which no camera resolves it (§3.7), so the seal and the
 * verification block keep their millimetres however small the type gets. Past
 * that point the page is mostly the blocks that cannot shrink, and it spills.
 * `tests/unit/transit-order-document.test.js` pins where that happens.
 */
const FIT_FLOOR = 0.35;
const clampFit = (k) => {
  const n = Number(k);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(FIT_FLOOR, Math.round(n * 1000) / 1000));
};

/**
 * The printable height of one page, in mm, for the paper and margin in `cfg`.
 * `.sheet` is set to exactly this, which is what pins the foot to the bottom of
 * the page and lets the cargo table absorb the slack above it.
 */
const PAPER_MM = { A4: { w: 210, h: 297 }, LETTER: { w: 215.9, h: 279.4 } };
const sheetHeightMm = (cfg = {}) => {
  const paper = PAPER_MM[String(cfg.paper || "A4").toUpperCase()] || PAPER_MM.A4;
  const margin = Number.isFinite(Number(cfg.margin_mm)) ? Number(cfg.margin_mm) : 16;
  return Math.round((paper.h - 2 * margin) * 10) / 10;
};

/**
 * The height a one-page sheet is actually allowed to occupy — the printable
 * height, less a millimetre.
 *
 * The millimetre is not slack, it is a ROUNDING GUARD. Layout happens in CSS
 * pixels at 96dpi, so 265mm is 1001.57px and lands on whatever the engine
 * rounds it to; a sheet built to exactly the page height measured 265.1mm and
 * paginated to two pages, with the second one carrying nothing but a tenth of
 * a millimetre. `.sheet` and every template's fit budget both come from here,
 * so the guard cannot be applied to one and forgotten on the other.
 */
const fitBudgetMm = (cfg = {}) => Math.round((sheetHeightMm(cfg) - 1) * 10) / 10;

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
    // The instrument sheet's two extra greys. `line` is the soft hairline the
    // card-style templates use; a ruled form needs a rule with more presence
    // (it survives a photocopy) and a band behind its labels.
    rule: brand.rule || "#B7C4D6",
    band: brand.band || "#F2F6FB",
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
  const sheetMm = fitBudgetMm(c);
  const logoMm = Number(c.logo && c.logo.height_mm) || 15;
  const css = `
    ${fontFaceCss()}
    @page { size: ${c.paper}; margin: ${c.margin_mm}mm; }
    * { box-sizing: border-box; }
    body { font-family: ${c.font}; color: ${c.ink}; font-size: 12px; line-height: 1.5; margin: 0; }
    .accent { color: ${c.accent}; }
    .muted { color: ${c.muted}; }
    .num { font-family: ${c.monoFont}; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.01em; }
    .doc { position: relative; --k: 1; }
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
    /* The foot carries the legal block on the left and — only when the document
       actually has a signature — the verification block on the right. flex, not
       a float: the legal line is variable-length and must be allowed to wrap
       beside the QR rather than under it. */
    .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid ${c.line}; font-size: 9.5px; color: ${c.muted}; display: flex; gap: 6mm; align-items: flex-start; justify-content: space-between; }
    .foot .foot-legal { flex: 1; min-width: 0; }
    .foot .foot-vfy { flex: none; width: 30mm; }
    /* 20mm here against the seal's 22mm: the footer symbol is a convenience for
       a document whose seal is elsewhere on the page (or on another page), and
       the foot has less height to give. Still 0.6mm per module at this payload
       length — above the 0.5mm a phone camera needs at arm's length (§3.7). */
    .foot .foot-vfy svg { width: 20mm; height: 20mm; margin: 0 auto; }
    .foot .foot-vfy .hint { font-size: 7px; line-height: 1.3; margin-top: 0.8mm; }
    /* Wet-signature reconciliation mark (§8.3). It is deliberately quieter
       than the verification QR: bottom-left, 40% grey, 12mm square, 5pt code.
       The padding is the quiet zone; without it a mathematically valid symbol
       can be unreadable after a photocopy. */
    .wet-code { width: 24mm; text-align: left; break-inside: avoid; page-break-inside: avoid; flex: none; }
    .wet-code .dm { width: 12mm; height: 12mm; padding: 2mm; box-sizing: content-box; display: flex; align-items: center; justify-content: center; }
    .wet-code .dm svg { width: 12mm; height: 12mm; display: block; }
    .wet-code .cap { font-family: ${c.monoFont}; font-size: 5pt; line-height: 1.1; color: #666; white-space: nowrap; }
    .wet-code .copy { font-family: ${c.font}; font-size: 5pt; color: #666; text-transform: uppercase; letter-spacing: 0.08em; }
    .sig { display: flex; gap: 40px; margin-top: 30px; }
    .sig .b { flex: 1; }
    .sig .sig-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: ${c.muted}; }
    .sig .ln { border-top: 1px solid ${c.ink}; margin-top: 34px; padding-top: 3px; font-size: 10px; }
    .wm { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
    .wm span { font-size: 96px; font-weight: 800; color: ${c.accent}; opacity: 0.08; transform: rotate(-24deg); letter-spacing: 0.1em; }

    /* ══ THE INSTRUMENT SHEET ═══════════════════════════════════════════════
       A transit order, a delivery note, a goods-received note: a header, a
       block of facts a clerk checks at a glance, a cargo table, a few
       elections, two signatures. The blocks below are that vocabulary.

       THEY LOOK LIKE A FORM, NOT LIKE A CARD DECK. The transit order was built
       out of k.section + .box — a rounded, padded card per fact pair — and
       eight of those cost ~55mm of vertical space to carry sixteen short
       values, which is what pushed the signature block onto a second page. The
       legacy print view (transit-order.php) used hard-ruled boxes with grey
       label bands; it fits, and it is what a customs clerk and a filing clerk
       both read faster. This is that anatomy in our own type and colour.

       ── The one-page guarantee ──────────────────────────────────────────────
       Two mechanisms, and they are different things:

       1. THE SHEET IS EXACTLY ONE PAGE TALL (.sheet min-height, computed from
          the paper and the margin). It is a flex column, so the cargo table
          absorbs the slack and the signature strip and foot land at the bottom
          of the page whether the order carries one cargo line or nine —
          instead of floating up under a short table the way a normal flow
          would.

       2. THE CONTENT SCALES TO FIT (--k). Every compressible metric below is
          calc(N * var(--k)); the template computes k from what it is about to
          render and sets it inline. Nothing is ever dropped or summarised —
          a fuller order is set tighter. Deterministic from the data, so it is
          unit-testable and there is no measuring and no script in the page.

       WHAT DOES NOT SCALE: the verification QR. §3.7 measured it — below about
       0.5mm per module a phone camera stops resolving it at arm's length, and
       a symbol that cannot be scanned is worse than none. It keeps its
       millimetres however tight the rest of the page gets. */

    .sheet { display: flex; flex-direction: column; min-height: ${sheetMm}mm; }
    /* The elastic middle. min-height keeps the cargo box looking like the ruled
       area it is on a one-line order (the legacy reserved the same space), and
       flex:1 hands it every millimetre the rest of the page does not use. */
    .grow { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
    /* A ruled block inside the elastic area takes the slack ITSELF, so the
       spare millimetres land inside its border as more ruled space to write on
       — not as a gap between two boxes, which reads as a layout fault. */
    .grow > .blk { flex: 1 1 auto; display: flex; flex-direction: column; }
    .grow > .blk > .manifest { flex: 1 1 auto; align-content: start; }

    /* ── Letterhead ─────────────────────────────────────────────────────────
       Logo left, the legal identity right, one accent rule under both. The
       identity block is the OHADA one every Cameroonian commercial document
       carries — RCCM and NIU are not optional decoration, they are what makes
       the paper an instrument of the company that issued it. */
    .lh2 { display: flex; justify-content: space-between; align-items: flex-end; gap: calc(6mm * var(--k)); }
    .lh2 .mark { flex: none; max-width: 62mm; }
    /* An EXPLICIT height, not a max-height. An <img> sized only by max-height +
       max-width contributes ZERO to a flex item's max-content width in Chrome,
       so the letterhead mark collapsed to 0×0 and every document rendered with
       no logo at all — loaded, decoded, and invisible. A definite height also
       makes the letterhead's own height predictable, which is what the one-page
       height model needs. object-fit keeps a wide mark from stretching when
       max-width caps it. */
    .lh2 .mark img { height: ${logoMm}mm; width: auto; max-width: 62mm;
                     object-fit: contain; object-position: left bottom; display: block; }
    .lh2 .mark .wordmark { font-size: calc(15pt * var(--k)); font-weight: 800; letter-spacing: -0.01em; color: ${c.accent}; line-height: 1.1; }
    .lh2 .id { text-align: right; min-width: 0; }
    .lh2 .id .nm { font-size: calc(11.5pt * var(--k)); font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; line-height: 1.2; }
    .lh2 .id .ln { font-size: calc(7.4pt * var(--k)); color: ${c.muted}; line-height: 1.45; }
    .lh2rule { border-bottom: 0.7mm solid ${c.accent}; margin-top: calc(1.6mm * var(--k)); }

    /* ── Title bar ──────────────────────────────────────────────────────────
       The document's own name, centred and letter-spaced, with the reference
       and the direction on the right where the legacy put them. */
    .tbar { display: flex; align-items: flex-end; justify-content: space-between; gap: calc(4mm * var(--k)); margin-top: calc(2.4mm * var(--k)); }
    .tbar .ttl { font-size: calc(15pt * var(--k)); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; line-height: 1.1; }
    .tbar .sub { font-size: calc(7.6pt * var(--k)); color: ${c.muted}; font-style: italic; margin-top: 0.3mm; }
    .tbar .rt { text-align: right; flex: none; }
    .tbar .no { font-family: ${c.monoFont}; font-size: calc(11pt * var(--k)); font-weight: 700; color: ${c.accent}; letter-spacing: 0.02em; white-space: nowrap; }
    .tbar .meta { font-size: calc(7.4pt * var(--k)); color: ${c.muted}; margin-top: 0.4mm; }
    .tbar .dirs { margin-top: calc(1mm * var(--k)); font-size: calc(8pt * var(--k)); white-space: nowrap; }
    .tbar .dirs .on { font-weight: 700; }

    /* ── Ruled blocks ───────────────────────────────────────────────────────
       One border colour, one radius, one label style, used by every block
       below. A 3px radius rather than the legacy's hard corner: enough to read
       as ours, not enough to read as a card. */
    .blk { border: 0.25mm solid ${c.rule}; border-radius: 3px; margin-top: calc(2.2mm * var(--k)); }
    .blk > .hd { background: ${c.band}; border-bottom: 0.25mm solid ${c.rule};
                 padding: calc(0.9mm * var(--k)) calc(2.2mm * var(--k));
                 font-size: calc(6.4pt * var(--k)); font-weight: 700; letter-spacing: 0.1em;
                 text-transform: uppercase; color: ${c.ink}; }
    .blk > .bd { padding: calc(1.6mm * var(--k)) calc(2.2mm * var(--k)); font-size: calc(8.6pt * var(--k)); line-height: 1.4; }
    .row2 { display: flex; }
    .row2 > * { flex: 1; min-width: 0; }
    .row2 > * + * { border-left: 0.25mm solid ${c.rule}; }
    /* Two ruled blocks side by side. Stacking a one-line "place of delivery"
       under a one-line "customs regime" costs two label bands and two gaps to
       carry two short values; abreast they cost one row. */
    .pair { display: flex; gap: calc(3mm * var(--k)); margin-top: calc(2.2mm * var(--k)); align-items: stretch; }
    .pair > .blk { flex: 1; min-width: 0; margin-top: 0; display: flex; flex-direction: column; }
    .pair > .blk.w2 { flex: 2; }
    .pair > .blk > .bd { flex: 1 1 auto; }

    /* Facts: a ruled grid, label over value. min-width:0 on the cell or a long
       vessel name widens its track instead of wrapping inside it. */
    .facts { display: grid; grid-template-columns: 1fr 1fr; }
    .facts.c3 { grid-template-columns: repeat(3, 1fr); }
    .facts.c4 { grid-template-columns: repeat(4, 1fr); }
    .facts .c { padding: calc(1.4mm * var(--k)) calc(2.2mm * var(--k));
                border-right: 0.25mm solid ${c.rule}; border-bottom: 0.25mm solid ${c.rule}; min-width: 0; }
    .facts.c2 .c:nth-child(2n), .facts.c3 .c:nth-child(3n), .facts.c4 .c:nth-child(4n) { border-right: 0; }
    .facts .c.last-row { border-bottom: 0; }
    .facts .k { font-size: calc(6.2pt * var(--k)); text-transform: uppercase; letter-spacing: 0.08em; color: ${c.muted}; line-height: 1.3; }
    .facts .v { font-weight: 700; font-size: calc(9.4pt * var(--k)); line-height: 1.3; overflow-wrap: anywhere; }
    /* The document's own reference, in the accent — the proforma's treatment,
       and the value everyone quotes back on the phone. */
    .facts .v.ref { font-family: ${c.monoFont}; color: ${c.accent}; letter-spacing: 0.01em; }
    .facts .v.plain { font-weight: 400; }
    /* The centred document name, as the proforma sets it. */
    .dname { text-align: center; margin-top: calc(2.6mm * var(--k)); }
    .dname .ttl { font-size: calc(14pt * var(--k)); font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; line-height: 1.15; }
    .dname .sub { font-size: calc(7.8pt * var(--k)); color: ${c.muted}; font-style: italic; margin-top: 0.4mm; letter-spacing: 0.04em; }
    .dname .ref { font-family: ${c.monoFont}; font-size: calc(11pt * var(--k)); font-weight: 700;
                  color: ${c.accent}; letter-spacing: 0.02em; margin-top: 0.6mm; }

    /* A ticked box. An inline-block square with an ✕ — NOT ☐/☒, which are
       absent from the embedded Noto subsets and print as tofu, i.e. as a box
       nobody can interpret, on the one document where a tick is the meaning. */
    .tick { display: inline-block; width: calc(2.5mm * var(--k)); height: calc(2.5mm * var(--k));
            border: 0.25mm solid currentColor; margin-right: calc(1.1mm * var(--k)); vertical-align: -0.3mm;
            text-align: center; line-height: calc(2.2mm * var(--k)); font-size: calc(6.2pt * var(--k)); }

    /* A tick + a sentence. baseline, so the box sits on the first line of a
       clause that wraps rather than centring against the whole paragraph. */
    .clause { display: flex; align-items: baseline; gap: calc(0.5mm * var(--k)); margin-top: calc(1mm * var(--k)); }
    .clause:first-child { margin-top: 0; }
    .clause .tx { flex: 1; min-width: 0; }
    .clause .alt { color: ${c.muted}; font-size: calc(7.2pt * var(--k)); display: block; }
    .cols3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 calc(3mm * var(--k)); }
    /* Two clause columns inside one ruled block. Four clauses stacked cost
       ~21mm to say two things; abreast they cost ~11mm and the two elections
       stop reading as one four-way choice, which is what they are not. */
    .cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 calc(4mm * var(--k)); }
    /* The container manifest: three ruled cells to a row, every slot the same
       height whether it holds a box or a blank line to write one on. The blank
       IS the feature — a container added on the quay has somewhere to go and
       is still part of what gets signed. */
    .manifest { display: grid; grid-template-columns: 1fr 1fr 1fr; }
    .manifest .mcell { border-right: 0.2mm solid ${c.rule}; border-bottom: 0.2mm solid ${c.rule};
                       padding: calc(1mm * var(--k)) calc(2mm * var(--k));
                       font-size: calc(8.4pt * var(--k)); line-height: 1.3; min-width: 0;
                       overflow-wrap: anywhere; }
    .manifest .mcell:nth-child(3n) { border-right: 0; }
    .cols2 > div { min-width: 0; }
    .subh { font-weight: 700; font-size: calc(7.6pt * var(--k)); letter-spacing: 0.04em; margin-bottom: calc(0.8mm * var(--k)); }

    /* Cargo. The header band matches .blk > .hd so the table reads as one of
       the ruled blocks rather than as a loose grid. */
    .cargo { border: 0.25mm solid ${c.rule}; border-radius: 3px; margin-top: calc(2.2mm * var(--k));
             display: flex; flex-direction: column; flex: 1 1 auto; min-height: calc(26mm * var(--k)); overflow: hidden; }
    .cargo table { width: 100%; border-collapse: collapse; }
    .cargo thead th { background: ${c.band}; border-bottom: 0.25mm solid ${c.rule}; text-align: left;
                      padding: calc(1mm * var(--k)) calc(2.2mm * var(--k));
                      font-size: calc(6.4pt * var(--k)); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .cargo thead th.num { text-align: right; }
    .cargo tbody td { padding: calc(1.2mm * var(--k)) calc(2.2mm * var(--k)); border-bottom: 0.2mm solid ${c.rule};
                      font-size: calc(8.6pt * var(--k)); vertical-align: top; }
    .cargo tbody tr:last-child td { border-bottom: 0; }
    /* The declared value closes the table it is the total of, instead of
       floating in a separate right-aligned block the way .totals does. */
    .cargo tfoot td { border-top: 0.5mm solid ${c.accent}; padding: calc(1.2mm * var(--k)) calc(2.2mm * var(--k));
                      font-size: calc(9pt * var(--k)); font-weight: 700; }
    .cargo tfoot td.sub { border-top: 0; padding-top: 0; font-weight: 400; font-size: calc(7.6pt * var(--k)); color: ${c.muted}; }

    /* ── The signatory strip ────────────────────────────────────────────────
       The block the document exists to collect, and the one thing that must
       never split across a page break — the failure this replaced was a
       transit order whose signature boxes landed alone on page 2, so the copy
       that came back stamped was a sheet with no cargo on it. */
    .strip { display: flex; gap: calc(3mm * var(--k)); margin-top: calc(2.2mm * var(--k));
             break-inside: avoid; page-break-inside: avoid; }
    .strip .sb { flex: 1; min-width: 0; border: 0.25mm solid ${c.rule}; border-radius: 3px;
                 display: flex; flex-direction: column; }
    .strip .sb > .hd { background: ${c.band}; border-bottom: 0.25mm solid ${c.rule};
                       padding: calc(0.9mm * var(--k)) calc(2.2mm * var(--k));
                       font-size: calc(6.4pt * var(--k)); font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
    /* The stamp well. A named, ruled area — "sign here" with no box is how a
       rubber stamp lands across the cargo table. 20mm is a Cameroonian round
       company stamp with a signature over it. */
    /* flex:1 so the body fills the box its taller sibling stretched, which is
       what puts the ruled line on the FLOOR of the well. Without it the line
       sits wherever the content happens to end and the two signature boxes
       rule at different heights — which reads as a rendering fault. */
    .strip .sb > .bd { padding: calc(1.6mm * var(--k)) calc(2.2mm * var(--k)); display: flex; flex-direction: column;
                       flex: 1 1 auto; min-height: calc(20mm * var(--k)); }
    .strip .grow2 { flex: 1 1 auto; }
    .strip .stamp { max-height: calc(16mm * var(--k)); max-width: 44mm; align-self: flex-start; display: block; }
    .strip .ln { border-top: 0.25mm solid ${c.ink}; margin-top: calc(1.2mm * var(--k)); padding-top: calc(0.7mm * var(--k));
                 font-size: calc(7.4pt * var(--k)); }
    .strip .hint { font-size: calc(7pt * var(--k)); color: ${c.muted}; line-height: 1.35; }
    /* A seal inside a box that is already bordered drops its own border: two
       rules 1mm apart read as a mistake. It keeps its own type sizes, because
       the evidence rows have their own legibility floor (§3.12). */
    .strip .seal { width: auto; border: 0; padding: 0; max-height: none; margin-top: calc(1mm * var(--k)); }

    /* ── The foot ───────────────────────────────────────────────────────────
       Pinned to the bottom of the sheet by the flex column, not by a margin
       that happens to work at one content length. Legal identity and bank on
       the left — the OHADA block a counterparty needs to pay or to check us —
       page and provenance on the right, verification QR beside them. */
    .ifoot { margin-top: calc(2.2mm * var(--k)); border-top: 0.5mm solid ${c.accent}; padding-top: calc(1.2mm * var(--k));
             display: flex; align-items: flex-start; justify-content: space-between; gap: calc(4mm * var(--k));
             font-size: calc(6.8pt * var(--k)); color: ${c.muted}; line-height: 1.45; }
    .ifoot .lft { flex: 1; min-width: 0; }
    .ifoot .rgt { text-align: right; flex: none; }
    .ifoot .vfy { width: 20mm; text-align: center; flex: none; }
    .ifoot .vfy svg { width: 20mm; height: 20mm; display: block; }
    .ifoot .vfy .code { font-family: ${c.monoFont}; font-size: 5.5pt; color: #4b5563; margin-top: 0.6mm; white-space: nowrap; }
    .ifoot .vfy .hint { font-size: 5.5pt; line-height: 1.25; }

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
    /* The verification block, shared by the seal and the foot (kit.verifyBlock).
       Declared once and narrowed per home below, so the two can never drift
       into printing the same code at two different sizes. */
    .vfy { width: 22mm; text-align: center; flex: none; }
    .vfy svg { display: block; width: 22mm; height: 22mm; }
    /* white-space: nowrap on the code — "A4B7-K92M-XQ1P" breaking across two
       lines at a hyphen reads as two different codes to someone typing it. */
    .vfy .code { font-family: ${c.monoFont}; font-size: 5.5pt; letter-spacing: 0.02em;
                 color: #4b5563; margin-top: 0.8mm; white-space: nowrap; }
    .vfy .hint { font-family: ${c.font}; color: #4b5563; }

    /* ══ THE STANDARD SHELL ═════════════════════════════════════════════════
       ONE header and ONE footer, on every document this product prints.

       There used to be two. The instrument sheets (transit order, delivery
       note) carried '.lh2' — a mark, a right-hand identity block and an accent
       rule — and everything else carried '.head', whose identity was a single
       comma-joined line and whose foot printed two hardcoded identifier labels.
       A tenant therefore had two letterheads, only one of which their Letterhead
       tab described, and neither of which it actually controlled.

       This is the instrument sheet's anatomy, generalised: the same mark, the
       same identity column, the same 0.7mm accent rule, the same type sizes,
       now laid out from 'letterhead-blocks.compose()' so the arrangement is the
       tenant's rather than ours.

       IT IS A GRID, WHERE '.lh2' WAS A FLEX PAIR, so it carries its own class
       names rather than borrowing them. '.lh2' and '.ifoot' below are still
       defined because 'instrumentHead'/'instrumentFoot' still exist as
       deprecated aliases; nothing in the registry calls them any more and new
       code must not.

       THE GRID. Twelve columns. '.lhrow' is one row of the zone; '.lhcell' is
       one column stack within it. Blocks abreast cost the tallest cell, blocks
       stacked cost their sum — which is exactly what 'blocks.measure()'
       computes, and the two must agree or the one-page fit model is solving
       against a page that does not exist. */
    .lhz { display: block; }
    .lhrow { display: grid; grid-template-columns: repeat(12, 1fr);
             gap: 0 calc(3mm * var(--k)); align-items: end; }
    .lhrow + .lhrow { margin-top: calc(1.2mm * var(--k)); }
    .lhcell { min-width: 0; }
    .lhcell.a-center { text-align: center; }
    .lhcell.a-right { text-align: right; }
    .lhb { min-width: 0; overflow-wrap: anywhere; }
    .lhb .ln { line-height: 1.45; }
    .lhb.t-muted { color: ${c.muted}; }
    .lhb.t-accent { color: ${c.accent}; }
    .lhb.w-bold { font-weight: 800; }
    .lhb.x-upper { text-transform: uppercase; letter-spacing: 0.03em; }
    /* The mark. An EXPLICIT height, never a max-height — an <img> sized only by
       max-height contributes zero width to a grid item in Chrome, and the whole
       letterhead rendered 0×0. Same failure '.lh2 .mark img' documents; same fix. */
    .lhb img.mark { height: ${logoMm}mm; width: auto; max-width: 62mm;
                    object-fit: contain; display: block; }
    .lhcell.a-center .lhb img.mark { margin: 0 auto; }
    .lhcell.a-right .lhb img.mark { margin-left: auto; }
    .lhb .wordmark { font-weight: 800; letter-spacing: -0.01em; color: ${c.accent}; line-height: 1.1; }
    .lhb .rule { border-bottom: 0.7mm solid ${c.accent}; }

    /* The standard foot. '.lft' takes the composed blocks, '.rgt' the page and
       provenance labels, '.vfy' the verification symbol — which keeps its
       millimetres at every fit, because below ~0.5mm per module a phone camera
       stops resolving it and an unscannable symbol is worse than none. */
    .sfoot { display: flex; align-items: flex-end; justify-content: space-between;
             gap: calc(4mm * var(--k)); margin-top: calc(2.2mm * var(--k));
             padding-top: calc(1.4mm * var(--k)); border-top: 0.25mm solid ${c.rule};
             font-size: calc(7pt * var(--k)); color: ${c.muted}; line-height: 1.45; }
    .sfoot .lft { flex: 1; min-width: 0; }
    .sfoot .rgt { flex: none; text-align: right; }
    .sfoot .vfy { margin-left: calc(3mm * var(--k)); }
    /* The meta pairs that used to sit in a right-hand column beside the title.
       Under it instead, on one line, in the muted grade — a title fighting a
       meta column for the same optical centre is what made the old header read
       as two documents stapled together. */
    .dmeta { text-align: center; margin-top: calc(0.8mm * var(--k));
             font-size: calc(7.4pt * var(--k)); color: ${c.muted}; }
    .dmeta .mi + .mi::before { content: " · "; }

    @media print { .wm span { opacity: 0.08; } }`;
  /*
   * `--k` is emitted as a NUMBER, clamped, never as the raw cfg value.
   *
   * It reaches here from a template's own arithmetic, but `cfg` is merged from
   * a tenant-saved settings row on the way in, so an interpolated string would
   * be a CSS injection point on a stylesheet that themes every document. A
   * clamped Number cannot carry anything but a number, and a nonsense value
   * lands on 1 — a readable page — rather than on a broken one.
   */
  const k = clampFit(c.fit === undefined ? 1 : c.fit);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body><div class="doc" style="--k:${k}">${cfg.watermark ? watermark(cfg.watermark) : ""}${bodyHtml}</div></body></html>`;
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
function sealBlock(sig = {}, cfg = {}, { titled = false } = {}) {
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

  /*
   * `titled` — the seal is sitting inside a block that ALREADY names the party
   * (the transit order's signatory box is headed "Pour {company}").
   *
   * §3.12 requires a seal to declare which side it speaks for, and the reason
   * it gives is that two seals on one page are otherwise indistinguishable.
   * That requirement is met by the box, not dropped: what is dropped is the
   * SECOND printing of the same company name, 4mm under the first, in the same
   * accent caps. The position in the chain is kept either way — a box header
   * cannot say "2 of 3".
   */
  const forRow = titled
    ? (pos ? `<div class="for"><span></span>${pos}</div>` : "")
    : `<div class="for"><span>${t({ fr: "Pour", en: "For" }, lang)} ${esc(sig.forParty)}</span>${pos}</div>`;

  return `<div class="seal">
  <div class="body">
    ${forRow}
    <div class="rule"></div>
    ${identity}
    <div class="ev">${esc(sig.signedAt)} · ${esc(sig.method)}<br>${esc(sig.docRef || "")}${hashFragment}</div>
  </div>
  ${verifyBlock({ code: sig.code, qrSvg: sig.qrSvg }, c)}
</div>`;
}

/**
 * The wet-signature DataMatrix. It encodes only the print_code — never the
 * verify token, never entity_ref — because a photocopy must not become a public
 * verification credential. `svg` is generated server-side by
 * services/signatures/barcode.js.
 */
function printBarcode(job = {}, cfg = {}) {
  if (!job || !job.code || !job.svg) return "";
  const copy = Number(job.reprintNo || job.reprint_no || 0) > 0
    ? `<div class="copy">${t({ fr: "Copie", en: "Copy" }, cfg.language)} ${esc(job.reprintNo || job.reprint_no)}</div>`
    : "";
  return `<div class="wet-code"><div class="dm">${job.svg}</div><div class="cap">${esc(formatPrintCode(job.code))}</div>${copy}</div>`;
}

function formatPrintCode(code) {
  return String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/(.{6})(?=.)/g, "$1-");
}

/**
 * The verification block — a QR and, beneath it, the same code in type
 * (doc/SIGNATURE_ENGINEERING_GUIDE.md §5.2).
 *
 * ── One element, two homes ─────────────────────────────────────────────────
 * `sealBlock` puts it in the seal's right-hand column; `footer` puts it at the
 * foot of a document that carries a signature. They must render the SAME
 * symbol at the same size from the same code, so there is one function rather
 * than two pieces of markup that agree today.
 *
 * ── Inline SVG, never a data-URI <img> ─────────────────────────────────────
 * Puppeteer rasterises inline SVG at print resolution, so the modules land on
 * exact device pixels instead of being resampled from a bitmap — which is the
 * difference between a symbol that survives a photocopier and one that does
 * not. It also costs no extra request, so nothing depends on the renderer's
 * CSP or on a network the render host may not have.
 *
 * ── What it does NOT print ─────────────────────────────────────────────────
 * The URL. It is 40 characters of `https://…/v/…` that nobody types and that
 * would double the block's height for no reader benefit — the QR carries it
 * for a camera and the code carries it for a human. A short instruction line
 * is printed instead, so someone holding paper knows the code is typable and
 * where.
 *
 * @param {object} v
 * @param {string} v.code   verify_code, any spelling — grouped for print here
 * @param {string} v.qrSvg  inline SVG from services/signatures/qr.js
 * @param {boolean} [v.showHint] print the "verify at …" line (footer only)
 * @param {string} [v.hintUrl] the host to type, shown with the hint
 */
function verifyBlock(v = {}, cfg = {}) {
  if (!v || !v.code) return "";
  const lang = (cfg && cfg.language) || defaults().language;
  const hint = v.showHint
    ? `<div class="hint">${t({ fr: "Vérifiez ce document sur", en: "Verify this document at" }, lang)} ${esc(v.hintUrl || "")}</div>`
    : "";
  return `<div class="vfy">${v.qrSvg || ""}<div class="code">${esc(formatVerifyCode(v.code))}</div>${hint}</div>`;
}

/** `A4B7K92MXQ1P` → `A4B7-K92M-XQ1P`. Duplicated from services/signatures/tokens
 *  so the kit stays free of service dependencies, per this file's contract. */
function formatVerifyCode(code) {
  return String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/(.{4})(?=.)/g, "$1-");
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

/* ── Instrument builders ────────────────────────────────────────────────────
 * The builders for the sheet stylesheet declared in `shell`. See the comment
 * there for what the sheet is and why it looks like a form. Every one of them
 * takes already-resolved values and returns a string: no measuring, no I/O, and
 * nothing that behaves differently between the HTML preview and the PDF.
 *
 * ⚠ A parameter named `html` is inserted RAW. Those are the seams where a
 *   template composes other kit blocks (a seal, a table, a clause list);
 *   everything carrying a value out of a record goes through `esc` or `t` here.
 */

/**
 * A ticked, or empty, box.
 *
 * An ✕ inside a bordered span rather than ☒/☐: the box-drawing checkbox
 * characters are absent from the embedded Noto subsets (latin + latin-ext) and
 * print as tofu — a box nobody can interpret, on the one document where the
 * tick IS the instruction.
 */
function tick(on) {
  return `<span class="tick">${on ? "&#10005;" : ""}</span>`;
}

/**
 * A sentence in the document's language, STACKED rather than slash-joined.
 *
 * `t` renders "fr / en" on one line, which reads fine for a two-word column
 * heading and badly for a legal clause — especially one carrying the company's
 * own name, where the bilingual form repeats it twice in a row. So in bilingual
 * mode the languages sit on two lines with the second muted, and a monolingual
 * document carries ONE language with no separator anywhere on the page.
 */
function clauseText(pair, lang) {
  if (lang === "fr" || lang === "en") return t(pair, lang);
  const fr = pair.fr ?? pair.en ?? "";
  const en = pair.en ?? pair.fr ?? "";
  return fr === en ? esc(fr) : `${esc(fr)}<span class="alt">${esc(en)}</span>`;
}

/** A tick + a clause. `pair` is {fr,en}; a one-language caller passes both. */
function clause(on, pair, cfg = {}) {
  return `<div class="clause">${tick(on)}<span class="tx">${clauseText(pair, cfg.language)}</span></div>`;
}

/**
 * The facts grid — `cells` = [[label, value], …], two or four to a row.
 *
 * A falsy cell is dropped, so a template can list every fact it MIGHT hold and
 * let the record decide which appear. The last row is padded to full width, or
 * the grid's bottom edge comes out as a step rather than a rule.
 */
function factsGrid(cells, cfg = {}, { cols = 2 } = {}) {
  const n = cols === 3 || cols === 4 ? cols : 2;
  const list = (cells || []).filter((c) => Array.isArray(c) && c.length);
  if (!list.length) return "";
  const pad = (n - (list.length % n)) % n;
  const all = list.concat(Array.from({ length: pad }, () => null));
  const lastRow = all.length - n;
  return `<div class="facts c${n}">${all.map((cell, i) => {
    const cls = `c${i >= lastRow ? " last-row" : ""}`;
    if (!cell) return `<div class="${cls}"></div>`;
    const [label, value, opt] = cell;
    const v = value === null || value === undefined || value === "" ? "—" : value;
    // `opt.html` is the escape hatch for a value that is markup rather than
    // text — the Import/Export tick-pair is the only current user. It is the
    // caller's job to have escaped it; every other path here goes through esc.
    const vh = opt && opt.html ? String(value) : esc(v);
    const vc = ["v", opt && opt.ref ? "ref" : "", opt && opt.plain ? "plain" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}"><div class="k">${t(typeof label === "string" ? { fr: label, en: label } : label, cfg.language)}</div><div class="${vc}">${vh}</div></div>`;
  }).join("")}</div>`;
}

/**
 * A ruled block: a grey label band over its content. `html` is raw.
 *
 * `wide` doubles the block's share when it sits in a `pairRow`; `bare` drops
 * the body padding for content that brings its own (a facts grid).
 */
function ruledBlock(label, html, cfg = {}, { wide = false, bare = false } = {}) {
  if (!html) return "";
  const hd = label
    ? `<div class="hd">${t(typeof label === "string" ? { fr: label, en: label } : label, cfg.language)}</div>`
    : "";
  const body = bare ? html : `<div class="bd">${html}</div>`;
  return `<div class="blk${wide ? " w2" : ""}">${hd}${body}</div>`;
}

/**
 * The cargo table — the elastic block of the sheet.
 *
 * `foot` = [[label, value, {sub?}]] closes the table with the figure it totals
 * (a declared customs value belongs to the cargo it describes, not to a
 * right-floated box three blocks further down).
 *
 * An EMPTY table still renders its header and its ruled area: a transit order
 * with no cargo lines is an order somebody has to notice is incomplete, and a
 * blank space where the table should be reads as a rendering fault instead.
 */
function cargoTable(columns, rows = [], cfg = {}, foot = []) {
  const th = columns.map((c) => `<th class="${c.num ? "num" : ""}">${t(typeof c.label === "string" ? { fr: c.label, en: c.label } : c.label, cfg.language)}</th>`).join("");
  const tb = (rows || []).length
    ? rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? "num" : ""}">${esc(r[c.key])}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}" class="muted">—</td></tr>`;
  const tf = (foot || []).filter(Boolean).map(([label, value, opt]) => {
    const cls = opt && opt.sub ? " class=\"sub\"" : "";
    return `<tr><td${cls} colspan="${columns.length - 1}">${t(typeof label === "string" ? { fr: label, en: label } : label, cfg.language)}</td><td${cls || ' class=""'}><div class="num">${esc(value)}</div></td></tr>`;
  }).join("");
  return `<div class="cargo"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody>${tf ? `<tfoot>${tf}</tfoot>` : ""}</table></div>`;
}

/**
 * The letterhead: the mark on the left, HOW TO REACH US on the right.
 *
 * ── The head/foot split ────────────────────────────────────────────────────
 * The head answers "who sent this and how do I reach them"; the foot answers
 * "who are they, legally". Nothing appears in both. An earlier version printed
 * the legal name, the address, RCCM and NIU at the top and the SAME four at the
 * bottom — a quarter of the identity block on the page was duplication, on a
 * document whose entire problem is height.
 *
 *   head  legal name · address lines · phone + email
 *   foot  the statutory identifiers                  (kit.instrumentFoot)
 *
 * ── Where the address lines come from ──────────────────────────────────────
 * `entity.address_lines` — an ARRAY, derived by
 * `modules/master/entity-letterhead.service.addressLines()` from the entity's
 * structured `entity_address` row (line1, line2, po_box, postal_code, city,
 * region, country), with the legacy free-text `address` column as its fallback.
 *
 * It is not derived HERE, and the kit must never start parsing an address: the
 * entity dossier's live preview runs the same assembler, and two of them is how
 * the letterhead a tenant designs stops matching the one that prints. A caller
 * that passes no `address_lines` falls back to the raw column so an unmigrated
 * path still renders something true.
 */
function instrumentHead(entity = {}, cfg = {}) {
  const mark = cfg.logo && cfg.logo.show && cfg.logo.url
    ? `<img src="${esc(cfg.logo.url)}" alt="">`
    : `<div class="wordmark">${esc(entity.legal_name || "")}</div>`;
  const address = Array.isArray(entity.address_lines) && entity.address_lines.length
    ? entity.address_lines
    : String(entity.address || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines = [
    ...address,
    [entity.phone, entity.email].filter(Boolean).join(" · "),
  ].filter(Boolean).map((l) => `<div class="ln">${esc(l)}</div>`).join("");
  return `<div class="lh2"><div class="mark">${mark}</div><div class="id"><div class="nm">${esc(entity.legal_name || "")}</div>${lines}</div></div><div class="lh2rule"></div>`;
}

/**
 * The document's own name, centred under the letterhead — the proforma's
 * treatment, and the one the tenant asked for. The reference, date and status
 * live in the facts grid beneath it rather than beside it: a title fighting a
 * right-hand meta column for the same optical centre is what made the previous
 * header read as two documents stapled together.
 */
/**
 * `sub` is normally the document's own REFERENCE, not a strapline.
 *
 * A title with the number under it is how everyone identifies the sheet, and it
 * is the pairing the proforma this was modelled on uses. The strapline
 * ("Autorisation de transit") went to the foot: it explains what the document
 * IS, which a reader needs once, at the end — not in the position of greatest
 * emphasis on the page. Pass `{ ref: true }` for the reference treatment (mono,
 * accent, larger); leave it off for an actual subtitle.
 */
function docName(title, sub, cfg = {}, { ref = false } = {}) {
  const line = sub
    ? `<div class="${ref ? "ref" : "sub"}">${ref ? esc(sub) : t(typeof sub === "string" ? { fr: sub, en: sub } : sub, cfg.language)}</div>`
    : "";
  return `<div class="dname"><div class="ttl">${t(title, cfg.language)}</div>${line}</div>`;
}

/** Two (or three) ruled blocks abreast. `w2` on a block doubles its share. */
function pairRow(blocks = []) {
  const list = (blocks || []).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  return `<div class="pair">${list.join("")}</div>`;
}

/**
 * The signatory strip. `blocks` = [{ title, html?, line?, hint? }].
 *
 * `html` fills the well (a stamp image, a seal, or nothing); `line` is the
 * ruled name/date line under it; `hint` is the small print above it. All three
 * are raw — callers compose them from kit blocks or escape them.
 *
 * The CSS marks this `break-inside: avoid`. That is the whole point: the
 * failure this replaced was a transit order whose signature boxes landed alone
 * on a second page, so the sheet that came back stamped had no cargo on it.
 */
function signStrip(blocks = [], cfg = {}) {
  const list = (blocks || []).filter(Boolean);
  if (!list.length) return "";
  return `<div class="strip">${list.map((b) => `<div class="sb"><div class="hd">${
    t(typeof b.title === "string" ? { fr: b.title, en: b.title } : b.title, cfg.language)
  }</div><div class="bd">${b.hint ? `<div class="hint">${b.hint}</div>` : ""}<div class="grow2">${b.html || ""}</div>${
    b.line ? `<div class="ln">${b.line}</div>` : ""
  }</div></div>`).join("")}</div>`;
}

/**
 * The foot of an instrument sheet: WHO WE ARE, LEGALLY. Pinned to the bottom of
 * the page by the flex column rather than by a margin that happens to work at
 * one content length.
 *
 * ── The identifiers are DERIVED, not two named columns ─────────────────────
 * `entity.identifiers` is [{ kind, number }] from
 * `entity-letterhead.service.identifiers()`, which reads the entity's
 * registration and tax-registration rows and falls back to the legacy
 * `niu`/`rccm` columns. That matters because the mandatory mentions on a
 * commercial document are JURISDICTIONAL: a Cameroonian sheet carries NIU and
 * RCCM, a French one SIREN and TVA intracommunautaire. Printing two hardcoded
 * labels is correct in exactly one country, and this product is not sold in
 * exactly one country.
 *
 * `bank` is OFF by default and opt-in per template. Bank details belong on a
 * document somebody is meant to PAY — an invoice, a proforma. A transit order
 * is an authorisation to declare cargo; printing an account number on it hands
 * the tenant's banking details to every warehouse and border post the sheet
 * passes through, for nothing.
 *
 * `verify` is the {url, code, qrSvg} object from services/signatures/verify-link
 * and renders ONLY when the document carries a signature — and only when no
 * seal on the page is already carrying one (§3.12a: one QR per page). An
 * unsigned document showing no QR is the honest answer.
 */
function instrumentFoot(entity = {}, cfg = {}, verify, opts = {}) {
  const ids = Array.isArray(entity.identifiers) && entity.identifiers.length
    ? entity.identifiers.map((i) => `${i.kind} ${i.number}`)
    : [entity.rccm ? `RCCM ${entity.rccm}` : null, entity.niu ? `NIU ${entity.niu}` : null].filter(Boolean);
  const legal = ids.map((l) => `<div>${esc(l)}</div>`).join("");
  const b = entity.bank_block || {};
  const bank = opts.bank
    ? [b.bank, b.account ? `${t({ fr: "Compte", en: "Account" }, cfg.language)} ${b.account}` : null, b.iban ? `IBAN ${b.iban}` : null]
      .filter(Boolean).map(esc).join(" · ")
    : "";
  const custom = cfg.footer_text ? `<div>${esc(cfg.footer_text)}</div>` : "";
  const v = verify && typeof verify === "object" && verify.code && cfg.show && cfg.show.qr ? verify : null;
  const host = v ? String(v.url || "").replace(/^https?:\/\//i, "").split("/")[0] : "";
  const vfy = v
    ? `<div class="vfy">${v.qrSvg || ""}<div class="code">${esc(formatVerifyCode(v.code))}</div><div class="hint">${t({ fr: "Vérifiez sur", en: "Verify at" }, cfg.language)} ${esc(host)}</div></div>`
    : "";
  const right = [
    opts.pageLabel ? esc(opts.pageLabel) : "",
    opts.provenance ? esc(opts.provenance) : "",
  ].filter(Boolean).map((x) => `<div>${x}</div>`).join("");
  return `<div class="ifoot"><div class="lft">${legal}${bank ? `<div>${bank}</div>` : ""}${custom}</div>`
    + `<div class="rgt">${right}</div>${vfy}</div>`;
}

/**
 * The millimetres of a letterhead that DO NOT scale with the fit.
 *
 * `instrumentHead` sizes the mark with an explicit `height: Nmm` from the
 * tenant's Studio config, because an <img> constrained only by max-height
 * contributes zero width to a flex item in Chrome and the whole letterhead
 * rendered at 0×0. The consequence is that a 17mm mark is 17mm at every fit,
 * and a template that counts it among the shrinkable blocks tells `fitScale` it
 * has millimetres to give that it does not.
 *
 * Returns 0 when no mark is shown — the wordmark fallback is type, and type
 * scales — so the caller adds its own scaling estimate for the head instead.
 */
function headFixedMm(cfg = {}) {
  const logo = cfg.logo || {};
  if (!logo.show || !logo.url) return 0;
  const h = Number(logo.height_mm);
  // +1 for the accent rule and its margin, which are hairlines either way.
  return (Number.isFinite(h) && h > 0 ? h : 15) + 1;
}

/**
 * The fit scale for a sheet: how far the page must tighten to hold its content.
 *
 * The estimate is the CALLER's, because only the template knows what it is
 * about to render. This is the arithmetic and the clamp, in one place, so two
 * templates cannot disagree about what k means or about where the floor is.
 *
 * ── Why `fixedMm` is a separate argument and not part of the total ─────────
 * Not everything on the page scales. The seal keeps its own type sizes (§3.12
 * sets a legibility floor for the evidence rows) and every QR keeps its
 * millimetres (§3.7 — below ~0.5mm per module a camera stops resolving it), so
 * those blocks are the SAME height at k = 0.5 as at k = 1.
 *
 * Folding them into one total and solving `budget / content` therefore
 * under-shrinks: it assumes 28mm of seal will become 26mm when it will not, and
 * the page comes out a couple of millimetres over — which is a second sheet.
 * Solving `budget = fixed + scaling · k` is exact, and it is the difference
 * between a document that fits and one that fits on the cases you happened to
 * test.
 *
 * @param {number} scalingMm content whose height follows `--k`
 * @param {number} budgetMm  the page's own height (see `fitBudgetMm`)
 * @param {number} [fixedMm] content that keeps its millimetres whatever k is
 */
function fitScale(scalingMm, budgetMm, fixedMm = 0) {
  const budget = Number(budgetMm);
  const scaling = Number(scalingMm);
  const fixed = Number.isFinite(Number(fixedMm)) ? Number(fixedMm) : 0;
  if (!Number.isFinite(budget) || !Number.isFinite(scaling) || scaling <= 0 || budget <= 0) return 1;
  // A page whose UNSHRINKABLE blocks already exceed the paper cannot be solved
  // for. It lands on the floor and spills, which is honest — and it is exactly
  // where the measured ceiling of the transit order comes from.
  return clampFit((budget - fixed) / scaling);
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

/**
 * The document foot: the tenant's legal block, its own footer copy, and — when
 * the document carries a signature — the verification block.
 *
 * ⚠ `verify` IS AN OBJECT, NOT A STRING. It was a string, and the string was
 *   a "praxis" custom-scheme URI carrying an entity_ref — a scheme no phone
 *   resolves, printed as text under the words "Verify authenticity", with no
 *   hash in it and nothing at the other end. It told a reader their document
 *   was verifiable and gave them no way to verify it, which is worse than
 *   printing nothing.
 *
 *   A non-object is ignored rather than printed, so a caller that has not been
 *   migrated renders a document with no verification block instead of putting
 *   a machine token in front of a customer. The custom-scheme grep in guide
 *   §5.8 criterion 2 returns nothing, and this guard is what keeps it that way.
 *
 * @param {object} [verify] { url, code, qrSvg } from services/signatures/verify-link.js
 */
function footer(entity = {}, cfg = {}, verify) {
  const legal = [entity.legal_name, entity.rccm ? `RCCM ${entity.rccm}` : null, entity.niu ? `NIU ${entity.niu}` : null, entity.address].filter(Boolean).map(esc).join(" · ");
  const custom = cfg.footer_text ? `<div>${esc(cfg.footer_text)}</div>` : "";
  const v = verify && typeof verify === "object" && verify.code ? verify : null;
  const host = v ? String(v.url || "").replace(/^https?:\/\//i, "").split("/")[0] : "";
  const wet = cfg.wet_print && cfg.show && cfg.show.qr ? printBarcode(cfg.wet_print, cfg) : "";
  const block = v && cfg.show && cfg.show.qr
    ? `<div class="foot-vfy">${verifyBlock({ ...v, showHint: true, hintUrl: host }, cfg)}</div>`
    : "";
  return `<div class="foot">${wet}<div class="foot-legal">${legal}${custom}</div>${block}</div>`;
}

/* ══ THE STANDARD SHELL ═══════════════════════════════════════════════════ */

/**
 * The composed letterhead for a render.
 *
 * `cfg.letterhead` is normally pre-composed by `template.service.resolveCfg`,
 * which has the entity's addresses, registrations, treasury accounts and saved
 * layout to hand. When it is absent this composes from whatever the entity row
 * carries, so a caller that has not been migrated still renders a true — if
 * thinner — letterhead rather than nothing. `compose` is pure, so the kit
 * calling it costs no I/O and breaks no layering.
 */
function composed(entity = {}, cfg = {}, doc = {}) {
  if (cfg.letterhead && cfg.letterhead.header) return cfg.letterhead;
  return blocks.compose({
    entity,
    config: cfg.letterhead_config || {},
    layout: cfg.letterhead_layout || null,
    customLines: cfg.letterhead_lines || [],
    logo_url: (cfg.logo && cfg.logo.show !== false && cfg.logo.url) || null,
    logo_height_mm: (cfg.logo && cfg.logo.height_mm) || null,
    doc,
  }, cfg.language === "fr" ? "fr" : "en");
}

/** One block's inner HTML. Every value here is escaped; nothing interpolates markup. */
function blockHtml(b, cfg) {
  if (!b.visible || !b.lines.length) return "";
  const cls = [
    "lhb",
    b.tone === "muted" ? "t-muted" : b.tone === "accent" ? "t-accent" : "",
    b.weight === "bold" ? "w-bold" : "",
    b.transform === "upper" ? "x-upper" : "",
  ].filter(Boolean).join(" ");

  // The type size is a NUMBER, clamped by `compose`, interpolated into a
  // stylesheet that themes every document — the same rule `--k` follows in
  // `shell`. A string here would be an injection point on tenant-saved data.
  const size = Math.min(2.5, Math.max(0.5, Number(b.size) || 1));
  const basePt = b.zone === "header"
    ? (b.kind === "wordmark" ? 15 : b.id === "company_name" ? 11.5 : 7.4)
    : 7;
  const style = b.kind === "rule" || b.kind === "image"
    ? ""
    : ` style="font-size:calc(${(basePt * size).toFixed(2)}pt * var(--k));"`;

  const inner = b.lines.map((l) => {
    if (l.type === "image") return `<img class="mark" src="${esc(l.src)}" alt="">`;
    if (l.type === "wordmark") return `<div class="wordmark">${esc(l.text)}</div>`;
    if (l.type === "rule") return `<div class="rule"></div>`;
    return `<div class="ln">${esc(l.text)}</div>`;
  }).join("");

  return `<div class="${cls}"${style} data-block="${esc(b.id)}">${inner}</div>`;
}

/**
 * One composed zone as grid HTML.
 *
 * Blocks are grouped by row, then by the column they start in — the same two
 * axes `blocks.measure()` uses, because a header that measures one way and
 * prints another is how a one-page sheet becomes two.
 */
function zoneHtml(list = [], cfg = {}) {
  const live = list.filter((b) => b.visible && b.lines.length);
  if (!live.length) return "";
  const rows = new Map();
  for (const b of live) {
    if (!rows.has(b.row)) rows.set(b.row, new Map());
    const cols = rows.get(b.row);
    if (!cols.has(b.col)) cols.set(b.col, []);
    cols.get(b.col).push(b);
  }
  const html = [...rows.keys()].sort((a, z) => a - z).map((r) => {
    const cols = rows.get(r);
    const cells = [...cols.keys()].sort((a, z) => a - z).map((col) => {
      const cell = cols.get(col);
      const span = Math.min(12 - col, Math.max(...cell.map((b) => b.span || 12)));
      const align = cell[0].align || "left";
      return `<div class="lhcell a-${esc(align)}" style="grid-column:${col + 1} / span ${span};">`
        + cell.map((b) => blockHtml(b, cfg)).join("")
        + `</div>`;
    }).join("");
    return `<div class="lhrow">${cells}</div>`;
  }).join("");
  return `<div class="lhz">${html}</div>`;
}

/**
 * THE STANDARD HEADER — the one every document prints.
 *
 * Replaces both `letterhead()`/`head()` (the card-deck family) and
 * `instrumentHead()` (the ruled sheets). Those remain as thin aliases so no
 * template breaks mid-migration, but nothing should call them in new code.
 *
 * `opts.title` renders the document's own name under the letterhead, which is
 * where the proforma this was modelled on puts it. Pass `opts.meta` for the
 * label/value pairs the card-deck templates used to put in a right-hand column;
 * they print under the title rather than beside it, because a title fighting a
 * meta column for the same optical centre is what made the old header read as
 * two documents stapled together.
 */
function standardHead(entity = {}, cfg = {}, opts = {}) {
  const lh = composed(entity, cfg, opts.doc || {});
  const head = zoneHtml(lh.header, cfg);
  if (!opts.title) return head;
  const meta = (opts.meta || []).filter((m) => m && m[1]).map((m) => `<span class="mi">${
    t(typeof m[0] === "string" ? { fr: m[0], en: m[0] } : m[0], cfg.language)
  }: ${esc(m[1])}</span>`).join("");
  return head + docName(opts.title, opts.number || "", cfg, { ref: Boolean(opts.number) })
    + (meta ? `<div class="dmeta">${meta}</div>` : "");
}

/**
 * THE STANDARD FOOTER.
 *
 * `verify` is the {url, code, qrSvg} object from services/signatures/verify-link
 * and renders only when the document carries a signature and no seal on the
 * page is already carrying one (§3.12a: one QR per page). A non-object is
 * ignored rather than printed — it was once a "praxis:" custom-scheme string no
 * phone could resolve, printed under the words "Verify authenticity".
 *
 * `opts.bank` opts the payment block in. It is OFF by default and that is not
 * an oversight: a transit order is an authorisation to declare cargo, and
 * printing an account number on it hands the tenant's banking details to every
 * warehouse and border post the sheet passes through, for nothing.
 */
function standardFoot(entity = {}, cfg = {}, verify, opts = {}) {
  const lh = composed(entity, cfg, opts.doc || {});
  const list = lh.footer.filter((b) => opts.bank || b.id !== "payment");
  const left = zoneHtml(list, cfg);

  const custom = cfg.footer_text ? `<div class="ln">${esc(cfg.footer_text)}</div>` : "";
  const right = [opts.pageLabel, opts.provenance].filter(Boolean)
    .map((x) => `<div>${esc(x)}</div>`).join("");

  const v = verify && typeof verify === "object" && verify.code && cfg.show && cfg.show.qr ? verify : null;
  const host = v ? String(v.url || "").replace(/^https?:\/\//i, "").split("/")[0] : "";
  const vfy = v
    ? `<div class="vfy">${v.qrSvg || ""}<div class="code">${esc(formatVerifyCode(v.code))}</div>`
      + `<div class="hint">${t({ fr: "Vérifiez sur", en: "Verify at" }, cfg.language)} ${esc(host)}</div></div>`
    : "";

  return `<div class="sfoot"><div class="lft">${left}${custom}</div>`
    + `<div class="rgt">${right}</div>${vfy}</div>`;
}

/**
 * The millimetres the standard shell occupies, for the one-page fit model.
 *
 * Returns `{ head, foot, fixed, headScaling }`.
 *
 * ── Why `fixed` is the mark's MARGINAL height, not its height ──────────────
 * Not everything on the page scales with `--k`. The mark carries an explicit
 * height in millimetres (an <img> sized only by max-height contributes zero
 * width to a grid item in Chrome — see the CSS), so it is the same height at
 * k = 0.5 as at k = 1, and `fitScale` has to solve `budget = fixed + scaling·k`
 * with it on the fixed side.
 *
 * But the mark sits BESIDE the identity column, and a row costs the taller of
 * the two. On an entity with a long legal name and four identity lines the
 * identity column is already taller than the mark, and the mark then adds
 * nothing to the page — subtracting its full height would tell the solver it
 * has millimetres of unshrinkable content it does not have, and set the sheet
 * tighter than it needed to be for no reason.
 *
 * So the header is measured twice, with the mark and without it, and `fixed` is
 * the DIFFERENCE — exactly what the mark costs this page, which is its height
 * on a short letterhead and zero on a tall one. `headScaling` is the remainder,
 * the part that genuinely follows `--k`.
 *
 * This replaces the per-template `HEIGHT_MM.head` constant. That constant was
 * right on the day somebody measured it and became a lie the moment a tenant
 * added a footer line — which is the feature this rebuild ships, so the lie was
 * going to arrive on its own.
 */
function shellMm(entity = {}, cfg = {}, opts = {}) {
  const lh = composed(entity, cfg, opts.doc || {});
  const footList = lh.footer.filter((b) => opts.bank || b.id !== "payment");

  const head = blocks.measure(lh.header, "header");
  const headNoMark = blocks.measure(lh.header.filter((b) => b.id !== "logo"), "header");
  // The accent rule and its margin are hairlines either way and already counted
  // by `measure`; what is fixed here is only the mark's marginal contribution.
  const fixed = Math.max(0, Math.round((head - headNoMark) * 10) / 10);

  return {
    head,
    foot: blocks.measure(footList, "footer"),
    fixed,
    headScaling: Math.round((head - fixed) * 10) / 10,
  };
}

module.exports = {
  esc, money, xaf, dateFmt, t, defaults, mergeCfg, words, wordsBlock,
  shell, letterhead, titleMeta, head, parties, lineTable, totals, section,
  bankBlock, termsBlock, signatureBlock, signerBlock,
  tick, clause, clauseText, factsGrid, ruledBlock, pairRow, cargoTable, instrumentHead,
  docName, signStrip, instrumentFoot, fitScale, headFixedMm, sheetHeightMm, fitBudgetMm, FIT_FLOOR,
  sealBlock, printBarcode, formatPrintCode, verifyBlock, formatVerifyCode, watermark, watermarkFor, footer,
  standardHead, standardFoot, shellMm, composed, zoneHtml, blocks,
};
