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
function fmtLines(lines = [], ccy, cfg = {}) {
  return lines.map((l) => ({
    label: l.label,
    qty: has(l.qty) ? String(l.qty) : "",
    unit: has(l.unit) ? k.money(l.unit, ccy, cfg) : "",
    tax: has(l.tax) ? `${l.tax}%` : "",
    amount: k.money(has(l.amount) ? l.amount : (Number(l.qty || 1) * Number(l.unit || 0)), ccy, cfg),
  }));
}

/**
 * Shared builder for the line-item + totals family (invoice / proforma /
 * quotation / credit note). `opts`: { title, meta, totalsRows(data), notesLabel,
 * words? } — `words` adds the amount-in-words block (the legacy PO and invoice
 * both carried it; see kit.wordsBlock).
 */
function lineDoc(opts) {
  return (data, cfg, entity, verify) => {
    const ccy = data.currency || cfg.base_currency || "XAF";
    const words = opts.words && cfg.show && cfg.show.words !== false && has(data.amount_in_words)
      ? k.wordsBlock(data.amount_in_words, ccy, cfg, data.currency_decimals ?? entity.default_currency_decimals)
      : "";
    const signers = opts.signers ? opts.signers(data) : null;
    const sig = signers && signers.length ? k.signerBlock(signers, cfg) : k.signatureBlock(cfg);
    const body = [
      k.standardHead(entity, cfg, { title: opts.title, number: data.number, meta: opts.meta(data) }),
      k.parties([
        { label: { fr: "Émetteur", en: "From" }, name: entity.legal_name, lines: [entity.address, entity.niu && `NIU ${entity.niu}`] },
        { label: opts.partyLabel || { fr: "Client", en: "Bill to" }, name: data.party && data.party.name, lines: (data.party && data.party.lines) || [] },
      ], cfg),
      k.lineTable(LINE_COLS, fmtLines(data.lines, ccy, cfg), cfg),
      k.totals(opts.totalsRows(data, ccy, cfg), cfg),
      words,
      cfg.show && cfg.show.notes && data.notes ? k.section({ fr: "Notes", en: "Notes" }, `<div class="box">${k.esc(data.notes).replace(/\n/g, "<br>")}</div>`, cfg) : "",
      cfg.show && cfg.show.bank ? k.bankBlock(entity, cfg) : "",
      k.termsBlock(cfg),
      sig,
      k.standardFoot(entity, cfg, verify),
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
const sampleTotals = { service_ht: 1080000, disbursement_total: 320000, vat_total: 207900, total_ttc: 1607900 };

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
      totalsRows: (d, ccy, cfg) => [
        [{ fr: "Total HT", en: "Subtotal" }, k.money(d.totals.service_ht, ccy, cfg)],
        [{ fr: "Débours", en: "Disbursements" }, k.money(d.totals.disbursement_total, ccy, cfg)],
        [{ fr: "TVA 19,25%", en: "VAT 19.25%" }, k.money(d.totals.vat_total, ccy, cfg)],
        [{ fr: "Total TTC", en: "Total" }, k.money(d.totals.total_ttc, ccy, cfg), { grand: true }],
      ],
      // The legacy invoice printed "ARRÊTÉE LA PRÉSENTE FACTURE À LA SOMME DE :"
      // (printfi.php) — kept, bilingual.
      words: true,
    }),
    sampleData: { number: "FCT-2026-0001", date: "2026-07-27", due: "2026-08-26", dossier_ref: "SBX-2026-0001", party: sampleParty, lines: sampleLines, totals: sampleTotals, amount_in_words: sampleTotals.total_ttc, currency: "XAF" },
  },

  PROFORMA_ADVANCE: {
    docType: "PROFORMA_ADVANCE",
    title: { fr: "Facture proforma", en: "Proforma" },
    module: "finance/proforma",
    fields: ["validity note", "advance %"],
    build: lineDoc({
      title: { fr: "Facture proforma", en: "Proforma invoice" },
      meta: (d) => [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Valable jusqu'au", en: "Valid until" }, k.dateFmt(d.valid_until)], [{ fr: "Acompte", en: "Advance" }, has(d.advance_pct) ? `${d.advance_pct}%` : ""]],
      totalsRows: (d, ccy, cfg) => [
        [{ fr: "Total HT", en: "Subtotal" }, k.money(d.totals.service_ht, ccy, cfg)],
        [{ fr: "TVA 19,25%", en: "VAT 19.25%" }, k.money(d.totals.vat_total, ccy, cfg)],
        [{ fr: "Total TTC", en: "Total" }, k.money(d.totals.total_ttc, ccy, cfg), { grand: true }],
        has(d.advance_pct) ? [{ fr: `Acompte ${d.advance_pct}%`, en: `Advance ${d.advance_pct}%` }, k.money(d.totals.total_ttc * (d.advance_pct / 100), ccy, cfg)] : null,
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
      totalsRows: (d, ccy, cfg) => [
        [{ fr: "Total HT", en: "Subtotal" }, k.money(d.totals.service_ht, ccy, cfg)],
        [{ fr: "TVA 19,25%", en: "VAT 19.25%" }, k.money(d.totals.vat_total, ccy, cfg)],
        [{ fr: "Total TTC", en: "Total" }, k.money(d.totals.total_ttc, ccy, cfg), { grand: true }],
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
      totalsRows: (d, ccy, cfg) => [
        [{ fr: "Total HT", en: "Subtotal" }, "-" + k.money(d.totals.service_ht, ccy, cfg)],
        [{ fr: "TVA 19,25%", en: "VAT 19.25%" }, "-" + k.money(d.totals.vat_total, ccy, cfg)],
        [{ fr: "Total avoir TTC", en: "Credit total" }, "-" + k.money(d.totals.total_ttc, ccy, cfg), { grand: true }],
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
      const ccy = data.currency || cfg.base_currency || "XAF";
      const c = { ...cfg, watermark: cfg.watermark || "PAID" };
      const body = [
        k.standardHead(entity, c, { title: { fr: "Reçu de paiement", en: "Payment receipt" }, number: data.number, meta: [[{ fr: "Date", en: "Date" }, k.dateFmt(data.date)], [{ fr: "Mode", en: "Method" }, data.method]] }),
        k.parties([{ label: { fr: "Reçu de", en: "Received from" }, name: data.party && data.party.name, lines: (data.party && data.party.lines) || [] }], c),
        k.section({ fr: "Montant reçu", en: "Amount received" }, `<div class="box" style="font-size:22px;font-weight:700">${k.money(data.amount, ccy, c)}</div>`, c),
        (data.allocations && data.allocations.length)
          ? k.section({ fr: "Imputation", en: "Applied to" }, k.lineTable(
            [{ key: "label", label: { fr: "Facture", en: "Invoice" } }, { key: "amount", label: { fr: "Montant", en: "Amount" }, num: true }],
            data.allocations.map((a) => ({ label: a.label, amount: k.money(a.amount, ccy, c) })), c), c)
          : data.invoice_ref ? k.section({ fr: "Imputation", en: "Applied to" }, `<div class="box">${k.esc(data.invoice_ref)}</div>`, c) : "",
        k.signatureBlock(c),
        k.standardFoot(entity, c, verify),
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
      const ccy = data.currency || cfg.base_currency || "XAF";
      const secs = (data.sections || []).map((s) => k.section({ fr: s.title, en: s.title }, `<div class="box">${k.esc(s.body).replace(/\n/g, "<br>")}</div>`, cfg)).join("");
      const body = [
        k.standardHead(entity, cfg, { title: { fr: "Proposition commerciale", en: "Proposal" }, number: data.number, meta: [[{ fr: "Date", en: "Date" }, k.dateFmt(data.date)], [{ fr: "Client", en: "Client" }, data.party && data.party.name]] }),
        `<h1 style="margin-top:18px">${k.esc(data.headline || "")}</h1>`,
        secs,
        data.lines && data.lines.length ? k.section({ fr: "Tarification", en: "Pricing" }, k.lineTable(LINE_COLS, fmtLines(data.lines, ccy, cfg), cfg), cfg) : "",
        data.totals ? k.totals([[{ fr: "Total TTC", en: "Total" }, k.money(data.totals.total_ttc, ccy, cfg), { grand: true }]], cfg) : "",
        k.termsBlock(cfg),
        k.signatureBlock(cfg),
        k.standardFoot(entity, cfg, verify),
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
  /**
   * BON DE COMMANDE — the supplier-facing PO, rebuilt to the legacy print
   * (print-po.php): payment terms + place of delivery in the meta block, the
   * full totals ladder (HT / VAT / TTC / withholding / advance / NET PAYABLE)
   * the legacy printed, the amount in words, and the remarks box. Every extra
   * row is conditional — a PO with no withholding prints none.
   */
  PURCHASE_ORDER: {
    docType: "PURCHASE_ORDER", title: { fr: "Bon de commande", en: "Purchase order" }, module: "procurement/purchase_order", fields: ["supplier terms", "delivery address", "payment terms", "withholding", "net payable", "amount in words"],
    build: (data, cfg, entity, verify) => {
      const ccy = data.currency || cfg.base_currency || "XAF";
      const terms = data.payment_means
        ? `${data.pay_days > 0 ? `${data.pay_days} ${cfg.language === "fr" ? "jours" : "days"}` : (cfg.language === "fr" ? "immédiat" : "immediate")} (${data.payment_means})`
        : "";
      const body = [
        k.standardHead(entity, cfg, { title: { fr: "Bon de commande", en: "Purchase order" }, number: data.number, meta: [
          [{ fr: "Date", en: "Date" }, k.dateFmt(data.date)],
          [{ fr: "Livraison", en: "Delivery" }, k.dateFmt(data.delivery_on)],
          [{ fr: "Échéance", en: "Due" }, k.dateFmt(data.due_on)],
          [{ fr: "Conditions de paiement", en: "Payment terms" }, terms || ""],
          [{ fr: "Lieu de livraison", en: "Place of delivery" }, data.delivery_location],
        ].filter((m) => m[1]) }),
        k.parties([
          { label: { fr: "Fournisseur", en: "Supplier" }, name: data.party && data.party.name, lines: (data.party && data.party.lines) || [] },
          { label: { fr: "Destinataire", en: "Ship to" }, name: data.ship_to || entity.legal_name, lines: [data.delivery_location].filter(Boolean) },
        ], cfg),
        k.lineTable(LINE_COLS, fmtLines(data.lines, ccy, cfg), cfg),
        k.totals([
          [{ fr: "Total HT", en: "Subtotal" }, k.money(data.totals.service_ht, ccy, cfg)],
          [{ fr: "TVA", en: "VAT" }, k.money(data.totals.vat_total, ccy, cfg)],
          [{ fr: "Total TTC", en: "Total" }, k.money(data.totals.total_ttc, ccy, cfg), { grand: true }],
          has(data.air_rate) && data.air_rate > 0 ? [{ fr: `Retenue à la source ${data.air_rate}%`, en: `Withholding ${data.air_rate}%` }, "- " + k.money(data.totals.withholding, ccy, cfg)] : null,
          has(data.adv_paid) && data.adv_paid > 0 ? [{ fr: "Acompte versé", en: "Advance paid" }, "- " + k.money(data.adv_paid, ccy, cfg)] : null,
          has(data.totals.net_payable) ? [{ fr: "Net à payer", en: "Net payable" }, k.money(data.totals.net_payable, ccy, cfg), { grand: true }] : null,
        ], cfg),
        cfg.show && cfg.show.words !== false && has(data.amount_in_words) ? k.wordsBlock(data.amount_in_words, ccy, cfg, data.currency_decimals ?? entity.default_currency_decimals) : "",
        data.remarks ? k.section({ fr: "Observations", en: "Remarks" }, `<div class="box">${k.esc(data.remarks).replace(/\n/g, "<br>")}</div>`, cfg) : "",
        k.termsBlock(cfg),
        k.signerBlock([
          { label: { fr: "Émis par", en: "Issued by" }, name: data.issuer_name, title: data.issuer_title },
          { label: { fr: "Approuvé par", en: "Approved by" }, name: data.approver_name, title: data.approver_title },
        ], cfg),
        k.standardFoot(entity, cfg, verify),
      ].join("");
      return k.shell("PO " + (data.number || ""), body, cfg);
    },
    sampleData: { number: "BC-2026-0031", date: "2026-07-27", delivery_on: "2026-08-05", due_on: "2026-08-19", payment_means: "BANK", pay_days: 14, delivery_location: "Entrepôt Douala", party: { name: "Établissements TENOR", lines: ["Douala, Cameroun", "NIU M042116033580Q"] }, lines: sampleLines.slice(0, 2), totals: { service_ht: 1080000, vat_total: 207900, total_ttc: 1287900, withholding: 54000, net_payable: 1233900 }, air_rate: 5, adv_paid: 0, amount_in_words: 1233900, currency: "XAF", remarks: "Livraison en deux tranches." },
  },

  SUPPLIER_INVOICE: {
    docType: "SUPPLIER_INVOICE", title: { fr: "Facture fournisseur", en: "Supplier invoice" }, module: "procurement/supplier_invoice", fields: ["COPY watermark", "amount in words"],
    build: (data, cfg, entity, verify) => lineDoc({
      title: { fr: "Facture fournisseur", en: "Supplier invoice" }, partyLabel: { fr: "Fournisseur", en: "Supplier" },
      meta: (d) => [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "N° fournisseur", en: "Supplier ref" }, d.supplier_ref], [{ fr: "Échéance", en: "Due" }, k.dateFmt(d.due)], [{ fr: "PO", en: "PO" }, d.po_ref]],
      totalsRows: (d, ccy) => [
        [{ fr: "Total HT", en: "Subtotal" }, k.money(d.totals.service_ht, ccy, cfg)],
        [{ fr: "TVA", en: "VAT" }, k.money(d.totals.vat_total, ccy, cfg)],
        [{ fr: "Retenue à la source", en: "Withholding" }, "- " + k.money(d.totals.wht_total || 0, ccy, cfg)],
        [{ fr: "Total TTC", en: "Total" }, k.money(d.totals.total_ttc, ccy, cfg), { grand: true }],
      ],
      words: true,
      signers: (d) => [{ label: { fr: "Comptabilisé par", en: "Posted by" }, name: d.posted_by_name, title: d.posted_by_title }],
    })(data, { ...cfg, watermark: cfg.watermark || "COPY" }, entity, verify),
    sampleData: { number: "FF-2026-0088", date: "2026-07-27", due: "2026-08-26", supplier_ref: "INV-9921", po_ref: "BC-2026-0031", party: { name: "SDV Cameroun", lines: ["Douala", "NIU M042116033580Q"] }, lines: sampleLines.slice(0, 2), totals: { service_ht: 1080000, vat_total: 207900, wht_total: 54000, total_ttc: 1233900 }, amount_in_words: 1233900, currency: "XAF" },
  },

  PURCHASE_REQUEST: {
    docType: "PURCHASE_REQUEST", title: { fr: "Demande d'achat", en: "Purchase request" }, module: "procurement/purchase_request", fields: ["approver signatures"],
    build: lineDoc({
      title: { fr: "Demande d'achat", en: "Purchase request" }, partyLabel: { fr: "Demandeur", en: "Requested by" },
      meta: (d) => [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Service", en: "Department" }, d.department]],
      totalsRows: (d, ccy, cfg) => [[{ fr: "Total estimé", en: "Estimated total" }, k.money(d.totals.total_ttc, ccy, cfg), { grand: true }]],
      signers: (d) => [{ label: { fr: "Demandé par", en: "Requested by" }, name: d.requester_name, title: d.requester_title }],
    }),
    sampleData: { number: "DA-2026-0014", date: "2026-07-27", department: "Opérations", party: { name: "Jean Mballa", lines: ["Chef de quai"] }, lines: sampleLines.slice(0, 2), totals: { total_ttc: 1080000 }, currency: "XAF" },
  },

  /**
   * BON DE LIVRAISON — the sheet the client signs at the gate, and the only
   * thing that turns a printout into proof that goods changed hands.
   *
   * ══ THE SAME THREE CONTRACTS AS THE TRANSIT ORDER ════════════════════════
   * One page, one language, and a signatory box the signature engine fills.
   * See TRANSIT_ORDER's header for what each of those means and why; this is
   * the second adopter of the instrument sheet, and the kit primitives it uses
   * were built to be exactly that.
   *
   * ── What is different here, and it is the whole point ─────────────────────
   * A sea file's containers do not all clear at once. Twelve boxes come out of
   * the port over three weeks, and each run produces its OWN note carrying the
   * boxes that actually went — because a note is evidence of one handover at
   * one moment, and a document amended after it is signed stops being evidence
   * (the signature engine would correctly flag it AMENDED).
   *
   * So this sheet answers a question the old one could not: WHERE IN THE FILE
   * ARE WE. `data.position` — delivery n of m, so many delivered, so many
   * still to come — is derived from the other notes on the same dossier by the
   * same rollup the operations screen reads. The client's gatekeeper learns
   * that more is coming; the driver learns this is not the last run; and
   * nobody has to reconcile three signed sheets by hand to find out.
   *
   * ── The manifest keeps its ruled slots ───────────────────────────────────
   * Padded to a minimum, because an empty slot prints as a line and a box
   * added on the quay can be written in and still be part of what was signed.
   * The legacy hard cap of 18 silently TRUNCATED anything beyond it, which on
   * a proof-of-delivery is data loss wearing a layout bug's clothes.
   *
   * ── Carried over from `view/operations/delivery-note.php`, because it was
   *    right ────────────────────────────────────────────────────────────────
   *   · the RESERVATIONS box, where the client writes "carton 3 crushed". It is
   *     the single most valuable thing on the page in a dispute, because it is
   *     the client's own words at the moment of acceptance — so it prints as a
   *     fillable well even on a note that has none.
   *   · a RECEIVED BY box that names the person, rather than an anonymous
   *     signature line.
   *
   * MEASURED CEILING: 195 containers on one A4 sheet, with a logo, a cachet and
   * a seal (`DOC=DELIVERY_NOTE node scripts/dev/measure-instrument.js`, 2026-08);
   * it spills at 210. The largest real file in the data carries twelve boxes.
   * Re-measure after any change to the sheet or to HEIGHT_MM — the number is a
   * measurement, not an aspiration, and the manifest is the axis that drives
   * this page, not the cargo table.
   */
  DELIVERY_NOTE: {
    docType: "DELIVERY_NOTE", title: { fr: "Bon de livraison", en: "Delivery note" }, module: "operations/delivery_note",
    fields: ["container manifest", "partial-delivery position", "reservations", "received by", "signatory box"],
    /*
     * The covering note. It asks for the ONE thing this document exists to get
     * back — a signed copy with the client's reserves on it — because a
     * delivery note that comes back unsigned is stationery, and an email that
     * does not say what to do with the attachment is how that happens.
     */
    email: {
      subject: {
        fr: "Bon de livraison {number}[[ — dossier {dossier_ref}]]",
        en: "Delivery note {number}[[ — file {dossier_ref}]]",
      },
      body: {
        fr: "Bonjour,\n\n"
          + "Veuillez trouver ci-joint le bon de livraison {number}[[ relatif au dossier {dossier_ref}]].\n\n"
          + "Nous vous remercions de bien vouloir contrôler la marchandise à la réception, puis de nous "
          + "retourner un exemplaire signé et cacheté en y portant vos éventuelles réserves.\n\n"
          + "Cordialement,\n{entity_name}",
        en: "Hello,\n\n"
          + "Please find attached delivery note {number}[[ for file {dossier_ref}]].\n\n"
          + "Kindly check the goods on receipt, then return a signed and stamped copy to us, noting any "
          + "reservations on it.\n\n"
          + "Kind regards,\n{entity_name}",
      },
    },
    /** Measured off the render — see scripts/dev/measure-instrument.js. */
    HEIGHT_MM: {
      // head/foot are SUPERSEDED by k.shellMm (12760) — the shell measures
      // itself now, because a tenant can change it. Kept as the record of what
      // the default letterhead measured, and as the fallback nothing reads yet.
      head: 17,        // letterhead + accent rule
      name: 12,        // centred document name + the reference under it
      ident: 11,       // date / delivery date / status row
      consignee: 24,   // who it is going to, and where
      cargoHead: 5.5,
      cargoRow: 6.4,
      cargoWrap: 4.6,
      cargoMin: 26,    // .cargo's ruled minimum, whatever it holds
      manifestHead: 5.5,
      manifestRow: 6.7, // one row of THREE manifest cells
      position: 13,    // the "delivery 2 of 3" band, when there is one
      reserves: 20,    // the client's own words, always a fillable box
      /* The strip LESS the seal, which is in FIXED_MM: at k=1 the whole block
         measures ~58mm, of which the seal's own 29 do not scale. */
      strip: 17,       // the two signatory boxes, ruled well only
      stampExtra: 12,
      foot: 9,
      gap: 2.2,
    },
    FIXED_MM: { seal: 29, footVfy: 24 },
    build: (data, cfg, entity, verify) => {
      const lang = cfg.language;
      const H = TEMPLATES.DELIVERY_NOTE.HEIGHT_MM;
      const F = TEMPLATES.DELIVERY_NOTE.FIXED_MM;

      const lines = Array.isArray(data.lines) ? data.lines : [];
      const tcs = Array.isArray(data.containers) ? data.containers : [];
      const seals = Array.isArray(data.seals) ? data.seals : [];
      const hasStamp = Boolean(cfg.signature && cfg.signature.image_url);
      const pos = data.position || null;
      /*
       * DOES THIS FILE MOVE CONTAINERS?
       *
       * Every delivery note used to print twelve ruled manifest slots, so an
       * AIR FREIGHT note carried a container manifest — a third of the page
       * given to boxes that do not exist on that shipment. The projection asks
       * the file's service type (`template.service.deliveryNoteData`), and a
       * note whose file cannot be resolved prints as packages: that shape loses
       * nothing, where the other prints twelve empty rows.
       *
       * A note that HOLDS containers keeps its manifest whatever the flag says
       * — the boxes on the note are the fact, and hiding them because a service
       * type was reconfigured afterwards would shorten a signed document.
       */
      const containerised = data.containerised === true || tcs.length > 0;

      /*
       * The manifest's ruled slots. A minimum of twelve so a short delivery
       * still looks like a form somebody can write on, and every container
       * beyond that printed rather than truncated.
       *
       * Rounded up to a whole row of three. The grid is three columns wide, so
       * thirty-one boxes would otherwise leave the last row two-thirds empty —
       * white space rather than the ruled lines a box added on the quay gets
       * written on. Costs nothing: the row is already there.
       */
      const manifestRows = Math.ceil(Math.max(12, tcs.length) / 3);
      const slots = manifestRows * 3;
      // The elastic block, and the block that decides the page's shape. A
      // package note has no manifest, so the CARGO table takes the slack — it
      // is that note's substance, and ruled space to write another carton on is
      // worth exactly what a ruled container slot is worth on a sea note.
      const showManifest = containerised;

      const wraps = lines.reduce((n, l) => n + Math.max(0, Math.ceil(String(l.label || "").length / 46) - 1), 0);
      // Every direct child of .sheet carries a top margin, and there are ten of
      // them (head, rule, name, ident, consignee, cargo, manifest, reserves,
      // strip, foot) plus the optional progress band. Counting seven of them
      // was worth 6mm of a page that has none to spare.
      const blocks = 10 + (pos ? 1 : 0) - (showManifest ? 0 : 1);
      /*
       * THE SHELL MEASURES ITSELF (12760).
       *
       * `H.head` and `H.foot` were measured constants — right on the day
       * somebody ran measure-instrument.js, and a lie the moment a tenant added
       * a footer line or set a taller mark, which is exactly what the letterhead
       * editor now lets them do. A wrong head budget does not degrade
       * gracefully: `--k` is solved against a page that does not exist and the
       * sheet silently becomes two, which is the one failure the one-page
       * contract exists to prevent.
       *
       * `k.shellMm` composes the real letterhead and reports what it costs.
       * `fixed` is the mark's MARGINAL height — what it adds beside the identity
       * column, which is its full height on a short letterhead and zero when the
       * identity column is already taller. `headScaling` and `foot` are the
       * parts that genuinely follow --k.
       */
      const shell = k.shellMm(entity, cfg);
      const scalingMm = shell.headScaling
        + H.name + H.ident + H.consignee
        /*
         * `.cargo` reserves a 26mm minimum whatever it holds — the ruled area
         * that makes the table writable on paper. A one-line cargo table is
         * therefore 26mm, not 12, and estimating it by its rows alone told the
         * solver the page was 14mm shorter than it is.
         */
        + (lines.length
          ? Math.max(H.cargoMin, H.cargoHead + lines.length * H.cargoRow + wraps * H.cargoWrap)
          : 0)
        + (showManifest ? H.manifestHead + manifestRows * H.manifestRow : 0)
        + (pos ? H.position : 0)
        + H.reserves + H.strip + (hasStamp ? H.stampExtra : 0)
        + shell.foot + blocks * H.gap;
      const fixedMm = shell.fixed + seals.length * F.seal + (seals.length ? 0 : F.footVfy);
      const cfgFit = { ...cfg, fit: k.fitScale(scalingMm, k.fitBudgetMm(cfg), fixedMm) };

      const ident = k.factsGrid([
        [{ fr: "Date", en: "Date" }, k.dateFmt(data.date)],
        [{ fr: "Date de livraison", en: "Delivery date" }, k.dateFmt(data.delivery_date)],
        [{ fr: "Statut", en: "Status" }, k.t(data.status_words || { fr: "", en: "" }, lang)],
        [{ fr: "Dossier", en: "File" }, data.dossier_ref],
      ], cfgFit, { cols: 4 });

      const party = (data.party && data.party.name) || "—";
      const partyLines = ((data.party && data.party.lines) || []).filter(Boolean);
      const consignee = k.ruledBlock({ fr: "Destinataire", en: "Consignee" },
        `<div style="font-weight:700;font-size:calc(10pt * var(--k));">${k.esc(party)}</div>`
        + (partyLines.length ? `<div class="muted">${partyLines.map(k.esc).join("<br>")}</div>` : ""),
        cfgFit);

      /*
       * WHERE THIS DELIVERY SITS IN THE FILE.
       *
       * Only for a containerised file that has more than one box — on a single
       * -container file it would say "delivery 1 of 1, 0 remaining", which is
       * noise. Omitted entirely rather than printed empty.
       */
      const positionBand = pos && pos.total > 1
        ? k.ruledBlock({ fr: "Avancement de la livraison", en: "Delivery progress" },
          `<div class="cols3">`
          + `<div><span class="muted">${k.t({ fr: "Livraison", en: "Delivery" }, lang)}:</span> <b>${k.esc(pos.sequence || "—")}${pos.of_notes ? ` / ${k.esc(pos.of_notes)}` : ""}</b></div>`
          + `<div><span class="muted">${k.t({ fr: "Conteneurs livrés", en: "Containers delivered" }, lang)}:</span> <b>${k.esc(pos.delivered)} / ${k.esc(pos.total)}</b></div>`
          /*
           * IN TRANSIT IS ITS OWN FIGURE, and it is why "still to come" alone
           * would mislead. A box on another issued note is neither delivered
           * nor waiting to be sent — reading "0 still to come" while four are
           * on a truck is how a second truck gets dispatched for them.
           */
          + `<div><span class="muted">${
            pos.in_transit
              ? k.t({ fr: "En cours de livraison", en: "Out for delivery" }, lang)
              : k.t({ fr: "Restant à livrer", en: "Still to come" }, lang)
          }:</span> <b>${k.esc(pos.in_transit || pos.outstanding)}</b>${
            pos.in_transit && pos.outstanding
              ? `<span class="muted"> · ${k.t({ fr: "restant", en: "to come" }, lang)} ${k.esc(pos.outstanding)}</span>`
              : ""
          }</div>`
          + `</div>`, cfgFit)
        : "";

      /*
       * The cargo table carries the WEIGHT on a package note.
       *
       * On a container file the manifest below identifies the goods, so the
       * table stays three columns and the page keeps the width for the
       * description. On an air or road file there is no manifest: the weight is
       * what the consignee checks at the counter, and it has to be on the sheet
       * they sign or the note says less than the file it came from.
       */
      const cols = containerised
        ? [
          { key: "label", label: { fr: "Désignation", en: "Description" } },
          { key: "marks", label: { fr: "Marques", en: "Marks" } },
          { key: "qty", label: { fr: "Quantité", en: "Quantity" }, num: true },
        ]
        : [
          { key: "label", label: { fr: "Désignation", en: "Description" } },
          { key: "marks", label: { fr: "Marques", en: "Marks" } },
          { key: "qty", label: { fr: "Colis", en: "Packages" }, num: true },
          { key: "weight", label: { fr: "Poids (kg)", en: "Weight (kg)" }, num: true },
        ];
      const cargo = lines.length
        ? k.cargoTable(cols, lines.map((l) => ({
          label: l.label,
          marks: l.marks || "",
          qty: String(l.qty),
          weight: l.gross_weight_kg === null || l.gross_weight_kg === undefined
            ? "" : String(l.gross_weight_kg),
        })), cfgFit)
        : "";

      /*
       * The container manifest. A grouped row (10708) prints as the file states
       * it — "3 × 40HC" — rather than a dash that reads as an unnamed box.
       * A box going out again carries the reason it is, because the note is the
       * only place anyone will look for it.
       */
      const manifest = () => {
        let cells = "";
        for (let i = 0; i < slots; i += 1) {
          const c = tcs[i];
          const n = `<span class="muted" style="margin-right:1mm;">${i + 1}.</span>`;
          const body = c
            ? c.container_type_code
              ? `<b>${k.esc(String(c.qty || 1))} × ${k.esc(c.container_type_code)}</b>`
              : `<b>${k.esc(c.container_no || "—")}</b>${c.seal_no ? `<span class="muted"> / ${k.esc(c.seal_no)}</span>` : ""}`
            : '<span style="color:#c3c9d2;">______________</span>';
          const again = c && c.redelivery_reason
            ? `<div class="muted" style="font-size:calc(6.4pt * var(--k));">↻ ${k.esc(c.redelivery_reason)}</div>`
            : "";
          cells += `<div class="mcell">${n}${body}${again}</div>`;
        }
        return k.ruledBlock({ fr: "Liste des conteneurs", en: "Container manifest" },
          `<div class="manifest">${cells}</div>`, cfgFit, { bare: true });
      };

      // Always a box, filled or ruled: the client's own words are written at
      // the gate, and that is precisely when they are worth something.
      const reserves = k.ruledBlock({ fr: "Observations / réserves du client", en: "Comments / reservations (client)" },
        data.reservations
          ? k.esc(data.reservations).replace(/\n/g, "<br>")
          : '<div style="min-height:calc(11mm * var(--k));"></div>',
        cfgFit);

      const stamp = hasStamp ? `<img class="stamp" src="${k.esc(cfg.signature.image_url)}" alt="">` : "";
      const sealHtml = seals.map((sig) => k.sealBlock(sig, cfgFit, { titled: true })).join("");
      const co = entity.legal_name || "";
      const strip = k.signStrip([
        {
          title: lang === "en" ? `Issued by ${k.esc(co)}` : `Livré par ${k.esc(co)}`,
          html: `${stamp}${sealHtml}`,
          line: k.esc(data.issued_by_name || "") || `${k.t({ fr: "Nom", en: "Name" }, lang)}: ______________________`,
        },
        {
          title: { fr: "Reçu par (nom, signature, cachet)", en: "Received by (name, signature, stamp)" },
          hint: k.t({ fr: "Vérifié et accepté", en: "Checked and accepted" }, lang),
          line: data.received_by_name
            ? `${k.esc(data.received_by_name)}${data.received_at ? ` · ${k.esc(k.dateFmt(data.received_at))}` : ""}`
            : `${k.t({ fr: "Nom et date", en: "Name and date" }, lang)}: ______________________`,
        },
      ], cfgFit);

      const body = `<div class="sheet">`
        + k.standardHead(entity, cfgFit)
        + k.docName({ fr: "Bon de livraison", en: "Delivery note" }, data.number, cfgFit, { ref: true })
        + k.ruledBlock(null, ident, cfgFit, { bare: true })
        + consignee
        + positionBand
        + (showManifest
          ? cargo + `<div class="grow">${manifest()}</div>`
          // No manifest: the cargo table is the elastic block, so the ruled
          // space a driver writes an extra carton into is where it is useful.
          : `<div class="grow">${cargo}</div>`)
        + reserves
        + strip
        + k.standardFoot(entity, cfgFit, seals.length ? null : verify, {
          pageLabel: `${k.t({ fr: "Page", en: "Page" }, lang)} 1 / 1`,
          provenance: k.t({ fr: "Bon de livraison", en: "Delivery note" }, lang),
        })
        + `</div>`;
      return k.shell(k.t({ fr: "Bon de livraison", en: "Delivery note" }, lang === "bilingual" ? "en" : lang)
        + " " + (data.number || ""), body, cfgFit);
    },
    sampleData: {
      number: "DN-2026-0052", date: "2026-07-27", delivery_date: "2026-07-28", dossier_ref: "SBX-2026-0001",
      status: "DELIVERED", status_words: { fr: "Livré", en: "Delivered" },
      party: sampleParty,
      position: { sequence: 2, of_notes: 3, total: 12, delivered: 8, in_transit: 4, outstanding: 0 },
      lines: [{ label: "Palettes ciment", marks: "SLS/001", qty: 24 }],
      containers: [
        { container_no: "TCLU1234567", seal_no: "SL889231" },
        { container_no: "MSKU7654321", seal_no: "SL889232" },
        { container_no: "CMAU4419087", seal_no: "SL889233", redelivery_reason: "Retour: porte endommagée, réexpédié" },
      ],
      reservations: "Conteneur 2 : joint de porte endommagé, marchandise intacte.",
      received_by_name: "Jean Mballa", received_at: "2026-07-28",
      issued_by_name: "Paul Fotso",
      seals: [],
      currency: "XAF",
    },
  },

  /**
   * ORDRE DE TRANSIT — the instrument the client signs to authorise us to
   * declare their cargo. Not an internal note: it names a declared value the
   * declaration is built on, states who carries the insurance risk and who
   * calls the surveyor, and it comes back stamped.
   *
   * ══ THREE THINGS THIS DOCUMENT IS CONTRACTUALLY REQUIRED TO DO ═══════════
   *
   * 1. IT IS ONE PAGE. Always, whatever the cargo. It is signed and stamped by
   *    hand and filed as a single sheet, and the version before this one ran to
   *    two — putting the signature boxes alone on page 2, so the copy that came
   *    back stamped carried no cargo, no declared value and no regime on it.
   *    The sheet is exactly one page tall (kit `.sheet`), the cargo table is
   *    the elastic block that absorbs the slack, and `fit` scales the whole
   *    page down as the cargo grows. NOTHING IS EVER DROPPED OR SUMMARISED to
   *    make it fit — a fuller order is set smaller, because a cargo list that
   *    silently stops short of the cargo is worse than a small one.
   *
   *    MEASURED CEILING: 50 cargo lines on one A4 sheet, with a logo, a company
   *    cachet and a seal (`scripts/dev/measure-instrument.js`, 2026-08). Past
   *    that the blocks that cannot shrink — the verification QR has a physical
   *    floor, §3.7 — dominate the page and it spills. Real orders carry one to
   *    three lines. Re-measure after any change to the sheet or to HEIGHT_MM;
   *    the number above is a measurement, not an aspiration.
   *
   * 2. IT IS MONOLINGUAL. A French client receives a French document; an
   *    English client an English one. Never "Ordre de transit / Transit order",
   *    which is what the last version printed on every line of the page — the
   *    title, the status, the eight attached-document labels — because the
   *    projection pre-joined the two languages into single strings before the
   *    template could pick one. Every label on this page now arrives as a
   *    {fr,en} pair and goes through `k.t`, so `cfg.language` genuinely decides.
   *
   * 3. IT CARRIES A SIGNATORY BOX, AND THE SIGNATURE ENGINE FILLS IT. The
   *    client's side is a ruled stamp well; ours carries the tenant's company
   *    cachet and, once the order has actually been signed through MOD-64, the
   *    electronic seal beneath it — signer, role, attestation, date, method and
   *    the QR that verifies the document (SIGNATURE_ENGINEERING_GUIDE §3.12).
   *    An UNSIGNED order gets no seal and no QR, which is the honest answer:
   *    there is nothing to verify.
   *
   * ── The anatomy, and why it is the legacy's ────────────────────────────────
   * `transit-order.php`'s print area has a specific shape, and every part of it
   * carries meaning to a Cameroonian customs clerk who reads dozens a week:
   * the Import/Export pair, the boxed shipment facts, a five-column cargo table
   * (marks / packages / description / weight / value), the requested regime as
   * a tick-row with a write-in line, the place of delivery, the insurance
   * clause and the surveyor election, the attached-documents checklist, and two
   * signature boxes. It is kept, block for block, set in our own type and
   * colour — plus the letterhead and foot the legacy sheet never had, which is
   * the thing clients actually complained about.
   *
   * The shipment facts (client, vessel, BL, ports, dates, marks) come from the
   * shipment-details projection and are FROZEN onto the order when it issues
   * (0661), so a reprint matches the copy that was signed.
   */
  TRANSIT_ORDER: {
    docType: "TRANSIT_ORDER", title: { fr: "Ordre de transit", en: "Transit order" }, module: "operations/transit_order",
    fields: ["shipment facts", "customs regime", "insurance & surveyor", "attached documents", "signatory box"],
    /*
     * The covering note. This document is an AUTHORISATION — nothing can be
     * declared until it comes back signed — so the email says that plainly and
     * names the consequence, rather than "please find attached". The clerk
     * reading it is deciding whether to action it today or on Monday.
     */
    email: {
      subject: {
        fr: "Ordre de transit {number}[[ — dossier {dossier_ref}]] — signature requise",
        en: "Transit order {number}[[ — file {dossier_ref}]] — signature required",
      },
      body: {
        fr: "Bonjour,\n\n"
          + "Veuillez trouver ci-joint l'ordre de transit {number}[[ relatif au dossier {dossier_ref}]].\n\n"
          + "Nous vous prions de bien vouloir nous le retourner signé et cacheté : il constitue notre "
          + "autorisation d'engager les formalités de dédouanement pour votre compte, qui ne peuvent "
          + "commencer sans lui.\n\n"
          + "Nous restons à votre disposition pour toute précision.\n\n"
          + "Cordialement,\n{entity_name}",
        en: "Hello,\n\n"
          + "Please find attached transit order {number}[[ for file {dossier_ref}]].\n\n"
          + "Please return it to us signed and stamped: it is our authority to begin the customs "
          + "formalities on your behalf, and they cannot start without it.\n\n"
          + "Do let us know if anything needs clarifying.\n\n"
          + "Kind regards,\n{entity_name}",
      },
    },
    /**
     * Height model, in millimetres at fit = 1.
     *
     * Every constant is a measured block of the rendered sheet, not a guess:
     * change one of them and `tests/unit/transit-order-document.test.js` will
     * tell you whether the page still lands on one sheet at 1, 8, 20 and 40
     * cargo lines. It over-estimates slightly on purpose — a page that comes
     * out 3% smaller than it needed to is invisible, and one that comes out 3%
     * too big is a second sheet.
     */
    HEIGHT_MM: {
      head: 17,        // letterhead + accent rule
      name: 12,        // centred document name + the reference under it
      ident: 11,       // reference / date / status / direction row
      facts: 30,       // shipment facts: header band + two four-column rows
      cargoHead: 5.5,  // cargo header band
      cargoRow: 6.4,   // one cargo line
      cargoWrap: 4.6,  // one further wrapped line of a long description
      cargoFoot: 11,   // declared value + equivalent
      regime: 19,      // regime + place of delivery, abreast
      liability: 27,   // insurance + surveyor, two columns
      docs: 25,        // attached documents, eight rows over three columns
      note: 14,        // special instructions, when present
      lodged: 11,      // customs declaration, when present
      strip: 24,       // the two signatory boxes, ruled well only
      stampExtra: 17,  // the company cachet above the seal, when one is set
      foot: 9,         // RCCM + NIU + the page claim
      gap: 2.2,        // between blocks
    },
    /**
     * The blocks that KEEP THEIR MILLIMETRES however far the page tightens.
     *
     * A seal's evidence rows have a legibility floor of their own (§3.12) and a
     * QR has a physical one (§3.7 — below ~0.5mm per module no camera resolves
     * it), so neither is wired to `--k`. They are solved for separately by
     * `kit.fitScale`; folding them into the scaling total under-shrinks the page
     * by a couple of millimetres, which is a second sheet.
     */
    FIXED_MM: {
      seal: 29,        // one seal: attestation, signer, evidence rows, QR
      footVfy: 24,     // the foot's verification block, when no seal holds one
    },
    build: (data, cfg, entity, verify) => {
      const lang = cfg.language;
      const H = TEMPLATES.TRANSIT_ORDER.HEIGHT_MM;

      const lines = Array.isArray(data.lines) ? data.lines : [];
      const docs = Array.isArray(data.documents) ? data.documents : [];
      const seals = Array.isArray(data.seals) ? data.seals : [];
      const isImport = String(data.direction || "").toUpperCase() === "IMPORT";
      const isExport = String(data.direction || "").toUpperCase() === "EXPORT";
      const hasNote = Boolean(data.instructions);
      const hasLodged = Boolean(data.declaration_ref);
      const hasStamp = Boolean(cfg.signature && cfg.signature.image_url);

      /* ── The fit ────────────────────────────────────────────────────────
       * Add up what is about to be rendered and ask the kit how far the sheet
       * has to tighten to hold it. A long cargo description wraps, so a line's
       * height is not a constant: 46 characters is what the description column
       * holds at fit 1, and every further 46 costs another wrapped line.
       */
      const wraps = lines.reduce((n, l) => n + Math.max(0, Math.ceil(String(l.label || "").length / 46) - 1), 0);
      const blocks = 8 + (hasNote ? 1 : 0) + (hasLodged ? 1 : 0);
      const F = TEMPLATES.TRANSIT_ORDER.FIXED_MM;
      /*
       * THE SHELL MEASURES ITSELF (12760).
       *
       * `H.head` and `H.foot` were measured constants — right on the day
       * somebody ran measure-instrument.js, and a lie the moment a tenant added
       * a footer line or set a taller mark, which is exactly what the letterhead
       * editor now lets them do. A wrong head budget does not degrade
       * gracefully: `--k` is solved against a page that does not exist and the
       * sheet silently becomes two, which is the one failure the one-page
       * contract exists to prevent.
       *
       * `k.shellMm` composes the real letterhead and reports what it costs.
       * `fixed` is the mark's MARGINAL height — what it adds beside the identity
       * column, which is its full height on a short letterhead and zero when the
       * identity column is already taller. `headScaling` and `foot` are the
       * parts that genuinely follow --k.
       */
      const shell = k.shellMm(entity, cfg);
      const scalingMm = shell.headScaling + H.name + H.ident + H.facts
        + H.cargoHead + lines.length * H.cargoRow + wraps * H.cargoWrap + (data.declared_value_text ? H.cargoFoot : 0)
        + H.regime + H.liability + H.docs
        + (hasNote ? H.note : 0) + (hasLodged ? H.lodged : 0)
        + H.strip + (hasStamp ? H.stampExtra : 0)
        + shell.foot + blocks * H.gap;
      const fixedMm = shell.fixed + seals.length * F.seal + (seals.length ? 0 : F.footVfy);
      const cfgFit = { ...cfg, fit: k.fitScale(scalingMm, k.fitBudgetMm(cfg), fixedMm) };

      /* ── Identity row ───────────────────────────────────────────────────
       * Reference, date, status and direction. The Import/Export pair is a
       * tick-pair rather than a word because that is what the form it stands in
       * for uses, and because a clerk finds a ticked box faster than they read
       * a label — the one thing they check before anything else on the page.
       */
      const dirPair = `<span style="white-space:nowrap;">${k.tick(isImport)}${k.t({ fr: "Import", en: "Import" }, lang)}</span>`
        + `&nbsp;&nbsp;<span style="white-space:nowrap;">${k.tick(isExport)}${k.t({ fr: "Export", en: "Export" }, lang)}</span>`;
      /*
       * NO "N° d'ordre" CELL. The reference now sits under the document's own
       * name, where everyone looks for it and where the proforma puts it —
       * printing it again 6mm below would be the same duplication the head and
       * foot were just cleaned of.
       */
      const ident = k.factsGrid([
        [{ fr: "Date", en: "Date" }, k.dateFmt(data.date)],
        [{ fr: "Statut", en: "Status" }, k.t(data.status_words || { fr: "", en: "" }, lang)],
        [{ fr: "Sens", en: "Direction" }, dirPair, { html: true, plain: true }],
      ], cfgFit, { cols: 3 });

      /*
       * FOUR COLUMNS, NOT TWO. The same eight facts down two columns is four
       * rows and ~46mm; across four columns it is two rows and ~29mm, on a
       * page whose whole problem is height. The pairing survives the change —
       * each row still reads left to right as one leg of the journey.
       */
      const facts = k.factsGrid([
        [{ fr: "Client", en: "Client" }, (data.party && data.party.name) || data.client],
        [{ fr: "Référence dossier", en: "File reference" }, data.dossier_ref],
        [{ fr: "Navire", en: "Vessel" }, data.conveyance],
        [{ fr: "Connaissement", en: "Bill of lading" }, data.transport_ref],
        [{ fr: "Provenance", en: "Origin" }, data.origin],
        [{ fr: "Date d'arrivée", en: "Arrival date" }, k.dateFmt(data.arrival_date)],
        [{ fr: "Destination", en: "Destination" }, data.destination],
        [{ fr: "Date de départ", en: "Departure date" }, k.dateFmt(data.departure_date)],
      ], cfgFit, { cols: 4 });

      /* ── Cargo ──────────────────────────────────────────────────────────
       * The declared value closes the table it is the total of. It is almost
       * never in XAF — it is the base of duty — so it prints in the currency it
       * was declared in, with the XAF equivalent beneath it when the two differ.
       */
      const cols = [
        { key: "marks", label: { fr: "Marques", en: "Marks" } },
        { key: "packages", label: { fr: "Colis", en: "Packages" }, num: true },
        { key: "label", label: { fr: "Désignation de la marchandise", en: "Cargo description" } },
        { key: "weight", label: { fr: "Poids", en: "Weight" }, num: true },
        { key: "value", label: { fr: "Valeur", en: "Value" }, num: true },
      ];
      const cargo = k.cargoTable(cols, lines, cfgFit, [
        data.declared_value_text ? [{ fr: "Valeur déclarée", en: "Declared value" }, data.declared_value_text] : null,
        data.declared_value_xaf_text ? [{ fr: "Contre-valeur", en: "Equivalent" }, data.declared_value_xaf_text, { sub: true }] : null,
      ]);

      /* ── Regime and delivery, abreast ───────────────────────────────────
       * The write-in line prints whether or not it is filled: the clerk who
       * receives this may need to name a regime the tick-row does not carry,
       * and a form with nowhere to write it is how that ends up in the margin.
       */
      const regimes = (data.regimes || []).map((r) =>
        `<span style="margin-right:calc(3mm * var(--k));white-space:nowrap;">${k.tick(r.on)}<b>${k.esc(r.code)}</b></span>`).join("");
      const otherRegime = data.customs_regime_other
        ? `<div style="margin-top:calc(1mm * var(--k));">${k.t({ fr: "Autre régime", en: "Other regime" }, lang)}: <b>${k.esc(data.customs_regime_other)}</b></div>`
        : `<div style="margin-top:calc(1mm * var(--k));" class="muted">${k.t({ fr: "Autre régime", en: "Other regime" }, lang)}: ______________________</div>`;
      const regimeRow = k.pairRow([
        k.ruledBlock({ fr: "Régime douanier sollicité", en: "Requested customs regime" }, `${regimes}${otherRegime}`, cfgFit, { wide: true }),
        k.ruledBlock({ fr: "Lieu de livraison", en: "Place of delivery" },
          `<b>${k.esc(data.place_of_delivery || "—")}</b>`, cfgFit),
      ]);

      /* ── Liability ──────────────────────────────────────────────────────
       * The insurance clause and the surveyor election, both driven by the
       * stored election rather than printed as fixed text with two boxes
       * nobody filled in. The company name is RAW here — every use below goes
       * through `k.clause`, and pre-escaping would double-encode an "&" in a
       * legal name, which several of these have.
       */
      const co = entity.legal_name || "";
      const insuredByUs = String(data.insurance_type || "CLIENT").toUpperCase() === "COMPANY";
      const surveyorUs = String(data.surveyor_party || "CLIENT").toUpperCase() === "COMPANY";
      const liability = k.ruledBlock({ fr: "Assurance et avaries", en: "Insurance and damage" },
        `<div class="cols2"><div>`
        + `<div class="subh">${k.t({ fr: "Couverture d'assurance", en: "Insurance cover" }, lang)}</div>`
        + k.clause(!insuredByUs, { fr: `NON couverte par ${co} — à la charge du client`, en: `NOT covered by ${co} — carried by the client` }, cfgFit)
        + k.clause(insuredByUs, { fr: `Couverte par ${co}`, en: `Covered by ${co}` }, cfgFit)
        + `</div><div>`
        + `<div class="subh">${k.t({ fr: "En cas d'avaries, le constat d'expert", en: "In case of damage, the surveyor" }, lang)}</div>`
        + k.clause(!surveyorUs, { fr: "Sera demandé par NOUS (le client)", en: "Is applied for by US (the client)" }, cfgFit)
        + k.clause(surveyorUs, { fr: `Sera demandé par ${co}`, en: `Is applied for by ${co}` }, cfgFit)
        + `</div></div>`,
        cfgFit);

      const docsBlock = k.ruledBlock({ fr: "Pièces jointes", en: "Attached documents" },
        `<div class="cols3">${docs.map((d) => `<div class="clause">${k.tick(d.on)}<span class="tx">${k.t(d.label || { fr: d.code, en: d.code }, lang)}</span></div>`).join("")}</div>`,
        cfgFit);

      const note = hasNote
        ? k.ruledBlock({ fr: "Instructions particulières", en: "Special instructions" },
          k.esc(data.instructions).replace(/\n/g, "<br>"), cfgFit)
        : "";

      // The declaration reference, once the order has been lodged. The legacy
      // had nowhere to put this and it was tracked in a spreadsheet.
      const lodged = hasLodged
        ? k.ruledBlock({ fr: "Déclaration en douane", en: "Customs declaration" },
          `<b>${k.esc(data.declaration_ref)}</b>${data.lodged_date ? ` · ${k.esc(k.dateFmt(data.lodged_date))}` : ""}`, cfgFit)
        : "";

      /* ── The signatory boxes ────────────────────────────────────────────
       * Client on the left, ours on the right — the legacy layout, and the one
       * the filing clerk looks for.
       *
       * OUR SIDE CARRIES TWO DIFFERENT THINGS AND THEY MUST NOT BE CONFLATED.
       * The cachet is the company's rubber stamp: a commercial convention, and
       * what the client expects to see. It is NOT an identity claim, and the
       * signature engine is explicit that an uploaded image proves nothing
       * about who applied it (§3.4 — there is no `UPLOAD` visual mark, on
       * purpose). The evidentiary claim comes only from the seal below it,
       * which exists only when somebody actually signed through MOD-64.
       */
      const stamp = hasStamp ? `<img class="stamp" src="${k.esc(cfg.signature.image_url)}" alt="">` : "";
      const sealHtml = seals.map((sig) => k.sealBlock(sig, cfgFit, { titled: true })).join("");
      const signedOn = data.signed_date
        ? `${k.t({ fr: "Reçu le", en: "Received on" }, lang)}: ${k.esc(k.dateFmt(data.signed_date))}${data.signed_by_name ? ` · ${k.esc(data.signed_by_name)}` : ""}`
        : `${k.t({ fr: "Reçu le", en: "Received on" }, lang)}: ______________________`;
      const ourLine = [
        entity.city ? `${k.esc(entity.city)}, ${k.t({ fr: "le", en: "on" }, lang)} ${k.esc(k.dateFmt(data.issued_date || data.date))}` : k.esc(k.dateFmt(data.issued_date || data.date)),
        cfg.signature && cfg.signature.name ? k.esc([cfg.signature.name, cfg.signature.title].filter(Boolean).join(" · ")) : "",
      ].filter(Boolean).join(" &nbsp;·&nbsp; ");
      const strip = k.signStrip([
        {
          title: { fr: "Visa / cachet du client", en: "Client signature / stamp" },
          hint: k.t({ fr: "Bon pour accord — signature et cachet", en: "Agreed — signature and company stamp" }, lang),
          line: signedOn,
        },
        {
          title: lang === "en" ? `For ${k.esc(co)}` : `Pour ${k.esc(co)}`,
          html: `${stamp}${sealHtml}`,
          line: ourLine,
        },
      ], cfgFit);

      /*
       * `Page 1 / 1` is printed as a literal, and it is a CLAIM this template
       * is entitled to make: the sheet is one page by construction. If that
       * ever stops being true the label is wrong on the page as well as in the
       * layout, which is exactly the kind of loud failure a silent second sheet
       * did not give anybody.
       */
      const body = `<div class="sheet">`
        + k.standardHead(entity, cfgFit)
        + k.docName({ fr: "Ordre de transit", en: "Transit order" }, data.number, cfgFit, { ref: true })
        + k.ruledBlock(null, ident, cfgFit, { bare: true })
        + k.ruledBlock({ fr: "Détails de l'expédition", en: "Shipment details" }, facts, cfgFit, { bare: true })
        + `<div class="grow">${cargo}</div>`
        + regimeRow + liability + docsBlock + note + lodged
        + strip
        /*
         * THE VERIFICATION QR IS PRINTED ONCE, and where a reader will look
         * for it: inside the signatory box, as part of the seal.
         *
         * `kit.instrumentFoot` will print one too, and on most documents that
         * is right — the foot is the only place a doc type with no seal can
         * carry one. Here it would be the SAME code, at the same size, twice
         * on one page, for ~15mm of the height this whole rebuild is trying to
         * find. So the foot gets the verification block only when the sheet
         * carries no seal to hold it.
         */
        + k.standardFoot(entity, cfgFit, seals.length ? null : verify, {
          pageLabel: `${k.t({ fr: "Page", en: "Page" }, lang)} 1 / 1`,
          // What this document IS, said once, where a reader needs it: at the
          // end. It was under the title, which is the position of greatest
          // emphasis on the page and belongs to the reference.
          provenance: k.t({ fr: "Autorisation de transit", en: "Transit authorisation" }, lang),
        })
        + `</div>`;
      return k.shell(k.t({ fr: "Ordre de transit", en: "Transit order" }, lang === "bilingual" ? "en" : lang) + " " + (data.number || ""), body, cfgFit);
    },
    sampleData: {
      number: "SLAS-TRO-2026-0019", date: "2026-07-27", direction: "IMPORT",
      status: "ISSUED", status_words: { fr: "Émis", en: "Issued" },
      client: "SOCIÉTÉ CAMEROUNAISE DE CIMENT",
      party: { name: "SOCIÉTÉ CAMEROUNAISE DE CIMENT", lines: ["NIU M071500000001X"] },
      dossier_ref: "SL6721864SM",
      conveyance: "MSC ARUSHI / 128W", transport_ref: "MEDUDL4471820",
      origin: "Anvers (BEANR)", arrival_date: "2026-07-24",
      destination: "Douala (CMDLA)", departure_date: "2026-07-28",
      place_of_delivery: "Entrepôt client, Bonabéri, Douala",
      lines: [
        { marks: "SCC/2026/44", packages: "24", label: "Sacs de ciment CIMENCAM 50kg", weight: "48 t", value: "12 400 000 XAF" },
        { marks: "N/M", packages: "1", label: "Groupe électrogène 250 kVA", weight: "2,4 t", value: "18 600 000 XAF" },
      ],
      declared_value_text: "47 250,00 EUR", declared_value_xaf_text: "31 000 000 XAF",
      regimes: [{ code: "IM4", on: true }, { code: "IM7", on: false }, { code: "IM8", on: false }, { code: "EX1", on: false }, { code: "EX2", on: false }],
      customs_regime_other: null,
      insurance_type: "CLIENT", surveyor_party: "COMPANY",
      /*
       * ALL EIGHT, in the order `transit_order.rules.SUBMITTED_DOC_TYPES`
       * declares them — the sample must show the same checklist the real
       * projection builds, or the Studio preview quietly under-reports the form
       * an operator is about to hand a client. (The legacy form offered five
       * and its print template checked a sixth it could never tick.)
       */
      documents: [
        { code: "INVOICE", label: { fr: "Facture", en: "Invoice" }, on: true },
        { code: "PACKING_LIST", label: { fr: "Liste de colisage", en: "Packing list" }, on: true },
        { code: "BL_AWB", label: { fr: "Original BL/LTA", en: "Original BL/AWB" }, on: true },
        { code: "EXONERATION", label: { fr: "Lettre d'exonération", en: "Exoneration letter" }, on: false },
        { code: "CERTIFICATE_OF_ORIGIN", label: { fr: "Certificat d'origine", en: "Certificate of origin" }, on: true },
        { code: "PHYTOSANITARY", label: { fr: "Certificat phytosanitaire", en: "Phytosanitary certificate" }, on: false },
        { code: "INSURANCE_CERTIFICATE", label: { fr: "Attestation d'assurance", en: "Insurance certificate" }, on: true },
        { code: "OTHER", label: { fr: "Autres", en: "Other" }, on: false },
      ],
      instructions: "Livraison directe sous escorte douanière. Prévenir le client 24h avant.",
      declaration_ref: null, lodged_date: null,
      issued_date: "2026-07-27", signed_date: null, signed_by_name: null,
      seals: [],
      currency: "XAF",
    },
  },

  /* ── Owner Q16 — the cash-request voucher ─────────────────────────────────
   *
   * DEMANDE DE FONDS. The legacy printed this as an internal finance voucher
   * with a requisitioner grid, a beneficiary and VALIDATED / APPROVED /
   * RECEIVED signature boxes (cash-request.php #print-area). The first rebuild
   * carried the same facts as real data rather than as one hard-coded MD
   * signature image, which was the important half. What it still could not do:
   *
   * · IT SHOWED THE CLAIM WITH NO SIGHT OF THE BUDGET. A cash request is a
   *   DRAW against an approved costing (12771) — the sheet IS the file's
   *   budget — and the approving authority was asked to sign "2 650 000" with
   *   no way to know whether the file had it. Every line now carries Budget /
   *   Claimed / Remaining after, and the block is omitted entirely on an
   *   overhead request, which has no costing and would otherwise print three
   *   empty columns.
   *
   * · IT PRINTED THE ENUM. `PARTIALLY_DISBURSED`, on an A4 page, at a person.
   *   `status_words` is a {fr, en} pair now and the template picks a side —
   *   the costing's lesson, and the same words the register uses on screen.
   *
   * · ITS SIGNATURE BOXES WERE RULED LINES. Three decisions are recorded in
   *   the database (raised, approved, disbursed) and none of them reached the
   *   paper. They print as seals now, with the ruled boxes kept as the
   *   fallback for a voucher nobody has signed yet — a DRAFT taken to a desk
   *   review has nobody to seal it, and a page with neither seals nor lines
   *   cannot be signed at all.
   *
   * · A PART-PAID REQUEST PRINTED AS THOUGH NOTHING HAD MOVED. The payments
   *   table closes that: what was released, when, and what is still to run.
   *
   * · THE JUSTIFICATION TICK WAS INVISIBLE. Whoever takes cash against a
   *   ticked line owes a receipt back (Q17), and that obligation belongs on
   *   the paper they sign, not only on the screen they raised it from. It is a
   *   dagger on the description and one sentence at the foot — the same
   *   grammar the costing uses for (PT) débours, and it costs no column.
   */
  CASH_REQUEST: {
    docType: "CASH_REQUEST", title: { fr: "Demande de fonds", en: "Cash request" }, module: "costing/cash_request",
    fields: ["budget columns", "requisitioner grid", "payments", "seals", "justification marks", "VAT totals"],
    build: (data, cfg, entity, verify) => {
      const lang = cfg.language;
      const ccy = data.currency || cfg.base_currency || "XAF";
      const t = data.totals || {};
      const seals = Array.isArray(data.seals) ? data.seals : [];
      const title = { fr: "Demande de fonds", en: "Cash request" };
      const METHOD_LABEL = {
        CASH: { fr: "Espèces", en: "Cash" }, BANK: { fr: "Virement bancaire", en: "Bank transfer" },
        CHEQUE: { fr: "Chèque", en: "Cheque" }, MOMO: { fr: "Mobile money", en: "Mobile money" },
      };

      const meta = [
        [{ fr: "Date", en: "Date" }, k.dateFmt(data.date)],
        [{ fr: "Statut", en: "Status" }, data.status_words ? k.t(data.status_words, lang) : data.status],
        [{ fr: "Dossier", en: "File" }, data.dossier_ref],
        // The legacy's COSTING REF row, kept: this voucher draws on that sheet,
        // and the reader who queries a figure needs to know which one.
        data.costing_ref
          ? [{ fr: "Cotation", en: "Costing" }, data.costing_revision > 1 ? `${data.costing_ref} · rév. ${data.costing_revision}` : data.costing_ref]
          : null,
        [{ fr: "Catégorie", en: "Category" }, data.category],
        [{ fr: "Centre de coût", en: "Cost centre" }, data.cost_center],
        [{ fr: "Bénéficiaire", en: "Beneficiary" }, data.beneficiary],
        data.method ? [{ fr: "Mode de paiement", en: "Payment method" }, k.t(METHOD_LABEL[data.method] || { fr: data.method, en: data.method }, lang)] : null,
      ].filter((m) => m && m[1]);

      /*
       * THE REQUISITIONER. The legacy's grid — name, matricule, department,
       * job title — and one of the few parts of that screen worth copying: a
       * cashier at a window matches a face to a row, and a bare name does not
       * do that. Empty facets are dropped by `factsGrid`, so a request raised
       * by a user with no employee record prints the name alone rather than
       * three dashes.
       */
      const r = data.requisitioner || {};
      const reqCells = [
        // The NAME is not here: `parties` above already carries it, in bold,
        // with their contact. Printing it twice on one page is how a reader
        // learns that this grid is padding — the costing's facts block makes
        // the same omission for the same reason.
        [{ fr: "Matricule", en: "Staff no." }, r.staff_no],
        [{ fr: "Service", en: "Department" }, r.department],
        [{ fr: "Fonction", en: "Job title" }, r.job_title],
      ].filter((c) => c[1]);

      // §3.5 — the method's own fields print on the voucher (the cashier pays
      // against what is written here, not against a memory of the form).
      const md = data.method_details || {};
      const methodLines = Object.entries(md)
        .map(([key, v]) => `<div>${k.esc(key.replace(/_/g, " "))}: <strong>${k.esc(String(v))}</strong></div>`)
        .join("");

      /*
       * THE LINES. The budget three appear only when there is a budget to show
       * — an overhead request has no costing, and three columns of dashes on
       * its voucher would teach the reader to skip the block on the ones that
       * do have it.
       */
      const rows = Array.isArray(data.lines) ? data.lines : [];
      const hasBudget = rows.some((l) => l.budget);
      /*
       * The VAT column appears only when a line actually carries a rate.
       *
       * A cash request claims the costing's own TTC figures, so lines raised
       * since that changed have no rate of their own and the column would be a
       * strip of blanks down an A4 page. Requests approved before it keep
       * theirs, because that is what was approved and what was signed.
       */
      const hasVat = rows.some((l) => has(l.tax) && Number(l.tax) > 0);
      const cols = [
        { key: "label", label: { fr: "Désignation", en: "Description" } },
        { key: "qty", label: { fr: "Qté", en: "Qty" }, num: true },
        { key: "unit", label: { fr: "P.U. (TTC)", en: "Unit (TTC)" }, num: true },
      ].concat(hasVat ? [{ key: "vat", label: { fr: "TVA", en: "VAT" }, num: true }] : []).concat([
        { key: "claim", label: { fr: "Demandé (TTC)", en: "Requested (TTC)" }, num: true },
      ]).concat(hasBudget ? [
        { key: "budget", label: { fr: "Budget", en: "Budget" }, num: true },
        { key: "committed", label: { fr: "Déjà engagé", en: "Claimed" }, num: true },
        { key: "after", label: { fr: "Reste après", en: "Remaining after" }, num: true },
      ] : []);

      const lineRows = rows.map((l) => {
        const amount = has(l.amount) ? Number(l.amount) : Number(l.qty || 1) * Number(l.unit || 0);
        const vatAmount = has(l.tax) && Number(l.tax) > 0 ? (amount * Number(l.tax)) / 100 : null;
        const b = l.budget || null;
        return {
          // A dagger marks the obligation, explained once at the foot. The
          // (PT) mark works the same way on the costing.
          label: (l.justification_required ? "‡ " : "") + String(l.label || ""),
          qty: has(l.qty) ? String(l.qty) : "",
          unit: has(l.unit) ? k.money(l.unit, ccy, cfg) : "",
          vat: vatAmount === null ? "" : k.money(vatAmount, ccy, cfg),
          claim: k.money(has(l.claim) ? l.claim : amount, ccy, cfg),
          budget: b ? k.money(b.approved, ccy, cfg) : "—",
          committed: b ? k.money(b.committed, ccy, cfg) : "—",
          // A negative balance is the whole point of printing the column: it is
          // the figure the approver must refuse (assertFundable enforces it).
          after: b ? k.money(b.after, ccy, cfg) : "—",
        };
      });

      const totalsRows = [
        // Same rule as the column: three rows saying one thing is how a reader
        // learns to skip a totals block.
        hasVat ? [{ fr: "Sous-total", en: "Subtotal" }, k.money(t.subtotal, ccy, cfg)] : null,
        hasVat ? [{ fr: "TVA", en: "VAT" }, k.money(t.vat_total, ccy, cfg)] : null,
        [{ fr: "TOTAL À PAYER", en: "TOTAL PAYABLE" }, k.money(t.total_payable, ccy, cfg), { grand: true }],
        // Only once anything has moved: on an unpaid voucher these two rows
        // would restate the total twice and say nothing.
        Number(data.paid_total) > 0 ? [{ fr: "Déjà décaissé", en: "Already disbursed" }, k.money(data.paid_total, ccy, cfg)] : null,
        Number(data.paid_total) > 0 ? [{ fr: "Reste à décaisser", en: "Balance to disburse" }, k.money(data.balance, ccy, cfg)] : null,
      ];

      /*
       * THE PAYMENTS. A voucher paid in tranches is read to answer "how much is
       * left", so the balance runs down the column rather than being left for
       * the reader to subtract. Each row says whether the cash was acknowledged
       * — the third signature (Q13) — because an unacknowledged tranche is the
       * one the treasurer chases.
       */
      const paymentsHtml = Array.isArray(data.payments) && data.payments.length
        ? k.section({ fr: "Décaissements", en: "Disbursements" }, k.lineTable([
          { key: "no", label: { fr: "N°", en: "No." } },
          { key: "paid_on", label: { fr: "Date", en: "Date" } },
          { key: "amount", label: { fr: "Montant", en: "Amount" }, num: true },
          { key: "balance", label: { fr: "Solde", en: "Balance" }, num: true },
          { key: "received", label: { fr: "Reçu par", en: "Acknowledged" } },
        ], data.payments.map((p) => ({
          no: String(p.no),
          paid_on: k.dateFmt(p.paid_on),
          amount: k.money(p.amount, ccy, cfg),
          balance: k.money(p.balance, ccy, cfg),
          received: p.received_at
            ? `${k.dateFmt(p.received_at)}${p.received_ack_kind === "WET_SCAN" ? " " + k.t({ fr: "(papier)", en: "(paper)" }, lang) : ""}`
            : k.t({ fr: "En attente", en: "Pending" }, lang),
        })), cfg), cfg)
        : "";

      /*
       * THE SEALS. Three, in the order the voucher passed through them, and
       * titled so each names the decision it records rather than simply saying
       * three people signed. `signStrip` because a bare `.seal` is 88mm wide,
       * so three of them stack one per row and spend half a page.
       *
       * Validation is deliberately absent: the owner's rule is that validating
       * is a visa, not a signature (Q20). Finance checks the funds; the three
       * signatories are the requestor, the approver and the disburser.
       */
      const sealHtml = seals.length
        ? k.signStrip(seals.map((sig) => ({
          title: sig.reason || { fr: "Signature", en: "Signature" },
          html: k.sealBlock({ ...sig, reason: null }, cfg, { titled: true }),
        })), cfg)
        : `<div class="sig">`
          + `<div class="b"><div class="ln">${k.t({ fr: "DEMANDÉ PAR", en: "REQUESTED BY" }, lang)}</div></div>`
          + `<div class="b"><div class="ln">${k.t({ fr: "APPROUVÉ PAR", en: "APPROVED BY" }, lang)}</div></div>`
          + `<div class="b"><div class="ln">${k.t({ fr: "DÉCAISSÉ PAR", en: "DISBURSED BY" }, lang)}</div></div>`
          + `</div>`;

      /*
       * REMARKS — the obligations first, then the requester's own note. A
       * reader who meets "‡" in the description finds, at the foot of the page,
       * the sentence that says what it costs them; an over-budget claim finds
       * the account its author had to write to submit it at all.
       */
      const notes = [];
      if (rows.some((l) => l.justification_required)) {
        notes.push(k.t({
          fr: "‡ Pièce justificative obligatoire : le porteur des fonds doit rapporter le reçu du tiers pour cette ligne avant clôture.",
          en: "‡ Supporting document required: whoever takes the cash must bring back the third-party receipt for this line before the request can be closed.",
        }, lang));
      }
      if (data.over_budget_reason) {
        notes.push(`${k.t({ fr: "Dépassement de budget", en: "Over budget" }, lang)} — ${k.esc(data.over_budget_reason)}`);
      }
      if (data.settlement_reason) {
        notes.push(`${k.t({ fr: "Soldée partiellement", en: "Settled short" }, lang)} — ${k.esc(data.settlement_reason)}`);
      }
      if (data.rejection_reason) {
        notes.push(`${k.t({ fr: "Motif du rejet", en: "Rejected because" }, lang)} — ${k.esc(data.rejection_reason)}`);
      }
      const remarksHtml = notes.length || data.remarks
        ? k.section({ fr: "Remarques", en: "Remarks" },
          `<div class="box">${notes.map((n) => `<div>${n}</div>`).join("")}${
            data.remarks
              ? `<div style="margin-top:${notes.length ? "2.5mm" : "0"}">${k.esc(data.remarks).replace(/\n/g, "<br>")}</div>`
              : ""
          }</div>`, cfg)
        : "";

      const body = [
        k.standardHead(entity, cfg, { title, number: data.number, meta }),
        k.parties([{ label: { fr: "Demandeur", en: "Requested by" }, name: data.party && data.party.name, lines: (data.party && data.party.lines) || [] }], cfg),
        reqCells.length ? k.ruledBlock({ fr: "Demandeur", en: "Requisitioner" }, k.factsGrid(reqCells, cfg, { cols: 3 }), cfg, { bare: true }) : "",
        methodLines ? k.section({ fr: "Détails du paiement", en: "Payment details" }, `<div class="box">${methodLines}</div>`, cfg) : "",
        k.lineTable(cols, lineRows, cfg),
        k.totals(totalsRows, cfg),
        cfg.show && cfg.show.words !== false && has(data.amount_in_words)
          ? k.wordsBlock(data.amount_in_words, ccy, cfg, data.currency_decimals ?? entity.default_currency_decimals)
          : "",
        data.purpose ? k.section({ fr: "Objet", en: "Purpose" }, `<div class="box">${k.esc(data.purpose)}</div>`, cfg) : "",
        data.overhead_justification
          ? k.section({ fr: "Justification (frais généraux)", en: "Justification (overhead)" }, `<div class="box">${k.esc(data.overhead_justification)}</div>`, cfg)
          : "",
        paymentsHtml,
        remarksHtml,
        sealHtml,
        // One QR per page (§3.12a): a seal already carries it.
        k.standardFoot(entity, cfg, seals.length ? null : verify, { provenance: k.t(title, lang) }),
      ].join("");
      return k.shell("Cash request " + (data.number || ""), body, cfg);
    },
    sampleData: {
      number: "DF-2026-0007", date: "2026-07-27", status: "APPROVED",
      status_words: { fr: "À décaisser", en: "To disburse" },
      dossier_ref: "SBX-2026-0001", costing_ref: "CST-2026-0012", costing_revision: 2,
      category: "OPS", amount: 2848000, method: "BANK",
      method_details: { bank: "Afriland First Bank", account: "10005-00012-98765432101-77" },
      requisitioner: { name: "Jean Mballa", staff_no: "SLAS-137", department: "Opérations", job_title: "Chef de quai" },
      lines: [
        { label: "Port charges", qty: 1, unit: 150000, tax: null, justification_required: true, amount: 150000, claim: 150000, budget: { approved: 150000, committed: 0, remaining: 150000, after: 0 } },
        { label: "Customs duties", qty: 1, unit: 2500000, tax: null, justification_required: true, amount: 2500000, claim: 2500000, budget: { approved: 2500000, committed: 0, remaining: 2500000, after: 0 } },
        { label: "Terminal handling charges", qty: 1, unit: 198000, tax: null, justification_required: false, amount: 198000, claim: 198000, budget: { approved: 198000, committed: 0, remaining: 198000, after: 0 } },
      ],
      totals: { subtotal: 2848000, vat_total: 0, total_payable: 2848000 },
      payments: [{ no: 1, paid_on: "2026-07-28", amount: 1000000, balance: 1848000, received_at: "2026-07-28", received_ack_kind: "IN_APP" }],
      paid_total: 1000000, balance: 1848000,
      amount_in_words: 2848000,
      beneficiary: "DHL Global Forwarding",
      remarks: "Joindre les factures acquittées au dossier.",
      party: { name: "Jean Mballa", lines: ["jean.mballa@example.cm"] },
      seals: [], currency: "XAF",
    },
  },

  /* ── Owner Q16 C — the payment receipt ────────────────────────────────────
   *
   * One receipt per instalment, signed by TWO: the disbursing authority who
   * released the cash and the person who took it. The voucher is signed by
   * three and says what was APPROVED; this says what actually changed hands,
   * on a date, and what is still to run.
   *
   * The balance is the figure the holder reads before signing, so it is the
   * figure the page is built around — a small three-row ledger under the
   * amount rather than a line buried in a totals block.
   */
  CASH_PAYMENT_RECEIPT: {
    docType: "CASH_PAYMENT_RECEIPT", title: { fr: "Reçu de décaissement", en: "Payment receipt" }, module: "costing/cash_request",
    fields: ["instalment", "balance to run", "two seals", "approval date"],
    build: (data, cfg, entity, verify) => {
      const lang = cfg.language;
      const ccy = data.currency || cfg.base_currency || "XAF";
      const seals = Array.isArray(data.seals) ? data.seals : [];
      const title = { fr: "Reçu de décaissement", en: "Payment receipt" };
      const METHOD_LABEL = {
        CASH: { fr: "Espèces", en: "Cash" }, BANK: { fr: "Virement bancaire", en: "Bank transfer" },
        CHEQUE: { fr: "Chèque", en: "Cheque" }, MOMO: { fr: "Mobile money", en: "Mobile money" },
      };

      const meta = [
        [{ fr: "Date", en: "Date" }, k.dateFmt(data.date)],
        [{ fr: "Demande de fonds", en: "Cash request" }, data.request_number],
        // The authority this payment was made under. A receipt that cannot cite
        // it is a receipt for cash nobody approved.
        [{ fr: "Approuvée le", en: "Approved on" }, data.request_approved_at ? k.dateFmt(data.request_approved_at) : null],
        [{ fr: "Dossier", en: "File" }, data.dossier_ref],
        Number(data.instalment_count) > 1
          ? [{ fr: "Tranche", en: "Instalment" }, `${data.instalment_no} / ${data.instalment_count}`]
          : null,
        data.method ? [{ fr: "Mode de paiement", en: "Payment method" }, k.t(METHOD_LABEL[data.method] || { fr: data.method, en: data.method }, lang)] : null,
        [{ fr: "Compte", en: "Account" }, data.treasury_account],
      ].filter((m) => m && m[1]);

      const ledger = k.totals([
        [{ fr: "Total de la demande", en: "Request total" }, k.money(data.request_total, ccy, cfg)],
        [{ fr: "Décaissé à ce jour", en: "Disbursed to date" }, k.money(data.paid_to_date, ccy, cfg)],
        [{ fr: "Reste à décaisser", en: "Balance to disburse" }, k.money(data.balance, ccy, cfg), { grand: true }],
      ], cfg);

      /*
       * TWO seals, not three (owner Q16). The requestor's signature is already
       * on the request itself; what this document adds is who released the cash
       * and who took it. Ruled boxes stay as the fallback for the paper path —
       * a cash window at 06:00 is a paper transaction and always will be, which
       * is why this doc type allows a wet signature where the costing does not.
       */
      const sealHtml = seals.length
        ? k.signStrip(seals.map((sig) => ({
          title: sig.reason || { fr: "Signature", en: "Signature" },
          html: k.sealBlock({ ...sig, reason: null }, cfg, { titled: true }),
        })), cfg)
        : `<div class="sig">`
          + `<div class="b"><div class="ln">${k.t({ fr: "DÉCAISSÉ PAR", en: "DISBURSED BY" }, lang)}</div></div>`
          + `<div class="b"><div class="ln">${k.t({ fr: "REÇU PAR", en: "RECEIVED BY" }, lang)}</div></div>`
          + `</div>`;

      const body = [
        k.standardHead(entity, cfg, { title, number: data.number, meta }),
        k.parties([{
          label: { fr: "Reçu par", en: "Received by" },
          name: data.party && data.party.name,
          lines: (data.party && data.party.lines) || [],
        }].concat(data.beneficiary ? [{ label: { fr: "Bénéficiaire", en: "Beneficiary" }, name: data.beneficiary, lines: [] }] : []), cfg),
        k.section({ fr: "Montant décaissé", en: "Amount disbursed" },
          `<div class="box" style="font-size:20px;font-weight:700">${k.money(data.amount, ccy, cfg)}</div>`, cfg),
        cfg.show && cfg.show.words !== false && has(data.amount_in_words)
          ? k.wordsBlock(data.amount_in_words, ccy, cfg, data.currency_decimals ?? entity.default_currency_decimals)
          : "",
        ledger,
        data.memo ? k.section({ fr: "Objet", en: "Memo" }, `<div class="box">${k.esc(data.memo)}</div>`, cfg) : "",
        sealHtml,
        k.standardFoot(entity, cfg, seals.length ? null : verify, { provenance: k.t(title, lang) }),
      ].join("");
      return k.shell("Payment receipt " + (data.number || ""), body, cfg);
    },
    sampleData: {
      number: "DF-2026-0007 / R1", instalment_no: 1, instalment_count: 2,
      date: "2026-07-28", request_number: "DF-2026-0007", request_approved_at: "2026-07-27",
      dossier_ref: "SBX-2026-0001", amount: 1000000, request_total: 2848000,
      paid_to_date: 1000000, balance: 1848000, amount_in_words: 1000000,
      method: "CASH", treasury_account: "Caisse principale", beneficiary: "DHL Global Forwarding",
      memo: "Première tranche — droits de douane",
      party: { name: "Jean Mballa", lines: ["SLAS-137", "Chef de quai"] },
      seals: [], currency: "XAF",
    },
  },

  /* ── §3.3 — the costing worksheet document ────────────────────────────────
   *
   * WHAT THIS PAGE HAD TO STOP DOING.
   *
   * The legacy sheet prints an estimate whose footer is exactly Subtotal (HT) /
   * VAT / Total Estimate — no margin, no sell price (§2.2). That part was
   * right and is kept. Almost everything around it was not:
   *
   * · IT NAMED NOBODY. No client, no service, no vessel, no B/L. A pricer
   *   prices the SHIPMENT, and the sheet showed a table of charges floating
   *   free of the thing being shipped. Facts come from the SSDC now, and an
   *   empty facet is omitted rather than printed as a dash — a page of dashes
   *   reads as a broken render, not as a file with less on it.
   *
   * · IT PRINTED THE ENUM. `SUBMITTED_FOR_VALIDATION`, on an A4 document, at a
   *   person. `status_words` is a {fr, en} pair and the template picks a side.
   *
   * · ITS VAT COLUMN WAS A PERCENTAGE. "19,25%" on a line, and one VAT figure
   *   at the foot: the reader could see the rate and the total but never the
   *   tax on the line in front of them, so a mispriced line could only be
   *   found with a calculator. There is a VAT AMOUNT column now.
   *
   * · DÉBOURS WERE INVISIBLE UNTIL THE FOOTER. A pass-through charge is
   *   re-billed at cost and carries no VAT of ours; the supplier's own VAT
   *   inside it is disclosed and enters no total. Both are on the line now,
   *   and the débours sub-total sits inside the totals block rather than
   *   trailing it.
   *
   * · A PER-CONTAINER CHARGE HAD NO BOX. Demurrage is one line per container
   *   type, so the sheet printed "Demurrage" twice with two different amounts
   *   and no way to tell which was the 40' (D10). The equipment is part of the
   *   description now.
   *
   * The LETTERHEAD is untouched: it comes from the entity's letterhead tab
   * through `standardHead`, and this rebuilds only the body.
   */
  COSTING: {
    docType: "COSTING", title: { fr: "Cotation", en: "Costing" },
    module: "costing/costing",
    fields: ["shipment facts", "VAT amount per line", "débours sub-total", "remarks", "seals"],
    build: (data, cfg, entity, verify) => {
      const lang = cfg.language;
      const ccy = data.currency || cfg.base_currency || "XAF";
      const t = data.totals || {};
      const seals = Array.isArray(data.seals) ? data.seals : [];
      const title = { fr: "Cotation", en: "Costing" };

      const meta = [
        [{ fr: "Date", en: "Date" }, k.dateFmt(data.date)],
        [{ fr: "Dossier", en: "File" }, data.dossier_ref],
        [{ fr: "Statut", en: "Status" }, data.status_words ? k.t(data.status_words, lang) : data.status],
        // The rate is a fact about the money only when it is doing something.
        // Printing "Rate (XAF): 1" on every sheet in the base currency is a
        // line that teaches the reader to skip the meta strip.
        has(data.exchange_rate) && Number(data.exchange_rate) !== 1
          ? [{ fr: "Taux (XAF)", en: "Rate (XAF)" }, String(data.exchange_rate)]
          : null,
      ].filter((m) => m && m[1]);

      /*
       * THE FACTS. Two sources, in this order: the file's own columns, then
       * the SSDC facets for whatever the service type adds beyond them. Both
       * are dropped when empty by `factsGrid`, so an air file does not print
       * an empty "Vessel" and a warehousing file does not print a route.
       */
      const facets = (data.shipment && data.shipment.facets) || {};
      const order = (data.shipment && data.shipment.facet_order) || [];
      const seen = new Set();
      const facetCells = order.map((role) => {
        const f = facets[role];
        if (!f || !f.value || seen.has(role)) return null;
        seen.add(role);
        return [f.label || role, f.value];
      }).filter(Boolean);

      const factCells = [
        // The client is NOT here: `parties` above already names them, with
        // their identifiers. Printing it twice on one page is how a reader
        // learns the facts grid is padding.
        [{ fr: "Prestation", en: "Service" }, data.service ? k.t(data.service, lang) : null],
        [{ fr: "Transporteur", en: "Carrier" }, data.carrier],
        [{ fr: "Incoterm", en: "Incoterm" }, data.incoterm],
        [{ fr: "Connaissement / LTA", en: "B/L · MAWB" }, data.bl_mawb],
        [{ fr: "Port de chargement", en: "Port of loading" }, data.pol],
        [{ fr: "Port de déchargement", en: "Port of discharge" }, data.pod],
        [{ fr: "ETA", en: "ETA" }, data.eta ? k.dateFmt(data.eta) : null],
      ].filter((c) => c[1]).concat(facetCells);

      /*
       * THE LINES. One column set, built here rather than shared with the
       * invoice family: this document has two columns none of them has (VAT
       * amount, nature) and drops none of theirs, and a shared set that every
       * caller passes flags into is a set that grows a flag per caller.
       */
      const cols = [
        { key: "label", label: { fr: "Désignation", en: "Description" } },
        { key: "qty", label: { fr: "Qté", en: "Qty" }, num: true },
        { key: "unit", label: { fr: "P.U.", en: "Unit" }, num: true },
        { key: "vat", label: { fr: "TVA", en: "VAT" }, num: true },
        { key: "amount", label: { fr: "Montant HT", en: "Amount" }, num: true },
      ];
      const rows = (data.lines || []).map((l) => {
        const amount = has(l.amount) ? Number(l.amount) : Number(l.qty || 1) * Number(l.unit || 0);
        const vatAmount = l.is_disbursement || !has(l.tax) ? null : (amount * Number(l.tax)) / 100;
        // D10 — the equipment a per-container charge was priced FOR, in the
        // description, because that is the only place a reader looks to tell
        // two "Demurrage" lines apart.
        const label = [
          l.item_code ? `${l.item_code} · ` : "",
          l.label,
          l.container_type ? ` — ${l.container_type}` : "",
        ].join("");
        return {
          label,
          qty: has(l.qty) ? String(l.qty) : "",
          unit: has(l.unit) ? k.money(l.unit, ccy, cfg) : "",
          // 12768: the VAT column carries the amount and nothing else — the rate
          // in brackets was noise on a document (the reader has the figure). A
          // débours shows its supplier VAT with (PT) after it, marking a
          // pass-through re-billed at cost; a débours with no VAT shows just (PT).
          vat: l.is_disbursement
            ? (has(l.upstream_vat) && l.upstream_vat > 0
              ? `${k.money(l.upstream_vat, ccy, cfg)} (PT)`
              : "(PT)")
            : (vatAmount === null ? "" : k.money(vatAmount, ccy, cfg)),
          amount: k.money(amount, ccy, cfg),
        };
      });

      const totalsRows = [
        [{ fr: "Sous-total (HT)", en: "Subtotal (HT)" }, k.money(t.total_ht, ccy, cfg)],
        // Inside the block, immediately under the subtotal it qualifies. Débours
        // are re-billed at cost; their net is here, their VAT is in the VAT line.
        has(t.disbursement_total) && Number(t.disbursement_total) > 0
          ? [{ fr: "dont débours (au coût)", en: "of which débours (at cost)" }, k.money(t.disbursement_total, ccy, cfg)]
          : null,
        [{ fr: "TVA", en: "VAT" }, k.money(t.vat_total, ccy, cfg)],
        // 12768: the supplier's VAT on débours is now IN the VAT above; this
        // names how much of it, so the (PT) lines reconcile to the total.
        has(t.upstream_vat_total) && Number(t.upstream_vat_total) > 0
          ? [{ fr: "dont sur débours (PT)", en: "of which on débours (PT)" }, k.money(t.upstream_vat_total, ccy, cfg)]
          : null,
        [{ fr: "Total estimé (TTC)", en: "Total estimate (TTC)" }, k.money(t.total_ttc, ccy, cfg), { grand: true }],
      ];

      /*
       * WHAT MOVED SINCE THE LAST APPROVAL. On paper for the same reason it is
       * on screen: after an unlock somebody is asked to approve the sheet a
       * second time, and they should read the three lines that changed rather
       * than the fourteen that did not.
       */
      const a = data.amendment;
      const amendRow = (l, kind) => `<tr><td>${k.esc(k.t(
        kind === "added" ? { fr: "Ajoutée", en: "Added" }
          : kind === "removed" ? { fr: "Retirée", en: "Removed" }
            : { fr: "Modifiée", en: "Changed" }, lang,
      ))}</td><td>${k.esc(l.label)}</td><td class="num">${k.esc(
        kind === "changed" && has(l.was_amount)
          ? `${k.money(l.was_amount, ccy, cfg)} → ${k.money(l.amount, ccy, cfg)}`
          : k.money(l.amount, ccy, cfg),
      )}</td><td class="num">${k.esc((l.delta >= 0 ? "+" : "") + k.money(l.delta, ccy, cfg))}</td></tr>`;
      // Wrapped so the heading and the rows it introduces stay together: the
      // first render put "Changed since it was approved" at the foot of page 1
      // and what changed on page 2.
      const amendment = a && a.has_changes
        ? `<div style="break-inside:avoid;page-break-inside:avoid">${k.section({ fr: "Modifications depuis l'approbation", en: "Changed since it was approved" },
          `<table class="items"><tbody>${
            (a.changed || []).map((l) => amendRow(l, "changed")).join("")
          }${(a.added || []).map((l) => amendRow(l, "added")).join("")
          }${(a.removed || []).map((l) => amendRow(l, "removed")).join("")
          }</tbody></table><div class="muted" style="margin-top:2mm;font-size:9px">${k.esc(
            `${a.unchanged_count} ${k.t({ fr: "ligne(s) inchangée(s)", en: "line(s) unchanged" }, lang)} · ${k.money(a.before_ht, ccy, cfg)} → ${k.money(a.after_ht, ccy, cfg)} (${a.delta_ht >= 0 ? "+" : ""}${k.money(a.delta_ht, ccy, cfg)})`,
          )}</div>`, cfg)}</div>`
        : "";

      /*
       * THE SEALS. Three, in the order the sheet passed through them: raised,
       * validated, approved. `sealBlock` is titled so each one names the
       * decision it records, because "signed by three people" is not the same
       * document as "raised by A, validated by B, approved by C".
       *
       * The ruled signature block stays as the fallback for an unsealed sheet
       * — a DRAFT printed for a desk review has nobody to seal it yet, and a
       * page with neither seals nor signature lines has no way to be signed at
       * all.
       */
      const sealHtml = seals.length
        /*
         * `signStrip`, not three loose seals. A bare `.seal` is 88mm wide and
         * fixed, so on A4 they stack one per row and the sheet spends half a
         * page on three signatures — which is what the first render did. The
         * strip is the grammar built for exactly this (`.strip .seal` drops the
         * seal's own width and border), so the three sit side by side, each in
         * a titled box that names the decision it records.
         *
         * The title is the strip's, not the seal's: `titled: false` here, or
         * every box would carry the reason twice.
         */
        ? k.signStrip(seals.map((sig) => ({
          // The BOX declares the decision; the seal inside declares who made
          // it. So the reason is not passed down (it would print 4mm under
          // itself), and `titled` drops the "For {company}" row — three
          // repetitions of our own name on our own letterhead, each wrapping
          // to two lines in a 58mm box. §3.12's requirement that a seal say
          // which side it speaks for is met by the box, not dropped: on a
          // costing every seal is ours, and what distinguishes them is the
          // decision, which is exactly what the header now carries.
          title: sig.reason || { fr: "Signature", en: "Signature" },
          html: k.sealBlock({ ...sig, reason: null }, cfg, { titled: true }),
        })), cfg)
        : k.signatureBlock(cfg);

      /*
       * REMARKS — a note per débours FIRST, then whatever the pricer wrote
       * (12768). Every pass-through line gets one line saying what (PT) means:
       * the charge is re-billed at cost and the VAT shown is the supplier's,
       * budgeted into the total. So a reader who meets "(PT)" in the VAT column
       * or the totals has, at the foot of the sheet, the sentence that explains
       * it — and the user's own remarks sit below that, never above it.
       */
      const deboursNotes = (data.lines || [])
        .filter((l) => l.is_disbursement)
        .map((l) => {
          const name = [
            l.item_code ? `${l.item_code} · ` : "",
            l.label,
            l.container_type ? ` — ${l.container_type}` : "",
          ].join("");
          return k.t({
            fr: `(PT) ${name} — débours refacturé au coût ; la TVA indiquée est celle du fournisseur, acquittée pour le compte du client.`,
            en: `(PT) ${name} — disbursement re-billed at cost; the VAT shown is the supplier's, paid on the client's behalf.`,
          }, lang);
        });
      const remarksHtml = deboursNotes.length || data.remarks
        ? k.section({ fr: "Remarques", en: "Remarks" },
          `<div class="box">${
            deboursNotes.map((n) => `<div>${n}</div>`).join("")
          }${
            data.remarks
              ? `<div style="margin-top:${deboursNotes.length ? "2.5mm" : "0"}">${k.esc(data.remarks).replace(/\n/g, "<br>")}</div>`
              : ""
          }</div>`, cfg)
        : "";

      const body = [
        k.standardHead(entity, cfg, { title, number: data.number, meta }),
        k.parties([{
          label: { fr: "Client", en: "Client" },
          name: data.party && data.party.name,
          lines: (data.party && data.party.lines) || [],
        }], cfg),
        factCells.length ? k.ruledBlock({ fr: "Expédition", en: "Shipment" }, k.factsGrid(factCells, cfg, { cols: 3 }), cfg, { bare: true }) : "",
        k.lineTable(cols, rows, cfg),
        k.totals(totalsRows, cfg),
        cfg.show && cfg.show.words !== false && has(data.amount_in_words)
          ? k.wordsBlock(data.amount_in_words, ccy, cfg, data.currency_decimals ?? entity.default_currency_decimals)
          : "",
        amendment,
        remarksHtml,
        sealHtml,
        // One QR per page (§3.12a): a seal already carries it.
        k.standardFoot(entity, cfg, seals.length ? null : verify, {
          provenance: k.t(title, lang),
        }),
      ].join("");
      return k.shell("Costing " + (data.number || ""), body, cfg);
    },
    sampleData: {
      number: "CST-2026-0012", date: "2026-07-27", dossier_ref: "SBX-2026-0001",
      status: "SUBMITTED_FOR_VALIDATION",
      status_words: { fr: "À valider", en: "To validate" },
      client: "CIMENCAM SA",
      party: { name: "CIMENCAM SA", lines: ["NIU P012345678", "RCCM RC/DLA/2004/B/1234"] },
      service: { fr: "Fret maritime import", en: "Sea freight import" },
      carrier: "Maersk", incoterm: "CIF", bl_mawb: "MAEU123456",
      pol: "Antwerp", pod: "Douala", eta: "2026-08-14",
      shipment: null,
      validator: "Jean Mballa",
      lines: [
        { label: "Fret maritime", item_code: "#E014", qty: 2, unit: 500000, tax: 19.25, is_disbursement: false, amount: 1000000 },
        { label: "Surestaries", item_code: "#D077", container_type: "45'HC", qty: 1, unit: 100000, tax: null, is_disbursement: true, upstream_vat: 19250, amount: 100000 },
        { label: "Droits et taxes de douane", item_code: "#-1047", qty: 1, unit: 320000, tax: null, is_disbursement: true, upstream_vat: null, amount: 320000 },
      ],
      // Débours VAT is in the total now (12768): HT 1,420,000; VAT 211,750
      // (192,500 service + 19,250 on the débours); TTC 1,631,750.
      totals: { total_ht: 1420000, vat_total: 211750, total_ttc: 1631750, disbursement_total: 420000, upstream_vat_total: 19250 },
      amount_in_words: 1631750,
      exchange_rate: 1,
      seals: [],
      currency: "XAF",
      remarks: "Taux carrier confirmé le 25/07 — valable 14 jours.",
    },
  },

  REGIE_ADVANCE: {
    docType: "REGIE_ADVANCE", title: { fr: "Régie d'avances", en: "Cash advance (régie)" }, module: "costing/regie", fields: ["float ledger"],
    build: (data, cfg, entity, verify) => {
      const body = [
        k.standardHead(entity, cfg, { title: { fr: "Régie d'avances", en: "Cash advance" }, number: data.number, meta: [[{ fr: "Date", en: "Date" }, k.dateFmt(data.date)]] }),
        k.parties([{ label: { fr: "Régisseur", en: "Float holder" }, name: data.party && data.party.name, lines: (data.party && data.party.lines) || [] }], cfg),
        k.section({ fr: "Montant de l'avance", en: "Advance amount" }, `<div class="box" style="font-size:20px;font-weight:700">${k.money(data.amount, data.currency || cfg.base_currency || "XAF", cfg)}</div>`, cfg),
        data.purpose ? k.section({ fr: "Objet", en: "Purpose" }, `<div class="box">${k.esc(data.purpose)}</div>`, cfg) : "",
        k.signatureBlock(cfg),
        k.standardFoot(entity, cfg, verify),
      ].join("");
      return k.shell("Régie " + (data.number || ""), body, cfg);
    },
    sampleData: { number: "RG-2026-0004", date: "2026-07-27", amount: 1000000, purpose: "Menues dépenses de quai", party: { name: "Alice Ngo", lines: ["Caisse Douala"] }, currency: "XAF" },
  },

  /* ── Phase 4 — HR & remaining operational documents ──────────────────────── */
  PAYSLIP: {
    docType: "PAYSLIP", title: { fr: "Bulletin de paie", en: "Payslip" }, module: "hr/payroll", fields: ["statutory breakdown"],
    build: (d, cfg, entity, verify) => {
      const ccy = d.currency || cfg.base_currency || "XAF";
      const col = [{ key: "label", label: { fr: "Libellé", en: "Item" } }, { key: "amount", label: { fr: "Montant", en: "Amount" }, num: true }];
      const map = (arr) => (arr || []).map((e) => ({ label: e.label, amount: k.money(e.amount, ccy, cfg) }));
      const body = [
        k.standardHead(entity, cfg, { title: { fr: "Bulletin de paie", en: "Payslip" }, number: d.number, meta: [[{ fr: "Période", en: "Period" }, d.period], [{ fr: "Matricule", en: "Staff no." }, d.staff_no]] }),
        k.parties([{ label: { fr: "Salarié", en: "Employee" }, name: d.employee_name, lines: [d.job_title, d.cnps_number && `CNPS ${d.cnps_number}`].filter(Boolean) }], cfg),
        k.section({ fr: "Gains", en: "Earnings" }, k.lineTable(col, map(d.earnings), cfg), cfg),
        k.section({ fr: "Retenues", en: "Deductions" }, k.lineTable(col, map(d.deductions), cfg), cfg),
        k.totals([
          [{ fr: "Salaire brut", en: "Gross" }, k.money(d.gross, ccy, cfg)],
          [{ fr: "Total retenues", en: "Total deductions" }, k.money(d.total_deductions, ccy, cfg)],
          [{ fr: "Net à payer", en: "Net pay" }, k.money(d.net, ccy, cfg), { grand: true }],
        ], cfg),
        k.standardFoot(entity, cfg, verify),
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
        k.standardHead(entity, cfg, { title: { fr: "Contrat de travail", en: "Employment contract" }, number: d.number, meta: [[{ fr: "Type", en: "Type" }, d.kind], [{ fr: "Date d'effet", en: "Effective" }, k.dateFmt(d.effective_on)]] }),
        k.parties([
          { label: { fr: "Employeur", en: "Employer" }, name: entity.legal_name, lines: [entity.address, entity.rccm && `RCCM ${entity.rccm}`].filter(Boolean) },
          { label: { fr: "Salarié", en: "Employee" }, name: d.employee_name, lines: [d.job_title].filter(Boolean) },
        ], cfg),
        arts,
        k.signatureBlock({ ...cfg, show: { ...cfg.show, signature: true } }),
        k.standardFoot(entity, cfg, verify),
      ].join("");
      return k.shell("Contract " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "CT-2026-0007", kind: "CDI", effective_on: "2026-08-01", employee_name: "Jean Mballa", job_title: "Chef de quai", articles: [{ title: "Fonctions / Duties", body: "Le salarié est engagé en qualité de Chef de quai et exercera ses fonctions au port de Douala." }, { title: "Rémunération / Pay", body: "Le salaire brut mensuel est fixé à 850 000 XAF, payable en fin de mois." }, { title: "Durée / Term", body: "Le présent contrat est conclu pour une durée indéterminée (CDI)." }], currency: "XAF" },
  },

  SOP_DOCUMENT: {
    docType: "SOP_DOCUMENT", title: { fr: "Procédure opérationnelle", en: "Standard operating procedure" }, module: "hr/sop_onboarding", fields: ["sections", "review date"],
    build: (d, cfg, entity, verify) => {
      // Same section-per-heading shape as EMPLOYMENT_CONTRACT: the body is
      // markdown cut at its `##` headings, so what a person edited on screen is
      // what the printed procedure is divided into.
      const secs = (d.sections || []).map((a) => k.section({ fr: a.title, en: a.title }, `<div class="box">${k.esc(a.body).replace(/\n/g, "<br>")}</div>`, cfg)).join("");
      const meta = [
        [{ fr: "Portée", en: "Scope" }, d.scope],
        [{ fr: "Version", en: "Version" }, d.version],
        [{ fr: "En vigueur", en: "Effective" }, k.dateFmt(d.effective_on)],
        [{ fr: "Révision", en: "Review" }, k.dateFmt(d.review_on)],
      ];
      const body = [
        k.standardHead(entity, cfg, { title: { fr: d.title, en: d.title }, number: d.number, meta: meta }),
        secs,
        // A procedure is issued, not agreed between two parties — so it carries
        // an owner's sign-off rather than the two-party block a contract uses.
        k.signatureBlock({ ...cfg, show: { ...cfg.show, signature: true } }),
        k.standardFoot(entity, cfg, verify),
      ].join("");
      return k.shell("SOP " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "SOP-2026-0004", title: "Container loading at the quay", scope: "Operations", version: 2, effective_on: "2026-09-01", review_on: "2027-09-01", sections: [{ title: "Purpose", body: "To set out how a container is loaded, sealed and released at the Douala quay." }, { title: "Scope", body: "Applies to whoever is performing this operation, whatever their department." }, { title: "Procedure", body: "1. Confirm the booking reference against the transit order.\n2. Inspect the container and record its condition." }], currency: "XAF" },
  },

  GRN: {
    docType: "GRN", title: { fr: "Bon de réception", en: "Goods-received note" }, module: "wms/inbound", fields: ["QA sign-off"],
    build: (d, cfg, entity, verify) => {
      const col = [{ key: "item", label: { fr: "Article", en: "Item" } }, { key: "ordered", label: { fr: "Commandé", en: "Ordered" }, num: true }, { key: "received", label: { fr: "Reçu", en: "Received" }, num: true }, { key: "condition", label: { fr: "État", en: "Condition" } }];
      const body = [
        k.standardHead(entity, cfg, { title: { fr: "Bon de réception", en: "Goods-received note" }, number: d.number, meta: [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Réf. commande", en: "PO ref" }, d.po_ref], [{ fr: "Contrôle QA", en: "QA" }, d.qa_status]] }),
        k.parties([{ label: { fr: "Fournisseur", en: "Supplier" }, name: d.supplier, lines: [] }], cfg),
        k.lineTable(col, d.lines || [], cfg),
        k.signatureBlock(cfg),
        k.standardFoot(entity, cfg, verify),
      ].join("");
      return k.shell("GRN " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "BR-2026-0044", date: "2026-07-27", po_ref: "BC-2026-0031", qa_status: "Conforme / Passed", supplier: "SDV Cameroun", lines: [{ item: "Ciment 50kg", ordered: "500", received: "500", condition: "Bon" }, { item: "Palettes bois", ordered: "24", received: "22", condition: "2 endommagées" }], currency: "XAF" },
  },

  /**
   * BON DE RÉCEPTION (procurement) — the goods-received note MOD-61 issues
   * against a PO (10720). Distinct from the WMS inbound GRN: it names the
   * supplier, the PO it settles, and the received lines with their condition,
   * so a partial delivery is a document, not a checkbox. `condition` shows as
   * the QA note beside each line.
   */
  GOODS_RECEIVED: {
    docType: "GOODS_RECEIVED", title: { fr: "Bon de réception", en: "Goods-received note" }, module: "procurement/goods_received", fields: ["received lines", "condition", "note"],
    build: (d, cfg, entity, verify) => {
      const col = [
        { key: "item", label: { fr: "Article", en: "Item" } },
        { key: "ordered", label: { fr: "Commandé", en: "Ordered" }, num: true },
        { key: "received", label: { fr: "Reçu", en: "Received" }, num: true },
        { key: "condition", label: { fr: "État", en: "Condition" } },
      ];
      const body = [
        k.standardHead(entity, cfg, { title: { fr: "Bon de réception", en: "Goods-received note" }, number: d.number, meta: [
          [{ fr: "Date", en: "Date" }, k.dateFmt(d.date)],
          [{ fr: "Commande", en: "PO" }, d.po_ref],
          [{ fr: "Facture fournisseur", en: "Supplier invoice" }, d.supplier_invoice_ref],
        ].filter((m) => m[1]) }),
        k.parties([{ label: { fr: "Fournisseur", en: "Supplier" }, name: d.supplier, lines: (d.supplier_lines || []).filter(Boolean) }], cfg),
        k.lineTable(col, d.lines || [], cfg),
        d.note ? k.section({ fr: "Note", en: "Note" }, `<div class="box">${k.esc(d.note)}</div>`, cfg) : "",
        k.signerBlock([
          { label: { fr: "Reçu par", en: "Received by" }, name: d.received_by_name, title: d.received_by_title },
        ], cfg),
        k.standardFoot(entity, cfg, verify),
      ].join("");
      return k.shell("GRN " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "SLAS-GRN-2026-0044", date: "2026-07-27", po_ref: "BC-2026-0031", supplier_invoice_ref: "INV-9921", supplier: "Établissements TENOR", supplier_lines: ["Douala, Cameroun", "NIU M042116033580Q"], lines: [{ item: "Ciment 50kg", ordered: "500", received: "500", condition: "Bon" }, { item: "Palettes bois", ordered: "24", received: "22", condition: "2 endommagées" }], note: "Réception partielle — 2 palettes manquantes à réclamer.", received_by_name: "Jean Mballa", received_by_title: "Chef de quai", currency: "XAF" },
  },

  TRIP_SHEET: {
    docType: "TRIP_SHEET", title: { fr: "Feuille de route", en: "Trip sheet" }, module: "fleet/dispatch", fields: ["odometer out/in"],
    build: (d, cfg, entity, verify) => {
      const body = [
        k.standardHead(entity, cfg, { title: { fr: "Feuille de route", en: "Trip sheet" }, number: d.number, meta: [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)]] }),
        k.parties([{ label: { fr: "Véhicule", en: "Vehicle" }, name: d.vehicle, lines: [] }, { label: { fr: "Chauffeur", en: "Driver" }, name: d.driver, lines: [] }], cfg),
        k.section({ fr: "Itinéraire", en: "Route" }, `<div class="box">${k.esc(d.origin || "")} → ${k.esc(d.destination || "")}</div>`, cfg),
        k.totals([
          [{ fr: "Km départ", en: "Odometer out" }, String(d.odometer_out ?? "")],
          [{ fr: "Km retour", en: "Odometer in" }, String(d.odometer_in ?? "")],
          [{ fr: "Distance", en: "Distance" }, d.distance === null || d.distance === undefined ? "" : `${d.distance} km`, { grand: true }],
        ], cfg),
        k.signatureBlock(cfg),
        k.standardFoot(entity, cfg, verify),
      ].join("");
      return k.shell("Trip sheet " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "FR-2026-0033", date: "2026-07-27", vehicle: "LT-4471", driver: "Paul Ekambi", origin: "Port de Douala", destination: "Yaoundé", odometer_out: 128450, odometer_in: 128712, distance: 262, currency: "XAF" },
  },

  WORK_ORDER: {
    docType: "WORK_ORDER", title: { fr: "Ordre de réparation", en: "Work order" }, module: "fleet/work-orders", fields: ["parts & labour"],
    build: (d, cfg, entity, verify) => {
      const ccy = d.currency || cfg.base_currency || "XAF";
      const col = [{ key: "label", label: { fr: "Pièce / Main d'œuvre", en: "Part / labour" } }, { key: "qty", label: { fr: "Qté", en: "Qty" }, num: true }, { key: "unit", label: { fr: "P.U.", en: "Unit" }, num: true }, { key: "total", label: { fr: "Total", en: "Total" }, num: true }];
      const rows = (d.parts || []).map((p) => ({ label: p.label, qty: String(p.qty), unit: k.money(p.unit_cost, ccy, cfg), total: k.money(Number(p.qty) * Number(p.unit_cost), ccy, cfg) }));
      const body = [
        k.standardHead(entity, cfg, { title: { fr: "Ordre de réparation", en: "Work order" }, number: d.number, meta: [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Statut", en: "Status" }, d.status]] }),
        k.parties([{ label: { fr: "Véhicule", en: "Vehicle" }, name: d.vehicle, lines: [d.description].filter(Boolean) }], cfg),
        k.lineTable(col, rows, cfg),
        k.totals([[{ fr: "Coût total", en: "Total cost" }, k.money(d.cost, ccy, cfg), { grand: true }]], cfg),
        k.standardFoot(entity, cfg, verify),
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
        k.standardHead(entity, cfg, { title: { fr: "Feuille d'inventaire", en: "Cycle-count sheet" }, number: d.number, meta: [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)], [{ fr: "Emplacement", en: "Location" }, d.location]] }),
        k.lineTable(col, (d.lines || []).map((l) => ({ item: l.item, expected: String(l.expected), counted: String(l.counted), variance: String(l.counted - l.expected) })), cfg),
        k.signatureBlock(cfg),
        k.standardFoot(entity, cfg, verify),
      ].join("");
      return k.shell("Count sheet " + (d.number || ""), body, cfg);
    },
    sampleData: { number: "INV-2026-0009", date: "2026-07-27", location: "Zone A · Allée 3", lines: [{ item: "Ciment 50kg", expected: 500, counted: 498 }, { item: "Palettes", expected: 40, counted: 40 }], currency: "XAF" },
  },

  DUNNING_LETTER: {
    docType: "DUNNING_LETTER", title: { fr: "Lettre de relance", en: "Dunning letter" }, module: "finance/smart_receivables", fields: ["tone by ageing"],
    build: (d, cfg, entity, verify) => {
      const ccy = d.currency || cfg.base_currency || "XAF";
      const col = [{ key: "invoice", label: { fr: "Facture", en: "Invoice" } }, { key: "date", label: { fr: "Date", en: "Date" } }, { key: "days", label: { fr: "Retard (j)", en: "Days late" }, num: true }, { key: "amount", label: { fr: "Montant", en: "Amount" }, num: true }];
      const rows = (d.invoices || []).map((i) => ({ invoice: i.ref, date: k.dateFmt(i.date), days: String(i.days_late), amount: k.money(i.amount, ccy, cfg) }));
      const body = [
        k.standardHead(entity, cfg, { title: { fr: "Lettre de relance", en: "Dunning letter" }, number: d.number, meta: [[{ fr: "Date", en: "Date" }, k.dateFmt(d.date)]] }),
        k.parties([{ label: { fr: "À l'attention de", en: "To" }, name: d.client, lines: d.client_lines || [] }], cfg),
        `<p style="margin:14px 2px">${k.esc(d.body || "")}</p>`,
        k.lineTable(col, rows, cfg),
        k.totals([[{ fr: "Total dû", en: "Total due" }, k.money(d.total, ccy, cfg), { grand: true }]], cfg),
        k.signatureBlock(cfg),
        k.standardFoot(entity, cfg, verify),
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
        k.standardHead(entity, cfg, { title: { fr: "Export certifié de conversation", en: "Certified conversation export" }, number: d.number, meta: [[{ fr: "Canal", en: "Channel" }, d.channel], [{ fr: "Période", en: "Period" }, d.period]] }),
        k.section({ fr: "Chaîne de possession", en: "Chain of custody" }, `<div class="box">${k.t({ fr: "Empreinte", en: "Hash" }, cfg.language)}: ${k.esc(d.hash || "—")}</div>`, cfg),
        k.section({ fr: "Messages", en: "Messages" }, msgs || `<div class="muted">—</div>`, cfg),
        k.standardFoot(entity, cfg, verify),
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
  const rows = arr.map((r) => { const o = {}; for (const kk of keys) o[kk] = isNum(r[kk]) ? k.xaf(r[kk], cfg) : String(r[kk] === undefined || r[kk] === null ? "" : r[kk]); return o; });
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
      else scalars.push([humanize(key), isNum(val) ? k.xaf(val, cfg) : String(val)]);
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
    const body = [k.standardHead(entity, cfg, { title: title, meta: meta }), autoBlocks(data, cfg), k.standardFoot(entity, cfg, verify)].join("");
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
  ["dossier_360", { fr: "Dossier 360°", en: "Operations file 360" }, "vault/report", { reference: "SBX-2026-0001", client: "CIMENCAM", statut: "En cours", marge: 620000, jalons: [{ jalon: "Arrivée navire", statut: "Fait" }, { jalon: "Dédouanement", statut: "En cours" }] }],
  ["cash_position", { fr: "Position de trésorerie", en: "Cash position" }, "vault/report", { period: { as_of: "2026-07-31" }, comptes: [{ compte: "Banque Afriland", solde: 4200000 }, { compte: "Mobile money", solde: 300000 }, { compte: "Caisse", solde: 700000 }], total: 5200000 }],
  ["procurement_spend", { fr: "Dépenses achats", en: "Procurement spend" }, "vault/report", { period: { period_code: "2026-07" }, rows: [{ fournisseur: "SDV Cameroun", commandes: 3, montant: 3200000 }, { fournisseur: "TENOR", commandes: 1, montant: 900000 }], total: 4100000 }],
  ["dossier_margin_portfolio", { fr: "Portefeuille des marges", en: "Margin portfolio" }, "vault/report", { period: { period_code: "2026-07" }, rows: [{ dossier: "SBX-2026-0001", facture: 1607900, cout: 987900, marge: 620000, taux: "38%" }] }],
];
const TAX_SPECS = [
  ["VAT_RETURN", { fr: "Déclaration TVA", en: "VAT return" }, "finance/tax_declaration", { period: { period_code: "2026-07" }, tva_collectee: 3560000, tva_deductible: 1193000, net_a_payer: 2367000 }],
  ["DSF", { fr: "Déclaration Statistique et Fiscale", en: "DSF" }, "finance/tax_declaration", {
    period: { period_code: "2026" }, chiffre_affaires: 19400000, resultat: 9100000, impot_societes: 3003000,
    produits: [{ poste: "70 Ventes de services", montant: 18500000 }, { poste: "75 Autres produits", montant: 900000 }],
    charges: [{ poste: "60 Achats", montant: 6200000 }, { poste: "64 Charges de personnel", montant: 4100000 }],
    actif: [{ poste: "Immobilisations", montant: 12000000 }, { poste: "Créances clients", montant: 4600000 }, { poste: "Trésorerie", montant: 5200000 }],
    passif: [{ poste: "Capital", montant: 10000000 }, { poste: "Résultat net", montant: 9100000 }, { poste: "Dettes fournisseurs", montant: 2700000 }],
  }],
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
  return `<table class="items" style="max-width:560px"><tbody>${rows.map((r) => `<tr${r[2] ? ` style="background:${cfg.accent || "#F5821F"}0d"` : ""}><td${r[2] ? ' style="font-weight:700"' : ""}>${k.esc(r[0])}</td><td class="num"${r[2] ? ' style="font-weight:700"' : ""}>${k.xaf(r[1], cfg)}</td></tr>`).join("")}</tbody></table>`;
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
    k.standardHead(entity, cfg, { title: { fr: "Déclaration de TVA", en: "VAT return" }, meta: meta }),
    k.section({ fr: "Taux", en: "Rate" }, `<div class="box">TVA 19,25% — droit commun / standard rate</div>`, cfg),
    k.section({ fr: "Liquidation", en: "Computation" }, formTable([
      [k.t({ fr: "TVA collectée (aval)", en: "Output VAT (collected)" }, cfg.language), collected],
      [k.t({ fr: "TVA déductible (amont)", en: "Input VAT (deductible)" }, cfg.language), deductible],
      [k.t({ fr: "TVA nette", en: "Net VAT" }, cfg.language), net],
      [k.t({ fr: "TVA à payer", en: "VAT due" }, cfg.language), due, true],
      [k.t({ fr: "Crédit à reporter", en: "Credit carried forward" }, cfg.language), credit],
    ], cfg), cfg),
    k.standardFoot(entity, cfg, verify),
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
  const trows = rows.map((r) => { const o = {}; for (const c of cols) o[c.key] = c.num ? k.xaf(r[c.key], cfg) : (r[c.key] || ""); return o; });
  const period = data.period && (data.period.period_code || "");
  const meta = [entity.legal_name ? [{ fr: "Employeur", en: "Employer" }, entity.legal_name] : null, period ? [{ fr: "Période", en: "Period" }, period] : null].filter(Boolean);
  const body = [
    k.standardHead(entity, cfg, { title: { fr: "Déclaration CNPS (DIPE)", en: "CNPS declaration" }, meta: meta }),
    rows.length ? k.section({ fr: "Détail des cotisations", en: "Contributions detail" }, k.lineTable(cols, trows, cfg), cfg) : "",
    k.section({ fr: "Récapitulatif", en: "Summary" }, formTable([
      [k.t({ fr: "Pension — part salariale (4,2%)", en: "Pension — employee (4.2%)" }, cfg.language), firstNum(totals.employee_pension, data.part_salariale)],
      [k.t({ fr: "Pension — part patronale (4,2%)", en: "Pension — employer (4.2%)" }, cfg.language), firstNum(totals.employer_pension)],
      [k.t({ fr: "Prestations familiales (7%)", en: "Family benefits (7%)" }, cfg.language), firstNum(totals.employer_family)],
      [k.t({ fr: "Accidents du travail", en: "Work-injury" }, cfg.language), firstNum(totals.employer_injury)],
      [k.t({ fr: "TOTAL À VERSER", en: "TOTAL DUE" }, cfg.language), firstNum(totals.total, data.total_a_verser), true],
    ], cfg), cfg),
    `<p class="muted" style="margin-top:8px">${k.t({ fr: "Plafond mensuel", en: "Monthly ceiling" }, cfg.language)}: ${k.xaf(750000, cfg)}</p>`,
    k.standardFoot(entity, cfg, verify),
  ].join("");
  return k.shell("CNPS declaration", body, cfg);
}

function dsfBuild(data, cfg, entity, verify) {
  const ca = firstNum(data.chiffre_affaires, data.revenue, data.turnover);
  const result = firstNum(data.resultat, data.result, data.net_result);
  const isRate = data.is_rate !== undefined ? Number(data.is_rate) : 33; // Cameroon IS 30% + 10% CAC.
  const is = data.impot_societes !== undefined ? Number(data.impot_societes) : Math.round(Math.max(result, 0) * isRate / 100);
  const period = data.period && (data.period.period_code || data.period.as_of || "");
  const meta = [
    entity.legal_name ? [{ fr: "Contribuable", en: "Taxpayer" }, entity.legal_name] : null,
    entity.niu ? [{ fr: "NIU", en: "Tax ID" }, entity.niu] : null,
    entity.rccm ? [{ fr: "RCCM", en: "Trade reg." }, entity.rccm] : null,
    period ? [{ fr: "Exercice", en: "Fiscal year" }, period] : null,
  ].filter(Boolean);
  const stmtCols = (labelPair) => [{ key: "poste", label: labelPair }, { key: "montant", label: { fr: "Montant", en: "Amount" }, num: true }];
  const mapStmt = (arr) => arr.map((r) => ({ poste: r.poste || r.compte || "", montant: k.xaf(firstNum(r.montant, r.amount), cfg) }));
  const produits = data.produits || [], charges = data.charges || [], actif = data.actif || [], passif = data.passif || [];
  const sections = [
    k.standardHead(entity, cfg, { title: { fr: "Déclaration Statistique et Fiscale (DSF)", en: "Statistical & tax return (DSF)" }, meta: meta }),
    k.section({ fr: "Cadre A — Identification", en: "Section A — Identification" }, `<div class="box">${k.t({ fr: "Régime du réel — Système comptable OHADA (SYSCOHADA révisé)", en: "Actual regime — OHADA accounting (revised SYSCOHADA)" }, cfg.language)}</div>`, cfg),
  ];
  if (produits.length || charges.length) {
    sections.push(k.section({ fr: "Cadre B — Compte de résultat", en: "Section B — Income statement" }, [
      produits.length ? k.lineTable(stmtCols({ fr: "Produits", en: "Income" }), mapStmt(produits), cfg) : "",
      charges.length ? k.lineTable(stmtCols({ fr: "Charges", en: "Expenses" }), mapStmt(charges), cfg) : "",
    ].join(""), cfg));
  }
  if (actif.length || passif.length) {
    sections.push(k.section({ fr: "Cadre C — Bilan", en: "Section C — Balance sheet" }, [
      actif.length ? k.lineTable(stmtCols({ fr: "Actif", en: "Assets" }), mapStmt(actif), cfg) : "",
      passif.length ? k.lineTable(stmtCols({ fr: "Passif", en: "Liabilities & equity" }), mapStmt(passif), cfg) : "",
    ].join(""), cfg));
  }
  sections.push(
    k.section({ fr: "Cadre D — Détermination de l'impôt", en: "Section D — Tax computation" }, formTable([
      [k.t({ fr: "Chiffre d'affaires", en: "Turnover" }, cfg.language), ca],
      [k.t({ fr: "Résultat de l'exercice", en: "Result for the year" }, cfg.language), result],
      [`${k.t({ fr: "Impôt sur les sociétés", en: "Corporate income tax" }, cfg.language)} (${isRate}%)`, is, true],
    ], cfg), cfg),
    `<p class="muted" style="margin-top:8px">${k.t({ fr: "Résumé structuré SYSCOHADA — à compléter sur la liasse officielle DGI.", en: "Structured SYSCOHADA summary — file on the official DGI liasse." }, cfg.language)}</p>`,
    k.standardFoot(entity, cfg, verify),
  );
  return k.shell("DSF", sections.join(""), cfg);
}

/* ── The Certificate of Completion (SIGNATURE_ENGINEERING_GUIDE §6.7) ────────
 *
 * Written as a function rather than inline in TEMPLATES because it is the one
 * document in the registry whose CONTENT is an argument about evidence rather
 * than a business record — it has seven mandated sections, in a mandated
 * order, and each one is there because a dispute would ask for it.
 *
 * Two things it does that no other template does:
 *
 *   · It prints the FULL hashes. Everywhere else in this programme a digest is
 *     truncated to sixteen and labelled (§3.12), because an unlabelled
 *     fragment invites a reader to think it is the whole thing. Here the whole
 *     thing is the point: a reader is meant to be able to recompute it.
 *   · It carries NO verification block of its own. The certificate is not a
 *     signed document — it is the evidence ABOUT one — and printing a QR that
 *     resolved to the certificate itself would be a circle. It prints the
 *     SUBJECT document's code instead, in §6.7 item 6.
 */
function certificateBuild(d, cfg, entity) {
  const L = cfg.language === "en" ? "en" : "fr";
  const T = (fr, en) => k.t({ fr, en }, cfg.language);
  const rows = (pairs) => `<table class="items" style="width:100%"><tbody>${pairs
    .filter((p) => p && p[1] !== null && p[1] !== undefined && p[1] !== "")
    .map(([label, value, mono]) => `<tr><td style="width:38%;color:#6B7A90">${k.esc(label)}</td><td${mono ? ' style="font-family:monospace;word-break:break-all"' : ""}>${k.esc(value)}</td></tr>`)
    .join("")}</tbody></table>`;

  const when = (s) => (s && s.utc ? `${s.local || s.utc}${s.local ? ` (${s.utc})` : ""}` : "");

  const body = [
    k.standardHead(entity, cfg, { title: { fr: "Certificat d'exécution", en: "Certificate of completion" }, number: String(d.request_id || "").slice(0, 8).toUpperCase(), meta: [[{ fr: "Terminé le", en: "Completed" }, when(d.completed_at)],
        [{ fr: "Signatures", en: "Signatures" }, `${d.chain.signed} / ${d.chain.of}`]] }),

    // 1. Document identity.
    k.section({ fr: "1. Le document", en: "1. The document" }, rows([
      [T("Type", "Type"), d.document.doc_type],
      [T("Référence", "Reference"), d.document.reference],
      [T("Référence interne", "Internal reference"), d.document.entity_ref],
      [T("Version du format", "Payload version"), String(d.document.payload_version)],
      [T("Empreinte du contenu", "Content hash"), d.document.content_hash, true],
      [T("Empreinte du fichier", "Artifact hash"), d.document.artifact_hash, true],
    ]), cfg),

    d.document.as_signed
      ? k.section({ fr: "1b. Le document tel que signé", en: "1b. The document as signed" },
        rows(d.document.as_signed.fields.map((f) => [f.label, f.value])), cfg)
      : "",

    // 2. Every party, with the provenance of their address.
    k.section({ fr: "2. Les parties", en: "2. The parties" },
      d.parties.map((p) => `<div class="box" style="margin-bottom:8px">${rows([
        [T("Ordre", "Order"), `${p.sequence_no} — ${p.party_kind}`],
        [T("Nom", "Name"), [p.full_name, p.party_role].filter(Boolean).join(" · ")],
        [T("Adresse", "Address"), p.email],
        [T("Origine de l'adresse", "Provenance of the address"), p.source_words],
        [T("Saisie par", "Entered by"), p.override_by],
        [T("Motif de la saisie", "Reason given"), p.override_reason],
        [T("Statut", "Status"), p.status],
        [T("Motif du refus", "Decline reason"), p.decline_reason],
        [T("Envoyé", "Sent"), when(p.sent_at)],
        [T("Consulté", "Viewed"), when(p.viewed_at)],
        [T("Réglé", "Settled"), when(p.settled_at)],
      ])}</div>`).join(""), cfg),

    // 3. Every signing act — the evidence ACTUALLY collected.
    k.section({ fr: "3. Les actes de signature", en: "3. The signing acts" },
      d.acts.map((a) => `<div class="box" style="margin-bottom:8px">${rows([
        [T("Signataire", "Signer"), [a.signer_name, a.signer_role].filter(Boolean).join(" · ")],
        [T("Pour", "On behalf of"), a.party],
        [T("Identité", "Identity"), a.identity_words],
        [T("Méthode retenue", "Method offered"), a.preset_code],
        [T("Preuve recueillie", "Evidence collected"), a.assurance_level],
        [T("Motif", "Reason"), a.sign_reason],
        [T("Signé", "Signed"), when(a.signed_at)],
        [a.ip_masked ? T("Réseau (masqué)", "Network (masked)") : T("Adresse IP", "IP address"), a.ip],
        [T("Appareil", "Device"), a.device],
        [T("Empreinte signée", "Hash signed"), a.content_hash, true],
        [T("Code de vérification", "Verification code"), a.verify_code],
      ])}</div>`).join(""), cfg),

    // 4. The identity proof. The part a dispute turns on.
    k.section({ fr: "4. Preuve d'identité (codes e-mail)", en: "4. Identity proof (email codes)" },
      d.challenges.length
        ? d.challenges.map((c) => `<div class="box" style="margin-bottom:8px">${rows([
          [T("Partie", "Party"), c.party_name],
          [T("Envoyé à", "Sent to"), c.sent_to],
          [T("Envoyé", "Sent"), when(c.sent_at)],
          [T("Vérifié", "Verified"), when(c.verified_at)],
          [T("Tentatives", "Attempts"), String(c.attempts)],
          [T("Renvois", "Resends"), String(c.resends)],
          [T("Lié à l'empreinte", "Bound to hash"), c.bound_to_content_hash, true],
        ])}</div>`).join("")
        : `<div class="box">${k.esc(T("Aucun code n'a été requis pour cette chaîne.", "No emailed code was required for this chain."))}</div>`, cfg),

    // 5. The timeline, with correlation ids.
    k.section({ fr: "5. Journal des événements", en: "5. Event timeline" },
      k.lineTable(
        [{ key: "at", label: { fr: "Horodatage", en: "Timestamp" } },
          { key: "action", label: { fr: "Événement", en: "Event" } },
          { key: "actor", label: { fr: "Acteur", en: "Actor" } },
          { key: "request_id", label: { fr: "Corrélation", en: "Correlation" } }],
        d.timeline.map((e) => ({ at: when(e.at), action: e.action, actor: e.actor || "—", request_id: e.request_id || "—" })),
        cfg,
      ), cfg),

    // 6. How to re-check it independently, a decade from now.
    d.verification
      ? k.section({ fr: "6. Vérification indépendante", en: "6. Independent verification" }, rows([
        [T("Page de vérification", "Verification page"), d.verification.url],
        [T("Code", "Code"), d.verification.code],
        [T("Comment faire", "How"), d.verification.instructions],
      ]), cfg)
      : "",

    // 7. Who issued it.
    d.issuer
      ? k.section({ fr: "7. Émetteur", en: "7. Issuer" }, rows([
        [T("Raison sociale", "Legal name"), d.issuer.legal_name],
        ["RCCM", d.issuer.rccm],
        ["NIU", d.issuer.niu],
        [T("Adresse", "Address"), d.issuer.address],
      ]), cfg)
      : "",

    `<p class="muted" style="margin-top:14px;font-size:9.5px">${k.esc(T(
      `Document généré le ${when(d.generated_at)}. Il est produit une seule fois et archivé ; une régénération produirait un fichier différent.`,
      `Generated ${when(d.generated_at)}. Produced once and archived — a regenerated copy would be a different file.`,
    ))}</p>`,
    // No verify block: see the header. `null` rather than an omitted argument
    // so a reader sees the decision rather than an oversight.
    k.standardFoot(entity, cfg, null),
  ].join("");

  return k.shell(`Certificate ${String(d.request_id || "").slice(0, 8)}`, body, { ...cfg, language: L });
}

TEMPLATES.SIGNATURE_CERTIFICATE = {
  docType: "SIGNATURE_CERTIFICATE",
  title: { fr: "Certificat d'exécution", en: "Certificate of completion" },
  module: "vault/signature_request",
  fields: ["evidence sections (fixed)"],
  build: certificateBuild,
  sampleData: {
    request_id: "3f9c1a20-0000-0000-0000-000000000000",
    language: "en",
    completed_at: { utc: "2026-03-11 09:14:02 UTC", local: "11 Mar 2026, 10:14:02 WAT" },
    generated_at: { utc: "2026-03-11 09:14:05 UTC", local: "11 Mar 2026, 10:14:05 WAT" },
    chain: { signed: 2, of: 2 },
    document: {
      doc_type: "FINAL_INVOICE", reference: "FCT-2026-0001", entity_ref: "final_invoice:abc",
      payload_version: 1,
      content_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      artifact_hash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      as_signed: { doc_type: "FINAL_INVOICE", title: "Invoice", fields: [{ key: "number", label: "Reference", value: "FCT-2026-0001" }], detail: null },
    },
    parties: [], acts: [], challenges: [], timeline: [],
    verification: { url: "https://smartls.praxisls.com/v/A4B7K92MXQ1P", code: "A4B7-K92M-XQ1P", instructions: "Enter this code on the issuer's verification page." },
    issuer: { legal_name: "SMART LOGISTICS SARL", rccm: "RC/DLA/2019/B/1234", niu: "M011912345678K", address: "Bonanjo, Douala" },
  },
};

TEMPLATES.VAT_RETURN.build = vatReturnBuild;
TEMPLATES.VAT_RETURN.fields = ["official TVA layout"];
TEMPLATES.CNPS_DECLARATION.build = cnpsBuild;
TEMPLATES.CNPS_DECLARATION.fields = ["official DIPE layout"];
TEMPLATES.DSF.build = dsfBuild;
TEMPLATES.DSF.fields = ["SYSCOHADA structured layout"];

const list = () => Object.values(TEMPLATES).map((t) => ({ docType: t.docType, title: t.title, module: t.module, fields: t.fields || [], report: !!t.report }));
const get = (docType) => TEMPLATES[docType] || null;

/* ── The covering email ──────────────────────────────────────────────────── */

/**
 * The subject and body a document is emailed under.
 *
 * ── Why it lives beside the template ───────────────────────────────────────
 * Because it is the same document. The sheet and the note that carries it say
 * the same thing to the same person on the same day, and the one way to
 * guarantee they never contradict each other is to write them in one place.
 * The alternative — wording typed into a screen — drifts from the document the
 * first time a doc type changes shape, and nobody notices until a client is
 * told to sign something the attachment does not ask for.
 *
 * ── Monolingual, by the same rule as the sheet ─────────────────────────────
 * {fr,en} pairs resolved through `k.t`. A French document must not arrive under
 * an English subject line: that is the same defect as "Ordre de transit /
 * Transit order" on the page, wearing an envelope.
 *
 * ── The optional segment ───────────────────────────────────────────────────
 * `[[ … {token} … ]]` drops entirely when a token inside it is empty. A note
 * raised outside a file has no reference, and "concerne le dossier " with
 * nothing after it is worse than a sentence that never mentions one.
 */
const EMAIL_TOKENS = (data = {}, entity = {}) => ({
  number: data.number || "",
  dossier_ref: data.dossier_ref || "",
  date: k.dateFmt(data.date) || "",
  delivery_date: k.dateFmt(data.delivery_date) || "",
  party_name: (data.party && data.party.name) || "",
  entity_name: entity.legal_name || "",
});

/**
 * Fill one template string. Unknown tokens resolve to empty rather than
 * printing their own braces at a client — a typo in the wording above should
 * read as a missing word, not as machinery showing through.
 */
function fillCopy(text, tokens) {
  return String(text || "")
    // Optional segments first: the whole segment goes if any token in it is empty.
    .replace(/\[\[([\s\S]*?)\]\]/g, (_m, seg) => {
      const names = [...String(seg).matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
      if (names.some((n) => !tokens[n])) return "";
      return seg;
    })
    .replace(/\{(\w+)\}/g, (_m, name) => tokens[name] || "")
    // Interpolation can leave doubled spaces where a token was empty.
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * The subject and body for one document, in one language.
 *
 * Returns null for a doc type with no wording of its own — the caller then
 * opens an empty composer, which is honest. Inventing a generic "Please find
 * attached" for a payslip would put our words on a document nobody wrote them
 * for.
 */
function emailCopy(docType, data = {}, { language = "fr", entity = {} } = {}) {
  const tpl = get(docType);
  if (!tpl || !tpl.email) return null;
  const tokens = EMAIL_TOKENS(data, entity);
  return {
    subject: fillCopy(k.t(tpl.email.subject, language), tokens),
    body: fillCopy(k.t(tpl.email.body, language), tokens),
  };
}

module.exports = { TEMPLATES, list, get, emailCopy, fillCopy };
