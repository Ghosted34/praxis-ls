/**
 * Transit order (MOD-30) — pure lifecycle and pure arithmetic. No SQL, no HTTP.
 *
 * WHY THIS FILE EXISTS AT ALL. The legacy transit order had no lifecycle: the
 * PHP endpoint INSERTed a row and the operator hit Print. Nothing recorded
 * whether the client ever signed the thing, which matters because the signature
 * is the authorisation — a declaration lodged against an unsigned order is one
 * we cannot defend if the declared value is later disputed. So the states below
 * are not decoration; SIGNED is a gate, and `assertCanLodge` is the reason.
 *
 * Everything here is a pure function so it can be tested without a database,
 * and so the service reads as a sequence of decisions rather than a wall of
 * conditionals. Same split as quotation.rules.js.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

/**
 * DRAFT      being prepared; no number burned yet.
 * ISSUED     numbered, printed, out for the client's signature.
 * SIGNED     returned stamped — the state that authorises a declaration.
 * LODGED     declaration filed, reference recorded.
 * CANCELLED  withdrawn. Terminal from anywhere except LODGED.
 *
 * LODGED IS TERMINAL AND CANCELLED IS NOT REACHABLE FROM IT, on purpose. Once a
 * declaration cites this order, the order is part of a customs record we do not
 * own and cannot retract by editing a row. Withdrawing it is a new customs act
 * with its own paperwork, not a status change here.
 */
const NEXT = {
  DRAFT: ["ISSUED", "CANCELLED"],
  ISSUED: ["SIGNED", "CANCELLED"],
  SIGNED: ["LODGED", "CANCELLED"],
  LODGED: [],
  CANCELLED: [],
};

/** States in which the header and lines may still be edited freely. */
const EDITABLE = new Set(["DRAFT"]);

/**
 * States that have burned a number and been shown to a client. Editing one is
 * not forbidden outright — a departure date genuinely does move — but it is
 * restricted to the fields below, because changing a declared value or a regime
 * on an order the client has already signed rewrites what they signed.
 */
const POST_ISSUE_EDITABLE_FIELDS = new Set([
  "departure_date",
  "instructions",
  "submitted_docs",
]);

const CUSTOMS_REGIMES = ["IM4", "IM7", "IM8", "EX1", "EX2"];
const INSURANCE_TYPES = ["CLIENT", "COMPANY"];
const SURVEYOR_PARTIES = ["CLIENT", "COMPANY"];
const DIRECTIONS = ["IMPORT", "EXPORT"];

/**
 * The document checklist, as codes rather than the legacy's free strings.
 *
 * Legacy stored whatever the checkbox `value` attribute happened to be
 * ("INVOICE", "PACKING", "BL", "EXONERATION", "OTHER") in a JSON blob, and the
 * PRINT template checked for a sixth one the form never offered — `p-doc-co`,
 * Certificat d'Origine (transit-order.php:737) — so the certificate of origin
 * box could never be ticked. It is in the list here.
 *
 * Codes, not labels, because the printed document is bilingual and the stored
 * value must not be. `label_fr`/`label_en` are what the renderer prints.
 */
const SUBMITTED_DOC_TYPES = [
  { code: "INVOICE", label_fr: "Facture", label_en: "Invoice" },
  { code: "PACKING_LIST", label_fr: "Liste de colisage", label_en: "Packing list" },
  { code: "BL_AWB", label_fr: "Original BL/LTA", label_en: "Original BL/AWB" },
  { code: "EXONERATION", label_fr: "Lettre d'exonération", label_en: "Exoneration letter" },
  { code: "CERTIFICATE_OF_ORIGIN", label_fr: "Certificat d'origine", label_en: "Certificate of origin" },
  { code: "PHYTOSANITARY", label_fr: "Certificat phytosanitaire", label_en: "Phytosanitary certificate" },
  { code: "INSURANCE_CERTIFICATE", label_fr: "Attestation d'assurance", label_en: "Insurance certificate" },
  { code: "OTHER", label_fr: "Autres", label_en: "Other" },
];
const SUBMITTED_DOC_CODES = new Set(SUBMITTED_DOC_TYPES.map((d) => d.code));

/**
 * Legacy payloads used the short codes. A tenant migrating mid-flight (or an AI
 * action written against the old vocabulary) should not get a 422 for saying
 * "BL" — it is unambiguous. Unknown codes still fail; this maps the five that
 * existed, and nothing else.
 */
const LEGACY_DOC_ALIASES = {
  PACKING: "PACKING_LIST",
  BL: "BL_AWB",
  AWB: "BL_AWB",
  CO: "CERTIFICATE_OF_ORIGIN",
};

function assertTransition(from, to) {
  const allowed = NEXT[from];
  if (!allowed) throw new AppError("BAD_STATE", `Unknown transit order state "${from}"`, 422);
  if (!allowed.includes(to)) {
    throw new AppError(
      "BAD_STATE",
      allowed.length
        ? `Cannot move transit order ${from} -> ${to}. From ${from} it can only go to: ${allowed.join(", ")}.`
        : `A ${from} transit order is final and cannot be moved to ${to}.`,
      422,
    );
  }
  return true;
}

/**
 * What an ISSUE requires. Checked here rather than by NOT NULL columns because
 * a DRAFT is explicitly allowed to be incomplete — that is the point of having
 * a draft state — so the completeness rule belongs to the transition, not the
 * table.
 *
 * Returns the list of what is missing rather than throwing on the first one, so
 * the operator fixes the form once instead of five times.
 */
function issueBlockers(to) {
  const missing = [];
  if (!to.entity_id) missing.push("issuing entity");
  if (!to.dossier_id) missing.push("operations file");
  if (!to.customs_regime && !to.customs_regime_other) missing.push("customs regime");
  if (!to.service_direction) missing.push("direction (import/export)");
  if (to.declared_value === null || to.declared_value === undefined) missing.push("declared value");
  return missing;
}

function assertCanIssue(to) {
  const missing = issueBlockers(to);
  if (missing.length) {
    throw new AppError(
      "INCOMPLETE",
      `A transit order cannot be issued without: ${missing.join(", ")}.`,
      422,
      { missing },
    );
  }
  return true;
}

/**
 * Lodging a declaration is the act the client's signature authorises, so the
 * signature has to exist. `signature_vault_id` — the scan — rather than merely
 * `status = SIGNED`, because a status is something we set and a scan is
 * evidence someone else produced.
 */
function assertCanLodge(to) {
  if (!to.signature_vault_id) {
    throw new AppError(
      "NO_SIGNED_COPY",
      "Attach the client-signed copy before recording the declaration — the signature is the authorisation to declare.",
      422,
    );
  }
  return true;
}

function assertEditable(to, fields = {}) {
  if (EDITABLE.has(to.status)) return true;
  if (to.status === "CANCELLED" || to.status === "LODGED") {
    throw new AppError("LOCKED", `A ${to.status} transit order cannot be edited.`, 422);
  }
  const blocked = Object.keys(fields).filter((k) => !POST_ISSUE_EDITABLE_FIELDS.has(k));
  if (blocked.length) {
    throw new AppError(
      "LOCKED",
      `A ${to.status} transit order has been sent to the client; only ${[...POST_ISSUE_EDITABLE_FIELDS].join(", ")} may still change (tried: ${blocked.join(", ")}).`,
      422,
      { blocked },
    );
  }
  return true;
}

/** Normalise + validate the submitted-document checklist. Throws on unknowns. */
function normaliseDocs(docs) {
  if (docs === null || docs === undefined) return [];
  if (!Array.isArray(docs)) throw new AppError("VALIDATION_ERROR", "submitted_docs must be a list", 422);
  const out = [];
  for (const raw of docs) {
    // Accept both "INVOICE" and { code: "INVOICE", note: "…" }.
    const code0 = String((raw && typeof raw === "object" ? raw.code : raw) || "").toUpperCase().trim();
    if (!code0) continue;
    const code = LEGACY_DOC_ALIASES[code0] || code0;
    if (!SUBMITTED_DOC_CODES.has(code)) {
      throw new AppError("VALIDATION_ERROR", `"${code0}" is not a known document type`, 422, {
        submitted_docs: [`unknown document type "${code0}"`],
      });
    }
    const note = raw && typeof raw === "object" && raw.note ? String(raw.note).slice(0, 200) : null;
    if (!out.some((d) => d.code === code)) out.push(note ? { code, note } : { code });
  }
  return out;
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * Line values roll up to the declared value, and the XAF equivalent is derived
 * once here rather than in three renderers.
 *
 * `declared_value` stays authoritative when it is set — the figure on a customs
 * declaration is the one the operator commits to, not one we compute behind
 * them — but `lines_total` is returned alongside so the UI and the API can say
 * "your lines sum to 4.2M and you declared 4.0M" instead of silently
 * disagreeing. That reconciliation is the whole reason lines got a value column.
 */
function computeValues(head = {}, lines = []) {
  const linesTotal = round2(
    (lines || []).reduce((s, l) => s + Number(l.value_amount || 0), 0),
  );
  const declared = head.declared_value === null || head.declared_value === undefined
    ? null
    : round2(head.declared_value);
  const fx = Number(head.declared_fx_to_xaf || 1) || 1;
  return {
    lines_total: linesTotal,
    declared_value: declared,
    declared_value_xaf: declared === null ? null : round2(declared * fx),
    // Tolerance of one minor unit absorbs rounding on a per-line FX split; a
    // real mismatch is a data-entry error worth surfacing.
    reconciles: declared === null || linesTotal === 0 || Math.abs(linesTotal - declared) <= 0.01,
  };
}

module.exports = {
  NEXT,
  EDITABLE,
  POST_ISSUE_EDITABLE_FIELDS,
  CUSTOMS_REGIMES,
  INSURANCE_TYPES,
  SURVEYOR_PARTIES,
  DIRECTIONS,
  SUBMITTED_DOC_TYPES,
  SUBMITTED_DOC_CODES,
  LEGACY_DOC_ALIASES,
  assertTransition,
  issueBlockers,
  assertCanIssue,
  assertCanLodge,
  assertEditable,
  normaliseDocs,
  computeValues,
};
