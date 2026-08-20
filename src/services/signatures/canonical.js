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
 * ⚠ NULL-PROTOTYPE ON PURPOSE (CodeQL js/unvalidated-dynamic-method-call).
 *
 * `docType` arrives from a request body. A plain object literal inherits from
 * Object.prototype, so BUILDERS["constructor"] resolves to `Object` — truthy,
 * and callable. The guard below reads `if (!builder) throw`, so it PASSED, and
 * `hash("constructor", {})` returned a real-looking sha256 for a document type
 * that does not exist. Verified before the fix; there is a test for it now.
 *
 * A null prototype removes the whole class rather than the two names someone
 * happened to think of. The hasOwnProperty guard in canonical() is the second
 * belt: either alone would do, and a signature payload is worth both.
 */
const BUILDERS = Object.assign(Object.create(null), {
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
});

/** Doc types that can be signed at all. */
const SIGNABLE = Object.freeze(Object.keys(BUILDERS));

/** Own-property check. The ONLY safe way to ask whether a builder exists. */
const isSignable = (docType) =>
  typeof docType === "string" && Object.prototype.hasOwnProperty.call(BUILDERS, docType);

/**
 * Build the canonical payload for a doc type.
 *
 * `version` exists so a signature stored under v1 keeps verifying after a v2
 * is introduced: pass the version from the signature row, not the current one.
 * Today every builder is v1, so the parameter is checked and then unused — that
 * check is what makes adding v2 a local change instead of an audit.
 */
function canonical(docType, doc, version = 1) {
  // hasOwnProperty rather than a truthiness check: see the BUILDERS docblock.
  const builder = isSignable(docType) ? BUILDERS[docType] : null;
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
