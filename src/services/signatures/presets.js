/**
 * The signature card catalogue and the eligibility funnel
 * (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.3, §3.4).
 *
 * ── The funnel ─────────────────────────────────────────────────────────────
 *
 *   1. DOC-TYPE CEILING    document_vault.types.js — { signable, allowsWet,
 *                          allowsQes }. Code, not tenant-editable. A payslip is
 *                          never wet-signed; a delivery note never needs QES.
 *          ↓
 *   2. TENANT MENU         setting signature_policy.<DOC_TYPE>
 *                          { allowed: [...], default: "STAMP" }
 *          ↓
 *   3. SENDER, AT DISPATCH two booleans, not a menu:
 *                          requireCertified → collapse to CERTIFIED alone
 *                          allowPaper       → keep or drop PRINT_SIGN
 *          ↓
 *   4. SIGNER CHOICE       the cards the signing page renders.
 *
 * ── Why the sender gets booleans and not a preset list ─────────────────────
 * Every digital card is AES_OTP: STAMP and DRAWN differ in appearance, never in
 * legal weight. A sender picking between them is choosing a LOOK on the
 * signer's behalf — which is precisely the choice the signer was meant to make.
 * The only sender decisions that change the EVIDENCE are whether third-party
 * certification is required and whether paper is acceptable. So the control is
 * two checkboxes, and the multi-select with its subset validation is gone.
 *
 * ⚠ resolveMenu MUST run server-side on every render of the signing page. A
 *   menu resolved once at dispatch and trusted thereafter would keep offering a
 *   card after the tenant turned it off.
 */
"use strict";

const { AppError } = require("../../utils/errors");
const { getSetting } = require("../../shared/config/settings");

/**
 * Feature flags that gate individual cards, beyond the tenant menu.
 * Null-prototype: these are indexed by preset_code from the database, and an
 * inherited Object.prototype member would return a FUNCTION rather than the
 * undefined the code expects. Same class as the canonical.js BUILDERS finding.
 */
const CARD_FLAG = Object.assign(Object.create(null), {
  CERTIFIED: "signatures.qes",
  PRINT_SIGN: "signatures.wet",
});

/** Cards a tenant may never enable for a doc type whose ceiling forbids them. */
const CEILING_CARD = Object.assign(Object.create(null), {
  CERTIFIED: "allowsQes",
  PRINT_SIGN: "allowsWet",
});

async function catalogue(client, { activeOnly = true } = {}) {
  const { rows } = await client.query(
    "SELECT preset_code, label_en, label_fr, blurb_en, blurb_fr, assurance_level, visual_mark, "
      + "assurance_rank, tier_label, is_active, sort_order FROM signature_preset "
      + (activeOnly ? "WHERE is_active " : "")
      + "ORDER BY sort_order, preset_code",
  );
  return rows;
}

async function getPreset(client, code) {
  const { rows } = await client.query("SELECT * FROM signature_preset WHERE preset_code = $1", [code]);
  return rows[0] || null;
}

/**
 * The controlled reason vocabulary, filtered by what it is for.
 *
 * `kind` splits one catalogue into two lists (10784): 'SIGN' is the intent
 * printed on the seal — *Approved for dispatch*, *Goods received* — and
 * 'DECLINE' is why a counterparty refused. One table because it is one
 * settings screen and one place a tenant renames a phrase; two kinds because
 * offering "Goods received" as a decline reason would be nonsense.
 *
 * Defaults to SIGN so every existing caller keeps its meaning: the column was
 * added with `DEFAULT 'SIGN'` and 10772's five rows carry it.
 */
async function reasons(client, { kind = "SIGN" } = {}) {
  const { rows } = await client.query(
    "SELECT reason_code, label_en, label_fr, kind FROM signature_reason "
      + "WHERE is_active AND kind = $1 ORDER BY sort_order, reason_code",
    [kind === "DECLINE" ? "DECLINE" : "SIGN"],
  );
  return rows;
}

/** Which of `keys` are 'on' for this tenant. One query, not one per flag. */
async function flagsOn(client, keys) {
  if (!keys.length) return new Set();
  const { rows } = await client.query(
    "SELECT feature_key FROM feature_state WHERE feature_key = ANY($1) AND state = 'on'",
    [keys],
  );
  return new Set(rows.map((r) => r.feature_key));
}

/**
 * Resolve the cards a signer may choose from.
 *
 * Returns { cards, default, ceiling, blocked } — `blocked` lists every card that
 * was removed and WHY. The signing page renders blocked cards disabled with the
 * reason rather than hiding them: a counterparty told "you can sign by hand"
 * should see why that option is greyed out, not wonder whether the page broke.
 */
async function resolveMenu(client, { docType, requireCertified = false, allowPaper = true, language = "fr" } = {}) {
  // Required lazily: document_vault.types requires utils/errors, and a top-level
  // cycle through this module would leave AppError undefined at load time.
  const { signaturePolicyFor } = require("../../modules/vault/document_vault/document_vault.types");
  const ceiling = signaturePolicyFor(docType);
  if (!ceiling.signable) {
    throw new AppError("DOC_TYPE_NOT_SIGNABLE", `'${docType}' is not a signable document type.`, 422, { doc_type: docType });
  }

  const all = await catalogue(client);
  const policy = (await getSetting(client, "signature_policy", docType, null)) || {};
  const allowed = Array.isArray(policy.allowed) ? policy.allowed : [];
  const on = await flagsOn(client, Object.values(CARD_FLAG));

  const blocked = [];
  const cards = [];

  for (const p of all) {
    const ceilingKey = CEILING_CARD[p.preset_code];
    if (ceilingKey && !ceiling[ceilingKey]) {
      blocked.push({ preset_code: p.preset_code, reason: "NOT_AVAILABLE_FOR_DOC_TYPE" });
      continue;
    }
    const flag = CARD_FLAG[p.preset_code];
    if (flag && !on.has(flag)) {
      blocked.push({ preset_code: p.preset_code, reason: "FEATURE_OFF", feature: flag });
      continue;
    }
    if (!allowed.includes(p.preset_code)) {
      blocked.push({ preset_code: p.preset_code, reason: "NOT_ENABLED_BY_TENANT" });
      continue;
    }
    if (requireCertified && p.preset_code !== "CERTIFIED") {
      blocked.push({ preset_code: p.preset_code, reason: "CERTIFIED_REQUIRED" });
      continue;
    }
    if (!allowPaper && p.preset_code === "PRINT_SIGN") {
      blocked.push({ preset_code: p.preset_code, reason: "PAPER_NOT_ALLOWED" });
      continue;
    }
    cards.push({
      preset_code: p.preset_code,
      label: language === "en" ? p.label_en : p.label_fr,
      blurb: language === "en" ? p.blurb_en : p.blurb_fr,
      tier: p.tier_label,
      assurance_level: p.assurance_level,
      visual_mark: p.visual_mark,
    });
  }

  // requireCertified with no certified card left is a configuration error the
  // sender must see AT DISPATCH — not a signing link the counterparty opens to
  // find nothing they can do.
  if (requireCertified && !cards.length) {
    throw new AppError(
      "CERTIFIED_NOT_AVAILABLE",
      `Certified signature was required for '${docType}' but is not available: ${blocked.filter((b) => b.preset_code === "CERTIFIED").map((b) => b.reason).join(", ") || "not enabled"}.`,
      422,
      { doc_type: docType, blocked },
    );
  }
  if (!cards.length) {
    throw new AppError(
      "EMPTY_SIGNATURE_MENU",
      `No signature method is available for '${docType}'. Enable at least one at Settings → Signatures.`,
      422,
      { doc_type: docType, blocked, settings_route: "/settings/signatures" },
    );
  }

  const preferred = typeof policy.default === "string" ? policy.default : null;
  return {
    cards,
    default: cards.some((c) => c.preset_code === preferred) ? preferred : cards[0].preset_code,
    ceiling,
    blocked,
  };
}

/**
 * Gate a chosen card against the resolved menu. Separate from resolveMenu so a
 * caller cannot accidentally validate against a menu it built itself with
 * different arguments.
 */
function assertAllowed(menu, presetCode) {
  if (!menu.cards.some((c) => c.preset_code === presetCode)) {
    const why = (menu.blocked.find((b) => b.preset_code === presetCode) || {}).reason || "NOT_IN_MENU";
    throw new AppError(
      "PRESET_NOT_ALLOWED",
      `Signature method '${presetCode}' is not available for this document (${why}).`,
      422,
      { preset_code: presetCode, reason: why, available: menu.cards.map((c) => c.preset_code) },
    );
  }
  return menu.cards.find((c) => c.preset_code === presetCode);
}

module.exports = { catalogue, getPreset, reasons, resolveMenu, assertAllowed, CARD_FLAG, CEILING_CARD };
