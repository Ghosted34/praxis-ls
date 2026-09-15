/**
 * The asset register — guide §4.2.
 *
 * ── THE REPOSITORY CONTAINS ZERO IMAGE FILES, AND THAT IS DELIBERATE ──────
 *
 * §4.1: `src/services/storage.service.js` (S3 or local, `publicUrl()`,
 * `assertSafeKey()`) is the single path for tenant media, served from `/media`.
 * Committing a third-party trademark such as CMA CGM's or GIZ's into git would
 * be worse on both licensing and repository weight than the mechanism that
 * already exists. Assets arrive by UPLOAD, not by commit (O-7).
 *
 * So this file is not an import map and nothing here is bundled. It is the
 * declaration of what each SLOT accepts — its aspect, its minimum width, its
 * byte cap and, most importantly, what provenance may occupy it. `check:assets`
 * reads it, and the settings upload control (§6.3) is meant to read it too so a
 * tenant is told the constraint BEFORE the file dialog opens rather than after
 * a rejected upload.
 *
 * ── THE RULE THAT MATTERS IS §1.3, AND IT IS ABOUT PLACEMENT ──────────────
 *
 * Generated imagery is permitted in two forms: abstract/diagrammatic, and
 * photoreal used as atmosphere. The line is not the image, it is where it sits:
 *
 *   "A photoreal generated asset may never be captioned, captioned-adjacent, or
 *    positioned such that a reasonable visitor concludes it is a photograph of
 *    the tenant's own operations."
 *
 * Concretely forbidden: inside a case note, a proof band, an entity profile, a
 * leadership block, or under a place name. Permitted: full-bleed atmosphere
 * bands, section grounds, abstract set pieces.
 *
 * That is a rule about a person's inference, which is exactly the kind of rule
 * that erodes without a gate — six months from now somebody needs a portrait
 * for a leadership card, the only image to hand is generated, and the reasoning
 * that made it forbidden is in a document nobody has open.
 */

export type AssetProvenance = "owned" | "licensed" | "generated";

export type AssetSlot =
  | "hero-atmosphere"
  | "band-atmosphere"
  | "service-cover"
  | "leadership-portrait"
  | "entity-cover"
  | "partner-mark"
  | "credential-mark";

export type AssetSpec = {
  /** Storage key, e.g. "site/hero/atmosphere-01". Never a path this app builds
   *  a URL from directly — `/media` and the vault own that. */
  key: string;
  slot: AssetSlot;
  provenance: AssetProvenance;
  /** Enforced by check:assets, and shown in the upload control before the file
   *  dialog opens. A tenant who learns the cap after a rejection uploads
   *  something wrong twice. */
  maxBytes: number;
  minWidth: number;
  aspect: `${number}:${number}`;
  /** Bilingual, and required unless the asset is purely decorative (N10).
   *  `null` is the explicit declaration of "decorative", not an omission. */
  alt: { fr: string; en: string } | null;
};

/**
 * Slots a `generated` asset may NOT occupy.
 *
 * Each one is a place where a photoreal image sits beside a factual claim — a
 * named person, a named company, a named lane, a case note — so a reasonable
 * visitor would read the picture as evidence for the claim. Atmosphere slots
 * are absent from this list because atmosphere is not evidence and is not
 * presented as any.
 */
export const EVIDENCE_SLOTS: readonly AssetSlot[] = [
  "leadership-portrait",
  "entity-cover",
  "service-cover",
];

/**
 * The register.
 *
 * EMPTY, and that is the honest state today. §6.3 (the upload control and the
 * derivative pipeline) is still unbuilt — it was carried out of PR 2 and is
 * carried out of PR 3, so no tenant can put a byte into any of these slots yet.
 * Declaring specs for assets nobody can upload would make this file a plan
 * rather than a register.
 *
 * What ships now is the SHAPE and the gate, so §6.3 lands against a rule that
 * already exists rather than inventing one on the way past. The four atmosphere
 * images and the CEO portrait triaged in §4.3 are entered here by whoever
 * builds that control.
 */
export const ASSETS: readonly AssetSpec[] = [];
