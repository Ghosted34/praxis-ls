/**
 * Per-doc-type verification summaries — what the public portal shows a stranger
 * holding the paper (doc/SIGNATURE_ENGINEERING_GUIDE.md §5.4, Q12 = B).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠  EVERY RESOLVER HERE READS THE STORED PAYLOAD AND NOTHING ELSE.
 *
 *    No client, no query, no join, no `await`. The signature is not a
 *    parameter to any of them. That is not a style preference — it is the rule
 *    §5.4 exists to enforce, made structural: a resolver with no database
 *    handle CANNOT accidentally answer with today's figures.
 *
 *    Why it matters: a live query lets an OLD copy disclose the CURRENT state.
 *    Someone holding a March waybill scans it in September and reads today's
 *    line items, today's counterparty, today's amendments — facts that were
 *    never on their paper and that they have no right to. The stored
 *    `document_signature.content_payload` answers the question a verifier
 *    actually has: *what did this person attest to?*
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Where this lives, and why not in document_vault.types.js ───────────────
 * The guide suggests co-locating the registry with DOC_TYPES so a new signable
 * type cannot be added without someone seeing the summary slot. The slot is
 * enforced harder than co-location can manage: `tests/unit/signature-summary.
 * test.js` fails if any type in SIGNATURE_CEILING has no resolver here, and
 * document_vault.types.js carries a pointer to this file beside that table.
 *
 * The code itself belongs next to canonical.js instead, because that is the
 * coupling that actually bites. These resolvers read the shape canonical.js
 * BUILDS. Rename a key in a builder and the resolver two directories away goes
 * quietly blank; sitting in the same directory, a reader changing one has the
 * other in front of them.
 *
 * ── The disclosure rule ────────────────────────────────────────────────────
 * A resolver returns the fields a person needs to recognise their own document
 * — not everything the payload holds. EMPLOYMENT_CONTRACT is the clearest
 * case: the payload carries `gross_salary`, and this file does not publish it.
 * A public URL printed on a contract must not turn a twelve-character code
 * into a salary lookup. Clause HEADINGS are shown (they let the holder confirm
 * the contract's shape); clause bodies are not in the payload at all.
 */
"use strict";

const str = (v) => (v === null || v === undefined ? "" : String(v));

/**
 * Grouped digits with a plain space, not Intl's locale separator.
 *
 * `Intl.NumberFormat("fr-FR")` emits U+202F NARROW NO-BREAK SPACE, which
 * changed between ICU versions, renders as a box in some PDF viewers, and
 * makes a string comparison in a test fail for reasons that have nothing to do
 * with the figure. Grouping from en-US (a stable comma) and substituting a
 * space gives the French presentation the tenant expects and a value that is
 * the same on every machine.
 */
function money(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const dp = Number.isInteger(n) ? 0 : 2;
  const grouped = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  }).format(n).replace(/,/g, " ");
  const ccy = str(currency).trim();
  return ccy ? `${grouped} ${ccy}` : grouped;
}

/**
 * A costing's status, in words.
 *
 * Read from the costing rules rather than copied, because the screen, the
 * printed sheet and this page must call the same state the same thing — and a
 * second copy of a status vocabulary is a copy that goes stale on the next
 * status. Required lazily: this file is loaded by the verification portal,
 * which has no other reason to pull a costing module in.
 *
 * Falls back to the raw value, which is what the rules do for an unknown
 * status: a sheet in a state nobody has named must still verify.
 */
function costingStatus(status, lang) {
  const { statusWords } = require("../../modules/costing/costing/costing.rules");
  const words = statusWords(status);
  return lang === "en" ? words.en : words.fr;
}

const count = (v) => String(Array.isArray(v) ? v.length : 0);
const partyName = (p) => str(p && p.name) || "—";
const dash = (v) => (str(v).trim() || "—");

/** A summary row. `label` is bilingual; the service picks a side on the way out. */
const f = (key, fr, en, value) => ({ key, label: { fr, en }, value: str(value) });

// ───────────────────────────────────────────────────────────────────────────
// Field labels for the amendment panel.
//
// When a document has changed since it was signed, the portal names the fields
// that moved. `show: true` means the before/after VALUES may be rendered;
// `show: false` means the field is named and nothing more.
//
// The split is a disclosure decision, not a formatting one. A total moving
// from one figure to another is exactly what the holder of the paper needs and
// exactly what their own copy already tells them. A changed `lines` array or a
// changed `clauses` list is not: rendering those would publish the current
// contents of a document the reader is only entitled to the signed version of,
// which is the same defect §5.4 removes from the summary itself.
// ───────────────────────────────────────────────────────────────────────────
const CHANGED_FIELD = new Map(Object.entries({
  number:              { fr: "Numéro",              en: "Reference",        show: true },
  date:                { fr: "Date",                en: "Date",             show: true },
  due:                 { fr: "Échéance",            en: "Due",              show: true },
  valid_until:         { fr: "Valable jusqu'au",    en: "Valid until",      show: true },
  revision:            { fr: "Révision",            en: "Revision",         show: true },
  currency:            { fr: "Devise",              en: "Currency",         show: true },
  dossier_ref:         { fr: "Dossier",             en: "File reference",   show: true },
  origin:              { fr: "Origine",             en: "Origin",           show: true },
  destination:         { fr: "Destination",         en: "Destination",      show: true },
  vehicle:             { fr: "Véhicule",            en: "Vehicle",          show: true },
  driver:              { fr: "Chauffeur",           en: "Driver",           show: true },
  total_qty:           { fr: "Quantité totale",     en: "Total quantity",   show: true },
  job_title:           { fr: "Poste",               en: "Role",             show: true },
  contract_type:       { fr: "Type de contrat",     en: "Contract type",    show: true },
  start_date:          { fr: "Date de début",       en: "Start date",       show: true },
  end_date:            { fr: "Date de fin",         en: "End date",         show: true },
  trial_period_months: { fr: "Période d'essai",     en: "Trial period",     show: true },
  // A raw enum in the payload — a hash cannot depend on a display string — so
  // the panel names the field rather than printing two enums at a reader. Only
  // the COSTING payload carries one; a cash request's status deliberately does
  // not (see canonical.js).
  status:              { fr: "Statut",              en: "Status",           show: false },
  // The cash request's own keys (12773).
  category:            { fr: "Catégorie",           en: "Category",         show: true },
  method:              { fr: "Mode de paiement",    en: "Payment method",   show: true },
  costing_ref:         { fr: "Cotation",            en: "Costing",          show: true },
  costing_revision:    { fr: "Révision (cotation)", en: "Costing revision", show: true },
  amount:              { fr: "Montant",             en: "Amount",           show: true },
  balance:             { fr: "Solde",               en: "Balance",          show: true },
  request_number:      { fr: "Demande de fonds",    en: "Cash request",     show: true },
  // Named only. A beneficiary, a cost centre and a treasury account are all
  // disclosures a stranger holding the paper is not entitled to; that the
  // field MOVED is what they need to know.
  beneficiary:         { fr: "Bénéficiaire",        en: "Beneficiary",      show: false },
  cost_center:         { fr: "Centre de coût",      en: "Cost centre",      show: false },
  treasury_account:    { fr: "Compte",              en: "Account",          show: false },
  // Named only. See the block comment above.
  party:               { fr: "Partie",              en: "Counterparty",     show: false },
  lines:               { fr: "Lignes",              en: "Line items",       show: false },
  totals:              { fr: "Totaux",              en: "Totals",           show: false },
  employee:            { fr: "Salarié",             en: "Employee",         show: false },
  gross_salary:        { fr: "Rémunération",        en: "Remuneration",     show: false },
  clauses:             { fr: "Clauses",             en: "Clauses",          show: false },
  reserves:            { fr: "Réserves",            en: "Reserves",         show: false },
}));

/**
 * The resolvers.
 *
 * ⚠ LOOKED UP THROUGH A Map, NEVER BY PROPERTY ACCESS
 *   (CodeQL js/unvalidated-dynamic-method-call, High).
 *
 * `docType` reaches this registry from a signature row whose value originated
 * in a request body. The identical shape in canonical.js — a plain object
 * literal indexed by that string — resolved RESOLVERS["constructor"] to
 * `Object`: truthy AND callable, so a `if (!resolver) return null` guard passed
 * and the caller invoked it. A Map has no prototype chain to walk and `get`
 * returns undefined for anything not explicitly registered, so the unsafe
 * shape is gone rather than defended against.
 */
const RESOLVERS = new Map(Object.entries({
  FINAL_INVOICE: (p) => ({
    title: { fr: "Facture", en: "Invoice" },
    fields: [
      f("number", "Numéro", "Reference", dash(p.number)),
      f("party", "Client", "Counterparty", partyName(p.party)),
      f("date", "Date", "Date", dash(p.date)),
      f("total_ttc", "Total TTC", "Total incl. tax", money(p.totals && p.totals.total_ttc, p.currency)),
      f("line_count", "Lignes", "Line items", count(p.lines)),
    ],
  }),

  PROFORMA_ADVANCE: (p) => ({
    title: { fr: "Facture proforma / demande d'avance", en: "Proforma / advance request" },
    fields: [
      f("number", "Numéro", "Reference", dash(p.number)),
      f("party", "Client", "Counterparty", partyName(p.party)),
      f("date", "Date", "Date", dash(p.date)),
      f("total_ttc", "Total TTC", "Total incl. tax", money(p.totals && p.totals.total_ttc, p.currency)),
      f("line_count", "Lignes", "Line items", count(p.lines)),
    ],
  }),

  QUOTATION: (p) => ({
    title: { fr: "Devis", en: "Quotation" },
    fields: [
      f("number", "Numéro", "Reference", dash(p.number)),
      f("party", "Client", "Counterparty", partyName(p.party)),
      f("total_ttc", "Total TTC", "Total incl. tax", money(p.totals && p.totals.total_ttc, p.currency)),
      // The price dies on this date. A quotation verified after it has lapsed
      // is the single most common reason anyone scans one.
      f("valid_until", "Valable jusqu'au", "Valid until", dash(p.valid_until)),
    ],
  }),

  PROPOSAL: (p) => ({
    title: { fr: "Proposition commerciale", en: "Commercial proposal" },
    fields: [
      f("number", "Numéro", "Reference", dash(p.number)),
      // Revision is contract-relevant: rev 2 is a different offer, and a
      // counterparty holding rev 1 needs to see which one they signed.
      f("revision", "Révision", "Revision", str(p.revision)),
      f("party", "Client", "Counterparty", partyName(p.party)),
      f("total_ttc", "Total TTC", "Total incl. tax", money(p.totals && p.totals.total_ttc, p.currency)),
      f("valid_until", "Valable jusqu'au", "Valid until", dash(p.valid_until)),
    ],
  }),

  PURCHASE_ORDER: (p) => ({
    title: { fr: "Bon de commande", en: "Purchase order" },
    fields: [
      f("number", "Numéro", "Reference", dash(p.number)),
      f("party", "Fournisseur", "Supplier", partyName(p.party)),
      f("date", "Date", "Date", dash(p.date)),
      f("total_ttc", "Total TTC", "Total incl. tax", money(p.totals && p.totals.total_ttc, p.currency)),
    ],
  }),

  DELIVERY_NOTE: (p) => ({
    title: { fr: "Bon de livraison", en: "Delivery note" },
    fields: [
      f("number", "Numéro", "Reference", dash(p.number)),
      f("party", "Destinataire", "Counterparty", partyName(p.party)),
      f("date", "Date de livraison", "Delivery date", dash(p.date)),
      f("line_count", "Articles", "Items", count(p.lines)),
    ],
    // A delivery signed "2 pallets damaged" and one signed clean are different
    // attestations. The reserves are the whole point of a counterparty's
    // signature on a waybill, so they are shown in full rather than counted.
    detail: str(p.reserves).trim()
      ? { label: { fr: "Réserves à la livraison", en: "Reserves noted on delivery" }, value: str(p.reserves) }
      : null,
  }),

  TRANSIT_ORDER: (p) => ({
    title: { fr: "Ordre de transit", en: "Transit order" },
    fields: [
      f("number", "Numéro", "Reference", dash(p.number)),
      f("party", "Donneur d'ordre", "Counterparty", partyName(p.party)),
      f("route", "Trajet", "Route", `${dash(p.origin)} → ${dash(p.destination)}`),
      f("line_count", "Articles", "Items", count(p.lines)),
    ],
  }),

  /**
   * The one resolver whose omissions matter more than its fields.
   *
   * The payload carries `gross_salary`, and it is NOT published here. This URL
   * is printed on the contract itself and travels with it; turning a
   * twelve-character code into a salary lookup for anyone who photographs the
   * page is a disclosure nobody decided to make. Clause HEADINGS are shown —
   * they let the holder confirm the contract's shape — and clause bodies never
   * entered the payload in the first place (canonical.js maps to `heading`).
   */
  EMPLOYMENT_CONTRACT: (p) => ({
    title: { fr: "Contrat de travail", en: "Employment contract" },
    fields: [
      f("number", "Référence", "Reference", dash(p.number)),
      f("job_title", "Poste", "Role", dash(p.job_title)),
      f("contract_type", "Type de contrat", "Contract type", dash(p.contract_type)),
      f("start_date", "Date de début", "Start date", dash(p.start_date)),
    ],
    detail: Array.isArray(p.clauses) && p.clauses.length
      ? {
        label: { fr: "Intitulés des clauses", en: "Clause headings" },
        value: p.clauses.map(str).filter(Boolean).join(" · "),
      }
      : null,
  }),

  /**
   * The costing worksheet — and the only resolver here whose reader is us.
   *
   * WHO SCANS THIS. Not a client: a costing is an internal budget and never
   * leaves the building. The person holding it is an operations officer, a
   * validator or an auditor, and the question they have is "is this the sheet
   * that was approved, and by whom?" — which the seal answers and this fills
   * in around.
   *
   * WHAT IS NOT PUBLISHED, and why it still matters that a costing never
   * travels. `total_ttc` IS shown: unlike a salary, it is the figure the
   * signature is about, and a verification that will not tell you the amount
   * cannot confirm a budget at all. The LINES are counted, not listed — a
   * charge-by-charge breakdown of what a job costs us is the one thing on this
   * document a competitor would want, and the count is what a holder needs to
   * confirm the sheet in their hand is the sheet that was sealed.
   *
   * `status` is a raw enum in the payload — it has to be, a hash cannot depend
   * on a display string — so it is said in words here, the same words the
   * screen and the printed sheet use.
   */
  COSTING: (p, lang) => ({
    title: { fr: "Cotation", en: "Costing" },
    fields: [
      f("number", "Référence", "Reference", dash(p.number)),
      f("dossier_ref", "Dossier", "File", dash(p.dossier_ref)),
      f("status", "Statut", "Status", costingStatus(p.status, lang)),
      f("total_ttc", "Total estimé (TTC)", "Total estimate (TTC)",
        money(p.totals && p.totals.total_ttc, p.currency)),
      f("line_count", "Lignes", "Lines", count(p.lines)),
    ],
  }),

  /**
   * The cash request. The holder is confirming that the voucher in their hand
   * is the voucher that was approved, so: its reference, the file it is spent
   * against, where it had got to, and the figure the treasury was asked for.
   *
   * THE LINES ARE COUNTED, NOT LISTED. `count`, like every other resolver
   * here, because a public URL printed on a voucher must not become a lookup
   * of what a company is paying whom — the line labels are the file's costing
   * broken out charge by charge. The holder already has them on their paper;
   * a stranger who found the paper does not need them served over the web.
   *
   * NO BENEFICIARY for the same reason: naming who was paid is a disclosure,
   * and recognising your own document does not need it.
   */
  CASH_REQUEST: (p) => ({
    title: { fr: "Demande de fonds", en: "Cash request" },
    fields: [
      f("number", "Référence", "Reference", dash(p.number)),
      f("dossier_ref", "Dossier", "File", dash(p.dossier_ref)),
      // The COSTING this claim draws on, where the costing's own summary shows
      // a status. There is no status to show: the voucher's payload does not
      // carry one, deliberately — see canonical.js. Where the money came FROM
      // is the fact a holder can check against their paper anyway.
      f("costing_ref", "Cotation", "Costing", dash(p.costing_ref)),
      f("total_payable", "Total à payer", "Total payable",
        money(p.totals && p.totals.total_payable, p.currency)),
      f("line_count", "Lignes", "Lines", count(p.lines)),
    ],
  }),

  /**
   * One instalment's receipt. The person holding it took the cash, so the
   * facts they verify are: which receipt, against which request, how much
   * changed hands, and what was still to run afterwards.
   *
   * The BALANCE is published where the voucher's line labels are not, and the
   * distinction is the disclosure rule rather than an inconsistency: the
   * balance is the single figure this document exists to state, it is printed
   * on the holder's own copy in bold, and a receipt whose balance could not be
   * checked against the paper would verify nothing worth verifying.
   */
  CASH_PAYMENT_RECEIPT: (p) => ({
    title: { fr: "Reçu de décaissement", en: "Payment receipt" },
    fields: [
      f("number", "Référence", "Reference", dash(p.number)),
      f("request_number", "Demande de fonds", "Cash request", dash(p.request_number)),
      f("dossier_ref", "Dossier", "File", dash(p.dossier_ref)),
      f("amount", "Montant décaissé", "Amount disbursed", money(p.amount, p.currency)),
      f("balance", "Reste à décaisser", "Balance to disburse", money(p.balance, p.currency)),
    ],
  }),
}));

/** Doc types with a published summary. */
const SUMMARISABLE = Object.freeze([...RESOLVERS.keys()]);

const hasSummary = (docType) => typeof docType === "string" && RESOLVERS.has(docType);

/**
 * The as-signed summary for one stored payload, in one language.
 *
 * Returns `null` for an unregistered doc type — never a fallback that dumps
 * whatever keys the payload happens to hold. §5.4: *"A fallback that dumps
 * whatever columns exist is exactly how a disclosure decision gets made by
 * accident."* The caller renders the verdict and the signer alone.
 */
function summarise(docType, payload, language = "fr") {
  const resolve = typeof docType === "string" ? RESOLVERS.get(docType) : undefined;
  if (typeof resolve !== "function") return null;
  const lang = language === "en" ? "en" : "fr";
  /*
   * The language is passed to the resolver as well as used below.
   *
   * The rule at the top of this file is that a resolver reads the STORED
   * PAYLOAD and nothing else — no client, no query, no await. A language is
   * none of those: it decides how a value is SAID, not which facts are
   * available, so it cannot let a resolver answer with today's figures. Every
   * resolver that does not need it simply ignores the second argument.
   *
   * It exists because a payload can hold a machine value that must be said out
   * loud — a status enum, which a hash cannot afford to store as a display
   * string. Without this the portal would print `APPROVED_LOCKED` at a reader
   * in both languages, which is the defect §3.14 is about.
   */
  const out = resolve(payload && typeof payload === "object" ? payload : {}, lang);
  return {
    doc_type: docType,
    title: out.title[lang],
    fields: out.fields.filter((row) => row.value !== "").map((row) => ({ key: row.key, label: row.label[lang], value: row.value })),
    detail: out.detail ? { label: out.detail.label[lang], value: out.detail.value } : null,
  };
}

/**
 * Name what changed between the payload as signed and the payload now.
 *
 * Takes canonical.diff()'s output. Fields marked `show: false` in
 * CHANGED_FIELD are named and nothing more; an unregistered key is named from
 * the key itself and never carries values, so a field added to a builder
 * without a label here fails closed rather than publishing itself.
 */
function describeChanges(changes, { currency = "", language = "fr" } = {}) {
  const lang = language === "en" ? "en" : "fr";
  const scalar = (v) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return money(v, currency);
    if (typeof v === "object") return null;
    return String(v);
  };
  return (Array.isArray(changes) ? changes : []).map((c) => {
    const meta = CHANGED_FIELD.get(c.field);
    const label = meta ? meta[lang] : String(c.field).replace(/_/g, " ");
    if (!meta || !meta.show) return { field: c.field, label, before: null, after: null };
    const before = scalar(c.before);
    const after = scalar(c.after);
    // A "showable" field that turns out to hold a structure still fails closed.
    if (before === null || after === null) return { field: c.field, label, before: null, after: null };
    return { field: c.field, label, before, after };
  });
}

module.exports = { summarise, describeChanges, hasSummary, SUMMARISABLE, money, RESOLVERS, CHANGED_FIELD };
