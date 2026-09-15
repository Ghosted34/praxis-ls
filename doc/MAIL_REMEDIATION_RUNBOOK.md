# Mail remediation runbook

**Companion to** `MAIL_DELIVERABILITY_SMARTLS_2026-09-04.md` · **Branch** `claude/smartls-email-delivery-zou5ax`

Decisions taken: Q1 delete + switch · Q2 system mail → SMTP2GO · Q3 Graph · Q4 multi-tenant app · Q5 delegated + admin consent · Q6 `@smartls.cm` via SMTP2GO, `@praxisls.com` fallback · Q7 Microsoft only · Q8 smartls (the only tenant) · Q9 SPF now, DMARC later · Q10 fail loudly.

Phases are ordered by dependency. **Do not skip the verification at the end of each** — every one of them exists because something in this incident looked fine and was not.

> **First, the answer to "Microsoft or SMTP2GO?"** — both, on different paths, and they never overlap.
>
> | Path | What it carries | Who sends it |
> | ---- | --------------- | ------------ |
> | **System email** | OTPs, invites, password resets, invoices, notifications | Praxis → **SMTP2GO** |
> | **User mailbox** | A person composing or replying in Smart Mail | That person's own provider — **Microsoft**, once connected via Graph |
>
> System email must never depend on a connected mailbox. If it did, a user who cannot log in could not receive the password reset that would let them, because connecting the mailbox requires logging in. That is why Q6 is "@smartls.cm **via SMTP2GO**" and not "via their Microsoft 365" — the From address is theirs, the transport is ours.

---

## Phase 0 — Deploy the code first (5 min)

The guard added in `ef2dfef` refuses any recipient it can prove the relay would swallow. Deploying it **before** Phase 1 means that if anything is missed, mail fails visibly instead of silently.

1. Merge/deploy `claude/smartls-email-delivery-zou5ax`.
2. Run the tenant migration `12775` and seed `9131`.
3. Set on the API host, then restart:

```bash
MAIL_HELO_NAME=srv-web-ns9.newtoncorp.fr     # until Phase 2; then the SMTP2GO host
```

**Verify:** send anything to a `@smartls.cm` address. It should now **fail** with `MAIL_ROUTE_TRAPPED` naming `smartls-cm.mail.protection.outlook.com`. A visible failure here is the correct result — it proves the guard sees what we see.

---

## Phase 1 — cPanel: stop the swallowing ⚡ *this is the fix*

**Where:** cPanel account `smartqaq` on `srv-web-ns9.newtoncorp.fr`.

1. **Email → Email Accounts** — delete `franco@smartls.cm` and `no-reply@smartls.cm`. Confirmed empty and unused; the 104K/200K on disk is Maildir overhead and one cPanel config notice.
2. **Email → Default Address** — select `smartls.cm`. Note what it says (this is what has been discarding Timothée's mail). Set it to **Discard with an error to the sender**, not silent discard. Once Phase 1 is done nothing should reach it — but if anything ever does, a bounce beats silence.
3. **Email → Email Routing** — select `smartls.cm` → **Remote Mail Exchanger** → Change.

**No downtime for the Microsoft users.** They currently receive *nothing* from the system; this can only improve. The only delivery that stops is to the two local mailboxes being deleted in step 1.

**Verify — all three:**

```bash
# From the Praxis app, send to a Microsoft-only address:
#   timothee.massomba@smartls.cm   → must ARRIVE in Outlook

# The message headers must now show a hop to Microsoft:
#   Received: from ... by smartls-cm.mail.protection.outlook.com

# And nothing new may appear locally:
ls -la ~/mail/smartls.cm/     # should be gone, or empty
```

Ask SmartLS's IT to run a **Microsoft 365 Message Trace** for your sender. It must now show the message. Before Phase 1 it showed nothing at all.

---

## Phase 2 — SMTP2GO: take the relay out of the loop (Q2)

Phase 1 fixes **one domain**. This removes the trap structurally for every future tenant who hosts their site with you and their mail elsewhere.

**In the SMTP2GO dashboard:**

1. **Sender domains** — confirm `praxisls.com`, `smartls.cm` and `jbspraxis.com` all show **verified**. Their DKIM (`s518161._domainkey`) and return-path (`em518161`) CNAMEs are already live on all three, so this should already be green.
2. **Sending → SMTP Users** — create a user for Praxis. Record host, port, username, password.
3. **Reports → Suppressions** — search `smartls.cm` and clear any entries. Nothing should be there (the mail never reached SMTP2GO), but clear it if it is.

**In the Praxis Platform Console → Integrations → Mail fallback:**

Set host `mail.smtp2go.com`, port `587`, and the SMTP user/password from step 2. This is stored **encrypted in the `platform_setting` vault** and takes precedence over `.env` — which is exactly the design you described. Use **Test** before saving.

Then update the API host and restart:

```bash
MAIL_HELO_NAME=mail.smtp2go.com
```

**Verify:** send a system email (a password reset is the easiest) to a Gmail address. Open the raw headers: the first `Received` should name an SMTP2GO host, **not** `srv-web-ns9.newtoncorp.fr`, and `helo=` must no longer be `[127.0.0.1]`.

> After this, `SMTP_HOST` in `.env` is genuinely a last-resort fallback. Leave it pointing somewhere sane, but the console is authoritative.

---

## Phase 3 — Cloudflare DNS for `praxisls.com` (Q9)

**Cloudflare only.** The cPanel Zone Editor for this domain edits a zone Cloudflare has not been authoritative for — every edit made there has gone nowhere.

**Delete** (Brevo is gone):

| Name | Type |
| ---- | ---- |
| `brevo1._domainkey` | CNAME |
| `brevo2._domainkey` | CNAME |
| `no-reply.praxisls.com` | CNAME |
| `praxisls.com` `"brevo-code:a7f581…"` | TXT |

**Change:**

| Name | Type | Value |
| ---- | ---- | ----- |
| `_dmarc.praxisls.com` | TXT | `v=DMARC1; p=none; rua=mailto:postmaster@praxisls.com` |
| `praxisls.com` | TXT | `v=spf1 include:spf.smtp2go.com ip4:37.59.83.88 ~all` ← **new; there is no SPF today** |
| `webmail.praxisls.com` | A | unchanged — but set **DNS only** (grey cloud). The proxy does not carry 993/2096. |

Keep `s518161._domainkey`, `em518161` and `link.praxisls.com` — those are SMTP2GO and in use.

**In two weeks**, once DMARC reports are clean, tighten to `p=quarantine`. Not before — you need the evidence first.

**Verify:**

```bash
node -e 'const d=require("dns").promises;(async()=>{
  console.log("SPF  ", await d.resolveTxt("praxisls.com"));
  console.log("DMARC", await d.resolveTxt("_dmarc.praxisls.com"));
})()'
# SPF must exist. DMARC must no longer mention brevo.
```

---

## Phase 4 — Azure: review the app you already registered

**Praxis LS Mail** · client `9204abca-2794-4ebf-a8f9-94ed81109686` · directory `79026958-5eae-4dcd-8848-ec73ef5e0041`. Registered and Activated — good. Four things to check before it will work.

### 4a. Redirect URI — one canonical apex URI, and the env var that makes it work

> **Corrected.** An earlier draft of this runbook said to register the tenant
> subdomain and leave `MS_GRAPH_REDIRECT_URI` unset, warning about Azure's
> 256-URI cap as tenants are added. That was wrong, and following it would have
> produced `AADSTS50011`. The codebase already solves multi-tenant OAuth
> properly, and the apex URI below is the intended design.

`host-tenent-resolver.js:36-73` resolves the tenant for an OAuth callback from
the **signed `state` token**, not from the host — and it does so *before* the
platform-host short-circuit, with the comment "the canonical redirect URI
typically lives on the apex / a platform host". So one URI serves every tenant,
for ever, and Azure's cap never comes into it.

Register exactly this, once:

```
https://praxisls.com/api/tenant/mail/oauth/microsoft/callback
```

**And it only works if the env var is SET**, which is the half that is easy to
miss. `mail.controller.js:23` reads:

```js
config.MS_GRAPH_REDIRECT_URI || `${req.protocol}://${req.get("host")}${req.baseUrl}/oauth/microsoft/callback`
```

Left unset, the fallback derives the URI from the *request* host. A user
connecting from `smartls.praxisls.com` would send that as `redirect_uri`,
Microsoft would compare it against the registered apex URI, and reject the
sign-in with **AADSTS50011**. So set it on the API host:

```bash
MS_GRAPH_REDIRECT_URI=https://praxisls.com/api/tenant/mail/oauth/microsoft/callback
```

It must match the registered value byte for byte — scheme, host, path, no
trailing slash.

### 4b. API permissions — most likely what is missing

**API permissions → Microsoft Graph → Delegated**, add exactly:

```
offline_access   User.Read   Mail.Read   Mail.Send   Mail.ReadWrite
```

Then **Grant admin consent** (Q5 = C). Expect SmartLS's own IT to have to consent inside *their* tenant too — most organisations block user consent by policy.

### 4c. Client secret — set a reminder today

"0 certificate, 1 secret". **When that secret expires, every connected mailbox stops syncing** — and it will look like a bug, not a calendar event. Record the expiry date now and set a reminder a month ahead. Given everything this incident was about, do not let the next silent failure be one you scheduled.

### 4d. Account types

"All Microsoft account users" maps to `MS_GRAPH_TENANT=common` — correct, and it works. It also permits **personal** accounts (outlook.com, hotmail.com) to be connected as work mailboxes. If you would rather only allow organisational accounts, switch to "Accounts in any organizational directory" and set `MS_GRAPH_TENANT=organizations`. Optional.

*(The ADAL banner is informational. The code calls `login.microsoftonline.com/{tenant}/oauth2/v2.0` directly — v2.0 endpoints, not ADAL. Nothing to do.)*

### Deploy env

```bash
MS_GRAPH_CLIENT_ID=9204abca-2794-4ebf-a8f9-94ed81109686
MS_GRAPH_CLIENT_SECRET=<the secret value — never commit this>
MS_GRAPH_TENANT=common
MS_GRAPH_REDIRECT_URI=https://praxisls.com/api/tenant/mail/oauth/microsoft/callback
# MS_GRAPH_SCOPES — the default already matches 4b
```

---

## Phase 5 — Turn Microsoft on for smartls (Q7, Q8)

With one tenant, "all tenants" and "smartls only" are the same operation — `feature_state` is a per-tenant table, so this *is* per-tenant, and stays that way as you add more.

**Platform Console → the smartls tenant → Features → `mail.provider.microsoft` → on.**

Leave `mail.provider.google` off. 12775 split them precisely so Google's restricted-scope verification does not hold Microsoft back.

**Verify, end to end:**

1. Smart Comms → Setup → Connections → **Connect Microsoft 365** (the button is restored).
2. Consent as `timothee.massomba@smartls.cm`.
3. Land back on Connections with the mailbox **Connected**.
4. Send from it, and reply to a thread. Both should leave via Graph.

If the button 403s with `PROVIDER_NOT_ENABLED`, the flag did not take. If it fails at Microsoft with `AADSTS50011`, the redirect URI in 4a does not match exactly — including scheme and trailing path.

---

## Order and rollback

| Phase | Time | Reversible? |
| ----- | ---- | ----------- |
| 0 Deploy code | 5 min | Yes — redeploy previous |
| 1 cPanel routing | 5 min | Yes — set back to Local Mail Exchanger |
| 2 SMTP2GO | 30 min | Yes — point the console back at the old relay |
| 3 Cloudflare | 15 min | Yes — records are re-addable (screenshot them first) |
| 4 Azure | 20 min | Yes — permissions and URIs are editable |
| 5 Flag on | 1 min | Yes — flag off |

**Phases 0 and 1 alone achieve objective 1.** Everything after is durability and objective 2. If time is short, do those two today and the rest this week.

---

## What is now guarded in code

So this class of failure cannot recur silently:

- **`route-check.js`** proves the trap from DNS alone and is wired into **both** send paths — `email.service.send` (system) and `mail.service.prepareSend`, where `send()` and `reply()` meet. A proven-unreachable recipient throws `MAIL_ROUTE_TRAPPED`, the send log records **FAILED**, and the caller sees an error. Cached ten minutes per relay+domain; silent on an unproven verdict and silent if the checker itself breaks, so it can never cause an outage. **Applies to every recipient domain** — Microsoft, Google, Zoho or a plain mail host.
- **`connect()`** refuses `imap_smtp` + password for a Microsoft- or Google-hosted domain before writing a row, instead of letting it fail as an opaque `AUTHENTICATIONFAILED` that reads like a typo.
- **`MAIL_HELO_NAME`** stops the loopback greeting.

**Still open, worth a follow-up:** the deliverability dashboard does not yet surface `LOCAL_TRAP` as a panel — today it surfaces on the send. And inbound DSN parsing (`triage/bounce-parse.js`) handles bounces that *arrive*; the whole point of this incident is that none ever did, which is why the pre-send proof carries the weight.
