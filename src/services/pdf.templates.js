/**
 * Bilingual (FR/EN) PDF templates (KB §8.4). Pure HTML builders — no rendering
 * here, so they are unit-testable. Figures use a monospaced font per the KB.
 */
"use strict";

const { fontFaceCss, PDF_FONT_BODY, PDF_FONT_MONO } = require("./pdf.fonts");

const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const xaf = (n) => Number(n || 0).toLocaleString("fr-FR") + " XAF";

function shell(title, bodyHtml) {
  // The faces are EMBEDDED (pdf.fonts.js), not merely named. 'Noto Sans' and
  // 'Noto Sans Mono' were named here and neither was present in the rendering
  // container, so every document came out in FreeSans regardless. Noto Sans Mono
  // is not in the shipped library either — figures now use JetBrains Mono, which
  // is, and which the screen uses for the same numbers.
  return "<!doctype html><html><head><meta charset=\"utf-8\"><style>" +
    fontFaceCss() +
    "body{font-family:" + PDF_FONT_BODY + ";color:#111;margin:32px}" +
    ".num{font-family:" + PDF_FONT_MONO + ";text-align:right}" +
    "table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;border-bottom:1px solid #ddd}" +
    "h1{font-size:18px}.muted{color:#666;font-size:12px}</style><title>" + esc(title) + "</title></head><body>" +
    bodyHtml + "</body></html>";
}

/** Final-invoice document. `data`: { doc_number, entity, client, lines[], totals, verify }. */
function buildInvoiceHtml(data) {
  const rows = (data.lines || []).map((l) =>
    "<tr><td>" + esc(l.label) + "</td><td class=\"num\">" + xaf(l.line_ht) + "</td></tr>").join("");
  const body =
    "<h1>Facture / Invoice " + esc(data.doc_number) + "</h1>" +
    "<p class=\"muted\">" + esc(data.entity || "") + " → " + esc(data.client || "") + "</p>" +
    "<table><thead><tr><th>Désignation / Description</th><th class=\"num\">Montant HT</th></tr></thead><tbody>" + rows + "</tbody></table>" +
    "<table><tbody>" +
    "<tr><td>Total HT / Subtotal</td><td class=\"num\">" + xaf(data.totals && data.totals.service_ht) + "</td></tr>" +
    "<tr><td>Débours / Disbursements</td><td class=\"num\">" + xaf(data.totals && data.totals.disbursement_total) + "</td></tr>" +
    "<tr><td>TVA 19,25%</td><td class=\"num\">" + xaf(data.totals && data.totals.vat_total) + "</td></tr>" +
    "<tr><td><strong>Total TTC</strong></td><td class=\"num\"><strong>" + xaf(data.totals && data.totals.total_ttc) + "</strong></td></tr>" +
    "</tbody></table>" +
    (data.verify ? "<p class=\"muted\">Vérification / Verify: " + esc(data.verify) + "</p>" : "");
  return shell("Invoice " + (data.doc_number || ""), body);
}

module.exports = { buildInvoiceHtml, shell, xaf, esc };
