# Smart Comms — Client Walkthrough (Video Script)

## Purpose

This is the recording script for the client-facing video that walks a customer
through **Smart Comms** end to end: connecting their mailbox, reading and
sending mail, replying with AI, chatting in-house, binding threads to client
records, and administering the area. The provider of record in this video is a
**cPanel IMAP/SMTP** mailbox (the most common setup for the client's own
hosting); Microsoft 365 and Google Workspace are shown briefly as the two
one-click alternatives.

The app is bilingual (English / French). The script below is in **English,
with the French UI term in parentheses the first time each surface appears** —
so the same walkthrough can be re-narrated in French without a second script.
A full label glossary is at the end.

Use a clean demo or test tenant. Do **not** use real client, supplier,
employee, or client-mailbox data in the recording.

---

## Scenario data

Use consistent, clearly fictional data throughout the recording.

| Item | Suggested demo value |
|---|---|
| Corporate entity | Arena Logistics Cameroon (consistent with the operations demo) |
| Company domain (cPanel hosting) | `arena-logistics.cm` |
| Personal mailbox | `demo@arena-logistics.cm` (cPanel mail account, 2FA **off** for the demo) |
| Supplier | Demo Transport SARL — `contact@demo-transport.cm` |
| Client | Demo Client SA |
| Inbound mail to seed | (1) supplier: "advance invoice for DEMO-OPS-001 — please confirm by Friday"; (2) any automated/system notice, to show the system stream |
| Group channel | `ops-demo` |
| Colleague for the DM | any second demo user |

Record the generated reference numbers as you go (sent-message id, thread
binding) so they can be shown again in the closing recap.

---

## Before recording

1. Provision or select a clean demo tenant; the recording account must have
   **admin** rights so every Setup tab is visible.
2. **Platform Console → tenant feature flags**: turn `mail.ai` **on** (it is
   off by default — without it, Mail AI surfaces and "By meaning" search are
   hidden) and `mail.ocr` on (document extraction). `mail.deliverability` and
   `mail.signatures` are on by default.
3. Create the cPanel mail account `demo@arena-logistics.cm` and write down its
   password (or app-specific password). Confirm from the cPanel mail account
   screen: IMAP/SMTP server is the hosting domain, IMAP port **993** (SSL),
   SMTP port **465** (SSL) or **587** (STARTTLS).
4. Seed two inbound messages in that mailbox (one human, one system/automated)
   so the inbox already has content when we open it.
5. Set a **signature** once (Settings → Email signatures) so every sent email
   visibly carries it.
6. Clear the notification bell. Start screen recording before the first click.
7. Have the client record (Demo Client SA) open on a second monitor — we bind
   a thread to it in the second act.

---

## Act 0 — Open the area, show the language

**On screen**

1. Sign in. Top bar: open the user menu → **Language** (FR : *Langue*) —
   toggle EN ⇄ FR once, so the audience sees the whole interface flip. Set it
   back to English. (Preference is remembered per browser.)
2. Open **Comms** (FR : *Comms intelligentes*) in the left navigation.

**Say**

> "Everything your team talks about — client mail, internal chat, and the
> administration of both — lives in one area: Smart Comms. It's fully
> bilingual; I'll show the English interface, and the French label appears
> with each item."

---

## Act 1 — Setup: connect the cPanel mailbox

**On screen**

1. **Comms → Mailbox** (FR : *Boîte aux lettres*) tab → sub-tab **Mailboxes**
   (FR : *Boîtes aux lettres*).
2. The three connect options are visible: **Microsoft 365**, **Google
   Workspace**, and **IMAP/SMTP** (any host — cPanel, cPanel-style hosts,
   Fastmail, own server).
3. One line on the first two: "Microsoft 365 and Google Workspace are one
   click — you authorize the app and it reads your account for you."
   *(Do not complete either OAuth in the video; the cPanel flow is the one we
   prove.)*
4. Click **IMAP/SMTP** → the right-side drawer opens ("Connect and test" / FR
   *Connecter et tester*).
5. Type the **email address** `demo@arena-logistics.cm`.
6. Click **Autodiscover** — the IMAP/SMTP host and port fields fill themselves
   in from the address. Confirm what filled in:
   - IMAP host `arena-logistics.cm`, port **993**
   - SMTP host `arena-logistics.cm`, port **465**
7. If Autodiscover left a field wrong, type it by hand — this is also the
   message for audiences on unusual hosts. **Login user** can stay blank
   (defaults to the email address).
8. Type the password, click **Connect & test**.
   - Success shows **✓ Connected** under the form.
   - (If you want to show a failure: enter a wrong password once — the inline
     **SMTP error guide** appears and explains exactly what to check. Then
     re-enter the right one.)
9. The mailbox appears in **Connected mailboxes** (FR : *Boîtes aux lettres
   connectées*) with status **CONNECTED**. Show the per-connection actions:
   **Make default** (which mailbox new emails are sent from), **Edit**,
   **Test**, **Sync now**.
10. Click **Sync now**, then open the **Inbox** sub-tab (FR : *Boîte de
    réception*).

**Say**

> "The mailbox takes about a minute or two to start filling after the first
> sync — here's the inbox as it lands. Everything from this point on —
> reading, replying, binding to clients — is the same no matter which
> provider you connected from."

**Gotcha to voice:** one **personal** mailbox per person — to change the
address, edit this one in Mailbox → Mailboxes rather than connecting a second.
Team addresses (billing@, ops@, support@) are **shared mailboxes** an
administrator creates.

---

## Act 2 — Receive: read the inbox

**On screen**

1. **Mailbox → Inbox**. Left rail (folder rail): the connected mailbox, its
   folders (Inbox / Sent / Drafts / …) and **Labels** (FR : *Étiquettes*).
2. The message list splits into two streams: **HUMAN** (people writing to
   you) and **SYSTEM** (automated notices, bounces, receipts). Open the seeded
   supplier email from the HUMAN stream; briefly open the system notice too.
3. In the thread: show **Star** (FR : *Marquer d'une étoile*), **Mark as read**
   (FR : *Marquer comme lu*), and the unread badge on the list row.
4. Search bar above the list:
   - Type `from:contact` → filters by sender.
   - Type `has:attachment` → mail with files.
   - Toggle **By meaning** (FR : *Par le sens*) → semantic search: type
     "the invoice for the clearance job" and it finds the supplier thread even
     though the words don't appear verbatim. *(Requires `mail.ai` on and the
     thread to be indexed — a brand-new mailbox needs its first sync first.)*
5. Select two rows with their checkboxes → **bulk** bar appears (mark read,
   label, move). Do a quick bulk label to show it.

**Say**

> "This is not a second email client you have to think about — it is your
> mailbox, with the parts you never used added: meaning-based search, labels,
> and the split between people and machines."

---

## Act 3 — Send: two ways to compose, the 20-second undo

**On screen**

1. **First entry point — the Comms hub.** Go to **Comms** (the Chat tab,
   route `/comms`). Top-left of the header: the **New** button — text with an
   icon on wide screens, icon-only on narrow ones. Click it: the **New**
   modal offers three choices:
   - **In-house message** — "Direct message a colleague"
   - **Group channel** — "A shared channel with your team"
   - **Email** (FR : *Courriel*) — "Email a client, supplier, colleague or
     lead — from your mailbox"
   Choose **Email**.
2. **Second entry point — the mailbox itself.** **Mailbox → Inbox** header:
   the **Compose** button (labelled on wide screens, icon-only on narrow).
   Use this one for the demo send.
3. In the compose screen: type the recipient `contact@demo-transport.cm`
   (the field accepts plain text, comma-separated). The **Send** button stays
   disabled until there is a recipient **and** a body — show it locked with
   the body empty, then unlocked as you type.
4. Write a short confirmation in the rich composer (bold the reference).
   Note the **signature** is appended automatically (from Settings → Email
   signatures).
5. Click **Send**. A toast appears: the message is **held for 20 seconds**
   with an **Undo** (FR : *Annuler*) button. Say the window is configurable
   (0 / 10 / 20 / 30 seconds) — and **use the undo once in the video**: click
   Undo, the message goes back to draft, click Send again.
6. Where did it go? The in-app **Sent** (FR : *Envoyé*) folder — the
   authoritative record of what actually went out. (If a send ever fails
   after retries, the **notification bell** raises an "email send failed"
   event with the reason — point at the bell.)

**Say**

> "Nothing can send itself: no recipient, no body, no send — and even after
> you click send, you have twenty seconds to take it back. The Sent folder
> here is the truth of what went out; the notification bell is the alarm for
> anything that didn't."

**Gotcha to voice:** a message with **no visible content** (blank, or an
attachment with nothing written) is refused by design — the recipient would
have received an empty envelope.

---

## Act 4 — Reply & organize

**On screen**

1. Open the supplier thread (it is now both the inbound mail and your sent
   confirmation — one conversation).
2. **Reply** (FR : *Répondre*) at the bottom of the thread: the composer
   shows the quoted message collapsed under your draft. Type a brief reply,
   send (and this time let the 20 seconds pass — say why).
3. Organize the thread: **Star** it, **Move to…** (FR : *Déplacer vers…*) a
   folder (e.g. a "Clearance" folder in the rail), add a **Label** (FR :
   *Étiquette…*).
4. **Comms → Setup** (FR tab set: *Ma boîte aux lettres* / *Relances* / …) →
   **Follow-ups** (FR : *Relances*) sub-tab: the seeded "please confirm by
   Friday" conversation shows up as a follow-up — "conversations waiting to
   come back".

**Say**

> "Replying stays where you are — in the thread, with the original right
> below your pen. And when a conversation owes you something, the Follow-ups
> list collects it, so nothing 'please confirm by Friday' is left to memory."

---

## Act 5 — Mail AI (flag: `mail.ai`)

**Pre-roll (say it once):** "Everything in this act needs the **Mail AI**
switch on in the Platform Console. With it off, the mailbox works exactly as
before — AI is an addition, not a dependency."

**On screen**

1. Open any thread with a record bound to it (or bind one first — Act 7).
   Right-hand **work rail**:
2. **Draft a reply** (FR : *Rédiger une réponse*) with the **tone picker**:
   formal / friendly / concise / persuasive / apologetic / payment /
   escalation / technical / follow-up / notice. Pick **formal**, generate —
   the draft lands in the composer with its **provenance** (it is visibly an
   AI draft, not your words).
3. **Rewrite in this tone** (FR : *Réécrire sur ce ton*) on the same draft →
   switch to **concise**.
4. **Write it for me** (FR : *Rédigez-le pour moi*) — AI composes the full
   reply from the conversation context.
5. Rewrite actions: grammar / shorten / expand — one quick pass each.
6. **Translate**: the draft toggles EN ⇄ FR in place (to-French / to-English).
7. **Thread summary** (FR : *Résumé*): one paragraph on what the thread is
   about — shown for the busy manager.
8. **Voice dictation**: click the mic, dictate a sentence, watch the
   transcript land in the composer.
9. **Guardrails** before sending: the **"Check these before you send."**
   (FR : *Vérifiez ceci avant d'envoyer.*) list — the app's own pre-flight
   check on the draft.

**Say**

> "The AI never sends anything. It drafts, rewrites, translates and summarises
> — you stay the hand on the Send button, and every AI draft is labelled as
> an AI draft."

*(If `mail.ocr` is on: open a mail with an attached document — the work rail
shows the extracted fields, and the extraction is available per message. One
sentence is enough.)*

---

## Act 6 — In-house chat (the other half of Comms)

**On screen**

1. **Comms** hub (route `/comms`). The conversation list mixes **in-house**
   messages, **group channels**, and **email** threads — one feed, with
   filters **All / Unread / In-house / Groups / Email** and **Search
   conversations…**.
2. **New** → **In-house message**: pick a colleague, send "clearance docs
   for DEMO-OPS-001 ready?" — show the unread badge update on the row.
3. **New** → **Group channel**: create/open `ops-demo`, post a status line.
   Show the channel is deep-linkable (the URL carries the channel — shareable
   in a single message).
4. Search "invoice" across the mixed feed; switch filters to **Groups** to
   show the scoping.

**Say**

> "Team talk and client mail share one inbox on purpose — you decide what
> each conversation is, and the filters let you look at either world
> separately."

---

## Act 7 — Thread binding: the message that is also a record

**On screen**

1. Open the supplier thread in **Mailbox → Inbox**. Right-hand **work rail**
   (opens when a record is attached):
2. **The record** (FR : *Le dossier*): the client/operations file this thread
   belongs to (Demo Client SA → DEMO-OPS-001). If unbound: **Bind** it to the
   record now, in front of the camera.
3. **What you can start** (FR : *Ce que vous pouvez lancer*): actions that
   make sense from this record — documents, follow-ups, tasks.
4. **Documents**: use **intake** to attach the supplier's invoice PDF from the
   mail to the record's documents — the file now lives with the record, not
   just in the mailbox.
5. **Team notes** (FR : *Notes d'équipe*): a private note visible to the team
   but never to the client ("awaiting bank confirmation — do not promise the
   Friday date").
6. **Access** (FR : *Accès*): who can see/share this thread.
7. **Shared-inbox part**: on the shared team mailbox (admin-created), show
   **claim / assign** (triage) — two colleagues both see the thread; one
   claims it, it is now theirs to answer.

**Say**

> "This is the part that does not exist in a normal inbox: every thread can
> be a corner of a client's file. The invoice you just read is now a document
> on the record, the team has a private note, and anyone on the shared
> mailbox can claim the thread — so two people never answer the same client
> differently."

---

## Act 8 — Administration: the Setup tabs (admin)

**On screen** — **Comms → Setup**; walk each tab for 20–30 seconds:

1. **My mailbox** (FR : *Ma boîte aux lettres*) — "your own professional
   address"; the personal-mailbox guidance card.
2. **Follow-ups** (FR : *Relances*) — already shown; one sentence.
3. **Mailboxes** (FR : *Boîtes aux lettres*) — "every mailbox in the company";
   team/shared addresses are created here by an admin.
4. **Response times** (FR : *Délais de réponse*) — **SLA**: how fast a first
   reply must come, and which hours count (business-hours configuration).
5. **Trust & archive** (FR : *Confiance & archive*) — confirmed domains,
   bounce handling, the archive seal on closed matters.
6. **Send points** (FR : *Points d'envoi*) — which address each part of the
   product sends from; a send point with no sender of its own falls back to
   the section sender, then the company's shared SMTP, then the system
   sender — "nothing ever fails to send because a send point is unset."
7. **Senders & channels** (FR : *Expéditeurs & canaux*) — system senders,
   shared SMTP, WhatsApp, DNS.
8. **Secure links** (FR : *Liens sécurisés*) — every expiring secure link the
   company has sent, and who opened it.

**Say**

> "These eight tabs are the difference between 'mail works' and 'mail is
> governed' — who sends, how fast we must answer, what we trust, and where
> the archive seal goes."

---

## Act 9 — Close: recap + the gotchas list

**On screen**: back at the Comms hub; recap on a single thread that shows
everything at once — bound record, AI draft, star, label, team note, follow-up.

**Say (recap)**

> "One mailbox, connected in a minute. Mail in, AI-assisted reply out, the
> thread becomes part of the client file, the team can claim and note on it,
> and an admin keeps the SLAs, senders and archive governed. That is Smart
> Comms."

**Gotchas to end on (read or overlay as text):**

1. **Mail took too long to appear?** First sync after connecting takes one to
   two minutes; **Sync now** in the Mailboxes sub-tab forces it.
2. **"By meaning" finds nothing?** It only searches indexed conversations —
   give a freshly connected mailbox its first sync, and keep `mail.ai` on.
3. **Where is what I sent?** The in-app **Sent** folder is the record. If a
   send fails, the **notification bell** tells you, with the provider's
   error; the connect form's **SMTP error guide** explains most rejections
   (wrong port, no SSL, password vs. app-specific password under 2FA).
4. **Empty body?** Refused on purpose — client-side the Send button won't
   unlock, and the server rejects a shell with no visible content (422, "a
   message needs a body").
5. **AI missing?** `mail.ai` defaults **off** in the Platform Console; the
   mailbox itself never depends on it.
6. **Language?** Top bar → Language, remembered per browser; the whole
   interface is EN/FR.
7. **Undo window** is 0/10/20/30 seconds (default 20) — configured per
   preference, worth knowing before you click Send in anger.

---

## Appendix A — EN/FR label glossary (verified against the app's dictionary)

| Surface | English | French |
|---|---|---|
| Area | Smart Comms | Comms intelligentes |
| Tab | Mailbox | Boîte aux lettres |
| Sub-tab | Inbox | Boîte de réception |
| Sub-tab | Mailboxes | Boîtes aux lettres |
| Sub-tab | Message log | Message log (same in FR) |
| Hub button | New | New (same in FR) |
| Compose (Inbox header) | Compose | Compose (same in FR) |
| Choice modal | Email | Courriel |
| Choice modal | In-house message / Group channel | same in FR |
| Search | Search conversations… | same in FR |
| Filters | Unread | Non lu |
| Connect | Connect and test | Connecter et tester |
| Connect | Connect my mailbox | Connecter ma boîte aux lettres |
| Connect | Autodiscover | Autodiscover (same in FR) |
| Connect | Connect & test | Connecter et tester |
| Connect | SMTP host / SMTP port | Hôte SMTP / Port SMTP |
| Connection list | Connected mailboxes | Boîtes aux lettres connectées |
| Connection actions | Make default / Edit / Test / Sync now | same in FR |
| Send | Send / Undo | Envoyer / Annuler |
| Folders | Sent | Envoyé |
| Folders | Failed (send status) | Échec |
| Thread actions | Reply | Répondre |
| Thread actions | Mark as read | Marquer comme lu |
| Thread actions | Star | Marquer d'une étoile |
| Thread actions | Move to… | Déplacer vers… |
| Thread actions | Labels | Étiquettes |
| Work rail | The record | Le dossier |
| Work rail | What you can start | Ce que vous pouvez lancer |
| Work rail | Documents | Documents |
| Work rail | Team notes | Notes d'équipe |
| Work rail | Access | Accès |
| Mail AI | Draft a reply | Rédiger une réponse |
| Mail AI | Rewrite in this tone | Réécrire sur ce ton |
| Mail AI | Write it for me | Rédigez-le pour moi |
| Mail AI | Summary | Résumé |
| Mail AI | Check these before you send. | Vérifiez ceci avant d'envoyer. |
| Search | By meaning | Par le sens |
| Setup | My mailbox | Ma boîte aux lettres |
| Setup | Follow-ups | Relances |
| Setup | Secure links | Liens sécurisés |
| Setup | Response times | Délais de réponse |
| Setup | Trust & archive | Confiance & archive |
| Setup | Send points | Points d'envoi |
| Setup | Senders & channels | Expéditeurs & canaux |
| Settings | Signatures page (Settings → Email signatures) | — |
| Shell | Language (top bar) | Langue |
| Shell | Save / Cancel / Refresh | Enregistrer / Annuler / Actualiser |

Labels marked "same in FR" render identically in both languages (the app
falls back to the English text when a French string is not in the
dictionary). If the script is re-narrated in French, keep those labels as-is
— do not invent translations for them.

## Appendix B — Feature flags referenced

| Flag | Default | Where | Controls |
|---|---|---|---|
| `mail.ai` | **off** | Platform Console, tenant flags | Mail AI work-rail surfaces, "By meaning" search |
| `mail.ocr` | off (depends on `mail.ai`) | same | Document extraction on mail attachments |
| `mail.deliverability` | on | same | Deliverability checks surface |
| `mail.signatures` | on | same | Signature settings surface |

Turn `mail.ai` and `mail.ocr` on in the demo tenant **before** recording; the
rest of the walkthrough does not depend on any flag.
