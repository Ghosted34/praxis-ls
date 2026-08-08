/**
 * PII and credential scrubbing for free-form error text (spec §11 — "error
 * messages sanitised before storage (no PII)").
 *
 * WHY THIS EXISTS SEPARATELY FROM THE LOGGER'S REDACTION
 *
 *   pino redacts by PATH: `req.body.password`, `*.api_key`. That works because a
 *   log line is a structured object and the secret sits at a known key. An error
 *   MESSAGE is a string, and the secret is inside it:
 *
 *     error: duplicate key value violates unique constraint "user_email_key"
 *            DETAIL: Key (email)=(marie@client.cm) already exists.
 *     error: connect ECONNREFUSED postgres://user:pass@10.0.0.4:5432/tenant_x
 *     Error: 401 from provider (Authorization: Bearer eyJhbGciOi…)
 *
 *   There is no path to point pino at. Every one of those reached
 *   platform.error_event verbatim, was rendered into the console feed, exported
 *   to CSV, and — worst — put in the AI explain prompt, which is the one sink
 *   that leaves the building. This module is the pass that catches them.
 *
 * WHERE IT RUNS
 *
 *   In `error-reporter.report()`, before the fingerprint is computed and before
 *   anything is persisted or posted. One call site covers all four sinks (the
 *   webhook, the structured log, the database, and the explain prompt built from
 *   the database), which is the only arrangement where "we scrub errors" is a
 *   true statement rather than a per-sink promise that one sink forgets.
 *
 * DESIGN CONSTRAINTS — this is a scrubber, not a shredder
 *
 *   The output is still a debugging artefact. A pass that redacts aggressively
 *   produces rows nobody can act on, and an unusable error feed gets ignored,
 *   which costs more than the leak it prevented. So:
 *
 *     - File paths, line numbers, uuids, table and column names are UNTOUCHED.
 *       They carry no PII and they are the entire diagnostic value.
 *     - Card numbers are Luhn-checked before redaction, because a bare run of 16
 *       digits is far more often an id, a timestamp or a quantity.
 *     - Each pattern replaces with a NAMED placeholder (`<email>`, `<token>`),
 *       so the shape of the message survives: "duplicate key (email)=(<email>)"
 *       still tells you exactly what happened.
 *
 * EFFECT ON FINGERPRINTS — deliberate, and an improvement
 *
 *   Scrubbing before `fingerprint()` means "no user marie@client.cm" and "no
 *   user paul@client.cm" collapse to one signature instead of one per customer.
 *   That is the same reasoning the reporter already applies to uuids and bare
 *   numbers; emails were simply a hole in it.
 */

"use strict";

const { SENSITIVE_KEYS } = require("../../config/logger");

/** Longest keys first so `refresh_token` is not half-matched by `token`. */
const KEY_ALTERNATION = [...SENSITIVE_KEYS]
  .concat(["authorization", "auth", "cookie", "session", "otp", "passwd", "pwd"])
  .sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

/**
 * Ordered. Earlier rules consume text that later, broader rules would otherwise
 * mangle — the connection-string rule has to run before the generic key=value
 * rule, or `postgres://user:pass@host` loses only the word "pass".
 */
const RULES = [
  // ── Credentials in connection strings ────────────────────────────────────
  // Keeps the scheme and the host, which is the diagnostic half.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@]+@/gi, "$1<credentials>@"],

  // ── PEM private keys ─────────────────────────────────────────────────────
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<private-key>"],

  // ── JWTs ─────────────────────────────────────────────────────────────────
  // Three base64url segments; the `eyJ` anchor is the JSON header, which is what
  // makes this specific enough not to catch ordinary dotted identifiers.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<jwt>"],

  // ── Bearer / Basic auth ──────────────────────────────────────────────────
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 <token>"],

  // ── Provider API keys ────────────────────────────────────────────────────
  // Same shapes the CI secret scan looks for, so a key that would fail the
  // commit gate is also a key we refuse to store when it arrives at runtime.
  [/\bsk-[A-Za-z0-9]{20,}/g, "<api-key>"],
  [/\bAIza[0-9A-Za-z_-]{35}/g, "<api-key>"],
  [/\bgsk_[A-Za-z0-9]{40,}/g, "<api-key>"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "<api-key>"],
  [/\bghp_[A-Za-z0-9]{36}/g, "<api-key>"],
  [/\bAKIA[0-9A-Z]{16}/g, "<api-key>"],

  // ── key = value, for the key names the logger already treats as sensitive ─
  // Covers `password: 'x'`, `"api_key":"x"`, `token=x` and `?secret=x` in one
  // rule. The value stops at a quote, comma, ampersand, brace or whitespace.
  //
  // IT MUST NOT RE-REDACT WHAT AN EARLIER RULE ALREADY HANDLED. `authorization`
  // is in the key list and the Bearer rule above runs first, so without the
  // guard below this rule fires a second time on its own output:
  //
  //   "Authorization: Bearer abc123…"
  //     → Bearer rule   → "Authorization: Bearer <token>"
  //     → this rule     → "Authorization: <redacted> <token>"     ✗
  //
  // Still redacted, so not a leak — but it swaps a precise placeholder for a
  // vaguer one and mangles the sentence, which is the exact property this
  // module exists to preserve. The scheme is captured so `Bearer` survives as
  // structure rather than being eaten as if it were the secret.
  [
    new RegExp(
      `\\b(${KEY_ALTERNATION})(["']?\\s*[:=]\\s*)(["']?)((?:Bearer|Basic)\\s+)?([^"'\\s,;&})\\]]{3,})`,
      "gi",
    ),
    (m, key, sep, quote, scheme, value) =>
      (/^<[a-z-]+>$/i.test(value) ? m : `${key}${sep}${quote}${scheme || ""}<redacted>`),
  ],

  // ── Email addresses ──────────────────────────────────────────────────────
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<email>"],

  // ── International phone numbers ──────────────────────────────────────────
  // Requires the leading +, which is what separates a phone number from a
  // quantity, an id or a port.
  [/\+\d[\d\s().-]{7,16}\d/g, "<phone>"],
];

/** Luhn — the only thing that makes a 16-digit run more likely a card than an id. */
function luhnValid(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Card numbers, Luhn-gated. Deliberately last and deliberately conservative:
 * redacting every long digit run would eat document numbers, timestamps and
 * primary keys, which are exactly what an error about them needs to name.
 */
function scrubCards(text) {
  return text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return match;
    return luhnValid(digits) ? "<card>" : match;
  });
}

/**
 * Scrub a free-form string. Returns non-strings unchanged and never throws —
 * this sits on the error path, where a scrubber that throws would turn a handled
 * 500 into an unhandled one.
 *
 * @param {*} value
 * @param {{ max?: number }} [opts] hard cap on the returned length
 * @returns {*}
 */
function scrub(value, opts = {}) {
  if (typeof value !== "string" || value === "") return value;
  try {
    let out = value;
    for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
    out = scrubCards(out);
    return opts.max ? out.slice(0, opts.max) : out;
  } catch {
    // A scrubbing failure must not leak the original. Refusing to emit the
    // string at all is the only safe direction to fail in.
    return "<unscrubbable>";
  }
}

/**
 * Scrub every string in a plain object, one level deep plus nested plain
 * objects. Used for the reporter's `extra` and the store's `context`, where the
 * values are attacker-influenced (a request body echoed into an error) but the
 * KEYS are ours.
 */
function scrubObject(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 3) return obj;
  if (Array.isArray(obj)) return obj.map((v) => (typeof v === "string" ? scrub(v) : scrubObject(v, depth + 1)));

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = scrub(v);
    else if (v && typeof v === "object") out[k] = scrubObject(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

module.exports = { scrub, scrubObject, luhnValid };
