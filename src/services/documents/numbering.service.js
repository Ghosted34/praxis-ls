/**
 * Tenant-native document numbering (doc/BUILD_CONVENTIONS.md §3/§6).
 *
 * Allocates the next human-readable number for a document type from the tenant's
 * `doc_sequence` counter, formatted by the tenant's own numbering scheme (stored
 * in `setting` section='numbering', key=<module_key>) — tenants CRUD the scheme
 * from Settings; there is no hard-coded format. Sequences are physically per
 * schema (live vs sandbox) so a sandbox run never burns a live number.
 *
 * MUST run inside the caller's transaction so the number and the row commit
 * together (the UPSERT ... RETURNING locks the sequence row, serialising
 * concurrent allocations — gap-free per module/year/entity, KB §23.9 spirit).
 *
 * Replaces the storefront `services/numbering.service.js`, which read
 * `shared.document_numbering` / `shared.business_config` (Pixie Girl), not the
 * tenant `doc_sequence`.
 */
"use strict";

const { AppError } = require("../../utils/errors");

const DEFAULTS = { prefix: "DOC", padding: 4, reset: "yearly", separator: "-" };

/**
 * Readable per-module tokens, e.g. SLAS-**OPS**-2026-0001.
 *
 * The token is NOT decoration — `doc_sequence` is keyed (module, year, entity),
 * so the sequence restarts per module. Without a distinguishing token a dossier
 * and an invoice would both read `SLAS-2026-0001`. Before this map the token was
 * the raw module number (`DOC-29-2026-0001`), which is unique but meaningless to
 * anyone reading a document.
 *
 * Shapes match the reference material (`SLAS-OPS-2026-0142`, `SLAS-INV-2026-0311`).
 * Anything unmapped falls back to the numeric code, so a new module keeps working
 * and merely looks unfriendly until it's added here. A tenant can override the
 * token per module via `setting` section='numbering' (see schemeFor).
 */
const MODULE_TOKENS = {
  "MOD-29": "OPS", // operation file / dossier
  "MOD-30": "TRO", // transit order
  "MOD-32": "DN", //  delivery note
  "MOD-27": "QTE", // quotation
  "MOD-50": "PRO", // proforma / advance
  "MOD-51": "INV", // final invoice
  "MOD-52": "REC", // receipt
  "MOD-53": "DEB", // debt
  "MOD-55": "JE", //  journal entry
  "MOD-46": "CST", // costing
  "MOD-47": "CT", //  cost tracking
  "MOD-49": "CSH", // cash request / régie
  "MOD-59": "PR", //  purchase request
  "MOD-60": "PO", //  purchase order
  "MOD-61": "SIN", // supplier invoice
  "MOD-33": "GRN", // goods received
  "MOD-36": "OUT", // outbound
  "MOD-38": "CC", //  cycle count
  "MOD-41": "WO", //  work order
  "MOD-42": "DSP", // dispatch
  "MOD-12": "CTR", // HR contract
  "MOD-01-DOC": "DOC", // corporate entity administrative document
  "MOD-03": "CL", //  client
  "MOD-04": "SUP", // supplier
  "MOD-03-DOC": "DOC", // client KYC document
  "MOD-04-DOC": "DOC", // supplier KYC document
};

// KYC documents can belong to a party that has not yet been linked to one of
// the tenant's corporate entities. Give those records a useful default too;
// `schemeFor()` still lets Settings override it per document family.
const MODULE_DEFAULT_SCHEMES = {
  "MOD-01-DOC": { prefix: "ENT" },
  "MOD-03-DOC": { prefix: "CLI" },
  "MOD-04-DOC": { prefix: "SUP" },
};

/** Pure formatter — tenant scheme + { year, seq } -> string. */
function formatNumber(cfg, { year, seq }) {
  const c = { ...DEFAULTS, ...cfg };
  const parts = [];
  if (c.prefix) parts.push(c.prefix);
  if (c.code) parts.push(c.code);
  if (c.reset === "yearly" && year) parts.push(String(year));
  parts.push(String(seq).padStart(c.padding, "0"));
  return parts.join(c.separator);
}

/**
 * Read the numbering scheme for a module, merged over defaults.
 *
 * Precedence, weakest first: DEFAULTS → module token → **entity doc_prefix** →
 * tenant per-module setting. So a tenant override always wins, and the entity's
 * own prefix beats the generic "DOC".
 *
 * The entity prefix was previously IGNORED (fixed 2026-08-01):
 * `corporate_entity.doc_prefix` is captured on the entity form and defaults to
 * 'SLS', but nothing read it, so every document came out as `DOC-29-2026-0001`
 * instead of `SLAS-OPS-2026-0001`. Stored and never used — the same class of bug
 * as the favicon and the entity letterhead. `doc/BUILD_CONVENTIONS.md` §6 states
 * the intent: numbering is tenant-CRUD, "per-entity and/or per-year reset".
 *
 * entityId is optional so existing callers keep working; without it the prefix
 * simply falls back to DEFAULTS.
 */
async function schemeFor(client, moduleKey, entityId = null) {
  const code = MODULE_TOKENS[String(moduleKey).toUpperCase()] || String(moduleKey).replace(/^MOD-/i, "");

  let entityPrefix = null;
  if (entityId) {
    try {
      const e = await client.query("SELECT doc_prefix FROM corporate_entity WHERE entity_id = $1", [entityId]);
      entityPrefix = e.rows[0] && e.rows[0].doc_prefix ? String(e.rows[0].doc_prefix).trim() : null;
    } catch {
      // Never let numbering fail over a cosmetic prefix lookup — the number
      // itself is what the transaction needs.
      entityPrefix = null;
    }
  }

  const { rows } = await client.query(
    "SELECT value FROM setting WHERE section = 'numbering' AND key = $1",
    [moduleKey],
  );
  const override = rows[0] ? rows[0].value : {};
  return { ...DEFAULTS, ...(MODULE_DEFAULT_SCHEMES[String(moduleKey).toUpperCase()] || {}), code, ...(entityPrefix ? { prefix: entityPrefix } : {}), ...override };
}

/**
 * Allocate the next number for { moduleKey, entityId, date }. Atomic upsert on
 * doc_sequence. Returns { number, seq, year }.
 */
async function allocate(client, { moduleKey, entityId, date }) {
  if (!moduleKey) throw new AppError("NO_MODULE", "moduleKey is required", 422);
  if (!entityId) throw new AppError("NO_ENTITY", "entityId is required for numbering", 422);
  const cfg = await schemeFor(client, moduleKey, entityId);
  const y = date
    ? new Date(String(date).slice(0, 10) + "T00:00:00Z").getUTCFullYear()
    : new Date().getUTCFullYear();
  const year = cfg.reset === "never" ? 0 : y;

  const { rows } = await client.query(
    "INSERT INTO doc_sequence (module_key, year, entity_id, seq) VALUES ($1, $2, $3, 1) " +
      "ON CONFLICT (module_key, year, entity_id) DO UPDATE SET seq = doc_sequence.seq + 1 RETURNING seq",
    [moduleKey, year, entityId],
  );
  const seq = rows[0].seq;
  return { number: formatNumber(cfg, { year, seq }), seq, year };
}

/**
 * Allocate a party-document number when the client/supplier has no
 * `corporate_entity` link yet. Party KYC records are allowed before that link
 * exists, so they cannot use `doc_sequence.entity_id` (which is intentionally
 * scoped to a real corporate entity). This separate tenant-local counter keeps
 * the same configurable formatting while preserving that valid onboarding
 * flow. The caller must already be inside its transaction.
 */
async function allocatePartyDocument(client, { moduleKey, partyKind, date }) {
  if (!moduleKey) throw new AppError("NO_MODULE", "moduleKey is required", 422);
  if (!["client", "supplier"].includes(String(partyKind).toLowerCase())) {
    throw new AppError("BAD_PARTY_KIND", "partyKind must be client or supplier", 422);
  }
  const cfg = await schemeFor(client, moduleKey);
  const y = date
    ? new Date(String(date).slice(0, 10) + "T00:00:00Z").getUTCFullYear()
    : new Date().getUTCFullYear();
  const year = cfg.reset === "never" ? 0 : y;
  const kind = String(partyKind).toLowerCase();
  const { rows } = await client.query(
    "INSERT INTO party_document_sequence (party_kind, year, seq) VALUES ($1, $2, 1) " +
      "ON CONFLICT (party_kind, year) DO UPDATE SET seq = party_document_sequence.seq + 1 RETURNING seq",
    [kind, year],
  );
  const seq = rows[0].seq;
  return { number: formatNumber(cfg, { year, seq }), seq, year };
}

module.exports = { formatNumber, schemeFor, allocate, allocatePartyDocument, DEFAULTS };
