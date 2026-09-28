/**
 * The costing sheet — the printed budget for one operations file.
 *
 * ── WHAT THIS PAGE PROMISES (owner decisions, 28 Sep 2026) ─────────────────
 *
 * 1. ONE LANGUAGE, NEVER TWO. English by default (template.service
 *    DOC_DEFAULT_LANGUAGE), French when the operator picks it. Every word on
 *    the page follows that one choice — the labels, the status, the shipment
 *    facts (both languages are loaded, see loadRecord) and the line
 *    descriptions, which print the Financial Dictionary's name in the sheet's
 *    language rather than whichever copy the line was saved with. The first
 *    French render showed English descriptions and English shipment labels
 *    under French headings; that is the failure this rules out.
 *
 * 2. UP TO 17 LINES ON ONE PAGE. Header, client, shipment, lines, totals,
 *    the pass-through remark and the three seals, on one A4 sheet. Above 17
 *    the split is `costing-pages.paginate`'s — 12 on page 1, the rest on the
 *    pages after it under a repeated table header. Measured, not estimated:
 *    `scripts/dev/measure-costing.js` renders every count and fails if a page
 *    count differs from the rule.
 *
 * 3. THREE SEALS, NEVER SIX. One per step — raised, validated, approved
 *    (template.service `onePerStep`, and migration 14160 underneath it).
 *
 * 4. ONE REMARK LINE ABOUT PASS-THROUGHS. Not a sentence per débours line: one
 *    line that says what (PT) means, then the pricer's own note if any.
 *
 * The letterhead is untouched: `standardHead`/`standardFoot` compose it from
 * the entity's letterhead tab exactly as every other document does.
 */
"use strict";

const k = require("./kit");
const pages = require("./costing-pages");

/** Lines a one-page sheet prints at full size; past this it tightens by FIT_STEP a line. */
const FULL_SIZE_LINES = 12;
const FIT_STEP = 0.02;

const has = (v) => v !== undefined && v !== null && v !== "";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/;

/** The line's description in the sheet's language (see header, point 1). */
function lineName(l, lang) {
  const i = l.label_i18n;
  const saved = l.label || "";
  // A description somebody typed over the Dictionary name is theirs, and
  // prints as typed; only a line still carrying a Dictionary name is swapped
  // for the name in the sheet's language.
  const fromDictionary = i && (!saved || saved === i.en || saved === i.fr);
  const name = fromDictionary ? (lang === "fr" ? i.fr || i.en : i.en || i.fr) || saved : saved;
  return [l.container_type ? `${name} — ${l.container_type}` : name, l.item_code || ""];
}

/**
 * The shipment facts, ONCE each. The file's own columns (carrier, B/L, ports,
 * ETA, incoterm) and the service type's facets describe overlapping things,
 * and the first render printed both: Carrier and Transporteur, B/L and
 * Transport reference, ETA and Arrival (the second one in ISO). Each fact is
 * keyed by what it IS; the file's column wins, the facet fills the gaps.
 */
function shipmentFacts(data, lang) {
  const sh = data.shipment || {};
  const facets = (lang === "fr" && sh.facets_fr) || sh.facets || {};
  const order = sh.facet_order || Object.keys(facets);
  const L = (fr, en) => ({ fr, en });
  const val = (v) => (has(v) ? (ISO_DAY.test(String(v)) ? k.dateFmt(String(v).slice(0, 10)) : String(v)) : null);
  const facet = (role) => (facets[role] && has(facets[role].value) ? facets[role] : null);
  const facetLabel = (role, fallback) => (facet(role) && facet(role).label) || fallback;

  // [role, label, value] — the file's column first, the facet as fallback.
  const known = [
    ["SERVICE", L("Prestation", "Service"), data.service ? k.t(data.service, lang) : null],
    ["CARRIER", L("Transporteur", "Carrier"), data.carrier || (facet("CARRIER") && facet("CARRIER").value)],
    ["TRANSPORT_REF", L("Connaissement / LTA", "B/L · AWB"), data.bl_mawb || (facet("TRANSPORT_REF") && facet("TRANSPORT_REF").value)],
    ["CONVEYANCE", facetLabel("CONVEYANCE", L("Moyen de transport", "Vessel / voyage")), facet("CONVEYANCE") && facet("CONVEYANCE").value],
    ["ORIGIN", data.pol ? L("Port de chargement", "Port of loading") : facetLabel("ORIGIN", L("Origine", "Origin")), data.pol || (facet("ORIGIN") && facet("ORIGIN").value)],
    ["DESTINATION", data.pod ? L("Port de déchargement", "Port of discharge") : facetLabel("DESTINATION", L("Destination", "Destination")), data.pod || (facet("DESTINATION") && facet("DESTINATION").value)],
    ["ARRIVAL_DATE", L("ETA", "ETA"), data.eta || (facet("ARRIVAL_DATE") && facet("ARRIVAL_DATE").value)],
    ["INCOTERM", L("Incoterm", "Incoterm"), data.incoterm || (facet("INCOTERM") && facet("INCOTERM").value)],
  ];
  const taken = new Set(known.map((c) => c[0]));
  const rest = order
    .filter((role) => !taken.has(role) && facet(role))
    .map((role) => [role, facets[role].label || role, facets[role].value]);

  return known.concat(rest)
    .map(([, label, v]) => [label, val(v)])
    .filter((c) => c[1]);
}

/** The client block: name, then short lines. Every row is optional. */
function clientHtml(data, lang) {
  const b = data.client_block || {};
  const party = data.party || {};
  const tr = (fr, en) => k.t({ fr, en }, lang);
  const ids = [
    b.code && `${tr("Code", "Code")} ${b.code}`,
    b.niu && `NIU ${b.niu}`,
    b.rccm && `RCCM ${b.rccm}`,
  ].filter(Boolean);
  // A projection without the block (an older snapshot, the Studio sample)
  // still prints the identifiers it has.
  const idLine = ids.length ? ids : (party.lines || []);
  const place = [b.address, b.po_box && `${tr("BP", "PO Box")} ${b.po_box}`].filter(Boolean).join(" · ");
  const reach = [b.phone, b.email].filter(Boolean).join(" · ");
  const rows = [
    idLine.length ? k.esc(idLine.join(" · ")) : "",
    place ? k.esc(place) : "",
    reach ? k.esc(reach) : "",
    b.attn ? `${tr("À l'attention de", "Attn")}: <b>${k.esc(b.attn)}</b>` : "",
  ].filter(Boolean);
  return `<div class="cst-client">
    <div class="cst-lbl">${tr("Client", "Client")}</div>
    <div class="cst-cname">${k.esc(party.name || data.client || "—")}</div>
    ${rows.map((r) => `<div class="cst-cl">${r}</div>`).join("")}
  </div>`;
}

/** Date, file, status, currency — label muted, VALUE bold. */
function metaHtml(data, lang, ccy) {
  const rows = [
    [{ fr: "Date", en: "Date" }, k.dateFmt(data.date)],
    [{ fr: "Dossier", en: "File" }, data.dossier_ref],
    [{ fr: "Statut", en: "Status" }, data.status_words ? k.t(data.status_words, lang) : data.status],
    [{ fr: "Devise", en: "Currency" }, ccy],
    has(data.exchange_rate) && Number(data.exchange_rate) !== 1 && ccy !== "XAF"
      ? [{ fr: "Taux", en: "Rate" }, `1 ${ccy} = ${Number(data.exchange_rate).toLocaleString("fr-FR", { maximumFractionDigits: 6 })} XAF`]
      : null,
  ].filter((r) => r && has(r[1]));
  return `<div class="cst-meta">${rows.map(([l, v]) =>
    `<div class="cst-mk">${k.t(l, lang)}</div><div class="cst-mv">${k.esc(v)}</div>`).join("")}</div>`;
}

function factsHtml(cells, lang) {
  if (!cells.length) return "";
  // Five across once there are enough facts to fill them: a sea file carries
  // fifteen, and four across cost a whole extra row of ruled cells.
  const cols = cells.length > 8 ? 5 : 4;
  return `<div class="cst-facts"><div class="cst-fh">${k.t({ fr: "Expédition", en: "Shipment" }, lang)}</div>`
    + `<div class="cst-fg c${cols}">${cells.map(([label, v]) => `<div class="cst-f"><div class="cst-fk">${
      k.t(typeof label === "string" ? { fr: label, en: label } : label, lang)
    }</div><div class="cst-fv">${k.esc(v)}</div></div>`).join("")}</div></div>`;
}

function tableHtml(rows, lang, { cont = false } = {}) {
  const th = (fr, en, num) => `<th${num ? ' class="n"' : ""}>${k.t({ fr, en }, lang)}</th>`;
  return `<table class="cst-t"><thead><tr>${
    th("Désignation", "Description") + th("Qté", "Qty", 1) + th("P.U.", "Unit", 1)
    + th("TVA", "VAT", 1) + th("Montant HT", "Amount", 1)
  }</tr></thead><tbody>${rows.map((r) => `<tr><td class="d">${k.esc(r.label)}${
    r.code ? ` <span class="c">${k.esc(r.code)}</span>` : ""
  }</td><td class="n">${k.esc(r.qty)}</td><td class="n">${k.esc(r.unit)}</td><td class="n">${k.esc(r.vat)}</td><td class="n">${k.esc(r.amount)}</td></tr>`).join("")}</tbody></table>${
    cont ? `<div class="cst-cont">${k.t({ fr: "Suite page suivante", en: "Continued on next page" }, lang)} →</div>` : ""
  }`;
}

/** The three boxes. A signed step shows its seal; an unsigned one a line. */
const STEPS = [
  { code: "ACKNOWLEDGED", title: { fr: "Accusé de réception", en: "Acknowledged" } },
  { code: "REVIEWED_ACCEPTED", title: { fr: "Examiné et accepté", en: "Reviewed and accepted" } },
  { code: "APPROVED_DISPATCH", title: { fr: "Approuvé pour expédition", en: "Approved for dispatch" } },
];

function sealsHtml(seals, data, lang) {
  const byStep = new Map();
  const loose = [];
  for (const s of seals) {
    if (s.reasonCode && !byStep.has(s.reasonCode)) byStep.set(s.reasonCode, s);
    else loose.push(s);
  }
  // A seal the projection could not tie to a step (an older row with no
  // reason code) takes the first empty box in order — never a fourth box.
  const boxes = STEPS.map((step) => ({ step, seal: byStep.get(step.code) || null }));
  for (const s of loose) {
    const free = boxes.find((b) => !b.seal);
    if (free) free.seal = s;
  }
  return `<div class="cst-seals">${boxes.map(({ step, seal }) => {
    const title = seal && seal.reason ? k.esc(seal.reason) : k.t(step.title, lang);
    if (!seal) {
      return `<div class="cst-sb"><div class="cst-sh">${title}</div><div class="cst-sbd empty"><div class="cst-sline"></div></div></div>`;
    }
    const who = [seal.signerName, seal.signerRole].filter(Boolean).map(k.esc);
    return `<div class="cst-sb"><div class="cst-sh">${title}</div><div class="cst-sbd">`
      + `<div class="cst-qr">${seal.qrSvg || ""}<div class="cst-code">${k.esc(k.formatVerifyCode(seal.code))}</div></div>`
      + `<div class="cst-sx"><div class="cst-sn">${who[0] || ""}</div>${who[1] ? `<div class="cst-sr">${who[1]}</div>` : ""}`
      + `<div class="cst-st">${k.esc(seal.signedAt || "")}</div><div class="cst-sm">${k.esc(seal.method || "")}</div></div>`
      + "</div></div>";
  }).join("")}</div>`;
}

function css(cfg) {
  const c = { ...k.defaults(), ...cfg };
  const rule = c.rule || "#B7C4D6";
  const band = c.band || "#F2F6FB";
  const K = (v) => `calc(${v} * var(--k))`;
  return `<style>
  .cst-pg { display: flex; flex-direction: column; min-height: ${k.fitBudgetMm(c)}mm; position: relative; }
  .cst-pg + .cst-pg { break-before: page; page-break-before: always; }
  .cst-body { flex: 1 1 auto; }
  .cst-run { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 0.7mm solid ${c.accent};
             padding-bottom: ${K("1.4mm")}; font-size: ${K("9pt")}; }
  .cst-run b { letter-spacing: 0.12em; text-transform: uppercase; }
  .cst-run .r { font-family: ${c.monoFont}; color: ${c.muted}; font-size: ${K("8pt")}; }
  .cst-info { display: flex; gap: ${K("6mm")}; margin-top: ${K("2.4mm")}; align-items: flex-start; }
  .cst-client { flex: 1 1 auto; min-width: 0; font-size: ${K("8pt")}; line-height: 1.35; }
  .cst-lbl, .cst-fh { font-size: ${K("6.2pt")}; text-transform: uppercase; letter-spacing: 0.12em; color: ${c.muted}; }
  .cst-cname { font-weight: 700; font-size: ${K("10.5pt")}; line-height: 1.25; margin: 0.4mm 0 0.3mm; }
  .cst-cl { color: #374151; overflow-wrap: anywhere; }
  .cst-meta { flex: none; display: grid; grid-template-columns: auto auto; gap: ${K("0.5mm")} ${K("3mm")};
              font-size: ${K("8.2pt")}; line-height: 1.35; border-left: 0.25mm solid ${rule}; padding-left: ${K("4mm")}; }
  .cst-mk { color: ${c.muted}; }
  .cst-mv { font-weight: 700; }
  .cst-facts { border: 0.25mm solid ${rule}; border-radius: 3px; margin-top: ${K("2.4mm")}; }
  .cst-fh { background: ${band}; border-bottom: 0.25mm solid ${rule}; padding: ${K("0.8mm")} ${K("2mm")}; font-weight: 700; color: ${c.ink}; }
  .cst-fg { display: grid; grid-template-columns: repeat(4, 1fr); }
  .cst-fg.c5 { grid-template-columns: repeat(5, 1fr); }
  .cst-f { padding: ${K("0.8mm")} ${K("2mm")}; min-width: 0; border-bottom: 0.2mm solid ${rule}; border-right: 0.2mm solid ${rule}; }
  .cst-fg.c4 .cst-f:nth-child(4n), .cst-fg.c5 .cst-f:nth-child(5n) { border-right: 0; }
  .cst-title { display: flex; justify-content: center; align-items: baseline; gap: ${K("4mm")}; margin-top: ${K("2.2mm")}; }
  .cst-title .t { font-size: ${K("13pt")}; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; }
  .cst-title .no { font-family: ${c.monoFont}; font-size: ${K("11pt")}; font-weight: 700; }
  .cst-fk { font-size: ${K("5.8pt")}; text-transform: uppercase; letter-spacing: 0.08em; color: ${c.muted}; line-height: 1.25; }
  .cst-fv { font-weight: 700; font-size: ${K("8.2pt")}; line-height: 1.25; overflow-wrap: anywhere; }
  table.cst-t { width: 100%; border-collapse: collapse; margin-top: ${K("2.4mm")}; }
  .cst-t th { background: ${band}; text-align: left; font-size: ${K("6.2pt")}; font-weight: 700; letter-spacing: 0.08em;
              text-transform: uppercase; padding: ${K("1.1mm")} ${K("2mm")}; border-top: 0.25mm solid ${rule}; border-bottom: 0.25mm solid ${rule}; }
  .cst-t td { padding: ${K("0.85mm")} ${K("2mm")}; border-bottom: 0.2mm solid ${c.line}; font-size: ${K("8.3pt")}; line-height: 1.3; vertical-align: top; }
  .cst-t .n { text-align: right; white-space: nowrap; font-family: ${c.monoFont}; font-variant-numeric: tabular-nums; }
  .cst-t th.n { font-family: inherit; }
  .cst-t .c { color: ${c.muted}; font-family: ${c.monoFont}; font-size: ${K("6.6pt")}; white-space: nowrap; }
  .cst-cont { text-align: right; font-size: ${K("7pt")}; color: ${c.muted}; margin-top: ${K("1mm")}; font-style: italic; }
  .cst-sum { display: flex; gap: ${K("5mm")}; margin-top: ${K("2.6mm")}; align-items: flex-start; break-inside: avoid; }
  .cst-sum .l { flex: 1 1 auto; min-width: 0; }
  .cst-sum .r { flex: none; width: 76mm; }
  .cst-tot { width: 100%; border-collapse: collapse; font-size: ${K("8.4pt")}; }
  .cst-tot td { padding: ${K("0.7mm")} ${K("2mm")}; }
  .cst-tot td.v { text-align: right; font-family: ${c.monoFont}; white-space: nowrap; }
  .cst-tot tr.sub td { color: ${c.muted}; font-size: ${K("7.6pt")}; padding-top: 0; }
  .cst-tot tr.g td { border-top: 0.5mm solid ${c.accent}; font-weight: 700; font-size: ${K("9.6pt")}; padding-top: ${K("1.2mm")}; }
  .cst-words { border: 0.25mm solid ${rule}; border-radius: 3px; padding: ${K("1.4mm")} ${K("2.2mm")}; font-size: ${K("7.8pt")}; }
  .cst-words b { display: block; font-size: ${K("8.2pt")}; line-height: 1.3; }
  .cst-rem { margin-top: ${K("1.6mm")}; font-size: ${K("7.4pt")}; color: #374151; line-height: 1.35; }
  .cst-rem .own { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 0.4mm; }
  .cst-seals { display: flex; gap: ${K("3mm")}; margin-top: ${K("2.6mm")}; break-inside: avoid; }
  .cst-sb { flex: 1 1 0; min-width: 0; border: 0.25mm solid ${rule}; border-radius: 3px; }
  .cst-sh { background: ${band}; border-bottom: 0.25mm solid ${rule}; padding: ${K("0.8mm")} ${K("2mm")};
            font-size: ${K("6.2pt")}; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cst-sbd { display: flex; gap: 2mm; padding: 1.4mm 2mm; align-items: flex-start; }
  .cst-sbd.empty { height: 22mm; align-items: flex-end; }
  .cst-sline { border-top: 0.25mm solid ${c.ink}; width: 100%; }
  .cst-qr { flex: none; width: 18mm; text-align: center; }
  .cst-qr svg { width: 18mm; height: 18mm; display: block; }
  .cst-code { font-family: ${c.monoFont}; font-size: 5.2pt; color: #4b5563; margin-top: 0.4mm; white-space: nowrap; letter-spacing: -0.02em; }
  .cst-sx { flex: 1 1 auto; min-width: 0; font-size: 7pt; line-height: 1.3; }
  .cst-sn { font-weight: 700; font-size: 7.8pt; overflow-wrap: anywhere; }
  .cst-sr { color: #374151; overflow-wrap: anywhere; }
  .cst-st { margin-top: 0.8mm; font-family: ${c.monoFont}; font-size: 6.4pt; color: #374151; }
  .cst-sm { color: ${c.muted}; font-size: 6.4pt; }
  .cst-pg .sfoot { margin-top: ${K("2.6mm")}; }
  </style>`;
}

/**
 * @param {object} data   template.service loadRecord('COSTING') projection
 * @param {object} cfg    resolved config (single language)
 * @param {object} entity issuing entity
 * @param {object} verify footer verification block (used only when unsealed)
 */
function build(data, cfg, entity, verify) {
  const lang = cfg.language === "fr" ? "fr" : "en";
  const ccy = data.currency || cfg.base_currency || "XAF";
  const t = data.totals || {};
  const seals = Array.isArray(data.seals) ? data.seals : [];
  const title = { fr: "Cotation", en: "Costing" };

  const rows = (data.lines || []).map((l) => {
    const amount = has(l.amount) ? Number(l.amount) : Number(l.qty || 1) * Number(l.unit || 0);
    const vatAmount = l.is_disbursement || !has(l.tax) ? null : (amount * Number(l.tax)) / 100;
    const [label, code] = lineName(l, lang);
    return {
      label,
      code,
      qty: has(l.qty) ? String(l.qty) : "",
      unit: has(l.unit) ? k.figure(l.unit, ccy, cfg) : "",
      // A débours shows its supplier VAT marked (PT); one with none shows (PT).
      vat: l.is_disbursement
        ? (has(l.upstream_vat) && l.upstream_vat > 0 ? `${k.figure(l.upstream_vat, ccy, cfg)} (PT)` : "(PT)")
        : (vatAmount === null ? "" : k.figure(vatAmount, ccy, cfg)),
      amount: k.figure(amount, ccy, cfg),
    };
  });

  const L = (fr, en) => ({ fr, en });
  const totalsRows = [
    [L("Sous-total (HT)", "Subtotal (excl. VAT)"), k.figure(t.total_ht, ccy, cfg)],
    has(t.disbursement_total) && Number(t.disbursement_total) > 0
      ? [L("dont débours (au coût)", "of which disbursements (at cost)"), k.figure(t.disbursement_total, ccy, cfg), "sub"] : null,
    [L("TVA", "VAT"), k.figure(t.vat_total, ccy, cfg)],
    has(t.upstream_vat_total) && Number(t.upstream_vat_total) > 0
      ? [L("dont sur débours (PT)", "of which on disbursements (PT)"), k.figure(t.upstream_vat_total, ccy, cfg), "sub"] : null,
    [L("Total estimé (TTC)", "Total estimate (incl. VAT)"), k.money(t.total_ttc, ccy, cfg), "g"],
  ].filter(Boolean);

  const cur = cfg.currencies && cfg.currencies[ccy];
  const unitWord = (cur && cur.symbol) || ccy;
  const decimals = data.currency_decimals ?? entity.default_currency_decimals;
  const wordsHtml = cfg.show && cfg.show.words !== false && has(data.amount_in_words)
    ? `<div class="cst-words">${k.t(L("Arrêtée la présente à la somme de :", "Amount in words:"), lang)}<b>${
      k.esc(`${k.words(data.amount_in_words, lang, decimals === undefined ? 2 : decimals)} ${unitWord}`)
    }</b></div>`
    : "";

  // ONE line about pass-throughs, whatever their number — then the pricer's
  // own note, held to two lines.
  const hasPt = (data.lines || []).some((l) => l.is_disbursement);
  const ptLine = hasPt
    ? k.t(L(
      "(PT) Débours refacturés au coût ; la TVA indiquée est celle du fournisseur, payée pour le compte du client.",
      "(PT) Disbursements re-billed at cost; the VAT shown is the supplier's, paid on the client's behalf.",
    ), lang)
    : "";
  const remarkHtml = ptLine || data.remarks
    ? `<div class="cst-rem">${ptLine ? `<div>${ptLine}</div>` : ""}${
      data.remarks ? `<div class="own">${k.esc(String(data.remarks).replace(/\s*\n+\s*/g, " "))}</div>` : ""
    }</div>`
    : "";

  const summaryHtml = `<div class="cst-sum"><div class="l">${wordsHtml}${remarkHtml}</div><div class="r"><table class="cst-tot">${
    totalsRows.map(([label, v, cls]) => `<tr${cls ? ` class="${cls}"` : ""}><td>${k.t(label, lang)}</td><td class="v">${k.esc(v)}</td></tr>`).join("")
  }</table></div></div>`;

  // Amendments since the last approval: still on paper, compactly, because
  // the approver signs the second time on the strength of this list.
  const a = data.amendment;
  const amendHtml = a && a.has_changes
    ? `<div class="cst-rem"><b>${k.t(L("Modifié depuis l'approbation", "Changed since approval"), lang)}:</b> ${
      k.esc([
        ...(a.changed || []).map((l) => `${l.label} ${k.figure(l.was_amount, ccy, cfg)} → ${k.figure(l.amount, ccy, cfg)}`),
        ...(a.added || []).map((l) => `+ ${l.label} ${k.figure(l.amount, ccy, cfg)}`),
        ...(a.removed || []).map((l) => `− ${l.label}`),
      ].join(" · "))
    }</div>`
    : "";

  const chunks = pages.chunk(rows);
  const total = chunks.length;
  // The fit scale, from the data (never measured at render time): a one-page
  // sheet past 12 lines is set a little tighter per line, so 17 still lands on
  // one page. The QR in each seal keeps its millimetres — it is not scaled.
  const n = rows.length;
  const fit = total === 1 && n > FULL_SIZE_LINES ? 1 - (n - FULL_SIZE_LINES) * FIT_STEP : 1;
  cfg = { ...cfg, fit };
  const number = data.number || "";
  const facts = shipmentFacts(data, lang);

  const pageHtml = chunks.map((chunkRows, i) => {
    const first = i === 0;
    const last = i === total - 1;
    const top = first
      ? k.standardHead(entity, cfg, {})
        + `<div class="cst-title"><span class="t">${k.t(title, lang)}</span><span class="no accent">${k.esc(number)}</span></div>`
        + `<div class="cst-info">${clientHtml(data, lang)}${metaHtml(data, lang, ccy)}</div>`
        + factsHtml(facts, lang)
      : `<div class="cst-run"><b>${k.t(title, lang)}</b><span class="r">${k.esc(number)}</span></div>`;
    const bottom = last ? summaryHtml + amendHtml + sealsHtml(seals, data, lang) : "";
    const foot = k.standardFoot(entity, cfg, seals.length ? null : (last ? verify : null), {
      provenance: k.t(title, lang),
      pageLabel: total > 1 ? `${k.t(L("Page", "Page"), lang)} ${i + 1} / ${total}` : null,
    });
    return `<div class="cst-pg"><div class="cst-body">${top}${tableHtml(chunkRows, lang, { cont: !last })}${bottom}</div>${foot}</div>`;
  }).join("");

  return k.shell(`${k.t(title, lang)} ${number}`, css(cfg) + pageHtml, cfg);
}

module.exports = { build, lineName, shipmentFacts, FULL_SIZE_LINES, FIT_STEP };
