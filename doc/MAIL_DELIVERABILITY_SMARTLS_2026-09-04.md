# Mail deliverability — smartls.cm · findings and decisions

**Date:** 2026-09-04 · **Branch:** `claude/smartls-email-delivery-zou5ax` · **Status:** root cause proven, fixes pending decisions below

**Two objectives.**

1. **Delivery** — mail the system sends must reach `@smartls.cm` recipients.
2. **Connection** — a `@smartls.cm` user must be able to connect their mailbox to Smart Mail.

These have **two different root causes**. Fixing one does not fix the other.

---

## 1. Verdict

| # | Objective | Root cause | Where it lives |
| - | --------- | ---------- | -------------- |
| 1 | Delivery | The outbound relay treats `smartls.cm` as a **local domain** and delivers to a mailbox on itself instead of routing to Microsoft. Accepted, logged SENT, never delivered, never bounced. | cPanel/Exim on `37.59.83.88` — **not our code** |
| 2 | Connection | Microsoft 365 mailboxes are **gated off** in the product, and the fallback route it recommends (IMAP/SMTP + password) **no longer exists at Microsoft**. | Our code — `mail.service.js`, feature flag |

Neither is a bug in the mail-sending logic. Objective 1 is a hosting misconfiguration; objective 2 is unfinished product work plus an industry deadline that has passed.

---

## 2. The evidence chain (objective 1)

Five independent confirmations. Any one is suggestive; together they are conclusive.

**2.1 — DNS shows the collision.** The relay and the recipient domain are the same machine.

```
srv-web-ns9.newtoncorp.fr   A  → 37.59.83.88     ← the relay
mail.praxisls.com           A  → 37.59.83.88     ← same box
mail.jbspraxis.com          A  → 37.59.83.88     ← same box
smartls.cm                  A  → 37.59.83.88     ← same box
smartls.cm                  MX → smartls-cm.mail.protection.outlook.com   ← mail lives at Microsoft
cpanel/whm/webmail/webdisk.smartls.cm → 37.59.83.88   ← full cPanel footprint
```

**2.2 — The behavioural signature.** Mail from the system to `@smartls.cm` addresses that exist as **local cPanel mailboxes** arrives perfectly. Mail to `@smartls.cm` addresses that exist **only at Microsoft** vanishes with no bounce. Mail from Gmail to the same Microsoft-only address arrives normally, because Gmail is external and performs an ordinary public MX lookup.

**2.3 — The message was found in a local mailbox.** A test message sent from the product to `franco@smartls.cm`, reported **Sent**, was located in Roundcube on `srv-web-ns9.newtoncorp.fr` — a local mailbox on the relay, not at Microsoft.

**2.4 — Local mail stores exist for the domain.** They should not exist at all if the domain were routed remotely.

```
/home/smartqaq/mail/smartls.cm/franco     104K
/home/smartqaq/mail/smartls.cm/no-reply   200K
```

`~/etc/smartls.cm/passwd` lists exactly two local accounts — `no-reply` and `franco`. **`timothee` is not among them**, which is precisely why his mail disappears: the server believes it owns the domain, finds no local mailbox, and the account's default-address rule disposes of the message.

**2.5 — The message's own headers, which settle it.** Two `Received` hops, and no Microsoft:

```
Received: from srv-web-ns9.newtoncorp.fr
          by srv-web-ns9.newtoncorp.fr with LMTP        ← hop 2: LOCAL delivery to a Maildir
          for <franco@smartls.cm>; Fri, 04 Sep 2026 15:32:35 +0200
Received: from [51.254.165.120] (port=42308 helo=[127.0.0.1])
          by srv-web-ns9.newtoncorp.fr with esmtpsa (TLS1.3) (Exim 4.99.5)
          for franco@smartls.cm;                        ← hop 1: app server → relay
X-Praxis-Tenant: smartls
X-Praxis-Send-Point: user.compose
```

App server → relay → local Maildir. The journey ends on the relay. **There is no hop to `smartls-cm.mail.protection.outlook.com`, and no bounce, because from Exim's point of view nothing failed.**

**2.6 — Mechanism.** A cPanel server records every domain it hosts in `/etc/localdomains` and from then on stops consulting DNS for it. `smartls.cm` was added to the box when the website was set up; the MX was pointed at Microsoft *afterwards*, and nothing told the server. The setting is per-domain and is exposed as **cPanel → Email → Email Routing**: `Local Mail Exchanger` (current, wrong) vs `Remote Mail Exchanger` (correct).

> The shell checks against `/etc/localdomains` and `exim -bt` could not be run: the box uses **CloudLinux CageFS**, so the account's shell sees a virtualised `/etc` and neither those files nor `exim`/`cpapi2` are inside the cage. This blocks confirmation *by that route only* — 2.1 through 2.5 are unaffected.

**SMTP2GO is not involved in this failure.** The message never left the relay, so no upstream provider ever saw it. Suppression lists, reputation and DNS authentication are all downstream of a hop that never happened.

---

## 3. Objective 2 — why a `@smartls.cm` user cannot connect a mailbox

Three blockers, stacked. All three must clear.

1. **The provider is gated off.** `src/modules/mail/mail/mail.service.js` gates `microsoft_graph` and `google_gmail` behind the `feature_state` row `mail.provider.oauth`, seeded `off` in `migrations/tenant/10730_mail_defaults_and_flags.sql`. The Microsoft path returns **403 PROVIDER_NOT_ENABLED**.
2. **No Azure app exists.** Even with the flag on, `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_CLIENT_SECRET` (`src/config/env.js:694`) are empty. The Graph adapter and OAuth module are **built and unit-tested** — this is configuration, not development.
3. **The recommended fallback is impossible.** The gated error told users to connect over IMAP/SMTP instead. For a Microsoft-hosted domain that route is closed:
   - Exchange Online removed Basic auth for **IMAP/POP in 2022**.
   - Basic auth for **SMTP AUTH was retired 30 April 2026** — that date has passed.
   - **App Passwords were built on Basic auth and died with it.**

   There is no password, app password or setting that connects a Microsoft 365 mailbox today. OAuth is the only route. Worse, the host a user would naturally enter — `mail.smartls.cm` — is a CNAME to `smartls.cm` → **37.59.83.88, our relay**. They would authenticate against a *local* mailbox and see an empty inbox that looks like a working connection.

**This is not specific to smartls.** *Every* tenant on Microsoft 365 is currently unconnectable. `autodiscover.js` already detects Microsoft correctly from the MX and returns `oauth_hint: "microsoft_graph"` — detection was never the problem.

---

## 4. Secondary findings

Real, and each one will bite once mail starts flowing. None caused the smartls failure.

| # | Finding | Evidence | Impact |
| - | ------- | -------- | ------ |
| S1 | **The app announces `HELO [127.0.0.1]`** | `helo=[127.0.0.1]` in the header above | A localhost literal in HELO is a classic spam signal. Neither `email.service.transportFrom()` nor `imapSmtp._smtpTransport()` sets nodemailer's `name`. Harmless while delivery is local; **penalised by Microsoft and Google the moment mail actually routes out.** |
| S2 | **`praxisls.com` has no SPF record at all** | Live TXT is only `brevo-code:…` | Nothing authorises any sender for the domain. |
| S3 | **The cPanel Zone Editor for `praxisls.com` edits a dead zone** | cPanel claims `ns1/ns2.newtoncorp.net`; live NS is **Cloudflare** (`aragorn`/`melissa.ns.cloudflare.com`) | Every praxisls.com DNS edit made in cPanel has gone nowhere. cPanel showed an SPF record that does not exist publicly. **Use Cloudflare only.** |
| S4 | **PTR does not match the HELO name** | `37.59.83.88` → `ip88.ip-37-59-83.eu`, host calls itself `srv-web-ns9.newtoncorp.fr` | Moderate spam signal; shared-host PTR is not ours to set. |
| S5 | **`webmail.praxisls.com` is Cloudflare-Proxied** | Orange cloud in the Cloudflare DNS list | The proxy does not carry ports 993/2096. Should be **DNS only**. |
| S6 | **`no-reply@smartls.cm` holds 200K of unread local mail** | `~/mail/smartls.cm/no-reply` | Unknown content, accumulating since at least July. Worth reading before anything is deleted. |
| S7 | **Brevo remnants** | `brevo1/brevo2._domainkey`, `no-reply.praxisls.com`, `brevo-code` TXT, DMARC `rua` → Brevo | Now removed from the codebase; **still live in Cloudflare DNS.** |

---

## 5. Already done (commit `2ee5c28`, pushed)

Lint clean, **full suite green: 7,155 tests passing**.

- **`src/modules/mail/deliverability/route-check.js`** *(new)* — detects this exact trap from DNS alone: the relay hosts the recipient domain **and** that domain's MX points elsewhere. Both halves required, so a domain whose mail legitimately lives on the relay is not flagged. Any lookup failure yields `UNKNOWN`, never a false accusation. Verified against live DNS: `smartls.cm → LOCAL_TRAP`, `jbspraxis.com → OK`, `gmail.com → OK`. 8 unit tests, network-free.
- **`autodiscover.js`** — extracted `hostedProviderOf()` over the MX patterns already present, so one list answers both "what transport settings?" and "who runs this mailbox?" instead of two copies drifting.
- **`mail.service.connect()`** — refuses `imap_smtp` + password when the MX is Microsoft or Google, before writing a row or vaulting a secret, with a message that explains why. Fails open on resolver error. The gated-provider message no longer recommends a route that does not exist.
- **`doc/INTEGRATION_PLAN.md`** — Brevo removed (it was documentation-only; never in code or config). Transport recorded as SMTP2GO, with a note on why the relay must never be a machine that hosts tenant domains.

---

## 6. Decisions needed

Ten questions. Each changes what gets built or configured next.

---

### Q1 — The Email Routing switch, and the two local mailboxes

Flipping `smartls.cm` to **Remote Mail Exchanger** fixes delivery immediately, and instantly stops local delivery for `franco@` and `no-reply@` (304K of existing mail).

- **(a) Forward, then switch** — set both local mailboxes to forward to their Microsoft equivalents, confirm, then switch routing. *Nothing is lost, no downtime.*
- **(b) Export, then switch** — download both Maildirs, switch, delete local accounts.
- **(c) Switch now, deal with the mailboxes after.** *Fastest; risks the 304K.*

> **Recommendation: (a).** Read `no-reply@`'s 200K first (S6) — you do not yet know what has been accumulating there since July.

---

### Q2 — The outbound relay architecture ⭐ *most consequential*

Fixing routing for `smartls.cm` fixes **one domain**. The relay is a shared cPanel box that hosts tenant websites, so **every future tenant who hosts their site with you and their mail elsewhere reproduces this bug exactly.**

- **(a) Keep the cPanel relay, fix routing per-domain as it arises.** *Zero work now; the trap stays armed and silent.*
- **(b) Move system email to SMTP2GO; leave user mailboxes on their own providers.** *Removes the trap structurally for system mail. Credentials-only change — `transportFrom()` is unchanged.*
- **(c) Move everything, including relayed mailbox sending, to SMTP2GO.** *Maximum consistency; changes how user mail is sent and how it authenticates.*

> **Recommendation: (b).** The DKIM and return-path records for SMTP2GO are **already live** on all three domains — the setup is done, it is simply not being used. This is the structural fix, and it also resolves S1, S2 and S4 in one move, because SMTP2GO owns the HELO, the IP and the reputation.

---

### Q3 — How Microsoft 365 mailboxes connect

- **(a) Microsoft Graph API** — the adapter is built, unit-tested, and supports push, delta sync and server-side threads.
- **(b) Add XOAUTH2 to the existing IMAP/SMTP provider** — smaller conceptual surface, reuses the IMAP engine, but no push/delta and the provider currently has no OAuth support at all.
- **(c) Both**, Graph preferred with IMAP-XOAUTH2 as fallback.

> **Recommendation: (a).** It is written and tested; (b) would be new work to reach a worse result.

---

### Q4 — Azure app registration model

- **(a) One multi-tenant app** (`MS_GRAPH_TENANT=common`, the current default) — each customer's admin consents once. *One registration serves every tenant.*
- **(b) Single-tenant app per customer** — a registration inside each customer's Entra tenant.
- **(c) Per-tenant registration stored in the tenant vault** — maximum isolation, most operational overhead.

> **Recommendation: (a).** Matches the existing default and the white-label multi-tenant model. Note it requires publisher details and a privacy-policy URL on the app.

---

### Q5 — Graph permissions

- **(a) Delegated permissions** — the coded scopes (`Mail.Read`, `Mail.Send`, `Mail.ReadWrite`, `offline_access`). Each user consents to their own mailbox.
- **(b) Application permissions** — the app reads any mailbox in the tenant, one admin consent, no per-user step. *Powerful; many IT teams refuse it.*
- **(c) Delegated, with admin consent granted tenant-wide** so individual users are not prompted.

> **Recommendation: (c).** It is (a)'s code path with a smoother rollout. Expect SmartLS's IT to require admin consent regardless — many tenants block user consent by policy.

---

### Q6 — What address does *system* email for tenant `smartls` send from?

`resolveMail()` resolves a transport whole: a tenant-domain From is only used when the tenant supplies their own SMTP host, otherwise the Praxis fallback sender wins (SPF/DKIM alignment).

- **(a) `@praxisls.com` fallback** — works today, needs nothing from SmartLS. Mail reads as coming from Praxis.
- **(b) `@smartls.cm`, sent via SMTP2GO** — white-label correct. SMTP2GO DKIM is **already published** on `smartls.cm`; needs their SPF to include SMTP2GO.
- **(c) `@smartls.cm` via their own Microsoft 365 SMTP** — requires OAuth SMTP and per-tenant credentials.

> **Recommendation: (b).** White-labelling is the product's core promise, and their DNS is already 90% of the way there.

---

### Q7 — Google Workspace at the same time?

The `mail.provider.oauth` flag currently gates Microsoft **and** Google together.

- **(a) Microsoft only** — split the flag, ship Microsoft now.
- **(b) Both together** — one release.
- **(c) Both, behind separate flags.**

> **Recommendation: (a) or (c).** Google's restricted-scope verification (`Mail.Read` equivalents) needs a security assessment that takes weeks. Coupling them delays Microsoft for no benefit.

---

### Q8 — Rollout scope for the flag

- **(a) On for all tenants at once.**
- **(b) On for `smartls` only, then widen once a real mailbox is connected.**
- **(c) Keep it a per-tenant toggle in the Platform Console.**

> **Recommendation: (b), then (c).** Prove it against Timothée's real mailbox before exposing it everywhere; keep the per-tenant control permanently.

---

### Q9 — DNS work on Cloudflare for `praxisls.com`

All of this is **Cloudflare only** — the cPanel Zone Editor is a dead end (S3). Content depends on Q2.

- **(a) Minimum** — delete Brevo records, fix DMARC `rua`, un-proxy `webmail`.
- **(b) (a) + SPF for the current reality** — `v=spf1 include:spf.smtp2go.com ip4:37.59.83.88 ~all`.
- **(c) (b) + tighten DMARC to `p=quarantine`** once SPF and DKIM are confirmed aligned.

> **Recommendation: (b) now, (c) after two weeks of clean DMARC reports.** Never tighten DMARC before you have evidence.

---

### Q10 — What should the system do when `route-check` returns `LOCAL_TRAP`?

The detector exists; its consequence is undecided.

- **(a) Surface it** in the deliverability dashboard and the mail setup wizard. *Informative; a busy admin may not look.*
- **(b) Surface it and fail the send** with a clear error, recording `FAILED` rather than a false `SENT`. *Loud. The real harm here was silent success, and a visible failure is strictly better than a lie.*
- **(c) Surface it and auto-reroute** that recipient via the platform fallback relay. *Self-healing; most complex, and hides a misconfiguration that ought to be fixed.*

> **Recommendation: (b).** The entire cost of this incident was that the system reported success. Refusing loudly is the correct opposite. (c) is attractive but re-introduces "it works, nobody knows why" — and if Q2 = (b), the trap largely disappears anyway.

---

## 7. What happens after you answer

I will produce a second document, `MAIL_REMEDIATION_RUNBOOK.md`, with exact click-by-click steps per platform — cPanel (routing, forwarders, default address), Cloudflare (record-by-record), Azure/Entra (app registration, scopes, redirect URIs), SMTP2GO (sender domains, credentials), and the Praxis Platform Console — plus the code changes the answers imply, tested and pushed.

**Fastest path to objective 1:** Q1 alone fixes delivery to `smartls.cm` today. Everything else is durability and objective 2.
