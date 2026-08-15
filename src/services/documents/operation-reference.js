/**
 * Operation-file references — the non-enumerable half of tenant numbering.
 *
 * ── WHY THIS IS NOT `numbering.service.allocate()` ──────────────────────────
 *
 * `allocate()` is right for money. It burns a `doc_sequence` counter so invoice
 * numbers are gap-free per entity and per year, which is what an accountant
 * reconciling a statutory ledger needs and what OHADA expects. Nothing in this
 * file changes that, and nothing in this file should ever be used for an
 * invoice, a receipt, a journal entry or a tax document.
 *
 * A DOSSIER reference is a different object with a different threat model: it
 * is the one number in the system a CLIENT holds. `SLAS-OPS-2026-0142` tells
 * them how many files we opened this year, roughly when theirs was opened, and
 * that `…-0141` and `…-0143` are worth trying. A reference is never
 * authorization — every read is gated by tenant/RBAC, and the client portal by
 * ownership — but enumerability leaks the shape of the business on its own, and
 * we print it on every document.
 *
 * So operation files get their own allocator, and it is deliberately the LEGACY
 * shape modernised rather than something new: `SL6721864SM` was
 * entity-prefix + random core + service code, and the business already reads
 * references that way.
 *
 *     SL      7Z3K9QW2M4XB      SM
 *     ^prefix ^random core      ^service code
 *
 * The prefix and code are recognition only, and they intentionally reveal a
 * little operational context. ALL of the security property is the core.
 *
 * ── WHAT THE CORE IS, AND WHAT IT MUST NEVER BE ─────────────────────────────
 *
 * `crypto.randomBytes`, Crockford Base32, 12 characters. Never `Math.random()`,
 * never a timestamp, never a sequence value, never a slice of the dossier UUID,
 * never a hash of the client/entity/service — every one of those is either
 * predictable or correlated with something the client already knows, which is
 * the whole failure this replaces.
 *
 * CROCKFORD BASE32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`) drops I, L, O and U, so
 * a reference read down a phone line or copied off a printed document has no
 * 1/I/l or 0/O ambiguity — these get dictated, and a shape people mistype is a
 * support call.
 *
 * TWELVE CHARACTERS = 60 BITS. The design note asks for 10-12 characters and at
 * least 60 bits, preferring 80+ at SaaS scale; 12 is the top of that range and
 * the point where the reference is still short enough to say out loud
 * (`SL7Z3K9QW2M4XBSM`, 16 characters — the legacy shape was 11). At a million
 * files per tenant a blind guess hits an existing reference about once in a
 * trillion, and a hit still yields nothing without authorization. Raising it to
 * 80 bits is `CORE_LENGTH = 16` and nothing else: the format is positional from
 * the left, so longer cores parse and sort exactly the same.
 *
 * NO MODULO BIAS. 256 is an exact multiple of 32, so masking a random byte with
 * `& 31` is uniform over the alphabet. `% 30`-style folding over a non-power-of-
 * two alphabet would quietly favour the first characters, which is the classic
 * way a "random" token ends up with less entropy than its length suggests.
 */
"use strict";

const crypto = require("crypto");
const { AppError } = require("../../utils/errors");

/** null/undefined-safe stringify. `eqeqeq` is on, so the two are named. */
const str = (v) => (v === null || v === undefined ? "" : String(v));

/** Crockford Base32 — 32 symbols, no I/L/O/U. Exactly 5 bits per character. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 12 × 5 bits = 60 bits. See the header for why this number and not another. */
const CORE_LENGTH = 12;

/**
 * How many times the allocator regenerates a core after a unique conflict.
 *
 * Four is not a tuning knob so much as a tripwire. With 60 bits, a genuine
 * collision is a once-in-astronomy event — so a SECOND one in the same call
 * means something is wrong that a fifth attempt will not fix (a duplicated
 * random source, a broken RNG, a unique index covering more than `ref`). Failing
 * loudly at that point is more useful than retrying into a corner.
 */
const MAX_ATTEMPTS = 4;

/**
 * Fallback characters for a prefix or code whose first choice is taken.
 *
 * Letters before digits (a two-letter prefix reads as a name; `S7` reads as a
 * fallback, which is what it is), I/L/O/U dropped for the same reason as the
 * core alphabet, and 0/1 dropped as well — those two are the pair people
 * actually confuse with O and I when reading two characters in isolation.
 */
const FALLBACK_CHARS = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/**
 * The code used when a file has no service type.
 *
 * `service_type_id` is optional on a dossier, so the reference still needs a
 * closing pair. Reserved from generation, so no real service type can be
 * assigned it and make "this file has no service type" indistinguishable from
 * a genuine service.
 */
const GENERIC_SERVICE_CODE = "OP";

/**
 * The shipped taxonomy's codes.
 *
 * These are not arbitrary — they are the codes on the legacy references the
 * business has been reading for years (`SL6721864SM` is a sea import). Kept in
 * step with migration 0682's seed by
 * tests/unit/operation-reference-service-code.test.js, which reads both files.
 */
const DEFAULT_SERVICE_CODES = {
  SEA_FREIGHT_IMPORT: "SM",
  SEA_FREIGHT_EXPORT: "SX",
  AIR_FREIGHT_IMPORT: "AM",
  AIR_FREIGHT_EXPORT: "AX",
  HINTERLAND_TRANSIT: "HT",
  INLAND_TRANSPORTATION: "IT",
  WAREHOUSING: "WH",
  END_TO_END_AIR_FREIGHT: "AF",
  END_TO_END_SEA_FREIGHT: "EF",
  BUSINESS_REPRESENTATION: "BR",
  CUSTOMS_BROKERAGE: "CB",
  PROJECT_CARGO: "PC",
};

/* ── The random core ───────────────────────────────────────────────────────── */

/**
 * `length` cryptographically random Crockford Base32 characters.
 *
 * One byte per character rather than bit-packing: the bytes are free and the
 * masking stays obviously correct, which matters more here than 3 bytes of
 * entropy per 5 characters.
 */
function randomCore(length = CORE_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] & 31];
  return out;
}

/* ── Format ────────────────────────────────────────────────────────────────── */

/** `SL` + `7Z3K9QW2M4XB` + `SM`. No separators: this is the stored value. */
function formatOperationReference({ prefix, core, code }) {
  return String(prefix) + String(core) + String(code);
}

/**
 * `SL-7Z3K9QW2M4XB-SM` — for display only, never for storage.
 *
 * The canonical value has no separators (that is what `dossier.ref` holds and
 * what the unique index is on); this exists so a screen or a printed document
 * can group the three parts without anyone being tempted to store the grouped
 * form and end up with two spellings of one reference.
 */
function displayOperationReference(ref) {
  const parsed = parseOperationReference(ref);
  if (!parsed) return String(ref || "");
  return `${parsed.prefix}-${parsed.core}-${parsed.code}`;
}

/** Uppercased, with display separators and spaces removed. */
const normaliseReference = (value) =>
  str(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");

/**
 * Does this look like a `doc_sequence` number — `SLAS-OPS-2026-0142`?
 *
 * A separator AND a four-digit segment. Both halves are needed: the year alone
 * would match a legacy `SL6721864SM` core, and a separator alone would match
 * the display form of an opaque reference.
 *
 * Its own predicate because BOTH readers below need it and they cannot ask each
 * other — `parseOperationReference` strips separators, which is exactly what
 * turns `SLAS-OPS-2026-0142` into something that satisfies its positional
 * pattern (prefix `SL`, core `ASOPS202601`, code `42`). Every sequential
 * reference in the system parses as an operation reference unless this runs
 * first, and it is the older shape, so it gets asked first.
 */
const isSequentialShape = (raw) => /[-/]/.test(raw) && /(^|[-/])\d{4}([-/]|$)/.test(raw);

/**
 * Split a canonical operation reference back into its three parts, or null.
 *
 * Positional from both ends — two characters of prefix, two of code, the rest
 * is core — so it keeps working if `CORE_LENGTH` is ever raised, and it accepts
 * the legacy 7-digit shape too (`SL6721864SM`), which is the point: support
 * looks up old and new references through the same lens.
 */
function parseOperationReference(value) {
  const raw = str(value).trim().toUpperCase();
  if (isSequentialShape(raw)) return null;
  const ref = normaliseReference(raw);
  const m = /^([A-Z0-9]{2})([0-9A-Z]{6,})([A-Z0-9]{2})$/.exec(ref);
  if (!m) return null;
  return { prefix: m[1], core: m[2], code: m[3], ref };
}

/**
 * Which numbering scheme produced a reference.
 *
 * Three shapes coexist permanently and all three must remain searchable, so
 * something has to be able to tell them apart:
 *
 *   LEGACY_RANDOM      SL6721864SM           the PHP system's references
 *   MODERN_SEQUENTIAL  SLAS-OPS-2026-0142    `numbering.allocate()`, pre-0682
 *   MODERN_OPAQUE      SL7Z3K9QW2M4XBSM      this allocator
 *
 * Derived from the value rather than stored in a column. A `reference_scheme`
 * column was considered and rejected: nothing needs to QUERY by scheme, the
 * answer is a pure function of a string we already have, and `dossier_visible`
 * is a `SELECT *` view that a new column forces to be dropped and recreated —
 * real risk for metadata that is decidable without it.
 */
function classifyReference(value) {
  const ref = str(value).trim().toUpperCase();
  if (!ref) return null;
  if (ref.startsWith("DRAFT-")) return "DRAFT";
  if (isSequentialShape(ref)) return "MODERN_SEQUENTIAL";
  const parsed = parseOperationReference(ref);
  if (!parsed) return null;
  // Legacy cores were digits only. The new core is Base32 and, at 12 characters,
  // is all-digits about once in 30 billion — so a legacy-looking short numeric
  // core is legacy, and anything of the current length is not.
  if (/^\d+$/.test(parsed.core) && parsed.core.length < CORE_LENGTH) return "LEGACY_RANDOM";
  return "MODERN_OPAQUE";
}

/* ── Deriving the two recognition markers ──────────────────────────────────── */

/**
 * Split a name into ASCII words, accents folded.
 *
 * Punctuation becomes a space FIRST, while "É" is still one letter, and only
 * then is the string NFD-normalised and stripped to ASCII. The other order
 * turns the combining accent into a separator and splits "Étoile" into "E" and
 * "toile". Migration 0682 does the same two passes in SQL — see the note there.
 */
function words(name) {
  return str(name)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .normalize("NFD")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** First letter of the first two words; one word gives its first two letters. */
function initials(name) {
  const w = words(name);
  const first = (w[0] || "").charAt(0) || "X";
  const second = (w[1] || "").charAt(0) || (w[0] || "").charAt(1) || "X";
  const out = (first + second).toUpperCase();
  return /^[A-Z0-9]{2}$/.test(out) ? out : "XX";
}

/** "Smart Logistics" → SL, "Base Cameroon Limited" → BC, "Praxis" → PR. */
const derivePrefix = (name) => initials(name);

/**
 * The code this service type would PREFER — "PROJECT_CARGO" → PC (mapped), an
 * unmapped "COLD_CHAIN" → CC.
 *
 * A preference, not a decision: it may return a code another service already
 * holds, and it may return the reserved `OP`. Both are settled by the candidate
 * walk in `assignMarker`, which is also where migration 0682's seed settles
 * them — one rule, applied in two places, rather than two rules that agree
 * today. (A `OP` → `OX` special case here looked tidier and made the JS and the
 * SQL hand different codes to the same key.)
 */
function deriveServiceCode(key) {
  const k = str(key).trim().toUpperCase();
  if (DEFAULT_SERVICE_CODES[k]) return DEFAULT_SERVICE_CODES[k];
  return initials(k.replace(/_/g, " "));
}

/**
 * Every two-character marker to try, best first.
 *
 * Deterministic and total: the preferred initials, then the second character
 * walked through `FALLBACK_CHARS` (SL taken → SA, SB, SC…), then the whole
 * two-character space. 900 candidates, so it only runs out on a tenant with 900
 * entities — at which point a typed error is the honest answer.
 *
 * Determinism is the requirement that matters. An entity's prefix is assigned
 * once and then quoted to clients forever, so "what would this name have been
 * given" must have one answer, today and on a restored backup.
 */
function markerCandidates(preferred, { reserved = [] } = {}) {
  const skip = new Set(reserved);
  const seen = new Set();
  const out = [];
  const push = (c) => {
    if (skip.has(c) || seen.has(c)) return;
    seen.add(c);
    out.push(c);
  };
  push(preferred);
  for (const c of FALLBACK_CHARS) push(preferred.charAt(0) + c);
  for (const a of FALLBACK_CHARS) for (const b of FALLBACK_CHARS) push(a + b);
  return out;
}

/* ── Assignment (persisted once, never recomputed) ─────────────────────────── */

/** The two tables that carry a marker, and nothing else, ever. */
const MARKER_TARGETS = {
  entity: { table: "corporate_entity", pk: "entity_id", column: "ops_reference_prefix" },
  service_type: { table: "service_type", pk: "service_type_id", column: "ops_reference_code" },
};

/**
 * Assign `column` on `table` to the first free candidate, and keep it.
 *
 * WHY IT IS PERSISTED. Recomputing the marker per reference would mean creating
 * a second entity later could silently change what the first one's NEW files
 * are called, while its old ones kept the original — one entity, two prefixes,
 * no record of when it changed. So it is written once and read thereafter.
 *
 * WHY THE PRE-READ IS NOT THE DEFENCE. The taken-set read only avoids burning
 * attempts; the unique index is what actually decides, and a 23505 from a
 * concurrent assignment falls through to the next candidate. Under a savepoint,
 * because we are inside the caller's transaction and a failed statement would
 * otherwise poison it (see `withSavepoint`).
 */
async function assignMarker(client, { target, id, preferred, reserved }) {
  // The only three identifiers this file ever puts in SQL, named here rather
  // than passed in. A caller cannot reach the interpolation, so there is no
  // path from a request to a SQL identifier — the property CodeQL's
  // `js/sql-injection` rule is looking for, stated rather than argued.
  const { table, pk, column } = MARKER_TARGETS[target];
  const taken = new Set(
    (await client.query(`SELECT ${column} AS marker FROM ${table} WHERE ${column} IS NOT NULL`)).rows
      .map((r) => r.marker)
      .filter(Boolean),
  );
  for (const candidate of markerCandidates(preferred, { reserved })) {
    if (taken.has(candidate)) continue;
    let conflicted = false;
    const assigned = await withSavepoint(client, "praxis_ops_marker", async () => {
      const { rows } = await client.query(
        `UPDATE ${table} SET ${column} = $2 WHERE ${pk} = $1 AND ${column} IS NULL RETURNING ${column} AS marker`,
        [id, candidate],
      );
      if (rows.length) return rows[0].marker;
      // Nothing updated: either a concurrent caller assigned one first — in
      // which case take theirs rather than fighting over it — or the row is
      // gone, which is not something more candidates will fix.
      const { rows: current } = await client.query(
        `SELECT ${column} AS marker FROM ${table} WHERE ${pk} = $1`,
        [id],
      );
      if (!current.length) {
        throw new AppError("OPS_MARKER_TARGET_GONE", `That ${target} no longer exists`, 422);
      }
      return current[0].marker || null;
    }).catch((err) => {
      if (!isUniqueViolation(err)) throw err;
      conflicted = true;
      return null;
    });
    if (assigned) return assigned;
    // A null with no 23505 means the row exists and still has no marker, which
    // only happens if the UPDATE matched nothing for a reason we do not model.
    if (!conflicted) break;
  }
  throw new AppError(
    "OPS_MARKER_EXHAUSTED",
    `No operation-reference marker is free for ${target}`,
    500,
  );
}

/**
 * This entity's two-character prefix, assigning one from its name if it has
 * none. Migration 0682 seeds every row that existed; this covers entities
 * created since, and any tenant whose seed left a row unassigned.
 */
async function entityPrefix(client, entityId) {
  if (!entityId) throw new AppError("REF_ENTITY_REQUIRED", "entity_id is required to allocate an operation reference", 422);
  const { rows } = await client.query(
    "SELECT ops_reference_prefix, trading_name, legal_name FROM corporate_entity WHERE entity_id = $1",
    [entityId],
  );
  const row = rows[0];
  if (!row) throw new AppError("REF_ENTITY_REQUIRED", "That corporate entity does not exist", 422);
  if (row.ops_reference_prefix) return row.ops_reference_prefix;
  return assignMarker(client, {
    target: "entity",
    id: entityId,
    preferred: derivePrefix(row.trading_name || row.legal_name || "Entity"),
  });
}

/** This service type's two-character code, or `OP` when the file has none. */
async function serviceTypeCode(client, serviceTypeId) {
  if (!serviceTypeId) return GENERIC_SERVICE_CODE;
  const { rows } = await client.query(
    "SELECT ops_reference_code, key FROM service_type WHERE service_type_id = $1",
    [serviceTypeId],
  );
  const row = rows[0];
  // A dossier can carry a service_type_id the row for which has since gone; the
  // reference still has to be allocatable.
  if (!row) return GENERIC_SERVICE_CODE;
  if (row.ops_reference_code) return row.ops_reference_code;
  return assignMarker(client, {
    target: "service_type",
    id: serviceTypeId,
    preferred: deriveServiceCode(row.key),
    reserved: [GENERIC_SERVICE_CODE],
  });
}

/* ── Collision handling ────────────────────────────────────────────────────── */

const isUniqueViolation = (err) => Boolean(err) && err.code === "23505";

/**
 * A 23505 that is specifically about a `ref` column.
 *
 * Narrow on purpose. Retrying a NEW random core only helps if the core is what
 * conflicted — a duplicate on anything else (a container line, an idempotency
 * key) would be retried three more times and then reported as a reference
 * problem, sending whoever reads the log to the wrong place entirely.
 *
 * `dossier_ref_key` is the constraint Postgres names for `ref text UNIQUE`, and
 * `detail` reads `Key (ref)=(…) already exists.` — either identifies it, and
 * matching both means a renamed constraint does not silently disable the retry.
 */
const isRefConflict = (err) =>
  isUniqueViolation(err) &&
  /(^|[^a-z])ref([^a-z]|$)/i.test(`${err.constraint || ""} ${err.detail || ""}`);

/** Only a code-provided identifier ever reaches the SQL below. */
const SAFE_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Run `fn` so that a failed statement inside it does not abort the caller's
 * transaction.
 *
 * THIS IS WHAT MAKES "RETRY ON CONFLICT" POSSIBLE AT ALL. Postgres aborts the
 * whole transaction on any statement error — after a 23505 every subsequent
 * statement answers 25P02 "current transaction is aborted" until a rollback. So
 * a retry loop inside the caller's transaction without savepoints does not
 * retry anything; it fails four times and reports the last error, having also
 * destroyed the caller's work.
 *
 * Outside a transaction there is nothing to poison — each statement is its own
 * transaction — so `SAVEPOINT` raising 25P01 is a fine answer and the body runs
 * unwrapped. That is what lets a caller use the allocator either way.
 */
async function withSavepoint(client, name, fn) {
  if (!SAFE_NAME.test(name)) throw new AppError("BAD_SAVEPOINT", "Invalid savepoint name", 500);
  let opened = false;
  try {
    await client.query(`SAVEPOINT ${name}`);
    opened = true;
  } catch {
    // 25P01 — not inside a transaction, so there is no state to protect.
    // @silent:teardown
  }
  try {
    const out = await fn();
    if (opened) await client.query(`RELEASE SAVEPOINT ${name}`);
    return out;
  } catch (err) {
    if (opened) {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await client.query(`RELEASE SAVEPOINT ${name}`);
      } catch {
        // The connection is already gone; the original error is the useful one.
        // @silent:teardown
      }
    }
    throw err;
  }
}

/* ── The allocator ─────────────────────────────────────────────────────────── */

/**
 * Allocate an operation-file reference and perform the caller's write with it.
 *
 * WHY THE WRITE IS AN ARGUMENT rather than the reference being returned. The
 * database is the only thing that can tell us a reference is taken, so the
 * generate step and the insert step cannot be separated: returning a "free"
 * reference for the caller to insert later is a check-then-act race, and a
 * pre-`SELECT` as the sole defence is exactly the unsafe pre-check this design
 * forbids. Handing the write in means one loop owns generate → write → retry,
 * and the unique index on `dossier.ref` stays the final authority.
 *
 * `write` runs inside the caller's transaction (a savepoint per attempt), so
 * the reference and the row commit together or not at all.
 *
 * @param {{query: Function}} client   tenant client, already in a transaction
 * @param {object}   args
 * @param {string}   args.entityId       whose prefix leads the reference
 * @param {?string}  args.serviceTypeId  null for a file with no service type
 * @param {(ref: string) => Promise<object>} args.write  insert/update to attempt
 * @returns {Promise<{row: object, ref: string, prefix: string, code: string, attempts: number}>}
 */
async function allocateOperationReference(client, { entityId, serviceTypeId = null, write }) {
  if (typeof write !== "function") {
    throw new AppError("REF_WRITE_REQUIRED", "allocateOperationReference needs the write to attempt", 500);
  }
  const prefix = await entityPrefix(client, entityId);
  const code = await serviceTypeCode(client, serviceTypeId);

  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const ref = formatOperationReference({ prefix, core: randomCore(), code });
    try {
      const row = await withSavepoint(client, "praxis_ops_ref", () => write(ref));
      return { row, ref, prefix, code, attempts: attempt };
    } catch (err) {
      if (!isRefConflict(err)) throw err;
      last = err;
    }
  }
  // Typed, and a 500 rather than a 409: at 60 bits this cannot be bad luck, so
  // it is our fault and not something the caller can fix by trying again.
  throw new AppError(
    "REF_COLLISION_RETRY_EXHAUSTED",
    `Could not allocate a unique operation reference after ${MAX_ATTEMPTS} attempts`,
    500,
    { prefix, code, cause: last ? last.constraint || last.code : null },
  );
}

module.exports = {
  allocateOperationReference,
  entityPrefix,
  serviceTypeCode,
  // Pure, and exported because the tests and the admin screens need them.
  randomCore,
  formatOperationReference,
  displayOperationReference,
  parseOperationReference,
  isSequentialShape,
  normaliseReference,
  classifyReference,
  derivePrefix,
  deriveServiceCode,
  markerCandidates,
  withSavepoint,
  isRefConflict,
  ALPHABET,
  CORE_LENGTH,
  MAX_ATTEMPTS,
  FALLBACK_CHARS,
  GENERIC_SERVICE_CODE,
  DEFAULT_SERVICE_CODES,
};
