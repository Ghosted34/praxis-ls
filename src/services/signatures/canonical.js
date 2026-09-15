/**
 * Canonical signature payloads (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.6).
 *
 * THIS IS THE FILE THE WHOLE PROGRAMME RESTS ON. Read the warning below before
 * changing anything in it.
 *
 * ── What a canonical payload is ────────────────────────────────────────────
 * A versioned struct holding ONLY the contract-relevant fields of a document —
 * the figures, parties and references a signature actually attests to. It is
 * hashed at signing time and recomputed from the live record on every later
 * read. A mismatch means the document changed after somebody signed it.
 *
 * ── Why not just hash the PDF ──────────────────────────────────────────────
 * Because the QR carrying the hash has to be INSIDE the PDF. Hashing rendered
 * bytes is circular and unsolvable in that direction, which is why no Praxis
 * document has ever been verifiable: template.service.js passed the renderer a
 * verify string with no hash in it at all, because there was none to pass.
 * A hash over business data is known BEFORE rendering, so it can be printed on
 * the page — and it can be recomputed a decade later, which rendered bytes
 * cannot (Puppeteer stamps /CreationDate, so no two renders match).
 *
 * ── The input shape ────────────────────────────────────────────────────────
 * Builders take the shape services/documents/templates/registry.js produces for
 * the same doc type. That is deliberate: it is the shape the document is
 * RENDERED from, so hashing it guarantees the hash covers what is actually on
 * the page a person signed — not a parallel projection of the record that could
 * drift away from it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠  MUST NOT edit a field name, drop a field, or reorder keys in an existing
 *    builder. Every signature ever issued against that doc type would stop
 *    verifying at once — the recomputed hash would no longer match any stored
 *    one, and every signed document in the tenant would read as amended.
 *
 *    TO CHANGE A PAYLOAD: add a new branch under a bumped `v`, keep the old
 *    branch reachable, and add a golden fixture for the new version.
 *    `hash()` dispatches on the version stored on the signature row, never on
 *    "whatever the code does today".
 *
 *    tests/unit/signature-canonical.test.js pins one fixed input per doc type
 *    to a literal sha256. That test is the only thing standing between a
 *    routine refactor and every signature in production going stale at once.
 * ══════════════════════════════════════════════════════════════════════════
 */
"use strict";

const crypto = require("crypto");
const { AppError } = require("../../utils/errors");

/**
 * Rounding is part of the contract, applied INSIDE the builders. A float that
 * renders as "1200.00" and one that renders as 1200.004 must hash identically,
 * or a signature would go stale on a rounding artefact nobody can see.
 */
const num = (v, dp) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // toFixed then back, so -0 and 1e-9 both normalise to 0.
  return Number(n.toFixed(dp)) + 0;
};
const qty = (v) => num(v, 3);
const money = (v) => num(v, 2);
const str = (v) => (v === null || v === undefined ? "" : String(v));

/** Party identity, as it appeared on the document. */
const party = (p = {}) => ({
  name: str(p.name),
  lines: (Array.isArray(p.lines) ? p.lines : []).map(str),
});

/** The standard line-item family (invoice / proforma / quotation / proposal / PO). */
const priceLines = (lines = []) =>
  (Array.isArray(lines) ? lines : []).map((l) => ({
    label: str(l.label),
    qty: qty(l.qty),
    unit: money(l.unit),
    tax: money(l.tax),
    amount: money(l.amount !== undefined && l.amount !== null ? l.amount : Number(l.qty || 1) * Number(l.unit || 0)),
  }));

/** Movement lines — what left and what arrived. No prices. */
const moveLines = (lines = []) =>
  (Array.isArray(lines) ? lines : []).map((l) => ({
    label: str(l.label),
    qty: qty(l.qty),
    unit: str(l.unit_of_measure || l.uom || ""),
  }));

const totals = (t = {}) => ({
  service_ht: money(t.service_ht),
  disbursement_total: money(t.disbursement_total),
  vat_total: money(t.vat_total),
  total_ttc: money(t.total_ttc),
});

// ───────────────────────────────────────────────────────────────────────────
// One builder per doc type. Key order below is the hashed order — JSON.stringify
// preserves insertion order for string keys, and these objects are built from
// literals so the order is fixed by the source, not by a runtime sort.
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⚠ LOOKED UP THROUGH A Map, NEVER BY PROPERTY ACCESS
 *   (CodeQL js/unvalidated-dynamic-method-call, High).
 *
 * `docType` arrives from a request body. When this was a plain object literal,
 * BUILDERS["constructor"] resolved to `Object` — truthy AND callable — so the
 * `if (!builder) throw` guard passed and `hash("constructor", {})` returned a
 * real-looking sha256 for a document type that does not exist. Verified broken;
 * there are tests for it now.
 *
 * The first fix added a null prototype and a hasOwnProperty guard. Both are
 * correct at runtime, and CodeQL still flagged it — rightly. The guard lives
 * inside a helper function, so dataflow cannot see through it, and what remains
 * at the call site is still literally `BUILDERS[userInput](...)`: the pattern
 * the rule is about. A guard that a reader (or a scanner) has to chase into
 * another function to verify is a guard that a later edit can quietly remove.
 *
 * A Map is not property access. There is no prototype chain to walk, `get`
 * returns undefined for anything not explicitly registered, and the unsafe
 * shape is gone rather than defended against. The literal below stays as the
 * readable source of truth; the Map is the lookup.
 */
const BUILDER_SOURCE = Object.assign(Object.create(null), {
  /** Money owed, and for what. The fiscal ladder is the whole point. */
  FINAL_INVOICE: (d) => ({
    v: 1,
    type: "FINAL_INVOICE",
    number: str(d.number),
    date: str(d.date),
    due: str(d.due),
    dossier_ref: str(d.dossier_ref),
    currency: str(d.currency || "XAF"),
    party: party(d.party),
    lines: priceLines(d.lines),
    totals: totals(d.totals),
  }),

  /** An advance request. Same ladder; a different promise. */
  PROFORMA_ADVANCE: (d) => ({
    v: 1,
    type: "PROFORMA_ADVANCE",
    number: str(d.number),
    date: str(d.date),
    dossier_ref: str(d.dossier_ref),
    currency: str(d.currency || "XAF"),
    party: party(d.party),
    lines: priceLines(d.lines),
    totals: totals(d.totals),
  }),

  /** An offer. `valid_until` is contract-relevant: it is when the price dies. */
  QUOTATION: (d) => ({
    v: 1,
    type: "QUOTATION",
    number: str(d.number),
    date: str(d.date),
    valid_until: str(d.valid_until || d.due),
    currency: str(d.currency || "XAF"),
    party: party(d.party),
    lines: priceLines(d.lines),
    totals: totals(d.totals),
  }),

  /** A commercial proposal. Revision matters — rev 2 is a different offer. */
  PROPOSAL: (d) => ({
    v: 1,
    type: "PROPOSAL",
    number: str(d.number),
    revision: Number.isFinite(Number(d.revision)) ? Number(d.revision) : 1,
    date: str(d.date),
    valid_until: str(d.valid_until),
    currency: str(d.currency || "XAF"),
    party: party(d.party),
    lines: priceLines(d.lines),
    totals: totals(d.totals),
  }),

  /** What we committed to buy, from whom, at what price. */
  PURCHASE_ORDER: (d) => ({
    v: 1,
    type: "PURCHASE_ORDER",
    number: str(d.number),
    date: str(d.date),
    currency: str(d.currency || "XAF"),
    party: party(d.party),
    lines: priceLines(d.lines),
    totals: totals(d.totals),
  }),

  /**
   * What was handed over. The counterparty's signature certifies the goods and
   * the reserves they noted — not a price, which is why there is no ladder here.
   * `reserves` is included because a delivery signed "2 pallets damaged" and one
   * signed clean are different attestations, and the difference must invalidate
   * a signature if it is edited afterwards.
   */
  DELIVERY_NOTE: (d) => ({
    v: 1,
    type: "DELIVERY_NOTE",
    number: str(d.number),
    date: str(d.date),
    dossier_ref: str(d.dossier_ref),
    party: party(d.party),
    vehicle: str(d.vehicle || d.vehicle_ref),
    driver: str(d.driver || d.driver_name),
    lines: moveLines(d.lines),
    total_qty: qty((Array.isArray(d.lines) ? d.lines : []).reduce((a, l) => a + Number(l.qty || 0), 0)),
    reserves: str(d.reserves || d.remarks),
  }),

  /** An instruction to move cargo. Route and cargo are the commitment. */
  TRANSIT_ORDER: (d) => ({
    v: 1,
    type: "TRANSIT_ORDER",
    number: str(d.number),
    date: str(d.date),
    dossier_ref: str(d.dossier_ref),
    party: party(d.party),
    origin: str(d.origin),
    destination: str(d.destination),
    vehicle: str(d.vehicle || d.vehicle_ref),
    lines: moveLines(d.lines),
    total_qty: qty((Array.isArray(d.lines) ? d.lines : []).reduce((a, l) => a + Number(l.qty || 0), 0)),
  }),

  /**
   * Employment terms. The most sensitive payload here: an edited salary on a
   * signed contract must invalidate the signature, loudly and immediately.
   * `clauses` carries clause HEADINGS only — the public portal shows them, and
   * clause bodies are not for a stranger holding a scan.
   */
  EMPLOYMENT_CONTRACT: (d) => ({
    v: 1,
    type: "EMPLOYMENT_CONTRACT",
    number: str(d.number),
    date: str(d.date),
    employee: str(d.employee || (d.party && d.party.name)),
    job_title: str(d.job_title),
    contract_type: str(d.contract_type),
    start_date: str(d.start_date),
    end_date: str(d.end_date),
    currency: str(d.currency || "XAF"),
    gross_salary: money(d.gross_salary),
    trial_period_months: Number.isFinite(Number(d.trial_period_months)) ? Number(d.trial_period_months) : 0,
    clauses: (Array.isArray(d.clauses) ? d.clauses : []).map((c) => str(c && c.heading ? c.heading : c)),
  }),

  /**
   * The costing worksheet — the budget three people sign off in turn.
   *
   * WHAT IT ATTESTS TO, and what it deliberately does not.
   *
   * The FIGURES and the LINES that produce them, because that is what an
   * approver approved: a line added or repriced after approval must invalidate
   * the seal, which is the entire point of sealing a budget. `container_type`
   * is part of a line's identity here for the same reason it is on screen — a
   * charge priced per box is several lines that share a dictionary item and
   * differ only by equipment, so without it two demurrage lines hash as one
   * and swapping the 20' amount onto the 40' would go unnoticed.
   *
   * `is_disbursement` and `upstream_vat`, because a line's NATURE decides
   * whether our VAT applies to it. Flipping a service line to pass-through
   * after approval changes what the client owes without changing any amount on
   * the page, and a payload that hashed only the amounts would call that
   * document unchanged.
   *
   * The SHIPMENT, because a costing is a price FOR a shipment: the same
   * charges against a different vessel, port or B/L are a different
   * commitment, and 0661 snapshots those facts onto the sheet at approval
   * precisely so they can be attested to.
   *
   * NOT the amendment summary. It describes the diff since the last approval,
   * not the commitment, and it changes as the sheet is edited — hashing a
   * derived view would make every seal read as amended the moment somebody
   * touched a line, which is the opposite of what the status means.
   *
   * NOT the remarks. They are the pricer's note to the validator ("carrier
   * rate valid 14 days"), not a term of the budget.
   */
  COSTING: (d) => ({
    v: 1,
    type: "COSTING",
    number: str(d.number),
    date: str(d.date),
    status: str(d.status),
    dossier_ref: str(d.dossier_ref),
    currency: str(d.currency || "XAF"),
    exchange_rate: num(d.exchange_rate, 8),
    party: party(d.party),
    shipment: {
      bl_mawb: str(d.bl_mawb),
      pol: str(d.pol),
      pod: str(d.pod),
      eta: str(d.eta),
      incoterm: str(d.incoterm),
      carrier: str(d.carrier),
    },
    lines: (Array.isArray(d.lines) ? d.lines : []).map((l) => ({
      label: str(l.label),
      container_type: str(l.container_type),
      qty: qty(l.qty),
      unit: money(l.unit),
      tax: money(l.tax),
      is_disbursement: l.is_disbursement === true,
      upstream_vat: money(l.upstream_vat),
      amount: money(l.amount !== undefined && l.amount !== null ? l.amount : Number(l.qty || 1) * Number(l.unit || 0)),
    })),
    totals: {
      total_ht: money(d.totals && d.totals.total_ht),
      vat_total: money(d.totals && d.totals.vat_total),
      total_ttc: money(d.totals && d.totals.total_ttc),
      disbursement_total: money(d.totals && d.totals.disbursement_total),
      upstream_vat_total: money(d.totals && d.totals.upstream_vat_total),
    },
  }),

  /**
   * The cash request — the voucher three people sign in turn (owner Q12:
   * the requestor, the approving authority, the disbursing authority).
   *
   * WHAT IT ATTESTS TO.
   *
   * The LINES and the TOTAL PAYABLE, because that is the claim: a line
   * repriced after approval is a different amount of money leaving the
   * treasury, and catching that is the whole reason a voucher is sealed.
   *
   * `costing_line_id` per line, because a cash request is a DRAW against a
   * named budget line (12771). Re-pointing an approved claim at a different
   * line of the sheet moves no figure on the page and changes which budget it
   * consumes — a payload that hashed only labels and amounts would call that
   * document unchanged, and the budget ledger would quietly disagree with the
   * sealed paper.
   *
   * `justification_required`, because it is an OBLIGATION the signer accepts:
   * whoever takes cash against a ticked line owes a receipt back, and clearing
   * the tick after approval would erase a duty somebody signed for.
   *
   * `costing_id` and `costing_revision`, because "approved against budget X at
   * revision N" is the fact the approving authority actually asserted.
   *
   * NOT the payments. They happen AFTER the voucher is approved and each one
   * is attested by its own receipt below; hashing them here would make every
   * instalment invalidate the approver's seal.
   *
   * NOT the budget control block. It is a live derivation — what the file has
   * left changes as other requests are approved — and hashing a moving figure
   * would report an untouched voucher as amended.
   *
   * AND NOT THE STATUS, WHERE THE COSTING HASHES ITS OWN.
   *
   * This is the one place the two documents must differ, and getting it wrong
   * is silent. A costing ENDS at APPROVED_LOCKED: its last seal is applied on
   * the transition into the state it stays in, so `status` in the payload is a
   * fact that never moves again. A cash request does not end there — it goes on
   * to PARTIALLY_DISBURSED, DISBURSED, JUSTIFIED, each step days or weeks after
   * the approver signed. Hashing the status would mean every seal on every
   * voucher in the product reads AMENDED the moment the first franc moves, and
   * a portal that cries tampering on every document teaches its readers to
   * ignore it. (Verified against a real database before this was written: with
   * `status` in the payload all three seals went AMENDED on the second
   * instalment; without it they verify.)
   *
   * Nothing is lost. What a signer attested to is the COMMITMENT — these lines,
   * these totals, drawn on that budget — and where the request had got to is
   * recorded by the seals themselves: each names its own decision and carries
   * its own timestamp, which is a better record of the workflow than a single
   * enum could be.
   */
  CASH_REQUEST: (d) => ({
    v: 1,
    type: "CASH_REQUEST",
    number: str(d.number),
    date: str(d.date),
    dossier_ref: str(d.dossier_ref),
    currency: str(d.currency || "XAF"),
    category: str(d.category),
    beneficiary: str(d.beneficiary),
    cost_center: str(d.cost_center),
    method: str(d.method),
    costing_id: str(d.costing_id),
    costing_ref: str(d.costing_ref),
    costing_revision: num(d.costing_revision, 0),
    party: party(d.party),
    lines: (Array.isArray(d.lines) ? d.lines : []).map((l) => ({
      label: str(l.label),
      costing_line_id: str(l.costing_line_id),
      qty: qty(l.qty),
      unit: money(l.unit),
      tax: money(l.tax),
      justification_required: l.justification_required === true,
      amount: money(l.amount !== undefined && l.amount !== null ? l.amount : Number(l.qty || 1) * Number(l.unit || 0)),
    })),
    totals: {
      subtotal: money(d.totals && d.totals.subtotal),
      vat_total: money(d.totals && d.totals.vat_total),
      total_payable: money(d.totals && d.totals.total_payable),
    },
  }),

  /**
   * One instalment's receipt (owner Q16 C) — signed by TWO: the disbursing
   * authority who released the cash, and the person who took it.
   *
   * WHAT IT ATTESTS TO: this movement of money, and where it leaves the
   * request. The amount paid and the balance still to run are both hashed
   * because a receipt whose balance could be restated afterwards is a receipt
   * that proves nothing about what is still owed — and the balance is the one
   * figure the holder reads before signing.
   *
   * `request_approved_at` rather than the whole voucher: the receipt cites the
   * authority it was paid under, and re-hashing the voucher's lines here would
   * make an unrelated amendment of a JUSTIFIED request invalidate a receipt
   * for cash that has already changed hands.
   */
  CASH_PAYMENT_RECEIPT: (d) => ({
    v: 1,
    type: "CASH_PAYMENT_RECEIPT",
    number: str(d.number),
    date: str(d.date),
    currency: str(d.currency || "XAF"),
    dossier_ref: str(d.dossier_ref),
    request_number: str(d.request_number),
    request_approved_at: str(d.request_approved_at),
    party: party(d.party),
    amount: money(d.amount),
    request_total: money(d.request_total),
    paid_to_date: money(d.paid_to_date),
    balance: money(d.balance),
    method: str(d.method),
    treasury_account: str(d.treasury_account),
  }),
});

/** The only thing anything looks a builder up in. Insertion order preserved. */
const BUILDERS = new Map(Object.entries(BUILDER_SOURCE));

/** Doc types that can be signed at all. */
const SIGNABLE = Object.freeze([...BUILDERS.keys()]);

const isSignable = (docType) => typeof docType === "string" && BUILDERS.has(docType);

/**
 * Build the canonical payload for a doc type.
 *
 * `version` exists so a signature stored under v1 keeps verifying after a v2
 * is introduced: pass the version from the signature row, not the current one.
 * Today every builder is v1, so the parameter is checked and then unused — that
 * check is what makes adding v2 a local change instead of an audit.
 */
function canonical(docType, doc, version = 1) {
  // Map.get, inline — not a property read, and not behind a helper. See the
  // BUILDER_SOURCE docblock for why both of those matter.
  const builder = typeof docType === "string" ? BUILDERS.get(docType) : undefined;
  if (typeof builder !== "function") {
    throw new AppError(
      "NO_CANONICAL_PAYLOAD",
      `'${docType}' has no canonical signature payload. Register one in services/signatures/canonical.js — see doc/SIGNATURE_ENGINEERING_GUIDE.md §3.6.`,
      422,
      { doc_type: docType, signable: SIGNABLE },
    );
  }
  if (Number(version) !== 1) {
    throw new AppError(
      "UNKNOWN_PAYLOAD_VERSION",
      `Signature payload version ${version} is not implemented for '${docType}'.`,
      422,
      { doc_type: docType, version },
    );
  }
  return builder(doc || {});
}

/**
 * sha256 of the canonical payload.
 *
 * JSON.stringify over an object built from object literals gives a stable key
 * order without a sort: V8 preserves insertion order for non-numeric string
 * keys, and every builder above constructs its result in one literal. A sort
 * would be MORE fragile, not less — it would silently re-order if a key were
 * renamed, changing the digest without changing the source's apparent meaning.
 */
function hash(docType, doc, version = 1) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(docType, doc, version))).digest("hex");
}

/** Both at once — the shape the signing service actually wants. */
function build(docType, doc, version = 1) {
  const payload = canonical(docType, doc, version);
  return {
    payload,
    hash: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    version: 1,
  };
}

/**
 * Field-level diff between the payload as signed and the payload now. Feeds the
 * portal's "signed, then modified" panel, which shows WHAT changed rather than
 * only that something did. Compares leaves by JSON equality; arrays are
 * compared whole, because "line 3 of 7 changed" is not a claim worth making
 * when a line may also have been inserted.
 */
function diff(before = {}, after = {}) {
  const out = [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  for (const key of keys) {
    if (key === "v" || key === "type") continue;
    const a = JSON.stringify(before[key]);
    const b = JSON.stringify(after[key]);
    if (a !== b) out.push({ field: key, before: before[key] ?? null, after: after[key] ?? null });
  }
  return out;
}

module.exports = { canonical, hash, build, diff, isSignable, SIGNABLE, BUILDERS };
