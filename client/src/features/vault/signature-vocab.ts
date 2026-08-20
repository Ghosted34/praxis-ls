/**
 * Signature vocabulary — the words the three signature surfaces share.
 *
 * Separate from `signature-cards.tsx` so that file exports components only:
 * mixing constants into a component module breaks React Fast Refresh, and both
 * the vault page and the settings page need these strings.
 *
 * Everything here translates a stored enum into something a person can act on.
 * The enums themselves (AES_OTP, NOT_ENABLED_BY_TENANT) must never reach a
 * screen — a document a court reads should not need a glossary, and neither
 * should an administrator.
 *
 * ⚠ Read through `look()`, never with a bare `MAP[key] ?? fallback`.
 * A plain object literal inherits from Object.prototype, so MAP["constructor"]
 * returns a FUNCTION — truthy, so `??` does not catch it, and React throws on a
 * function child. The same hole was a High CodeQL finding on the server side of
 * this feature (services/signatures/canonical.js). The maps below are
 * null-prototype and the helper checks own-properties: either alone would fix
 * it, and neither costs anything.
 */

/** Safe lookup: own properties only, with a fallback for everything else. */
export function look(map: Record<string, string>, key: unknown, fallback = ""): string {
  if (typeof key !== "string") return fallback;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

const dict = (entries: Record<string, string>): Record<string, string> =>
  Object.assign(Object.create(null) as Record<string, string>, entries);

/**
 * Why a signature method is not on offer.
 *
 * Blocked methods are shown DISABLED rather than hidden: a counterparty who was
 * told "you can sign this by hand" needs to see why that option is greyed out,
 * not wonder whether the page is broken — and an administrator needs to know
 * whether the switch is theirs to flip or fixed in the product.
 */
export const BLOCKED_REASON: Record<string, string> = dict({
  NOT_AVAILABLE_FOR_DOC_TYPE: "Not available for this kind of document",
  FEATURE_OFF: "Not switched on for this workspace yet",
  NOT_ENABLED_BY_TENANT: "Turned off at Settings → Signatures",
  CERTIFIED_REQUIRED: "The sender required a certified signature",
  PAPER_NOT_ALLOWED: "The sender did not allow signing on paper",
  NOT_IN_MENU: "Not available for this document",
});

/** Plain language for the evidence a method collects. Never the enum token. */
export const ASSURANCE_WORDS: Record<string, string> = dict({
  SES: "Signed from your account",
  AES_OTP: "Confirmed by a code sent to your email",
  QES: "Identity checked by an independent provider",
  WET: "Signed by hand, then matched back to this record",
});

/** The live state of a stored signature, as a person would say it. */
export const STATUS_WORDS: Record<string, string> = dict({
  VALID: "Valid",
  AMENDED: "Document changed",
  REVOKED: "Revoked",
  UNKNOWN: "Cannot check",
});

type Tone = "ok" | "warn" | "bad" | "mute";

const TONES: Record<string, Tone> = Object.assign(Object.create(null) as Record<string, Tone>, {
  VALID: "ok",
  AMENDED: "bad",
  REVOKED: "bad",
  UNKNOWN: "mute",
});

/** Tone for a signature status. Unknown input is neutral, never a crash. */
export const statusTone = (status: unknown): Tone =>
  (typeof status === "string" && Object.prototype.hasOwnProperty.call(TONES, status)
    ? TONES[status]
    : "mute");
