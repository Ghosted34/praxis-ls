/**
 * Template registry (doc/DOCUMENT_TEMPLATES_PLAN.md §5). One entry per docType:
 *   { docType, title, module, build(data, cfg, entity, verify), sampleData, fields, load? }
 * `build` composes the kit into HTML; `sampleData` gives an empty tenant a preview;
 * `load(client, id)` fetches a real record (added per doc; invoice is the exemplar);
 * `fields` documents the doc-specific beautify knobs surfaced by the Studio.
 * Phase 1 = the six core finance/commercial documents.
 */
"use strict";

const k = require("./kit");

const has = (v) => v !== undefined && v !== null;

/* ── shared column sets ──────────────────────────────────────────────────── */
const LINE_COLS = [
  { key: "label", label: { fr: "Désignation", en: "Description" } },
  { key: "qty", label: { fr: "Qté", en: "Qty" }, num: true },
  { key: "unit", label: { fr: "P.U.", en: "Unit" }, num: true },
  { key: "tax", label: { fr: "TVA", en: "VAT" }, num: true },
  { key: "amount", label: { fr: "Montant HT", en: "Amount" }, num: true },
];

/** Format a raw line into display strings (money/qty). */
function fmtLines(lines = [], ccy) {
  return lines.map((l) => ({
    label: l.label,
    qty: has(l.qty) ? String(l.qty) : "",
    unit: has(l.unit) ? k.money(l.unit, ccy) : "",
    tax: has(l.tax) ? `${l.tax}%` : "",
    amount: k.money(has(l.amount) ? l.amount : (Number(l.qty || 1) * Number(l.unit || 0)), ccy),
  }));
}

/**
 * Shared builder for the line-item + totals family (invoice / proforma /
 * quotation / credit note). `opts`: { title, meta, totalsRows(data), notesLabel }.
 */
function lineDoc(opts) {
  return (data, cfg, entity, verify) => {
    const ccy = data.currency || "XAF";
    const body = [
      k.head(entity, opts.title, data.number, opts.meta(data), cfg),
      k.parties([
        { label: { fr: "Émetteur", en: "From" }, name: entity.legal_name, lines: [entity.address, entity.niu && `NIU ${entity.niu}`] },
        { label: opts.partyLabel || { fr: "Client", en: "Bill to" }, name: data.party && data.party.name, lines: (data.party && data.party.lines) || [] },
      ], cfg),
      k.lineTable(LINE_COLS, fmtLines(data.lines, ccy), cfg),
      k.totals(opts.totalsRows(data, ccy), cfg),
      cfg.show && cfg.show.notes && data.notes ? k.section({ fr: "Notes", en: "Notes" }, `<div class="box">${k.esc(data.notes).replace(/\n/g, "<br>")}</div>`, cfg) : "",
      cfg.show && cfg.show.bank ? k.bankBlock(entity, cfg) : "",
      k.termsBlock(cfg),
      k.signatureBlock(cfg),
      k.footer(entity, cfg, verify),
    ].join("");
    return k.shell(k.t(opts.title, cfg.language) + " " + (data.number || ""), body, cfg);
  };
}

/* ── sample data (shared shape) ──────────────────────────────────────────── */
const sampleParty = { name: "CIMENCAM SA", lines: ["Douala, Cameroun", "NIU P012345678", "contact@cimencam.cm"] };
const sampleLines = [
  { label: "Transit maritime — conteneur 40'", qty: 2, unit: 450000, tax: 19.25, amount: 900000 },
  { label: "Manutention portuaire", qty: 1, unit: 180000, tax: 19.25, amount: 180000 },
  { label: "Débours douane (avance)", qty: 1, unit: 320000, tax: 0, amount: 320000 },
];
const sampleTotals = { service_ht: 1080000, debours_total: 320000, vat_total: 207900, total_ttc: 1607900 };

/* ── the six templates ───────────────────────────────────────────────────── */
const TEMPLATES = {
  FINAL_INVOICE: {
    docType: "FINAL_INVOICE",
    title: { fr: "Facture", en: "Invoice" },
    module: "finance/final_invoice",
    fields: ["payment terms", "PAID watermark"],
    build: lineDoc({
      title: { fr: "Facture", en: "Invoice" },
      meta: (d) => [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Échéance", en: "Due" }, k.dateFmt(d.due)], [{ fr: "Dossier", en: "File" }, d.dossier_ref]],
      totalsRows: (d, ccy) => [
        [{ fr: "Total HT", en: "Subtotal" }, k.money(d.totals.service_ht, ccy)],
        [{ fr: "Débours", en: "Disbursements" }, k.money(d.totals.debours_total, ccy)],
        [{ fr: "TVA 19,25%", en: "VAT 19.25%" }, k.money(d.totals.vat_total, ccy)],
        [{ fr: "Total TTC", en: "Total" }, k.money(d.totals.total_ttc, ccy), { grand: true }],
      ],
    }),
    sampleData: { number: "FCT-2026-0001", date: "2026-07-27", due: "2026-08-26", dossier_ref: "SBX-2026-0001", party: sampleParty, lines: sampleLines, totals: sampleTotals, currency: "XAF" },
  },

  PROFORMA_ADVANCE: {
    docType: "PROFORMA_ADVANCE",
    title: { fr: "Facture proforma", en: "Proforma" },
    module: "finance/proforma",
    fields: ["validity note", "advance %"],
    build: lineDoc({
      title: { fr: "Facture proforma", en: "Proforma invoice" },
      meta: (d) => [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Valable jusqu'au", en: "Valid until" }, k.dateFmt(d.valid_until)], [{ fr: "Acompte", en: "Advance" }, has(d.advance_pct) ? `${d.advance_pct}%` : ""]],
      totalsRows: (d, ccy) => [
        [{ fr: "Total HT", en: "Subtotal" }, k.money(d.totals.service_ht, ccy)],
        [{ fr: "TVA 19,25%", en: "VAT 19.25%" }, k.money(d.totals.vat_total, ccy)],
        [{ fr: "Total TTC", en: "Total" }, k.money(d.totals.total_ttc, ccy), { grand: true }],
        has(d.advance_pct) ? [{ fr: `Acompte ${d.advance_pct}%`, en: `Advance ${d.advance_pct}%` }, k.money(d.totals.total_ttc * (d.advance_pct / 100), ccy)] : null,
      ],
    }),
    sampleData: { number: "PRO-2026-0007", date: "2026-07-27", valid_until: "2026-08-10", advance_pct: 40, party: sampleParty, lines: sampleLines, totals: sampleTotals, currency: "XAF" },
  },

  QUOTATION: {
    docType: "QUOTATION",
    title: { fr: "Devis", en: "Quotation" },
    module: "commercial/quotation",
    fields: ["accept / e-sign CTA"],
    build: lineDoc({
      title: { fr: "Devis", en: "Quotation" },
      partyLabel: { fr: "À l'attention de", en: "Prepared for" },
      meta: (d) => [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Valable jusqu'au", en: "Valid until" }, k.dateFmt(d.valid_until)]],
      totalsRows: (d, ccy) => [
        [{ fr: "Total HT", en: "Subtotal" }, k.money(d.totals.service_ht, ccy)],
        [{ fr: "TVA 19,25%", en: "VAT 19.25%" }, k.money(d.totals.vat_total, ccy)],
        [{ fr: "Total TTC", en: "Total" }, k.money(d.totals.total_ttc, ccy), { grand: true }],
      ],
    }),
    sampleData: { number: "DEV-2026-0042", date: "2026-07-27", valid_until: "2026-08-27", party: sampleParty, lines: sampleLines, totals: sampleTotals, currency: "XAF" },
  },

  CREDIT_NOTE: {
    docType: "CREDIT_NOTE",
    title: { fr: "Avoir", en: "Credit note" },
    module: "finance/credit_note",
    fields: ["reason", "red accent"],
    build: lineDoc({
      title: { fr: "Avoir", en: "Credit note" },
      meta: (d) => [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Facture d'origine", en: "Original invoice" }, d.original_ref], [{ fr: "Motif", en: "Reason" }, d.reason]],
      totalsRows: (d, ccy) => [
        [{ fr: "Total HT", en: "Subtotal" }, "-" + k.money(d.totals.service_ht, ccy)],
        [{ fr: "TVA 19,25%", en: "VAT 19.25%" }, "-" + k.money(d.totals.vat_total, ccy)],
        [{ fr: "Total avoir TTC", en: "Credit total" }, "-" + k.money(d.totals.total_ttc, ccy), { grand: true }],
      ],
    }),
    sampleData: { number: "AVR-2026-0003", date: "2026-07-27", original_ref: "FCT-2026-0001", reason: "Remise commerciale", party: sampleParty, lines: [sampleLines[0]], totals: { service_ht: 900000, vat_total: 173250, total_ttc: 1073250 }, currency: "XAF" },
  },

  PAYMENT_RECEIPT: {
    docType: "PAYMENT_RECEIPT",
    title: { fr: "Reçu de paiement", en: "Payment receipt" },
    module: "finance/smart_receivables",
    fields: ["PAID stamp (default watermark)"],
    build: (data, cfg, entity, verify) => {
      const ccy = data.currency || "XAF";
      const c = { ...cfg, watermark: cfg.watermark || "PAID" };
      const body = [
        k.head(entity, { fr: "Reçu de paiement", en: "Payment receipt" }, data.number, [[{ fr: "Date", en: "Date" }, k.dateFmt(data.date)], [{ fr: "Mode", en: "Method" }, data.method]], c),
        k.parties([{ label: { fr: "Reçu de", en: "Received from" }, name: data.party && data.party.name, lines: (data.party && data.party.lines) || [] }], c),
        k.section({ fr: "Montant reçu", en: "Amount received" }, `<div class="box" style="font-size:22px;font-weight:700">${k.money(data.amount, ccy)}</div>`, c),
        data.invoice_ref ? k.section({ fr: "Imputation", en: "Applied to" }, `<div class="box">${k.esc(data.invoice_ref)}</div>`, c) : "",
        k.signatureBlock(c),
        k.footer(entity, c, verify),
      ].join("");
      return k.shell("Receipt " + (data.number || ""), body, c);
    },
    sampleData: { number: "REC-2026-0021", date: "2026-07-27", method: "Virement / Bank transfer", amount: 1607900, invoice_ref: "FCT-2026-0001", party: sampleParty, currency: "XAF" },
  },

  PROPOSAL: {
    docType: "PROPOSAL",
    title: { fr: "Proposition", en: "Proposal" },
    module: "sales/proposal",
    fields: ["cover image", "sections"],
    build: (data, cfg, entity, verify) => {
      const ccy = data.currency || "XAF";
      const secs = (data.sections || []).map((s) => k.section({ fr: s.title, en: s.title }, `<div class="box">${k.esc(s.body).replace(/\n/g, "<br>")}</div>`, cfg)).join("");
      const body = [
        k.head(entity, { fr: "Proposition commerciale", en: "Proposal" }, data.number, [[{ fr: "Date", en: "Date" }, k.dateFmt(data.date)], [{ fr: "Client", en: "Client" }, data.party && data.party.name]], cfg),
        `<h1 style="margin-top:18px">${k.esc(data.headline || "")}</h1>`,
        secs,
        data.lines && data.lines.length ? k.section({ fr: "Tarification", en: "Pricing" }, k.lineTable(LINE_COLS, fmtLines(data.lines, ccy), cfg), cfg) : "",
        data.totals ? k.totals([[{ fr: "Total TTC", en: "Total" }, k.money(data.totals.total_ttc, ccy), { grand: true }]], cfg) : "",
        k.termsBlock(cfg),
        k.signatureBlock(cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Proposal " + (data.number || ""), body, cfg);
    },
    sampleData: {
      number: "PROP-2026-0009", date: "2026-07-27", headline: "Solution logistique de bout en bout", party: sampleParty,
      sections: [{ title: "Contexte / Context", body: "Gestion intégrée du transit maritime, dédouanement et livraison finale." }, { title: "Approche / Approach", body: "Une équipe dédiée, un suivi temps réel, et une facturation transparente." }],
      lines: sampleLines, totals: sampleTotals, currency: "XAF",
    },
  },

  /* ── Phase 2 — operations & procurement ──────────────────────────────────── */
  PURCHASE_ORDER: {
    docType: "PURCHASE_ORDER", title: { fr: "Bon de commande", en: "Purchase order" }, module: "procurement/purchase_order", fields: ["supplier terms", "delivery address"],
    build: lineDoc({
      title: { fr: "Bon de commande", en: "Purchase order" }, partyLabel: { fr: "Fournisseur", en: "Supplier" },
      meta: (d) => [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Livraison", en: "Delivery" }, k.dateFmt(d.delivery_on)]],
      totalsRows: (d, ccy) => [
        [{ fr: "Total HT", en: "Subtotal" }, k.money(d.totals.service_ht, ccy)],
        [{ fr: "TVA 19,25%", en: "VAT 19.25%" }, k.money(d.totals.vat_total, ccy)],
        [{ fr: "Total TTC", en: "Total" }, k.money(d.totals.total_ttc, ccy), { grand: true }],
      ],
    }),
    sampleData: { number: "BC-2026-0031", date: "2026-07-27", delivery_on: "2026-08-05", party: { name: "Établissements TENOR", lines: ["Douala, Cameroun"] }, lines: sampleLines.slice(0, 2), totals: { service_ht: 1080000, vat_total: 207900, total_ttc: 1287900 }, currency: "XAF" },
  },

  SUPPLIER_INVOICE: {
    docType: "SUPPLIER_INVOICE", title: { fr: "Facture fournisseur", en: "Supplier invoice" }, module: "procurement/supplier_invoice", fields: ["COPY watermark"],
    build: (data, cfg, entity, verify) => lineDoc({
      title: { fr: "Facture fournisseur", en: "Supplier invoice" }, partyLabel: { fr: "Fournisseur", en: "Supplier" },
      meta: (d) => [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "N° fournisseur", en: "Supplier ref" }, d.supplier_ref]],
      totalsRows: (d, ccy) => [
        [{ fr: "Total HT", en: "Subtotal" }, k.money(d.totals.service_ht, ccy)],
        [{ fr: "TVA", en: "VAT" }, k.money(d.totals.vat_total, ccy)],
        [{ fr: "Total TTC", en: "Total" }, k.money(d.totals.total_ttc, ccy), { grand: true }],
      ],
    })(data, { ...cfg, watermark: cfg.watermark || "COPY" }, entity, verify),
    sampleData: { number: "FF-2026-0088", date: "2026-07-27", supplier_ref: "INV-9921", party: { name: "SDV Cameroun", lines: ["Douala"] }, lines: sampleLines.slice(0, 2), totals: { service_ht: 1080000, vat_total: 207900, total_ttc: 1287900 }, currency: "XAF" },
  },

  PURCHASE_REQUEST: {
    docType: "PURCHASE_REQUEST", title: { fr: "Demande d'achat", en: "Purchase request" }, module: "procurement/purchase_request", fields: ["approver signatures"],
    build: lineDoc({
      title: { fr: "Demande d'achat", en: "Purchase request" }, partyLabel: { fr: "Demandeur", en: "Requested by" },
      meta: (d) => [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Service", en: "Department" }, d.department]],
      totalsRows: (d, ccy) => [[{ fr: "Total estimé", en: "Estimated total" }, k.money(d.totals.total_ttc, ccy), { grand: true }]],
    }),
    sampleData: { number: "DA-2026-0014", date: "2026-07-27", department: "Opérations", party: { name: "Jean Mballa", lines: ["Chef de quai"] }, lines: sampleLines.slice(0, 2), totals: { total_ttc: 1080000 }, currency: "XAF" },
  },

  DELIVERY_NOTE: {
    docType: "DELIVERY_NOTE", title: { fr: "Bon de livraison", en: "Delivery note" }, module: "operations/delivery_note", fields: ["hide prices toggle"],
    build: (data, cfg, entity, verify) => {
      const cols = [{ key: "label", label: { fr: "Désignation", en: "Description" } }, { key: "qty", label: { fr: "Quantité", en: "Quantity" }, num: true }];
      const rows = (data.lines || []).map((l) => ({ label: l.label, qty: String(l.qty) }));
      const body = [
        k.head(entity, { fr: "Bon de livraison", en: "Delivery note" }, data.number, [[{ fr: "Date", en: "Date" }, k.dateFmt(data.date)], [{ fr: "Dossier", en: "File" }, data.dossier_ref]], cfg),
        k.parties([{ label: { fr: "Destinataire", en: "Consignee" }, name: data.party && data.party.name, lines: (data.party && data.party.lines) || [] }], cfg),
        k.lineTable(cols, rows, cfg),
        k.signatureBlock(cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Delivery note " + (data.number || ""), body, cfg);
    },
    sampleData: { number: "BL-2026-0052", date: "2026-07-27", dossier_ref: "SBX-2026-0001", party: sampleParty, lines: [{ label: "Conteneur 40' TCLU1234567", qty: 1 }, { label: "Palettes ciment", qty: 24 }], currency: "XAF" },
  },

  TRANSIT_ORDER: {
    docType: "TRANSIT_ORDER", title: { fr: "Ordre de transit", en: "Transit order" }, module: "operations/transit_order", fields: ["carrier block", "route"],
    build: (data, cfg, entity, verify) => {
      const cols = [{ key: "label", label: { fr: "Marchandise", en: "Cargo" } }, { key: "qty", label: { fr: "Colis", en: "Packages" }, num: true }, { key: "weight", label: { fr: "Poids", en: "Weight" }, num: true }];
      const body = [
        k.head(entity, { fr: "Ordre de transit", en: "Transit order" }, data.number, [[{ fr: "Date", en: "Date" }, k.dateFmt(data.date)], [{ fr: "Mode", en: "Mode" }, data.mode]], cfg),
        k.parties([
          { label: { fr: "Transporteur", en: "Carrier" }, name: data.carrier, lines: [data.carrier_ref] },
          { label: { fr: "Itinéraire", en: "Route" }, name: `${data.origin || ""} → ${data.destination || ""}`, lines: [] },
        ], cfg),
        k.lineTable(cols, data.lines || [], cfg),
        k.signatureBlock(cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Transit order " + (data.number || ""), body, cfg);
    },
    sampleData: { number: "OT-2026-0019", date: "2026-07-27", mode: "Route / Road", carrier: "Translog SARL", carrier_ref: "Camion LT-4471", origin: "Port de Douala", destination: "Yaoundé", lines: [{ label: "Ciment CIMENCAM", qty: "24", weight: "48 t" }], currency: "XAF" },
  },

  CASH_REQUEST: {
    docType: "CASH_REQUEST", title: { fr: "Demande de fonds", en: "Cash request" }, module: "costing/cash_request", fields: ["approval chain"],
    build: (data, cfg, entity, verify) => {
      const body = [
        k.head(entity, { fr: "Demande de fonds", en: "Cash request" }, data.number, [[{ fr: "Date", en: "Date" }, k.dateFmt(data.date)], [{ fr: "Dossier", en: "File" }, data.dossier_ref]], cfg),
        k.parties([{ label: { fr: "Demandeur", en: "Requested by" }, name: data.party && data.party.name, lines: (data.party && data.party.lines) || [] }], cfg),
        k.section({ fr: "Montant demandé", en: "Amount requested" }, `<div class="box" style="font-size:20px;font-weight:700">${k.money(data.amount, data.currency || "XAF")}</div>`, cfg),
        data.purpose ? k.section({ fr: "Objet", en: "Purpose" }, `<div class="box">${k.esc(data.purpose)}</div>`, cfg) : "",
        k.signatureBlock(cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Cash request " + (data.number || ""), body, cfg);
    },
    sampleData: { number: "DF-2026-0007", date: "2026-07-27", dossier_ref: "SBX-2026-0001", amount: 500000, purpose: "Frais de dédouanement et manutention", party: { name: "Jean Mballa", lines: ["Opérations"] }, currency: "XAF" },
  },

  REGIE_ADVANCE: {
    docType: "REGIE_ADVANCE", title: { fr: "Régie d'avances", en: "Cash advance (régie)" }, module: "costing/regie", fields: ["float ledger"],
    build: (data, cfg, entity, verify) => {
      const body = [
        k.head(entity, { fr: "Régie d'avances", en: "Cash advance" }, data.number, [[{ fr: "Date", en: "Date" }, k.dateFmt(data.date)]], cfg),
        k.parties([{ label: { fr: "Régisseur", en: "Float holder" }, name: data.party && data.party.name, lines: (data.party && data.party.lines) || [] }], cfg),
        k.section({ fr: "Montant de l'avance", en: "Advance amount" }, `<div class="box" style="font-size:20px;font-weight:700">${k.money(data.amount, data.currency || "XAF")}</div>`, cfg),
        data.purpose ? k.section({ fr: "Objet", en: "Purpose" }, `<div class="box">${k.esc(data.purpose)}</div>`, cfg) : "",
        k.signatureBlock(cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Régie " + (data.number || ""), body, cfg);
    },
    sampleData: { number: "RG-2026-0004", date: "2026-07-27", amount: 1000000, purpose: "Menues dépenses de quai", party: { name: "Alice Ngo", lines: ["Caisse Douala"] }, currency: "XAF" },
  },

  /* ── Phase 4 — HR & remaining operational documents ──────────────────────── */
  PAYSLIP: {
    docType: "PAYSLIP", title: { fr: "Bulletin de paie", en: "Payslip" }, module: "hr/payroll", fields: ["statutory breakdown"],
    build: (d, cfg, entity, verify) => {
      const ccy = d.currency || "XAF";
      const col = [{ key: "label", label: { fr: "Libellé", en: "Item" } }, { key: "amount", label: { fr: "Montant", en: "Amount" }, num: true }];
      const map = (arr) => (arr || []).map((e) => ({ label: e.label, amount: k.money(e.amount, ccy) }));
      const body = [
        k.head(entity, { fr: "Bulletin de paie", en: "Payslip" }, d.number, [[{ fr: "Période", en: "Period" }, d.period], [{ fr: "Matricule", en: "Staff no." }, d.staff_no]], cfg),
        k.parties([{ label: { fr: "Salarié", en: "Employee" }, name: d.employee_name, lines: [d.job_title, d.cnps_number && `CNPS ${d.cnps_number}`].filter(Boolean) }], cfg),
        k.section({ fr: "Gains", en: "Earnings" }, k.lineTable(col, map(d.earnings), cfg), cfg),
        k.section({ fr: "Retenues", en: "Deductions" }, k.lineTable(col, map(d.deductions), cfg), cfg),
        k.totals([
          [{ fr: "Salaire brut", en: "Gross" }, k.money(d.gross, ccy)],
          [{ fr: "Total retenues", en: "Total deductions" }, k.money(d.total_deductions, ccy)],
          [{ fr: "Net à payer", en: "Net pay" }, k.money(d.net, ccy), { grand: true }],
        ], cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Payslip " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "BP-2026-07-014", period: "Juillet 2026", staff_no: "EMP-014", employee_name: "Jean Mballa", job_title: "Chef de quai", cnps_number: "CM-88231", earnings: [{ label: "Salaire de base", amount: 750000 }, { label: "Prime de rendement", amount: 100000 }], deductions: [{ label: "CNPS pension (4,2%)", amount: 31500 }, { label: "IRPP", amount: 62000 }, { label: "CAC (10% IRPP)", amount: 6200 }, { label: "CFC (1%)", amount: 8500 }], gross: 850000, total_deductions: 108200, net: 741800, currency: "XAF" },
  },

  EMPLOYMENT_CONTRACT: {
    docType: "EMPLOYMENT_CONTRACT", title: { fr: "Contrat de travail", en: "Employment contract" }, module: "hr/hr_contract", fields: ["clauses", "replace-with-signed"],
    build: (d, cfg, entity, verify) => {
      const arts = (d.articles || []).map((a, i) => k.section({ fr: `Article ${i + 1} — ${a.title}`, en: `Article ${i + 1} — ${a.title}` }, `<div class="box">${k.esc(a.body).replace(/\n/g, "<br>")}</div>`, cfg)).join("");
      const body = [
        k.head(entity, { fr: "Contrat de travail", en: "Employment contract" }, d.number, [[{ fr: "Type", en: "Type" }, d.kind], [{ fr: "Date d'effet", en: "Effective" }, k.dateFmt(d.effective_on)]], cfg),
        k.parties([
          { label: { fr: "Employeur", en: "Employer" }, name: entity.legal_name, lines: [entity.address, entity.rccm && `RCCM ${entity.rccm}`].filter(Boolean) },
          { label: { fr: "Salarié", en: "Employee" }, name: d.employee_name, lines: [d.job_title].filter(Boolean) },
        ], cfg),
        arts,
        k.signatureBlock({ ...cfg, show: { ...cfg.show, signature: true } }),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Contract " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "CT-2026-0007", kind: "CDI", effective_on: "2026-08-01", employee_name: "Jean Mballa", job_title: "Chef de quai", articles: [{ title: "Fonctions / Duties", body: "Le salarié est engagé en qualité de Chef de quai et exercera ses fonctions au port de Douala." }, { title: "Rémunération / Pay", body: "Le salaire brut mensuel est fixé à 850 000 XAF, payable en fin de mois." }, { title: "Durée / Term", body: "Le présent contrat est conclu pour une durée indéterminée (CDI)." }], currency: "XAF" },
  },

  GRN: {
    docType: "GRN", title: { fr: "Bon de réception", en: "Goods-received note" }, module: "wms/inbound", fields: ["QA sign-off"],
    build: (d, cfg, entity, verify) => {
      const col = [{ key: "item", label: { fr: "Article", en: "Item" } }, { key: "ordered", label: { fr: "Commandé", en: "Ordered" }, num: true }, { key: "received", label: { fr: "Reçu", en: "Received" }, num: true }, { key: "condition", label: { fr: "État", en: "Condition" } }];
      const body = [
        k.head(entity, { fr: "Bon de réception", en: "Goods-received note" }, d.number, [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Réf. commande", en: "PO ref" }, d.po_ref], [{ fr: "Contrôle QA", en: "QA" }, d.qa_status]], cfg),
        k.parties([{ label: { fr: "Fournisseur", en: "Supplier" }, name: d.supplier, lines: [] }], cfg),
        k.lineTable(col, d.lines || [], cfg),
        k.signatureBlock(cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("GRN " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "BR-2026-0044", date: "2026-07-27", po_ref: "BC-2026-0031", qa_status: "Conforme / Passed", supplier: "SDV Cameroun", lines: [{ item: "Ciment 50kg", ordered: "500", received: "500", condition: "Bon" }, { item: "Palettes bois", ordered: "24", received: "22", condition: "2 endommagées" }], currency: "XAF" },
  },

  TRIP_SHEET: {
    docType: "TRIP_SHEET", title: { fr: "Feuille de route", en: "Trip sheet" }, module: "fleet/dispatch", fields: ["odometer out/in"],
    build: (d, cfg, entity, verify) => {
      const body = [
        k.head(entity, { fr: "Feuille de route", en: "Trip sheet" }, d.number, [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)]], cfg),
        k.parties([{ label: { fr: "Véhicule", en: "Vehicle" }, name: d.vehicle, lines: [] }, { label: { fr: "Chauffeur", en: "Driver" }, name: d.driver, lines: [] }], cfg),
        k.section({ fr: "Itinéraire", en: "Route" }, `<div class="box">${k.esc(d.origin || "")} → ${k.esc(d.destination || "")}</div>`, cfg),
        k.totals([
          [{ fr: "Km départ", en: "Odometer out" }, String(d.odometer_out ?? "")],
          [{ fr: "Km retour", en: "Odometer in" }, String(d.odometer_in ?? "")],
          [{ fr: "Distance", en: "Distance" }, d.distance === null || d.distance === undefined ? "" : `${d.distance} km`, { grand: true }],
        ], cfg),
        k.signatureBlock(cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Trip sheet " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "FR-2026-0033", date: "2026-07-27", vehicle: "LT-4471", driver: "Paul Ekambi", origin: "Port de Douala", destination: "Yaoundé", odometer_out: 128450, odometer_in: 128712, distance: 262, currency: "XAF" },
  },

  WORK_ORDER: {
    docType: "WORK_ORDER", title: { fr: "Ordre de réparation", en: "Work order" }, module: "fleet/work-orders", fields: ["parts & labour"],
    build: (d, cfg, entity, verify) => {
      const ccy = d.currency || "XAF";
      const col = [{ key: "label", label: { fr: "Pièce / Main d'œuvre", en: "Part / labour" } }, { key: "qty", label: { fr: "Qté", en: "Qty" }, num: true }, { key: "unit", label: { fr: "P.U.", en: "Unit" }, num: true }, { key: "total", label: { fr: "Total", en: "Total" }, num: true }];
      const rows = (d.parts || []).map((p) => ({ label: p.label, qty: String(p.qty), unit: k.money(p.unit_cost, ccy), total: k.money(Number(p.qty) * Number(p.unit_cost), ccy) }));
      const body = [
        k.head(entity, { fr: "Ordre de réparation", en: "Work order" }, d.number, [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Statut", en: "Status" }, d.status]], cfg),
        k.parties([{ label: { fr: "Véhicule", en: "Vehicle" }, name: d.vehicle, lines: [d.description].filter(Boolean) }], cfg),
        k.lineTable(col, rows, cfg),
        k.totals([[{ fr: "Coût total", en: "Total cost" }, k.money(d.cost, ccy), { grand: true }]], cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Work order " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "OR-2026-0021", date: "2026-07-27", status: "Terminé / Done", vehicle: "LT-4471", description: "Révision 20 000 km", parts: [{ label: "Plaquettes de frein", qty: 1, unit_cost: 45000 }, { label: "Main d'œuvre (2h)", qty: 2, unit_cost: 15000 }], cost: 75000, currency: "XAF" },
  },

  CYCLE_COUNT_SHEET: {
    docType: "CYCLE_COUNT_SHEET", title: { fr: "Feuille d'inventaire", en: "Cycle-count sheet" }, module: "wms/cycle-count", fields: ["variance"],
    build: (d, cfg, entity, verify) => {
      const col = [{ key: "item", label: { fr: "Article", en: "Item" } }, { key: "expected", label: { fr: "Théorique", en: "Expected" }, num: true }, { key: "counted", label: { fr: "Compté", en: "Counted" }, num: true }, { key: "variance", label: { fr: "Écart", en: "Variance" }, num: true }];
      const body = [
        k.head(entity, { fr: "Feuille d'inventaire", en: "Cycle-count sheet" }, d.number, [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Emplacement", en: "Location" }, d.location]], cfg),
        k.lineTable(col, (d.lines || []).map((l) => ({ item: l.item, expected: String(l.expected), counted: String(l.counted), variance: String(l.counted - l.expected) })), cfg),
        k.signatureBlock(cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Count sheet " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "INV-2026-0009", date: "2026-07-27", location: "Zone A · Allée 3", lines: [{ item: "Ciment 50kg", expected: 500, counted: 498 }, { item: "Palettes", expected: 40, counted: 40 }], currency: "XAF" },
  },

  DUNNING_LETTER: {
    docType: "DUNNING_LETTER", title: { fr: "Lettre de relance", en: "Dunning letter" }, module: "finance/smart_receivables", fields: ["tone by ageing"],
    build: (d, cfg, entity, verify) => {
      const ccy = d.currency || "XAF";
      const col = [{ key: "invoice", label: { fr: "Facture", en: "Invoice" } }, { key: "date", label: { fr: "Date", en: "Date" } }, { key: "days", label: { fr: "Retard (j)", en: "Days late" }, num: true }, { key: "amount", label: { fr: "Montant", en: "Amount" }, num: true }];
      const rows = (d.invoices || []).map((i) => ({ invoice: i.ref, date: k.dateFmt(i.date), days: String(i.days_late), amount: k.money(i.amount, ccy) }));
      const body = [
        k.head(entity, { fr: "Lettre de relance", en: "Dunning letter" }, d.number, [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)]], cfg),
        k.parties([{ label: { fr: "À l'attention de", en: "To" }, name: d.client, lines: d.client_lines || [] }], cfg),
        `<p style="margin:14px 2px">${k.esc(d.body || "")}</p>`,
        k.lineTable(col, rows, cfg),
        k.totals([[{ fr: "Total dû", en: "Total due" }, k.money(d.total, ccy), { grand: true }]], cfg),
        k.signatureBlock(cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Dunning " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "REL-2026-0011", date: "2026-07-27", client: "CIMENCAM SA", client_lines: ["Douala, Cameroun"], body: "Sauf erreur de notre part, les factures ci-dessous demeurent impayées à ce jour. Nous vous prions de bien vouloir procéder à leur règlement dans les meilleurs délais.", invoices: [{ ref: "FCT-2026-0001", date: "2026-06-15", days_late: 42, amount: 1607900 }], total: 1607900, currency: "XAF" },
  },

  COMMS_CERTIFIED_EXPORT: {
    docType: "COMMS_CERTIFIED_EXPORT", title: { fr: "Export certifié", en: "Certified export" }, module: "smartcomm", fields: ["chain-of-custody"],
    build: (d, cfg, entity, verify) => {
      const msgs = (d.messages || []).map((m) => `<div class="box" style="margin-bottom:6px"><div class="micro">${k.esc(m.at)} · ${k.esc(m.author)}</div><div>${k.esc(m.text)}</div></div>`).join("");
      const body = [
        k.head(entity, { fr: "Export certifié de conversation", en: "Certified conversation export" }, d.number, [[{ fr: "Canal", en: "Channel" }, d.channel], [{ fr: "Période", en: "Period" }, d.period]], cfg),
        k.section({ fr: "Chaîne de possession", en: "Chain of custody" }, `<div class="box">${k.t({ fr: "Empreinte", en: "Hash" }, cfg.language)}: ${k.esc(d.hash || "—")}</div>`, cfg),
        k.section({ fr: "Messages", en: "Messages" }, msgs || `<div class="muted">—</div>`, cfg),
        k.footer(entity, cfg, verify),
      ].join("");
      return k.shell("Certified export " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "EXP-2026-0003", channel: "WhatsApp — CIMENCAM", period: "2026-07", hash: "a1b2c3d4e5f6a7b8", messages: [{ at: "2026-07-20 10:12", author: "Agent", text: "Bonjour, votre conteneur est arrivé au port." }, { at: "2026-07-20 10:15", author: "Client", text: "Merci, quand pouvons-nous le récupérer ?" }], currency: "XAF" },
  },
};

/* ── Phase 3 — statements, reports & tax filings ─────────────────────────────
 * Reports are data-shaped (not record-based). A generic renderer turns any
 * producer output into a branded, legible statement: arrays → tables, nested
 * objects → sections, scalars → a key/value summary. High-value statements can
 * get bespoke layouts later; this makes every report brand-uniform now. RBAC
 * masking is already applied by the producers before the data reaches here. */
const humanize = (s) => String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const isNum = (v) => typeof v === "number";

function arrayTable(arr, cfg) {
  if (!Array.isArray(arr) || !arr.length) return `<div class="muted">—</div>`;
  const keys = Object.keys(arr[0]);
  const cols = keys.map((kk) => ({ key: kk, label: humanize(kk), num: isNum(arr[0][kk]) }));
  const rows = arr.map((r) => { const o = {}; for (const kk of keys) o[kk] = isNum(r[kk]) ? k.xaf(r[kk]) : String(r[kk] === undefined || r[kk] === null ? "" : r[kk]); return o; });
  return k.lineTable(cols, rows, cfg);
}
function kvBox(pairs) {
  return `<table class="totals" style="width:360px;margin-left:0">${pairs.map((p) => `<tr><td class="muted">${k.esc(p[0])}</td><td class="num">${k.esc(p[1])}</td></tr>`).join("")}</table>`;
}
function autoBlocks(data, cfg) {
  if (Array.isArray(data)) return arrayTable(data, cfg);
  if (data && typeof data === "object") {
    const out = [];
    const scalars = [];
    for (const [key, val] of Object.entries(data)) {
      if (val === null || val === undefined || key === "period") continue;
      if (Array.isArray(val)) out.push(k.section(humanize(key), arrayTable(val, cfg), cfg));
      else if (typeof val === "object") out.push(k.section(humanize(key), autoBlocks(val, cfg), cfg));
      else scalars.push([humanize(key), isNum(val) ? k.xaf(val) : String(val)]);
    }
    if (scalars.length) out.unshift(kvBox(scalars));
    return out.join("");
  }
  return `<div class="box">${k.esc(String(data))}</div>`;
}
function reportBuild(title) {
  return (data, cfg, entity, verify) => {
    const p = data && data.period;
    const periodStr = p ? (typeof p === "object" ? (p.period_code || p.from || p.as_of || "") : p) : "";
    const meta = [[{ fr: "Édité le", en: "Generated" }, k.dateFmt(new Date())], periodStr ? [{ fr: "Période", en: "Period" }, periodStr] : null].filter(Boolean);
    const body = [k.head(entity, title, "", meta, cfg), autoBlocks(data, cfg), k.footer(entity, cfg, verify)].join("");
    return k.shell(k.t(title, cfg.language), body, cfg);
  };
}

// [docType, title, module, sampleData]
const REPORT_SPECS = [
  ["income_statement", { fr: "Compte de résultat", en: "Income statement" }, "vault/report", { period: { period_code: "2026-07" }, produits: [{ compte: "70 Ventes", montant: 18500000 }, { compte: "75 Autres produits", montant: 900000 }], charges: [{ compte: "60 Achats", montant: 6200000 }, { compte: "64 Charges de personnel", montant: 4100000 }], result: 9100000 }],
  ["balance_sheet", { fr: "Bilan", en: "Balance sheet" }, "vault/report", { period: { as_of: "2026-07-31" }, actif: [{ poste: "Immobilisations", montant: 12000000 }, { poste: "Créances clients", montant: 4600000 }, { poste: "Trésorerie", montant: 5200000 }], passif: [{ poste: "Capital", montant: 10000000 }, { poste: "Résultat", montant: 9100000 }, { poste: "Dettes fournisseurs", montant: 2700000 }] }],
  ["trial_balance", { fr: "Balance générale", en: "Trial balance" }, "vault/report", { period: { period_code: "2026-07" }, rows: [{ account: "411 Clients", debit: 4600000, credit: 0 }, { account: "401 Fournisseurs", debit: 0, credit: 2700000 }, { account: "70 Ventes", debit: 0, credit: 18500000 }], totals: { debit: 23100000, credit: 23100000 } }],
  ["cash_flow", { fr: "Flux de trésorerie (TAFIRE)", en: "Cash flow (TAFIRE)" }, "vault/report", { period: { period_code: "2026-07" }, exploitation: 7200000, investissement: -3000000, financement: 1000000, variation_tresorerie: 5200000 }],
  ["receivables_ageing", { fr: "Balance âgée clients", en: "Receivables ageing" }, "vault/report", { period: { as_of: "2026-07-31" }, buckets: [{ tranche: "Courant", montant: 2100000 }, { tranche: "1–30 j", montant: 900000 }, { tranche: "31–60 j", montant: 600000 }, { tranche: "60+ j", montant: 1000000 }], total: 4600000 }],
  ["receivables_reminders", { fr: "Relances clients", en: "Dunning list" }, "vault/report", { period: { as_of: "2026-07-31" }, rows: [{ client: "CIMENCAM", facture: "FCT-2026-0001", jours_retard: 42, montant: 1607900 }] }],
  ["dossier_360", { fr: "Dossier 360°", en: "Dossier 360" }, "vault/report", { reference: "SBX-2026-0001", client: "CIMENCAM", statut: "En cours", marge: 620000, jalons: [{ jalon: "Arrivée navire", statut: "Fait" }, { jalon: "Dédouanement", statut: "En cours" }] }],
  ["cash_position", { fr: "Position de trésorerie", en: "Cash position" }, "vault/report", { period: { as_of: "2026-07-31" }, comptes: [{ compte: "Banque Afriland", solde: 4200000 }, { compte: "Mobile money", solde: 300000 }, { compte: "Caisse", solde: 700000 }], total: 5200000 }],
  ["procurement_spend", { fr: "Dépenses achats", en: "Procurement spend" }, "vault/report", { period: { period_code: "2026-07" }, rows: [{ fournisseur: "SDV Cameroun", commandes: 3, montant: 3200000 }, { fournisseur: "TENOR", commandes: 1, montant: 900000 }], total: 4100000 }],
  ["dossier_margin_portfolio", { fr: "Portefeuille des marges", en: "Margin portfolio" }, "vault/report", { period: { period_code: "2026-07" }, rows: [{ dossier: "SBX-2026-0001", facture: 1607900, cout: 987900, marge: 620000, taux: "38%" }] }],
];
const TAX_SPECS = [
  ["VAT_RETURN", { fr: "Déclaration TVA", en: "VAT return" }, "finance/tax_declaration", { period: { period_code: "2026-07" }, tva_collectee: 3560000, tva_deductible: 1193000, net_a_payer: 2367000 }],
  ["DSF", { fr: "Déclaration Statistique et Fiscale", en: "DSF" }, "finance/tax_declaration", { period: { period_code: "2026" }, chiffre_affaires: 19400000, resultat: 9100000, impot_societes: 2502500 }],
  ["CNPS_DECLARATION", { fr: "Déclaration CNPS (DIPE)", en: "CNPS declaration" }, "finance/tax_declaration", {
    period: { period_code: "2026-07" },
    rows: [
      { cnps_number: "CM-88231", employee_name: "Jean Mballa", gross: 850000, cnps_base: 750000, employee_pension: 31500, employer_pension: 31500, employer_family: 52500, employer_injury: 13125 },
      { cnps_number: "CM-90114", employee_name: "Alice Ngo", gross: 620000, cnps_base: 620000, employee_pension: 26040, employer_pension: 26040, employer_family: 43400, employer_injury: 10850 },
    ],
    totals: { gross: 1470000, cnps_base: 1370000, employee_pension: 57540, employer_pension: 57540, employer_family: 95900, employer_injury: 23975, total: 234955 },
  }],
];
for (const [docType, title, moduleHint, sampleData] of [...REPORT_SPECS, ...TAX_SPECS]) {
  TEMPLATES[docType] = { docType, title, module: moduleHint, report: true, fields: ["branded statement"], build: reportBuild(title), sampleData };
}

/* ── Bespoke statutory forms (faithful Cameroon structure; refine to pixel-exact
 * against the DGI/CNPS master PDFs when available). They read both the live
 * producer output and the bundled sample via field fallbacks. ──────────────── */
const firstNum = (...xs) => { for (const x of xs) if (x !== undefined && x !== null) return Number(x); return 0; };
function formTable(rows, cfg) {
  return `<table class="items" style="max-width:560px"><tbody>${rows.map((r) => `<tr${r[2] ? ` style="background:${cfg.accent || "#F5821F"}0d"` : ""}><td${r[2] ? ' style="font-weight:700"' : ""}>${k.esc(r[0])}</td><td class="num"${r[2] ? ' style="font-weight:700"' : ""}>${k.xaf(r[1])}</td></tr>`).join("")}</tbody></table>`;
}

function vatReturnBuild(data, cfg, entity, verify) {
  const collected = firstNum(data.output_vat, data.tva_collectee);
  const deductible = firstNum(data.input_vat, data.tva_deductible);
  const net = data.net !== undefined ? Number(data.net) : (data.net_a_payer !== undefined ? Number(data.net_a_payer) : collected - deductible);
  const due = data.vat_due !== undefined ? Number(data.vat_due) : firstNum(data.net_a_payer, Math.max(net, 0));
  const credit = data.vat_credit !== undefined ? Number(data.vat_credit) : Math.max(-net, 0);
  const period = data.period && (data.period.period_code || data.period.from || "");
  const meta = [[{ fr: "Régime", en: "Regime" }, "Réel / Actual"], period ? [{ fr: "Période", en: "Period" }, period] : null, entity.niu ? [{ fr: "NIU", en: "Tax ID" }, entity.niu] : null].filter(Boolean);
  const body = [
    k.head(entity, { fr: "Déclaration de TVA", en: "VAT return" }, "", meta, cfg),
    k.section({ fr: "Taux", en: "Rate" }, `<div class="box">TVA 19,25% — droit commun / standard rate</div>`, cfg),
    k.section({ fr: "Liquidation", en: "Computation" }, formTable([
      [k.t({ fr: "TVA collectée (aval)", en: "Output VAT (collected)" }, cfg.language), collected],
      [k.t({ fr: "TVA déductible (amont)", en: "Input VAT (deductible)" }, cfg.language), deductible],
      [k.t({ fr: "TVA nette", en: "Net VAT" }, cfg.language), net],
      [k.t({ fr: "TVA à payer", en: "VAT due" }, cfg.language), due, true],
      [k.t({ fr: "Crédit à reporter", en: "Credit carried forward" }, cfg.language), credit],
    ], cfg), cfg),
    k.footer(entity, cfg, verify),
  ].join("");
  return k.shell("VAT return", body, cfg);
}

function cnpsBuild(data, cfg, entity, verify) {
  const totals = data.totals || {};
  const rows = data.rows || [];
  const cols = [
    { key: "cnps_number", label: { fr: "Matricule", en: "CNPS no." } },
    { key: "employee_name", label: { fr: "Nom", en: "Name" } },
    { key: "gross", label: { fr: "Salaire brut", en: "Gross" }, num: true },
    { key: "cnps_base", label: { fr: "Base plafonnée", en: "Capped base" }, num: true },
    { key: "employee_pension", label: { fr: "Pension sal. 4,2%", en: "Empl. pension" }, num: true },
    { key: "employer_pension", label: { fr: "Pension pat. 4,2%", en: "Empr. pension" }, num: true },
    { key: "employer_family", label: { fr: "Prest. fam. 7%", en: "Family" }, num: true },
    { key: "employer_injury", label: { fr: "Acc. travail", en: "Injury" }, num: true },
  ];
  const trows = rows.map((r) => { const o = {}; for (const c of cols) o[c.key] = c.num ? k.xaf(r[c.key]) : (r[c.key] || ""); return o; });
  const period = data.period && (data.period.period_code || "");
  const meta = [entity.legal_name ? [{ fr: "Employeur", en: "Employer" }, entity.legal_name] : null, period ? [{ fr: "Période", en: "Period" }, period] : null].filter(Boolean);
  const body = [
    k.head(entity, { fr: "Déclaration CNPS (DIPE)", en: "CNPS declaration" }, "", meta, cfg),
    rows.length ? k.section({ fr: "Détail des cotisations", en: "Contributions detail" }, k.lineTable(cols, trows, cfg), cfg) : "",
    k.section({ fr: "Récapitulatif", en: "Summary" }, formTable([
      [k.t({ fr: "Pension — part salariale (4,2%)", en: "Pension — employee (4.2%)" }, cfg.language), firstNum(totals.employee_pension, data.part_salariale)],
      [k.t({ fr: "Pension — part patronale (4,2%)", en: "Pension — employer (4.2%)" }, cfg.language), firstNum(totals.employer_pension)],
      [k.t({ fr: "Prestations familiales (7%)", en: "Family benefits (7%)" }, cfg.language), firstNum(totals.employer_family)],
      [k.t({ fr: "Accidents du travail", en: "Work-injury" }, cfg.language), firstNum(totals.employer_injury)],
      [k.t({ fr: "TOTAL À VERSER", en: "TOTAL DUE" }, cfg.language), firstNum(totals.total, data.total_a_verser), true],
    ], cfg), cfg),
    `<p class="muted" style="margin-top:8px">${k.t({ fr: "Plafond mensuel", en: "Monthly ceiling" }, cfg.language)}: ${k.xaf(750000)}</p>`,
    k.footer(entity, cfg, verify),
  ].join("");
  return k.shell("CNPS declaration", body, cfg);
}

TEMPLATES.VAT_RETURN.build = vatReturnBuild;
TEMPLATES.VAT_RETURN.fields = ["official TVA layout"];
TEMPLATES.CNPS_DECLARATION.build = cnpsBuild;
TEMPLATES.CNPS_DECLARATION.fields = ["official DIPE layout"];

const list = () => Object.values(TEMPLATES).map((t) => ({ docType: t.docType, title: t.title, module: t.module, fields: t.fields || [], report: !!t.report }));
const get = (docType) => TEMPLATES[docType] || null;

module.exports = { TEMPLATES, list, get };
