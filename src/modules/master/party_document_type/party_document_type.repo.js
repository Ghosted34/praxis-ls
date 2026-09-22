/** KYC / compliance document-type registry (MOD-03). Shared registry kit. */
"use strict";
const { build } = require("../_shared/registry");
// The `writable` allow-list closes mass-assignment (a request cannot set
// is_system) and is what the write-route CI gate keys on for this module.
module.exports = build({
  table: "party_document_type",
  pk: "document_type_id",
  moduleKey: "MOD-03",
  label: "party_document_type",
  writable: [
    "code", "name", "applies_to", "requires_expiry", "requires_issuing_authority", "default_severity", "is_active",
    // Applicability + required-ness (PR3 §3.1/§11). NULL/empty scope = applies to
    // all; `is_required=false` = tracked-if-present, never raises a missing flag.
    "is_required", "applies_to_categories", "applies_to_countries", "kyc_tier",
    // The ACTIVATION set (14030): flagged types are the 360's "Required to
    // activate" checklist AND what `canVerify` demands before verification. A
    // separate question from `is_required`, which is advisory-only.
    // (`exempt_outside_country` is deliberately NOT writable: it is jurisdiction
    // data this product seeds — 'CM' on the ACF — not a per-tenant preference.)
    "required_for_activation",
  ],
});
