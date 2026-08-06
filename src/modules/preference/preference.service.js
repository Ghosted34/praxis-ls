/**
 * Per-user preferences — the personal layer over tenant-wide `setting`.
 *
 * TWO SECTIONS, both personal, both scoped to the caller:
 *
 *   appearance  the three typography tokens
 *   shell       how this user has arranged the application chrome — whether the
 *               ribbon is pinned open, and what they pinned to the icon rail
 *
 * SCOPE, AND WHY `appearance` IS THIS NARROW. Only the three typography tokens
 * are user-overridable. Colour, logo and favicon are the COMPANY's identity, not
 * the operator's: letting a user restyle the brand would mean two people
 * looking at the same screen on a call and disagreeing about what the product
 * looks like, and it would make every support screenshot unreliable. Type is
 * different — it is an ergonomics setting, like density or zoom, and the person
 * reading nine hours of waybills is the one who should choose it. So the
 * allow-list below is a deliberate boundary, not a first instalment.
 *
 * WHY `shell` IS ON THE SERVER AND DENSITY IS NOT. Density lives in
 * localStorage because it is a property of the SCREEN you are sitting at — a
 * 27" monitor and a warehouse tablet want different answers from the same
 * person. Which shortcuts you pinned is the opposite: it is a property of how
 * you work, and rebuilding it on every device you sign in from is the reason
 * nobody customises anything.
 *
 * ABSENT ≠ NULL. A key the user has not overridden has no row, and the API
 * returns null for it, meaning "inherit the tenant value". PUT-ing null for a
 * key deletes the row — that is the reset. There is no third state.
 *
 * NOT AUDITED, ON PURPOSE. Every other write in this codebase emits an audit
 * event; a personal font choice is not a governance event, and writing one
 * ledger row per user per fiddle with a dropdown would bury the entries that
 * matter. The row's own updated_at is the whole history anyone needs.
 */
"use strict";

const { AppError } = require("../../utils/errors");
const repo = require("./preference.repo");

const SECTION = "appearance";

/** API field (camelCase) → the `user_preference` key it persists under. These
 *  intentionally match branding.service.js's KEYS, so the client can overlay
 *  one object on the other without a translation table. */
const KEYS = {
  fontDisplay: "font_display",
  fontBody: "font_body",
  fontMono: "font_mono",
};

/**
 * A stored value is a raw CSS font-family string written into a style
 * attribute, so it is bounded and screened here rather than trusted. The
 * characters barred below (`;{}<>` and url/@import/expression) are the ones
 * that would let a stored value escape the declaration it lands in — this is
 * the value's only server-side gate, since the client writes it straight into a
 * CSS custom property.
 */
const MAX_FONT_LEN = 200;
const FORBIDDEN = /[;{}<>]|url\s*\(|@import|expression\s*\(|javascript:/i;

function validateFont(field, value) {
  if (typeof value !== "string") {
    throw new AppError("BAD_FONT", `${field} must be a string or null`, 422);
  }
  const v = value.trim();
  if (v.length > MAX_FONT_LEN) {
    throw new AppError("BAD_FONT", `${field} must be ${MAX_FONT_LEN} characters or fewer`, 422);
  }
  if (FORBIDDEN.test(v)) {
    throw new AppError("BAD_FONT", `${field} contains characters not allowed in a font-family`, 422);
  }
  return v;
}

/** This user's appearance overrides. Every key present; null = inherit. */
async function getAppearance(client, userId) {
  const rows = await repo.getSection(client, userId, SECTION);
  const map = {};
  for (const r of rows) map[r.key] = r.value;

  const out = {};
  for (const [field, key] of Object.entries(KEYS)) out[field] = map[key] ?? null;
  return out;
}

/**
 * Upsert the provided fields; a field set to null/"" deletes its row and falls
 * back to the tenant value. Fields not present in the body are left untouched,
 * so a caller can PATCH one token without resending the others.
 */
async function setAppearance(client, { userId, ...fields }) {
  const touched = Object.keys(KEYS).filter((f) => fields[f] !== undefined);
  if (touched.length === 0) return getAppearance(client, userId);

  for (const field of touched) {
    const raw = fields[field];
    const key = KEYS[field];
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
      await repo.remove(client, userId, SECTION, key);
      continue;
    }
    await repo.upsert(client, userId, SECTION, key, validateFont(field, raw));
  }
  return getAppearance(client, userId);
}

/** Drop every appearance override — back to exactly what the tenant set. */
async function resetAppearance(client, userId) {
  await repo.removeSection(client, userId, SECTION);
  return getAppearance(client, userId);
}

/* ── shell ─────────────────────────────────────────────────────────────────── */

const SHELL_SECTION = "shell";

/** API field → stored key, same convention as KEYS above. */
const SHELL_KEYS = {
  ribbonPinned: "ribbon_pinned",
  railPins: "rail_pins",
  towerPins: "tower_pins",
  railHintSeen: "rail_hint_seen",
};

/**
 * This user's shell arrangement. Every key present; null = "no choice made".
 *
 * NULL IS NOT A DEFAULT, AND THE DIFFERENCE IS LOAD-BEARING. `railPins: null`
 * means the user has never touched the rail, so the client fills it with its
 * starter set — a rail that arrives empty on first login teaches nobody that it
 * can be customised. `railPins: []` means they deliberately cleared it. If this
 * endpoint substituted a default for null, the two would be indistinguishable
 * and clearing the rail would be impossible.
 */
async function getShell(client, userId) {
  const rows = await repo.getSection(client, userId, SHELL_SECTION);
  const map = {};
  for (const r of rows) map[r.key] = r.value;

  const out = {};
  for (const [field, key] of Object.entries(SHELL_KEYS)) out[field] = map[key] ?? null;
  return out;
}

/**
 * Upsert the provided fields. Absent = untouched, null = deleted (back to "no
 * choice made"). Same partial-PUT contract as setAppearance, so the client has
 * one rule for both sections rather than one per endpoint.
 */
async function setShell(client, { userId, ...fields }) {
  const touched = Object.keys(SHELL_KEYS).filter((f) => fields[f] !== undefined);
  if (touched.length === 0) return getShell(client, userId);

  for (const field of touched) {
    const raw = fields[field];
    if (raw === null) {
      await repo.remove(client, userId, SHELL_SECTION, SHELL_KEYS[field]);
      continue;
    }
    await repo.upsert(client, userId, SHELL_SECTION, SHELL_KEYS[field], raw);
  }
  return getShell(client, userId);
}

module.exports = {
  SECTION,
  KEYS,
  getAppearance,
  setAppearance,
  resetAppearance,
  SHELL_SECTION,
  SHELL_KEYS,
  getShell,
  setShell,
};
