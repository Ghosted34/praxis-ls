/**
 * Slash commands — the manifest.
 *
 * Typing `/invoice INV-2026-0007` in the composer inserts a rendered block of
 * that invoice's real figures. Same shape and same discipline as a
 * `<module>.ai.js` manifest: a command declares the module it belongs to and the
 * permission the caller must hold, and the registry filters the list per user.
 *
 * ── A COMMAND CAN NEVER READ MORE THAN THE PERSON TYPING IT COULD ───────────
 *
 * This is the whole security model and it is worth being explicit about, because
 * the failure mode is quiet. A composer is a place where an operator can ask the
 * system for data and paste it into a message that leaves the company. If
 * `/bank` did not check MOD-09, a junior clerk who cannot open Treasury could
 * still put the company's account details into an email — and nothing in the
 * mail module would look wrong.
 *
 * So: the `permission` pair here is the SAME pair the module's own routes use,
 * `resolve` calls the module's SERVICE (never SQL, so the service's own
 * confidentiality rules and joins apply), and the registry filters the list
 * before the user ever sees it. A command they may not run is not offered.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * TO ADD A COMMAND WHEN YOU BUILD A NEW MODULE
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  1. Add an entry below with a unique `key`. That becomes "/key" in the editor.
 *
 *  2. `module_key` + `permission` — the SAME pair the module's routes use. Copy
 *     it from the module's `.routes.js`; do not invent one. Two rules:
 *       · If the module has no read grant that fits, the command does not belong
 *         in mail yet. Add the grant to the module first.
 *       · VERIFY THE KEY AGAINST platform.module_catalogue. A key that is not in
 *         the catalogue has grants for nobody and 403s every non-CEO user — the
 *         MOD-29 lesson, and this file was written against a plan whose six
 *         suggested keys were five-sixths wrong.
 *
 *  3. `resolve(client, params, ctx)` — call the module's SERVICE. `ctx` carries
 *     `{ user, thread, boundEntityRef, lang }`, so a command can default to the
 *     conversation's bound client rather than asking for an id the operator
 *     would have to go and look up.
 *
 *  4. `render(data, lang)` — return `{ label, nodes }`, where `nodes` is TipTap
 *     content. NOT AN HTML STRING: the serializer refuses to emit markup from a
 *     document, because a TipTap document arrives in a request body and anything
 *     rendered verbatim from it would be an injection. Build paragraphs and
 *     tables; they are escaped like everything else.
 *
 *  5. Render in `lang` ('en' | 'fr'), falling back to 'en'.
 *
 *  6. Add a case to tests/unit/mail-commands.test.js asserting the permission is
 *     enforced. There is a table-driven test that will pick it up automatically
 *     if the entry is well formed, and a separate one that fails if the key is
 *     not in the catalogue.
 *
 * THERE IS NO CENTRAL WIRING STEP. The registry walks this file at boot.
 * ══════════════════════════════════════════════════════════════════════════
 */
"use strict";

const { AppError } = require("../../../utils/errors");

/* ── Rendering helpers ────────────────────────────────────────────────────── */

const text = (s) => ({ type: "text", text: String(s ?? "") });
const para = (s) => ({ type: "paragraph", content: [text(s)] });
const bold = (s) => ({ type: "text", text: String(s ?? ""), marks: [{ type: "bold" }] });

/** A two-column label/value table — the shape every one of these blocks wants. */
const rows = (pairs) => ({
  type: "table",
  content: pairs.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => ({
    type: "tableRow",
    content: [
      { type: "tableCell", content: [{ type: "paragraph", content: [bold(k)] }] },
      { type: "tableCell", content: [para(v)] },
    ],
  })),
});

/** XAF has no minor unit in practice; a decimal here reads as an error. */
const money = (n, ccy = "XAF") =>
  (n === null || n === undefined || n === "") ? null
    : `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} ${ccy}`;

const date = (d) => (d ? String(d).slice(0, 10) : null);

/** EN/FR only, per Q26. An unknown language falls back rather than blanking. */
const T = (lang, en, fr) => (String(lang || "en").toLowerCase().startsWith("fr") ? fr : en);

/**
 * The one id a command was given, or the conversation's bound entity.
 *
 * Falling back to the thread's binding is most of the value: an operator reading
 * a thread already bound to a dossier should be able to type `/dossier` and get
 * THIS one, rather than looking up a reference to paste into their own message.
 */
function idFrom(params, ctx, prefix) {
  const given = params && (params.id || params.ref || params[0]);
  if (given) return String(given).trim();
  const ref = ctx && ctx.boundEntityRef;
  if (ref && String(ref).startsWith(`${prefix}:`)) return String(ref).slice(prefix.length + 1);
  return null;
}

/**
 * The "which one?" question, given as a whole phrase per command rather than
 * composed from a noun.
 *
 * Composing it — `Quel ${noun} ?` — produces "Quel facture ?", which is wrong:
 * *facture* is feminine and takes *quelle*. French agreement cannot be derived
 * from an English template, and a product that speaks broken French to a Douala
 * customs desk has told them what it thinks of them. So each command supplies
 * both sentences, written out.
 */
const needId = (id, lang, ask) => {
  if (id) return id;
  const tail = T(lang,
    " Give a reference, or open this from a conversation linked to one.",
    " Indiquez une référence, ou ouvrez ceci depuis une conversation qui y est liée.");
  throw new AppError("VALIDATION_ERROR", `${T(lang, ask.en, ask.fr)}${tail}`, 422);
};

/** The phrases. Kept together so a reviewer can check the French in one place. */
const ASK = {
  invoice: { en: "Which invoice?", fr: "Quelle facture ?" },
  proforma: { en: "Which proforma?", fr: "Quel proforma ?" },
  quotation: { en: "Which quotation?", fr: "Quel devis ?" },
  costing: { en: "Which costing?", fr: "Quel chiffrage ?" },
  po: { en: "Which purchase order?", fr: "Quel bon de commande ?" },
  dossier: { en: "Which shipment?", fr: "Quel dossier ?" },
  document: { en: "Which document?", fr: "Quel document ?" },
  bank: { en: "Which account?", fr: "Quel compte ?" },
};

/* ── The manifest ─────────────────────────────────────────────────────────── */

module.exports = [
  {
    key: "invoice",
    module_key: "MOD-51",              // Final Invoice
    permission: "view",
    params: ["invoice_no?"],
    label_en: "Invoice", label_fr: "Facture",
    describe_en: "Insert a final invoice's reference, dates and amount.",
    describe_fr: "Insérer la référence, les dates et le montant d'une facture.",
    resolve: (client, params, ctx) => require("../../finance/final_invoice/final_invoice.service")
      .get(client, needId(idFrom(params, ctx, "invoice"), ctx.lang, ASK.invoice)),
    render: (d, lang) => ({
      label: `${T(lang, "Invoice", "Facture")} ${d.invoice_no || d.ref || ""}`.trim(),
      nodes: [rows([
        [T(lang, "Reference", "Référence"), d.invoice_no || d.ref],
        [T(lang, "Date", "Date"), date(d.invoice_date || d.issued_on)],
        [T(lang, "Due", "Échéance"), date(d.due_date)],
        [T(lang, "Total", "Total"), money(d.total_ttc ?? d.total, d.currency)],
        [T(lang, "Outstanding", "Reste à payer"), money(d.balance_due, d.currency)],
        [T(lang, "Status", "Statut"), d.status],
      ])],
    }),
  },
  {
    key: "proforma",
    module_key: "MOD-50",              // Proforma & Advance Invoices
    permission: "view",
    params: ["proforma_no?"],
    label_en: "Proforma", label_fr: "Proforma",
    describe_en: "Insert a proforma's reference, validity and amount.",
    describe_fr: "Insérer la référence, la validité et le montant d'un proforma.",
    resolve: (client, params, ctx) => require("../../finance/proforma/proforma.service")
      .get(client, needId(idFrom(params, ctx, "proforma"), ctx.lang, "proforma")),
    render: (d, lang) => ({
      label: `${T(lang, "Proforma", "Proforma")} ${d.proforma_no || d.ref || ""}`.trim(),
      nodes: [rows([
        [T(lang, "Reference", "Référence"), d.proforma_no || d.ref],
        [T(lang, "Date", "Date"), date(d.issued_on || d.created_at)],
        [T(lang, "Valid until", "Valable jusqu'au"), date(d.valid_until)],
        [T(lang, "Total", "Total"), money(d.total_ttc ?? d.total, d.currency)],
        [T(lang, "Status", "Statut"), d.status],
      ])],
    }),
  },
  {
    key: "quotation",
    module_key: "MOD-27",              // Margin Simulator (owns quotations)
    permission: "view",
    params: ["quotation_no?"],
    label_en: "Quotation", label_fr: "Devis",
    describe_en: "Insert a quotation's reference, validity and total.",
    describe_fr: "Insérer la référence, la validité et le total d'un devis.",
    resolve: (client, params, ctx) => require("../../commercial/quotation/quotation.service")
      .get(client, needId(idFrom(params, ctx, "quotation"), ctx.lang, ASK.quotation)),
    render: (d, lang) => ({
      label: `${T(lang, "Quotation", "Devis")} ${d.quotation_no || d.ref || ""}`.trim(),
      nodes: [rows([
        [T(lang, "Reference", "Référence"), d.quotation_no || d.ref],
        [T(lang, "Date", "Date"), date(d.issued_on || d.created_at)],
        [T(lang, "Valid until", "Valable jusqu'au"), date(d.valid_until)],
        [T(lang, "Total", "Total"), money(d.total_ttc ?? d.total, d.currency)],
        [T(lang, "Status", "Statut"), d.status],
      ])],
    }),
  },
  {
    key: "costing",
    module_key: "MOD-46",              // Project Costing
    permission: "view",
    params: ["costing_no?"],
    label_en: "Costing", label_fr: "Chiffrage",
    describe_en: "Insert a costing's reference, total and margin.",
    describe_fr: "Insérer la référence, le total et la marge d'un chiffrage.",
    resolve: (client, params, ctx) => require("../../costing/costing/costing.service")
      .get(client, needId(idFrom(params, ctx, "costing"), ctx.lang, ASK.costing)),
    render: (d, lang) => ({
      label: `${T(lang, "Costing", "Chiffrage")} ${d.costing_no || d.ref || ""}`.trim(),
      nodes: [rows([
        [T(lang, "Reference", "Référence"), d.costing_no || d.ref],
        [T(lang, "Total cost", "Coût total"), money(d.total_cost, d.currency)],
        [T(lang, "Selling price", "Prix de vente"), money(d.total_selling ?? d.total_price, d.currency)],
        [T(lang, "Status", "Statut"), d.status],
      ])],
    }),
  },
  {
    key: "po",
    module_key: "MOD-60",              // Purchase Orders
    permission: "view",
    params: ["po_no?"],
    label_en: "Purchase order", label_fr: "Bon de commande",
    describe_en: "Insert a purchase order's reference, supplier and total.",
    describe_fr: "Insérer la référence, le fournisseur et le total d'un bon de commande.",
    resolve: (client, params, ctx) => require("../../procurement/purchase_order/purchase_order.service")
      .get(client, needId(idFrom(params, ctx, "purchase_order"), ctx.lang, ASK.po)),
    render: (d, lang) => ({
      label: `${T(lang, "Purchase order", "Bon de commande")} ${d.po_no || d.ref || ""}`.trim(),
      nodes: [rows([
        [T(lang, "Reference", "Référence"), d.po_no || d.ref],
        [T(lang, "Supplier", "Fournisseur"), d.supplier_name],
        [T(lang, "Date", "Date"), date(d.order_date || d.created_at)],
        [T(lang, "Total", "Total"), money(d.total_ttc ?? d.total, d.currency)],
        [T(lang, "Status", "Statut"), d.status],
      ])],
    }),
  },
  {
    key: "dossier",
    module_key: "MOD-29",              // Operations File Registry
    permission: "view",
    params: ["dossier_ref?"],
    label_en: "Shipment status", label_fr: "Statut du dossier",
    // The single most-typed thing in a forwarder's day, which is why it is here
    // even though it is the one command with no document behind it.
    describe_en: "Insert a shipment's current status, vessel and dates.",
    describe_fr: "Insérer le statut actuel d'un dossier, le navire et les dates.",
    resolve: (client, params, ctx) => require("../../operations/operations_file/operations_file.service")
      .get(client, needId(idFrom(params, ctx, "dossier"), ctx.lang, ASK.dossier)),
    render: (d, lang) => ({
      label: `${T(lang, "Shipment", "Dossier")} ${d.file_ref || d.ref || ""}`.trim(),
      nodes: [rows([
        [T(lang, "Reference", "Référence"), d.file_ref || d.ref],
        [T(lang, "Client", "Client"), d.client_name],
        [T(lang, "Mode", "Mode"), d.transport_mode],
        [T(lang, "Vessel / flight", "Navire / vol"), d.vessel_name || d.flight_no],
        [T(lang, "BL / AWB", "BL / LTA"), d.bl_number || d.awb_number],
        [T(lang, "ETA", "ETA"), date(d.eta)],
        [T(lang, "Status", "Statut"), d.status],
      ])],
    }),
  },
  {
    key: "document",
    module_key: "MOD-64",              // Document vault
    permission: "view",
    params: ["document_id?"],
    label_en: "Document", label_fr: "Document",
    describe_en: "Attach a file from the document vault, without re-uploading it.",
    describe_fr: "Joindre un fichier depuis le coffre, sans le téléverser à nouveau.",
    // The picker is the UI; this resolves the chosen document so the block can
    // name it. Attaching the bytes is POST /mail/attachments/from-vault.
    resolve: (client, params, ctx) => require("../../vault/document_vault/document_vault.service")
      .get(client, needId(idFrom(params, ctx, "document"), ctx.lang, ASK.document)),
    render: (d, lang) => ({
      label: T(lang, "Attached document", "Document joint"),
      nodes: [para(`${d.original_name || d.filename || d.doc_type || "document"}`)],
    }),
    attaches: true,
  },
  {
    key: "bank",
    module_key: "MOD-09",              // Treasury Accounts
    permission: "view",
    params: ["account?"],
    label_en: "Bank details", label_fr: "Coordonnées bancaires",
    describe_en: "Insert the company's payment details for an account you may see.",
    describe_fr: "Insérer les coordonnées de paiement d'un compte auquel vous avez accès.",
    // Routed through the treasury service so the existing confidentiality rules
    // apply — masking is that module's decision, not this one's to re-implement.
    resolve: (client, params, ctx) => require("../../master/reconciliation/reconciliation.service")
      .get(client, needId(idFrom(params, ctx, "account"), ctx.lang, ASK.bank)),
    render: (d, lang) => ({
      label: T(lang, "Payment details", "Coordonnées de paiement"),
      nodes: [rows([
        [T(lang, "Account", "Compte"), d.account_name || d.name],
        [T(lang, "Bank", "Banque"), d.bank_name],
        [T(lang, "Number", "Numéro"), d.account_number || d.masked_number],
        ["IBAN", d.iban],
        ["SWIFT", d.swift_code || d.bic],
      ])],
    }),
  },
  {
    key: "snippet",
    // No module and no permission: a snippet is tenant-authored text with no
    // data access behind it, so being signed in is the whole requirement.
    module_key: null,
    permission: null,
    params: ["label?"],
    label_en: "Snippet", label_fr: "Extrait",
    describe_en: "Insert a saved piece of text.",
    describe_fr: "Insérer un texte enregistré.",
    resolve: async (client, params, ctx) => {
      const { getSetting } = require("../../../shared/config/settings");
      const all = (await getSetting(client, "mail", "snippets", [])) || [];
      const wanted = String((params && (params.label || params[0])) || "").toLowerCase();
      const lang = String(ctx.lang || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
      const hit = all.find((s) => String(s.label || "").toLowerCase() === wanted)
        || all.find((s) => String(s.label || "").toLowerCase().startsWith(wanted));
      if (!hit) throw new AppError("NOT_FOUND", T(lang, "No snippet with that name.", "Aucun extrait de ce nom."), 404);
      return hit;
    },
    render: (d, lang) => ({
      label: null,   // a snippet is prose, not a data block; no header over it
      nodes: String((T(lang, d.body_en, d.body_fr) || d.body_en || d.body || ""))
        .split(/\n{2,}/).filter(Boolean).map(para),
    }),
  },
  {
    key: "signature",
    module_key: null,
    permission: null,
    params: [],
    label_en: "Signature", label_fr: "Signature",
    describe_en: "Insert your signature.",
    describe_fr: "Insérer votre signature.",
    // PR-2 owns signatures. Declared here so the command appears in the registry
    // and in the docs from day one, and refuses honestly rather than being
    // missing — a command that silently does not exist is a support ticket.
    available: false,
    unavailable_en: "Signatures arrive with the next release.",
    unavailable_fr: "Les signatures arrivent avec la prochaine version.",
    resolve: () => { throw new AppError("NOT_ENABLED", "Signatures are not enabled yet.", 400); },
    render: () => ({ label: null, nodes: [] }),
  },
];
