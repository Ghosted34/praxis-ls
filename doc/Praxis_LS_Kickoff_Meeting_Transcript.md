# Praxis Logistics Solutions (Praxis LS) — Project Kick-off & Product Walkthrough
## Clean, Structured Meeting Transcript · Source of Truth for Build

---

**Company:** JBS Praxis
**Product:** Praxis Logistics Solutions — "Praxis LS" (multi-tenant logistics SaaS)
**Working / legacy name in codebase & docs:** SmartLS
**Meeting type:** Internal engineering kick-off and full product walkthrough (screen-share)
**Recorded & transcribed via:** Google transcription service (to be added to the project knowledge base used for building)
**Duration (approx.):** 07:02 → 02:43 (elapsed timeline as marked in the raw recording)

### Participants

| Speaker | In this transcript | Role on the project |
|---|---|---|
| **Blake** (Tom) | Founder of JBS Praxis; meeting lead & presenter | Product vision, architecture direction, work organisation, cleanup / deep-linking / back-end touches, client relationship |
| **Elisha** | Engineer (full-stack) | AI integration, database structure, built the original SmartLS proforma / advance-payment invoicing; strong on the existing patterns |
| **Victor** | Engineer (full-stack, leans back-end) | Repo setup, README authoring, back-end focus |
| **David** | Engineer (full-stack, leans front-end) | Front-end focus; connectivity was choppy and he dropped off for large portions (logistics & sales), to review the recording |

> **Note on attribution:** The raw Google transcript tagged only Blake by name; all other lines came through as unlabelled `>>` turns. Speakers have been attributed from context (topic ownership, who was addressed, who returned to the call). Where a line genuinely could not be tied to an individual, it is marked *(team)*. Timestamps from the raw recording are retained as anchors so any line can be traced back to the source audio.

---

## How to read this document

This is a **cleaned and restructured** version of the kick-off meeting — not a word-for-word dump. Filler, dropped audio, network cross-talk, and false starts have been removed; broken phrases have been repaired into readable sentences; and the discussion has been organised into the logical order the product will actually be built in. **Nothing of substance has been cut.** Every feature, decision, number, tool, edge case, and side comment raised in the room appears here.

Editorial additions are clearly separated from what was said in the room:

> **📌 Context** — background or clarification added after the meeting to make a point usable while building (drawn from the PRD, the OHADA accounting knowledge base, and the existing codebase).

> **✅ Decision** — a choice the team locked in during the meeting.

> **🔧 Action** — a concrete follow-up someone owns.

> **🤝 Teamwork** — a moment where the founder or a teammate spoke to *how* the team is expected to work. These are preserved deliberately: this is a long-term product, not a one-off gig, and the culture is part of the spec.

The full running list of decisions, actions, and open questions is consolidated in the **Appendices** at the end.

---

## 1. Opening & purpose of the meeting

**[07:02]**

**Blake:** Okay, I guess everyone's here. Can you all confirm you can hear me?

*(The team confirms one by one — Elisha and David both check in and say they can hear clearly.)*

**Blake:** Good evening, everyone. Some of us are in noisy spaces, others are in co-working spaces, so we may not all get the chance to talk. It'll be mostly me talking, but follow keenly and if you have any questions, bring them up. I gave David a brief on the project already, and I gave Elisha a brief as well, because this is a project that already exists — so we're going to go deeper into it. I want us to talk in detail about the **user journey**.

**Blake:** The way this meeting is structured: we're going to talk in detail about every feature and every aspect. The entire meeting is being transcribed — I'm already transcribing it with Google's transcription service — and at the end we'll add it to the **knowledge base** we'll use to build the system.

> **📌 Context** — This meeting *is* that knowledge-base artefact. It sits alongside the PRD (Master Functional Spec), the OHADA accounting knowledge base, the RBAC / Super-Admin journey doc, the discovery questionnaire, the UI mockups, and the legacy PHP/MySQL codebase. Together these form the "source of truth" the team (and Claude) references while building.

---

## 2. The business: what we're building and why

**[08:54 – 11:15]**

**Blake:** We're talking about **SmartLS / Praxis LS** — it's a Software-as-a-Service. We're building something we actually intend to sell to other clients. The truth is, on our own we couldn't come up with the funds to sit down and build something like this. Luckily we got a client who's ready to be our **first tenant** and to **finance the entire project**. Any time a new client comes on board, we do the setup.

**Blake:** So this is **not a one-time gig.** I want you to know we're on this project *together*. It's not something you do once and you're done. It's something we do, we maintain, we grow — because every time a new tenant comes in, there's more work to do.

> **🤝 Teamwork** — The founder set the tone in the first minutes: this is a **long-term product**, maintained and extended tenant after tenant, not a build-and-walk-away contract. This framing recurs throughout the meeting and underpins every architecture decision (multi-tenancy, per-tenant databases, dynamic configuration).

**Blake:** As tenants come in, we also upgrade the servers. We start with a **12 GB server, 6 core, ~75 GB SSD**. As the next tenant comes in we climb to ~18 GB; the third tenant, ~24 GB, and so on. And each tenant needs its own **independent PostgreSQL** — their own database, which they can have control over. **We hold the code; they hold the data.** That's the whole idea.

**Blake:** We'd already built something like this. We're targeting a **particular industry, a particular niche — logistics** — and we're **starting in Cameroon**, but long-term we're hoping to **expand across Africa**.

**Blake:** When I say logistics, I don't mean the daily "GI and go" small-parcel guys. I mean **serious logistics**: freight forwarding, customs clearance, warehouse management, fleet management — companies with huge fleets of trucks. Those are the people we're targeting.

> **✅ Decision** — Target segment: heavyweight logistics operators (freight forwarding, customs clearance, WMS, fleet). Geography: Cameroon first → Africa later.

**Blake:** We'll build everything so we can configure and switch on only the **right modules** for each client. If a client doesn't have a fleet of trucks, we won't set them up with fleet management. **But** because this first client is already paying, I want us to **build everything now** — and every time a new client comes in, the same team comes on board: we maintain, we manage, we upgrade, and we ship for the new client.

---

## 3. The product philosophy: parametric, dynamic, per-tenant

**[11:15 – 13:42]**

**Blake:** I was trying to write a detailed project description, but even with the description, if we don't get the details on the user journey it won't be easy to proceed. We need to know *exactly* what we're building — the logic here is very complicated and difficult, and **each company may have its own workflows**. I have a good mastery of the workflows that work for this particular company because I worked there a while ago. But another company may have a completely different workflow, a completely different org chart, and so on.

**Blake:** So we're going to make things **parametric and dynamic** — even down to the level of workflows and the **org chart (organigramme)**. Each company can build their own org chart and create their own workflows.

**Blake:** For example — a **cash request**. Money is needed for a project, so they produce a **costing**. The costing is approved by top management, then they need cash for operations, so they build a cash request based on the costing. The costing first gets **validated**, then **approved** by independent bodies (segregation of duties).

- For *this* company: costings are **validated by the Operations Manager**, then **approved by the CEO**.
- Another company might have a **team lead validate**, then the **operations manager approve**, and it never reaches the CEO's desk.

**Blake:** It depends how they want to set it up — so we build it so all of these are **parametric**. Same for the cash request: someone validates, someone approves. We're going with **segregation of duties across every aspect** of company management.

> **📌 Context** — This "who validates / who approves" chain is later formalised as the **Universal Event System + RBAC workflow designer** (see §11.14). The parametric-workflow requirement is the single most important architectural constraint in the meeting: approval chains, org charts, milestones, services, allowances, chart of accounts — all configurable per tenant, none hard-coded.

---

## 4. The mock, the domain & white-labelling

**[13:42 – 15:30]**

**Blake:** Let me share my screen so we get a global idea of what we'll be working with.

**Blake:** This *(shows the new mock)* is a **mock we came up with to sell to the client** — to get him to approve. This is what we'll go with for almost everyone; only the styling / CSS will be **dynamic and parametric**. Each of these — the logos and so on — will be configured per tenant.

**Blake:** I've already purchased the domain **praxisls.com** *(said as "practicels.com" in audio)*. Each new tenant gets a **subdomain**. For example, this new tenant — "Smart Logistics and Services" — we'd give them **smartls.praxisls.com**, and they get access to the whole system. On our end we have a **dashboard where we configure which modules** to give them.

> **✅ Decision** — One codebase, per-tenant subdomains on `praxisls.com`, white-labelled styling (logos, theme) driven by configuration. A **super-admin dashboard** on our side controls which modules each tenant sees.

**Blake:** Let me open the product description. *(Encounters a Markdown file.)*

**Blake:** What app can open a Markdown file? I think I need VS Code.

**Victor:** I haven't installed VS Code on this laptop — I just got it today.

**Blake:** Okay, go to Microsoft Store and download it… or just get it from a browser, that'll be faster.

**Victor:** I'm adding it as a Chrome extension so I can open it in Chrome.

**Blake:** As long as we can see what we have there, it's fine — I just wanted to get the points together. We'll have a **full knowledge base** that helps with a lot of things around **Cameroon regulation**. Like I said, we'll be doing a lot of work with **CL (Claude)**, and each person will have about **one or two CL accounts** to make it go faster.

> **📌 Context** — "CL" = Claude. The team plans to build with AI assistance, each engineer using paid Claude accounts against the shared knowledge base (see §12).

---

## Where we are starting from (the existing codebase)

**[18:26 – 20:46]**

**Blake:** I gave a brief introduction earlier because this part already gives a brief intro. We already have an existing codebase — it's not everything from scratch. But it's **so scattered** and was done in quite a terrible way, I won't lie — because this is what they're actually using *right now*. It's not bad, it's just **terribly organised**. It was done with **PHP and MySQL**.

**Blake:** So we're migrating — in fact, we're **building from scratch**, that's the truth. We're building from scratch and adding a lot of things to make it very **dynamic**, so it's open to any new tenant.

**Blake:** The vision, restated: it's a **multi-tenant SaaS platform that runs an entire logistics + operating + holding business** — sales, operations, warehouse, and procurement. *(Shows the live system.)* These are all operations files. For each file you can see transit orders and **operational milestone tracking** — what's been done at each stage: pre-alert, work order, document review, import declaration, and so on. In the new build these **stages must be configurable, not hard-coded** like in this project. Then we have delivery notes, etc. The reason I'm opening this is so we can see all the modules.

> **📌 Context** — Carry-forward strengths from the legacy PHP/MySQL app: the operations-file model, milestone tracking, the demurrage/extra-charge calculator, lead & meeting management, proforma/advance-payment invoicing, debt management, document verification, and the WhatsApp-style internal comms. The debt to fix: hard-coded stages/services, poor organisation, MySQL, IFRS-flavoured accounting instead of OHADA. The rebuild keeps the proven flows and makes everything configurable.

---

## 5. Architecture & technology stack

**[20:46 – 26:16]**

**Blake** walked the full stack. Locked choices:

**Front end**
- **React 18 + Vite + TypeScript.**
- An **installable PWA** for every kind of device (desktop, laptop, etc.). A very responsive front end is required.

**Back end**
- **Node.js + TypeScript.**
- A couple of **separate workers / microservices** for isolated jobs — **AI jobs**, **PDF generation**, etc.

**Database**
- **PostgreSQL**, and — after discussion — **one database per tenant** (see decision below).

**Blake:** I was initially thinking one database, but I was talking with someone earlier and they advised against it. A company may want to keep and manage their own data — they'll want access to their Postgres — and we can't give them access to the *entire* Postgres since it holds other people's data. So: if we get the next client and build them properly — roughly **2–3 million [XAF] for setup**, then a yearly maintenance fee of maybe **500k** — we give them access to **their own Postgres**. We upgrade the server, add a second Postgres, and so on.

**Elisha:** Separate Postgres for each is a good idea — everybody has control and full responsibility for their own data. "This is your database, manage it yourself." That's clean.

> **✅ Decision** — **One PostgreSQL database per tenant** (not a single shared DB). Each tenant owns and can be granted access to their own database; we hold the code, they hold the data. Server is scaled up and a new Postgres instance added per tenant.

**Cache & queue**
- **Redis** — sessions, rate limiting, and job queuing.
- **BullMQ** for the job queue *(Blake: "that one is okay")*.
- **Socket.IO** for real-time — chats, notifications, and live milestone updates that need to update in real time.

**Workers**
- Runs as a **separate worker** (as on the team's other projects), including a **Puppeteer** worker for **server-side PDF rendering** — invoices, proper invoices, costings, cash requests, purchase orders, pay slips, financial statements — as many documents as we can. This is a document-heavy field.

**Mailing**
- A **mailing service** is needed. Blake noted PHP has "PHPMailer"; the Node equivalent — **Nodemailer** — will generate the mail. **SMTP is configured from the server** (distinct from the library that generates the message).

**Validation & AI payloads**
- **Zod** for validation, including **AI action payloads**.

**Containerisation**
- **Docker** — set up early, at the foundation, so that if the project gets heavy (5–10 tenants) we can separate tenants onto different servers cleanly.

**Hosting**
- For now, a **self-managed VPS/VDS**. As tenants grow, move object storage to an **AWS S3 bucket** (Blake had written "Hetzner" as an option, but AWS S3 is the cheapest for object storage, with **S3 compatibility**).

**Blake:** That's the stack we're locking in.

> **📌 Context** — The "separate repos & code organisation" detail Blake referenced ("it's already in a document") lives in the PRD; the team agreed to explore it there rather than in the meeting.

---

## 6. Sandbox vs. staging — the test/live decision

**[26:16 – 30:42]**

**Blake:** A lot of the time we'll have to train people on the system. When we get a new tenant and do a demo, **we won't use live data**. So I think we need a **sandbox** — a **Test/Live toggle** in the top bar.

**Blake:** The idea: two records in the database per tenant — the tenant's **Live** and the tenant's **Sandbox**. During training/testing, flip the toggle in the top bar and it switches to test mode with sandbox data — everything there can be wiped at once. A **cron job cleans up the sandbox database every 14 days.** The alternative is a **staging server** — depends on cost. Let's brainstorm: staging server or sandbox? What's most affordable for us? We're venturing on this; the client has paid and just wants results.

**A team member (Victor/Elisha):** The sandbox is better. It should just be **one sandbox, multiple live** — instead of different staging servers per tenant. Tenants can see "this is how the data is supposed to look," then switch to live. Limited moving parts — one place where everybody checks what they want and leaves it.

**Blake:** Makes sense. We initially planned one sandbox *per client*. What you're saying is pertinent — but I'm worried about **data breaches**: the sandbox keeps data for 14 days, so if we run a test with one tenant while trying to reach another prospective tenant, how does that isolate?

**Team:** Understood.

**Blake:** So — **one sandbox per tenant**. Since we're already separating Postgres per tenant, it's no longer an issue: within each tenant's Postgres we give a **Live** and a **Sandbox** environment.

> **✅ Decision** — **Test/Live toggle** in the top bar. Each tenant gets **both a Live and a Sandbox environment inside their own Postgres** (isolation prevents cross-tenant data exposure). A **cron job purges sandbox data every 14 days.** No shared staging server.

---

## 7. Security architecture & RBAC

**[30:48 – 34:52]**

**Authentication**
- Login via **email or username + password**.
- **Two-factor authentication encouraged.**
- For sensitive roles (Finance, CEO), consider stronger login — e.g. **phone-based login** or something more secure.

**Elisha (on approach):** Design with the **role base in mind first** — it's very important, so that you don't have one [role] able to see everything.

**Blake:** Right. **Role-Based Access Control (RBAC)** works with both **server-side and client-side protection.** Anything not available to someone is blocked on the **back end** (every endpoint blocks it) *and* the **front end** (the UI doesn't even render). Even if someone sees a UI element, they can't act on it, because the server blocks it too.

**Sessions**
- **JWT + refresh tokens.**
- **30-minute inactivity auto-logout.**
- **Active session monitor** with **remote kill** (for admins / anyone) — server-side session state stored in **Redis**, so a session can be killed instantly.

> **📌 Context** — RBAC gets its own full module later (§11.14): roles, capabilities, scope, and — critically — a **dynamic validation/approval workflow designer** built on a Universal Event System.

**Transport & data**
- Per-tenant **encryption keys** — "very, very pertinent." We need to secure the keys for each tenant.
- Blake floated storing keys **hashed in the database** rather than minting a separate key per tenant. *(Left open — see Open Questions.)*

**Audit**
- Something that **tracks every action the admin does**, so we keep a record of everything. *(Becomes the immutable ledger / audit trail — §11.14.)*

---

## 8. Integrations & AI strategy

**[34:52 – 37:41]**

**Blake:** Under integrations we're integrating **Gemini, DeepSeek, Grok, an exchange-rate API, and SMTP.** Those are the main things.

- **Exchange-rate API** — practically free.
- **Grok** — fairly cheap. *Alternatively*, we can **host our own voice-to-text** using **Whisper** in **Python**, if the server permits; otherwise fall back to Grok (affordable).
- **AI providers: DeepSeek as the first option, Gemini as the fallback.** That's the routing for AI.

**AI as a per-tenant toggle**
- Any new tenant who wants AI: it's **just a toggle on our end**, and they **control their own spend** through a **spend dashboard**.
- This particular first client isn't very interested in AI — but since we're building for **sustainability**, we build in the direction of AI anyway.

**The two AI "blockers" (EMV switches)** — *front end and back end*
- A **front-end flag** (true/false): if **true**, every AI feature shows in the interface; if **false**, no AI feature appears.
- A **back-end flag**: if **true**, AI actions are permitted from the back end; if **false**, the AI action is blocked server-side.

**Team:** For a new client, you just flip the front-end switch — true shows all AI UI, false hides it. Easier.

**Blake:** Perfect, we'll go with that.

> **✅ Decision** — AI providers: **DeepSeek primary, Gemini fallback.** Voice-to-text: **self-hosted Whisper** if the server allows, else **Grok**. AI gated by a **two-part EMV toggle** (front-end UI switch + back-end action switch), per tenant, with a **tenant-facing spend dashboard**.

> **🤝 Teamwork** — Blake and Elisha noted they'd *just* finished building AI features on another project and "it wasn't as hectic as we thought," so bringing AI here is feasible. Elisha will own the AI engine (see §11.15). Blake asked the team explicitly to **"take note here — front end and back"** regarding the EMV blockers.

---

## 9. Email / SMTP & document delivery

**[37:41 – 40:18]**

**Blake:** Each client gets their **own SMTP**, with a **fallback to praxisls.com** for sending mail if they haven't activated their own SMTP. We take their subdomain and create the different email addresses for it.

**Why it matters:** all invoices and major documents are **generated and emailed directly from the system.** Anything invoice-related — **proforma, final invoice, receipts** — comes from e.g. **billing@[tenant]** and shows a sender name like **"SmartLS Billing."** Operational documents come from **operations@[tenant]** or **documents@[tenant].cm.** Everyone should have their own, configured (as was done for the "Pixie Girl" project): each tenant enters their own details and we give them a **DNS record** to activate it.

**The fallback, precisely:** where a tenant has **no domain**, mail is sent from a fallback — **nmail.praxisls.com** — so they can still send mail before setting a DNS record. We put the tenant's company name via the tenant's mailbox; where they have no domain, sending routes through the fallback.

> **✅ Decision** — Per-tenant SMTP with role mailboxes (**billing@ / invoices@ / operations@ / documents@ / support@**), activated via **DNS records**. Fallback sender **nmail.praxisls.com** for tenants without their own domain. All financial and operational documents are emailed straight from the system.

> **🔧 Action** — Setting up a new tenant's SMTP (and DNS) is part of onboarding work, alongside server upgrade and module configuration. Build it so this setup is as automated as possible.

---

## 10. PDF generation, environments, CI/CD, backups & scaling

**[40:18 – 42:46]**

**PDF generation**
- Using **Puppeteer + Chromium** for server-side document generation. Heavy documentation field — bills, invoices, purchase orders, and many more. Set this up properly.

**Environments & CI/CD**
- **Local first** via **Docker Compose.**
- **CI/CD** with **type checks, integration tests, everything.**

**Hosting & scaling ladder**
- Start with the **self-managed primary VPS**; increase as tenants grow.
- **1 tenant:** single 12 GB / 6-core box.
- **2–4 tenants:** step up to **24 GB / 8-core** (and higher).
- **5–10 tenants:** **split servers.**
- **10+ tenants:** introduce a **connection pooler**, a bigger and more solid team for maintenance and follow-up.

**Blake:** Our dream is 10+ tenants. This is a project that could take us over a very, very long time. After this meeting we'll all have **contracts to sign** — it's a long-term thing.

**Backups & disaster recovery**
- A **backup cron job for the entire server**: **automated daily encrypted backup** of every tenant schema + the platform schema + each tenant's entire Postgres database.
- Back it up **somewhere** — likely a **Google Drive or Microsoft OneDrive** (enough space, avoids costly AWS backup for now). Blake: "we can use one of my Google Drives, I don't mind."

**Isolation by schema**
- Tenants isolated by schema; the scaling ladder above governs when to split servers and when to introduce a pooler.

> **✅ Decision** — **Daily encrypted full backups** (all tenant DBs + platform schema) to Google Drive / OneDrive initially, with a path to S3 later. Docker Compose locally, CI/CD with type checks + integration tests. Documented scaling ladder from 1 → 10+ tenants.

---

# 11. The user journey — module by module

**Blake:** RBAC we've spoken about already; we'll come back to it in detail. First I want us to get to where we have **all the modules**. The user journey **starts from the login.**

---

## 11.1 Dashboard & Workspace — the "Control Tower"

**[43:06 – 51:23]**

**The login / landing page**
- A very **interactive login space** — it can double as a **landing page**. Anyone who lands on it should immediately understand: *these people do X, Y, Z — this is a SaaS.*
- Blake is "always very particular about login pages." On the team's other projects, the login page **sells the business already**: if your computer locks you out and someone else sees it, they should be able to read what the system is and does. There's always a **"Powered by [our company]"** at the bottom — it markets us. Users then enter their workspace and log in.

> **🤝 Teamwork** — "If we're going for something, we should go for something *better*" than the old login. The login page is treated as a marketing surface, not an afterthought.

**After login — role-driven dashboard (the "Control Tower")**
Once logged in, the dashboard renders **based on the user's role.** On the dashboard:
- A **greeting** and a status line — e.g. "your network is live" — plus the number of **ongoing operations.**
- A **live map** (with light animation / JavaScript): every active operation plots automatically. For each file there's a **port of departure** and **port of arrival** — e.g. *Shanghai → Douala, then Douala → N'Djamena.* Clicking a file shows its exact route.
  - Map sourcing: start with a **free-tier maps API**; move to **Google Maps** once financially stable.
  - Shows all active operations files (or the **top 10 active**).
- **Main KPIs — dynamic per role.** Someone in Operations won't see **Receivables** (that's for Finance and the CEO). Each KPI is a deep link:
  - **Receivables** → overdue invoices, status, deep link into the finance ledger.
  - **Fleet utilisation** → trucks, drivers, status (idle / in service / broken down), deep link into the operations desk.
  - **Deliveries** → volume and status.
- **Applications list** — all the modules the user can browse to.
- **Recent activities** — the last activities.
- **Light mode / dark mode** toggle.
- **Global search bar** — searches the entire app. It resolves both **Modules** (jump to Operations) and **Actions**, and can jump directly to a specific operations-file reference. The same search opens from the top notifications bar.
- **Smart Comms** — an in-house messaging platform (direct messages between employees). It existed on the old system but without websockets; the rebuild uses **Socket.IO** (see §11.16).
- **Help Center** — guides users through each module and what to do in it.
- **Notifications bar** (top).
- **AI surface** — if AI is enabled, the user sees **Praxis LS AI insights** here and an **AI chat box** to chat with the assistant. If AI is off, none of this appears. (Feasible — Blake and Elisha just built this on another project.)
- **Clock-in button** — anyone arriving at work clocks in; it captures their **exact location.** Feeds the HR attendance table (§11.4).

> **✅ Decision** — Dashboard KPIs and modules are **role-filtered** (server + client enforced). The dashboard is the "Control Tower": map of live operations, deep-linked KPIs, global module+action search, comms, help, notifications, and (optional) AI.

---

## 11.2 God Mode — CEO-only

**[51:23 – 55:13]**

**Blake:** After the dashboard, we have a **God Mode** module, accessible **only to the CEO**, protected by a **one-time PIN set by the CEO and stored in the database.**

**What it does**
- Lets the CEO **purge records directly** — e.g. delete erroneous data — instead of contacting us every time to run a cleanup query. It shows **every file connected** to the record and asks whether to delete across everything.
- **Deletes are "soft":** everything goes to an **immutable ledger with the exact payload (full JSON)** — so it's **reversible with a single click.**

**Walkthrough (from the existing system):** Under the **immutable ledger**, nobody can delete. To delete e.g. "Receipt No. 1," you open it, click delete — it shows dependencies ("one receipt, no linked record, no physical assets linked") — you enter your **password + PIN**, and legally confirm the deletion. It goes to the immutable ledger. Inspecting the JSON there gives the exact payload, so a button can **reverse** it and every touched record is restored automatically.

**A team member** suggested a "student/restore" concept — keep track of the delete so you can restore what was deleted.

**Blake:** We can do that. The principle: whether soft or hard delete, we always keep a **JSON of the full payload**, so it's reversible with one click. We can also do a **pure soft delete** that keeps the full record and just **hides it in the UI** on their end.

> **✅ Decision** — **God Mode** (CEO-only, PIN + password gated) allows guided deletion; **all deletions are reversible** via a full-payload JSON entry in the **immutable ledger**. Soft-delete option hides records in the UI while retaining them.

---

## 11.3 Master Data Management (MDM)

**[55:13 – 1:19:13]**

**Blake:** Master Data Management has **tabs** — about **10 tabs.** These are essential for every new company coming in. *(UI concern raised: how to organise ~10 tabs so it isn't saturated.)*

### (a) Corporate Entity
- Where a tenant defines their own books / legal identity: **tax identifier** (French **"Numéro Unique" / NIU**; ≈ **TIN** in Nigeria), **RCCM** (≈ **CAC** number in Nigeria), **business address**, **business logo.**
- **All documents reference from here** — e.g. creating an invoice pulls the reference, full address, and logo directly.
- **Multiple entities supported.** A company based in Nigeria and Cameroon billing a Nigerian client uses their **Nigerian corporate entity** (Nigerian TIN, CAC, address, logo).

### (b) Human Capital (create/manage employees)
- Create an employee: **full name, department, job title, employment type**; **CNPS number** (Cameroon social security; ≈ pension/retirement fund number in Nigeria), **base salary, bank details, signatory name** (for PDFs they'll sign), **entity, avatar, contract link**, and more.
- It's effectively a **dashboard managing all employees.** Opening an employee shows *everything* about them, with **deep links** (e.g. to pay slips).

### (c) Client Master
- Create clients; pick type: **Shipper, Consignee, Business Partner**, etc.
- **Two sub-tabs:**
  1. A tab to **configure client types dynamically** — so a client that doesn't fit Shipper/Consignee/Business Partner can have a **custom type** created, reusable everywhere a client type is needed.
  2. Client detail — **tax ID, CC number, payment terms** (for their invoices), **credit limits**, **KYC document upload**, and a display of **cash receivables / overdue invoices** with us.
- Features: **CRUD**, **export**, **KYC upload**, **credit terms**, **live receivable roll-up**, and **deep links to CRM** — quotations/costings linked to a client (an SQL query surfaces everything tied to that client).

### (d) Suppliers
- All suppliers for procurement. Configure each. Mostly front-end work; the back end provides one to a few tables. (Elisha to lead DB structure; front end queries everything about a supplier/client so the whole record is manageable from one place.)

### (e) Financial Dictionary
- The **operational/invoiceable line items** used in billings — each carrying rates, currencies, and a shipping line. Examples: **"Certificate of Conformity"** (issued by an international body), **formalities**, **terminal fees**, etc. Items have an **English name and a French name** (users pick either) plus a **brief description** and categories, marked **billable.**
- Used when creating an invoice / costing: pick e.g. "Certificate of Conformity" from the description field and bill it directly — these are their **invoice lines.**
- **Critical seam:** each Financial Dictionary item **must be linked to a Chart-of-Accounts account.** If it isn't, accounting can't be tracked properly. The dictionary name is what's *familiar to users*; the chart-of-accounts link is what makes it *accountable.* **Do not merge the two.**

> **📌 Context (OHADA, not IFRS)** — Cameroon does **not** use IFRS. It uses **OHADA** — the harmonised accounting system for French-speaking African countries (SYSCOHADA). It differs from the "regular" (IFRS) standards most legacy systems followed. Blake prepared a **full OHADA accounting knowledge base** (legal framework, conventions, document usage, member countries, full chart-of-accounts names) to attach to the working folder so Claude has proper context. **Terminology caveat:** many account names exist only in French; English translations are rough, so the system must be **bilingual** and not rely on gross translations.

### (f) Chart of Accounts
- **Seeded** (from the OHADA knowledge base) but **editable per client** — each client can tweak it and create **sub-accounts.**
- Example: Cash is class **5**; under Bank/Cash/Mobile-Money Wallet (class 9 module reference), a company with several petty-cash points or bank accounts creates **sub-accounts**, and creating one **automatically generates the matching sub-account on the chart of accounts.** So opening a new bank account creates a sub-account under the bank account line — making it clear in the accounting records which account payments flow through (bank vs. cash vs. any means).

> **📌 Context** — During this stretch a network drop logged Blake out for ~10 minutes (mid-"chart of accounts"). On return he re-covered the chart-of-accounts seeding/editing point for the team. The clean version above consolidates both passes.

### (g) Jurisdictions (tax)
- Each country the tenant operates in configures its **tax jurisdictions.** Example — **Cameroon: VAT 19.25%, withholding tax 2.2% and 5.5%, plus a minimum tax rate.** A new country can be configured easily.

### (h) Currency & Live FX
- **Multi-currency** for invoices, costings, etc. Pick a currency; it works with the **exchange-rate API.** A **daily midnight cron job** captures the rates at that time so they're available through the day.

### (i) Treasury Accounts
- Already referenced above; includes configurable **mobile-money (MoMo) fees** the providers charge.

### (j) Expense Rates
- Set a **rate (cost) for each Financial Dictionary item.** Think of it like a product catalogue: each service has a **set cost.** The dictionary gives the service name/type; the expense rate tells us **what that service costs us.**

### (Within the item catalogue) — Services as data, not code
- The **Item Catalogue** needs **two tabs**: one for the **Financial Dictionary**, and a second for the **Services the company renders.**
- **Do not hard-code services** (the legacy system hard-coded them, so a new service required us to add it manually). Instead, services live under the Financial Dictionary and are **user-creatable.**
- Each item ties to its **service** and has an **Applicability** setting — e.g. "PK26 terminal fees" under logistics handling applies to **Sea Import, Sea Export, Air Import**, etc. When a new service is created, set its applicability so it surfaces on the right documents.

**Why this matters (the costing speed-up):** When creating a **costing**, the user selects an **operations file** (which carries a service, e.g. "End-to-End Sea Freight"), clicks **Suggest**, and the system returns **all applicable items** (e.g. container maintenance for 20-ft / 40-ft containers). Unit cost can be entered manually — **but** if the **Expense Rate module** already holds the rate per **shipping line** (e.g. create "MSC" as a shipping line with container-maintenance rates), it auto-fills. This cuts costing creation from **~a day** (calling around for rates) to **~10 seconds**, using a **centralised, seeded rate table** that tenants can edit.

> **✅ Decision** — Centralised, **seeded-but-editable** rates keyed by **shipping line**; onboarding collects current rates/shipping lines via an **Excel template** the client fills, which we import. **Financial Dictionary ↔ Chart of Accounts ↔ Expense Rate** stay linked but distinct. Services are **configurable data**, never hard-coded.

**Blake:** That's the first module — Master Data Management.

---

## 11.4 Human Capital Management (HCM / HR)

**[1:20:08 – 1:25:00]**

**Blake:** The second major module. We won't go deep, but the shape:

- **Vacancies** — post and create job descriptions; **AI-assisted** (give a role + a **voice recording** of expectations → it drafts the JD). Post directly to the tenant's **website** (if connected to the system) or **download the JD as a PDF** to send out. Applicants come **into the system**: a **public-facing apply UI** where candidates upload CVs and answer a few questions, feeding applications straight in.
- **Contracts** — templates for **offer letter, employment contract, confirmation, and termination**, tracked in the system.
- **KPI Appraisals** — set **monthly targets**; line manager / CEO sets targets by department, and department heads set targets per user.
- **Attendance** — a table powered by the **clock-in button** (from the dashboard). Clock-in appears on the attendance table; filters allow review over any period; AI can draw insights.
- **Leave & Allowance** — request leave; **configurable allowance and bonus types** (vehicle allowance, commission bonuses, etc.). **Not hard-coded**, so pay slips stay flexible. A company with only base salary leaves it at that; others add their items.
- **SOPs & Onboarding** — anything SOP / onboarding.
- **Pay Slips & Payroll** — create, validate, approve; calendars, records, tax schedules; trainings can be added here.
- **Talent Pool** — qualified-but-not-hired applicants are retained for **succession management / business continuity (BCMS).**
- **Employee HR Portal** — employees download pay slips for any month, request leave, check attendance, view SOPs and their own records.

---

## 11.5 Sales & CRM

**[1:25:00 – 1:29:14]**

**Blake:** Very important module.

- **Leads** — add leads manually or ingest from the tenant's website via a **website API intake.** The legacy system already has a solid lead system: create a lead (company name, etc.), then enter a **live meeting** with the lead — **record and auto-transcribe** the meeting, secure the notes, and use **AI to draft a proposal.** We rebuild this from scratch rather than migrate (migration risks errors), but keep the old code in a **reference folder** for inspiration.
- **Meeting Management** — notes, minutes, schedules; voice-to-text (Whisper/Grok) for transcription.
- **Marketing Campaign Register** — gather marketing campaigns; **email marketing and newsletters** (leveraging the configured SMTP). Website visitors subscribe to newsletters if their site is connected. We can offer a package that **builds or connects a tenant's website** to the system.
- **Proposal Generator** — **AI-assisted** (Gemini or DeepSeek), with a **human review before sending.**
- **Sales Pipeline** — multiple **stages**; when a quotation is sent it advances automatically, showing margins and everything.
- **Intakes** — from "Contact Us," partnership forms, and any inbound website intake; centralise these (under leads or as a distinct "intake").
- **Project Portfolio Builder** — when a project completes, a **sign-off sheet** is produced; **AI builds a portfolio / success story** and pushes it to the tenant's website automatically (no back-end engineer needed to hand-code portfolio updates).

---

## 11.6 Commercial & Pricing

**[1:29:14 – 1:33:28]**

**Blake:** Very important — and note the ordering: **Logistics Operations comes *before* pricing**, because operations precede the pricing.

- **Project Costing** — for each project/operations file, build a **budget**: *what will it cost us to execute this file?* Pull all applicable items for that service from the **Financial Dictionary**, check the costs, and arrive at the **actual cost to execute.**
- **Margin Simulator** — take the costing, enter a **margin**, and it applies automatically to all rates. It distinguishes **disbursements vs. services** (a nuance documented in the knowledge base): margin applies to services.
- **Quotation Generation** — enter the **pricing** we want to quote and **generate a quotation.** A quotation has **no accounting impact** — the client can accept or reject.
- **Extra-Charge Engine (Demurrage Calculator)** — a simulator. Blake wants this **copied as-is** from the legacy system (the calculator "was already built perfectly"), just porting the back end from **PHP → Node.js** and making it more dynamic. Pick a file, set the period / the date to take it out of the port, and it returns all charges with rates. Because pricing is now **centralised** (the **Expense Rate** module holds 20-ft/40-ft and other rates), we don't re-enter the "admin rates" setup the old system required.

> **🤝 Teamwork (Elisha's charge on effort & the long game)** —
> **Elisha:** "What I'd say is that all of us put our best effort — because **this is not for one client.** We need to look into the future and put in our effort to deliver to other clients. It'll help us in the long run, so we don't just do a neglected work and say 'let me get my payment and move on.' No — we need to think ahead: this is a **sustainable product**, we can configure it for whatever clients we get, get our pay, and be satisfied. Like we did for **Pixie Girl** — a broad project Elisha and I did; it stressed us a lot, but we're seeing a future. We're on a good path — so please, everybody work with their best effort."
> **Blake:** "Thank you — it's very important to emphasise that. I wish David were on when you said it, because without someone **long-sighted, looking into the future**, it won't be easy to get on with this project."

---

## 11.7 Logistics Operations — the heart of the system

**[1:33:28 – 1:49:29]**

**Blake:** This is the **heart of the entire build.** Under Logistics Operations there are **three main modules.**

### (a) Main Logistics Operations — the Operations File
- **Operations File Registry** — each project has its **project file** with full details. A very rich core.
- **The 360° file view** — opening a file shows *everything* about it: **service type, route, Incoterm, Bill of Lading number, vessel number, ETA (estimated/established time of arrival), milestones**, and every internal person assigned to the file. When a file is created it can be **assigned** immediately. It carries the **client's name and full client details**, and the **shipment details (SSD — shipment details / summary).**
- **Milestones — flexible, not fixed.** Show the milestones for a project; the client can **edit and create new milestones**, even **insert a milestone between two existing ones** (e.g. a problem arises before the next milestone). Because milestones use **due dates**, inserting one **auto-recalculates** the schedule downstream. Not limited to a fixed number (e.g. not capped at 14). The legacy "milestone tracking" has a basic version of this — the rebuild is far more capable. Each stage, when clicked, shows everything about that stage and can be **completed**; new stages can be added.
- Blake will **personally help with the design** of the operations-file view.

### (b) Transit Orders
- Essentially identical to the legacy version — "may never change." Can be **imported as-is** from the old system.

### (c) Operational Milestones + Client Portal / Smart Tracker
- Upload **documents / proof** against milestones.
- A **client-facing ticket ("Q ticket")** system: milestones push to the **client portal.** On **smartls.com** there's already a **Smart Tracker** — enter a file reference and see milestone status (pending / done). The rebuild adds, on each milestone, the ability to **raise a Q ticket** (e.g. flag a delay) and **upload proof**; we receive it on the back end and follow up. There's also a **mail-to** option, but the focus is **Q tickets** so everything stays in the system.

### Delivery Notes
- Straightforward; can **import** what exists. The moment a project completes, **auto-generate the delivery note** (search the client, it fills city/zone/etc.; add the contact person). Build it for the long term, not just one customer.

> **📌 Context** — "The operations file is like the heart of the whole thing — that's the honest truth." Every other module deep-links back to it (costings, documents, comms, audit). This is later surfaced as the **Operations-File 360° modal** signature feature (§11.16).

---

## 11.8 Warehouse Management (WMS) — full scope

**[1:49:29 – 1:52:09]**

**Blake:** This module did **not** exist in the previous system (this first client doesn't do warehousing) — but we build it now because the **next target, "Base Cameroon"** (introduced to us by this client), has **larger operations, warehouse management, and fleet management.** Building it now means the system already accommodates them.

- **Inbound Operations** — **Goods Receipt Note (GRN)**, **QA/QC hold & inspection with certificate**, **direct put-away.**
- **Space & Location Management** — **zone / rack / bin.**
- **Inventory Control & Tracking** — live stock state management, full audit.
- **Outbound Operations** — **pick / pack / dispatch** logic.
- **Equipment Handling** — machinery allocation and status.
- **Full-Audit Cycle Counting.**

> **🤝 Teamwork** — A teammate re-emphasised (through choppy audio): the **long-term future** of this is very important — we configure once, then reuse for each new tenant. Blake reframed the point sharply (see §13): **"see this as a *product*, not a *project.*"**

---

## 11.9 Fleet Management

**[1:52:35 – 1:55:21]**

**Blake:** Fleet = vehicles: **company vehicles** and **heavy trucks** for container transport (low-bed carriers, empty-back / various truck types). Sub-apps:

- **Vehicle & Asset Registry** — create every vehicle/asset.
- **Compliance & Periodic Expense** — manage documents and renewals: **insurance**, **visite technique** (French; periodic technical inspection proving the vehicle is roadworthy). Includes an **alert engine** for upcoming renewals.
- **Maintenance & Work Orders** — **preventive and corrective** maintenance; **spare-part integration.**
- **Dispatch & Allocation** — assignments; check-in / check-out logs.
- **Fuel & Usage Tracking** — odometers, fuel consumption, **variance** flags.
- **Driver Management** — all drivers (drivers are also employees, but surfaced here). Ensure each driver holds the **licence and certification** for the equipment they drive (e.g. a **low-bed carrier needs a special licence**, not a regular one). Connectable to HR but important here.
- **Incident & Claim Management** — tracker for incidents and claims.

**Blake:** So the **three main angles of operations** are: **customs clearance, freight forwarding, and warehouse/fleet.** They all come under Logistics Operations; WMS and Fleet are a bit dependent on the files created. We'll organise it properly.

---

## 11.10 Project Costing (cost tracking & reconciliation)

**[1:55:21 – 1:57:28]**

**Blake:** We've covered project costing as a **budget**; now each cost needs a **tracker.**

- **Cost Tracker** — don't record twice: when a costing is **approved**, pull its data into the tracker. See everything spent per file and per cost line; analyse and understand cost over time; **AI insights** on cost.
- **Project Cost Reconciliation** — the project costing at the top is a **budget**; after real spending, do the **reconciliation**: **budget vs. actual**, highlight discrepancies (variance) and discuss.
- **Project Disbursements** — each project requires cash, paid through a payment system: a **Cash Request / Payment Request** (accounting term ≈ **régie d'avance** — a cash advance / imprest; Blake noted he couldn't find the exact English word).

---

## 11.11 Finance, Treasury & Accounting

**[1:57:28 – 2:07:35]**

**Blake:** The important module for finance.

### Invoicing & the project life cycle
- **Proforma & Advance-Payment Invoices** — Elisha is very familiar with these (he built them for the original SmartLS). Includes **signatures** (digital or physical).
- **Final Invoices** — issued when a project is complete.

**The full life cycle (stated explicitly):**
1. An **operations file** comes in.
2. Create a **project costing** — an estimate of what it costs us to execute the file.
3. Run a **margin simulation** — at this cost, what's our exact margin?
4. **Generate a quotation** from the margin simulator and send to the client.
5. Client **accepts** the quotation.
6. **Request cash for payment** (costing already approved). Two paths:
   - **We pre-finance** disbursements and services → *no* advance-payment invoice, **or**
   - **Client pays** → issue a **Proforma / Advance-Payment Invoice** requesting an advance.
7. When the client pays and the **system approves the payment**, move to the **cash request** — pay for the request to execute the project.
8. After spending, **come back and confirm** against the budget: "we gave you 500k for this, 1M for that — how much did you actually spend?" Attach **receipts** for each.
9. Once receipts are in, run **budget vs. actual** → discuss **variance** → handle any **reimbursement** in the system.
10. Complete execution → issue the **Final Invoice**: deduct what came in via the proforma; show the remaining amount owed, with a **payment deadline** so we can **track overdue payments.**

### Payments (no gateway in Cameroon)
**Blake:** **Cameroon has no payment gateway for now**, so payment is **manual** — you make the payment and **upload the receipts.** Also, these are **very heavy transactions** — a client might pay ~**50 million**; no local gateway accepts that (local options like "camp"/others cap around ~5 million). When we enter the **Nigerian market**, we can look at payment gateways. Long term, as we expand to other markets, we revisit gateways.

### Invoicing UI
- Group front end: one **Invoicing** area with tabs — **Proforma Invoice**, **Final Invoice**, and the **Smart Receivables Ledger** — because they're all connected (proforma → final → receivables tracking of payments and overdues).

### Project Financing (Debt Management)
- To finance a project, a company may secure a **loan** — from a bank, a third party, or a director. The legacy system already has **Debt Management** (create debts, etc.); we can be inspired by it. Here it's called **Project Financing.** Track **working capital**, the **principal amount**, and exactly how much financing the costing needs.

### Asset Management (accounting-linked)
- Create every asset in the business (laptops, desks — any asset). Because it's accounting-linked, track **depreciation**: when creating an asset, pick the **depreciation method** (e.g. **linear/straight-line**, and others per the OHADA knowledge base). Handle **book and tax** depreciation per asset.

### Accounting core (OHADA, automated + manual)
- **Journal Entries** — **auto-journalled**, with a **manual option**; when auto-journalled, a **human accountant can review, touch, or tweak** it (details in the OHADA knowledge base).
- Full outputs: **Journal**, **General Ledger** (French **"Grand Livre"**), **Trial Balance**, **Income Statement**, **Profit & Loss**, **Cash-Flow Statement** — all the financial statements required by the accounting system. If the system generates these automatically, "we're 100% good to go."

---

## 11.12 Procurement

**[2:07:35 – 2:09:34]**

**Blake:** The last modules are lighter. Procurement:

- **Purchase Orders** — already built in the legacy system; **automate it better** and integrate AI.
- **Goods Receipt Note (GRN)** and **three-way match** (PO ↔ GRN ↔ Supplier Invoice).
- **Purchase Request (PR)** — anyone can request ("I need a new laptop"); it's **approved by the line manager** (per the workflow), routed to the **GM**, and once approved a **Purchase Order is raised.**
- **Supplier Invoice** — what the supplier billed; then **posting into accounting.** Advance payments on a PO are supported.

---

## 11.13 Document Vault & Data Insights

**[2:09:34 – 2:13:15]**

- **Reporting & Insights Pack** — mostly **dashboards**; **fixed reports** exported to **Excel and PDF**; many interactive dashboards with graphs and tables. **AI is connected to every dashboard** — you can "talk with" a dashboard (chat below it). Selling point vs. **Power BI**: Power BI has Copilot but hasn't integrated AI *into* the dashboards this way. Builds credibility in the market.
- **File Repository** — all uploaded documents, traceable; shows **storage path** and **version numbers.**
- **Compliance Checker** — flags **missing evidence / supporting documents.** Example: for a Financial Dictionary line (e.g. "container maintenance 20-ft"), once there's an **approved costing** and a **cash request disbursed** (a payment made), the user **must upload proof** they actually spent it. If not, the system **flags red** and sends **daily notifications** ("you have pending…") until uploaded.
- **Document Verification** — already built in the legacy system: reviewers open an uploaded evidence in the **Action Center** and **Verify** or **Reject** it (verify = approved). It's a **feature**, not a standalone module.
- **All generated documents are evidences** and are centralised here, separated into folders. **Prepare storage so it can move to an S3 bucket** tomorrow.

---

## 11.14 System Clearance & Security

**[2:13:15 – 2:18:04]**

**Blake:** Before the AI discussion — System Clearance & Security.

- **IAM (Identity & Access Management) / full RBAC engine** — control the full **CRUD** ("who does what") **and** the **validation & approval channels.**
- **Universal Event System + workflow designer** — for each module where a document is generated/created and an event requires approval, configure it here. Example: **"Approve Invoice"** is an event; we may split into **"Validate Invoice"** and **"Approve Invoice."** Pick a module, see all its events, and **set who validates and who approves** — and add **more validators** to lengthen the chain for extra security. This is effectively a **dynamic workflow designer**: a company with 10 teams, each with a team lead → line manager → operations manager → COO, can build that **approval chain dynamically without writing code.**
- **Session Management** — active/live sessions, **remote kill**, auto-logout (as in §7).
- **System Health.**
- **Immutable Ledger / Audit Trail** — where all deletions go, and where **every audit trail** lives. Push **every event, transaction, and activity** to the audit log. This is the **Single Source of Truth (SSOT)** for disputes: "if there's any fraud, or someone says they can't find something, we pull the audit log and show them." There's a **front-end UI** for it; access can be granted to an **external auditor** during audits.
- **Settings module** (previewed here, detailed in §11.17): appearance & white-label, sandbox interval, tax rates, **document numbering** (e.g. project costing starts with **"SLS…PC…"**), email senders (email design/templates), **feature toggles**, workflow, approval limits, organisational compliance.

---

## 11.15 AI Automation & the Universal Event Engine

**[2:18:04 – 2:18:50]**

**Blake:** The AI, automation, and **Universal Event Engine.** This whole area — **assigned to Elisha** — he'll go through it in detail and we'll see how to make it better.

**Elisha:** We've implemented AI in one of our projects already, so it'll be easier to implement here — **gated by the EMV (env flag) from front end and back end.** Not much of a problem.

**Blake:** *"Front end and back — please take note here."*

> **📌 Context** — The Universal Event Engine underpins both the AI action layer (Zod-validated payloads) and the RBAC workflow designer (events → validate/approve chains). It is a **first-class** part of the architecture, owned by Elisha.

---

## 11.16 Signature features & portals

**[2:18:50 – 2:24:16]**

- **Signature Feature (document signing)** — a portal where people **sign all documents** (upload signatures, sign digitally).
- **Client Portal** — public-facing; clients log in for information; can be **attached to the tenant's website** (we add a UI on their site linked to this portal). Offered as a **signature feature** other ERPs don't provide.
- **Investor / Board Terminal** — mostly **read-only**: view **KPIs and financial statements**, but **no operational detail** — a global view only.
- **Audit Terminal** — uniquely the **immutable ledger** (our audit log) as a **data room**; auditors access documents and the ledger.
- **Support & Feedback Dashboard** — clients push errors/feedback directly. Modelled on the Pixie Girl project: when an error occurs (e.g. publishing a storefront page without saving), the UI offers **"Need help? Send this to your system admin,"** which sends a **WhatsApp message to us with an auto-screenshot** and full context (hub name, area, page, action, error). Here it becomes a dashboard with a **kanban flow: New → Try it → In Progress → Shipped → Declined.** On **our** end there's a **portal showing all tenants** and their incoming feedback, so we solve issues as they're reported without constant calls.
- **Operations-File 360° modal** — the file with its **milestone, people, money, documents, comms, audit** — everything — plus the **animated route map** (origin → destination). A signature feature.
- **Internal Communications Portal (Smart Comms)** — **corporate, WhatsApp-style**, **real-time via websockets.** No in-app calling (unreliable on local networks): a **dialer** button opens the phone's dialer; **mail-to** opens the email client. **Auditable** — all chats can be audited and a chat **exported over a period.** The **client portal** can access it, so clients text us; it can link to our **email** (inbound from support@/invoicing@ lands here; outbound goes via mail). **No WhatsApp/Instagram APIs** — these are corporate bodies using **formal** communication (unlike the team's other projects that include Instagram/WhatsApp APIs).

---

## 11.17 Settings, front-end/PWA & data migration

**[2:24:16 – 2:26:14]**

**Settings module** — the configuration hub:
- **Appearance & White-Label** — logos, PWA and PWA icons.
- **Company & Legal Identity** — (as in Corporate Entity, §11.3).
- **Operations & Workflow Configuration.**
- **Finance & Tax Configuration.**
- **Communications & Email** — the per-tenant SMTP (§9).
- **Integrations & Keys** — all AI keys, exchange rates.
- **Feature Toggles** — activate/deactivate any plan/feature for anyone.
- **Multi-Entity & Consolidation** — a tenant holding multiple entities can run a **consolidation.**

**On AI keys / env (EMV):** these **won't appear in the env by default** — they're **configured per client.** The same API key can serve two or more clients, or we mint a new key per client. Under Email/SMTP: set the **default "from" name** (e.g. "Billing"), the **billing address** (billing@smartls), the **operations/documents address** (documents@smartls), and the **support address** (support@smartls).

**Front end & PWA, and data migration** — the front end/PWA plus **data migration from MySQL → PostgreSQL** (after the meeting's decision to move off MySQL).

**Blake:** That's essentially everything. **This is version 1** of the product. Any future capability, we build and make better over time.

---

# 12. Team operating model & project logistics

**[2:26:14 – 2:43:13]**

### Repository, README & the documents folder

**Blake:** I'll share everything. We should **create a repo** and drop the entire project folder there. In my folder I already have: the **"administration"** folder (the legacy **ERP**), the **website**, several **documents**, the **current database exported as a MySQL `.sql` file**, the **rejected mockup**, and the **new mockup from Lovable** (I'll download the full Lovable front-end and add it as `reference-mock-lovable`). I'll add a **`doc` folder** for any documents that help us, so we can reference from there.

**Blake:** The legacy code **was not connected to any GitHub repository**, so we create a new one now.

**Victor** will handle repo setup and connect everything.

**Blake:** Set it up as **PR-based, not open collaboration** — every contribution comes as a **Pull Request we must confirm.** Victor will also write a **README** that everyone consults before doing anything; he'll need everyone's documents to compose it well.

> **✅ Decision** — New **GitHub** repo, **PR-based workflow** (all PRs reviewed/confirmed). **Victor owns repo setup + README.** A `doc/` folder holds the knowledge base: legacy PHP ERP, website, MySQL export, rejected mock, Lovable reference front-end, PRD, OHADA KB, and this transcript.

### Roles & the full-stack expectation

**Blake:** I want you to understand — **everybody here is full-stack.** There's nobody who is only front end. Everyone can handle front and back end. If you *lean* one way, that's fine, we'll talk about it, but we're on the same page.

- **David** leans **front end** (he can reuse the Lovable components).
- **Victor** therefore leans more **back end.**
- **Blake** comes in as the **organiser**: assigning duties, doing **cleanup, the deep-linking between pages, and a lot of back-end touches.** He'll dispatch work across the team (deliberately avoiding the word "sprint" so it doesn't limit them).

**Blake:** So — **you do your part end-to-end, completely.** I'll assign duties, and at home we do the cleanup and connections. We work as best we can so Tom does a **minor cleanup** and then **we ship to clients.**

> **🤝 Teamwork** — "It's very agile — not a stagnant or traditional project. We can find ourselves covering for each other." And: **"There's no front end or back end — you are doing full stack. The product must work."**

### Claude (CL) accounts & advances

- Everyone gets a **paid Claude Pro** account (**$20** tier — *not* the $100 Max tier).
- **Elisha** already has one (needs to renew another); **Victor** gets one; **David** gets one. Blake already holds two/three on his end.
- Blake will **put money on a card** and use that card for the payments.
- **Advances:** Blake **waits for the end of the project** to collect his payment in full. **David** takes an advance (Blake will deposit it). **Victor** to decide. Claude accounts are funded at the **beginning** of the project for everyone.

### Contracts, milestones & performance

**Blake:** By tomorrow I'll prepare **contracts** — **yearly, renewable each year** (avoiding a long lock so a non-performer isn't retained; one/two-year renewable). I'll also deposit the **advances.**

- **Work with milestones.** Review **performance** based on **delivery rate and willingness to work.**
- Everyone puts in their all — we **push and pull each other** (pulling David, Victor, or Elisha as needed).

### Communication

- A **WhatsApp group** for the whole team — **no one-to-one conversations.** "Everybody converses as a team, not as an individual." Keeps everyone updated end-to-end.
- **David** (who missed the logistics and sales portions due to connectivity) asked that the **full recording** be posted to the group so he can review properly.

> **🔧 Action summary (team logistics):** Victor → create repo + README this evening; Blake → prepare contracts + deposit advances (by tomorrow), fund Claude accounts, create WhatsApp group, share all docs + Lovable export + recording; everyone → provide docs to Victor for the README; David → review the full recording.

---

# 13. Teamwork & culture — the founder's charge

> This section preserves, close to verbatim, the founder's closing charge and the team's affirmations. It is part of the source of truth: **how** this team works is as much a spec as **what** it builds.

**Blake (closing charge):**
- "This is **version 1 of the product** — let's call it a **product, not a project.** A project ends when you're done; a **product** is built for **sustainability**, over time."
- "See the **full vision**, not just the project. Look **long-term**. Think **market expansion** — Cameroon first, then Nigeria, then overseas (China and shipping companies). We target clients, configure for them, get paid, and grow."
- "Please, everybody, **put in your best effort.** Don't take this as 'let them just pay me and let me get out.' There's a **bigger market in front of us.** You saw it with **Pixie Girl** and our hub — I know the **vision of JBS Praxis.** Please know the vision too."
- "There's **no front end or back end — you are doing full stack. The product must work.** Regardless of who wrote which module, **everywhere must work.** We **audit for each other and have each other's back.** That's the mantra: **the system must work.**"
- "Performance **will be reviewed** — JBS Praxis will review your performance based on delivery and willingness. Thank you, everybody. JBS, continue."

**Team affirmations:** Elisha and Victor confirmed alignment ("I'm with you"). **David** added he had nothing to raise for now but would go through the recording, since he wasn't stable on the call.

**Blake (final):** "We update each and every one of us — we need to keep updated end-to-end. As you work, **please update.** If you have any difficulty, **update.** If you have any question, **ask** — this is very important for the future of each and every one of us."

> **🤝 Teamwork — the operating principles, distilled**
> 1. **Product, not project** — build for sustainability and reuse across tenants.
> 2. **Full-stack ownership** — lean where you're strong, but own your work end-to-end; "the system must work."
> 3. **We audit for each other** — collective ownership of quality; have each other's back regardless of who wrote what.
> 4. **Communicate as a team** — one group, no silos; update proactively, ask early.
> 5. **Long-term vision** — Cameroon → Nigeria → overseas; performance reviewed on delivery and willingness.
> 6. **Track everything** — the immutable ledger/audit trail is the SSOT; the same discipline applies to how we work (this transcript, the README, the doc folder).

---

# 14. Appendices

## Appendix A — Decisions log

| # | Decision | Section |
|---|---|---|
| D1 | Multi-tenant SaaS, one codebase; per-tenant subdomains on `praxisls.com`; white-labelled theming; super-admin controls modules per tenant. | §4 |
| D2 | Target segment: heavyweight logistics (freight forwarding, customs clearance, WMS, fleet). Cameroon → Africa. | §2 |
| D3 | Build **everything** now (first client funds it); enable modules per tenant later. | §2 |
| D4 | Stack: React 18 + Vite + TS (PWA) · Node.js + TS · separate workers (AI, PDF) · Redis + BullMQ · Socket.IO · Zod · Docker · Puppeteer/Chromium PDFs · Nodemailer. | §5, §10 |
| D5 | **One PostgreSQL database per tenant** (tenant owns/can access their own data). | §5 |
| D6 | **Test/Live toggle**; Live + Sandbox **inside each tenant's Postgres**; sandbox purged by cron every **14 days**; no shared staging server. | §6 |
| D7 | RBAC enforced **server + client**; JWT + refresh; 30-min auto-logout; Redis session state with remote kill; 2FA encouraged. | §7 |
| D8 | AI: **DeepSeek primary, Gemini fallback**; Whisper (self-host) or Grok for voice; **two-part EMV toggle** (front UI + back action); per-tenant spend dashboard. | §8 |
| D9 | Per-tenant SMTP + role mailboxes via DNS; fallback sender **nmail.praxisls.com**; all docs emailed from the system. | §9 |
| D10 | **Daily encrypted backups** (all tenant DBs + platform schema) → Google Drive/OneDrive → S3 later. | §10 |
| D11 | Scaling ladder: 1 → 12GB/6-core · 2–4 → 24GB/8-core · 5–10 → split servers · 10+ → connection pooler. | §10 |
| D12 | **Financial Dictionary ↔ Chart of Accounts ↔ Expense Rate**: linked but distinct (don't merge). | §11.3 |
| D13 | Accounting on **OHADA/SYSCOHADA** (not IFRS); bilingual (FR/EN); use the OHADA knowledge base. | §11.3, §11.11 |
| D14 | **Services and workflow stages are configurable data, not hard-coded.** | §11.3, §11.7, §11.14 |
| D15 | Centralised, **seeded-but-editable** rate table keyed by shipping line; onboarding via Excel import. | §11.3 |
| D16 | **God Mode** (CEO PIN+password); all deletions reversible via immutable-ledger JSON payload. | §11.2 |
| D17 | Milestones flexible (insert between, auto-recalculate due dates); not fixed count. | §11.7 |
| D18 | Build **WMS + Fleet** now for the next target (Base Cameroon), even though client #1 doesn't use them. | §11.8 |
| D19 | Payments **manual** (no Cameroon gateway; heavy amounts ~50M); revisit gateways for Nigeria/overseas. | §11.11 |
| D20 | Dashboards **AI-connected** (differentiator vs. Power BI). | §11.13 |
| D21 | **Universal Event System + RBAC workflow designer** for dynamic validate/approve chains. | §11.14 |
| D22 | Immutable ledger / audit trail = **SSOT**; external-auditor access via Audit Terminal. | §11.14, §11.16 |
| D23 | **Smart Comms**: corporate WhatsApp-style, websockets, auditable/exportable; **no** WhatsApp/Instagram APIs. | §11.16 |
| D24 | New GitHub repo, **PR-based** workflow; Victor owns repo + README; `doc/` knowledge folder. | §12 |
| D25 | Everyone full-stack; David → front-end lean, Victor → back-end lean, Blake → organiser/cleanup/deep-linking. | §12 |
| D26 | Paid Claude **Pro ($20)** per engineer; funded at project start. | §12 |
| D27 | **Yearly renewable contracts**; milestone-based; performance reviewed on delivery + willingness. | §12 |
| D28 | Team WhatsApp group only — **no one-to-one**; update proactively. | §12 |
| D29 | Data migration **MySQL → PostgreSQL**. | §11.17 |

## Appendix B — Action items

| Owner | Action | Due |
|---|---|---|
| Victor | Create the GitHub repo (PR-based) and write the README. | This evening |
| Victor | Confirm/collect a GitHub account for repo setup. | This evening |
| Blake | Prepare yearly contracts; deposit advances (David now; Victor TBD). | By tomorrow |
| Blake | Share all documents, Lovable front-end export, MySQL `.sql`, and the meeting recording to the group. | Immediately |
| Blake | Fund Claude Pro accounts (card); Elisha to renew one. | Project start |
| Blake | Create the team WhatsApp group. | Immediately |
| All | Provide documents to Victor for the README. | Before build |
| All | Get paid Claude Pro accounts set up. | Project start |
| David | Review the full recording (missed logistics & sales). | Before build |
| Elisha | Own AI automation + Universal Event Engine; deep-dive and refine. | Ongoing |
| Blake | Personally help design the dashboard "Control Tower" and the Operations-File 360° view. | Design phase |
| Team | Follow up with David re: participation and role confirmation. | Post-meeting |

## Appendix C — Open questions / to confirm

1. **Per-tenant encryption keys** — mint a key per tenant, or store hashed in the DB? (Blake floated the hashed-in-DB option; not settled — §7.)
2. **Maps provider** — start on a free-tier maps API, migrate to Google Maps when funds allow; provider TBD (§11.1).
3. **"Validate Invoice" vs "Approve Invoice"** — one combined event or two separate events in the Universal Event System? (§11.14)
4. **Setup/pricing model for data-owning tenants** — ~2–3M setup + ~500k/yr maintenance to grant own-Postgres access (indicative, per-client — §5).
5. **Victor's advance** — take an advance or not (David: yes; Blake: end-of-project). (§12)
6. **Which tenants get a website package** — build-from-scratch vs. connect-existing; pricing per client (§11.5).

## Appendix D — Glossary

| Term | Meaning |
|---|---|
| **Praxis LS / SmartLS** | The product. "SmartLS" is the legacy/working name in code & docs; "Praxis LS" is the product name. |
| **JBS Praxis** | The company building and selling the product (heard as "JPS/JDS practice" in audio). |
| **Tenant** | A client company using an isolated instance (own subdomain, own Postgres, own Live+Sandbox). |
| **OHADA / SYSCOHADA** | Harmonised accounting system for French-speaking African countries; used instead of IFRS. |
| **Numéro Unique / NIU** | Cameroon tax identifier (≈ TIN in Nigeria). |
| **RCCM** | Trade & personal property registry number (≈ CAC number in Nigeria). |
| **CNPS** | Cameroon social-security number (≈ pension/retirement fund number). |
| **Visite technique** | Periodic vehicle technical inspection (roadworthiness). |
| **Grand Livre** | General Ledger (French). |
| **Régie d'avance** | Cash advance / imprest (the "cash request" concept). |
| **Incoterm** | International commercial delivery term on an operations file. |
| **BL** | Bill of Lading. |
| **ETA / SSD** | Estimated Time of Arrival / Shipment Summary Details. |
| **GRN** | Goods Receipt Note. |
| **Q ticket** | Client-raised query/issue ticket against a milestone (kept in-system vs. email). |
| **EMV** | Environment flag/variable used as the AI front-end/back-end toggle. |
| **CL** | Claude (AI assistant) — paid Pro accounts per engineer. |
| **Control Tower** | The role-driven main dashboard. |
| **God Mode** | CEO-only, PIN-protected data-purge module (reversible via immutable ledger). |
| **Immutable Ledger** | Append-only audit trail; SSOT for deletions, events, and disputes. |
| **Base Cameroon** | The next target client (larger ops, WMS + fleet). |
| **Pixie Girl** | A prior project by the team, referenced as proof of capability and work ethic. |

---

*End of transcript. Prepared as the Source of Truth for building Praxis LS (v1). Retain alongside the PRD, the OHADA accounting knowledge base, the RBAC/Super-Admin journey, the UI mockups, and the legacy codebase in the project `doc/` folder.*




