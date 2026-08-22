# Praxis LS — Multi-Tier Signature & Verification: Engineering Guide

**Status:** Plan of record. Built from `doc/SIGNATURE_PROGRAMME_QUESTIONNAIRE.md` plus the answers
returned on all 20 questions, and revised by **Round 2** (§1.5) which reopened Q11, Q12 and Q16,
settled three of the four open items, added the visual-seal specification (§3.12) and the
IP-handling directive (§3.13).
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
| 10 | QR payload | **C** — `https://{host}/v/{code}`, and the same code printed beneath for manual entry | One credential, two renderings. §3.7 |
| 11 | Token at rest | **Round 2: B** — split. The **signing** token is peppered (it grants action); the **verify** token is plaintext, unique-indexed (it grants a public read) | Restores phone-readable codes, admin visibility and reprints. §3.7 |
| 12 | Portal disclosure | **Round 2: B** — the portal shows the document **as signed**, from the stored canonical payload, plus the amendment verdict. No live query. | Adds `content_payload jsonb`. Removes the stale-copy-reveals-current-state leak. §5.4 |
| 13 | Scan logging | **C** — log every scan, notify the owner on a first scan from a new IP, surface an anomaly signal | `signature_scan` + `immutable_ledger`. Privacy notice + retention setting. §5.5 |
| 14 | QES provider | **B** — provider-agnostic adapter. **V1 is SignWell only.** DocuSign _(v2)_, ANTIC CA _(v2)_ | `src/services/qes/` with one adapter shipped. §7.2 |
| 15 | QES billing | **C, narrowed in Round 2** — the **tenant absorbs** the cost in its own service pricing. Praxis meters and bills the tenant; there is **no per-envelope line to the tenant's client** | Deletes the client-facing fee modal and the `final_invoice` rebill. §7.5 |
| 16 | Tier eligibility | **Hybrid B + C, simplified in Round 2** — tenant sets the allowed menu per doc type; the sender's control collapses to **two booleans**; signer picks from what remains | Because every digital signature is `AES_OTP`, a rank floor had nothing to sort. §3.4 |
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

**(d) Which cards does the signer see?** — **RESOLVED in Round 2: four.**

Stamp and Typed are **one card**, not two. The difference between them was never the mark; it was
where the identity came from. Internal signers have theirs resolved from the session (the Bureau LPC
rule); external signers state their name and role and prove control of the on-file address by OTP.
Same rendered stamp either way.

> **Rule.** That distinction is recorded as `identity_source` (`SESSION` | `DECLARED`), **not** as a
> second `visual_mark`. The enum is therefore four marks and the menu four cards (§3.3).
> Name is *claimed*; email is *proved* — and the certificate says which, in those terms.

**(e) What does a "reprint" mean?** — **narrowed by Round 2's Q11 = B.**

> **Rule.** The vaulted PDF remains the printable original: `GET /signatures/:id/document` streams
> the stored bytes, and nothing re-renders a signed document, because a re-render produces different
> bytes (Puppeteer stamps `/CreationDate`) and so a different `artifact_hash`.
> The QR is no longer a reason for the rule — with the verify token in plaintext it *could* now be
> reprinted. The artifact hash is reason enough on its own.

### 1.4 Open items

| | Item | Status |
| --- | --- | --- |
| **a** | The cards | **CLOSED** — four (§1.3(d), §3.3). |
| **b** | The QES fee | **CLOSED** — the tenant absorbs it in its service pricing. No client-facing figure is needed, so the `424 CONFIG_MISSING` blocker is gone. Praxis→tenant metering remains, at a **platform**-tier rate (§7.5). |
| **c** | **Counsel on OHADA (Q14)** | **STILL OPEN.** Nothing in V1 waits on it — SignWell ships regardless, and §7.2's naming rule keeps the product honest meanwhile. It decides whether adapter #3 is ever built, and it **must** be answered before anyone tells a client Tier 3 is "government-backed". |
| **d** | Portal disclosure risk | **CLOSED** — resolved by moving to the as-signed snapshot (Q12 = B). |
| **e** | **Does an internal signer need an OTP every time?** | **ASSUMED, REVERSIBLE IN ONE LINE.** See §1.5(b). |

### 1.5 Round 2 — the revisions, and why

After the first pass you asked what your answers actually cost. Five follow-ups reopened Q11, Q12
and Q16 and closed three of the four open items. This section records what moved.

**(a) Q16 — the funnel lost a level, because there was nothing for it to sort.**
The original level 3 let a sender narrow the preset menu for one dispatch. My proposed replacement
was a *rank floor* ("this needs at least email-verified"). You pushed back: every digital signature
already requires an OTP, so what is a floor for?

You were right, and the consequence is larger than the question. If `STAMP` and `DRAWN` are both
`AES_OTP`, the ladder has only **one** rung below QES. A floor across `{AES_OTP, AES_OTP, QES, WET}`
can express exactly two states. So the sender's control is not a menu and not a floor — it is **two
booleans**: *must this be certified?* and *may this be signed on paper?* That is §3.4, and it
replaces a multi-select plus subset-validation with two checkboxes.

**(b) The one thing I am assuming — say the word and it flips.**
"We can NEVER SIGN without OTP" and Q9 ("session-resolved always; step-up OTP above a threshold")
cannot both be literally true for internal signers. The build assumes:

> **External signers: OTP always, no exception, no threshold.** This is absolute and has no
> configuration that disables it.
> **Internal signers: session identity, with step-up OTP above the Q9 threshold.**

The reason is friction arithmetic, not principle. A dispatcher signing forty delivery notes a day
would do forty OTP round-trips, and a control that painful gets switched off — which is precisely
how Bureau LPC lost its OTP the first time (questionnaire §0.2). An internal signer is already
behind a password; the marginal evidence an OTP adds there is small, and Q9's threshold buys it back
exactly where the money is. **If you want internal OTP unconditionally, it is one line in §6.5** —
set the threshold to zero and the whole product becomes universal-OTP with no other change.

**(c) Q11 — I sent you the wrong way and this corrects it.**
My questionnaire note said "if Q12 lands on C, revisit this", so you chose the peppered token for
both credentials. The note's reasoning does not survive scrutiny: anyone who can dump the database
can already read every invoice in it, so a working verify link discloses *less* than the dump the
attacker would already hold. The pepper was defending a narrow case at the price of phone-readable
codes, admin visibility and reprints. Split by what each credential grants — action versus a public
read — and the asymmetry resolves it (§3.7).

**(d) Q12 — the objection I raised was the wrong one.**
I argued a competitor could learn your pricing. You were right to wave that off: anyone holding the
paper can read the total on the paper. The real defect was that a **live** query lets an **old**
copy disclose the **current** state — a March waybill scanned in September showing today's line
items. The as-signed snapshot removes it, and pays for itself twice over: the Certificate of
Completion gets materially richer, and an amended document can show a real before/after instead of
a bare red flag (§5.4).

**(e) Q15 — the client-facing billing subsystem is deleted.**
The tenant absorbs the QES cost in its own service pricing. That removes the fee modal, the
`final_invoice` rebill integration, the disputed-line-item path, and the `424 CONFIG_MISSING`
blocker. Praxis→tenant metering stays, at a platform rate (§7.5).

**(f) New in Round 2:** the visual seal specification (§3.12) and the IP-handling directive (§3.13).

---

## 2. Scope

### 2.1 What we are building

1. **A signature model with two axes and a preset menu.** `assurance_level` × `visual_mark`, with
   four named presets an operator recognises as "the four tiers". Every signer — internal or
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

**Axis B — `visual_mark`: what the mark looks like.** Four values, one per card.

`STAMP` (the generated seal, §3.12) · `DRAWN` (Base64 PNG from a pad) · `PROVIDER` (the QTSP's own
seal) · `INK` (scanned paper)

There is no `TYPED` and no `UPLOAD`. Typed-name and session-resolved stamps render the *same mark*;
what differs is where the identity came from, which is `identity_source`, not a mark (§1.3(d)).
`UPLOAD` is deliberately absent: an uploaded signature image proves nothing about who uploaded it
and invites indefinite reuse of one scan, which adds evidentiary noise exactly where this system is
supposed to add weight.

**A third column — `identity_source`: how the signer's name got there.**

| Value | Meaning |
| --- | --- |
| `SESSION` | Resolved server-side from `app_user`. Internal signers. Never from a request body. |
| `DECLARED` | Stated by the signer on the signing page. External signers. |

> **The distinction that matters, and the certificate must say it in these words:** the **name is
> claimed**, the **email is proved**. A `DECLARED` signer typed "Jean Mbarga, Procurement Manager";
> what the OTP established is that they control the address already on file. Those are two different
> facts and the evidence document keeps them apart.

**The preset catalogue** — four cards, seeded in `10741`, editable per tenant.

| `code` | Signer-facing (EN) | Signer-facing (FR) | `assurance_level` | `visual_mark` | Tier |
| --- | --- | --- | --- | --- | --- |
| `STAMP` | Digital stamp | Cachet numérique | `AES_OTP` | `STAMP` | 1 |
| `DRAWN` | Draw your signature | Dessiner votre signature | `AES_OTP` | `DRAWN` | 2 |
| `CERTIFIED` | Certified signature | Signature certifiée | `QES` | `PROVIDER` | 3 |
| `PRINT_SIGN` | Print and sign by hand | Imprimer et signer | `WET` | `INK` | 4 |

Blurbs, bilingual, seeded:

| `code` | EN | FR |
| --- | --- | --- |
| `STAMP` | Your name, role and the date, applied as a stamp. | Votre nom, fonction et la date, apposés en cachet. |
| `DRAWN` | Sign with your finger or your mouse. | Signez avec le doigt ou la souris. |
| `CERTIFIED` | Identity verified by an independent signature provider. | Identité vérifiée par un prestataire de signature indépendant. |
| `PRINT_SIGN` | Print, sign in ink, and send the scan back. | Imprimez, signez à l'encre, puis renvoyez le scan. |

The `tier_label` column carries "1"–"4" so the UI groups cards under the vocabulary your team uses
out loud, while the schema stays orthogonal. That is the whole point of Q1 = C. **The same four
cards appear to the sender and to the signer** — one catalogue, one component, two audiences.

> **MUST.** `assurance_level` on a completed signature is derived from evidence actually collected
> (§1.3(b)). The preset states the *target*; the signing service states the *outcome*. A signer who
> picks `STAMP` and never completes the OTP is recorded as `SES`, and the portal says so.

### 3.4 The eligibility funnel (Q16, simplified in Round 2)

Resolved once, server-side, in `presets.resolveMenu()`.

```
1. DOC-TYPE CEILING (code)      document_vault.types.js declares { signable, allowsWet, allowsQes }
                                per doc type. A PAYSLIP is never wet-signed; a DELIVERY_NOTE never
                                needs QES. Not tenant-editable.
        ↓
2. TENANT MENU (setting)        settings section `signature_policy`, key = docType, edited at
                                /settings/signatures (§3.11).
                                { allowed: ["STAMP","DRAWN"], default: "STAMP" }
                                Anything outside the ceiling is rejected on write.
        ↓
3. SENDER, AT DISPATCH          TWO BOOLEANS on signature_request, not a menu:
                                  require_certified  → the menu collapses to CERTIFIED alone
                                  allow_paper        → PRINT_SIGN stays in, or drops out
                                Everything else the tenant allowed passes through untouched.
        ↓
4. SIGNER CHOICE (per party)    signature_party.allowed_presets, computed from the three above.
                                The signing page renders them as cards. The signer picks one.
```

**Why two booleans and not a menu.** Every digital card is `AES_OTP` — `STAMP` and `DRAWN` differ
only in appearance, never in legal weight. A sender choosing between them is choosing a *look* on
someone else's behalf, which is exactly the choice you wanted to give the signer. The only sender
decisions that carry meaning are the two that change the *evidence*: is third-party certification
required, and is paper acceptable. §1.5(a).

> **MUST.** The menu is resolved **server-side on every render of the signing page**, never trusted
> from the client. A party POSTing a preset outside their resolved menu gets `422 PRESET_NOT_ALLOWED`.

`require_certified` on a doc type whose ceiling has `allowsQes: false` fails at dispatch with
`422 CERTIFIED_NOT_AVAILABLE`. An otherwise empty menu fails with `422 EMPTY_SIGNATURE_MENU` rather
than producing a signing link nobody can complete.

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

### 3.7 Tokens and codes (Q10 = C, Q11 = B after Round 2)

**Two** credentials, stored according to **what each one grants** — not uniformly. This is the Round 2
correction (§1.5(c)); the count dropped from three to two when the seal was redesigned (§3.12).

| Credential | Form | Where it appears | Grants | Stored as |
| --- | --- | --- | --- | --- |
| `verify_code` | 12 chars Crockford base32 (no I/L/O/U), shown `XXXX-XXXX-XXXX` | **Both** the QR (`https://{host}/v/{code}`) and the printed line under it | Read of a public summary | **plaintext**, unique-indexed |
| `sign_token` | 32 random bytes → base64url | The signing link emailed to a party | **The ability to sign as that party** | `HMAC-SHA256(pepper, …)` |

**Why one public credential and not two.** The first draft minted a 43-character base64url
`verify_token` for the QR *and* a 12-character code for typing. Since Round 2 both are plaintext and
both grant exactly the same thing, so the second was pure duplication — two columns, two indexes,
two mint calls, two things that can disagree.

Collapsing them is also what makes the QR *work*. **Measured**, at error-correction level Q, in the
22 mm the seal allocates:

| QR payload | Length | Modules | mm per module |
| --- | --- | --- | --- |
| Long token, `/public/verify/` path | 83 | 45 | **0.49** |
| Short code, `/public/verify/` path | 52 | 37 | 0.59 |
| **Short code, `/v/` path** | **40** | **33** | **0.67** |
| Short code, dedicated `verify.` host | 38 | 33 | 0.67 |

A phone camera wants ≥ 0.5 mm per module at arm's length; 300 dpi print needs ≥ 0.34 mm (four dots).
The original design sat at **0.49 mm — right on the phone threshold**, before a photocopier touched
it. The short code plus the short path clears it by a third.

Two findings worth keeping: the `/v/` path is where the gain is (the long path costs a whole QR
version), and a dedicated short *host* buys nothing further — 38 and 40 characters land in the same
version — so **there is no need to provision a `verify.` domain**.

**Why the split.** A verify token resolves to a page the tenant has already chosen to publish; a
sign token lets its holder act as the counterparty. Peppering both cost real capability — an
operator could not read a verify code down the phone, no admin screen could list verify links — to
defend a case that does not hold up, since anyone who can dump the database can already read every
invoice in it directly. The sign token is different in kind: a leaked one is a forged signature, and
it is short-lived, so peppering costs nothing there.

```
SIGNATURE_TOKEN_PEPPER            required, ≥ 32 bytes, env only, NEVER in the tenant DB
SIGNATURE_TOKEN_PEPPER_PREVIOUS   optional, dual-read window during rotation
```

**Consequences to hold on to:**
- The verify code is recoverable, so `GET /signatures/:id` may show it to a holder of MOD-64 `view`,
  and an operator can read it down the phone. Reprints still stream the vaulted artifact, for the
  artifact-hash reason in §1.3(e), not a token reason.
- **Never reuse the verify code as a sign token.** Separate columns, separate mint calls, separate
  lifetimes: a verify code is permanent and public, a sign token expires with the request and grants
  action.
- **Pepper rotation** now only affects sign tokens — in-flight signing links, not printed QRs. That
  makes it a far smaller operation than the first draft implied: set
  `SIGNATURE_TOKEN_PEPPER_PREVIOUS`, deploy, let open requests drain, clear it. Printed documents are
  entirely unaffected. §9.5.

Entropy: 12 Crockford chars = 2⁶⁰. Adequate **only with rate limiting** — and now that the code is
stored in plaintext, the portal limiter in §5.2 is the *sole* defence against enumeration. It is
load-bearing, not decoration.

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

Public routes (`/public/sign`, `/v`) carry **no** permission check: the token is the
credential. They are rate-limited instead (§5.2, §6.2).

### 3.9 Migrations

**Re-planned after the first merge from `main`.** The original block (`10740`–`10756`) was taken by
the mail and costing programmes while PR-1 was in flight, and `check-migration-numbers.js` caught the
collision on merge — it is a **hard** gate, not a warning. `main`'s high-water mark is now `10770`
(plus one outlier at `11740`), so this programme takes **`10771`–`10787`**.

| Range | PR |
| --- | --- |
| `10771`–`10774` | PR-1 — core schema, presets, policy seed, events ✅ |
| ~~`10775`–`10776`~~ → `10779`–`10780` | PR-2 — scan log, portal wiring ✅ |
| `10781`–`10784` | PR-3 — requests, parties, OTP, certificate ✅ |
| `10785`–`10787` | PR-4 — QES envelopes, usage ledger |
| `10788`–`10791` | PR-5 — print jobs, ingestion queue, compliance rule |
| seeds `9115` | PR-2 — the `signatures.*` platform feature catalogue ✅ |

**PR-2 renumbered too, exactly as this section warns.** `10775`–`10778` were taken by the mail
programme (`10775_mail_ai_feature_flag`, `10776_mail_ocr_flag`, `10777_send_point_auth_otp_unwired`,
`10778_entity_legal_form_reference`) while PR-2 was being written. The high-water mark was re-checked
against `main` immediately before the first migration file was created, which is the only reason this
cost nothing. **PR-3 must do the same** — the ranges above are a plan, not a reservation.

PR-2 also added a **platform seed**, which the original plan did not anticipate: a tenant
`feature_state` row with no `platform.feature_catalogue` row is a feature nobody can switch on
(`tests/security/feature-catalogue-coverage.test.js`, and 9114's header for how fifteen `mail.*`
flags shipped unswitchable). Every later chapter that adds a `signatures.*` flag inherits that
requirement — though PR-2 seeded all four ahead of time, so PR-3, PR-4 and PR-5 only have to flip a
switch.

> **Re-check the high-water mark immediately before writing a migration**, not when planning the PR.
> Two programmes running concurrently will collide again otherwise, and the collision only surfaces
> at merge time.

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

### 3.11 Where the tenant configures this

One new settings page: **`/settings/signatures`**, a card on the existing settings hub
(`client/src/features/settings/settings-hub.tsx`), sitting beside *Document templates* and *Email
signatures* — which is where someone looking for it will actually look.

→ `client/src/features/settings/signatures-page.tsx`, gated MOD-70 `edit`.

Four panels:

1. **Per document type** — the funnel's level 2. A row per signable doc type, four checkboxes
   (the four cards), and a default. Cards the doc-type ceiling forbids render disabled with the
   reason, so an admin can see *why* wet-signing a payslip is not on offer rather than wondering
   where the option went.
2. **Verification** — scan notifications on/off, anomaly threshold, scan retention days, and the
   portal's privacy-notice preview.
3. **Identity** — the Q9 step-up toggle and its XAF threshold, with the plain-language consequence
   written under it ("above this amount, staff signing this document will also enter an emailed
   code").
4. **Certified signatures** — the provider status, whether it is configured, and the current
   month's envelope count. Read-only where the tenant does not administer the provider.

The company seal (§3.12) is **not** configured here — it derives from branding and entity data that
already exist. That is the point of it: nobody retypes what the system already knows.

### 3.12 The visual seal (`visual_mark = 'STAMP'` and `'DRAWN'`)

The seal is what most people will ever see of this system. It derives entirely from data already
held — branding, `corporate_entity`, the signature row — and has **no editable copy**, which is what
stops forty tenants inventing forty different legal-looking blocks.

#### What it has to do

1. Tell a human, at a glance, **who attested to what, in what capacity, and when**.
2. Let them **check it independently** without asking us.
3. Survive a photocopier, a fax, a truck cab and a border post.
4. Fit **88 × 34 mm** — the height budget Bureau LPC proved a signature block can occupy without
   pushing a one-page document onto a second (questionnaire §0.1).

#### The layout

```
┌────────────────────────────────────────────────────────────────┐
│ FOR SMART LOGISTICS SARL                              1 of 2   │  6pt caps, accent │ 6pt mono
│ ══════════════════════════════════════════════════             │  0.4mm accent rule
│ Approved for dispatch                              ┌─────────┐ │  9pt semibold  ← the attestation
│ Jean Mbarga · Commercial Director                  │   QR    │ │  7.5pt
│                                                    │  20mm   │ │
│ 20 Aug 2026 14:35 WAT · Verified by email code     └─────────┘ │  6pt mono, muted
│ WAYBILL-8842-A · content e3b0c44298fc1c14        A4B7-K92M-XQ1P│  6pt mono, muted
└────────────────────────────────────────────────────────────────┘
```

It reads as a sentence: *For Smart Logistics, approved for dispatch, by Jean Mbarga, Commercial
Director, on 20 August 2026, verified by email code.* Everything below that sentence is a footnote,
and is typeset like one.

**`DRAWN` variant** — same frame, same evidence rows; the drawn PNG occupies the attestation slot at
`max-height: 10mm`, with the name beneath it and the reason moved down one line.

#### Five things it does that the first mockup did not

| | Why it matters |
| --- | --- |
| **`FOR {PARTY}`** as the first line | A countersigned document carries two seals, and each must declare **which side it speaks for**. Bureau LPC printed "POUR LA PETITE COUR" for exactly this reason. Without it, two seals on one page are indistinguishable. |
| **`n of m`** position in the chain | Tells a reader whether they are holding a fully-executed document or a half-signed one — the single most common question about a countersigned waybill. |
| **The attestation is the headline** | `Reason: Approved for dispatch` in 7 pt buries the only part a human actually needs. It is promoted to 9 pt semibold and everything else demoted around it. |
| **Monochrome-first** | Designed in greys, with brand colour as one accent rule. The original depended on green to read as approved — and on a photocopy green becomes a grey blob. Inverting the default removes the failure mode instead of testing for it. |
| **One credential in the QR** | See §3.7 — the short code makes the QR modules ~50% larger in the same footprint. |

#### Hard rules

| Rule | Why |
| --- | --- |
| **MUST NOT print a verdict** — no "VALID", no tick, no green badge | A static PDF cannot know it is valid. Validity depends on amendment and revocation, both of which happen *after* printing. A revoked signature would carry a green VALID badge on every copy in existence, forever — contradicting §4.5's revocation model, and the first thing an opponent would point at. The seal states what it **is**; the portal states what it **evaluates to**. |
| **MUST NOT print an IP address** | §3.13. |
| **MUST NOT print a vendor mark** | The product is white-label. The tenant's client sees the tenant. |
| **MUST NOT print engineering vocabulary** | "Verified by email code" / "Vérifié par code e-mail" — never `AES_OTP`. A document a court reads should not need a glossary. |
| **MUST** label the hash and truncate consistently | Two hashes exist post-Q2. Print the **content** hash, first **16** hex, labelled. An unlabelled 34-character fragment invites a reader to think it is the whole digest. |
| **MUST** keep QR and code inside the border | The seal is the part people photograph and crop; verification has to travel with it. |
| **MUST** take colour from tenant branding | Accent rule and header from the resolved `cfg`; no hardcoded blue. |
| **MUST** survive monochrome | Nothing depends on colour. Metadata ≥ 6 pt in no lighter than `#4b5563`; border ≥ 0.25 mm. |

#### `Reason` — adopted, as a controlled vocabulary

Signing intent was the mockup's best idea and it is kept. But it is a **fixed list**, never free
text: free text on a legal seal is a liability field, and someone will eventually type something
that contradicts the document it sits on. Seeded bilingual: *Approved for dispatch · Approved for
payment · Goods received · Reviewed and accepted · Acknowledged*. Stored as
`document_signature.sign_reason`; tenant-editable at `/settings/signatures`; the signer picks and
cannot type.

#### Provenance — nothing here is retyped

| Field | Source |
| --- | --- |
| `FOR {party}` | `corporate_entity.legal_name` for `INTERNAL`; the counterparty's name for `EXTERNAL` |
| `n of m` | the party's `sequence_no` over the request's party count; omitted for a lone signature |
| Reason | the signer's pick from the controlled list |
| Name, role | `app_user` when `identity_source = 'SESSION'`; the signing form when `'DECLARED'` |
| Signed | `signed_at`, in the tenant timezone with the zone named |
| Method | `assurance_level`, translated to plain language |
| Ref | the document's own number |
| Content | `content_hash`, first 16 |
| QR, code | `verify_code` — one credential, two renderings |

### 3.13 IP addresses — handling directive

Binding, and it applies to `document_signature.ip` and `signature_scan.ip` alike.

| Stage | Rule |
| --- | --- |
| **Capture** | `ip` and `user_agent` at the exact moment of **OTP verification** — not at page load, not at request creation. The evidentiary claim is about the act of signing. |
| **Store** | Full value, `inet` column, on the signature row and in `immutable_ledger`. |
| **Visual seal** | **Never rendered.** §3.12. It is PII and must not travel on a physical logistics document that passes through a warehouse, a border post and a customer's filing cabinet. |
| **Public portal** | **Masked** — `197.210.***.***` (first two octets for IPv4; first two groups for IPv6). Enough for audit transparency, not enough to identify a person. |
| **Certificate of Completion** | **Masked by default.** A tenant setting `certificate_full_ip` (default `false`) unmasks it where a jurisdiction or a specific dispute requires it. *This one is my judgment call, not your directive* — the certificate is an evidence document but it is also shareable, so it gets the safer default and an explicit switch. |
| **Internal view** | Full value, MOD-64 `view`, and the reveal is itself audited. |

`services/signatures/mask.js` owns the masking. **MUST** be the only place an IP is formatted for
display, so a future surface cannot forget the rule.

### 3.14 Internationalisation

FR and EN, matching `kit.js` (`t({fr, en}, cfg.language)`). Everything a counterparty reads —
the signing page, the four preset cards, the OTP email, the verification portal, the visual seal and
the Certificate of Completion — is bilingual. The party's language resolves from `client_master`
preferred language where set, else the tenant default, else FR (this is a Cameroonian product; FR is
the safer default).

---

## 4. PR-1 — Signature core · **DELIVERED** (PR #239)

**Ships:** the schema that replaces the `0410` stub, the canonical-payload registry, the two-axis
tier model with its preset catalogue, the eligibility funnel, internal signing, code minting, the
visual seal, and staleness detection. No public surface, no OTP.

**Merges alone.** Everything else builds on this schema.

### 4.0 What actually shipped, and what changed from this specification

| Item | Status |
| --- | --- |
| `10740`–`10743` migrations | ✅ Delivered — **as ALTER, not DROP + CREATE**, see below |
| `services/signatures/{canonical,tokens,presets,mask,qr}.js` | ✅ Delivered |
| `kit.sealBlock()` + the seal CSS | ✅ Delivered — §3.12 |
| `document_signature.*` — all seven files rewritten | ✅ Delivered |
| `document_vault.types.js` ceiling | ✅ Delivered — `SIGNATURE_CEILING` |
| Tests: canonical (18), tokens/mask (15), presets (15), seal (18) | ✅ 66 passing |
| `scripts/dev/render-seal.js` | ✅ Added — not in the original plan; see below |
| `signatures.tsx` rewritten; `signature-cards.tsx`, `signature-vocab.ts` | ✅ Delivered |
| `/settings/signatures` + its hub card and route | ✅ Delivered |
| Gates | ✅ `npm run ci` **30/30**; 4125 backend + 1551 frontend tests |

**Four things the spec got wrong, corrected in the build:**

1. **The migration reshapes the table; it does not replace it.** §4.2 specified `DROP TABLE` +
   `CREATE TABLE`. That trips `scripts/db/check-schema-drift.js`: two `CREATE TABLE` statements for
   one table means the earlier file wins under `IF NOT EXISTS` and the later one is a silent no-op.
   `0410` is frozen in the idempotency baseline and cannot be edited, so the correct resolution —
   and the one that checker documents — is `ALTER TABLE … ADD COLUMN` in place, guarded by an
   empty-table assertion that refuses to run rather than destroy rows.

2. **The seal overflowed its own border, and only a render showed it.** Two bugs, both invisible in
   the HTML: `max-height` does not clip, so a long name pushed the evidence rows outside the frame;
   and at 6 pt a monospace character is ~1.27 mm, so the 45-character date+method line needed ~58 mm
   against a 58.5 mm column and wrapped, orphaning its last word. Fixed at 5.5 pt with
   `overflow: hidden` as a backstop, and locked by geometry tests.
   **`scripts/dev/render-seal.js` exists because of this** — run it after any change to the seal.

3. **The QR figures in §3.7 were estimated and wrong.** Measured, corrected in place, and the
   conclusion held: the short code plus the `/v/` path is what keeps the symbol at 33 modules.

4. **One public credential, not two.** `verify_token` is gone; `verify_code` serves both the QR and
   the printed line. See §3.7.

**A deliberate breaking change:** `POST /api/tenant/signatures/` is **removed**, not deprecated. Its
entire contract was `signer_name` supplied in the request body — the precise thing this PR exists to
forbid — so a deprecation window would keep the vulnerability alive for its duration.
`doc/api-contract.json` is updated accordingly.

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

  -- the two hashes (Q2 = C), plus the payload itself (Q12 = B, Round 2)
  payload_version   integer NOT NULL DEFAULT 1,
  content_hash      text NOT NULL,   -- sha256 of the canonical BUSINESS payload — recomputable
  artifact_hash     text,            -- sha256 of the vaulted PDF bytes — frozen, NULL until rendered
  content_payload   jsonb NOT NULL,  -- the canonical payload ITSELF, as signed. Feeds the portal's
                                     -- as-signed summary (§5.4) and the certificate (§6.7). Storing
                                     -- it is what lets us show WHAT was signed, not just prove it.

  -- the two axes (Q1 = C). assurance_level records evidence COLLECTED, never requested (§1.3(b)).
  assurance_level   text NOT NULL CHECK (assurance_level IN ('SES','AES_OTP','QES','WET')),
  visual_mark       text NOT NULL CHECK (visual_mark IN ('STAMP','DRAWN','PROVIDER','INK')),
  preset_code       text,            -- the card the signer picked; NULL for system-recorded acts
  sign_reason       text,            -- controlled vocabulary, §3.12. Printed on the seal.

  -- who signed
  party             text NOT NULL CHECK (party IN ('INTERNAL','EXTERNAL')),
  identity_source   text NOT NULL CHECK (identity_source IN ('SESSION','DECLARED')),
  signer_user_id    uuid REFERENCES app_user(user_id),   -- SESSION only
  signer_name       text NOT NULL,   -- snapshot at signing time; never re-read from the user record
  signer_role       text,
  signer_email      text,            -- the address the OTP actually went to. PROVED, unlike the name.
  signature_request_id uuid,         -- FK added in 10746 (PR-3); NULL for direct internal signing

  -- the mark itself
  mark_image_b64    text,            -- DRAWN only. NULL for STAMP / PROVIDER / INK.

  -- verification credential (§3.7). ONE code, plaintext: it grants a public read,
  -- not an action, and the QR and the printed line are two renderings of it.
  verify_code       text NOT NULL,

  -- evidence, captured at OTP VERIFICATION (§3.13), never at page load
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

CREATE UNIQUE INDEX uq_sig_code ON document_signature(verify_code);
CREATE INDEX ix_sig_entity ON document_signature(entity_ref, signed_at DESC);
CREATE INDEX ix_sig_doc    ON document_signature(document_vault_id);
CREATE INDEX ix_sig_signer ON document_signature(signer_user_id);

-- A session-resolved identity must carry the user it was resolved from; a
-- declared one must not (the party is not an app_user). Enforced here so no
-- service can get it wrong.
ALTER TABLE document_signature ADD CONSTRAINT ck_sig_identity_source
  CHECK ((identity_source = 'SESSION'  AND signer_user_id IS NOT NULL)
      OR (identity_source = 'DECLARED' AND signer_user_id IS NULL));

-- A drawn mark needs its image. Cheap, and it stops a half-recorded signature
-- reaching the portal.
ALTER TABLE document_signature ADD CONSTRAINT ck_sig_mark_payload
  CHECK ((visual_mark = 'DRAWN' AND mark_image_b64 IS NOT NULL)
      OR (visual_mark IN ('STAMP','PROVIDER','INK')));

-- Round 2: external signers ALWAYS clear an OTP (§1.5(b)). No configuration
-- disables this, so it is a constraint and not a service-layer rule.
ALTER TABLE document_signature ADD CONSTRAINT ck_sig_external_verified
  CHECK (party = 'INTERNAL'
      OR assurance_level IN ('QES','WET')
      OR otp_challenge_id IS NOT NULL);
```

**`10741_signature_presets.sql`** — the catalogue (§3.3), seeded with the four cards.

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
  (preset_code, label_en, label_fr, blurb_en, blurb_fr,
   assurance_level, visual_mark, assurance_rank, tier_label, sort_order)
VALUES
  ('STAMP','Digital stamp','Cachet numérique',
   'Your name, role and the date, applied as a stamp.',
   'Votre nom, fonction et la date, apposés en cachet.',
   'AES_OTP','STAMP',2,'1',10),
  ('DRAWN','Draw your signature','Dessiner votre signature',
   'Sign with your finger or your mouse.',
   'Signez avec le doigt ou la souris.',
   'AES_OTP','DRAWN',2,'2',20),
  ('CERTIFIED','Certified signature','Signature certifiée',
   'Identity verified by an independent signature provider.',
   'Identité vérifiée par un prestataire de signature indépendant.',
   'QES','PROVIDER',3,'3',30),
  ('PRINT_SIGN','Print and sign by hand','Imprimer et signer',
   'Print, sign in ink, and send the scan back.',
   'Imprimez, signez à l''encre, puis renvoyez le scan.',
   'WET','INK',2,'4',40)
ON CONFLICT (preset_code) DO NOTHING;
```

Plus `signature_reason` — the controlled vocabulary the seal prints (§3.12), seeded with
*Approved for dispatch · Approved for payment · Goods received · Reviewed and accepted ·
Acknowledged*, bilingual, tenant-editable, and **never** a free-text field.

**`10742_signature_policy_seed.sql`** — the tenant menu (funnel level 2), seeded per doc type into
the existing settings mechanism (`shared/config/settings.js`, section `signature_policy`,
key = docType). Seed conservatively: `STAMP` and `DRAWN` on for every signable type;
`CERTIFIED` and `PRINT_SIGN` **off** until their PRs ship and their flags are enabled.

**`10774_document_signature_events.sql`** — event-type rows so `emitEvent` resolves a category and
the notification fan-out works: `document_signature.signed`, `.revoked`, `.amended`,
`.stale_detected`. None is `is_security_critical` — they are business events, not RBAC changes.

> **Namespaced `document_signature.*`, not `signature.*`.** The mail programme owns
> `signature.template.changed` / `.profile.changed` / `.cache.invalidated` (migration `10768`) for
> **email** signatures — the sign-off block on an outgoing message. Ours are about somebody
> attesting to an invoice. The keys do not literally collide, but two unrelated concepts under one
> prefix make the event log unreadable to whoever comes next. Same reason the settings card is
> "Document Signatures" and not "Signatures": it sits directly below "Email Signatures".

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
6a. The rendered seal contains no verdict word, no IP, no vendor name, and no `AES_OTP`-style token;
   it fits 88 × 34 mm; and it stays legible converted to greyscale (§3.12).
7. `verify_code` is unique and readable back through `GET /signatures/:id`;
   `sign_token_hmac` (PR-3) is **not** readable back anywhere. The reviewer checks the asymmetry by
   eye — it is the whole of §3.7.
8. `npm run ci` green.

### 4.8 Tests

`tests/unit/signature-canonical.test.js` — **the golden digest test.** One fixed input per doc type
pinned to a literal sha256, with a comment saying what a failure means and what to do about it.

`tests/unit/signature-tokens.test.js` — mint → HMAC → lookup round-trip; a wrong pepper does not
match; a missing `SIGNATURE_TOKEN_PEPPER` fails fast at boot rather than minting unpeppered rows.

`tests/unit/signature-presets.test.js` — table-driven over the funnel: ceiling, tenant menu, sender
narrowing, empty-menu error.

`tests/unit/signature-staleness.test.js` — sign, mutate, assert `AMENDED` + one flag + idempotence.

`tests/db/signature-constraints.test.js` — `ck_sig_identity_source`, `ck_sig_mark_payload` and
`ck_sig_external_verified` reject their bad shapes at the database, not just in the validator.

`tests/unit/signature-seal.test.js` — renders the seal and asserts the §3.12 prohibitions as literal
string checks: no `VALID`, no `Praxis`, no `AES_OTP`, no IP-shaped substring. Cheap, and it is what
stops a well-meaning "let's add a green tick" from reaching a printed document.

### 4.9 Task list

1. `10740`–`10743` migrations, each with a `-- VERIFY` block.
2. `canonical.js` + the eight builders + golden fixtures.
3. `tokens.js` + the pepper env var, wired into `src/config/env.js` as **required**.
4. `presets.js` + `document_vault.types.js` ceiling fields.
5. Rewrite the six `document_signature.*` files.
6. `services/signatures/mask.js` — the only place an IP is ever formatted for display (§3.13).
7. `kit.sealBlock()` — the visual seal per §3.12, with the monochrome and no-verdict rules under
   test. **Do not** let this land as ad-hoc markup in one template.
8. Rewrite `signatures.tsx`; build the preset-card component PR-3 and the settings page both reuse.
9. `client/src/features/settings/signatures-page.tsx` + its settings-hub card (§3.11).
10. Tests per §4.8.
11. Delete nothing else yet — `document_verification` is PR-2's to replace.

**Delivered.** Three endpoints not in the original §4.4 table were needed by the screens and are
now part of the contract: `GET /signatures/reasons` (the controlled vocabulary), `GET
/signatures/presets` (the full catalogue, for Settings), and the existing `GET /signatures/menu`.

The frontend is **three files, not one**, because the card grid is shared by three audiences —
the sender here, the signer on PR-3's public page, and the administrator in Settings:

- `features/vault/signature-cards.tsx` — the card and grid components
- `features/vault/signature-vocab.ts` — the enum→English strings all three surfaces need, split out
  so the component file exports components only (React Fast Refresh breaks otherwise)
- `features/settings/signatures-page.tsx` — funnel level 2, plus the identity and verification panels

**PR-3 MUST reuse `signature-cards.tsx` on the public signing page.** Rebuilding the grid there is
how the sender and the signer end up seeing different names for the same method.

---

## 5. PR-2 — Verification portal · **DELIVERED**

**Ships:** a real QR on every rendered document, a public branded verification portal, per-doc-type
as-signed summaries, and the scan log with its notification and anomaly signal. This is the PR that
closes both structural defects from the questionnaire.

### 5.0 What actually shipped, and what changed from this specification

Five deviations, each with its reason. Everything else in this chapter shipped as written.

| Spec | Shipped | Why |
| --- | --- | --- |
| `10744`/`10745` (then `10775`/`10776`) | `10779_signature_scan`, `10780_signature_portal` | Both reserved ranges were taken by the mail programme before this chapter was written. §3.9. |
| `signature.scanned_new_ip`, `signature.scan_anomaly` | `document_signature.scanned_new_ip`, `document_signature.scan_anomaly` | The mail programme owns the `signature.*` event prefix for EMAIL signatures (10768). PR-1 already made this call for its four events (10774); splitting the namespace now would route half of one feature's events to the wrong notification bucket, since `categories.js` keys on the prefix. |
| The summary registry sits beside `DOC_TYPES` in `document_vault.types.js` | `src/services/signatures/summary.js`, with a coverage test | The stated goal — a new signable type cannot be added without someone seeing the summary slot — is enforced harder by `tests/unit/signature-summary.test.js`, which fails when a type in `SIGNATURE_CEILING` has no resolver. The code sits next to `canonical.js` instead because that is the coupling that actually bites: these resolvers read the shape those builders produce. |
| Six V1 resolvers | Eight — every signable type | `PROFORMA_ADVANCE` and `TRANSIT_ORDER` are signable, and the "unregistered type shows the verdict only" rule would otherwise have applied to two types that are perfectly summarisable. |
| The seal is rendered into the PDF | Only the **foot's** verification block is | The seal needs a placement decision per template inside a hard 34mm budget on a one-page document, and it needs the named-party attribution that PR-3's signing session produces. The foot's block delivers §5.8 criterion 1 on every doc type at once with no per-template layout risk — and it shares one renderer with the seal (`kit.verifyBlock`), so PR-3 places the seal without a second QR implementation appearing. |

**One PR-1 defect closed on the way.** `document_signature.service.loadDoc` called
`template.service.loadRecord(client, { docType, entityRef })` behind a `typeof … === "function"`
guard on a symbol that module did not export. The guard was therefore always false, every caller
landed on the `NO_DOCUMENT_LOADER` throw, and nothing failed loudly because both read paths treat a
failure to load as "cannot check". Signing over HTTP returned 422 and every status read degraded to
`UNKNOWN` — which would have made the portal's content verdict permanently unanswerable.

### 5.1 Scope

| In | Out |
| --- | --- |
| QR + short code rendered into the PDF, server-side | External signing (PR-3) |
| `/v/:code` (the QR target) and `/verify` (manual entry) | The Certificate of Completion (PR-3) |
| Per-doc-type summary resolvers (Q12 = C) | The wet-signature DataMatrix (PR-5) — different code, different payload |
| `signature_scan` + notification + anomaly signal | |
| Deleting `praxis://` and the prefix-match finding | |

### 5.2 The two defects, closed

**Defect 1 — the hash could not be printed on the document it described.** Solved by PR-1: the QR
now carries `verify_code`, minted **before** rendering, and the portal resolves the signature row
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

`basePath: "/v"` (plus `/verify` for manual entry), `feature: "signatures.portal"`, no auth,
rate-limited, and — following
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

**The summary is the document AS SIGNED — never a live query.** This is Q12 = B, and the reason is
§1.5(d): a live query lets an **old** copy disclose the **current** state. Someone holding a March
waybill scans it in September and reads today's line items, today's counterparty, today's
amendments — facts that were never on their paper.

So the summary renders from `document_signature.content_payload`, the canonical payload stored at
signing time. It cannot drift, it needs no joins, and it answers the question a verifier actually
has: *what did this person attest to?*

> **MUST NOT** query the live record to build the summary. The only live computation on this page is
> the hash comparison that produces the two verdicts above.

The amendment case gets a real before/after rather than a bare red flag: both payloads are
structured, so the portal can name the fields that changed (*"Total: 1 607 900 XAF → 1 812 400 XAF"*)
without disclosing anything the reader's own copy did not already contain.

**Per-doc-type summaries.** A resolver registry keyed by doc type, sitting beside `DOC_TYPES` in
`document_vault.types.js` so a new signable type cannot be added without someone seeing the summary
slot. Each takes the **stored payload** and returns `{ title, fields: [{label, value}], detail? }`:

- `FINAL_INVOICE` → reference, counterparty, total TTC, **line-item count**
- `DELIVERY_NOTE` → reference, counterparty, item count, delivery date
- `PURCHASE_ORDER` → reference, supplier, total
- `EMPLOYMENT_CONTRACT` → reference, role, start date, **core clause headings** (headings only —
  never clause bodies)
- `QUOTATION` / `PROPOSAL` → reference, counterparty, total, validity date

Plus, always: signer name and role, whether the name was **claimed or session-resolved** (§1.3(d)),
the preset card used, the assurance level in plain words ("verified by email code" / "certified by a
third party" / "signed by hand and reconciled" — never `AES_OTP`), the signing reason, the
timestamp, the **masked** IP per §3.13, and the tenant's legal block (`legal_name`, RCCM, NIU,
address) so a reader can reach the company directly.

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

- `client/src/features/public/verify-page.tsx` — **new**, mounted at `/v/:code` and `/verify`
  (manual code entry). Deliberately NOT under `/public/*`: this path is printed on paper and read
  aloud, so every character costs.
- `client/src/features/vault/verification.tsx` — **deleted** (addition i). Its "paste a hash" flow
  describes a mechanism this programme removes. The internal view it half-served becomes a tab on
  the signature detail: who scanned this, when, from how many distinct addresses.

### 5.8 Acceptance criteria

1. A rendered invoice PDF contains a **scannable** QR resolving to `https://…/v/{code}`,
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
4. Rewrite `document_verification.*` → `basePath: "/v"`, exact code lookup, limiter,
   `tenantDbIn("live")`.
5. Summary resolver registry + the six V1 resolvers.
6. `signature_scan` write path, notification, anomaly job.
7. `verify-page.tsx`; delete `verification.tsx`.
8. `/signatures/stats` + the hub card.
9. Tests per §3.10.

---

## 6. PR-3 — Signing sessions, OTP and the signer menu · **DELIVERED**

**Ships:** signature requests, ordered parties, the on-file/override rule, email OTP, the public
signing page where the signer picks their card, decline-with-reason, reminders, and the Certificate
of Completion.

### 6.0 What actually shipped, and what changed from this specification

Six deviations, each with its reason. Everything else in this chapter shipped as written.

| Spec | Shipped | Why |
| --- | --- | --- |
| `10746`–`10749` | `10781`–`10784` | The reserved range was taken again. Re-checked against `main` immediately before the first file, per §3.9. |
| `signature.*` events | `document_signature.*` | The mail programme owns the shorter prefix (10768), and `categories.js` keys on it. Same call PR-1 and PR-2 made. |
| The reminder carries the original link | It mints a **fresh** token and says so | §6.8 does not say what link a reminder carries, and there are only three answers. Re-sending the original is impossible by design — the plaintext is emailed once and never stored (§3.7). Sending no link makes the counterparty hunt for a five-day-old email, which is most of why they had not signed. So the reminder rotates the credential and the email states plainly that the earlier link has stopped working. Rotation is also the better security answer for a token that has been sitting in an inbox. |
| Decline reasons fetched by the signing page | Served **with** `GET /public/sign/:token` | `/signatures/reasons` is MOD-64 `view` behind `authMiddleware`, and the counterparty has no account. Opening a second anonymous endpoint to serve five labels would be a second surface to limit, log and reason about, for data the page is already making a round trip for. |
| Step-up compares a caller-supplied `totalXaf` | Derived from the canonical payload | PR-1's `stepUpRequired({ totalXaf })` meant every caller had to compute the same figure the same way, and one that passed zero silently skipped the control. It now reads the total the signature actually attests to, rounding included. The old signature is kept for back-compat and marked as such. |
| The certificate is a queued job | Generated in the request path, best-effort against the signature | With no PAdES seal the certificate IS the evidentiary case, so a queue that is down means a completed chain with no evidence and nobody watching. It is idempotent on `request_id`, so a retry is free — and `POST /signature-requests/:id/certificate` recovers one that failed. It is deliberately best-effort *against the signature*: failing the counterparty's request because a renderer hiccuped would lose an act that has already legally happened. |

**Two defects found by the new tests, not by review.** The certificate's local timestamp was
silently empty — `Intl.DateTimeFormat` throws when `timeZoneName` is combined with `dateStyle`, and
the surrounding catch swallowed it, so every certificate would have printed a UTC stamp beside a
blank one. And the step-up threshold compared against a raw column rather than the rounded canonical
figure.

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
programme where a signer supplies the address their own OTP is sent to.

What the external signer **may** fill in: their **name** and **role**, which is what the seal prints.
What they **may not** touch: the **email**. The signing page renders it read-only and partially
masked — *"We sent a code to j••••@acme.cm. If you are the authorised signatory, enter it below."*
— so they can confirm it is theirs without being able to change it. If it is wrong, the sender
reissues, which is exactly the audit behaviour you want.

> This is the `identity_source = 'DECLARED'` case, and §1.3(d)'s rule applies verbatim: **the name is
> claimed, the email is proved.** The portal and the certificate say so in those terms rather than
> presenting a typed name as though the system had verified it.

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

Per Q1, every completion path passes through verification: `STAMP` and `DRAWN` both require a
verified OTP before `/complete` will accept, with **no threshold and no setting that disables it**
(§1.5(b); the `ck_sig_external_verified` constraint in §4.2 enforces it below the service layer). `CERTIFIED` hands off to the provider (PR-4), which
does its own identity check. `PRINT_SIGN` issues a print job (PR-5) and settles out of band.

> **MUST.** `/complete` re-derives the canonical hash and compares it to
> `signature_request.content_hash`. Mismatch → `409 DOCUMENT_AMENDED`, the request moves to
> `AMENDED`, every already-signed party is notified, a `compliance_flag` is raised. This is §1.3(a),
> and it is what stops party B signing something party A never saw.

**The sender signs first — confirmed, and it is the default.** Your Q7 described exactly this:
*"our tenant's Commercial Director signs first, then routes it to the client's Procurement Manager."*
That is a party like any other — `party_kind = 'ISSUER'`, `sequence_no = 1`, `identity_source =
'SESSION'` — and the model already carries it with no special case.

Two consequences worth stating because they are easy to get wrong:

- **The issuer signs *before* dispatch, not after.** `POST /signature-requests/:id/dispatch` refuses
  with `409 ISSUER_NOT_SIGNED` while an `ISSUER` party at `sequence_no = 1` is still `PENDING`. A
  counterparty must never receive a link to countersign a document the issuing company has not
  signed — that is how a document goes out attested by nobody.
- **The issuer signs through the internal path** (`POST /signatures/internal`, session identity,
  step-up per §6.5), not through a signing link. They are already authenticated; emailing them a
  token would be theatre. The service resolves their `ISSUER` party row and settles it.

An issuer-signs-first chain therefore runs: staff signs internally → dispatch → counterparty gets the
link → optional second counterparty (the one override, Q7) → certificate.

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

1. **Dispatch confirmation** (Q15, narrowed in Round 2). The tenant absorbs the provider cost in
   its own service pricing, so there is **no client-facing fee and no charge consent**. The modal is
   informational: *"This will be sent for certified signature and will use one certified envelope
   from your monthly allowance."* No figure, no `424` blocker — §1.4(b) is closed.

   > **Deleted from the original spec:** the fee modal, the `final_invoice` rebill integration, the
   > disputed-line-item path, and the per-tenant `qes_unit_fee` setting. Metering survives, but it
   > serves **Praxis→tenant** billing only, at a platform rate (§7.5).
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
   and **leaves the ledger row in place** — the provider consumed the quota whatever we do. Do not
   add a refund path; that was decided. Since nothing is billed onward to the tenant's client, this
   is now purely an internal accounting fact.

**Evidence mirroring.** The provider's audit certificate is fetched and vaulted, not linked. A link
to a third party's dashboard is worthless in year seven when the contract has lapsed. Our own
Certificate of Completion (§6.7) references the mirrored vault copy.

### 7.5 Metering and platform wallet monitoring (Q15)

There is exactly **one** billing relationship in scope: **Praxis → tenant**. The tenant → client
relationship was deleted in Round 2 (the tenant absorbs the cost), which removes an entire
subsystem.

`signature_usage_ledger` therefore meters for Praxis's own billing, not for a client invoice. The
unit rate is a **platform** setting (`platform.qes_unit_cost`), not a tenant one — a tenant cannot
set the price Praxis charges it, and no tenant needs to see the figure at all.

`qes-quota-scheduler` (daily) sums envelopes created this calendar month across all tenants against
`platform.qes_monthly_quota`, and emits `qes.quota_low` at 80% and again at 95% to the platform
alert-routing service. This stays **platform-tier**: the free-tier allowance belongs to the Praxis
account, and one tenant must never see another's consumption.

Each tenant sees only its own count, read-only, on the `/settings/signatures` "Certified signatures"
panel (§3.11).

### 7.6 Acceptance criteria

1. The dispatch confirmation shows no monetary figure, and dispatch succeeds with no fee setting
   configured — the `424 CONFIG_MISSING` path is gone (Round 2).
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
7. The informational dispatch confirmation + the read-only tenant usage panel (§3.11 panel 4).
8. Tests per §7.6, with the adapter stubbed — no live API calls in CI.

---

## 8. PR-5 — Tier 4: the wet signature and reconciliation · **DELIVERED**

**Ships:** a discreet DataMatrix on printed documents, three inbound routes, server-side barcode
decoding, corroborated auto-reconciliation, and an unreconciled-after-N-days compliance rule.

**Delivered in this PR:** `10788`–`10791`, the DataMatrix generator/decoder, the wet-signature
print-job and ingest APIs, auto/manual review queue primitives, and the RED
`signature.wet_unreconciled` checker rule. PR-4 is proceeding in parallel, so this PR deliberately
uses only the wet-signature migration range and does not touch the QES provider files.

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
| `10771_signature_core.sql` | 1 ✅ | `document_signature` reshaped from the `0410` stub |
| `10772_signature_presets.sql` | 1 ✅ | `signature_preset` + the four seeded cards, `signature_reason` |
| `10773_signature_policy_seed.sql` | 1 ✅ | `signature_policy` settings seed per doc type |
| `10774_document_signature_events.sql` | 1 ✅ | `document_signature.signed / revoked / amended / stale_detected` |
| `10779_signature_scan.sql` | 2 ✅ | `signature_scan` |
| `10780_signature_portal.sql` | 2 ✅ | `signatures.*` feature switches, `verify_base_url`, `document_signature.scanned_new_ip / scan_anomaly` |
| `seeds/9115_seed_signature_features.sql` | 2 ✅ | `platform.feature_catalogue` rows for the four `signatures.*` flags, and their plan inclusion |
| `10781_signature_request.sql` | 3 ✅ | `signature_request` + FK from `document_signature` |
| `10782_signature_party.sql` | 3 ✅ | `signature_party` + the one-override index |
| `10783_signature_otp.sql` | 3 ✅ | `signature_otp` + FK from `document_signature` |
| `10784_signature_certificate.sql` | 3 ✅ | `certificate_doc_id`, reminder counters, 8 events, the DECLINE reason vocabulary |
| `10785_qes_envelope.sql` | 4 | `qes_envelope` |
| `10786_signature_usage_ledger.sql` | 4 | `signature_usage_ledger` |
| `10787_qes_events.sql` | 4 | `qes.*` events |
| `10788_signature_print_job.sql` | 5 | `signature_print_job` |
| `10789_signature_ingest.sql` | 5 | `signature_ingest` |
| `10790_signature_wet_events.sql` | 5 | `document_signature.printed / scanned_returned / reconciled / reconcile_review` |
| `10791_signature_unreconciled_rule.sql` | 5 | the compliance rule row |

> These numbers are a PLAN. Re-check `migrations/tenant/` and run
> `node scripts/db/check-migration-numbers.js` immediately before writing each file — the range has
> now been taken out from under this programme twice.

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
GET    /signatures/:id/scans              MOD-64 view   ← who verified this, when, from how many networks
```

**Public** (no auth; token is the credential; rate-limited; `tenantDbIn("live")`):

```
GET    /v/:code                            (the QR target and the typed code)
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
| `verify_base_url` | `null` | Override the host a printed QR resolves on; `null` uses the host the render's request arrived on (§5.2) |
| `reminder_days` | `[2, 5]` | Reminder schedule; `[]` disables |
| `certificate_full_ip` | `false` | Unmask the IP on the Certificate of Completion (§3.13) |
| `sign_reasons` | seeded | The controlled reason vocabulary the seal prints (§3.12) |
| `unreconciled_days` | `7` | Before the RED compliance flag |

### 9.5 Environment

```
SIGNATURE_TOKEN_PEPPER            required, ≥32 bytes. Env only, never the tenant DB.
                                  Protects SIGNING tokens only (§3.7).
SIGNATURE_TOKEN_PEPPER_PREVIOUS   optional, dual-read window during rotation
PUBLIC_PORTAL_BASE_URL            the https origin printed into QR codes
```

**Pepper rotation** (manual in V1): set `_PREVIOUS` to the outgoing value, deploy, let open signature
requests drain, then clear `_PREVIOUS`. After Round 2's Q11 = B this is a **small** operation —
it invalidates in-flight signing links only. **Printed QR codes are unaffected**, because verify
tokens are stored in plaintext and were never peppered. (The first draft of this guide had it as the
most destructive operation in the programme; that was a consequence of peppering the verify token,
and it is gone.)

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
