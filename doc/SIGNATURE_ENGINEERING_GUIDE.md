# Praxis LS — Multi-Tier Signature & Verification: Engineering Guide

**Status:** Plan of record. Built from `doc/SIGNATURE_PROGRAMME_QUESTIONNAIRE.md` plus the answers
returned on all 20 questions.
**Read alongside:** `doc/CONVENTIONS.md` (module layout), `doc/BUILD_CONVENTIONS.md` (document
lifecycle, numbering, approval, §7 secrets), `doc/DB_ARCHITECTURE.md` (database-per-tenant),
`doc/DOCUMENT_TEMPLATES_PLAN.md` (the template kit and registry),
`doc/SMART_MAIL_ENGINEERING_GUIDE.md` (the mail engine this programme's inbound path leans on),
`doc/ERROR_HANDLING.md` (`AppError` codes).

**Audience.** An engineer or an AI agent implementing one PR chapter end to end without needing to
re-derive a decision. Every chapter is self-contained: migrations, backend, frontend, contracts,
acceptance criteria, tests, rollout, ordered task list.

---

## 0. How to use this document

- **§1** is the decision log. It is binding. If the code disagrees with §1, the code is wrong.
- **§2** states what we are building and — just as importantly — what we are **not**, and why.
- **§3** is cross-cutting: the tier model, the canonical-payload contract, tokens, flags, RBAC,
  migration numbering, testing gates. Read it once before starting any chapter.
- **§4–§8** are the five PRs. Work them in the order given in §3.1.
- **§9** is the index set (migrations, endpoints, flags, env, events) and the v2 backlog.

Conventions below: `→` marks a deliverable file. **MUST** / **MUST NOT** are hard rules a reviewer
should reject a PR over. Anything marked _(v2)_ is explicitly out of scope.

---

## 1. Decision log

### 1.1 The 20 answers

| #   | Question | Decision | Consequence for the build |
| --- | --- | --- | --- |
| 1 | Tier model | **C** — two orthogonal axes + a named-preset table; **every signer sees the full menu and picks**, internal included; **every choice must be verified** | `assurance_level` × `visual_mark` + `signature_preset`. Drives the whole PR-3 signer UX. §3.3 |
| 2 | What the signature attests to | **C** — both `content_hash` (canonical payload, recomputable) and `artifact_hash` (vaulted bytes, frozen) | Two hashes on every signature row; the portal reports two verdicts. §3.6 |
| 3 | PAdES | **A** — **no PAdES at all.** Canonical hash + **Platform Audit Trail Model** | **PR-4 (PAdES) is deleted.** The Certificate of Completion becomes the legal artifact. §2.1, §6.7 |
| 4 | Signing key custody | **N/A** — no signing keys exist. Roadmap: **C** (external KMS/HSM) | No key material anywhere in this programme. Recorded in §9.6 as the PAdES upgrade path. |
| 5 | Edit after signing | **C** — stale **and loud**: deactivate, raise a `compliance_flag`, notify the signer, portal says "signed, then modified on {date}" | Plus the chain rule in §1.3(a): an amendment voids an open request. |
| 6 | OTP channel | **A** — email only, `email_identity` purpose `DOCUMENTS` | WhatsApp is an adapter seam, not scope. §9.6 |
| 7 | OTP address source | **B** — on-file by default; **at most one** manually-entered override per request, attributed to the tenant user. **C forbidden.** | Forces the request/party model. Enforced by a partial unique index. §6.3 |
| 8 | OTP lifetime | **B** — 10 min, 5 attempts, 3 resends then 30-min cooldown, `sha256` at rest, constant-time compare | §6.4 |
| 9 | Internal signer identity | **A + C** — session-resolved always; step-up OTP above a per-tenant value threshold, default off | §6.5 |
| 10 | QR payload | **C** — `https://{host}/public/verify/{token}` + a printed human-readable short code | §3.7 |
| 11 | Token at rest | **C** — HMAC-SHA256 under a server-side pepper; **no plaintext stored** | Reprints stream the vaulted artifact, never a re-render. §3.7 |
| 12 | Portal disclosure | **C** — full summary always: reference, counterparty, total, line-item count, core clauses | Per-doc-type summary resolvers. Residual risk noted in §1.4(d). §5.4 |
| 13 | Scan logging | **C** — log every scan, notify the owner on a first scan from a new IP, surface an anomaly signal | `signature_scan` + `immutable_ledger`. Privacy notice + retention setting. §5.5 |
| 14 | QES provider | **B** — provider-agnostic adapter. **V1 is SignWell only.** DocuSign _(v2)_, ANTIC CA _(v2)_ | `src/services/qes/` with one adapter shipped. §7.2 |
| 15 | QES billing | **C** — tenant-fronted, post-metered, upfront fee modal; charge on envelope-ID issue only; rollback on provider failure; non-refundable once dispatched | `signature_usage_ledger` + platform wallet monitor. §7.5 |
| 16 | Tier eligibility | **Hybrid B + C** — tenant sets the allowed menu per doc type; sender may narrow it for one dispatch; **signer picks from what remains** | Three-level funnel. §3.4 |
| 17 | Barcode | **B** — DataMatrix carrying a dedicated `print_job_id`, **subtle and discreet** | 12 mm, 40% grey, bottom-left. §8.3 |
| 18 | Physical return path | **C** — manual upload, email-in (via the Smart Mail engine), and PWA camera capture | Engineer note left for the mail team. §8.5 |
| 19 | Reconciliation confidence | **B** — auto-bind on a clean decode **plus** corroboration; everything else queues | §8.6 |
| 20 | Sequencing | **B** — PR-1 alone, then parallelise where disjoint | Re-derived in §3.1 because Q3 removed a PR. |

### 1.2 Additions — what is built, and why

The nine optional additions were not answered. Three of them stopped being optional the moment Q7,
Q16 and Q3 were answered, so they are **in scope and specified below**. The rest are recorded here
with an explicit status so nobody has to guess.

| | Addition | Status | Why |
| --- | --- | --- | --- |
| **a** | Signature request lifecycle | **BUILT — structurally required** | Q16 has the signer choosing a method at signing time, and Q7 has a chain of parties. Neither is expressible on a table that only records completed signatures. |
| **b** | Sequential multi-party signing | **BUILT — structurally required** | Q7 describes it directly: "Commercial Director signs first, then routes to the client's Procurement Manager, and optionally adds the client's MD." |
| **c** | Decline with reason | **BUILT — structurally required** | A chain that cannot record a refusal stalls with no explanation. Falls out of (a) at near-zero cost. |
| **e** | Certificate of Completion | **BUILT — load-bearing** | Q3 removed the cryptographic seal and named the "Platform Audit Trail Model" as the replacement. **The certificate _is_ that model.** It is not a nice-to-have; it is the evidence. §6.7 |
| **i** | Delete the dead code | **BUILT** | The 0410 stub, `signatures.tsx` and `verification.tsx` are replaced, not left beside their successors. |
| **d** | Signature reminders | **BUILT** | Nearly free once (a) exists, and a chain without nudges stalls silently. §6.8 |
| **h** | Signature analytics | **BUILT (thin)** | One read endpoint + one card. It is how you find out the OTP is failing before a client tells you. §5.6 |
| **f** | Batch signing | **DEFERRED _(v2)_** | My recommendation was "ask", and it was not answered. It weakens the per-document attestation claim and needs its own assurance treatment. §9.6 |
| **g** | Offline signing queue | **DEFERRED _(v2)_** | Q18 brings PWA camera capture, which is adjacent but not the same thing. Offline timestamps are device-asserted and need a distinct evidentiary treatment. §9.6 |

**If you disagree with any BUILT/DEFERRED call above, say so before PR-1 merges** — (a), (b) and (e)
are schema-level and expensive to retrofit; (d), (f), (g), (h) are not.

### 1.3 Unasked questions resolved by judgment

These were not in the sheet. They fall out of the answers and had to be settled to make the guide
buildable. Each is flagged so a reviewer can overrule it cheaply.

**(a) What happens when a document is amended while a signature chain is open?**
Q5 chose "stale and loud" for a single signature. A chain makes it sharper: if party A has signed and
the document is then amended, party B must not sign a different payload than A did.

> **Rule.** `signature_request.content_hash` is snapshotted at creation. Every signing act
> recomputes the canonical hash and compares. On mismatch the request transitions to `AMENDED`, all
> pending parties are barred (`409 DOCUMENT_AMENDED`), every already-signed party is notified, and a
> `compliance_flag` is raised. Reissuing mints a **new** request; the old one is never reopened.

**(b) Is `assurance_level` what was requested, or what was proved?**

> **Rule.** `document_signature.assurance_level` records the evidence **actually collected**, never
> what the preset asked for. An internal signer using the stamp preset with only a session records
> `SES`; the same preset after an OTP records `AES_OTP`. A guide that let the requested level be
> stored would let the portal overstate its own evidence.

**(c) Where does `WET` sit on the assurance ladder?**
Q16's ceiling/floor comparison needs an ordering, and `WET` is not on the digital ladder.

> **Rule.** Ranks are `SES=1`, `AES_OTP=2`, `WET=2`, `QES=3`. A wet signature that has been printed,
> signed, scanned and barcode-reconciled carries a verified chain of custody comparable to an
> email-verified digital one — and in OHADA practice it is what a court expects on a delivery note.
> An employment contract with a floor of `AES_OTP` can therefore still be wet-signed, which is
> correct.

**(d) Which five cards does the signer see?**
Q1 says "they see all five … we give all four to anyone signing". Four tiers, five cards — the
counts differ, so this is my reading, and §1.4(a) asks you to confirm it.

> **Reading.** Once the model is orthogonal (Q1 = C), the natural fifth card is **TYPED** — the
> "type your name" option every commercial signing UI offers beside draw and upload, and the one a
> counterparty on a desktop with no touchscreen actually reaches for. The five seeded cards are in
> §3.3. **The menu is a seeded registry, not code**, so adding or removing a card is one row.

**(e) What does a "reprint" mean when the token is not recoverable (Q11 = C)?**

> **Rule.** The vaulted PDF is the only printable original. `GET /signatures/:id/document` streams
> the stored bytes. Nothing re-renders a signed document — a re-render would produce different bytes
> (Puppeteer stamps `/CreationDate`), a different `artifact_hash`, and a QR whose token cannot be
> re-derived from the HMAC.

### 1.4 Open items — I need your word on these

None of them block PR-1 except (a), and (a) only blocks the seed row.

| | Item | Why it needs you |
| --- | --- | --- |
| **a** | **The five cards (§1.3(d)).** Confirm TYPED is the fifth, or name the one you meant. | It is one seed row in `10741`, but the signer-facing labels are yours to word. |
| **b** | **The QES fee shown in the Q15 modal.** What number, in what currency, and does it vary per tenant? | The modal copy is written; the figure is a setting with no default I can invent. |
| **c** | **Counsel on OHADA (Q14).** Still outstanding from the questionnaire. | Nothing in V1 depends on it — SignWell ships regardless. It decides whether adapter #3 is ever needed, and it must be answered before anyone tells a client Tier 3 is "government-backed". |
| **d** | **Q12 = C residual risk, stated once and then dropped.** Full disclosure means anyone holding a scanned document sees the counterparty and the total. You chose this knowingly and Q11 = C (peppered token) is the mitigation that makes it coherent. Recorded here so it is a decision on the record, not an oversight. | No action needed unless you want a kill switch; if you do, say so and it is one setting. |

---

## 2. Scope

### 2.1 What we are building

1. **A signature model with two axes and a preset menu.** `assurance_level` × `visual_mark`, with
   five named presets an operator recognises as "the four tiers". Every signer — internal or
   external — is offered the menu their tenant, their sender and their document type allow, and
   picks. (Q1, Q16)
2. **Canonical-payload hashing per document type.** A versioned struct of the contract-relevant
   fields, hashed at signing time and recomputed at every read. This is what makes a signature go
   stale when the document changes, and it is what can be printed on the page — unlike a hash of the
   rendered bytes. (Q2)
3. **A real QR and a real public portal.** `https://` URLs, a scannable QR image, a typeable short
   code, per-doc-type live summaries, and a scan log. Replaces the `praxis://` string that has never
   verified anything. (Q10, Q12, Q13)
4. **Signature requests, ordered parties and email OTP.** On-file addresses, at most one attributed
   override, sequential chains, decline-with-reason, reminders. (Q6, Q7, Q8, Q9)
5. **A Certificate of Completion.** The evidence document that replaces the cryptographic seal.
   (Q3 — see §2.2 for why this is the centre of gravity)
6. **Tier 3 through a provider adapter**, with SignWell as the only V1 implementation, metered and
   rebilled. (Q14, Q15)
7. **Tier 4 as a first-class path**: a discreet DataMatrix on print, three inbound routes, and
   corroborated auto-reconciliation with an unreconciled-after-N-days compliance flag. (Q17–Q19)

### 2.2 What we are deliberately not building

- **PAdES, or any cryptographic seal on the PDF.** (Q3 = A) The reasoning is sound and worth writing
  down so nobody re-opens it casually: a *self-signed* certificate makes Adobe Reader show
  "Validity is UNKNOWN", which is worse than no signature panel at all, because it invites the
  reader to distrust a document that is in fact genuine. The alternative that removes the warning is
  a certificate chaining to Adobe's AATL trust list, which is a purchased product with an annual
  cost and an HSM requirement — i.e. Q4 = C infrastructure. Until that is bought, the **Platform
  Audit Trail Model** is the industry-standard substitute and is what most SaaS e-signature
  agreements actually rely on.
  **The consequence must not be lost:** with no seal in the bytes, the Certificate of Completion and
  the `immutable_ledger` trail are the *entire* evidentiary case. They are specified in §6.7 to that
  standard, and they are not optional polish.
- **SMS or WhatsApp OTP.** (Q6 = A) The channel abstraction admits a second adapter; nothing calls
  for one in V1.
- **DocuSign.** (Q14) The adapter interface is designed so DocuSign is adapter #2, but no DocuSign
  code ships in this programme.
- **Batch signing and offline capture.** (§1.2 f, g)
- **A tracking pixel or open telemetry on signing emails.** Not asked for, and the Smart Mail
  programme already ruled it out (`SMART_MAIL_ENGINEERING_GUIDE.md` §1.1 Q32). Scan logging (Q13) is
  a different thing: it records verifications of a public document, not the reading of a private
  email.

---

## 3. Cross-cutting architecture

### 3.1 Sequencing and merge order

Q20 = B was answered against a six-PR plan in which PR-4 was PAdES. Q3 = A deleted that PR, so the
plan is **five PRs** and the order is re-derived below. The intent of B — *one foundation alone,
then parallelise where the file sets are disjoint* — is preserved.

```
PR-1  Signature core                    ← alone. Everything below builds on its schema.
        │
        ├── PR-2  Verification portal    ← can start as soon as PR-1's token helper lands
        │
        └── PR-3  Signing sessions, OTP and the signer menu   ← needs PR-2's token + portal
                  │
                  ├── PR-4  Tier 3 — SignWell adapter and billing   ┐ parallel,
                  └── PR-5  Tier 4 — wet signature and reconciliation ┘ disjoint file sets
```

**PR-1 MUST merge alone.** It replaces the `document_signature` table from `0410` and every later
chapter depends on its shape.

**If only two PRs ever ship, make them PR-1 and PR-2.** Together they fix both structural defects
from the questionnaire (§0.5) and produce a working, scannable QR — the visible half of the
programme.

### 3.2 The module-loader rule

`src/shared/http/module-loader.js` classifies a directory under `src/modules/`:

> A dir with module SUBFOLDERS is a group (its own `<dir>.routes.js` is **ignored**); a dir with no
> module subfolders but a matching `<dir>.routes.js` is a standalone module.

**`src/modules/vault/` is already a group** — it holds `compliance_flag/`, `document_signature/`,
`document_vault/`, `document_verification/` and `report/`, each with a matching `*.routes.js`. So
the landmine that cost the Smart Mail programme a chapter (`SMART_MAIL_ENGINEERING_GUIDE.md` §3.2)
**does not apply here**, and no move is needed.

The rule still binds: every new directory under `src/modules/vault/` **MUST** carry a matching
`<name>.routes.js`, and nothing may put a loose `*.routes.js` at the group root.

### 3.3 The tier model

Two independent columns, one preset catalogue. This is Q1 = C.

**Axis A — `assurance_level`: what identity evidence backs the signature.**

| Value | Rank | Evidence | Recorded when |
| --- | --- | --- | --- |
| `SES` | 1 | An authenticated session, or possession of a signing token | Internal signer below the Q9 threshold; external signer whose party has no on-file address |
| `AES_OTP` | 2 | The above **plus** a verified email OTP to an address on file | The normal external path, and internal above the Q9 threshold |
| `WET` | 2 | Ink on paper, reconciled to the record by its printed DataMatrix | On successful reconciliation (PR-5) |
| `QES` | 3 | A third-party provider's identity verification and audit certificate | On provider completion callback (PR-4) |

`WET` at rank 2 is a judgment call — see §1.3(c).

**Axis B — `visual_mark`: what the mark looks like.**

`STAMP` (generated block) · `TYPED` (typed name, rendered) · `DRAWN` (Base64 PNG from a pad) ·
`UPLOAD` (an uploaded image of a signature) · `PROVIDER` (the QTSP's own seal) · `INK` (scanned paper)

**The preset catalogue** — what an operator and a signer actually see. Seeded in `10741`, editable
per tenant. `UPLOAD` is defined in the enum but not seeded as a card in V1; see §1.4(a).

| `code` | Signer-facing (EN) | Signer-facing (FR) | `assurance_level` | `visual_mark` | "Tier" |
| --- | --- | --- | --- | --- | --- |
| `STAMP` | Company stamp | Cachet de l'entreprise | `AES_OTP` | `STAMP` | 1 |
| `TYPED` | Type your name | Saisir votre nom | `AES_OTP` | `TYPED` | 1 |
| `DRAWN` | Draw your signature | Dessiner votre signature | `AES_OTP` | `DRAWN` | 2 |
| `CERTIFIED` | Certified signature | Signature certifiée | `QES` | `PROVIDER` | 3 |
| `PRINT_SIGN` | Print and sign by hand | Imprimer et signer | `WET` | `INK` | 4 |

The `tier_label` column carries "1"–"4" so the UI can group cards under the vocabulary your team
uses out loud, while the schema stays orthogonal. That is the whole point of Q1 = C.

> **MUST.** `assurance_level` on a completed signature is derived from evidence actually collected
> (§1.3(b)). The preset states the *target*; the signing service states the *outcome*. A signer who
> picks `STAMP` and never completes the OTP is recorded as `SES`, and the portal says so.

### 3.4 The eligibility funnel (Q16)

Three levels, narrowing. Resolved once, server-side, in `presets.resolveMenu()`.

```
1. DOC-TYPE CEILING (code)      document_vault.types.js declares min_rank / max_rank per doc type.
                                A DELIVERY_NOTE may not require QES; an EMPLOYMENT_CONTRACT may not
                                go below rank 2. Not tenant-editable.
        ↓
2. TENANT MENU (setting)        settings section `signature_policy`, key = docType.
                                { allowed: ["STAMP","TYPED","DRAWN","PRINT_SIGN"], default: "STAMP" }
                                Anything outside the ceiling is rejected on write.
        ↓
3. SENDER NARROWING (per send)  signature_request.allowed_presets — a subset of level 2, chosen at
                                dispatch. "The tenant allows wet signatures, but not for this client."
        ↓
4. SIGNER CHOICE (per party)    signature_party.allowed_presets, defaulted from level 3. The signing
                                page renders these as cards. The signer picks one.
```

> **MUST.** The menu is resolved **server-side on every render of the signing page**, never trusted
> from the client. A party POSTing a preset outside their resolved menu gets `422 PRESET_NOT_ALLOWED`.

Empty menu after narrowing is a configuration error, not an empty page: dispatch fails at level 3
with `422 EMPTY_SIGNATURE_MENU` rather than producing a signing link nobody can complete.

### 3.5 Feature flags

One namespace, `signatures.*`. `signatures` itself already exists on MOD-64 (seeded `on` in
`9100_seed_platform_catalogue.sql`) and keeps its meaning: the module is available at all.

| Flag | Default | Gates |
| --- | --- | --- |
| `signatures` | **on** (existing) | The module. Unchanged. |
| `signatures.portal` | **on** | The public verification portal + QR printing (PR-2) |
| `signatures.external` | **off** | External signing links, OTP, chains (PR-3) |
| `signatures.qes` | **off** | Tier 3 / SignWell. Also requires a configured provider secret (PR-4) |
| `signatures.wet` | **off** | Barcode printing + ingestion reconciliation (PR-5) |

Turn on per tenant as each PR is validated. Smart Logistics gets all five; every other tenant starts
with the first two.

### 3.6 The canonical payload contract — the single most important rule here

This is the mechanism the whole programme rests on, and the one a future refactor is most likely to
break silently.

`src/services/signatures/canonical.js` holds one builder per doc type:

```js
// Returns the contract-relevant fields ONLY, in a fixed key order, with a version.
function canonical_FINAL_INVOICE(doc) {
  return {
    v: 1,
    type: "FINAL_INVOICE",
    number: String(doc.number || ""),
    issued_on: String(doc.issued_on || ""),
    currency: String(doc.currency || "XAF"),
    party: { name: …, niu: …, rccm: … },
    lines: (doc.lines || []).map((l) => ({ label: …, qty: round(l.qty, 3), unit: round(l.unit, 2), tax: round(l.tax, 2) })),
    totals: { service_ht: …, disbursement_total: …, vat_total: …, total_ttc: … },
  };
}

const hash = (docType, doc) =>
  crypto.createHash("sha256")
    .update(JSON.stringify(canonical(docType, doc)))  // stable key order via literal construction
    .digest("hex");
```

> **MUST NOT** edit a field name, drop a field, or reorder keys in an existing builder. Doing so
> silently invalidates **every signature ever issued** against that doc type — the recomputed hash
> stops matching, and every signed document in the tenant reads as amended.
>
> **To change a payload:** add a new branch under a bumped `v`, keep the old branch reachable, and
> add a new golden fixture. `signatureCanonical()` dispatches on the version stored on the signature
> row, not on the current code's latest.

> **MUST.** `tests/unit/signature-canonical.test.js` pins **one fixed input per doc type to a known
> sha256 digest**. This test is the only thing standing between a routine refactor and every
> signature in production going stale at once. A PR that changes a digest without bumping `v` is
> rejected.

Rounding is part of the contract: quantities to 3 dp, money to 2 dp, applied **inside** the builder,
so a float that renders as `1200.00` and one that renders as `1200.004` hash identically.

Doc types get a builder as they gain signing. V1 covers: `FINAL_INVOICE`, `PROFORMA_ADVANCE`,
`QUOTATION`, `PROPOSAL`, `PURCHASE_ORDER`, `DELIVERY_NOTE`, `TRANSIT_ORDER`, `EMPLOYMENT_CONTRACT`.
An unregistered type throws `422 NO_CANONICAL_PAYLOAD` at signing time — never a silent skip.

### 3.7 Tokens, codes and the pepper (Q10 = C, Q11 = C)

Two credentials per signature, both unguessable, **neither stored in plaintext**.

| | Form | Where it appears | Stored as |
| --- | --- | --- | --- |
| `verify_token` | 32 random bytes → base64url (43 chars) | The QR's URL: `https://{host}/public/verify/{token}` | `verify_token_hmac` |
| `verify_code` | 12 chars Crockford base32 (no I/L/O/U), shown `XXXX-XXXX-XXXX` | Printed under the QR, for manual entry | `verify_code_hmac` |

Both stored as `HMAC-SHA256(pepper, value)`, hex, unique-indexed. Lookup computes the HMAC of the
presented value and matches the index — an O(1) equality lookup, not a scan.

```
SIGNATURE_TOKEN_PEPPER   required, ≥ 32 bytes, env only, NEVER in the tenant DB
```

Why a pepper and not a bare `sha256`: the token is short and its alphabet is known, so a stolen
database dump plus a GPU is a realistic offline attack on a bare hash — and Q12 = C makes a working
verify link disclose the counterparty and the total. The pepper lives outside the database, so a
dump alone yields nothing. This is precisely the trade the questionnaire flagged under Q11: full
disclosure raises the token's value, so the token gets stronger storage.

**Consequences to hold on to:**
- The plaintext token exists in exactly one place after minting: **the rendered PDF**. §1.3(e).
- The signing-link token (PR-3) is a **separate** credential from the verify token. A signing link
  grants the ability to *act*; a verify token grants the ability to *read a public summary*. Never
  reuse one for the other.
- **Pepper rotation** needs a dual-read window: add `SIGNATURE_TOKEN_PEPPER_PREVIOUS`, have the
  lookup try current then previous, re-HMAC matched rows to the new pepper on read, and drop the
  previous value once `verify_token_hmac_rotated_at` is non-null for every live row. Documented in
  §9.5; not automated in V1.

Entropy: 12 Crockford chars = 2⁶⁰. Adequate **only with rate limiting** — the portal limiter in §5.2
is load-bearing, not decoration.

### 3.8 RBAC

The tenant RBAC vocabulary is fixed at five actions per module key
(`can_create / can_read / can_update / can_delete / can_approve`, `0110_rbac.sql`), so this
programme adds **no new permission names** — it maps onto the existing five.

| Module | Action | Grants |
| --- | --- | --- |
| MOD-64 | `view` | See signature requests, parties and completed signatures |
| MOD-64 | `create` | Create a signature request and dispatch it |
| MOD-64 | `edit` | Add the one attributed override signatory (Q7); narrow the menu for a dispatch (Q16 level 3) |
| MOD-64 | `approve` | **Sign internally**; revoke a completed signature |
| MOD-64 | `delete` | Void an open request |
| MOD-66 | `view` | The internal verification view: who scanned this, and when |
| MOD-70 | `edit` | The `signature_policy` settings section (Q16 level 2) |

> **MUST.** `create` and `approve` are distinct grants and **MUST NOT** be collapsed. Drafting a
> document for signature and attesting to it are different authorities — the same reasoning
> `0110_rbac.sql` applies to `can_create` vs `can_approve` everywhere else.

Public routes (`/public/sign`, `/public/verify`) carry **no** permission check: the token is the
credential. They are rate-limited instead (§5.2, §6.2).

### 3.9 Migrations

`main` is at `10739` (`10739_mail_compose_events.sql`). This programme takes **`10740`–`10756`**.

| Range | PR |
| --- | --- |
| `10740`–`10743` | PR-1 — core schema, presets, policy seed, events |
| `10744`–`10745` | PR-2 — scan log, portal events |
| `10746`–`10749` | PR-3 — requests, parties, OTP, certificate doc type |
| `10750`–`10752` | PR-4 — QES envelopes, usage ledger |
| `10753`–`10756` | PR-5 — print jobs, ingestion queue, compliance rule |

House rules that apply (`doc/BUILD_CONVENTIONS.md`): every file idempotent and re-runnable, additive
where possible, `-- VERIFY` block at the foot with the queries a deployer runs to confirm the
migration landed.

### 3.10 Testing and CI gates

`npm run ci` must be green before any chapter merges. Chapter-specific gates:

- **The golden digest test** (§3.6) — non-negotiable, lands in PR-1.
- **Token round-trip** — mint → HMAC → lookup → match, and a wrong pepper must not match.
- **Menu resolution** — a table-driven test over the four funnel levels, including the
  `EMPTY_SIGNATURE_MENU` and `PRESET_NOT_ALLOWED` paths.
- **The override cap** — inserting a second `source='OVERRIDE'` party must be rejected **by the
  database**, not only by the validator. The test asserts the constraint violation.
- **Staleness** — sign, mutate the underlying record, assert the signature reads `AMENDED` and a
  `compliance_flag` exists.
- **Chain integrity** — party A signs, document is amended, party B's signing attempt returns
  `409 DOCUMENT_AMENDED`.
- **Public route limits** — the verify and sign limiters return 429 at their configured ceiling.

Coverage: `jest.config.js` gates on **functions at 13%**, deliberately (see its own comment). Do not
raise it as a side effect of this programme; do not let these modules drag it down.

### 3.11 Internationalisation

FR and EN, matching `kit.js` (`t({fr, en}, cfg.language)`). Everything a counterparty reads —
the signing page, the five preset cards, the OTP email, the verification portal, the Certificate of
Completion — is bilingual. The party's language resolves from `client_master` preferred language
where set, else the tenant default, else FR (this is a Cameroonian product; FR is the safer default).

---

## 4. PR-1 — Signature core

**Ships:** the schema that replaces the `0410` stub, the canonical-payload registry, the two-axis
tier model with its preset catalogue, the eligibility funnel, internal signing, token minting, and
staleness detection. No public surface, no OTP, no QR yet.

**Merges alone.** Everything else builds on this schema.

### 4.1 Scope

| In | Out |
| --- | --- |
| `document_signature` rewritten; `signature_preset`; `signature_policy` settings section | Anything public-facing (PR-2) |
| `canonical.js` + golden digests for 8 doc types | External signing, OTP, chains (PR-3) |
| `tokens.js` — mint + HMAC lookup | The QR image itself (PR-2) |
| `presets.js` — the four-level funnel | Tier 3, Tier 4 |
| Internal signing (session identity, `SES`) + revoke | Step-up OTP (PR-3, needs the OTP service) |
| Staleness recompute + `compliance_flag` on amendment | The Certificate of Completion (PR-3) |
| Replacing `client/src/features/vault/signatures.tsx` | |

### 4.2 Migrations

**`10740_signature_core.sql`** — the new signature table.

The `0410` table is replaced, not extended: it has no verify token, no party, no assurance level and
no payload version, and it holds no production rows worth preserving in any tenant (verify with the
`-- VERIFY` block before running).

```sql
-- Drop the 0410 stub. Guarded: only if empty, so a tenant that HAS used it fails
-- loudly here rather than silently losing rows.
DO $$
DECLARE n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = current_schema() AND table_name = 'document_signature') THEN
    EXECUTE 'SELECT count(*) FROM document_signature' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'document_signature holds % row(s). Migrate them before running 10740 — see guide §4.2.', n;
    END IF;
    EXECUTE 'DROP TABLE document_signature';
  END IF;
END $$;

CREATE TABLE document_signature (
  signature_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- what was signed
  entity_ref        text NOT NULL,
  doc_type          text NOT NULL,
  document_vault_id uuid REFERENCES document_vault(doc_id),

  -- the two hashes (Q2 = C)
  payload_version   integer NOT NULL DEFAULT 1,
  content_hash      text NOT NULL,   -- sha256 of the canonical BUSINESS payload — recomputable
  artifact_hash     text,            -- sha256 of the vaulted PDF bytes — frozen, NULL until rendered

  -- the two axes (Q1 = C). assurance_level records evidence COLLECTED, never requested (§1.3(b)).
  assurance_level   text NOT NULL CHECK (assurance_level IN ('SES','AES_OTP','QES','WET')),
  visual_mark       text NOT NULL CHECK (visual_mark IN ('STAMP','TYPED','DRAWN','UPLOAD','PROVIDER','INK')),
  preset_code       text,            -- the card the signer picked; NULL for system-recorded acts

  -- who signed
  party             text NOT NULL CHECK (party IN ('INTERNAL','EXTERNAL')),
  signer_user_id    uuid REFERENCES app_user(user_id),   -- INTERNAL only, session-resolved
  signer_name       text NOT NULL,   -- snapshot at signing time; never re-read from the user record
  signer_role       text,
  signer_email      text,
  signature_request_id uuid,         -- FK added in 10746 (PR-3); NULL for direct internal signing

  -- the mark itself
  mark_image_b64    text,            -- DRAWN / UPLOAD only. NULL for STAMP / TYPED / PROVIDER / INK.
  mark_text         text,            -- TYPED only.

  -- verification credentials (Q10, Q11) — HMAC only, no plaintext (§3.7)
  verify_token_hmac text NOT NULL,
  verify_code_hmac  text NOT NULL,

  -- evidence
  signed_at         timestamptz NOT NULL DEFAULT now(),
  ip                inet,
  user_agent        text,
  otp_challenge_id  uuid,            -- FK added in 10748 (PR-3)

  -- revocation: never delete a row, so an old printed QR keeps answering "revoked"
  revoked_at        timestamptz,
  revoked_by        uuid REFERENCES app_user(user_id),
  revoke_reason     text,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_sig_token ON document_signature(verify_token_hmac);
CREATE UNIQUE INDEX uq_sig_code  ON document_signature(verify_code_hmac);
CREATE INDEX ix_sig_entity ON document_signature(entity_ref, signed_at DESC);
CREATE INDEX ix_sig_doc    ON document_signature(document_vault_id);
CREATE INDEX ix_sig_signer ON document_signature(signer_user_id);

-- INTERNAL signatures must carry a resolved user; EXTERNAL must not (the party
-- is not an app_user). Enforced here so no service can get it wrong.
ALTER TABLE document_signature ADD CONSTRAINT ck_sig_internal_user
  CHECK ((party = 'INTERNAL' AND signer_user_id IS NOT NULL)
      OR (party = 'EXTERNAL' AND signer_user_id IS NULL));

-- A drawn/uploaded mark needs an image; a typed mark needs text. Cheap, and it
-- stops a half-recorded signature reaching the portal.
ALTER TABLE document_signature ADD CONSTRAINT ck_sig_mark_payload
  CHECK ((visual_mark IN ('DRAWN','UPLOAD') AND mark_image_b64 IS NOT NULL)
      OR (visual_mark = 'TYPED' AND mark_text IS NOT NULL)
      OR (visual_mark IN ('STAMP','PROVIDER','INK')));
```

**`10741_signature_presets.sql`** — the catalogue (§3.3), seeded with the five cards.

```sql
CREATE TABLE signature_preset (
  preset_code      text PRIMARY KEY,
  label_en         text NOT NULL,
  label_fr         text NOT NULL,
  blurb_en         text,             -- one line shown under the card
  blurb_fr         text,
  assurance_level  text NOT NULL,
  visual_mark      text NOT NULL,
  assurance_rank   smallint NOT NULL,   -- SES 1 · AES_OTP 2 · WET 2 · QES 3 (§1.3(c))
  tier_label       text,                -- "1".."4" — the vocabulary the team says out loud
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       smallint NOT NULL DEFAULT 0
);

INSERT INTO signature_preset
  (preset_code, label_en, label_fr, assurance_level, visual_mark, assurance_rank, tier_label, sort_order)
VALUES
  ('STAMP',     'Company stamp',         'Cachet de l''entreprise',  'AES_OTP','STAMP',   2,'1',10),
  ('TYPED',     'Type your name',        'Saisir votre nom',         'AES_OTP','TYPED',   2,'1',20),
  ('DRAWN',     'Draw your signature',   'Dessiner votre signature', 'AES_OTP','DRAWN',   2,'2',30),
  ('CERTIFIED', 'Certified signature',   'Signature certifiée',      'QES',    'PROVIDER',3,'3',40),
  ('PRINT_SIGN','Print and sign by hand','Imprimer et signer',       'WET',    'INK',     2,'4',50)
ON CONFLICT (preset_code) DO NOTHING;
```

Blurbs are left NULL here on purpose — they are signer-facing copy and belong to you (§1.4(a)).
The signing page falls back to the label alone until they are filled.

**`10742_signature_policy_seed.sql`** — the tenant menu (funnel level 2), seeded per doc type into
the existing settings mechanism (`shared/config/settings.js`, section `signature_policy`,
key = docType). Seed conservatively: `STAMP`, `TYPED`, `DRAWN` on for every signable type;
`CERTIFIED` and `PRINT_SIGN` **off** until their PRs ship and their flags are enabled.

**`10743_signature_events.sql`** — event-type rows so `emitEvent` resolves a category and the
notification fan-out works:
`signature.signed`, `signature.revoked`, `signature.amended`, `signature.stale_detected`.
None is `is_security_critical` — they are business events, not RBAC changes.

### 4.3 Backend layout

```
src/services/signatures/
  canonical.js     → per-doc-type payload builders + hash() + version dispatch  (§3.6)
  tokens.js        → mintToken(), mintCode(), hmac(), lookupByToken(), lookupByCode()  (§3.7)
  presets.js       → catalogue read, resolveMenu() (the four-level funnel), rankOf()  (§3.4)
src/modules/vault/document_signature/
  document_signature.repo.js        (rewritten)
  document_signature.service.js     (rewritten)
  document_signature.controller.js  (rewritten)
  document_signature.routes.js      (rewritten)
  document_signature.validator.js   (rewritten)
  document_signature.events.js      (rewritten)
  document_signature.ai.js          (rewritten — reads free, sign stays confirm:true)
```

`document_vault.types.js` gains two fields per doc type: `signable: true|false` and
`{ minRank, maxRank }` — the funnel's level 1 ceiling (§3.4).

### 4.4 Endpoints

All under `/api/tenant`, gated `authMiddleware` + `requirePermission("MOD-64", …)`.

| Method | Path | Perm | Purpose |
| --- | --- | --- | --- |
| `GET` | `/signatures?entity_ref=` | `view` | Signatures on a document, each with a live `status` (§4.5) |
| `GET` | `/signatures/:id` | `view` | One signature + its evidence summary |
| `GET` | `/signatures/:id/document` | `view` | Stream the vaulted artifact (§1.3(e)) |
| `POST` | `/signatures/internal` | `approve` | Sign a document as the session user |
| `POST` | `/signatures/:id/revoke` | `approve` | Revoke, with a reason |
| `GET` | `/signatures/menu?doc_type=&entity_ref=` | `view` | The resolved menu for this doc (funnel levels 1–2) |

`POST /signatures/internal` body: `{ entity_ref, doc_type, preset_code }`. **Nothing about the
signer comes from the body** — name, role and user id are resolved from `req.user` server-side.
A body carrying `signer_name` is rejected `422`, not ignored: silently dropping it would let a
caller believe it had been honoured.

### 4.5 Backend behaviour

**Signing (internal).** In one transaction:
1. Load the record for `entity_ref`; `404` if absent.
2. `presets.resolveMenu()` → reject `422 PRESET_NOT_ALLOWED` if `preset_code` is outside it.
3. `canonical.hash(docType, doc)` → `content_hash`. Throws `422 NO_CANONICAL_PAYLOAD` for an
   unregistered type.
4. Resolve identity from `req.user`. Snapshot `signer_name` / `signer_role` **as they are now** — a
   later rename or a departure must not rewrite a document that has already left the building.
5. Mint token + code, store HMACs only.
6. Insert; `assurance_level = 'SES'` (PR-3 raises this to `AES_OTP` when a step-up OTP is verified).
7. `emitEvent(signature.signed)` + `audit()` to `immutable_ledger`.
8. Enqueue a re-render so the PDF carries the QR (PR-2 wires this; in PR-1 it is a no-op hook).

**Status resolution — this is the staleness mechanism (Q5 = C).** Every read recomputes:

```js
function statusOf(sig, liveDoc) {
  if (sig.revoked_at) return "REVOKED";
  const now = canonical.hash(sig.doc_type, liveDoc, sig.payload_version);
  if (now !== sig.content_hash) return "AMENDED";     // signed, then the document changed
  return "VALID";
}
```

`AMENDED` is **loud**, not silent — that is the whole of Q5 = C. On the first read that detects it:
- raise a `compliance_flag` (`rule_key = 'signature.amended_after_signing'`, severity `RED`),
- `emitEvent(signature.amended)` so the signer is notified,
- record `audit()` with both hashes.

Guard the side effects with an advisory lock keyed on the signature id so two concurrent reads raise
one flag, not two.

> **MUST NOT** delete or overwrite a signature row, ever — not on revoke, not on amendment. The
> whole audit value is that "who attested to which exact figures, and when" survives every later
> edit. Revocation sets `revoked_at`; amendment changes nothing on the row at all (it is derived).

**Revocation.** Sets `revoked_at / revoked_by / revoke_reason`. The public portal (PR-2) answers
`200` with a revoked verdict — **never 404** — so someone holding an old printed PDF cannot claim
the link is merely broken.

### 4.6 Frontend

`client/src/features/vault/signatures.tsx` is **rewritten**, not extended. The current page (type an
entity ref, type a signer name, pick DIGITAL or PHYSICAL) contradicts every rule in §3 — it takes
the signer's name from a form field.

- A signature list per document: preset card, signer, timestamp, and a `StatusPill` of
  `VALID / AMENDED / REVOKED` using the existing pill component.
- A **Sign** action opening a modal that renders the resolved menu as cards (`GET /signatures/menu`)
  — the same card component PR-3 reuses on the public signing page, built here once.
- `AMENDED` renders a `Callout` naming what changed and when, not a bare red pill.
- No signer-name input. Anywhere.

### 4.7 Acceptance criteria

1. `POST /signatures/internal` with `signer_name` in the body returns `422`.
2. Signing an invoice, then changing a line's quantity, makes `GET /signatures?entity_ref=` report
   `AMENDED` and creates exactly one `compliance_flag`.
3. Re-reading the amended signature does **not** create a second flag.
4. Revoking returns the row with `revoked_at` set; the row still exists and still lists.
5. A preset outside the resolved menu returns `422 PRESET_NOT_ALLOWED`.
6. An unregistered doc type returns `422 NO_CANONICAL_PAYLOAD`.
7. `verify_token_hmac` and `verify_code_hmac` are unique; no plaintext token column exists anywhere
   in the schema (`grep` the migration; the reviewer checks this by eye).
8. `npm run ci` green.

### 4.8 Tests

`tests/unit/signature-canonical.test.js` — **the golden digest test.** One fixed input per doc type
pinned to a literal sha256, with a comment saying what a failure means and what to do about it.

`tests/unit/signature-tokens.test.js` — mint → HMAC → lookup round-trip; a wrong pepper does not
match; a missing `SIGNATURE_TOKEN_PEPPER` fails fast at boot rather than minting unpeppered rows.

`tests/unit/signature-presets.test.js` — table-driven over the funnel: ceiling, tenant menu, sender
narrowing, empty-menu error.

`tests/unit/signature-staleness.test.js` — sign, mutate, assert `AMENDED` + one flag + idempotence.

`tests/db/signature-constraints.test.js` — `ck_sig_internal_user` and `ck_sig_mark_payload` reject
their bad shapes at the database, not just in the validator.

### 4.9 Task list

1. `10740`–`10743` migrations, each with a `-- VERIFY` block.
2. `canonical.js` + the eight builders + golden fixtures.
3. `tokens.js` + the pepper env var, wired into `src/config/env.js` as **required**.
4. `presets.js` + `document_vault.types.js` ceiling fields.
5. Rewrite the six `document_signature.*` files.
6. Rewrite `signatures.tsx`; build the preset-card component PR-3 will reuse.
7. Tests per §4.8.
8. Delete nothing else yet — `document_verification` is PR-2's to replace.

---

## 5. PR-2 — Verification portal

**Ships:** a real QR on every rendered document, a public branded verification portal, per-doc-type
live summaries, and the scan log with its notification and anomaly signal. This is the PR that
closes both structural defects from the questionnaire.

### 5.1 Scope

| In | Out |
| --- | --- |
| QR + short code rendered into the PDF, server-side | External signing (PR-3) |
| `/public/verify/:token` and `/public/verify/code/:code` | The Certificate of Completion (PR-3) |
| Per-doc-type summary resolvers (Q12 = C) | The wet-signature DataMatrix (PR-5) — different code, different payload |
| `signature_scan` + notification + anomaly signal | |
| Deleting `praxis://` and the prefix-match finding | |

### 5.2 The two defects, closed

**Defect 1 — the hash could not be printed on the document it described.** Solved by PR-1: the QR
now carries `verify_token`, minted **before** rendering, and the portal resolves the signature row
and recomputes the canonical hash from live data. `artifact_hash` is written back after rendering
(`pdf.service.renderAndStore` already computes it) and is reported as a second, separate verdict.

**Defect 2 — `praxis://` and no QR image.**
- `src/services/documents/templates/kit.js` — `footer()` stops printing the raw verify string.
- A new `kit.verifyBlock({ url, code, qrSvg }, cfg)` renders the QR as **inline SVG** next to the
  short code. Inline SVG, not a data-URI `<img>`: Puppeteer rasterises it at print resolution, and
  it costs no extra request under the CSP.
- `src/modules/documents/template/template.service.js` stops passing `praxis://verify/${entityRef}`
  and passes the resolved `https://` URL + code + pre-rendered QR SVG.
- `qrcode` (npm) generates the SVG server-side. **Pin the version at implementation time** — do not
  copy a version number out of this guide.

**The two lesser findings, also closed here:**
- `document_verification.service.js`'s `stored.startsWith(hash)` prefix match is **deleted**. Lookup
  is now an exact HMAC index match. There is no prefix path and no `min(4)` anywhere.
- The public routes get `makeLimiter` — `proposal_public.routes.js` is the precedent:
  `{ name: "signature-verify", max: 60, windowMs: 15*60*1000 }`, keyed on IP. This limiter is what
  makes the 2⁶⁰ short code safe to type (§3.7); it is load-bearing.

### 5.3 Migrations

**`10744_signature_scan.sql`**

```sql
CREATE TABLE signature_scan (
  scan_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_id  uuid NOT NULL REFERENCES document_signature(signature_id) ON DELETE CASCADE,
  scanned_at    timestamptz NOT NULL DEFAULT now(),
  ip            inet,              -- personal data. Retention: settings signature_policy.scan_retention_days
  user_agent    text,
  referrer      text,
  via           text NOT NULL CHECK (via IN ('QR','CODE')),
  is_new_ip     boolean NOT NULL DEFAULT false
);
CREATE INDEX ix_scan_sig  ON signature_scan(signature_id, scanned_at DESC);
CREATE INDEX ix_scan_window ON signature_scan(signature_id, scanned_at);
```

**`10745_signature_portal_events.sql`** — `signature.scanned_new_ip`, `signature.scan_anomaly`.

### 5.4 The portal (Q12 = C)

`basePath: "/public/verify"`, `feature: "signatures.portal"`, no auth, rate-limited, and — following
`proposal_public.routes.js` — **pinned to live**: `req.tenantDbIn("live", …)`. A visitor must not be
able to send `X-Praxis-Env: sandbox` and read sandbox rows.

Three states, answered explicitly and never conflated (Bureau LPC's rule, and it is a good one):

| State | HTTP | Shown |
| --- | --- | --- |
| unknown | `404` | A generic "no such verification" page. **Never** distinguishes malformed from never-existed. |
| revoked | `200` | Plainly revoked, with the original signer and date still visible, plus the reason. |
| valid | `200` | The full summary below. |

The page renders **two verdicts on separate lines**, which is what Q2 = C bought:

```
Content        ✓ This document still says what was signed.       (content_hash recomputed = match)
Artifact       ✓ This file is the exact one we issued.           (artifact_hash = the vaulted bytes)
```

…and when the first fails: *"Signed on 3 March 2026, then modified on 11 March 2026. The signature
below no longer covers the current contents."* — Q5 = C, surfaced where it matters.

**Per-doc-type summaries.** A resolver registry keyed by doc type, sitting beside `DOC_TYPES` in
`document_vault.types.js` so a new signable type cannot be added without someone seeing the summary
slot. Each returns `{ title, fields: [{label, value}], detail? }`:

- `FINAL_INVOICE` → reference, counterparty, total TTC, **line-item count**
- `DELIVERY_NOTE` → reference, counterparty, item count, delivery date
- `PURCHASE_ORDER` → reference, supplier, total
- `EMPLOYMENT_CONTRACT` → reference, role, start date, **core clause headings** (headings only —
  never clause bodies)
- `QUOTATION` / `PROPOSAL` → reference, counterparty, total, validity date

Plus, always: signer name and role, the preset card they used, the assurance level in plain words
("verified by email code" / "certified by a third party" / "signed by hand and reconciled"), the
timestamp, and the tenant's legal block (`legal_name`, RCCM, NIU, address) so a reader can reach the
company directly.

> **MUST NOT** render an unregistered doc type's raw record as a fallback summary. An unknown type
> shows the verdict and the signer only. A fallback that dumps whatever columns exist is exactly how
> a disclosure decision gets made by accident.

**The anti-fraud modal** you asked for in the brief: a "How this is verified" link opening a plain
explanation of the three mechanisms — **Identity** (who signed and how they proved it), **Integrity**
(the two hashes), **Traceability** (the audit trail and this scan). Written for an auditor, not an
engineer. Bilingual.

**The privacy notice** (Q13): one line in the portal footer — *"Verifications of this document are
logged, including the network address they came from."* Retention comes from
`signature_policy.scan_retention_days`, default 400 days; a scheduler prunes past it.

### 5.5 Scan logging, notification and anomaly (Q13 = C)

On every successful resolve, in the request path:
1. Insert a `signature_scan` row.
2. `audit()` to `immutable_ledger` — the tamper-evident copy. Both writes, deliberately: the ledger
   is append-only and is the evidentiary record; `signature_scan` is the queryable projection that
   supports the window query below. Scans are rare; two writes are not a concern.
3. If no prior scan from this IP exists for this signature, set `is_new_ip` and emit
   `signature.scanned_new_ip` → the document owner is notified. **Default off per tenant**
   (`signature_policy.notify_on_scan`), because for a tenant issuing hundreds of delivery notes this
   is noise.
4. Anomaly: more than `scan_anomaly_threshold` (default 25) scans in one rolling hour on a single
   signature emits `signature.scan_anomaly` at `HIGH`. A document being verified forty times in an
   hour is either under audit or being shopped around, and both are worth knowing.

### 5.6 Analytics (addition h, thin)

`GET /signatures/stats` (MOD-64 `view`): median time-to-sign, count by status, count by preset,
stale count by doc type, scans in the last 30 days. One card on the vault hub. It exists so a broken
OTP path shows up as a metric before it shows up as a support ticket.

### 5.7 Frontend

- `client/src/features/public/verify-page.tsx` — **new**, mounted at `/public/verify/:token` and
  `/public/verify` (manual code entry). Follows `app.tsx`'s existing `/public/*` grouping, which
  mirrors the API namespace.
- `client/src/features/vault/verification.tsx` — **deleted** (addition i). Its "paste a hash" flow
  describes a mechanism this programme removes. The internal view it half-served becomes a tab on
  the signature detail: who scanned this, when, from how many distinct addresses.

### 5.8 Acceptance criteria

1. A rendered invoice PDF contains a **scannable** QR resolving to `https://…/public/verify/{token}`,
   with the short code printed beneath it.
2. `grep -r "praxis://" src/` returns nothing.
3. An unknown token returns `404` with an identical body for malformed and never-existed inputs.
4. A revoked signature returns `200` and the page says revoked, with the original signer visible.
5. An amended document's portal page shows the content verdict failing and the artifact verdict
   passing, with the amendment date.
6. The 61st verify request from one IP inside the window returns `429`.
7. `X-Praxis-Env: sandbox` against a public verify route reads **live**, not sandbox.
8. Scanning twice from the same IP produces two `signature_scan` rows and exactly one
   `signature.scanned_new_ip` event.

### 5.9 Task list

1. `10744`, `10745`.
2. Add `qrcode`; `kit.verifyBlock()`; delete the footer verify string.
3. Thread the resolved URL + code + QR SVG through `template.service.js`.
4. Rewrite `document_verification.*` → `basePath: "/public/verify"`, exact HMAC lookup, limiter,
   `tenantDbIn("live")`.
5. Summary resolver registry + the six V1 resolvers.
6. `signature_scan` write path, notification, anomaly job.
7. `verify-page.tsx`; delete `verification.tsx`.
8. `/signatures/stats` + the hub card.
9. Tests per §3.10.

---

## 6. PR-3 — Signing sessions, OTP and the signer menu

**Ships:** signature requests, ordered parties, the on-file/override rule, email OTP, the public
signing page where the signer picks their card, decline-with-reason, reminders, and the Certificate
of Completion.

This is the largest chapter and the one that carries the most of your answers: Q1, Q6, Q7, Q8, Q9,
Q16 and — because Q3 removed the seal — Q3's replacement evidence model.

### 6.1 Scope

| In | Out |
| --- | --- |
| `signature_request`, `signature_party`, `signature_otp` | Tier 3 dispatch (PR-4) — the `CERTIFIED` card is rendered disabled here |
| Sequential chains with at most one attributed override | Tier 4 (PR-5) — the `PRINT_SIGN` card is likewise disabled |
| Email OTP: 10 min / 5 attempts / 3 resends / 30-min cooldown | Batch signing, offline capture _(v2)_ |
| The public signing page + preset cards | |
| Decline with reason; reminders at D+2 / D+5 | |
| Step-up OTP for internal signers above a threshold (Q9 = C) | |
| **The Certificate of Completion** | |

### 6.2 Migrations

**`10746_signature_request.sql`**

```sql
CREATE TABLE signature_request (
  request_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_ref       text NOT NULL,
  doc_type         text NOT NULL,
  document_vault_id uuid REFERENCES document_vault(doc_id),

  -- Snapshotted at creation. Every signing act re-derives and compares (§1.3(a)).
  payload_version  integer NOT NULL DEFAULT 1,
  content_hash     text NOT NULL,

  -- Funnel level 3 (Q16): the sender's narrowing of the tenant menu.
  allowed_presets  text[] NOT NULL,

  status           text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','SENT','PARTIALLY_SIGNED','COMPLETED',
                                       'DECLINED','EXPIRED','AMENDED','VOIDED')),
  message          text,                       -- optional note shown to every party
  expires_at       timestamptz,
  completed_at     timestamptz,

  created_by       uuid NOT NULL REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sigreq_entity ON signature_request(entity_ref);
CREATE INDEX ix_sigreq_open   ON signature_request(status) WHERE status IN ('SENT','PARTIALLY_SIGNED');
CREATE TRIGGER trg_sigreq_updated BEFORE UPDATE ON signature_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Back-link from PR-1's table.
ALTER TABLE document_signature
  ADD CONSTRAINT fk_sig_request FOREIGN KEY (signature_request_id)
  REFERENCES signature_request(request_id);
```

**`10747_signature_party.sql`** — the chain, and the Q7 constraint.

```sql
CREATE TABLE signature_party (
  party_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL REFERENCES signature_request(request_id) ON DELETE CASCADE,
  sequence_no      smallint NOT NULL,          -- 1, 2, 3 … signing order
  party_kind       text NOT NULL CHECK (party_kind IN ('ISSUER','COUNTERPARTY','WITNESS')),

  -- Q7: where this address came from. ON_FILE is pulled from the tenant's own
  -- records; OVERRIDE is typed by a tenant user and is attributed to them.
  source           text NOT NULL CHECK (source IN ('ON_FILE','OVERRIDE')),
  source_ref       text,                       -- 'client_contact:<uuid>' | 'app_user:<uuid>' for ON_FILE
  override_by_user_id uuid REFERENCES app_user(user_id),
  override_reason  text,

  full_name        text NOT NULL,
  party_role       text,
  email            citext NOT NULL,
  language         text CHECK (language IN ('fr','en')),

  allowed_presets  text[] NOT NULL,            -- funnel level 4, defaulted from the request
  status           text NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','SENT','VIEWED','SIGNED','DECLINED','EXPIRED')),
  decline_reason   text,

  -- The signing-link credential. A DIFFERENT secret from the verify token (§3.7).
  sign_token_hmac  text NOT NULL,
  sign_expires_at  timestamptz NOT NULL,

  sent_at          timestamptz,
  viewed_at        timestamptz,
  settled_at       timestamptz,                -- signed or declined
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_sigparty_token ON signature_party(sign_token_hmac);
CREATE UNIQUE INDEX uq_sigparty_seq   ON signature_party(request_id, sequence_no);
CREATE INDEX ix_sigparty_open ON signature_party(request_id, status);

-- Q7, enforced by the DATABASE and not merely the validator: at most ONE
-- manually-entered signatory per request.
CREATE UNIQUE INDEX uq_sigparty_one_override
  ON signature_party(request_id) WHERE source = 'OVERRIDE';

-- An OVERRIDE must name who authorised it. An ON_FILE party must not.
ALTER TABLE signature_party ADD CONSTRAINT ck_sigparty_override_attributed
  CHECK ((source = 'OVERRIDE' AND override_by_user_id IS NOT NULL)
      OR (source = 'ON_FILE'  AND override_by_user_id IS NULL));
```

**`10748_signature_otp.sql`**

```sql
CREATE TABLE signature_otp (
  otp_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id      uuid REFERENCES signature_party(party_id) ON DELETE CASCADE,
  user_id       uuid REFERENCES app_user(user_id),      -- internal step-up (Q9 = C)
  entity_ref    text NOT NULL,
  content_hash  text NOT NULL,     -- binds the code to ONE payload (§6.4)
  sent_to       citext NOT NULL,   -- the address actually used, for the certificate
  code_hash     text NOT NULL,     -- sha256(code). Compared in constant time.
  attempts      smallint NOT NULL DEFAULT 0,
  resends       smallint NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  cooldown_until timestamptz,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_otp_party ON signature_otp(party_id, created_at DESC);
ALTER TABLE signature_otp ADD CONSTRAINT ck_otp_subject
  CHECK (num_nonnulls(party_id, user_id) = 1);

ALTER TABLE document_signature
  ADD CONSTRAINT fk_sig_otp FOREIGN KEY (otp_challenge_id) REFERENCES signature_otp(otp_id);
```

**`10749_signature_certificate_doctype.sql`** — registers `SIGNATURE_CERTIFICATE` as a doc type
(module `vault/signature_certificate`, `moduleKey` MOD-64) plus its event rows.

### 6.3 Parties: on-file, and the one override (Q7)

**Level 1 — on-file (the A-side).** When a request is created, candidate parties are pulled from the
tenant's own records: `client_master` contacts for the counterparty, `app_user` for internal
signatories, the dossier contact where the doc type has one. The UI presents them; the sender orders
them. `source = 'ON_FILE'`, `source_ref` records exactly which row it came from.

**Level 2 — the override (the B-side).** The sender may add **one** additional signatory by typing a
name, role and email — the client's Managing Director who is not in the CRM. `source = 'OVERRIDE'`,
`override_by_user_id = req.user.user_id`, `override_reason` required. Requires MOD-64 `edit`.

The cap is a partial unique index (`uq_sigparty_one_override`), so a second override fails at the
database. A validator check is *also* present for the friendly error, but the constraint is what
makes the rule true.

**Level 3 — never the signer.** Q7 = C is forbidden. There is **no** code path anywhere in this
programme where a signer supplies the address their own OTP is sent to. The signing page renders the
address read-only, masked (`j••••@acme.cm`), so the signer can confirm it is theirs but cannot
change it. If it is wrong, the request is reissued by the sender — which is exactly the audit
behaviour you want.

**Assurance consequence.** A party whose address is `ON_FILE` can reach `AES_OTP`. A party whose
address is `OVERRIDE` **also** reaches `AES_OTP`, because a tenant user with `edit` has attested to
it and that attestation is recorded and shown. The portal and the certificate state which it was,
in words: *"verified by email code sent to an address on file"* versus *"verified by email code sent
to an address provided by {user} on {date}"*. The reader gets to weigh it; the system does not
pretend the two are identical.

### 6.4 OTP (Q6 = A, Q8 = B)

Six digits, delivered by `email.service.send` with `purpose: "DOCUMENTS"`, `moduleKey: "MOD-64"`,
`entityRef` set — so it flows through the tenant's configured documents sender and lands in
`email_send_log` like every other system mail.

| Rule | Value |
| --- | --- |
| Lifetime | **10 minutes** |
| Attempts | **5**, then the challenge is dead |
| Resends | **3** per party, then a **30-minute** cooldown |
| At rest | `sha256(code)`, compared with `crypto.timingSafeEqual` |
| Binding | `(party_id, entity_ref, content_hash)` |

> **MUST.** The `content_hash` binding is not optional. Without it a code issued for one document
> could be replayed against another in the same request window. A code verifies **one payload**.

Rate limiting sits in front of the OTP endpoints as well as inside them
(`makeLimiter({ name: "signature-otp", max: 10, windowMs: 15*60*1000 })`), keyed on the signing token
rather than IP — a counterparty behind a corporate NAT must not be limited by a colleague.

The email states plainly what the code authorises: *"This code signs {document} for {counterparty}.
It expires in 10 minutes. If you did not expect this, do not enter it and reply to this message."*
No branding-only email that leaves the reader unsure what they are approving.

### 6.5 Internal step-up (Q9 = A + C)

Baseline is unchanged from PR-1: identity is session-resolved, never from the body.

Above a threshold the internal signer must also clear an OTP to **their own `app_user.email`**:

```
signature_policy.stepup_enabled          default false
signature_policy.stepup_threshold_xaf    default null
```

Default off, per your answer. When on, the threshold compares against the document's total in XAF
(via the existing FX helper for foreign-currency documents). A cleared step-up records
`assurance_level = 'AES_OTP'` on the internal signature and links `otp_challenge_id` — which is
§1.3(b) working exactly as intended: the same preset yields a different recorded level depending on
what was actually proved.

### 6.6 The public signing page (Q1, Q16)

`basePath: "/public/sign"`, `feature: "signatures.external"`, no auth, rate-limited, pinned to live.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/public/sign/:token` | The document summary, the party's identity, and **the resolved menu** |
| `POST` | `/public/sign/:token/otp` | Send (or resend) the code |
| `POST` | `/public/sign/:token/verify` | Verify the code |
| `POST` | `/public/sign/:token/complete` | Submit the chosen preset + its mark |
| `POST` | `/public/sign/:token/decline` | Decline, with a reason |
| `GET` | `/public/sign/:token/document` | Stream the PDF being signed |

**The menu is the point.** `GET /public/sign/:token` returns the party's `allowed_presets` resolved
server-side through all four funnel levels, each as a card with its label, blurb and tier. The
signer picks. Cards for presets whose PR has not shipped, or whose flag is off, render **disabled
with a reason** rather than being hidden — a counterparty who was told "you can sign by hand" should
see why that option is greyed out, not wonder whether the page is broken.

Per Q1, every completion path passes through verification: `STAMP`, `TYPED` and `DRAWN` all require
a verified OTP before `/complete` will accept. `CERTIFIED` hands off to the provider (PR-4), which
does its own identity check. `PRINT_SIGN` issues a print job (PR-5) and settles out of band.

> **MUST.** `/complete` re-derives the canonical hash and compares it to
> `signature_request.content_hash`. Mismatch → `409 DOCUMENT_AMENDED`, the request moves to
> `AMENDED`, every already-signed party is notified, a `compliance_flag` is raised. This is §1.3(a),
> and it is what stops party B signing something party A never saw.

**Chain advance.** On a successful `/complete`, in one transaction: write the `document_signature`
row, settle the party, and either dispatch the next `sequence_no` or — if none remains — set the
request `COMPLETED` and enqueue the certificate (§6.7). A decline settles the party `DECLINED`, sets
the request `DECLINED`, and notifies the creator with the reason. **A decline does not silently
cancel** the earlier signatures; they remain valid records of what those parties attested to.

**Frontend:** `client/src/features/public/sign-page.tsx`. Mobile-first — the counterparty is on a
phone. The drawn-mark pad is a `<canvas>` with pointer events, exporting PNG; cap the stored
data-URL at 200 KB and downscale before upload. Reuse the preset-card component built in PR-1 §4.6.

### 6.7 The Certificate of Completion — the evidence model (Q3 = A)

**Read §2.2 before this section.** With no PAdES seal, this document and the `immutable_ledger`
trail are the *entire* evidentiary case. Build it to that standard.

Generated on the final party's signature, as doc type `SIGNATURE_CERTIFICATE`, rendered through the
existing template pipeline, captured into `document_vault`, and hashed like any other artifact.

It **MUST** contain, in this order:

1. **Document identity** — doc type, number, `entity_ref`, vault `doc_id`, the **full**
   `content_hash` and `artifact_hash` (not truncated), and the payload version.
2. **Every party** — name, role, email, `source` (on-file or override) and, for an override, who
   authorised it, when, and their stated reason.
3. **Every signing act** — server timestamp in UTC *and* the tenant's timezone, IP, user agent, the
   preset chosen, the `visual_mark`, and the `assurance_level` **actually achieved**.
4. **OTP evidence per act** — challenge id, the address the code was sent to, sent-at, verified-at,
   and how many attempts it took. This is the identity proof; it is the part a dispute turns on.
5. **The event timeline** — every `signature.*` row from `immutable_ledger` for this request,
   in order, with correlation ids.
6. **Verification instructions** — the portal URL and the short code, so a reader can re-check it
   independently a decade from now.
7. **The tenant's legal identity** — `legal_name`, RCCM, NIU, address.

It is bilingual, it is generated once, and it is immutable — a regenerated certificate would produce
different bytes and a different hash, so `signature-certificate` is idempotent on `request_id` and
returns the existing vault row if one exists.

> **MUST NOT** ship PR-3 without the certificate. Every other part of this programme degrades
> gracefully if it is missing; this one is the deliverable that Q3 = A depends on.

### 6.8 Reminders (addition d)

`signature-reminder-scheduler` (BullMQ, hourly) finds parties `SENT`/`VIEWED` for more than 2 days
and again at 5 days, and enqueues `signature-reminder`. Two nudges maximum, then silence — a third
email teaches people to filter you. Reminders stop on any settlement and on request expiry.
`signature_policy.reminder_days` (default `[2, 5]`) makes it a setting; `[]` disables it.

### 6.9 Acceptance criteria

1. Creating a request with two `OVERRIDE` parties fails at the **database** constraint.
2. An `OVERRIDE` party without `override_by_user_id` fails at the check constraint.
3. The signing page never renders a writable email field, and `POST /complete` ignores any address
   in the body.
4. A code from request A cannot verify against request B (the `content_hash` binding).
5. Six wrong attempts: the sixth returns `429`/`410`, not a sixth chance.
6. Four resends: the fourth returns a cooldown error with `cooldown_until`.
7. Party A signs; the invoice total is edited; party B's `/complete` returns `409 DOCUMENT_AMENDED`,
   the request reads `AMENDED`, and party A has been notified.
8. A declined party sets the request `DECLINED` with the reason visible to the creator, and party
   A's earlier signature still reads `VALID` on the portal.
9. On final signature a `SIGNATURE_CERTIFICATE` exists in `document_vault` containing every field in
   §6.7; re-running the job returns the same `doc_id`.
10. With `stepup_enabled = true` and a threshold below the document total, internal signing requires
    an OTP and records `AES_OTP`; below the threshold it records `SES`.

### 6.10 Task list

1. `10746`–`10749`.
2. `signature_request` + `signature_party` modules (repo/service/controller/routes/validator/events).
3. `src/services/signatures/otp.js` — issue, verify, resend, cooldown, constant-time compare.
4. `vault/signature_public/` — the six public endpoints, limiter, `tenantDbIn("live")`.
5. Chain advance + decline + amendment guard.
6. `src/services/signatures/certificate.js` + its template + the `signature-certificate` job.
7. Reminder scheduler + handler.
8. Internal step-up wiring.
9. `sign-page.tsx`; extend `signatures.tsx` with the request/chain view.
10. Tests per §6.9.

---

## 7. PR-4 — Tier 3: the QES adapter and billing

**Ships:** the provider-agnostic interface, the SignWell adapter, envelope lifecycle, evidence
mirroring, metering and rebilling. **SignWell only** — no DocuSign code (Q14).

### 7.1 Scope

| In | Out _(v2)_ |
| --- | --- |
| `QesProvider` interface + resolution | DocuSign adapter |
| SignWell adapter #1 | ANTIC / local CA adapter |
| Envelope create / webhook / poll / fetch certificate | Bring-your-own-keys per tenant |
| `signature_usage_ledger`, the fee modal, rebilling | |
| Platform wallet monitoring + alerts | |

### 7.2 The interface

`src/services/qes/provider.interface.js` — documented contract, no implementation:

```js
/**
 * Every QES provider adapter implements exactly this. Adding a provider is a new
 * file here plus one settings row — never a change to a call site.
 */
module.exports = {
  key: "signwell",
  createEnvelope,     // ({ document, parties, callbackUrl, language }) → { envelopeId, partyLinks[] }
  cancelEnvelope,     // ({ envelopeId, reason }) → { cancelled: true }
  getStatus,          // ({ envelopeId }) → { status, parties: [{ email, status, signedAt }] }
  fetchSignedDocument,// ({ envelopeId }) → Buffer
  fetchAuditCertificate, // ({ envelopeId }) → Buffer   ← mirrored into our vault, §7.4
  verifyWebhook,      // ({ headers, rawBody, secret }) → boolean
};
```

**Implementation note, and treat it as binding:** the SignWell specifics — endpoint paths, the
webhook signature scheme, the exact envelope payload shape, the free-tier quota — **MUST be verified
against SignWell's current API documentation at implementation time**. They are not restated here,
because a guide that hardcodes a third party's request shape from memory is a guide that sends
someone to debug a 400 against the wrong contract. What this guide fixes is the *interface*, the
*lifecycle* and the *billing rules*; the wire format is the adapter's business.

Credentials live in the encrypted `integration_secret` settings section (AES-256-GCM), per
`doc/BUILD_CONVENTIONS.md` §7. **Never** in `.env`, never in a plain settings row.

### 7.3 Migrations

**`10750_qes_envelope.sql`**

```sql
CREATE TABLE qes_envelope (
  envelope_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        uuid NOT NULL REFERENCES signature_request(request_id) ON DELETE CASCADE,
  provider_key      text NOT NULL,
  provider_ref      text,             -- the provider's own envelope id. NULL until issued.
  status            text NOT NULL DEFAULT 'CREATING'
                      CHECK (status IN ('CREATING','SENT','COMPLETED','DECLINED','CANCELLED','FAILED')),
  audit_vault_id    uuid REFERENCES document_vault(doc_id),   -- the mirrored provider certificate
  signed_vault_id   uuid REFERENCES document_vault(doc_id),   -- the provider's signed PDF
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_qes_provider_ref ON qes_envelope(provider_key, provider_ref)
  WHERE provider_ref IS NOT NULL;
```

**`10751_signature_usage_ledger.sql`** — modelled on `ai_usage_ledger`:

```sql
CREATE TABLE signature_usage_ledger (
  usage_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id   uuid NOT NULL REFERENCES qes_envelope(envelope_id),
  request_id    uuid NOT NULL REFERENCES signature_request(request_id),
  entity_ref    text NOT NULL,
  provider_key  text NOT NULL,
  provider_ref  text NOT NULL,        -- NOT NULL: no row exists without an issued envelope id (§7.5)
  unit_fee      numeric(12,2) NOT NULL,
  currency      text NOT NULL DEFAULT 'XAF',
  billed_at     timestamptz,          -- set when it lands on an invoice
  invoice_ref   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sigusage_unbilled ON signature_usage_ledger(created_at) WHERE billed_at IS NULL;
```

**`10752_qes_events.sql`** — `qes.envelope_created`, `qes.envelope_completed`, `qes.envelope_failed`,
`qes.quota_low`.

### 7.4 Lifecycle

1. **Fee modal** (Q15). Before dispatch the UI calls `GET /signatures/qes/quote` and renders:
   *"Tier 3 third-party verification will be applied. A service fee of {fee} will be billed to your
   account on dispatch."* The fee comes from `signature_policy.qes_unit_fee` — **§1.4(b) is
   outstanding; there is no default and dispatch fails `424 CONFIG_MISSING` until it is set**, with
   a link to the settings screen (the same 424 pattern `pdf.service.renderDocType` already uses).
2. **Create.** Insert `qes_envelope` as `CREATING`. Call the adapter.
3. **Charge on issue, and only on issue.** In the same transaction that writes `provider_ref`,
   insert the `signature_usage_ledger` row. `provider_ref NOT NULL` on the ledger makes
   "charged without an envelope" unrepresentable.
4. **Provider failure** → the transaction rolls back, the envelope goes `FAILED` with `last_error`,
   **no ledger row exists**. This is Q15's rule enforced structurally rather than by remembering to
   delete a row.
5. **Webhook** → `POST /public/qes/:provider/webhook`, signature-verified via
   `provider.verifyWebhook` before the body is parsed. Advance status; on completion fetch both the
   signed PDF and the audit certificate, capture both into `document_vault`, write the
   `document_signature` row with `assurance_level = 'QES'`, `visual_mark = 'PROVIDER'`.
6. **Poll as a backstop.** `qes-poll-scheduler` every 30 minutes over non-terminal envelopes older
   than an hour. Webhooks get lost; a chain that stalls invisibly is worse than a redundant poll.
7. **Cancel.** Q15: *non-refundable once the provider ref is issued*. Cancelling sets `CANCELLED`
   and **leaves the ledger row in place**, with the certificate and billing portal both showing it
   as a dispatched-then-cancelled envelope. Do not add a refund path; that was decided.

**Evidence mirroring.** The provider's audit certificate is fetched and vaulted, not linked. A link
to a third party's dashboard is worthless in year seven when the contract has lapsed. Our own
Certificate of Completion (§6.7) references the mirrored vault copy.

### 7.5 Platform wallet monitoring (Q15)

`qes-quota-scheduler` (daily) sums envelopes created this calendar month across all tenants against
`platform.qes_monthly_quota`, and emits `qes.quota_low` at 80% and again at 95% to the platform
alert-routing service. This is a **platform-tier** concern, not a tenant one: the free-tier quota
belongs to the Praxis account, and a tenant must never see another tenant's consumption.

### 7.6 Acceptance criteria

1. Dispatch with no `qes_unit_fee` configured returns `424 CONFIG_MISSING` with a settings link.
2. A provider 5xx leaves `qes_envelope` `FAILED` and **zero** `signature_usage_ledger` rows.
3. A successful create writes exactly one ledger row, in the same transaction as `provider_ref`.
4. A webhook with a bad signature is rejected **before** the body is parsed, and logs nothing from it.
5. A replayed webhook is idempotent — one `document_signature` row, not two.
6. Completion mirrors both the signed PDF and the audit certificate into `document_vault`.
7. Cancelling after dispatch keeps the ledger row.
8. `signatures.qes` off ⇒ the `CERTIFIED` card renders disabled with a reason and `/complete`
   rejects it.

### 7.7 Task list

1. `10750`–`10752`.
2. `provider.interface.js` (documented) + `src/services/qes/index.js` resolution.
3. `signwell.adapter.js` — **verify every wire detail against current SignWell docs**.
4. Envelope service + the transactional charge rule.
5. Public webhook route + signature verification + idempotency.
6. `qes-poll` + `qes-poll-scheduler` + `qes-quota-scheduler`.
7. The fee modal and the billing view (document UUID + mirrored certificate link per Q15).
8. Tests per §7.6, with the adapter stubbed — no live API calls in CI.

---

## 8. PR-5 — Tier 4: the wet signature and reconciliation

**Ships:** a discreet DataMatrix on printed documents, three inbound routes, server-side barcode
decoding, corroborated auto-reconciliation, and an unreconciled-after-N-days compliance rule.

Per the questionnaire's §1.4, this is **not** a fallback path. It is the one where the chain of
custody is weakest and it gets a first-class state machine.

### 8.1 The state machine

```
ISSUED ──▶ PRINTED ──▶ SIGNED_ON_PAPER ──▶ SCANNED ──▶ RECONCILED
   │                          (out of band)     │           │
   └──▶ VOIDED                                  └──▶ REVIEW_QUEUE ──▶ RECONCILED
                                                       (Q19 = B)          │
                                                                     or ──▶ REJECTED
```

`SIGNED_ON_PAPER` is unobservable to us — it is inferred when a scan arrives. It exists in the enum
so the gap between `PRINTED` and `SCANNED` is nameable, which is what the compliance rule in §8.7
measures.

### 8.2 Migrations

**`10753_signature_print_job.sql`**

```sql
CREATE TABLE signature_print_job (
  print_job_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid REFERENCES signature_request(request_id) ON DELETE SET NULL,
  party_id       uuid REFERENCES signature_party(party_id) ON DELETE SET NULL,
  entity_ref     text NOT NULL,
  doc_type       text NOT NULL,
  document_vault_id uuid REFERENCES document_vault(doc_id),
  content_hash   text NOT NULL,        -- what was on the paper when it was printed

  -- The barcode payload. A DIFFERENT secret from the verify token (Q17): paper
  -- gets photocopied, and a photocopy must not hand out a verification credential.
  print_code     text NOT NULL,        -- 18 chars Crockford base32, stored in CLEAR
  reprint_of     uuid REFERENCES signature_print_job(print_job_id),
  reprint_no     smallint NOT NULL DEFAULT 0,

  status         text NOT NULL DEFAULT 'ISSUED'
                   CHECK (status IN ('ISSUED','PRINTED','SCANNED','RECONCILED','REVIEW','REJECTED','VOIDED')),
  printed_at     timestamptz,
  reconciled_at  timestamptz,
  reconciled_by  uuid REFERENCES app_user(user_id),
  scan_vault_id  uuid REFERENCES document_vault(doc_id),   -- the returned scan
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_printjob_code ON signature_print_job(print_code);
CREATE INDEX ix_printjob_open ON signature_print_job(status, created_at)
  WHERE status IN ('ISSUED','PRINTED');
```

`print_code` is stored **in clear**, unlike the verify token — deliberately. It is an internal
reconciliation key, not a credential: knowing it grants nothing except the ability to claim a
document you would also have to physically produce. Storing it clear is what makes the operator's
"find this delivery note by its printed code" search possible, which is the feature's whole point.

**`10754_signature_ingest.sql`** — the inbound queue.

```sql
CREATE TABLE signature_ingest (
  ingest_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text NOT NULL CHECK (source IN ('UPLOAD','EMAIL','MOBILE')),
  source_ref     text,                  -- email_message_id | app_user id | null
  document_vault_id uuid NOT NULL REFERENCES document_vault(doc_id),
  decoded_code   text,
  decode_status  text NOT NULL DEFAULT 'PENDING'
                   CHECK (decode_status IN ('PENDING','DECODED','NO_BARCODE','UNREADABLE','FAILED')),
  print_job_id   uuid REFERENCES signature_print_job(print_job_id),
  match_status   text NOT NULL DEFAULT 'PENDING'
                   CHECK (match_status IN ('PENDING','AUTO','REVIEW','MANUAL','REJECTED')),
  match_notes    text,
  processed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ingest_queue ON signature_ingest(match_status, created_at)
  WHERE match_status IN ('PENDING','REVIEW');
```

**`10755_signature_wet_events.sql`** — `signature.printed`, `signature.scanned_returned`,
`signature.reconciled`, `signature.reconcile_review`.

**`10756_signature_unreconciled_rule.sql`** — registers the compliance rule (§8.7) in the
`compliance_flag` catalogue.

### 8.3 The barcode — subtle and discreet (Q17)

DataMatrix, generated by `bwip-js` (**pin the version at implementation time**), encoding
`print_code` and nothing else. Not the verify token, not the entity ref.

Placement and treatment, as a hard spec because "discreet" is otherwise a matter of taste:

| | Value |
| --- | --- |
| Symbology | DataMatrix (ECC 200) |
| Size | **12 mm square** |
| Position | Bottom-left of the footer, aligned to the left margin |
| Ink | **40% grey** (`#999`), never black |
| Caption | `print_code` in **5 pt** mono, 60% grey, directly beneath |
| Quiet zone | 2 mm, enforced by padding — a barcode without it will not decode |

DataMatrix over Code 128 for the reason given in the questionnaire: ECC 200 error correction
survives a document that has ridden in a truck cab, and it is square, so it occupies footer corner
space a linear barcode cannot. It is visually quieter than a QR of equivalent capacity.

The verification QR from PR-2 stays bottom-**right** in the signature block. The two codes are
visually distinct, in different corners, encoding different things — a reader is never in doubt
which one to scan, and neither is a decoder.

`kit.printBarcode({ code, svg }, cfg)` renders it. Only on documents whose request carries a
`PRINT_SIGN` party, and only when `signatures.wet` is on.

**Reprints.** A reprint mints a **new** `print_job_id` with `reprint_of` set and `reprint_no`
incremented, and prints "COPY {n}" beside the caption. This is the audit answer to the question that
actually comes up: two signed copies of the same delivery note surface, and someone must say which
was printed first. Both codes resolve; both are attributable.

### 8.4 Decoding

Server-side, in the `signature-ingest-decode` worker:

1. If the upload is a PDF, rasterise page 1 at 300 dpi. If an image, use it directly.
2. `sharp` (already a dependency) — greyscale, normalise, deskew if the EXIF orientation says so.
3. Decode with `zxing-wasm` restricted to the DataMatrix format.
4. On failure, retry once at 600 dpi cropped to the bottom-left quadrant — where §8.3 guarantees the
   symbol is. This second pass is what turns most `UNREADABLE` results into hits, because the common
   failure is resolution, not damage.
5. Still nothing → `decode_status = 'NO_BARCODE'` (no symbol found) or `'UNREADABLE'` (a symbol was
   located but would not decode). Both queue for review; the distinction tells an operator whether
   to re-scan or to search manually.

> **Implementation note.** The decode toolchain — the WASM build, the rasteriser, and how they behave
> on a phone photo taken at an angle in a warehouse — is the one part of this programme that
> **must be spiked before it is estimated**. Everything else here is deterministic; this is the part
> that meets the physical world. Budget a day to test against real scans from the actual devices
> before committing to the auto-reconciliation threshold in §8.6.

### 8.5 The three inbound routes (Q18 = C)

**Upload** — `POST /signatures/ingest` (MOD-64 `create`), multipart, captures to `document_vault`
then enqueues the decode. The baseline; build first.

**Email-in** — a `DOCUMENTS`-purpose address whose attachments create `signature_ingest` rows. The
Smart Mail engine already ingests attachments into `document_vault`
(`SMART_MAIL_ENGINEERING_GUIDE.md` §5), so this is a hook on that path, not a new mailbox.

> **Note for the Smart Mail team, per Q18:** the barcode work here gives you a matching key. When an
> inbound attachment lands, if `signature-ingest-decode` returns a `print_code`, the message can be
> auto-bound to that document's `entity_ref` with high confidence — a stronger signal than the
> subject-line and sender-domain heuristics `mail.service.autoLink` uses today. The decode service is
> exported as `services/signatures/barcode.decode(buffer)` specifically so the mail path can call it
> without depending on this module.

**Mobile capture** — the PWA gets a camera capture on the document detail screen. Same endpoint as
upload, `source = 'MOBILE'`. This is the one that matters operationally: the driver at the border has
a phone, not an MFP.

### 8.6 Reconciliation (Q19 = B)

Auto-bind requires a clean decode **and** all four corroborating checks:

1. The `print_job` exists and is `ISSUED` or `PRINTED`.
2. Its `doc_type` matches what the ingested document appears to be, where determinable.
3. The record is in a state that expects a signature (its request is `SENT` or `PARTIALLY_SIGNED`).
4. No `RECONCILED` scan already exists for this `print_job_id`.

All four pass → `match_status = 'AUTO'`, the print job goes `RECONCILED`, a `document_signature` row
is written with `assurance_level = 'WET'`, `visual_mark = 'INK'`, and the scan is attached as a new
`document_vault` version bound to the same `entity_ref`.

Any check fails → `REVIEW`, with `match_notes` naming **which** check failed. A review queue that
says "needs review" and nothing else is a queue nobody works.

Check 4 is the one that catches the real-world failure the questionnaire named: a photocopy of a
different shipment's paperwork stapled to this one. It arrives with a valid, decodable code that is
already reconciled, and it goes to review instead of silently overwriting a good record.

The review queue is a screen (`client/src/features/vault/reconciliation.tsx`) showing the scan
alongside the candidate record, with **Bind** / **Reject** / **Search manually**. Binding by hand
sets `match_status = 'MANUAL'` and records the operator — a manually reconciled document is a
different evidentiary claim from an auto-reconciled one, and the certificate says which.

### 8.7 The unreconciled rule

A new rule in the `compliance_flag` catalogue (`compliance_flag.rules.js`, which already works this
way — a rule key, a scan query, a severity):

```
rule_key : 'signature.wet_unreconciled'
scan     : print jobs in ISSUED/PRINTED older than signature_policy.unreconciled_days (default 7)
severity : RED
message  : '{doc_type} {reference} was printed for hand-signature on {date} and has not come back.'
```

This is what turns "we printed it and hoped" into an auditable control, and it is the reason Tier 4
is a first-class path rather than a fallback. The existing checker clears and re-raises unresolved
flags per run, so reconciling a document clears its flag on the next scan with no extra code.

### 8.8 Acceptance criteria

1. A `PRINT_SIGN` document renders a 12 mm DataMatrix at 40% grey bottom-left, with the code in 5 pt
   beneath, and the verification QR still bottom-right.
2. Round-trip: render → rasterise → decode returns the exact `print_code`.
3. A reprint mints a new `print_job_id`, prints "COPY 1", and both codes resolve.
4. All four checks passing auto-reconciles and writes a `WET` / `INK` signature.
5. Re-uploading the same scan hits check 4 and goes to `REVIEW`, not a second reconciliation.
6. A scan with no barcode records `NO_BARCODE` and queues, and the queue row says so.
7. A print job untouched for longer than `unreconciled_days` raises exactly one RED
   `signature.wet_unreconciled` flag; reconciling it clears the flag on the next checker run.
8. `signatures.wet` off ⇒ no barcode is rendered and the `PRINT_SIGN` card is disabled with a reason.

### 8.9 Task list

1. `10753`–`10756`.
2. Add `bwip-js` and `zxing-wasm`; **spike the decode path against real scans before estimating**
   (§8.4).
3. `services/signatures/barcode.js` — `generate()` and `decode()`, the latter exported for the mail
   team (§8.5).
4. `kit.printBarcode()` + template wiring behind the flag.
5. Print-job issue on `PRINT_SIGN` selection; reprint path.
6. The three inbound routes.
7. `signature-ingest-decode` worker + the four-check reconciliation.
8. `reconciliation.tsx` review queue.
9. The compliance rule + its scan query.
10. Tests per §8.8.

---

## 9. Index set

### 9.1 Migrations

| File | PR | Adds |
| --- | --- | --- |
| `10740_signature_core.sql` | 1 | `document_signature` (replaces the `0410` stub) |
| `10741_signature_presets.sql` | 1 | `signature_preset` + the five seeded cards |
| `10742_signature_policy_seed.sql` | 1 | `signature_policy` settings seed per doc type |
| `10743_signature_events.sql` | 1 | `signature.signed / revoked / amended / stale_detected` |
| `10744_signature_scan.sql` | 2 | `signature_scan` |
| `10745_signature_portal_events.sql` | 2 | `signature.scanned_new_ip / scan_anomaly` |
| `10746_signature_request.sql` | 3 | `signature_request` + FK from `document_signature` |
| `10747_signature_party.sql` | 3 | `signature_party` + the one-override index |
| `10748_signature_otp.sql` | 3 | `signature_otp` |
| `10749_signature_certificate_doctype.sql` | 3 | `SIGNATURE_CERTIFICATE` doc type + events |
| `10750_qes_envelope.sql` | 4 | `qes_envelope` |
| `10751_signature_usage_ledger.sql` | 4 | `signature_usage_ledger` |
| `10752_qes_events.sql` | 4 | `qes.*` events |
| `10753_signature_print_job.sql` | 5 | `signature_print_job` |
| `10754_signature_ingest.sql` | 5 | `signature_ingest` |
| `10755_signature_wet_events.sql` | 5 | `signature.printed / scanned_returned / reconciled / reconcile_review` |
| `10756_signature_unreconciled_rule.sql` | 5 | the compliance rule row |

### 9.2 Endpoints

**Gated** (`/api/tenant`, `authMiddleware` + `requirePermission`):

```
GET    /signatures?entity_ref=            MOD-64 view
GET    /signatures/:id                    MOD-64 view
GET    /signatures/:id/document           MOD-64 view
GET    /signatures/menu                   MOD-64 view
GET    /signatures/stats                  MOD-64 view
POST   /signatures/internal               MOD-64 approve
POST   /signatures/:id/revoke             MOD-64 approve
POST   /signature-requests                MOD-64 create
GET    /signature-requests/:id            MOD-64 view
POST   /signature-requests/:id/dispatch    MOD-64 create
POST   /signature-requests/:id/parties     MOD-64 edit      ← the one override
POST   /signature-requests/:id/void        MOD-64 delete
GET    /signatures/qes/quote              MOD-64 create
POST   /signatures/ingest                 MOD-64 create
GET    /signatures/ingest/queue           MOD-64 view
POST   /signatures/ingest/:id/bind        MOD-64 approve
GET    /document-verification/scans       MOD-66 view
```

**Public** (no auth; token is the credential; rate-limited; `tenantDbIn("live")`):

```
GET    /public/verify/:token
GET    /public/verify/code/:code
GET    /public/sign/:token
POST   /public/sign/:token/otp
POST   /public/sign/:token/verify
POST   /public/sign/:token/complete
POST   /public/sign/:token/decline
GET    /public/sign/:token/document
POST   /public/qes/:provider/webhook
```

### 9.3 Feature flags

`signatures` (existing, on) · `signatures.portal` (on) · `signatures.external` (off) ·
`signatures.qes` (off) · `signatures.wet` (off)

### 9.4 Settings — section `signature_policy`

| Key | Default | Meaning |
| --- | --- | --- |
| `<DOC_TYPE>` | seeded | `{ allowed: [...], default: "STAMP" }` — funnel level 2 |
| `stepup_enabled` | `false` | Internal step-up OTP (Q9 = C) |
| `stepup_threshold_xaf` | `null` | Above this total, internal signing needs an OTP |
| `notify_on_scan` | `false` | First-scan-from-new-IP notification (Q13) |
| `scan_anomaly_threshold` | `25` | Scans per rolling hour before an anomaly event |
| `scan_retention_days` | `400` | `signature_scan` pruning |
| `reminder_days` | `[2, 5]` | Reminder schedule; `[]` disables |
| `qes_unit_fee` | **none** | **§1.4(b) — dispatch fails `424` until set** |
| `unreconciled_days` | `7` | Before the RED compliance flag |

### 9.5 Environment

```
SIGNATURE_TOKEN_PEPPER            required, ≥32 bytes. Env only, never the tenant DB.
SIGNATURE_TOKEN_PEPPER_PREVIOUS   optional, dual-read window during rotation (§3.7)
PUBLIC_PORTAL_BASE_URL            the https origin printed into QR codes
```

**Pepper rotation** (manual in V1): set `_PREVIOUS` to the outgoing value, deploy, let the lookup
re-HMAC matched rows on read, confirm no row still carries the old HMAC, then clear `_PREVIOUS`.
Rotating without the dual-read window **invalidates every printed QR in existence** — this is the
single most destructive operation in the programme and belongs in `INCIDENT_RUNBOOK.md`.

### 9.6 v2 backlog

| Item | Why it is not here |
| --- | --- |
| PAdES B-B / B-LT + AATL certificate + HSM | Q3 = A, Q4 roadmap = C. Revisit when a tenant needs a signature Adobe Reader validates natively. The `artifact_hash` column already anticipates it. |
| DocuSign adapter | Q14 — V1 is SignWell only. The interface is built for it. |
| ANTIC / local CA adapter | Q14 — blocked on §1.4(c), counsel. |
| WhatsApp OTP | Q6 — needs a Business API account and template approval. |
| Batch signing | §1.2(f) — unanswered, and it needs its own assurance treatment. |
| Offline signing queue | §1.2(g) — device-asserted timestamps need distinct evidentiary handling. |
| Bring-your-own QES keys per tenant | Follows the DocuSign adapter. |
| True WORM storage for the certificate | S3 Object Lock. `immutable_ledger` gives the hash chain today. |

---

## 10. What to read if you only read one thing

If you are picking this up cold and implementing a single chapter, read **§3.6** (the canonical
payload contract) and **§1.3** (the four judgment calls) first. Everything else is mechanical;
those two are where a well-intentioned change quietly breaks every signature in production.
