/**
 * Counterparty deduplication detection (PR3-C §5.1).
 *
 * A NON-BLOCKING warning: given a candidate name / registrations / email / phone
 * (and, server-side only, bank last-4), score it against the existing masters and
 * return the likely duplicates so the create form and the 360 can surface
 * "Possible duplicates". It never blocks creation — a match is advisory.
 *
 * The scoring is PURE and deterministic (unit-tested directly): an exact
 * normalized tax/legal ID is the strongest signal, an identical normalized name
 * next, then a token-set-similar name, matching email, phone, and a shared bank
 * account last-4. Bank last-4 and the raw matched values are compared here and
 * NEVER returned in the payload — a dedup response is `{ id, name, ref, status,
 * score, reasons[] }` and nothing else.
 */
"use strict";
const { normalizeName } = require("./party-write.service");
const { AppError } = require("../../../utils/errors");

const KIND = {
  client: { table: "client_master", pk: "client_id", idCol: "client_id" },
  supplier: { table: "supplier_master", pk: "supplier_id", idCol: "supplier_id" },
};

// Points per signal. An exact tax ID alone (60) does not cross the 55 threshold
// on its own by much — a matching ID usually co-occurs with a matching name, and
// the caller can raise `min` — but a tax ID + any second signal is a strong hit.
const SCORE = { TAX_ID: 60, NAME_EXACT: 40, EMAIL: 25, PHONE: 20, BANK: 20 };

const digitsOnly = (v) => String(v || "").replace(/\D/g, "");
const lc = (v) => String(v || "").trim().toLowerCase();
/** A registration number normalized for exact comparison (case/space/dashes). */
const normReg = (v) => String(v || "").toUpperCase().replace(/[\s/-]/g, "");
const tokenSet = (name) => new Set(String(name || "").split(/\s+/).filter(Boolean));

/** Jaccard overlap of two token sets — |A∩B| / |A∪B|, 0 when either is empty. */
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * Score one candidate against the normalized input. Pure.
 * @returns {{score:number, reasons:string[]}}
 */
function scoreCandidate(input, cand) {
  let score = 0;
  const reasons = [];

  const inRegs = new Set((input.regNumbers || []).filter(Boolean));
  if (inRegs.size && (cand.regNumbers || []).some((n) => inRegs.has(n))) {
    score += SCORE.TAX_ID;
    reasons.push("Same tax / legal ID");
  }

  if (input.name_norm && cand.name_norm) {
    if (input.name_norm === cand.name_norm) {
      score += SCORE.NAME_EXACT;
      reasons.push("Identical name");
    } else {
      const j = jaccard(tokenSet(input.name_norm), tokenSet(cand.name_norm));
      if (j >= 0.5) {
        score += Math.round(SCORE.NAME_EXACT * j);
        reasons.push(`Similar name (${Math.round(j * 100)}%)`);
      }
    }
  }

  if (input.email_norm && input.email_norm === cand.email_norm) {
    score += SCORE.EMAIL;
    reasons.push("Same email");
  }
  if (input.phone_digits && input.phone_digits === cand.phone_digits) {
    score += SCORE.PHONE;
    reasons.push("Same phone");
  }
  const inBank = new Set(input.bank_last4 || []);
  if (inBank.size && (cand.bank_last4 || []).some((b) => inBank.has(b))) {
    score += SCORE.BANK;
    reasons.push("Matching bank account");
  }

  return { score: Math.min(score, 100), reasons };
}

/**
 * Rank candidates by score, keep those at or above `min` (default 55), cap at
 * `cap` (default 10), highest first. The output carries ONLY safe fields — never
 * the bank last-4, registration numbers or email that were compared. Pure.
 */
function rankCandidates(input, candidates, { min = 55, cap = 10 } = {}) {
  return candidates
    .map((c) => ({ c, ...scoreCandidate(input, c) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map(({ c, score, reasons }) => ({ id: c.id, name: c.name, ref: c.ref || null, status: c.status || null, score, reasons }));
}

/** Normalize the request body into the shape the scorer compares. */
function normalizeInput(input = {}) {
  return {
    name_norm: normalizeName({ name: input.name, legal_name: input.legal_name }),
    email_norm: lc(input.email) || null,
    phone_digits: digitsOnly(input.phone) || null,
    regNumbers: (input.registrations || []).map((r) => normReg(r && r.number)).filter(Boolean),
    bank_last4: (input.bank_last4 || []).map((b) => digitsOnly(b).slice(-4)).filter((b) => b.length === 4),
  };
}

/**
 * Find likely duplicates of `input` among the existing `kind` masters. Gathers
 * candidates by name-trigram similarity, exact email, or a matching registration
 * number, then scores them. `excludeId` drops the record itself (for the 360).
 */
async function findDuplicates(client, { kind, input = {}, excludeId = null, min = 55, cap = 10 }) {
  const cfg = KIND[kind];
  if (!cfg) throw new AppError("BAD_PARTY_KIND", `unknown party kind "${kind}"`, 422);
  const norm = normalizeInput(input);

  // Candidate ids by matching registration number (strongest, exact).
  const idsByReg = new Set();
  if (norm.regNumbers.length) {
    const { rows } = await client.query(
      `SELECT ${cfg.idCol} AS id FROM party_registration
        WHERE ${cfg.idCol} IS NOT NULL AND upper(replace(replace(replace(number,' ',''),'/',''),'-','')) = ANY($1)`,
      [norm.regNumbers],
    );
    for (const r of rows) idsByReg.add(r.id);
  }

  // Candidate rows by name-trigram similarity or exact email.
  const { rows: byNameEmail } = await client.query(
    `SELECT ${cfg.pk} AS id, name, ref, registration_status AS status, name_norm, lower(email) AS email_norm
       FROM ${cfg.table}
      WHERE is_active IS NOT false
        AND (($1::text IS NOT NULL AND name_norm % $1) OR ($2::text IS NOT NULL AND lower(email) = $2))
      LIMIT 50`,
    [norm.name_norm, norm.email_norm],
  );

  const byId = new Map(byNameEmail.map((r) => [r.id, r]));
  // Load any reg-matched candidates not already gathered by name/email.
  const missing = [...idsByReg].filter((id) => !byId.has(id));
  if (missing.length) {
    const { rows } = await client.query(
      `SELECT ${cfg.pk} AS id, name, ref, registration_status AS status, name_norm, lower(email) AS email_norm
         FROM ${cfg.table} WHERE ${cfg.pk} = ANY($1)`,
      [missing],
    );
    for (const r of rows) byId.set(r.id, r);
  }

  const ids = [...byId.keys()].filter((id) => String(id) !== String(excludeId));
  if (ids.length === 0) return { candidates: [] };

  // Attach each candidate's registration numbers (normalized) for scoring.
  const { rows: regs } = await client.query(
    `SELECT ${cfg.idCol} AS id, number FROM party_registration WHERE ${cfg.idCol} = ANY($1)`,
    [ids],
  );
  const regsById = new Map();
  for (const r of regs) {
    if (!regsById.has(r.id)) regsById.set(r.id, []);
    regsById.get(r.id).push(normReg(r.number));
  }

  const candidates = ids.map((id) => {
    const row = byId.get(id);
    return { ...row, regNumbers: regsById.get(id) || [] };
  });

  return { candidates: rankCandidates(norm, candidates, { min, cap }) };
}

module.exports = {
  KIND,
  SCORE,
  jaccard,
  tokenSet,
  normReg,
  digitsOnly,
  scoreCandidate,
  rankCandidates,
  normalizeInput,
  findDuplicates,
};
