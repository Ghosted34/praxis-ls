# Praxis LS — Multi-Tier Signature & Verification: Feasibility Read & 20-Question Decision Sheet

**Purpose.** You proposed a four-tier signature model, a secure QR verification portal with live
relational data, and automated reconciliation of physical paperwork — with DocuSign carrying Tier 3
at the client's charge. This document does four things:

1. Reports what **Bureau LPC** (`bureau.lpc.cm`) actually built, which parts are genuinely worth
   porting, and which parts it deliberately **deleted** — and why that matters to your proposal.
2. Reports the honest state of signatures in **Praxis LS** today, including two structural defects
   that have to be fixed before any of this can work.
3. Critiques the four-tier model itself and proposes a stronger shape.
4. Asks **20 decision questions** — each with three concrete options and my recommendation — whose
   answers are the missing inputs for the engineering guide.

**How to use it.** Answer inline (tick an option or write your own). Where you are happy with my
recommendation, just write "Rec". Once returned, I produce `doc/SIGNATURE_ENGINEERING_GUIDE.md`:
a build-ready spec (migrations, module trees, endpoints, component trees, acceptance criteria, test
plan) split across the PRs in §2, executable by any competent engineer or AI agent — the same shape
as `doc/SMART_MAIL_ENGINEERING_GUIDE.md`.

---

## 0. Reality check

### 0.1 What Bureau LPC actually built

I read the whole thing: `includes/classes/DocumentSignature.php` (721 lines), migrations 027 / 048 /
055, `public/verify.php` (455 lines), `docs/SIGNATURES.md` (395 lines), and the render partial.

It is a genuinely good system, and it is better than most commercial e-signature bolt-ons for one
reason: **it hashes meaning, not bytes.** Everything else follows from that decision.

| What LPC does | Why it matters | Port it? |
| --- | --- | --- |
| **Canonical payload per doc type.** `canonicalPayload_quote()`, `_cre()`, `_bl()`… each returns a versioned (`v:1`) struct of the contract-relevant fields only — reference, client identity, line items, the fiscal ladder. `content_hash = sha256(json)`. | The hash is derived from **business data**, so it can be recomputed at any later moment from the live record and compared. This is the whole ballgame. | **Yes — this is the crown jewel.** |
| **Staleness auto-invalidation.** `getActive()` recomputes the hash from the document as it stands *now*; a mismatch means the row stops being returned and the PDF falls back to unsigned. The row is never deleted. | Edit a price after signing and the system refuses to keep stamping a figure nobody attested to — without losing the audit trail of who signed what. | **Yes.** |
| **`verify_token` ≠ document access token.** 40 random hex, permanent, scoped to exactly one signature event, the only key `verify.php` accepts. Migration 048 explains the reasoning explicitly. | The bearer token for reading a document rotates and expires; a verification link printed on paper must outlive it by a decade. | **Yes.** |
| **Three explicit states, never conflated.** unknown → 404 (never distinguishes malformed from never-existed); revoked → **200 shown as revoked**, not 404; valid → 200. | Someone holding an old printed PDF cannot claim "the link is just broken". | **Yes.** |
| **Two parties that never mix.** `internal` = staff, identity resolved server-side from `UserProfile`, **never from POST**, and no image is ever stored. `external` = counterparty via token link, stores the drawn PNG. | Nobody can sign as "Le Directeur Général" by typing it into a form. | **Yes.** |
| **One choke point, enforced.** One class, one controller, one render partial, one verify page — and `docs/SIGNATURES.md` states as a hard rule that a PR shipping its own signature scheme is a bug. | This is why it stayed coherent across seven document types. | **Yes — as a documented rule.** |
| **Golden test pins payload → sha256.** `scripts/tests/signature_canonical_payload.test.php` fixes one input per type to a known digest. | The one thing that stops a refactor silently invalidating every signature ever issued. | **Yes — non-negotiable.** |
| **Side effects in the same transaction.** Signing a BL flips delivery status, updates the empties ledger and finalises the sales order atomically. | A signature is never recorded without its state change, or vice versa. | **Yes.** |
| **Height budget.** The devis is guaranteed one A4 page; the signature block is allotted exactly 34 mm, with a test asserting the page count. | Layout discipline treated as a contract, not a preference. | **Yes, adapted.** |

### 0.2 What Bureau LPC deliberately **removed** — read this before restoring OTP

Migration `027_signer_otp.sql` built a 6-digit phone OTP gate on the public BL and CRE signing pages.
Migration `055_signatures_universal.sql` **tore it out**, and its own commentary says why:

> *"In practice the OTP added friction without adding trust (SMS delivery is unreliable in-field;
> a driver with the customer's phone can enter the code anyway)."*

`SignerOtp.php` and `signer_otp_controller.php` still sit in the tree marked **dormant, do not
extend**. You are proposing to bring OTP back. That is defensible — but only if it does not repeat
the failure. The failure had two causes, and only one of them was SMS:

1. **Wrong channel.** SMS delivery in-field was unreliable.
2. **Wrong binding — the fatal one.** The code went to a phone number *supplied at signing time*,
   held by whoever was standing there. An OTP sent to a channel the signer nominates proves only
   that the signer can read their own inbox. It is theatre.

Your proposal of a **15-minute email OTP** fixes cause 1. It fixes cause 2 **only if the address
comes from the tenant's records** (`client_master`, `portal_user`, the contact on the dossier) and
not from the signing form. That is Q7, and it is the single most consequential answer in this sheet.

### 0.3 Where Bureau LPC fell short

| Gap | Evidence |
| --- | --- |
| **The QR never worked in production.** `endroid/qr-code` is in `composer.json` but was never installed on the host; `deploy.sh` reports "composer not found … skipping". `lpc_qr_or_fallback()` prints a framed text placeholder instead of a scannable code. | `docs/SIGNATURES.md` § "The QR code needs a composer package" |
| **No cryptographic sealing of the PDF.** dompdf emits unsigned bytes. The *data* is hashed; the *artifact* is not. Nothing stops someone re-typesetting a convincing lookalike. | `includes/classes/PdfRenderer.php` |
| **No third-party trust tier.** Everything is self-attested by LPC. Fine for internal ops, thin for a contract in dispute. | — |
| **No scan telemetry.** Nobody knows a document was verified, or by whom. | `public/verify.php` |
| **Public disclosure is fixed and generous.** The portal shows reference, client name and amount TTC to anyone who scans. Acceptable for one company; wrong as a multi-tenant default. | `verify_summary()` |
| **Dead code retained indefinitely.** Two dormant classes, three tombstoned JS modules, legacy signature columns on two tables. | `docs/SIGNATURES.md` § "Related but historic" |

### 0.4 Praxis LS today — the honest state

| Layer | Reality |
| --- | --- |
| Backend | Node 20, Express, CommonJS, plain `pg`. Modules auto-mounted by `src/shared/http/module-loader.js`. |
| DB | PostgreSQL 16, **one database per tenant** + a platform DB. Tenant migrations at `10736`. |
| Signatures | `src/modules/vault/document_signature/` — **101 lines across 7 files**. MOD-64, feature flag `signatures`, default **on**. |
| Verification | `src/modules/vault/document_verification/` — **117 lines**. MOD-66, seeded as *"Document Verification (QR)"*. |
| Schema | `document_signature` (`migrations/tenant/0410_notifications_ux.sql:68`) — 10 columns. |
| PDF | Puppeteer → `src/services/pdf.service.js` → `storage.service` → `document_vault`. Template kit at `src/services/documents/templates/kit.js`. |
| Frontend | `client/src/features/vault/signatures.tsx` (246 lines) — a form: type an entity ref, type a signer name, pick DIGITAL or PHYSICAL. `verification.tsx` (144 lines) — paste a hash. |

**What `document_signature` does not have:** no verify token, no revocation, no party distinction,
no tier or assurance level, no OTP, no expiry, no canonical payload, no payload version, no
signature image, no IP/user-agent, no link to an approval, no scan log.

### 0.5 The two structural defects

These are not "gaps to fill later". They are the reason the QR does not exist, and they must be
fixed in PR-1 or nothing downstream works.

**Defect 1 — the hash cannot be printed on the document it describes.**

`pdf.service.js:58` computes `content_hash = sha256(rendered PDF bytes)`. The QR carrying that hash
must be *inside* those bytes. That is circular, and it is unsolvable in that direction.

So the code does not try. `template.service.js:860` passes the template builder a verify string of
`praxis://verify/${entityRef}` — **with no hash at all**. Meanwhile the verification endpoint
requires one (`document_verification.validator.js`: `hash: z.string().min(4)`). The result:

> **The verification string printed on every PDF Praxis has ever generated cannot be used to verify
> anything.** It is missing the only parameter the endpoint needs. The `verifyToken(entityRef, hash)`
> helper in `pdf.service.js:63` that *does* produce a complete token is only ever returned from
> `renderAndStore()` — computed after rendering, and never written into the document.

This is precisely the argument for Bureau LPC's canonical-payload model. A hash over **business
data** is known *before* rendering, so it can be printed on the page. A hash over **bytes** never can.

**Defect 2 — `praxis://` is not scannable, and there is no QR image anywhere.**

No phone camera resolves a custom URI scheme from a QR code. And today the string is not even
encoded as a QR: `kit.js:278` renders it as literal footer text — *"Vérifier l'authenticité:
praxis://verify/invoice:INV-2026-0001"*. There is no QR generation library in `package.json`.
MOD-66 is seeded as *"Document Verification (QR)"* and no QR exists in the codebase.

**Two lesser findings, same PR:**

- `document_verification.service.js:17` matches with `stored.startsWith(hash)` against a minimum of
  **4 characters**. A 4-hex-char prefix is 65 536 possibilities, and `/scan` is public with **no
  per-route limiter** (compare `proposal_public.routes.js`, which uses `makeLimiter`). Combined with
  guessable `entity_ref` values (`invoice:INV-2026-0001`), that is a document-existence oracle and a
  brute-forceable "verified: true".
- Puppeteer embeds `/CreationDate` and `/ModDate`, so two renders of an identical invoice produce
  **different bytes and different hashes**. Byte-hashing therefore can never be re-derived — the
  vaulted artifact is the only referent. This has a design consequence in Q2 and Q5.

### 0.6 Assets Praxis already owns that make this much cheaper

| Need | Existing asset | Saving |
| --- | --- | --- |
| Append-only signature audit | `immutable_ledger` (0130) with `trg_ledger_ro` enforcing read-only at the trigger level | Large |
| Unguessable share tokens | `proposal.service.share()` — 32 random bytes + HMAC, sha256 at rest, expiry, revoke, audited | Large |
| External signer identity | `src/modules/portal_auth/` — JWT, argon2, invites, scoped by `portal_access`, deliberately off the RBAC path | Large |
| OTP delivery | `src/services/email.service.js` + `email_identity` with a **`DOCUMENTS` purpose** already defined | Medium |
| Encrypted provider credentials | `integration_secret` settings section, AES-256-GCM (`doc/BUILD_CONVENTIONS.md` §7) | Large |
| Per-tenant tier gating | `feature_state` flags + entitlements; `signatures` flag already on MOD-64 | Medium |
| Async QES polling, OCR ingestion | BullMQ + `src/jobs/handlers/` (`ai-vision.js`, `ai-transcribe.js` already wired to Gemini) | Large |
| Doc-type ↔ RBAC join | `document_vault.types.js` — `DOC_TYPES` with `moduleKey` per type; 30+ types registered | Large |
| Public routes pinned to live | `proposal_public.routes.js` — `req.tenantDbIn("live", …)` so a visitor cannot force sandbox | Medium |
| Unreconciled-paperwork alerting | `compliance_flag` (0340) with severity INFO/WARN/RED | Medium |
| Template hook points | `kit.signatureBlock(cfg)` and `kit.footer(entity, cfg, verify)` — the seams already exist, they are just empty | Medium |

**Verdict: nothing you proposed is infeasible.** Three things need a decision before they can be
scoped honestly: **PAdES key custody** (Q4), **the legal claim being made by Tier 3** (Q14), and
**how much the public portal discloses** (Q12).

---

## 1. Critique of the four-tier model

Your model is sound in instinct and wrong in shape. Four specific corrections.

### 1.1 "Four tiers" is really two orthogonal axes

Tier 1 (digital stamp + hash + OTP) and Tier 2 (Base64 image + hash + OTP) carry **identical legal
weight**. Same identity evidence, same integrity evidence, same audit trail. They differ only in
what the mark *looks like* — a typeset stamp versus a finger-drawn squiggle.

Modelling them as sibling tiers means every downstream decision — permissions, retention, portal
copy, revocation rules, reporting — gets written twice for no reason, and the schema acquires a
`tier` column that conflates two independent things.

The stronger shape:

| Axis | Column | Values |
| --- | --- | --- |
| **What identity evidence backs it** | `assurance_level` | `SES` (simple — session or token) · `AES_OTP` (advanced — + verified out-of-band channel) · `QES` (qualified — third-party certificate) · `WET` (ink, out-of-band) |
| **What the mark looks like** | `visual_mark` | `STAMP` (generated) · `DRAWN` (Base64 PNG) · `PROVIDER` (QTSP seal) · `INK` (scanned paper) |

Your four tiers then fall out as the four *sensible combinations*, and the two you did not name
(stamp with no OTP for low-stakes internal notes; drawn mark under a QES envelope) become available
without a schema change. This is the same reasoning that made Bureau LPC's `(document_type, party)`
pair reusable across seven document types.

### 1.2 PAdES is not a hash

> *"a server-side cryptographic hash (PAdES)"*

These are two different mechanisms answering two different questions, and you want both:

| | Canonical payload hash | PAdES |
| --- | --- | --- |
| **What it is** | `sha256` of a versioned struct of the document's business fields | ETSI EN 319 142 — a CMS/CAdES signature embedded in the PDF's incremental-update section |
| **Question answered** | *"Does this document still say what was signed?"* | *"Were these exact bytes produced by us, and untampered since?"* |
| **Needs** | Nothing but code | An X.509 key pair, a signing library, and — for long-term validity — a TSA and OCSP/CRL embedding |
| **Survives re-render** | Yes — recomputable from live data | No — seals one artifact forever |
| **Verifiable by** | Our portal | Adobe Reader, any PAdES validator, a court's expert |

Bureau LPC has the first and not the second. Most "e-signature" products have the second and not the
first. Having both — and showing the two verdicts **separately** on the portal — is genuinely
stronger than either, and is the thing that would make this defensible under OHADA scrutiny.

### 1.3 DocuSign is probably not what you mean by "Qualified Trust Provider"

Three things to separate:

- **A standard DocuSign envelope is an *advanced* electronic signature (AES), not a *qualified* one
  (QES).** QES requires a qualified certificate issued by a qualified trust service provider after
  identity proofing. DocuSign does offer qualified flows in the EU by partnering with a QTSP, but
  that is a distinct, more expensive product — not the default envelope.
- **eIDAS is EU law.** Cameroon's electronic-signature framework is its own, and my understanding is
  that national certification authority accreditation runs through ANTIC. **I would not build on
  that understanding without your counsel confirming it** — but the direction of the risk is clear:
  a DocuSign envelope buys *international commercial enforceability and a strong third-party audit
  trail*, not Cameroonian statutory qualified status.
- **"At the client's charges" is a billing subsystem**, not a config toggle. Metering,
  pre-authorisation, what happens when an envelope is voided mid-flight, and who absorbs the cost of
  a failed send are all real questions (Q15).

**Recommendation:** build a provider-agnostic adapter with DocuSign as adapter #1, so an
ANTIC-accredited local CA can become adapter #2 without touching a single call site. This is
precisely the pattern `src/services/ai/llm.service.js` already uses for DeepSeek → Gemini fallback.
Name the tier by the evidence it produces (`QES`), never by the vendor.

### 1.4 The wet signature is not a "fallback"

> *"Physical Wet Signature Fallback… ensuring software never becomes a bottleneck"*

Calling it a fallback guarantees it gets built last, tested never, and treated as a degraded path.
In warehouse and border operations it may well be the **majority** path — and it is the one where
the chain of custody is weakest, so it deserves the *most* engineering, not the least.

It needs its own first-class state machine — `ISSUED → PRINTED → SIGNED_ON_PAPER → SCANNED →
RECONCILED` — with an unreconciled-after-N-days rule raising a `compliance_flag` (which already
exists, at severity RED). That is what turns "we printed it and hoped" into an auditable control.

---

## 2. The proposed PR split

Six PRs. Each is independently shippable and leaves the product working if the next never lands.

| PR | Title | Delivers | Depends on |
| --- | --- | --- | --- |
| **PR-1** | **Signature core** | Schema replacing the 0410 stub; canonical-payload registry per doc type; `assurance_level` × `visual_mark`; internal stamp signing; verify-token minting; staleness recomputation; golden digest tests | — |
| **PR-2** | **Verification portal** | Real QR generation; public branded portal; per-doc-type live summaries; scan audit log; **fixes the prefix-match + rate-limit findings** | PR-1 |
| **PR-3** | **External signing + OTP** | Token signing links; email OTP bound to the on-file address; drawn-mark capture; share sheet | PR-1, PR-2 |
| **PR-4** | **PAdES sealing** | Cryptographic seal on the vaulted artifact; key custody; TSA/LTV; dual verdict on the portal | PR-1 |
| **PR-5** | **Tier 3 — QES adapter** | Provider interface, DocuSign adapter, envelope lifecycle worker, evidence mirroring, charge passthrough | PR-1, PR-3 |
| **PR-6** | **Tier 4 — wet signature reconciliation** | Print barcode; ingestion worker; barcode decode; auto-reconciliation; unreconciled compliance flag | PR-1, PR-2 |

Migrations start at `10740`. PR-4, PR-5 and PR-6 are parallelisable once PR-3 lands.

---

## 3. The 20 questions

Each has three options and my recommendation. Answer inline; write **"Rec"** to accept mine.

### Group A — Model and legal shape

---

**Q1. How do we model the tiers?**

- **A.** Four flat tiers exactly as proposed — one `tier` column with four values.
- **B. ⭐ Two orthogonal axes** — `assurance_level` (`SES` / `AES_OTP` / `QES` / `WET`) ×
  `visual_mark` (`STAMP` / `DRAWN` / `PROVIDER` / `INK`), per §1.1.
- **C.** Two axes plus a named-preset table so operators still pick "Tier 1…Tier 4" in the UI while
  the schema stays orthogonal.

> **Recommendation: C.** B is the correct data model; C keeps your four-tier vocabulary in the UI,
> which is what your team and your auditors will actually say out loud. The presets table is ~20
> lines and buys a language everyone shares. Cost of getting this wrong: a schema migration across
> every signed document later.

**Answer:**

---

**Q2. What does the signature attest to?**

- **A.** The rendered PDF bytes (`sha256` of the artifact) — what Praxis does today.
- **B.** A canonical business payload (Bureau LPC's model) — versioned struct per doc type.
- **C. ⭐ Both, stored and displayed separately:** `content_hash` (canonical payload, recomputable)
  **and** `artifact_hash` (the vaulted PDF's bytes, frozen).

> **Recommendation: C.** A alone cannot be printed on the document it describes (Defect 1) and
> cannot survive a re-render (§0.5). B alone leaves the artifact unprotected — Bureau LPC's actual
> weakness. C answers both *"does this still say what was signed?"* and *"is this the exact file we
> issued?"*, and the portal can show the two verdicts on separate lines. This is the single
> highest-leverage decision in the sheet.

**Answer:**

---

**Q3. How far do we take PAdES?**

- **A.** None — canonical hash only, no cryptographic seal on the PDF.
- **B. ⭐ PAdES-B-B** — a basic CMS signature embedded with an organisational seal certificate.
  Adobe shows a valid signature; validity depends on the certificate still being checkable.
- **C.** PAdES-B-LT / B-LTA — adds an RFC 3161 timestamp and embedded OCSP/CRL for long-term
  validation, so the signature stays verifiable after the certificate expires.

> **Recommendation: B in PR-4, with the schema and adapter shaped for C.** B is achievable now with
> `@signpdf/signpdf` and a P12. C is the correct end state for OHADA's ten-year retention — a
> signature that stops validating in year three is worse than none — but it needs a TSA contract
> and a certificate-status feed, which is procurement, not engineering. Ship B; leave the TSA URL as
> a config hook and a documented upgrade path in the guide.

**Answer:**

---

**Q4. Where does the PAdES signing key live?**

- **A.** A P12 on disk, path in `.env`.
- **B. ⭐** Encrypted in the `integration_secret` settings section (AES-256-GCM), per-tenant, using
  the mechanism `doc/BUILD_CONVENTIONS.md` §7 already mandates for vendor keys.
- **C.** An external KMS/HSM (AWS KMS, GCP KMS, or a cloud HSM) — the private key never enters the
  application process.

> **Recommendation: B now, C documented as the upgrade path.** A violates your own §7 convention
> ("`.env` is for boot only") and does not work per-tenant, which a white-label product needs. C is
> genuinely correct — a signing key in a database is a key an application bug can exfiltrate — but
> it adds a hard infrastructure dependency. **Flag honestly:** if a tenant's seal certificate is
> ever used for anything with statutory weight, C becomes mandatory, not optional. Say so in the
> guide rather than letting B quietly become permanent.

**Answer:**

---

**Q5. What happens when a signed document is edited?**

- **A.** Bureau LPC's model — the signature silently goes stale, the document reverts to unsigned,
  the row survives for audit.
- **B.** Hard block — a signed document is immutable; changing it requires an explicit revoke, or a
  new version.
- **C. ⭐** Stale + **loud**: the signature deactivates as in A, *and* the edit raises a
  `compliance_flag`, notifies the signer, and the portal reports "signed, then modified on {date}"
  rather than simply falling back to unsigned.

> **Recommendation: C.** A is elegant but silent — someone can quietly de-sign a document by editing
> it and nobody is told. B is correct for invoices and wrong for delivery notes, where field
> amendments are the normal case. C keeps A's flexibility and removes its blind spot, and reuses
> `compliance_flag` which already exists at severity RED.

**Answer:**

---

### Group B — Identity and OTP

---

**Q6. Which OTP channel?**

- **A. ⭐** Email only, via the existing `email_identity` **`DOCUMENTS`** purpose.
- **B.** Email plus SMS, signer chooses.
- **C.** Email plus WhatsApp Business API (dominant in the Cameroonian market).

> **Recommendation: A for PR-3.** Bureau LPC's own migration says SMS was unreliable in-field and
> added no trust. Email costs nothing extra, is already wired with a purpose-specific sender, and
> leaves a durable trail. C is genuinely attractive for this market and is the right *second*
> channel — but it needs a Business API account and template approval, so it is a follow-on, not
> PR-3 scope. The channel abstraction should be built so C is an adapter, not a rewrite.

**Answer:**

---

**Q7. Where does the OTP address come from?** *(The decision that determines whether OTP is real
security or theatre — see §0.2.)*

- **A. ⭐** **Strictly the address on file** — `client_master`, the dossier contact, or `portal_user`.
  If no address is on record, the signature cannot proceed at `AES_OTP`; it falls back to `SES` with
  that fact recorded on the signature row.
- **B.** On-file by default, with an authorised staff member able to override to a different address,
  the override recorded as an attested exception.
- **C.** The signer types their own address at signing time.

> **Recommendation: A, and I would push back hard on C.** C is exactly the failure Bureau LPC
> removed in migration 055 — an OTP to a channel the signer nominates proves only that they can read
> their own inbox. It manufactures the *appearance* of verification, which in a dispute is worse
> than no OTP at all, because it invites reliance on evidence that does not support the weight.
> B is a reasonable operational concession if your ops team says A will block real work — but the
> override must be permission-gated, reason-required, and visible on the portal as a lower assurance
> level. Tell me if ops needs B and I will spec it that way.

**Answer:**

---

**Q8. OTP lifetime, attempts and resend?**

- **A.** 15 minutes, 5 attempts, unlimited resend — as proposed.
- **B. ⭐** 10 minutes, 5 attempts, max 3 resends per request, then a 30-minute cooldown; code stored
  as `sha256` at rest, compared in constant time.
- **C.** 30 minutes, 3 attempts, no resend (reissue the whole signing request instead).

> **Recommendation: B.** 15 minutes is not wrong, but a 6-digit code is only 10⁶ — the defence is
> the attempt cap and the resend cap, not the window, and unlimited resend in A quietly multiplies
> the attempt budget. 10 minutes matches the window a signer actually needs with their inbox open.
> Praxis's own precedent is 30 min for password reset (`portal_auth.service.js`), which is a
> different risk profile: that flow is behind a mailbox the user already controls.

**Answer:**

---

**Q9. How do we establish internal (staff) signer identity?**

- **A. ⭐** Session only — resolved server-side from `app_user`, **never from the request body**
  (Bureau LPC's rule).
- **B.** Session plus password re-entry at signing time.
- **C.** Session plus a step-up OTP above a configurable value threshold.

> **Recommendation: A for PR-1, C as a per-tenant setting in PR-3.** A is the non-negotiable
> baseline and is the rule that stops anyone signing as "Directeur Général" by typing it in a form.
> B adds friction on every signature to defend against an already-compromised session, which is the
> wrong trade. C targets the same threat proportionately — and the OTP machinery from PR-3 is
> already there, so it is nearly free once built. Default the threshold off.

**Answer:**

---

### Group C — QR and the verification portal

---

**Q10. What goes in the QR?**

- **A.** `https://{tenant-host}/verify/{opaque-token}` — one unguessable token per signature event
  (Bureau LPC's model, but over HTTPS).
- **B.** `https://{tenant-host}/verify?ref={entity_ref}&h={hash}` — today's payload, made scannable.
- **C. ⭐** A, plus a short human-readable code printed beneath for manual entry when the scan fails
  (poor print, damaged paper, no camera).

> **Recommendation: C.** B keeps the enumeration problem — `entity_ref` is guessable and a
> hash prefix is brute-forceable. A is correct and is exactly what Bureau LPC reasoned its way to
> in migration 048. C adds the thing warehouse reality demands: a smudged barcode on a dusty
> delivery note still needs to be verifiable by someone typing 12 characters into a phone.
> **Must be `https://` — a `praxis://` scheme is unscannable (Defect 2) and its removal is PR-2
> scope.**

**Answer:**

---

**Q11. How is the verify token stored?**

- **A. ⭐** Plaintext in `document_signature.verify_token`, unique-indexed (Bureau LPC's model).
- **B.** `sha256` at rest, plaintext returned once at minting — the `proposal.share()` pattern.
- **C.** Plaintext plus a server-side pepper, so a database dump alone does not yield working links.

> **Recommendation: A.** B is the right instinct for a *bearer* credential — but this token is not
> one. It grants no access to the document; it resolves to a public verification page that a
> tenant has already chosen to expose (Q12). Hashing it means the tenant can never regenerate a
> replacement PDF carrying the same QR, which breaks reprints, and it makes the admin "list
> signatures with their verify links" view impossible. A high-entropy random token, unique-indexed,
> is the right weight for what this actually is. If Q12 lands on **C** (full disclosure), revisit
> this — the token becomes more sensitive and **C** here becomes the better answer.

**Answer:**

---

**Q12. How much does the public portal disclose?**

- **A.** Minimal verdict only — valid / revoked / unknown, document type, signing date. No amounts,
  no party names.
- **B. ⭐** Per-tenant configurable, defaulting to minimal; a tenant opts in to richer summaries
  per doc type.
- **C.** Full summary always — reference, counterparty, total, line-item count, core clauses
  (Bureau LPC's model, and what you described).

> **Recommendation: B, defaulting to A's field set.** What you described is C, and for a single
> company it is the right call — it is what makes the portal *useful* to an auditor rather than a
> green tick. But Praxis is white-label and multi-tenant: a competitor photographing an invoice at a
> customer's desk should not learn your client's pricing from a scan. B gives you C for Smart
> Logistics on day one and protects the tenant who has not thought about it. The per-doc-type
> summary resolver is the same shape as Bureau LPC's `verify_summary()` switch, registered alongside
> `DOC_TYPES` in `document_vault.types.js`.

**Answer:**

---

**Q13. Do we log verification scans?**

- **A.** No logging.
- **B.** Log to `immutable_ledger` (timestamp, IP, coarse user-agent, referrer) and show the count
  on the internal document view.
- **C. ⭐** B, plus notify the document owner on the **first** scan by a new IP, and surface an
  anomaly signal (a document scanned 40 times in an hour is either being audited or being shopped).

> **Recommendation: C, with the notification default-off per tenant.** Scan telemetry is the piece
> Bureau LPC lacks entirely, and it is cheap here because `immutable_ledger` is append-only at the
> trigger level (`trg_ledger_ro`) — exactly the evidentiary property you want. **One caveat to
> settle:** logging scanner IPs is personal-data processing. The portal needs a one-line notice, and
> the retention period needs to be a setting, not a hardcode. Confirm you are comfortable with that
> and I will spec it; if not, B without the IP column is still worth having.

**Answer:**

---

### Group D — Tier 3 (QES / DocuSign)

---

**Q14. Provider strategy for Tier 3?**

- **A.** DocuSign, integrated directly.
- **B. ⭐** A provider-agnostic `qes.provider` adapter interface with DocuSign as adapter #1.
- **C.** B, plus a committed second adapter for an ANTIC-accredited Cameroonian CA in the same
  programme.

> **Recommendation: B, with C's interface designed in and the second adapter deferred.** Per §1.3, a
> standard DocuSign envelope is an *advanced* signature, not a *qualified* one, and eIDAS
> qualification is EU law — it does not automatically confer Cameroonian statutory status. That does
> not make DocuSign the wrong choice: it buys a strong, independent, court-legible audit trail and
> international enforceability, which for most of your contracts is what actually matters.
> But **name the tier `QES` by the evidence it produces, never "the DocuSign tier"**, and get your
> counsel to tell you what an OHADA-zone court actually wants to see before you promise a client
> that Tier 3 is "government-backed". If the answer is an ANTIC-accredited CA, the adapter means
> that is a new file, not a new project.

**Answer:**

---

**Q15. Who pays for QES envelopes, and how is it metered?**

- **A.** The tenant absorbs the cost; Praxis meters it for internal reporting only.
- **B.** The client pre-authorises a per-envelope charge before the envelope is created; no
  authorisation, no envelope.
- **C. ⭐** The tenant fronts the cost, Praxis meters per envelope against the tenant's entitlement,
  and the charge appears as a billable line on the client's next invoice via the existing finance
  module.

> **Recommendation: C.** You said "at the client's charges", and B is the literal reading — but B
> puts a payment wall in the middle of a signing flow, which is where deals die. C achieves the same
> commercial outcome using machinery you already have (entitlements for metering, `final_invoice`
> for rebilling) and keeps the signing experience uninterrupted. **Three failure cases the guide
> must specify either way:** an envelope voided after creation (charged or not?), a provider
> API failure after the charge is recorded, and a client who disputes the line. Left unspecified,
> these become support tickets.

**Answer:**

---

**Q16. Who decides which tier a given document may use?**

- **A.** A hardcoded matrix in `document_vault.types.js` — each doc type declares its permitted tiers.
- **B.** A per-tenant setting — the tenant configures the tier policy per doc type.
- **C. ⭐** A declares the *ceiling* (a delivery note may never require QES; an employment contract
  may never go below `AES_OTP`), B configures within it, and the sender picks per document at send
  time within what both allow.

> **Recommendation: C.** A alone cannot serve a white-label product. B alone lets a tenant configure
> a payslip down to an unauthenticated stamp. C is a small ordered enum and two comparisons, and it
> encodes the one thing you cannot recover from — a document signed at a weaker level than its
> nature demands.

**Answer:**

---

### Group E — Tier 4 (wet signature and ingestion)

---

**Q17. Barcode symbology, and what does it encode?**

- **A.** Code 128 encoding the `entity_ref`.
- **B. ⭐** **PDF417 or DataMatrix** encoding a dedicated `print_job_id` — distinct from the verify
  token, so a photocopy does not leak a verification credential.
- **C.** QR encoding the verify token (one code doing both jobs).

> **Recommendation: B.** C is tempting — one code, less ink — but it conflates two different
> secrets with different threat models: the verify token is meant to be scanned by strangers, while
> the print identifier is an internal reconciliation key, and a photocopied page should not hand out
> both. DataMatrix survives poor print and partial damage far better than Code 128 (its error
> correction is the reason logistics uses it), which matters for a document that will ride in a
> truck cab. A separate `print_job_id` also makes a reprint distinguishable from the original —
> which is exactly the audit question that comes up when two signed copies of the same delivery note
> surface.

**Answer:**

---

**Q18. How does a signed physical copy get back in?**

- **A.** Manual upload through the vault UI.
- **B.** A dedicated inbound email address — scan-to-email from the office MFP.
- **C. ⭐** All three: manual upload, email-in, and **mobile camera capture** from the Praxis PWA.

> **Recommendation: C, built in that order.** A is PR-6 baseline. B is nearly free — the mail engine
> already ingests attachments to `document_vault` and `email_identity` already supports
> purpose-specific addresses. C is the one that matters operationally: the driver at the border has
> a phone, not an MFP, and Praxis is already a PWA. Each is a different entry point into the same
> ingestion worker, so the marginal cost after A is small.

**Answer:**

---

**Q19. How confident must a barcode match be before it auto-reconciles?**

- **A.** Auto-bind on any successful barcode decode.
- **B. ⭐** Auto-bind on a clean decode **plus** a corroborating check (document type matches, the
  record is in a state that expects a signature, no existing reconciled scan); anything else goes to
  a review queue.
- **C.** Always require human confirmation.

> **Recommendation: B.** A trusts a decode that could come from a photocopy of a *different*
> shipment's paperwork stapled to this one — a genuinely common warehouse failure. C makes the
> feature pointless: the entire value proposition of your fourth idea is *"completely eliminating
> manual upload errors"*, and a mandatory confirmation step reintroduces the human who makes them.
> B auto-reconciles the ~95 % that are unambiguous and escalates the rest, which is the same
> posture `mail.service.autoLink` already takes for inbound email binding.

**Answer:**

---

### Group F — Delivery

---

**Q20. Sequencing?**

- **A.** Strictly sequential, PR-1 → PR-6, one engineer.
- **B. ⭐** PR-1 alone, then PR-2 and PR-4 in parallel, then PR-3, then PR-5 and PR-6 in parallel.
- **C.** PR-1 and PR-2 as a single foundation PR, then everything else in parallel.

> **Recommendation: B.** PR-1 must land alone — it replaces the `document_signature` stub and every
> other PR builds on its schema. After that, PR-2 (portal) and PR-4 (PAdES) touch disjoint files and
> parallelise cleanly. PR-3 needs PR-2's token infrastructure. C bundles the schema cut-over with
> the public-facing portal in one reviewable unit, which is too much surface for one review.
> **If only two PRs ever ship, make them PR-1 and PR-2** — together they fix both structural
> defects and give you a working QR, which is the visible half of what you described.

**Answer:**

---

## 4. Optional additions

Yes/no each. These are things I would add that you did not ask for; none is required for the
programme to be coherent.

| | Addition | Why | Rec |
| --- | --- | --- | --- |
| **a** | **Signature request lifecycle** — a `signature_request` table (`PENDING → SENT → VIEWED → SIGNED / DECLINED / EXPIRED`) rather than only recording completed signatures | You cannot chase what you cannot see. Also gives "declined, with reason", which a signature-only table structurally cannot express. | **Yes** |
| **b** | **Sequential multi-party signing** — order, and each party's own OTP | Contracts routinely need counter-signature. Retrofitting order onto a flat table is painful. | **Yes** |
| **c** | **Decline with reason** — a first-class outcome, surfaced on the portal | "Not signed" and "refused because the quantities were wrong" are very different facts. | **Yes** |
| **d** | **Signature reminders** — BullMQ delayed jobs nudging an unsigned request at D+2 / D+5 | Nearly free once (a) exists. | **Yes** |
| **e** | **Certificate of completion PDF** — a one-page evidence summary (all parties, timestamps, IPs, OTP verifications, hashes) generated on final signature and vaulted | This is the document you hand a court or an auditor. It is what DocuSign's own audit certificate is, and it costs one template. | **Yes** |
| **f** | **Batch signing** — sign 40 delivery notes in one action, one OTP for the batch | Real ops need. But it weakens the per-document attestation claim; needs its own assurance treatment. | **Ask** |
| **g** | **Offline signing queue** — the PWA captures signatures without connectivity and syncs later | Directly serves your "software never becomes a bottleneck" goal. But offline-captured timestamps are attacker-controllable and must be recorded as *device-asserted*, not server-asserted. | **Yes, with the caveat spelled out** |
| **h** | **Signature analytics** — median time-to-sign, decline rates, stale-signature counts per doc type | Cheap, and it is how you find out the OTP is failing before a client tells you. | **Yes** |
| **i** | **Delete the dead code** — Bureau LPC's dormant `SignerOtp` and tombstoned modules have a Praxis equivalent: the 0410 stub and today's `verification.tsx` | Bureau LPC kept dead signature code indefinitely and its own docs warn people off it. Do not repeat that. | **Yes** |

---

## 5. What I need from you

1. Answers to the 20 questions above (**"Rec"** where you agree).
2. Yes/no on the nine additions.
3. **One thing only counsel can answer** (Q14): what does an OHADA-zone court actually require for
   a signature to carry qualified weight in Cameroon? Everything else in this sheet I can decide or
   recommend from the code. That one I cannot, and I would rather flag it now than have the
   engineering guide assert something about legal standing that turns out to be wrong.

If it is easier, answer 1–5 first and I will start drafting PR-1 while you work through the rest —
Group A is the only group PR-1 actually blocks on.
