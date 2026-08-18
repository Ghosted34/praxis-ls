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
    "h1{font-size:18px}.muted{color:#666;font-size:12px}" +
    // Classes the control documents (rapprochement, cash count) add: a
    // sub-item row indented under the subtotal it rolls into, a totals row,
    // an unbalanced figure, the header block, the signature block, and the
    // band that stops an unapproved working paper being filed as a signed one.
    ".sub{color:#555;font-size:11px;padding-left:18px;border-bottom:none}" +
    ".grp td{padding-top:10px}.tot td{font-weight:600;border-top:1px solid #999}" +
    ".bad td{color:#a11}" +
    "table.head td:first-child{color:#666;width:180px}table.head td{border-bottom:none;padding:2px 0}" +
    "table.sign{margin-top:36px}table.sign td{width:50%;border:none;border-top:1px solid #999;padding-top:6px;vertical-align:top}" +
    ".draft{border:2px solid #a11;color:#a11;padding:6px 10px;margin-bottom:16px;font-weight:600;letter-spacing:.05em;text-align:center}"
    + "</style><title>" + esc(title) + "</title></head><body>" +
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

/**
 * État de rapprochement bancaire — the signed reconciliation statement.
 *
 * WHY IT READS AS A WALK AND NOT AS A DASHBOARD. An accountant checks a
 * rapprochement by following it from one balance to the other, line by line,
 * with a pen. Tiles and charts are the wrong shape for that: the whole
 * document is one arithmetic identity, and its job is to let a reader verify
 * every step and see where it fails. So the outstanding items are itemised
 * under the subtotal they roll into, and the difference is stated last, on its
 * own, whether or not it is zero.
 *
 * The DRAFT band is deliberate. A rapprochement that has not been approved is
 * a working paper, and a working paper that looks like a signed document is a
 * problem in an audit file — so an unapproved render says so across the top and
 * carries no signature block.
 *
 * `data`: { doc_number, entity, account, period, currency, balances{}, outstanding{},
 *           prepared_by, approved_by, approved_at, status, verify }
 */
function buildReconciliationHtml(data) {
  const b = data.balances || {};
  const o = data.outstanding || {};
  const money = (n) => Number(n || 0).toLocaleString("fr-FR") + " " + esc(data.currency || "XAF");
  const approved = data.status === "APPROVED_LOCKED";

  const itemRows = (items, sign) => (items || []).length
    ? items.map((i) =>
      "<tr><td class=\"sub\">" + esc(i.date || "") + "</td><td class=\"sub\">" + esc(i.label || "") +
      "</td><td class=\"num sub\">" + sign + money(i.amount) + "</td></tr>").join("")
    : "<tr><td class=\"sub\" colspan=\"3\">—</td></tr>";

  const section = (title, items, sign, total) =>
    "<tr class=\"grp\"><td colspan=\"2\">" + esc(title) + "</td><td class=\"num\">" + sign + money(total) + "</td></tr>" +
    itemRows(items, sign);

  const gap = Number(b.unexplained_difference || 0);

  const body =
    (approved ? "" : "<div class=\"draft\">BROUILLON / DRAFT — non approuvé, ne pas classer</div>") +
    "<h1>État de rapprochement bancaire</h1>" +
    "<p class=\"muted\">Bank reconciliation statement" + (data.doc_number ? " · " + esc(data.doc_number) : "") + "</p>" +
    "<table class=\"head\"><tbody>" +
    "<tr><td>Entité / Entity</td><td>" + esc(data.entity || "") + "</td></tr>" +
    "<tr><td>Compte / Account</td><td>" + esc(data.account || "") + "</td></tr>" +
    "<tr><td>Période / Period</td><td>" + esc(data.period || "") + "</td></tr>" +
    "</tbody></table>" +

    "<table><tbody>" +
    "<tr class=\"tot\"><td colspan=\"2\">Solde comptable / Balance per our ledger</td>" +
      "<td class=\"num\">" + money(b.ledger_balance) + "</td></tr>" +
    section("Dépôts en transit / Deposits in transit", o.deposits_in_transit, "+ ", b.deposits_in_transit) +
    section("Chèques non présentés / Unpresented payments", o.outstanding_payments, "− ", b.outstanding_payments) +
    section("Crédits non comptabilisés / Unrecorded credits", o.unrecorded_credits, "+ ", b.unrecorded_credits) +
    section("Débits non comptabilisés / Unrecorded debits", o.unrecorded_debits, "− ", b.unrecorded_debits) +
    "<tr class=\"tot\"><td colspan=\"2\">Solde relevé / Balance per the statement</td>" +
      "<td class=\"num\">" + money(b.statement_balance) + "</td></tr>" +
    "<tr class=\"" + (gap === 0 ? "tot" : "tot bad") + "\"><td colspan=\"2\">Écart inexpliqué / Unexplained difference</td>" +
      "<td class=\"num\">" + money(gap) + "</td></tr>" +
    "</tbody></table>" +

    (approved
      ? "<table class=\"sign\"><tbody><tr>" +
        "<td>Établi par / Prepared by<br><br>" + esc(data.prepared_by || "") + "</td>" +
        "<td>Approuvé par / Approved by<br><br>" + esc(data.approved_by || "") +
        (data.approved_at ? "<br><span class=\"muted\">" + esc(data.approved_at) + "</span>" : "") + "</td>" +
        "</tr></tbody></table>"
      : "") +
    (data.verify ? "<p class=\"muted\">Vérification / Verify: " + esc(data.verify) + "</p>" : "");

  return shell("Rapprochement " + (data.doc_number || ""), body);
}

/**
 * Cash count sheet — the petty-cash equivalent of a rapprochement.
 *
 * Nobody issues a statement for the tin in the drawer, so the external truth is
 * a physical count. The denomination breakdown is printed in full because that
 * is what makes the count re-performable: a total alone is an assertion, a
 * breakdown is evidence, and a recount either reproduces the tally or does not.
 *
 * `data`: { doc_number, entity, account, counted_on, currency, denominations[],
 *           counted_total, ledger_balance, difference, variance_reason,
 *           custodian, witness, attested_at, verify }
 */
function buildCashCountHtml(data) {
  const money = (n) => Number(n || 0).toLocaleString("fr-FR") + " " + esc(data.currency || "XAF");
  const rows = (data.denominations || [])
    .filter((d) => Number(d.qty) > 0)
    .map((d) =>
      "<tr><td class=\"num\">" + money(d.note) + "</td><td class=\"num\">× " + esc(d.qty) +
      "</td><td class=\"num\">" + money(Number(d.note) * Number(d.qty)) + "</td></tr>").join("");
  const diff = Number(data.difference || 0);

  const body =
    "<h1>Procès-verbal de comptage de caisse</h1>" +
    "<p class=\"muted\">Cash count sheet" + (data.doc_number ? " · " + esc(data.doc_number) : "") + "</p>" +
    "<table class=\"head\"><tbody>" +
    "<tr><td>Entité / Entity</td><td>" + esc(data.entity || "") + "</td></tr>" +
    "<tr><td>Caisse / Account</td><td>" + esc(data.account || "") + "</td></tr>" +
    "<tr><td>Date du comptage / Counted on</td><td>" + esc(data.counted_on || "") + "</td></tr>" +
    "</tbody></table>" +

    "<table><thead><tr><th class=\"num\">Coupure / Denomination</th><th class=\"num\">Quantité</th>" +
      "<th class=\"num\">Montant</th></tr></thead><tbody>" +
    (rows || "<tr><td colspan=\"3\">—</td></tr>") +
    "<tr class=\"tot\"><td colspan=\"2\">Total compté / Counted total</td>" +
      "<td class=\"num\">" + money(data.counted_total) + "</td></tr>" +
    "<tr><td colspan=\"2\">Solde comptable / Ledger balance</td>" +
      "<td class=\"num\">" + money(data.ledger_balance) + "</td></tr>" +
    "<tr class=\"" + (diff === 0 ? "tot" : "tot bad") + "\"><td colspan=\"2\">Écart / Difference</td>" +
      "<td class=\"num\">" + money(diff) + "</td></tr>" +
    "</tbody></table>" +
    (diff !== 0
      ? "<p><strong>Explication de l'écart / Variance explanation:</strong><br>" + esc(data.variance_reason || "") + "</p>"
      : "") +

    "<table class=\"sign\"><tbody><tr>" +
    "<td>Caissier / Custodian<br><br>" + esc(data.custodian || "") +
      (data.attested_at ? "<br><span class=\"muted\">" + esc(data.attested_at) + "</span>" : "") + "</td>" +
    "<td>Témoin / Witness<br><br>" + esc(data.witness || "—") + "</td>" +
    "</tr></tbody></table>" +
    (data.verify ? "<p class=\"muted\">Vérification / Verify: " + esc(data.verify) + "</p>" : "");

  return shell("Comptage de caisse " + (data.doc_number || ""), body);
}

module.exports = { buildInvoiceHtml, buildReconciliationHtml, buildCashCountHtml, shell, xaf, esc };

