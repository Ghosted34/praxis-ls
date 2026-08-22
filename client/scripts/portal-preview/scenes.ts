/**
 * The states the portal has to get right, as canned API responses.
 *
 * Chosen to be the ones that are hard to reason about in HTML and obvious in a
 * picture: two verdicts disagreeing, a revoked signature that must still show
 * its signer, an amended document with a real before/after, and a doc type with
 * no published summary (where the page must show LESS, not a fallback dump).
 */
export type Scene = { id: string; code: string; caption: string; status: number; body: unknown };

/*
 * Each scene has its own twelve-character code, and the stubbed API client keys
 * on it. That is how the harness renders six independent pages on one canvas:
 * the code is the only thing VerifyPage puts on the wire, so it is the only
 * channel a stub can key on without reaching into the component.
 */

const signed = (over: Record<string, unknown> = {}) => ({
  name: "Jean Mbarga",
  role: "Commercial Director",
  party: "INTERNAL",
  identity_source: "SESSION",
  identity_words: "Name confirmed by the account used to sign",
  method: "Verified by email code",
  reason: "Approved for dispatch",
  signed_at: "2026-03-03T13:35:00.000Z",
  ip: "197.210.***.***",
  device: "Mobile browser",
  ...over,
});

const card = {
  preset_code: "STAMP",
  label: "Digital stamp",
  blurb: "Your name and role, applied as a printed seal.",
  tier: "1",
  assurance_level: "AES_OTP",
  visual_mark: "STAMP",
};

const issuer = {
  legal_name: "SMART LOGISTICS SARL",
  trading_name: "Smart Logistics",
  rccm: "RC/DLA/2019/B/1234",
  niu: "M011912345678K",
  address: "Bonanjo, Douala, Cameroun",
};

const invoiceFields = [
  { key: "number", label: "Reference", value: "FCT-2026-0001" },
  { key: "party", label: "Counterparty", value: "CIMENCAM SA" },
  { key: "date", label: "Date", value: "2026-03-03" },
  { key: "total_ttc", label: "Total incl. tax", value: "1 607 900 XAF" },
  { key: "line_count", label: "Line items", value: "3" },
];

const PASS = (key: string, label: string, message: string) => ({ key, state: "PASS", label, message });

export const SCENES: Scene[] = [
  {
    id: "valid",
    code: "A4B7K92MXQ1P",
    caption: "Valid — both verdicts pass",
    status: 200,
    body: {
      status: "VALID",
      language: "en",
      verdicts: [
        PASS("content", "Content", "This document still says what was signed."),
        PASS("artifact", "Artifact", "This file is the exact one we issued."),
      ],
      signature: {
        verify_code: "A4B7-K92M-XQ1P",
        doc_type: "FINAL_INVOICE",
        content_hash_short: "e3b0c44298fc1c14",
        revoked_at: null,
        revoke_reason: null,
        card,
        signed: signed(),
      },
      as_signed: { doc_type: "FINAL_INVOICE", title: "Invoice", fields: invoiceFields, detail: null },
      changes: [],
      issuer,
      scan: { is_new_ip: true, via: "QR" },
    },
  },
  {
    id: "amended",
    code: "B5C8M03NYR2Q",
    caption: "Amended — content fails, artifact passes, with the before/after",
    status: 200,
    body: {
      status: "AMENDED",
      language: "en",
      verdicts: [
        {
          key: "content",
          state: "FAIL",
          label: "Content",
          message: "This document was modified after signing. The signature below no longer covers its current contents.",
        },
        PASS("artifact", "Artifact", "This file is the exact one we issued."),
      ],
      signature: {
        verify_code: "B5C8-M03N-YR2Q",
        doc_type: "FINAL_INVOICE",
        content_hash_short: "e3b0c44298fc1c14",
        revoked_at: null,
        revoke_reason: null,
        card,
        signed: signed(),
      },
      as_signed: { doc_type: "FINAL_INVOICE", title: "Invoice", fields: invoiceFields, detail: null },
      changes: [
        { field: "number", label: "Reference", before: "FCT-2026-0001", after: "FCT-2026-0002" },
        { field: "totals", label: "Totals", before: null, after: null },
        { field: "lines", label: "Line items", before: null, after: null },
      ],
      issuer,
      scan: { is_new_ip: false, via: "QR" },
    },
  },
  {
    id: "revoked",
    code: "C6D9N14PZS3R",
    caption: "Revoked — 200, and the original signer is still visible",
    status: 200,
    body: {
      status: "REVOKED",
      language: "en",
      verdicts: [
        PASS("content", "Content", "This document still says what was signed."),
        PASS("artifact", "Artifact", "This file is the exact one we issued."),
      ],
      signature: {
        verify_code: "C6D9-N14P-ZS3R",
        doc_type: "DELIVERY_NOTE",
        content_hash_short: "e3b0c44298fc1c14",
        revoked_at: "2026-04-11T09:00:00.000Z",
        revoke_reason: "Superseded by BL-2026-0044 after the reserves were re-checked.",
        card: { ...card, preset_code: "DRAWN", label: "Draw your signature", tier: "2", visual_mark: "DRAWN" },
        signed: signed({ name: "Aïssatou Njoya", role: "Procurement Manager", party: "EXTERNAL", identity_source: "DECLARED", identity_words: "Name declared by the signer", reason: "Goods received" }),
      },
      as_signed: {
        doc_type: "DELIVERY_NOTE",
        title: "Delivery note",
        fields: [
          { key: "number", label: "Reference", value: "BL-2026-0042" },
          { key: "party", label: "Counterparty", value: "CIMENCAM SA" },
          { key: "date", label: "Delivery date", value: "2026-03-03" },
          { key: "line_count", label: "Items", value: "7" },
        ],
        detail: { label: "Reserves noted on delivery", value: "2 pallets damaged on arrival — sealed and photographed at the gate." },
      },
      changes: [],
      issuer,
      scan: { is_new_ip: false, via: "CODE" },
    },
  },
  {
    id: "nosummary",
    code: "D7E0P25QAT4S",
    caption: "A doc type with no published summary — LESS, never a fallback dump",
    status: 200,
    body: {
      status: "VALID",
      language: "en",
      verdicts: [
        { key: "content", state: "UNKNOWN", label: "Content", message: "The original record could not be read, so its contents cannot be compared." },
        PASS("artifact", "Artifact", "This file is the exact one we issued."),
      ],
      signature: {
        verify_code: "D7E0-P25Q-AT4S",
        doc_type: "PAYSLIP",
        content_hash_short: "e3b0c44298fc1c14",
        revoked_at: null,
        revoke_reason: null,
        card: null,
        signed: signed(),
      },
      as_signed: null,
      changes: [],
      issuer,
      scan: { is_new_ip: false, via: "QR" },
    },
  },
  {
    id: "notfound",
    code: "E8F1Q36RBV5T",
    caption: "Unknown code — one answer for malformed and never-existed",
    status: 404,
    body: { error: { code: "NOT_FOUND", message: "No verification matches that code." } },
  },
  {
    id: "fr",
    code: "F9G2R47SCW6V",
    caption: "Français — le défaut du produit (§3.14)",
    status: 200,
    body: {
      status: "VALID",
      language: "fr",
      verdicts: [
        PASS("content", "Contenu", "Ce document dit toujours ce qui a été signé."),
        PASS("artifact", "Fichier", "Ce fichier est exactement celui que nous avons émis."),
      ],
      signature: {
        verify_code: "F9G2-R47S-CW6V",
        doc_type: "FINAL_INVOICE",
        content_hash_short: "e3b0c44298fc1c14",
        revoked_at: null,
        revoke_reason: null,
        card: { ...card, label: "Cachet numérique", blurb: "Votre nom et votre fonction, apposés comme un cachet." },
        // `device` too: services/signatures/mask.js coarsens the user agent in
        // the reader's language, and this fixture stands in for what it returns.
        signed: signed({ identity_words: "Nom confirmé par le compte utilisé pour signer", method: "Vérifié par code e-mail", reason: "Approuvé pour expédition", device: "Navigateur mobile" }),
      },
      as_signed: {
        doc_type: "FINAL_INVOICE",
        title: "Facture",
        fields: [
          { key: "number", label: "Numéro", value: "FCT-2026-0001" },
          { key: "party", label: "Client", value: "CIMENCAM SA" },
          { key: "date", label: "Date", value: "2026-03-03" },
          { key: "total_ttc", label: "Total TTC", value: "1 607 900 XAF" },
          { key: "line_count", label: "Lignes", value: "3" },
        ],
        detail: null,
      },
      changes: [],
      issuer,
      scan: { is_new_ip: false, via: "QR" },
    },
  },
];
