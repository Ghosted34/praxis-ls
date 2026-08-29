/**
 * Signature credentials (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.7).
 *
 * TWO credentials, stored according to WHAT EACH ONE GRANTS — not uniformly.
 *
 *   verify_code   12 chars Crockford base32. PLAINTEXT in the database.
 *                 Grants: a public read of a summary the tenant chose to
 *                 publish. Appears twice on the printed document — inside the
 *                 QR as https://{host}/v/{code}, and as text beneath it.
 *
 *   sign_token    32 random bytes, base64url. HMAC-SHA256 under a server-side
 *                 pepper; the plaintext is emailed once and never stored.
 *                 Grants: THE ABILITY TO SIGN AS A PARTY. (PR-3)
 *
 * ── Why the verify code is not peppered ────────────────────────────────────
 * An earlier draft peppered both. That cost real capability — an operator could
 * not read a code down the phone, no admin screen could list verification
 * links, a document could never be reprinted with its own QR — to defend a case
 * that does not hold up: anyone who can dump this table can already read every
 * invoice in it directly, so a working verify link discloses strictly less than
 * the dump they would already be holding. The sign token is different in kind:
 * a leaked one is a forged signature.
 *
 * ── Why ONE public credential and not two ──────────────────────────────────
 * The QR and the printed line grant the same thing, so a separate 43-character
 * token for the QR was duplication — two columns, two indexes, two things that
 * can disagree. Collapsing them also makes the QR work: 12 characters need
 * roughly a 21-module symbol where 43 need ~33, which in the 20 mm the seal can
 * spare is the difference between ~0.95 mm and ~0.6 mm per module. A logistics
 * document gets photocopied, faxed and shot from a phone in a dim warehouse.
 */
"use strict";

const crypto = require("crypto");

/**
 * Crockford base32: no I, L, O or U. The first three because they are
 * indistinguishable from 1/1/0 in the 5 pt type this prints at; U because
 * excluding it makes accidental profanity in a random code far less likely,
 * which matters on a document that goes to a customer.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 12; // 32^12 = 2^60. Safe ONLY with the portal rate limiter.

/**
 * Crockford's canonical read-side substitutions, applied before lookup.
 * Null-prototype for the same reason as the maps in canonical.js and
 * presets.js: the input is already filtered to [0-9A-Z] below, so a prototype
 * member cannot reach it today — but that safety lives in a regex three
 * functions away, and this costs nothing to make local.
 */
const NORMALISE = Object.assign(Object.create(null), { I: "1", L: "1", O: "0", U: "V" });

/**
 * Generate a verify code, uniformly.
 *
 * ⚠ REJECTION SAMPLING, not `byte % 32` (CodeQL js/biased-cryptographic-random).
 *
 * With today's 32-character alphabet `%` happens to be unbiased, because 256 is
 * an exact multiple of 32 — an earlier version of this function said so in a
 * comment and left the modulo in place. That comment was describing a property
 * of the CONSTANT, not of the code: add or remove one character from ALPHABET
 * and the low-numbered characters silently become likelier than the rest, in a
 * credential nobody would think to re-audit.
 *
 * Drawing only from the largest whole multiple of the alphabet length that fits
 * in a byte, and discarding the remainder, is uniform for ANY length. Rejected
 * bytes cost a little entropy, never correctness: at 32 characters the reject
 * rate is zero, and it stays under 25% for every length up to 256.
 */
function mintVerifyCode() {
  const n = ALPHABET.length;
  const limit = Math.floor(256 / n) * n;
  let out = "";
  while (out.length < CODE_LENGTH) {
    const bytes = crypto.randomBytes(CODE_LENGTH);
    for (let i = 0; i < bytes.length && out.length < CODE_LENGTH; i += 1) {
      if (bytes[i] < limit) out += ALPHABET[bytes[i] % n];
    }
  }
  return out;
}

/**
 * Accept what a human actually types: lower case, Crockford's confusable
 * substitutions, and any separator they felt like using. A verification code
 * read down a phone line must not fail because someone typed a space.
 */
function normaliseCode(input) {
  const raw = String(input || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  let out = "";
  for (const ch of raw) out += NORMALISE[ch] || ch;
  return out;
}

/** Valid shape? Checked before a database round-trip, so junk costs nothing. */
function isValidCode(input) {
  const c = normaliseCode(input);
  if (c.length !== CODE_LENGTH) return false;
  for (const ch of c) if (!ALPHABET.includes(ch)) return false;
  return true;
}

/** `A4B7K92MXQ1P` → `A4B7-K92M-XQ1P`. Grouping is display-only; never stored. */
const formatCode = (code) => normaliseCode(code).replace(/(.{4})(?=.)/g, "$1-");

/** The URL the QR encodes. Short by design — see the header.
 *
 *  The trailing-slash trim is a LOOP, not `replace(/\/+$/, "")` — the last live
 *  copy of the pattern `verify-link.normaliseBase` and `qes.service` both record
 *  removing (CodeQL js/polynomial-redos). A quantifier anchored at the end of a
 *  string makes the engine re-scan from every start position when the match
 *  ultimately fails, which is quadratic in the length of the run: measured in
 *  this repo at 1.4 s for sixty thousand characters, on a single-threaded
 *  server.
 *
 *  Not reachable with a long run TODAY — the only caller is verify-link.js:97,
 *  which passes a base its own loop has already trimmed. But this function is
 *  exported, the origin behind it begins life as `req.get("host")`, and "safe
 *  because of what the one current caller happens to do" is exactly the property
 *  that stops holding without anyone noticing. Linear costs nothing here. */
function verifyUrl(code, baseUrl) {
  let base = String(baseUrl || "");
  while (base.endsWith("/")) base = base.slice(0, -1);
  return `${base}/v/${normaliseCode(code)}`;
}

// ── Signing tokens (PR-3 consumes these; they live here so both credentials
//    are defined in one place and cannot drift apart) ────────────────────────

/**
 * The pepper is read lazily rather than at module load. Requiring it at import
 * time would break every unit test that touches a module which transitively
 * requires this one — and would fail at boot in a worker that never signs
 * anything. Failing at the moment a token is minted puts the error where the
 * operator can act on it.
 */
function pepper() {
  const p = process.env.SIGNATURE_TOKEN_PEPPER;
  if (!p || p.length < 32) {
    throw new Error(
      "SIGNATURE_TOKEN_PEPPER must be set to at least 32 characters before signing tokens can be issued. See doc/SIGNATURE_ENGINEERING_GUIDE.md §9.5.",
    );
  }
  return p;
}

const hmac = (value, key) => crypto.createHmac("sha256", key).update(String(value)).digest("hex");

/** Mint a signing token. The plaintext is returned ONCE and never stored. */
function mintSignToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hmac: hmac(token, pepper()) };
}

/**
 * HMAC a presented signing token for index lookup, trying the previous pepper
 * during a rotation window. Returns every candidate so the caller can look up
 * with `= ANY($1)` in one query rather than two round-trips.
 */
function signTokenCandidates(token) {
  const out = [hmac(token, pepper())];
  const prev = process.env.SIGNATURE_TOKEN_PEPPER_PREVIOUS;
  if (prev && prev.length >= 32) out.push(hmac(token, prev));
  return out;
}

module.exports = {
  ALPHABET,
  CODE_LENGTH,
  mintVerifyCode,
  normaliseCode,
  isValidCode,
  formatCode,
  verifyUrl,
  mintSignToken,
  signTokenCandidates,
};
