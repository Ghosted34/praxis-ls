/**
 * Accent-safe slug helper — the single source of truth for how a string
 * becomes a URL slug. Pure CommonJS, zero imports, so:
 *
 *   - any module may require it without dragging the dependency tree
 *     (the docker mount probe reads the module graph at boot; a require
 *      chain that touches config or a tenant connection fails family 8);
 *   - the test suite can pin behaviour without setting up fixtures.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 * `success_story.service.js` previously slugified with
 *   value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")
 * After `toLowerCase`, a precomposed `é` is still `é` — it is not in
 * [a-z0-9], so every accented character becomes a dash:
 *   "Fret Aérien Import" → "fret-a-rien-import"
 * In a French-first product that mangles the majority of real service names,
 * and the mangled slug is then stored and becomes the public URL forever.
 * See SERVICE_TYPE_WEB_PROFILE_ENGINEERING_GUIDE §4.7.
 *
 * ── ALGORITHM (verbatim from the guide) ───────────────────────────────────
 *  1. NFD-normalise: "é" → "e" + combining acute (U+0301).
 *  2. Strip combining marks (`\p{M}`).
 *  3. Lowercase.
 *  4. Fold every `[^a-z0-9]+` run to a single dash.
 *  5. Trim leading/trailing dashes; collapse repeats.
 *  6. Cap at 80 characters, cut at a dash boundary (never mid-word).
 *  7. Never empty: fall back to the dashed `key` lowercased, so a slug
 *     column never accepts "" (a partial-unique-index collision waiting
 *     to happen on the second non-latin input).
 *
 * ── INVARIANTS ─────────────────────────────────────────────────────────────
 *   - Pure. No Date, no Math.random, no I/O.
 *   - The output ALWAYS matches /^[a-z0-9]+(?:-[a-z0-9]+)*$/ when key is
 *     well-formed (slugs and the fallback both go through the same dash-fold),
 *     so a regex-enforced column will accept the result.
 *   - Truncation at 80 cuts at the LAST dash boundary ≤ 80, so a slug never
 *     ends mid-word.
 */
"use strict";

const MAX_LEN = 80;

function dashKey(fallback) {
  // Service-type keys are SCREAMING_SNAKE (e.g. "SEA_FREIGHT_IMPORT"). Same
  // dash-fold the main path uses, so a non-latin input that falls back to
  // the key still produces a valid slug.
  return String(fallback === null || fallback === undefined ? "" : fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LEN)
    .replace(/-+$/, "");
}

function truncateAtBoundary(s) {
  if (s.length <= MAX_LEN) return s;
  // Cut at the LAST dash at or before position 80. A slug that ends mid-word
  // is a worse URL than a slightly shorter one.
  const cut = s.slice(0, MAX_LEN);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 0 ? cut.slice(0, lastDash) : cut;
}

function slug(input, fallback) {
  const raw = String(input === null || input === undefined ? "" : input);
  // 1+2: NFD then strip combining marks. "é" → "e\u0301" → "e".
  const stripped = raw.normalize("NFD").replace(/\p{M}/gu, "");
  // 3+4+5: lowercase, dash-fold, trim.
  const folded = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (folded) return truncateAtBoundary(folded);
  // 7: never empty. The dashed key is the only fallback so the validator's
  // regex still matches.
  return dashKey(fallback);
}

module.exports = { slug, MAX_LEN };
