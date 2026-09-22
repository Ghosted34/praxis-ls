# Changelog

All notable changes to Praxis LS.

**Why this file exists (TC-R1).** There was no unit of "a release" in this
system — no tags, no GitHub releases, no changelog, and all three
`package.json` files frozen at `0.1.0` across 93 CI runs and 44 production
deploys. Every commit was silently a deployment, and the only way to answer
"what changed between Tuesday and Thursday?" was to read `git log` and hope the
messages were useful. They often were not: the merge commits — the ones a
changelog would be built from — include _"Lots of changes"_, _"a lot"_ and
_"audit portan and opportunities board list"_ (TC-R4).

**How to use it.** Add a line under `## Unreleased` in the same PR as the
change. At release time, rename that heading to the version and date, tag the
commit (`git tag -a v0.2.0 -m "..."`), and start a fresh `Unreleased`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dates are ISO-8601, UTC.

---

## Unreleased

### Added

- **A link in a Smart Comms message is now a card, and the server that renders it can be told not to fetch at all.** A pasted URL used to be the URL: `https://maersk.com/v/vessel/2` and `https://phishing.example/v/vessel/2` looked identical, and the automated blockage notice ended in a 46-character `/workspace/tasks?task=…` path nobody can read aloud on a phone. `packages/shared/rules/link-detect.js` (shared, so the bubble linkifies the same characters the server unfurled) turns `scheme://…` and `www.…` into links, peels sentence punctuation but not balanced brackets, refuses `data:`/`javascript:`/`file:` outright and refuses to guess at bare domains — `e.g.`, `doc.pdf` and `192.168.1.1` are text, and a heuristic that cannot tell them from a payment link is worse than no heuristic. A path that resolves in-app (`/workspace/tasks?task=`, `/finance/invoices/<id>`, …) is never fetched: `entityRoute.parseUrl` recognises it and it becomes a labelled chip that navigates the SPA, because a product that fetches itself over its own public interface arrives at its own login page and would have called the sign-in form a preview. Everything else is unfurled once into `comms_link_preview` (`migrations/tenant/13990_comms_link_previews.sql`), **keyed on the canonical URL rather than the message** — which is what lets eleven `postMessage` callers forget about links entirely, needs no backfill (resolution walks the body at read time, so old threads light up), fetches a client's tracking link pasted nine times exactly once, and keeps a card as trimmable cache instead of message content. Send queues a fetch and never waits for one; `thread()` answers from one indexed query and **never fetches inline**; a card older than `COMMS_LINK_TTL_DAYS` is served from cache and refreshed behind the reader (stale-while-revalidate, with `stale_at` as the flag that says "ask again", not a rendering state); a per-tenant sweep drains what a lost queue job left behind, so the feature is self-healing rather than permanently missing. A failed refresh **never erases the last good card** — `putResult` COALESCEs onto the previous values — because a site briefly down must not turn a correct card into a bare URL. YouTube, Vimeo, Loom and Maps links get the provider's own length and author from its oEmbed endpoint and one button that opens it in a new tab: **no iframe**, because `frame-src 'self' blob:` is asserted as a security property by `tests/unit/csp-blob-media.test.js` and narrowing it for a preview would trade an audited policy for one decided per message by whoever posted the link. The security half is the reason this is not a weekend feature: `src/shared/net/guarded-fetch.js` is the only path out, and it allows http/https on 80/443, refuses credentials in the URL, resolves once and **pins the socket to the screened address** so DNS rebinding cannot swap in `127.0.0.1`, blocks loopback/RFC1918/link-local-metadata/CGNAT/Teredo/IPv4-mapped-v6 and single-label container names, **re-screens every redirect hop**, forwards no cookie or token, caps bytes and demands a content type — with `og:video`/`og:audio`/`twitter:player` never read at all, because a page may name any host as its video and that is not a reason to contact it. Preview images are served by the tenant's own proxy from the link's hash, so the site being previewed never learns a reader looked, an `http://` image cannot be blocked as mixed content, and SVG is refused because an SVG from an untrusted host is a script with a picture on it. The scrub that stops a page's `<script>` contents being read as declarations also accepts `</script >` — the whitespace-tolerant form is valid HTML and closes the element for the browser, so a scrub keyed on the exact string left a `document.write` free to pose as an `og:` tag. And the tokenizer's punctuation peel, address scan and route-slash trim are **linear character walks rather than anchored one-or-more regexes**, which is what CodeQL's ReDoS query objected to and what makes a message of twenty thousand `!` cost twenty thousand characters of work (pinned by rules that paste a wall of `!`, `%` and `@` and ask for nothing back). `COMMS_LINK_PREVIEWS=false` turns the whole thing off at the deploy level — deliberately env rather than a tenant setting, since what it stops is an outbound request made on a message's behalf — and links then stay plain text. The composer is the one place that waits, on the link a person is typing (700 ms after the keystrokes stop, once per URL, and never for a draft that was merely restored: opening a chat is not a question about a link). Spec: `doc/SMART_COMMS_LINKS.md`; 76 rules in `tests/unit/smartcomm-links.test.js` and `tests/unit/shared-link-detect.test.js` — including refusals asserted against a **real listening socket on loopback**, because the honest test of a pre-connection guard is that nothing was reached — plus `client/…/message-links.test.tsx` (17) pinning that `javascript:` never becomes an `<a>`, that every non-`OK` state renders nothing, and that a card's picture comes only from the proxy.

- **A task can now say "I am blocked, and here is why" — and the whole system believes it.** The commonest hold in a freight office is not another task: it is customs' network being down, a client who has not sent a document, a terminal on strike. Until now the only way to say that was to invent a dummy task and hang a dependency edge off it, polluting the board with work nobody will do. `task_blockage` (`migrations/tenant/13975_task_blockages.sql`) is the hold as its own row: a **required note** (a badge with nothing behind it is worse than no badge), who raised it and when, an optional estimate of when it clears, and — once resolved — who cleared it, with what note, and the due-date movement it caused. At most ONE active hold per task (`uq_task_blockage_one_active`, a partial unique index rather than application code), because "this task is blocked" is a state and the notes are the history of how long it was; resolved rows are **kept, never deleted**, because they are the evidence behind "late because of X for N days" in a performance review and behind the deadline that moved. "Blocked" now has ONE definition across every surface — the card pill, the panel callout and the Monitor's Blocked-work panel all read `dependency edge OR live hold` from shared SQL snippets in `tasks.repo.js`, so no screen can disagree about which work is stuck, and the Blocked-work table shows the hold's own sentence (written for exactly that reader) where a prerequisite's title deliberately does not travel. The panel's blockage box is **hidden until true**: a clean task shows one `+ Add Blockage` affordance whose explainer ("register it — it counts for your review even when the task is overdue, and the due date moves when you resolve it") is a hover tooltip on desktop and an ⓘ tap-popover on touch, because hover does not exist on the phones this ERP is used on; a live hold is a collapsed header (pill + first line + since-when) expanding to the note, the estimate, a **Resolve** button and the resolved history. Resolving closes the hold and moves an OPEN task's due date forward by **exactly the blocked duration**, recorded on the row that caused it (`due_shift`) so "why is this deadline later than the one I wrote" is answerable from the task's own history forever; a finished task's deadline is history and is never rewritten, and a racing second resolve click is a 404 rather than a second shift (`resolved_at IS NULL` in the write's own WHERE). A raise is the loud event: the people on the task plus **anybody the raiser names** — the person who can lift a customs hold is usually not on the task — each get a **forced** notification (in-app, push and email regardless of per-category silencing; a new narrow `force` option on `notification.service`, justified in its header and asserted in tests to skip the preference read entirely) **and** a SmartComm direct message in their own comms record, with optional posts to the raiser's group channels; resolving is the quiet one, honouring preferences, because good news can wait. Marking a task DONE while a hold is live is refused with the remedy named (resolve it — one button on the same panel), the same posture as the dependency rule. `POST /workspace/tasks/:id/blockages` and `…/:blockageId/resolve` (`can("edit")`, audited, event keys `task.blockage_raised` / `task.blockage_resolved`). 19 rules in `tests/unit/workspace-blockages.test.js` pin the single blocked predicate across every analytics surface, the one-active-hold and no-double-shift guards, the exactness of the due-date movement and the un-silenceable raise; 7 in `client/.../task-blockage.test.tsx` pin the hidden-until-true chrome, the two-gesture explainer, the collapsed default, the mandatory note and the resolve warning that precedes the click.

- **Tax registrations now produce a filing calendar, and the calendar chases itself.** `entity_tax_registration` has said "this entity files TVA in Cameroon, monthly, by the 15th, Ada owns it" since 0516 and nothing ever read the sentence: `tax_calendar` (0342) was written only by hand, so the deadline list the entity dossier showed was a list somebody had to remember to maintain — audit CE-16, closed by PR-05. `src/modules/master/corporate_entity/corporate_entity.tax-calendar.js` now derives obligation kind and cadence from each **active** registration plus a per-jurisdiction default used only for what the registration leaves blank (and the run says which parts it assumed), computes the period and its due date — a "file by the 31st" registration files on the last day of February or April rather than sliding into the next period or jumping back to the 1st — and writes the row with `tax_registration_id`, `period_code`, `period_start`/`period_end` and the responsible person **inherited from the registration**. Re-running is free and the database is what makes that true: every generated row carries a `generation_key` over entity + registration + obligation + period + **cadence**, `ux_tax_calendar_generation_key` (`migrations/tenant/13970_tax_obligation_generation.sql`) makes it unique, and the insert is `ON CONFLICT … DO NOTHING` — so a second pass, or two overlapping ones, write nothing. Putting the cadence *in* the key is the part doing real work: move a due day from the 20th to the 15th and the old obligation is **SUPERSEDED** with a reason while the correctly-dated one appears beside it, instead of a deadline quietly staying the way the registration no longer reads. Deregistering or deactivating a registration retires everything still open on it; a *future* `deregistered_on` still owes the part-period the entity was registered for. Obligations a person has already acted on (DONE, WAIVED) are never rewritten, and nobody is ever invented as responsible — an obligation with no owner is reported as a finding on the run rather than quietly given to someone. A nightly `tax-obligation` worker (`TAX_OBLIGATION_CRON`, 05:00 local, live and sandbox) generates, flips passed deadlines to LATE, and works a D30/D14/D7/D1 reminder ladder watermarked on `last_reminder_step` so a deadline is mentioned four times over six weeks rather than every morning until somebody acts; every one of those is an event on the tenant's own notification spine, never a mail hardcoded to an audience, and nothing hard-blocks — a missed filing is a fact for a person, in the same advisory posture as `corporate_entity.renewals.js`. Four new routes under `GET|POST /entities/:id/tax-obligations[…]` cover the list (MOD-01 `view`, with the joined tax number redacted by the serializer exactly as PR-04 does on the dossier and child routes), an on-demand run, and audited waive/complete/reopen and reassignment (MOD-01 `edit` per Decision Q10; `SUPERSEDED` is deliberately not writable by hand, and a waiver requires a reason). Statutory `entity_registration` rows are **not** read here — which statutory registration is "current" stays with PR-03's `doc/CORPORATE_ENTITY_REGISTRATION_CURRENT_ROW.md`, consumed by renewals. 47 rules in `tests/unit/entity-tax-obligations.test.js` cover month-end clamping (including a leap February), idempotent re-run, cadence-change and deregistration superseding, responsible inheritance/assignment/unassigned reporting, the reminder ladder, overdue handling and the audit trail.

- **A task can sit on several stages of its file's chain.** The task dialog's Milestone control was a single `<select>`, so "verify the shipping documents and lodge the declaration" — one piece of work that plainly belongs to two stages — had to be filed under one of them, and went missing from the other stage's view on the file and from the Analytics rollup while being work on it. The control is now the picked file's chain laid out as **toggleable chips in chain order** (each a real `role="checkbox"` inside a labelled group, numbered, with a running "2 stages selected" and a *Clear milestones* affordance), and the server stores the set in a new `task_milestone` join table (`migrations/tenant/13950_task_milestones.sql`, foreign keys on both sides — allowed because the table is NEW, the hazard 13920's header records is a constraint added to a table that already exists). 13920's single `task.milestone_instance_id` **stays, as a projection of the FIRST stage in chain order**, exactly as `task.reminder_minutes` is a projection of `workspace_reminder`, so an older client or AI caller that sends or reads the single id loses nothing; the migration backfills the set from it (joined to `milestone_instance`, since the old column has no FK and a dangling id would abort the file). `POST/PATCH /workspace/tasks` and the child form accept `milestone_instance_ids` (the set wins over the scalar when both are sent; `[]` clears), every stage is checked against the linked file — a stranger's stage is refused **by name**, and nothing is written — and every task read carries `milestones[]` and `milestone_instance_ids` in chain order. The list's `milestone_instance_id` filter and the by-milestone Analytics panel read the set, so a task on two stages is found from either and counted under both. Cards show `SL3213… · Pré-alerte +2`; the panel lists every stage. Proven against a real Postgres in `tests/integration/workspace-task-milestones.test.js` (create, replace, clear, unlink, refusal, inheritance, rollup, backfill), plus 35 unit rules in `workspace-task-file-link.test.js` and `client/src/features/workspace/file-link-field.test.tsx`.

- **One search box on the Tasks page, and a filter on the Calendar, that find a task by what people remember it by.** The List's search matched the title alone — the field people remember least reliably — and the Board had no search at all. The Tasks page now carries a single, URL-backed (`?q=`) search that narrows **whichever view is showing**: the server matches the title, the notes, the linked operations file's reference and its client's name, and the titles of the steps under the task (one bound pattern, `%`/`_` escaped, no predicate at all when the box is empty), on `GET /workspace/tasks` and — newly — `GET /workspace/tasks/board`. An empty result says *No tasks match "…"* with a way out, rather than *Nothing on the board*. The Calendar's "Filter this view…" box keeps its client-side scope (no new search endpoint) but now matches an event's notes, and a deadline's task notes, file reference, client name and stage labels — a step carries its parent's words — because `/workspace/deadlines` items now ride with those fields. Both boxes are the same `SearchField` (search landmark, `type="search"`, a clear button, Escape to clear, debounced). `tests/unit/workspace-task-search.test.js`, `client/src/features/workspace/search-field.test.tsx`, `tasks-page-search.test.tsx`, and a calendar case that finds a deadline by "brasseries", "SL3213", "scanner" and "douane".

- **Switching between LIVE and TEST asks first — everywhere, the same way — then reloads.** The desktop switch changed environment on a single unconfirmed click and the phone asked first; neither reloaded, so lists, caches and half-typed forms from the outgoing environment lingered until someone pressed Ctrl+F5. Every control (desktop segmented switch, phone bar, menu) now opens the same animated dialog — the current environment → the destination, an explicit *unsaved work will be lost* warning, and a *Stay in LIVE* / *Switch to TEST* choice with the destination's own colour (LIVE `--ok*`, TEST `--warn*`, tokens only). Confirming persists the choice, covers the screen with a short "Switching to TEST…" veil, and performs a **full page reload** so the app opens on the new environment's data with nothing carried over. Motion stays within the 250 ms budget and honours `prefers-reduced-motion`. EN/FR copy under `shell.env*`; `client/src/app/layout/env-switcher.tsx`, covered in `top-shell.test.tsx`.

- **Press and hold a task card to drag it into another stage — on a phone.** The board could be reordered with a mouse and with a keyboard, but not with a thumb: the only touch route was the card's Move menu, which is three taps for something a finger should do in one gesture. A finger now picks a card up by **resting on it for 250ms** and drops it in whichever column it is released over; the mouse still drags the grip at 8px, and `<KeyboardSensor>` still works from the grip, so all three inputs keep their own gesture (`MouseSensor`, not `PointerSensor`: a finger fires `pointerdown` too, so an 8px pointer constraint reads the first eight pixels of a scroll flick as a drag). The hold is deliberate rather than incidental — the board scrolls with the same thumb that drags, so the card waits instead of claiming the gesture at `touchstart`, nothing on it is `touch-action: none`, and a finger that drifts past 8px before the dwell is up was scrolling and the pending drag is abandoned. A tap therefore cannot reach the drag and still opens the card (phone sheet, desktop pane). The drag handle remains a separate element from the card's button, so the pointerup that ends a mouse drag still lands on something whose only listener is dnd-kit's. Covered by `features/workspace/tasks/task-board.test.tsx` (real `TouchEvent`s through the real sensors: hold-then-drag posts the move, a tap opens and moves nothing, a flick scrolls instead of dragging, two fingers never drag, the mouse still drags the grip) and verified in Chromium against the built app with CDP touch input.

- **The Control Tower KPI band: pick four tiles from a permission-bound catalog (PR-1).** Headline metrics were four hardcoded cards that disagreed with themselves — LIVE hid tiles TEST showed, revenue asserted "0.0" where nothing was measured, and nobody, any role, could choose what appeared. Now: a 31-entry catalog in `src/modules/dashboard/kpi_catalog/` (one file per domain, 10 live at PR-1), where every tile inherits the `can_read` grant of the module it aggregates and a masked `field_visibility` row retires its tile entirely; per-user selection (`kpiPins` on the shell preferences — one arrangement across LIVE and TEST, numbers differ, slots don't); per-role configuration (scope / default four / locks, `13800_role_kpi_config.sql`, seeded data-driven against each role's real grants in `migrations/seeds/9023_seed_role_kpi_defaults.sql`); an inline "Edit tiles" picker on the band; a Control Tower step in the role editor placed after the permission matrix because tiles can only follow grants; and a single zero policy — a resolved number (including 0) renders, an unavailable tile drops and is counted in the picker, never padded. `/dashboard/kpis` answers legacy keys + the resolved band. Spec: `doc/KPI_BAND_ENGINEERING_GUIDE.md`; PRs 2–4 (Ops/Fleet/WMS, Money/Sales/Procurement, Human Capital) flip the remaining 21 entries from hidden to live in parallel, each touching only its own domain file.

- **KPI band PR-3 — Money, Sales & Procurement tiles go live.** The last nine hidden catalogue entries ship their guarded queries, drills and EN/FR copy: `cash_collected`, `payables_overdue`, `cash_requests_awaiting`, `margin_closed`, `dso` (Money) and `pipeline_won`, `quote_requests_open`, `pos_in_flight`, `purchase_requests` (Sales & Procurement). The band's catalogue is now 30 live of 31 — only `stock_value` stays hidden, waiting on a cost column, as PR-2 recorded. Each tile keeps the one zero rule: a resolved number including 0 renders, a failed guard hides the tile. `dso` is the deliberate exception in the other direction — a weighted average over no outstanding invoice is SQL NULL, not "0 days to collect". **`margin_closed` needed three corrections to PR-1's placeholder**, all of which would have shipped silently: its `sourceRelation` named `costing_result`, a relation that exists in no schema, and offerability is gated on that name — so the tile would have been live, eligible and absent from every picker with nothing failing to say so; `costing.margin_percent` is deprecated and never written, so a costing-based query answers NULL forever; and the figure is served by `/margin-simulations` under MOD-27, so reading it behind MOD-46 would have shown a margin to a costing reader the margin module never granted. Gate, source and drill now agree. The temporary `KPI_ROUTE_PR2` table folds back into `KPI_ROUTE` now that the parallel branches have landed.

- **KPI band PR-2 — Operations, Fleet & Warehouse tiles go live.** Five of the six PR-2 entries flip from hidden to live with their guarded value queries in `operations.js` / `fleet_warehouse.js`: `late_vs_eta` (open files past a date-typed ETA with no ATA), `dwell_days` (average anchor-milestone→target-lock days over the last 90 days, through `num()` so no delivery means _unavailable_, never "0 days"), `fleet_docs_expiring` (`vehicle_compliance` due within 30 days, lapsed included — the same count as `/vehicle-compliance/expiring`), `work_orders_open` (OPEN + IN_PROGRESS), and `warehouse_occupancy` as a `{ value, denominator }` pair (units on hand ÷ recorded `capacity_units`, so "0 % over 700 units" and "no capacity recorded" stay different statements). Each ships an EN/FR label and hint and a hand-built drill (`drilldowns.ts`) off the module's own list endpoint; a 403 surfaces as the permission message, never an "all clear". **`stock_value` stays hidden, deliberately:** `inventory_item` has no cost column, so any "stock value" would be a guessed money figure; it needs one schema addition and PR-2 ships zero migrations by the guide's parallel-safety rule — the entry, keys and drill route are in place for the follow-up.

- **Human Capital is a first-class KPI domain, six tiles deep (PR-4 of the band plan).** The six HR entries declared in PR-1 go live with their value queries in `src/modules/dashboard/kpi_catalog/human_capital.js`: `headcount` (active register), `attendance_today` (a clocked-vs-expected PAIR whose denominator is weekend-, leave- and holiday-aware, so "0 present" and "nobody was expected" stay different statements), `leave_pending` (the same REQUESTED-without-advances queue the Leave screen decides), `vacancies_open`, `payroll_run_state` (runs not yet disbursed or rejected — a stuck run from an older period reads as in flight, not settled), and `attrition_90d`, counted from the append-only `employee.deactivated` event stream rather than a rewriteable status column so a reactivation cannot vanish from the rolling window. `payroll_run_state` keeps its `sensitive_field: employee.salary`: a masked reader gets NO tile (§4.3, uniform), and the drill blanks null salary figures to "—" rather than zeroing them. Each tile ships EN/FR labels and hints, a drill-down over the module list endpoints it is already entitled to read (`/employees`, `/attendance`, `/leave`, `/vacancies`, `/payroll`, one 200-row page each), and guard tests pinning the zero-vs-null split. The HR role's curated band (headcount, attendance, leave, vacancies — guide §7.2) arrives as a NEW seed, `migrations/seeds/9024_seed_role_kpi_hr.sql`: 9023 is already applied and the migrator keys on filename, so the row ships where 9023 has run and where it has yet to, intersected with the role's real grants exactly as 9023 does. Spec: `doc/KPI_BAND_ENGINEERING_GUIDE.md` §5.5, §12 (D12).

- **The stranger-facing app (`public-web/`), behind `SERVE_PUBLIC_WEB`.** A third Vite app beside
  `client/` and `platform-console/`, carrying the tenant marketing site (`/public/*`) and the
  external portal (`/portal/*`) on the tenant's own origin — a client emailed a tracking link must
  not be sent to a second domain whose cookies, CSP and Host resolution the ERP knows nothing about.
  Bilingual, gated in CI by `check:i18n` (457 keys, both languages) and `check:bundle` (110.8 kB gzip
  first paint against a 128 kB budget, acyclic chunk graph). `SERVE_PUBLIC_WEB` is **off by default**:
  the mount also claims `/track`, `/portfolio`, `/careers` and `/client-portal`, which the ERP
  already answers, so the switch is a deliberate act rather than a side effect of building the image.
  Turning it off restores the ERP's own versions of those pages; no schema or data is involved.

- **A counterparty can now SEE the document a secure link points at, instead of downloading an unnamed file to find out.** `/s/:token` offered a Download button and nothing else, on the deliberate grounds that "an in-app renderer for arbitrary vault bytes is a sandboxing project, not a viewer page" — correct on its own terms, and the wrong outcome: the person being asked to act on an invoice had to download an unidentified attachment from an emailed link to discover what it was, which is the exact habit security training exists to break. The sandboxing project is therefore done rather than deferred, and the decision lives on the SERVER: `GET /public/secure/:token` returns `preview_kind` (`"pdf"` | `"image"` | `null`) from an allow-list, and `?disposition=inline` on the download route serves those two kinds inline under `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; object-src 'none'; frame-ancestors 'self'`. The page renders a preview if and only if the server says so — it never re-derives the rule from the content type, because a security rule duplicated in the browser is the copy that drifts, in the one place an attacker can read it. The public allow-list is deliberately NARROWER than the internal `VaultPreviewDialog`, which also frames `text/plain` and `text/csv`: some browsers content-sniff a `text/*` body into markup, and this reader is anyone the URL was forwarded to rather than a colleague in a session. **The PDF response deliberately carries no `sandbox` token** — Chromium will not instantiate its built-in PDF viewer in a sandboxed frame (`sandbox=""` renders a blank pane, Brave a block page) and the response's own `object-src 'none'` closes the `<embed>` fallback, so sandboxing it would ship a grey rectangle the recipient cannot tell from a corrupt file; images, needing no viewer, keep the full sandbox. Download is untouched and still one click away for every type, and expired/revoked/never-existed still answer one opaque 404 — `?disposition=inline` is not an oracle. `tests/security/mail-secure-link-preview.test.js` (17, real HTTP through the real router) and `client/src/features/public/secure-link-page.test.tsx` (10).

- **The mail work rail collapses as a whole, and stays that way.** The reading pane's right-hand column was a fixed `xl:w-[22rem]` that nothing could shut, so on the 1280px laptops the operations desk runs, a third of the pane was permanently spent and long quoted correspondence wrapped to a column of six words. It now collapses to a full-height spine, **default collapsed**, with the preference persisted in `localStorage` beside `comms:info-open`. Four things the obvious implementation gets wrong: there is always a way back (the spine, plus a Hide control in the rail's own header — a panel you can only shut from outside itself is one people shut by reloading); collapsed still speaks, carrying a badge when the thread is **unbound** or the first reply is **overdue**, because those are what an operator scans for and overdue wins when both apply; it is a preference and NOT per-thread state, so it is deliberately not reset on thread change (reset it and someone reading forty threads re-collapses it forty times); and the panel outlives a broken `localStorage`, since Safari's private mode throws on `setItem` and a toggle that throws is worse than one that forgets. The spine uses `[writing-mode:vertical-rl]` rather than a rotate — a rotated element keeps its original box, so the reading pane would never actually get the width back. 8 tests in `inbox.test.tsx`.

### Fixed

- **A Bank RIB no longer holds a new client back from activation, and "required to activate" is now a separate, per-tenant answer from "required".** Two different questions were being answered by one flag. `party_document_type.is_required` meant "does this tenant want the document on file?", but everything downstream read it as "must it be on file before the party can be ACTIVATED": a missing type was tagged an onboarding gap, rendered under **Required to activate** on the client/supplier 360, and counted by `canVerify` — the gate `POST …/verify` consults. 0512 seeded `BANK_RIB` as required, so every brand-new client read **"Required to activate — Missing Bank RIB"** before it had ever been invoiced, and could not be verified until somebody collected a bank account nobody had paid. The account a client will be paid INTO is set up with the first payment, not with the record. `migrations/tenant/14030_activation_requirements.sql` adds `required_for_activation` to both `party_document_type` and `party_field_config` (plain columns, value-guarded UPDATEs, `-- DOWN` declared) and separates the answers for good: **the activation set** — the 360 checklist, and the only thing `canVerify` asks for — versus an **advisory** type, which is still reported but is capped at WARN, is never `onboarding` (so it cannot reach the checklist) and never blocks activation. The owner's defaults ride the migration: the **ACF** (`FISCAL_COMPLIANCE`, restored if a tenant deleted it) is required to activate for **everyone except a counterparty operating outside Cameroon** — a new `exempt_outside_country` column, because `applies_to_countries` is positive membership (`scopeMatches`) and "everyone except outside-CM" has no representation in it; **unknown never exempts**, since an exemption that fires on a blank country is how a compliance gate quietly stops gating. RCCM is required to activate on both sides; Bank RIB is neither required to activate nor advisory (tracked if supplied, silent when absent); every other type and every field defaults to false, with `name` still always required to create. `compliance.rules.js` keeps only pure rules — `activationTypes`/`canVerify` read the new column, `advisorySeverity` caps the advisory class, `evaluate` takes the missing activation FIELDS the caller resolved and turns them into `party.field_missing` WARN onboarding flags; `master_config.missingActivationFields` resolves a stored party's child collections (a party with three bank accounts must not be asked for one) and `party-lifecycle.verify` refuses with a 422 `ACTIVATION_REQUIREMENTS_MISSING` naming what is missing — on the SAME evaluation the 360 renders, so the checklist a user reads and the gate that refuses them cannot drift. Settings → Master Data gains a **Required to activate** column on the per-side required-fields tables and an immediate, toasted toggle on the document-type registry (never on the categories, which scope applicability and have never gated activation), with `required_for_activation` validated through `master_config.ai.js` and `party_document_type.repo`'s write allow-list. Covered by 25 rules in `tests/unit/party-compliance.test.js` (including the advisory class and the ACF exemption's unknown-country case) and 5 in `client/…/activation-requirements.test.tsx` pinning that the two checkboxes persist to two different fields and that the registry toggle exists only where it means something.

- **Every message in a Smart Comms thread carried the emoji rail on a phone.** The rail was hover-revealed, and hover does not exist on a touch device — so it had been made permanently visible with `[@media(hover:none)]:opacity-100`, which turned a conversation into a column of six emoji buttons over every row, and made the last message's rail sit under the reader's thumb. The fix is a gesture, not a permanent strip: the rail is now revealed by **tapping the message**, one row at a time, owned by `team-chat.tsx` rather than by each bubble (per-bubble state is fifty open rails, which is the original complaint with a new hat), and it closes on a tap in the empty scroller, on Escape, and after the reaction lands — a reaction was what the rail existed for. Three details are the difference between a feature and a twitch: the pointer pair measures travel (≤12 px, so **a scroll that starts on a message is not a request to reveal it**, which `click` cannot express), the tap is ignored when it lands on a link or a button (otherwise tapping the link and closing the rail are the same gesture, which reads as a broken link), and the scroller's own dismiss handler must skip events that bubbled up from a bubble — an unconditional ancestor clear cancels the child in the same tick and the rail never appears at all, the most likely way to build this wrong and invisible to any test that only checks the background. `pointerType` is allowlisted to `touch`/`pen` rather than checked against `mouse`, so no synthetic or oddly-sourced event can open it, and **desktop is untouched**: hover and `group-focus-within` remain pure CSS on the wrapper, because a JS path for the mouse would fight the stylesheet's, and `role`/`tabIndex` on every bubble would put fifty stops in a conversation's tab order for an affordance that needs none. The rail keeps its space in the layout, so revealing it never reflows the thread under a thumb. 10 rules in `client/…/bubble-reveal.test.tsx` and 7 in `team-chat.test.tsx` (tap, flick, tap-on-link, tap-away, Escape, one-at-a-time, thread switch); `data-revealed` on the row is the hook they read, for the same reason the composer marks a chip with `data-mention-id` — a test that parses `opacity-0 group-hover:opacity-100 …` breaks on a cosmetic edit.

- **Changing the base currency a second time — rebasing back (e.g. XAF→EUR→XAF) or onto any earlier-sorting code (USD) — was refused with `duplicate key value violates unique constraint "ux_currency_single_base"`.** `repo.setBase` flipped both rows in ONE statement (`SET is_base = (code = $1)`), but 13951's partial unique index is a plain non-deferrable index that Postgres checks **row by row** as the UPDATE walks the table: the first XAF→EUR rebase only worked because the planner happened to visit the old base before the target. In the reverse direction the target row was flagged base while the old base still was, and the whole transaction rolled back with a raw 23505 that read like the app was "trying to recreate the currency". The flip is now two ordered statements inside the caller's existing transaction — every other base is swept **off** first, then the target is flagged **on** (and activated) — an ordering that cannot collide regardless of row order, with the unique index retained as the concurrency backstop. Pinned by a query-order regression test in `tests/unit/currency-base-rebase.test.js` and a base→other→base round-trip against a real Postgres in `tests/integration/currency-lifecycle.test.js`. Found in the production runtime-acceptance walkthrough of the Currency audit.

- **The Currency 360 rate chart's tooltip effectively did not exist, and hovering made the chart feel like it moved.** The hover target was each point's 4px `<circle>`, so a mouse sweep almost never landed on one; when it did, the hovered dot grew (`r` 2→3.5), changing the hit geometry under the cursor and flickering between neighbouring points, and a wrapping tooltip line could reflow the panel. Pointer events are now owned by the SVG **surface**: `mousemove` maps the pointer's x to the **nearest** point deterministically (same math for surface clicks, which drill through to the matching history row), the dots keep their constant size with a pointer-transparent halo marking the active point, and the tooltip line is single-line and clipped so it can never shift layout. Keyboard focus and per-dot Enter/click drill-down are unchanged. Covered in `client/src/features/settings/currencies.pr03.test.tsx`.

- **Tax and registration numbers now sit on ONE boundary — MOD-01 `view` — instead of leaking around the document redaction (audit Decision Q3 / PR-04).** Documents on the entity dossier were redacted for a caller without the governance grant, while the same response carried raw `registrations[].number`, `tax_registrations[].tax_number`, the `tax_calendar` obligations' joined `tax_number`, the legacy `entity.niu`/`rccm` columns, the letterhead source and preview, `expiring_registrations`, and renewal labels of the form `"VAT FR40123456789"` — and the same numbers left the building through three side doors no MOD-01 grant guarded at all: the **AI knowledge cards** (an `entity_registration` card published every registration number as "normal"-confidentiality retrieval text any assistant caller could search), the **branded export cover** (every module's workbook cover printed the entity's RCCM/NIU to attendance, costing, AI and vault report exports), and the **scheduled report emails**. The selected policy is three audiences: the public site keeps its explicit allow-list; a caller with MOD-01 `view` may see full tax/registration numbers and renewal labels, consistently; nobody else may obtain them. The boundary is enforced in the **serializers** (a `tax` flag derived from the PR-01 capability model — the same `can_read` the `/360` bundle reports as `capabilities.view` — with every default fail-closed), so a route-gate change can never quietly widen it: `GET /entities/:id/360`, the `registrations`/`tax-registrations` child routes, `GET /:id/renewals` (labels degrade to the kind alone — the advisory posture survives, an operator without the grant still learns the France VAT registration lapses in March), and `GET /:id/letterhead` all redact together for a caller without the grant and all agree for a caller who holds it. Renewals also adopt PR-03's current-row rule (`doc/CORPORATE_ENTITY_REGISTRATION_CURRENT_ROW.md`): only the SELECTED registration per (country, kind) is monitored — a unique primary, else a sole row; an ambiguous key monitors nothing and is reported as a data-quality finding (`ambiguous_registrations`) instead of being swallowed, and an expired or unverified selected row stays selected, so no historical row is ever promoted into a warning by lapse. Exports resolve the requester's grant and drop the cover's RCCM/NIU lines when it is absent (a scheduled job has no requester to vouch and fails closed); the knowledge card grounds the fact ("SLAS holds the primary NIU in CM, expiring March") and leaves the value to the permission-gated entity tools, which is what that file's own header always claimed its contract was. Documents, vault references, hashes and the cap table keep their stronger governance redaction untouched, bank masking stays on the Treasury-read grant, and the invoice/quotation/statement **renderers** keep composing statutory mentions from raw rows on their own module's authority — a commercial document must carry its NIU/RCCM (CE-18); the boundary applies to API reads and exports, not to printed law. `tests/unit/entity-tax-boundary.test.js` asserts the whole matrix on the serialized bodies — MOD-01 view, MOD-01 edit/approve, no-MOD-01 and anonymous public callers, plus an edit-without-view caller no route can produce, which only the serializer can catch.

- **Creating or editing a task with a reminder answered `500 INTERNAL_ERROR` — on every save from the dialog — while the task quietly appeared on the board anyway.** `POST /api/tenant/workspace/tasks` (and the PATCH) failed with request ids like `9d0a69d5-6b80-4e5f-b1b4-81ce2575ddad` because the UPDATE that projects the first reminder onto `task.reminder_minutes`/`remind_at` (and the event's twin) numbered its placeholders wrong: `owner_id` was compared with the parameter carrying `reminder_minutes` and `owner_type` with the owner's id, so Postgres refused the statement at parse time — `42883 operator does not exist: text = uuid` — before a single row was touched. It failed for **every** task with reminders, in LIVE and TEST alike; the two earlier PRs against this symptom fixed adjacent things (a null `recurrence_rule`, the board chip) because nothing in the unit suite bound a parameter to a meaning — `expectBound` checks only that `$n` numbering is contiguous. And because the task row and its reminders had already been committed when the projection blew up, the card the form said had failed was there on the next refresh. Each parameter is now bound once with one meaning, `createTask` and `updateTask` run their writes **atomically** (the write phase joins the caller's transaction or opens one, so a failure now leaves no half-task), and the exact SQL is replayed against a real Postgres 16 in `tests/integration/workspace-reminder-sync.test.js` — the DATABASE_URL-gated suite the CI `migrations` job runs — so a misnumbered placeholder can no longer pass green.

- **Every secure-link recipient in the product's history was told their document was an unnamed binary.** `secure-link.service.fetchTarget` reported `content_type: doc.content_type || "application/octet-stream"`, and **`document_vault` has no `content_type` column**: migration 0340 creates the table without one, 0669 adds `original_name`/`client_id`/`doc_type_ref_id`/`uploaded_by`, and 10702 adds only the `public_media_*` set. The left operand was `undefined` on every row, so the fallback fired 100% of the time and the `||` read as a rare safety net while being the only branch that ever ran. The type is now derived from the storage key's extension — the extension the upload service itself chose, so it is not caller-supplied — through a new `document_vault.mime.js` that the vault's own download route and the public secure-link route both read, so the two cannot drift again. **The test that should have caught this was green:** it mocked the vault row with a `content_type` field the schema does not have, so it asserted against its own invention; a mock that supplies a column the table lacks tests the mock, not the code. The fixture now mirrors the real row shape. Found while building the secure-link preview, which cannot work at all without a truthful content type.

- **Praxis AI: the tool contract the model was shown was looser than the validator that judged it, so valid-looking proposals were rejected after the user confirmed them.** `zodToJsonSchema()` in `services/ai/action-registrar.js` was "top-level shape only" — it dropped `.uuid()`, `.email()`, `.min()`/`.max()` and every coercion — so `create_lead.owner_user_id` was advertised as a bare `string` while `lead.validator.js` demanded a uuid, which is the most likely cause of the reported "data-type validation" rejections. The emitter now carries `format`, `pattern`, `minLength`/`maxLength`, numeric bounds, array sizes and enum members; `orchestrator.service.js`'s `validatePayload` enforces the same constraints **at propose time**, so a bad value fails next to the form with `VALIDATION_FAILED` instead of after confirmation. Two invariants are pinned by test because both were hard-won: unknown keys stay lenient (the original field-confusion fix), and error strings name the field and the expected shape but never echo the value, since rejected values are routinely emails and tax ids. `.refine()` bodies remain excluded deliberately — a cross-field rule cannot be expressed in JSON Schema, and half-expressing one lies in the other direction. `SYSTEM_RULES` also gained IDENTIFIER RULES (ids only from reads made this turn), because advertising `format: "uuid"` otherwise lets a model satisfy the shape by inventing a value that passes it. 30 tests across `ai-tool-contract-fidelity`, `ai-payload-validation` and `ai-memory-budget`.

- **An impossible date silently moved a deadline by three days.** `validatePayload`'s date check used bare `Date.parse`, which does not reject an out-of-range day — it rolls it over, so `Date.parse("2026-02-31")` yields 3 March rather than `NaN` and an AI-proposed task due on a date that does not exist was accepted and filed late, with nothing anywhere saying so. Replaced with a `Date.UTC(y, m-1, d)` round-trip compared against the digits as written. Found by writing the test, not by reading the code.

- **Praxis AI's pre-answer summariser could hold a conversation open for four minutes.** The best-effort memory condensation inherited `AI_REQUEST_TIMEOUT_MS` (120 s) and would then fall through to the fallback vendor for another 120 s, on a step whose whole purpose is to be skippable. New `AI_SUMMARY_TIMEOUT_MS` (20 s, asserted to stay below the request timeout) plus `timeoutMs` and `singleVendor` options on `llm.service.chat`. Aborting is safe by construction: `condense` swallows its own failures and `summary_through` only advances on success, so the batch is simply retried next turn — both facts are test-pinned rather than assumed.

- **Workspace Analytics answered 500 on every request — one unbound parameter in one of the eight reads.** `analyticsBurndown`'s opening-backlog count borrowed the day series' `WHERE` clause and its parameter array, and that statement reads neither `$2` (the window's `to`) nor `$3` (the tenant zone). Postgres infers a parameter's type from its use and refuses a bound value it cannot type — SQLSTATE 42P18, _\"could not determine data type of parameter $2\"_ — so the statement failed on every call, and because the dashboard's eight reads share one `Promise.all`, that single line took the whole screen: \"The analytics read … could not be answered\", with the six panels that had answered correctly discarded alongside it. The opening read now builds its own scope (`analyticsScope(visibility, filters, 2)`) and binds only the window's `from`. The same shape was closed in `/workspace/day` — both overdue segments (`dayTaskSegment`, `daySubtaskSegment`) carried `to` while the overdue branch reads only `from`, which is the day-panel 500 of 18 September — and the rule is now asserted rather than described: `workspace-tasks-sql.test.js`'s `expectBound` and `workspace-analytics.test.js`'s per-statement check demand that a statement's placeholders are EXACTLY `1..params.length`. The old bound (`max <= params.length`) is satisfied by a statement that binds `$1`, `$4` and `$5`, which is how this shipped; `workspace-timezone-500.test.js` had the mirror-image problem (it required every burndown statement to carry the zone, including the one with no `AT TIME ZONE`) and is now scoped to the statements that actually use one. Verified against PostgreSQL by executing all eight aggregates and both day segments, not only by reading them.

- **On a phone, \"Awaiting me\" and \"Unread alerts\" were cut off at the right edge — and a long alert subject was what did it.** `truncate` is `white-space: nowrap`, so the element wearing it has a min-content width of the WHOLE string, and an element's automatic minimum size IS its min-content width. The alert title therefore could not shrink, and it widened the panel — which is a grid item, whose automatic minimum is likewise its min-content width — and with it the grid track the two panels share. Both boxes then ran past the 390px viewport, where the shell's `overflow-x-hidden` clips rather than scrolls, so nothing looked like it was overflowing: it just stopped. The title now carries `min-w-0` beside `truncate`, and both panels (plus the day grid's Panel and activity column) carry `min-w-0` as grid items so no future long line can drag the pair out of the phone again. The same missing pairing was corrected in four more workspace rows: the task list's title, the board card's assignee, the task panel's assignee, and the calendar's event location (day agenda and month list). Pinned by `today.test.tsx` (\"a long line truncates rather than widening the boxes\"); jsdom has no layout engine, so the assertion is on the class pair that makes shrinking possible — and note that `e2e/layout.spec.ts`'s `hasHorizontalScroll(page) === false` cannot catch this class at all, because the shell hides horizontal overflow: a gate for it has to measure each box against the viewport.

- **Mail attachments now upload as multipart bytes, not base64 JSON.** The old transport expanded an ordinary 2 MiB Word document to about 2.7 MiB and then lost it to the API's 2 MiB JSON parser before the mail service saw it. The composer now posts the original `File` through `FormData`; Multer applies a 25 MiB per-file bound and hands the buffer to the existing vault content-sniffing path, while the service retains its stricter 25 MiB aggregate-per-message rule. The temporary 35 MB JSON exception is gone, and the endpoint explicitly refuses the old `data_url` shape rather than silently reintroducing the inflated transport.
- **The Tasks board's detail is a pane beside the board, not a drawer over it — and a card opens from anywhere on the card.** Three defects behind one report. (1) The phone sheet was wrapped in `<div className="xl:hidden">`, which hides nothing: Radix renders a dialog through a portal into `<body>`, so the wrapper never becomes an ancestor of anything visible and the sheet opened at every width — over the board, next to the detail column it was supposed to fill. The branch is now made in JavaScript (`useIsWide()`), per guide §3.11. (2) The detail column was reserved permanently and held "Select a card to see its steps…", so a fifth of every wide screen was spent on a placeholder that squeezed the four kanban columns; the column now exists only while a task is open (`xl:grid-cols-[minmax(0,1fr)_22rem]`), is sticky with its own scroll so a long task stays reachable, and the board has the width the rest of the time. (3) Only the title line opened a task: the title, pills, date and assignee are now inside ONE `<button>` (the card _is_ the target), with the drag grip as a SIBLING over the title strip rather than an ancestor of it — a `::after` stretched from the title would have put the grip's `touch-action: none` above the click target and stopped a phone scrolling the board, and a sibling also means the click a drag leaves behind lands on the grip and opens nothing. The open card wears `<IndexRow>`'s pair (`.index-row-open` + the rail + `aria-current`) so the board says which task the pane is showing, `TaskPanelEmpty` is gone with the reserved column, and the board's column headings are `<h2>` — they skipped a level under the page's `<h1>` and axe failed the screen on `heading-order`. Covered by `features/workspace/tasks/tasks-page.test.tsx` (pane-not-dialog on desktop, card-body click, no reserved column, `?task=` deep link, phone sheet, axe).

- **Vault document previews were CSP-blocked for PDFs and text files — `frame-src` is now explicit.** The preview dialog frames a membership-gated document as a `blob:` URL in an `<iframe>` (the bytes arrive via an authenticated fetch, exactly like chat attachments). `frame-src` was never set, so the browser fell back to `default-src 'self'` and refused every PDF/text preview — _"Framing 'blob:https://…' violates … 'default-src'. Note that 'frame-src' was not explicitly set"_ — while images in the same dialog kept working because `img-src` already said `blob:`. This is the same silent-fallback defect that once blocked every voice note (`media-src`, see `tests/unit/csp-blob-media.test.js`); the policy now sets `frame-src: 'self' blob:` and the blob-consumer test table gained the iframe row so the next forgotten directive fails a test instead of a user.

- **Vault → Documents register now previews in-app, like the operations file already did.** Bug #1 ("vault documents should be clickable so we preview") was implemented only on the operations file's Documents tab (`file-360.tsx` → "Vault documents"). The tenant-wide **Vault → Documents** screen — the natural place to look given the bug's wording — still offered only Download and Archive, so the fix appeared missing to anyone who went there. That screen (`features/vault/documents.tsx`) now carries a **Preview** button per row that opens the same `VaultPreviewDialog` (PDF/image/text inline, download for Office files), reusing the existing `fetchVaultDoc` plumbing. Archived rows keep Download only.

### Changed

- **Scheduled in-house messages now run in the Test environment, not only Live.** Smart Comms scheduled delivery was gated `env !== "live"` in `smartcomm.schedule.service.create`, and the flush job (`comms-send-flush`) and its scheduler (`comms-send-scheduler`) only ever enqueued a Live job — so a message scheduled while training on Test was accepted by the UI and silently never delivered. Training happens on Test, which is precisely where scheduling most needs to be rehearsable. The service now accepts `live` and `sandbox` (any other environment is still refused), the scheduler fans out one flush per environment the tenant has (same pattern as `attendance-reconcile-scheduler`, keyed `commsflush-<db>-<env>`), and each flush delivers only its own schema's due rows against its own data — a sandbox schedule can never leak into Live. The composer's schedule dialog copy no longer claims delivery is Live-only.

### Fixed

- **The marketing prefix is a per-host setting.** `/public` was typed into ninety-odd places, which made
  it a decision the whole fleet shared and nobody could revisit — and it is one a tenant has an opinion
  about, since the word is in every URL they print, email or hand to a search engine. Migration `0104` adds
  `public_base` to `platform.subdomain`; the server builds its path matcher per request from the resolved
  value, and `src/shared/http/public-web-paths.js` is the single definition the mount, the console
  validation and the test all read. The browser learns it from a `<meta>` tag the head injector already
  rewrites per request — no build-time constant, so one image serves every prefix. `/portal` deliberately
  does not move: invitation emails point at it with a seven-day expiry. `/public` stays claimed whatever
  the base is and redirects to it, so renaming cannot strand a URL already in circulation. Prefixes the
  workspace answers — every ERP section, `/login`, `/api`, `/portal` — are refused with a reason.
- **A domain the client brings serves the site at its ROOT, not under the prefix.** The prefix exists to
  keep the marketing site out of the workspace's way on a shared origin; on `smartls.cm`, where
  `surface = 'public'` and the ERP is not served at all, there is nothing to stay out of the way of. The
  first cut honoured `public_base` there anyway, so the client's homepage was `smartls.cm/public` with `/`
  redirecting into it, and every URL they printed carried a word that means nothing to their customers.
  The surface now decides the base and the column applies to workspace hosts, which took three latent
  self-redirects with it: `/` → `/`, each legacy alias → itself, and `LegacySplat` joining `"/"` with a
  tail to make `//track` — a protocol-relative URL a browser reads as the host `track`. Two things that
  were already wrong on a RENAMED prefix are fixed by the same change: the head injector's route table
  matched a literal `/public/…`, so a `/site` tenant silently lost every link preview, and `robots.txt`
  disallowed `/public/proposals/` on hosts that serve proposals somewhere else — a rule that reads as
  covered and protects nothing. `public-web/src/app/root-mount.test.tsx` pins all of it.
- **A CV over about 1.4 MB was refused after the applicant had waited for the upload.** The form
  advertises 8 MB and `careers.service.CV_MAX_BYTES` enforces 8 MB, but the file is base64-encoded into a
  JSON body — a third larger on the wire — against a 2 MB global limit, so most phone-scanned CVs were
  impossible to send and the promise had never been keepable. A 12 MB parser now covers that one public
  path, mounted BEFORE the global one because body-parser sets `req._body` and every later parser bails on
  it. No other route's limit changes.
- **The tenant's marketing hero had no home of its own.** It rendered whatever had been uploaded as the
  LOGIN background — one file doing two unrelated jobs, configured in Settings → Login, which is not where
  anyone looks for the photograph on their public website. `POST /branding/site/hero` now stores it under
  its own `site/` segment (added to the public media allow-list) with a 1 MB cap, and the hero prefers it
  while still falling back to the login background so no existing tenant's hero goes blank on deploy.
  Service-type covers already had an upload; only this one was missing.
- **The portal sign-in read "Client portal CLIENT PORTAL".** With no tenant name and no logo the wordmark
  falls back to the portal's own noun, and the eyebrow beside it repeated the same two words — which is
  what every unconfigured workspace showed its clients. The eyebrow now renders only when the wordmark is
  the tenant. The screen also states what the account is for and offers the two ways out it lacked: the
  invitation route for someone with a link but no password, and tracking for someone with no account at
  all. It is one of the two screens a paying client opens every week and was a bare pair of inputs on white.
- **Twenty-two user-facing sentences were English on the French site**, and the gate said both languages
  were complete. `check-i18n` rule 5 reads text between JSX tags in `.tsx` files, so a sentence that is a
  STRING — a `.ts` module's error message, a `hint=` prop, an argument to `tr()` — was structurally
  invisible to it: the quote form's failure message, every portal session-expiry and download error, the
  CV size limit, six portal empty states. All now carry dotted keys. Rule 6 fails the build on any
  sentence outside the dictionary anywhere in `src/` — punctuation is the signal, and run against the app
  before it was wired in it found twenty-two real strings and no false ones.
- **`tr()` could never translate a sentence.** It looks a label up as `strings.<label>` and i18next's
  default `keySeparator` is `.`, which this app does not disable because every other key is dotted. So a
  label containing a full stop is parsed as a path with an empty final segment, never resolves, and
  silently returns English. That is why all 41 `strings` entries are period-free column headings. Now
  documented on the function, and enforced by rule 6.
- **Marketing images were served as if they were a JSON list.** Case-study and service covers stream from
  the Node process with `Cache-Control: max-age=300`, so every visitor re-fetched every image twice an
  hour, and they counted against the same 120/15min budget as the page's data — meaning the page with the
  most images was the one most likely to have them refused. The id in the URL is the vault document's, so
  the bytes behind a URL never change: now a year, `immutable`, with an ETag, and images have their own
  budget.
- **Forwarded links previewed as a blank grey card.** The pages are assembled in the browser, so Slack,
  WhatsApp, LinkedIn and Bing received the shell — one generic title, no description. `shared/http/public-head.js`
  now injects a real title, description, canonical and Open Graph tags per page, reading the record for
  proposals, vacancies and case notes; and the host serves `robots.txt` and `sitemap.xml`, with a
  workspace host asking not to be indexed and tokenised documents kept out of the index. It is the head,
  not the body — not SSR, and it does not pretend to be — but a preview card and a search result are built
  from the head. Any failure serves the untouched shell.
- **`public-web` served a blank page in production.** Vite's default `assetsDir` put the app's own
  bundle at `/assets/*`, which `PUBLIC_WEB_PATH` did not claim — so every chunk, stylesheet and font
  fell through to `client/dist` (a miss: different hashes) and then to the ERP's `app.get("*")`,
  which answered `index.html` with `200 text/html`. The browser refuses to execute HTML as a module,
  so the shell loaded and the app never started. Neither `vite dev` nor `vite preview` goes through
  that mount, which is why it was invisible in development. The app now builds into `public-assets/`
  and the mount claims it; `tests/unit/public-web-mount.test.js` reads the directory name out of
  `vite.config.ts` and the matcher out of `server.js` and pins the two together, which is the test
  the comment above the mount had been claiming existed.
- **The ERP's service worker shadowed the new pages with its own older copies of them.**
  `navigateFallbackDenylist` listed only `/api`, `/media`, the manifest and the icons, so for anyone
  who had ever loaded the ERP the cached shell answered `/public/*` and `/portal/*` before the
  request reached the server — and because `client/` still routes those paths itself, the visitor
  saw not an error but a plausible older implementation at the same URL.
- **Raw server messages reached public pages.** `lib/api.ts` exported `messageFor()` to keep driver
  errors and status text away from strangers, and nothing called it: a job applicant hitting a 500
  read "Internal Server Error". All seven read handlers now route through it with a translated
  fallback (`common.loadFailed`), read via a new module-level `tStatic` so `t` does not become an
  effect dependency and a language switch does not re-run a rate-limited tracking lookup.
- **The home page discarded the service covers the API returns.** `ServicesBand` built its cards
  without `cover_url` while the band eleven lines below passed the same field to the same component,
  so the home page showed four text boxes for services that `/public/services` renders as image cards.
- **The hero's scrim hid the tenant's artwork.** A flat carbon 95%→72% wash kept copy safe and made
  any photograph invisible. Measured against the worst case a tenant can upload, the binding
  constraint is the orange eyebrow at α ≥ 0.87 (not the headline, at 0.48), so the scrim now holds
  ≥ 0.90 wherever copy sits and falls away where it does not — radially at `lg`, downward below it.
- **A brand-token flash on dark-OS first paint.** The pre-paint script wrote only `.dark` and never
  `data-theme`, so `@praxis/brand/tokens.css` followed `prefers-color-scheme` and painted dark brand
  values under light app tokens until `main.tsx` ran — the exact mismatch `theme-mode.ts` says the
  attribute exists to prevent.
- **Disabled buttons read as broken.** `disabled:opacity-55` over a brand fill produced a washed-out
  orange on the first two controls a visitor meets. Disabled now uses neutral tokens; a submitting
  button keeps its fill via `aria-busy`.
- **The footer listed "Client portal" twice** (two keys rendering the same words at two paths) and
  "Track a shipment" in two columns. `check:i18n` cannot catch that: both keys exist in both
  languages, and it looks for missing text rather than for two keys that agree.
- **`check:bundle` hardcoded `dist/assets`** and would have reported "not found" on a correct build
  the moment the output directory was renamed. It reads `assetsDir` from the config now.

- **Weekly lateness queries and the authorised attendance map (clock-in revamp PR 3 — the last of
  the three).** After a week closes, an employee who was late on one or more EXPECTED WORKING
  DAYS is asked once about the pattern rather than five times about five mornings: `attendance.weekly`
  composes and upserts exactly one `WARNING` query per person per completed Mon–Sun week, employee
  only (managers and HR have analytics; a batch job must not raise a disciplinary document against
  somebody on their behalf). Expected days come from PR1's calendar resolver, never from the
  reconciled status, so a Mon–Sat yard and a Mon–Fri office are counted differently; waived days are
  excluded from the count and stated rather than dropped. Migration `12746` adds `WEEKLY` to
  `hr_query.source` and a dedicated partial unique index `(employee_id, work_date) WHERE source =
'WEEKLY'` — the weekly row carries `hr_rule_id = NULL` so it stays OUT of 0704's daily index (where
  a week-end date would collide with that day's own lateness query), and because a NULL is distinct
  from every other NULL in a unique index, that dedicated index is the entire deduplication story.
  The nightly reconcile job gained the step, gated on Monday in the workplace zone, running on its
  OWN tenant connection AFTER the reconcile has committed: sharing one would have let a failed
  weekly INSERT abort the transaction and silently roll back every row the reconciler wrote.
  `POST /attendance/weekly-summaries` (`edit`) is the idempotent backfill and sandbox rehearsal.
- **`GET /attendance/map`** returns pinnable punches plus worksite geofences, with the guide's
  five-row permission matrix resolved in the CONTROLLER rather than by a single middleware — MOD-14
  view gets team pins and fences, a Control Tower grant unlocks the order-lane overlay, an employee
  with neither still gets their own pins, and an unlinked caller gets nothing. Punches with no fix
  are COUNTED, never placed: `Number(null)` is 0, so a finite check alone would have pinned every
  no-GPS punch at 0°N 0°E as a confident outlier. Preview tiles need a platform Geoapify key
  (resolved outside the tenant connection); without one the map degrades to coastline, fences, pins
  and an OSM link per pin.
- **Map tab on HR Attendance, and own pins on My HR.** The tab reuses the Control Tower's projection
  rather than restating it — `buildMapModel` gained one additive `points` option so an
  attendance-only user with no lanes still gets a fitted map — and draws order legs in the operations
  map's own per-mode colours only when the server says the caller may see them. My HR reads
  `/attendance/punches/mine`, closing the last unfinished PR2 contract item (guide §3.2): the
  endpoint is the boundary, so an HR manager on their own My HR page sees themselves, not their team.
  The devices queue (still pending-first) now shows where each device last punched from, which is the
  one fact that makes an unfamiliar auto-generated device name decidable.

### Fixed

- **The desktop layout gate no longer measures a page a service worker is racing it for.** The built
  app registers one (`registerType: "prompt"`, `clientsClaim: true`), so in every one of the gate's
  thirty browser contexts it installed, took control of the page, and precached 153 entries — 4.7 MB
  — into `workbox-precache-v2`. Probed directly: `navigator.serviceWorker.controller` is non-null by
  the time a spec measures anything. Three consequences, all of them nondeterminism a measurement
  gate cannot afford: a navigation answered from the precache via `navigateFallback` rather than by
  the preview server, at a moment that varies with machine load; requests issued by a service worker
  bypassing `page.route`, which is what the fixture's API mock is built on, so a screen can render
  with no data through no fault of the app; and 4.7 MB of precache per context, two workers, two
  cores. It surfaced as two chart-of-accounts specs failing on CI — an `<h1>` that never appeared and
  a selection bar that stayed empty — then failing their retry with "Target page, context or browser
  has been closed", while all thirty passed locally and on the previous commit of the same branch.
  `serviceWorkers: "block"` weakens no assertion: the gate measures layout numbers, the app lays out
  identically, and what goes away is a PWA cache being rebuilt thirty times in a throwaway profile.

- **The Error Centre's AI explanations are about this codebase now.** The explanation prompt was
  taken verbatim from `PROMPT_ErrorMonitor_Module.md` §7.4, which opens "specializing in
  Node.js/NestJS debugging" — the spec's assumed stack, and the one place §0's divergence table had
  not reached. So a production 422 on `POST /api/tenant/mail/send` was explained in terms of a
  `SendMailDto`, a `MailModule`, class-validator decorators and a NestJS `ValidationPipe`: fluent,
  authoritative, and about somebody else's system, with nothing on the page to tell an ops lead
  otherwise. `src/services/ai/codebase-brief.js` now states what this repo actually is — Node 20 +
  Express + CommonJS, Zod validators, `AppError` through one error handler, `src/modules/<area>/<module>/`
  with its five conventional files, the tenant/platform DB split — names the frameworks that are
  absent so the model stops reaching for them, and explains that a `ValidationError: VALIDATION_ERROR:
<fields>` report is SYNTHETIC (its only frame is the route, and the failing values are not in it).
  It also resolves the failing route to the directory that serves it, read from the module tree at
  runtime rather than from a hand-kept map — `POST /api/tenant/mail/send` →
  `src/modules/mail/mail/ — mail.routes.js, mail.controller.js, mail.validator.js, …`, with 95% of
  the mounted surface resolving and silence, never a guess, for the rest. Every claim in the brief is
  pinned against the tree by `tests/unit/error-explain-grounding.test.js` (no `@nestjs`/class-validator/
  ORM in any manifest, the helpers and paths it names exist, each file it offers can be opened),
  because a description of the stack that nobody re-reads is the same failure with a different accent.
  And `prompt_version` — written to `platform.error_explanation` since day one and never read — is now
  part of the Redis key and the stored lookup, so improving the prompt actually reaches the signatures
  someone has already asked about instead of only the ones nobody has.

- **A copy field you can put two people in, and a send that says which address is wrong.** Cc and
  Bcc were one plain text input holding a comma-separated string, and the comma was the entire
  mechanism — nothing on screen said a second recipient was possible ("no plus button, nothing"), so
  a row typed the way anyone would type one (`ops@camrail.cm billing@camrail.cm`, or an address
  pasted with its display name) reached `POST /mail/send`, where `cc` and `bcc` accepted an array of
  already-bare addresses and nothing else. The answer was a 422 whose whole text was `Invalid body`,
  reported as `VALIDATION_ERROR: bcc, cc` — the offending address appeared in neither. Each address
  is now a CHIP, added by Enter, Tab, comma, semicolon or leaving the field, removed by its × or by
  Backspace (which puts it back in the field, because a mistyped address is corrected more often
  than retyped); the server parses the row the same way the composer does — separators outside `"…"`
  and `<…>`, a space between two addresses, `Jean Dupont <jean@acme.cm>` reduced to what SMTP needs,
  a cleared row read as "copy nobody", the same person twice read as once — and what is still
  refused is refused BY NAME, in the composer before the send and in `error.message` after it:
  `Cc: "jean dupont" is not an email address`. The mail module's other 28 schemas gained the same named
  message in place of `Invalid body`.

- **Two adjacent attendance screens no longer shout a status at different volumes.** The reconciled-
  days table pre-split `ON_LEAVE` into `"ON LEAVE"` before handing it to `Pill`, which defeated the
  shared `enumLabel` (it only recognises the underscored form) — so it printed `ON LEAVE` where the
  history table, one tab away and reading the same rows, printed `On leave`. Same slip in the
  heatmap tooltip. Both now pass the raw enum through the one humaniser, and the two hard-coded
  strings beside them go through `tr`.

- **Attendance history, analytics and payroll-ready export (clock-in revamp PR 2).** Every user
  can now see their own attendance and download it, and HR can do the same for the set they pick.
  `GET /attendance/analytics` (+ `/mine`), `GET /attendance/export` (+ `/mine`) and
  `GET /attendance/punches/mine` are new; the log list gains `employee_ids` and `department`, and
  `daysFor` takes a compare set of up to 50. The summarizer (`attendance.analytics`) is pure —
  punctuality, hours from in/out, lateness, absences, on-site %, leave/holiday/off counts,
  department rollup, per-employee compare rows and heatmap cells — and takes expected working days
  ONLY from PR1's calendar resolver, never from the reconciled status (a punch on a non-working day
  reconciles as `PRESENT`, so the status cannot answer "was this owed as work"). Waived days are
  reported apart from charged ones. The export (`attendance.export`) renders Days + Punches through
  the house spreadsheet toolkit — branded, currency-aware, injection-safe — with the guide's exact
  column keys frozen and pinned by a test, because payroll parses them; CSV honours `?sheet=`,
  the file is `attendance-{from}-{to}.{ext}` (SANDBOX-suffixed in Test), and rows are hard-capped
  at 20k with the truncation reported rather than silently applied. One shared `AttendanceHistory`
  widget — period chips (7d/month/quarter/year/custom), KPI row, heatmap over expected working
  days, a day table where leave, holidays and days off are first-class rows, and CSV/XLSX download
  — is mounted on My HR (self, `/mine`), Human capital → Attendance as a new "History & analytics"
  tab, and the employee 360 Attendance tab, which it replaces the raw punch list on. Waive/uphold
  stays on the HR rows that carry a deduction, raising the same dialog the reconciled-days view
  uses. The day-window validator moves from 92 days to 366 so the year view and the past-year
  download stop being a 422; the cost argument the day cap used to carry alone now sits on the row
  ceiling, where the cost actually is.

- **Certified signatures (Signature Programme PR-4, Tier 3).** The `CERTIFIED` card is live end
  to end: a counterparty who picks it is handed to the provider (SignWell, the only V1 adapter,
  behind a provider-agnostic interface) which verifies their identity and emails them its own
  secure link; on the provider's completion — webhook or the 30-minute poll backstop — the signed
  PDF and the provider's audit certificate are mirrored into the vault, one `QES`/`PROVIDER`
  signature is written with the provider's bytes as the artifact hash, and the chain advances with
  the next link emailed. Envelopes are metered in `signature_usage_ledger` (migrations
  `10785`–`10787`), charged in the same transaction as the provider reference so a provider
  failure is never billable, and the platform quota watch alerts at 80% / 95% of the monthly
  allowance, once per threshold per month. The webhook is signature-verified on the raw body
  (constant-time, replay-windowed) and idempotent — a replayed event writes one signature, not
  two. Platform Console → Integrations gains the SignWell account + pricing; Settings →
  Signatures gains the read-only "Certified signatures" panel (provider state, this tenant's
  monthly count, no figure). A request being voided cancels its in-flight envelopes; the ledger
  row stays, because the provider consumed the quota whatever we do.
- **Attendance now follows the entity's working calendar, and says what it
  actually knows about a punch's location.** Expected working days resolve
  employee override → the entity's working calendar (its own, or the inherited
  tenant default) → the tenant weekend, so a Mon–Sat yard is no longer marked
  absent every Saturday and charged for a day nobody asked it to work; the
  reconciler and the daily-rate arithmetic use that one resolver, so the day
  and the settlement cannot disagree. The attendance log and provisional
  absence now select punches by a **local-zone window** instead of the UTC
  date, so a 00:30 Douala punch stops landing on the previous day. Punches
  also record **what the device presented** (`location_source`, migration 10740) separately from whether a worksite existed to judge it: "we never got
  a fix" and "GPS arrived, but this tenant has drawn no geofence" were both
  painted "No fix", which taught people to ignore the one signal that matters.
  HR Today now shows No GPS / Off-site / On-site / No worksite as four
  different things. The clock still punches when GPS is refused — the tenant
  policy decides whether that is acceptable, not the browser — and then offers
  a recovery panel with the OS steps, a Retry and an install prompt.
- **Treasury accounts can be corrected in place.** Master data → Treasury →
  any account now has an **Edit** button next to Verify/Deactivate, opening the
  same category-driven form the account was created with, pre-filled. A typo'd
  account number, a missing zero on the opening balance, a wrong IBAN or
  statement day is a correction, not a reason to deactivate the account and
  open a second one — a treasury account is never deleted (its class-5 CoA leaf
  is referenced by journal history), so before this the mistake was permanent
  in the UI. The `PATCH /treasury-accounts/:id` endpoint already existed and
  nothing called it. Entity and category stay locked, because the CoA leaf is
  already minted under the category's parent; renaming the account still
  renames its leaf. Emptying a field now clears it rather than leaving the old
  value behind, and editing a _verified_ account warns that the verification
  stamp is not cleared automatically.

- **The employee 360° is now the full record (10708).** The profile grew
  Payroll (payslips per period with the standard PDF), Advances (amount,
  recovered, outstanding and the recovery plan) and Sanctions tabs, and the
  Contracts tab gained **Renew**: one click creates a NEW draft contract that
  supersedes the signed one — terms carried over, new term starting the day
  after the old one ends and keeping its length, both dates overridable. The
  signed wording is never copied into the renewal, because it carries the old
  dates; the new DRAFT is exactly the state redrafting exists for.
- **Appraisals gained manual scoring beside the AI score.** Each KPI line in a
  review now has an editable rating input the manager types into (commit on
  Enter/blur, ✕ to clear and follow the evidence suggestion again). The
  manager's number and the evidence-derived suggestion stay in separate
  columns permanently — a human may disagree with the model, and the system
  now records when they did (`rated_at`).
- **SOPs are documents you can read and draft.** The "New SOP" form collects
  the facts the company knows — scope, owning role, effective date, the
  purpose in their own words and the steps they already have — and the AI
  writes the standard professional document (Purpose, Scope, Responsibilities,
  Procedure, Records, Compliance) around them, never inventing a clause the
  company didn't state; where the material is thin the document says
  "To be completed:" instead of guessing. Clicking any procedure in the
  register opens the generated document, editable and re-draftable, with a
  Render PDF step that files it in the vault.
- **Trainings record the whole meeting.** A "Record meeting" button on the
  session panel starts before the meeting and captures everything; the stream
  is sliced every ~25 s, each slice transcribed and appended to the session's
  transcript, and "Draft minutes with AI" folds the transcript + notes into
  the minutes. The trainings screen also gained bottom padding so the last
  table no longer sits flush against the viewport edge.
- **Delivery prefill now picks up GROUPED containers.** A file that states
  "3 × 40' HC" (container lines, no per-box numbers yet) now prefills the
  delivery note with that line — type, quantity and remaining count — and the
  printed manifest renders it as the file states it. Boxes another note
  already covers are flagged (`already_on`) and no longer auto-ticked, so a
  twice-delivered box is a deliberate split load, not an accident.
- **The milestones Templates tab is now a register you can act on.** Each
  template lists its service type, version, stage count and every stage with
  its due offset, weight, owner tier and flags (anchor, SLA-locked, internal
  only, needs proof, auto-advance) — with a plain-English explanation of what
  a template does. And the dead list is dead no longer: **New template**
  publishes a first chain for any service type from this screen (the picker
  surfaces the ones with no chain), **Edit chain** opens the full stage editor
  seeded from the CURRENT version — so re-publishing does not silently revert
  it to the shipped default — and **Activate** rolls a superseded version back
  instead of minting a byte-identical new one.

- **Partnership and vendor applications are vetted, and an approved vendor
  stops being re-typed (F10).** `partnership_request` was five columns against a
  form that vets forwarding agents: no country, no contact title, and no
  network memberships — which is the field an agent is actually vetted on. It
  now carries all three (memberships as a jsonb array, GIN-indexed, so "who
  claims WCA" is one query), the applicant's corporate profile as a vault
  document rather than a filename concatenated onto a public directory in the
  browser, capped internal notes, and a decision that records who made it and
  why (a rejection without a reason is refused by the database). The status
  vocabulary moves to the legacy API's own NEW / IN_REVIEW / APPROVED /
  REJECTED and existing rows are translated, so one state does not end up with
  two names. Approving a VENDOR_REGISTRATION now opens a DRAFT supplier in the
  same transaction — the legacy printed "approved vendors must be manually
  onboarded", which is a limitation dressed as a control; the real control is
  that a DRAFT supplier has no auxiliary accounting account and, as of this
  change, cannot be put on a purchase order until somebody holding the approve
  permission verifies it. An existing supplier of the same name is reused, and
  a unique index makes that true under concurrency. An agency partnership opens
  a supplier only when the approver asks. New register at /sales/partnerships
  with the four KPI tiles computed from two partitions the API proves add up.
  Migration `0688_sales_crm_f10_partnership.sql`.
- **BREAKING:** `/api/tenant/intake/partnerships*` → `/api/tenant/partnership-requests*`.
  Partnership requests are their own module (`sales/partnership_request`);
  contact enquiries keep `/intake/enquiries`. Nothing in `client/` called the
  old paths. The AI manifest key `review_partnership` is now
  `review_partnership_request`, plus `get_partnership_request`,
  `create_partnership_request` and `approve_partnership_request` — re-run
  `node scripts/ai/sync-actions.js` to rebuild `ai_action_catalogue`.
- **Operation-file references stop being guessable.** A dossier reference is the
  one number in this system a CLIENT holds, and it was sequential:
  `SLAS-OPS-2026-0142` tells whoever holds it how many files we opened this year,
  roughly where theirs sits, and that `…-0141` and `…-0143` are worth trying. New
  files now get `SL7Z3K9QW2M4XBSM` — an entity prefix, a 60-bit
  `crypto.randomBytes` core in Crockford Base32, and a service-type code — which
  is the legacy `SL6721864SM` convention modernised rather than discarded. The
  allocator owns generate → write → retry as one step, so the unique index on
  `dossier.ref` is the only thing that decides a collision (a savepoint per
  attempt, because a 23505 otherwise poisons the caller's transaction). References
  are allocated by the backend alone: `service.create` used to take one from its
  payload, which three of its four callers — including the AI action registry —
  could set. Once allocated a reference never changes: updates that carry a
  different `ref` are refused, and status, service-type and entity changes leave it
  alone. **Financial and statutory numbering is untouched** — invoices, receipts,
  journal entries and tax documents keep their gap-free `doc_sequence` numbers,
  which is what reconciliation needs. Every existing reference stays valid, nothing
  is rewritten, and search reaches all three schemes (including the display
  spelling `SL-7Z3K9QW2M4XB-SM`). Entity prefixes and service codes are seeded for
  existing rows by migration `0682`, editable until the first file uses them, and
  audited when changed — on the entity dossier and the Service Type form
  respectively.
- **Structured client discovery on meetings (MOD-21, Sales & CRM F1).** A
  meeting against a lead is now captured in the three named sections of the
  Client Discovery Framework — business and operations context, pain points,
  proposed strategy — instead of one free-text box, because those three sections
  are what a proposal is later drafted from and free text is not data. Each can
  be typed or dictated; dictation runs through the existing `ai-transcribe`
  worker, which is the half that was missing (`meeting.transcript_vault_id` used
  to be read off the request body, so the flag "this meeting has a transcript"
  was an assertion the caller made about itself — only the worker writes it now).
  The scripted probing questions above each box are seeded rows in EN and FR,
  editable per tenant, not markup. Meeting location is captured. A section whose
  audio failed to transcribe says so on the record rather than sitting blank, and
  a lead's latest discovery set is one call (`GET /meetings/discovery/lead/:id`).
  Migration `0681_meeting_discovery.sql`.

- **Change your own password (`POST /api/tenant/auth/change-password`).** The
  third leg of the password story, and the one that was missing: recovery by
  email covered "locked out" and `POST /users/:id/password` covered "someone
  else's account", but an ordinary user who simply wanted a different password
  had no route — the admin one is behind the MOD-67 edit grant, so most users
  could only rotate their credential by mailing themselves a reset link, and
  only while outbound mail was healthy. The new endpoint verifies the current
  password with the same Argon2id compare login uses (a live access token is
  deliberately not sufficient proof), applies the full password policy to the new
  one, voids any outstanding reset links, and force-signs-out every OTHER session
  while keeping the caller's. Rate limited per user, not per IP — the caller has
  already proved who they are, so the only budget a key can exhaust is their own.
  Surfaced as a **Password** card on Security → My security.

- **Tax rates & jurisdictions is now a working 360 (MOD-07).** The screen that
  feeds every invoice's VAT/WHT postings — account determination reads the
  effective-dated `tax_code` at the entry date — becomes a jurisdiction → dossier
  master-detail, with a tab per tax family (TVA / IS / retenues / paie / autre)
  showing each code's current effective rate and full version timeline. Fixes the
  write path that made no-code amendment impossible: the Add-code **Kind** dropdown
  sent `TVA/IS/MIN_TAX/PATENTE` — values the API enum rejects — so TVA and IS
  codes could not be created from the UI at all; kinds are now the canonical
  `VAT/WHT/INCOME/PAYROLL/OTHER` shown with Cameroon labels (the instrument stays
  in the Code field). Adds GL posting-account pickers, a base-rule field, and a
  **structured brackets/caps editor** for the IRPP progressive scale, CNPS caps and
  work-injury risk classes (previously seed-only JSON). A new **Amend rate** action
  wires the existing atomic `supersedeCode` to
  `POST /tax-jurisdictions/:id/codes/supersede` — expire the current row, open the
  new one, in one transaction — so a Finance-Law change is a new version, never an
  overwrite.
- **Counterparty governance (PR3-C).** The dedup detection shipped in §5.1 now
  has its UI (an amber "Possible duplicates" panel on both create forms and at
  the top of the 360), plus: a **governed merge** (`party_merge/`) that
  reattaches every FK loser→survivor by catalogue discovery, preserves the
  loser's names as `party_alias` rows, soft-archives the loser
  (`registration_status='ARCHIVED'`, `merged_into_id`) rather than deleting it,
  deactivates its aux account and re-points its open compliance flags —
  CEO/Admin only, routed through a maker-checker in Live; **copy-from-origin**
  for a converted party (`cloneFromOrigin`); 360 **deep links**, inline-SVG
  **charts** and the **supplier AVL scorecard**; an audited **masked-bank
  reveal**; a **sensitive-field maker-checker** (bank / legal name / tax
  registration / credit limit / status changes become pending change requests in
  Live, applied on a second authorization); and a transactional
  `compliance.assertAllowed` **gate** wired at dossier and PO creation
  (migration `0517`).

### Security

- Access tokens now respect session revocation — killing a session, the idle
  timeout, or refresh-reuse detection ends the token immediately rather than
  leaving it valid for up to 15 minutes (`SEC-M1`).
- The Socket.IO handshake resolves the tenant from the Host header in
  production; a client can no longer name its own tenant (`SEC-M4`).
- The `runtime` and `worker` containers run as an unprivileged user instead of
  root (`SEC-L1`). **Operational note:** the first deploy after this chowns
  `./media`, `./uploads`, `./logs` and `./data` to uid 1000.

### Added

- **Delivery notes: whole-row click opens the snapshot modal, and the document page shows the real note in the app theme.** The delivery-notes list now opens its detail modal on a click anywhere in the row (the same `onRowClick` gesture as the transit-orders list, with the ref cell as the keyboard/AT activator). The document page (`/documents/DELIVERY_NOTE/:id` and `/documents/TRANSIT_ORDER/:id`) gains bespoke **native** renderers — consignee, delivery details, container manifest, cargo, reservations and the named received-by block for delivery notes; shipment facts, five-column cargo with declared value, customs regime, insurance/surveyor elections and the attached-document checklist for transit orders — block-for-block with the PDF template but rendered in the app theme, since the white print sheet does not blend with the dark UI. The generic card body was the defect for these two documents: it had no vocabulary for containers, reservations, vessel, regime or checklist. Download PDF is unchanged (vaulted, QR-verifiable). Edit-while-DRAFT was already fully wired (detail modal Edit button gated on `DRAFT` → `PATCH /delivery-notes/:id` with header + lines + containers; `rules.EDITABLE` is exactly `{DRAFT}`) and is verified end-to-end by the delivery-note lifecycle tests.

### Added

- **System-email fallback sender** (the two-config email model, `doc/EMAIL_TWO_CONFIGS.md`). System emails (OTP, invites, invoices, notifications) now fall back to a Praxis-owned sender — `no-reply@praxisls.com` / `support@praxisls.com` — sent through the deploy-wide SMTP when a tenant hasn't configured their own mail, so tenants who haven't pointed their DNS at us never lose system mail. The fallback is configured + live-tested in the **Platform Console → Integrations → System-email fallback sender** (platform `mail.fallback` setting, password encrypted at rest), with env `SMTP_*` / `MAIL_*` as last-resort defaults (`migration 0091`). Fixed `MAIL_DEFAULT_FROM` being referenced but undefined; `MAIL_FALLBACK_DOMAIN` default is now `praxisls.com`.
- **Mailbox is now reachable in the Comms workstation**: `Comms → Mailbox` (`/comms/mail`) mounts the existing provider-agnostic mailbox UI (Microsoft 365 / Google / IMAP-SMTP, inbound + outbound) alongside Smart Comms chat and Setup; `Comms → Setup` now explains the two-config split (system email vs mailbox) and the fallback.
- `dossier.title` — the sales→operations handoff has never worked, because two
  services wrote a column the table did not have (`NEW-08`, migration `0508`).
- Backend coverage is measured in CI, with the threshold expressed in functions
  rather than lines (`TC-CI3`, `TC-Q1`).
- `.env.example` is reconciled against the config schema in CI, and the
  environment is now validated _before_ migrations rather than after
  (`TC-E1`).
- Destructive migrations must carry an explicit `-- DESTRUCTIVE:` marker
  (`OBS-I3`).
- Deploys record which commit shipped, when, by whom, and whether they finished
  (`TC-R3`); a deploy can be pinned to a named commit (`TC-D7`); an opt-in
  `AUTO_ROLLBACK=1` reverts a build that fails its readiness gate (`OBS-I4`).

### Changed

- Lint blocks the build, as a ratchet against the current warning count rather
  than an unachievable zero (`TC-CI10`).
- `npm audit` blocks at high severity, with a dated exception for the known
  `exceljs` transitive finding instead of a permanent bypass (`TC-CI4`).
- CI has a concurrency group, so two rapid pushes no longer produce two deploys
  ordered by completion time (`TC-D8`).

### Fixed

- **The deliverability and signature surfaces no longer gate the whole `/mail` namespace.** Both routers mounted at `/mail` — the same base path as every mail module — carried a router-level `router.use(requireFeature("mail.<surface>"))`, and the module loader mounts them in alphabetical discovery order (deliverability third, signature sixth). A router-level gate runs for EVERY `/mail/*` request that falls through to that router, including paths it does not own: a tenant that switched `mail.deliverability` off got `403 FEATURE_DISABLED` for `GET /mail/threads`, `GET /mail/folders`, `GET /mail/mailboxes/mine` and every module mounted after deliverability (signature, triage) before they reached the router that owns them; with `mail.deliverability` on and `mail.signatures` off it was triage's shared-inbox claim/assign instead. Both flags ship ON (migration `9114`), so the outage was latent — the same inverted pattern as the `mail.ai` gate fix in this list, armed for the first operator to switch one off. The gate is now a per-route middleware on each `/deliverability*` route and each `/signature*` route — the pattern triage already uses for `mail.shared_inbox` / `mail.followup` / `mail.secure_links`. Pinned by `tests/security/mail-gate-scope-deliverability-signature.test.js` (written first, watched fail — six failures on the broken code: three inbox reads behind deliverability-off, a triage claim behind signature-off, and the both-off worst case, plus the per-own-flag refusal assertions; 20/20 green after the fix).
- **The compose entry points are discoverable.** The Comms hub (`/comms`) was
  the only surface with a compose entry — a bare 16px `+` glyph behind a
  tooltip — and the new Mail Inbox (`/comms/mail`) had none at all (reply-only;
  only the legacy "Message log" tab had one). The hub header now renders a real
  button (icon + "New" label on `md` and up, icon-only on narrow screens) that
  opens the existing new-message chooser (in-house message / group channel /
  email), and the Inbox header gains a Compose button (icon + label on `sm`
  and up, icon-only on narrow screens; disabled while the user has no
  `CONNECTED` mailbox) that opens the existing `ComposeModal`. The resulting
  `InboxPage ↔ mail.tsx` module cycle is safe — `ComposeModal` is a hoisted
  function declaration — and is documented in the commit message.
- **An empty mail can no longer reach a recipient.** The inbox composer could
  send a message whose body serialized to an 823-byte empty HTML shell
  (`compose.serialize` wraps any doc — even an empty paragraph — in a full
  HTML document), and the outbox's `if (!html && !text) throw` guard saw the
  shell and let it through; the IMAP/SMTP provider then dropped the empty
  `text` part (`""` collapses to `undefined` via `||`), so the recipient got a
  subject with no content. The outbox now checks _visible_ content (strip
  `<style>` blocks, strip tags, collapse whitespace, allow a real `<img>`):
  a message with no visible text and no image is refused with 422 "a message
  needs a body" before it is queued. Quote-only replies and image-only
  messages still pass. Client-side, the inbox Send button now requires a
  non-empty editor (a quote counts as content) and the legacy ComposeModal
  disables Send on a blank body. Pinned by new `mail-outbox.test.js` cases:
  empty and whitespace-only docs refused, quote-only and image-only enqueued.
- **The mailbox no longer disappears when Mail AI is off.** The `mail.ai` feature
  gate was applied router-wide (`router.use(...)`) on the `mail/assist` router,
  which is mounted at `/mail` — the same base path as every other mail module,
  and the first of them the module loader mounts (alphabetical discovery). The
  gate therefore ran for EVERY `/mail/*` request that fell through to that
  router: with AI off (this flag's default), `GET /mail/threads`,
  `GET /mail/folders` and `GET /mail/mailboxes/mine` answered
  `403 FEATURE_DISABLED` before they reached `mail.routes.js` — the whole inbox
  was unreachable for every tenant that had not opted into AI, while the
  Platform Console correctly showed "Mail AI: off". The gate is now a per-route
  middleware on each `/assist/*` route: the AI surface keeps its protection,
  OCR extraction keeps BOTH (the `mail.ai` floor and its own `mail.ocr` gate),
  and the rest of `/mail` is left to the module that owns the path. The one
  route outside `/assist` (`GET /mail/messages/:id/extractions`) is gated by
  `mail.ocr` alone — not a loss of the floor, because the catalogue row for
  `mail.ocr` depends on `mail.ai` (migration `9114`). Pinned by
  `tests/security/mail-ai-gate-scope.test.js` (written first, watched fail —
  three 403s on the broken code) and the re-scoped gate assertions in
  `tests/unit/mail-ai-routes.test.js`.
- **The certified-signature webhook now receives genuine deliveries (PR-4 remediation).** The
  global `express.json()` in `server.js` parsed every JSON body before the webhook's route-level
  text parser could run (body-parser sets `req._body`, and downstream parsers bail on it), so
  `verifyWebhook` only ever saw a parsed object and rejected every real SignWell delivery with
  401 — certified signatures could only settle through the poll backstop, at best an hour late.
  The global parser now stashes the untouched bytes on `req.rawBody` (its `verify` callback),
  the controller reads the raw form first and refuses re-serialisation (a re-serialised body is
  not the body the signature covers), and the route header describes the plumbing that actually
  exists. Proven by a new stack-level test that POSTs a genuinely signed payload through
  `buildApp()` with `Content-Type: application/json` — written first and watched fail (401)
  against the broken code — including the 401 for a forged hash and the idempotent replay.
- **Credential resolution is tenant-named on every path (PR-4 remediation).** The QES
  credential cache keyed on the ambient request context with a shared `"_"` fallback — and
  workers have no request context, so the poll backstop let the first tenant polled in a
  5-minute window populate a slot every other tenant then read: one tenant's SignWell key
  answering another tenant's question, `credential_source` wrong on the audit rows, and other
  tenants' envelopes unable to advance at all. `providerConfig` now takes the tenant
  explicitly (the poll and completion paths name their slug), the ambient context is a
  request-path convenience, and a call that names no tenant computes its answer and does not
  cache it — a slot that cannot identify its tenant is a miss, never a shared seat.
- **A failed envelope charge no longer strands the retry (PR-4 remediation).** On a handoff
  charge failure the envelope row (inserted before the `BEGIN`) survived the rollback as
  `CREATING` — an in-flight state that `uq_qes_active_party` and `getActiveForParty` both
  cover — so the "please try again" advice threw `ENVELOPE_IN_FLIGHT` for the next hour. The
  row now transitions to `FAILED` with the reason in the rollback path, so the retry is
  possible immediately and the poll has nothing to clean up. The ledger-on-cancel decision
  (provider document cancelled, no ledger row for an envelope nobody can use) is recorded in
  the guide's §7.0 deviation table.
- **The webhook timestamp window is asymmetric and the shape is defensive
  (PR-4 remediation).** `Math.abs` accepted an event stamped 15 minutes in the future exactly
  as readily as a replay 15 minutes old; backward is now the 15-minute replay window and
  forward a 2-minute clock-skew allowance. A numeric-string `event.time` is coerced and logged
  once, so a provider payload-shape change cannot fail every webhook closed with no signal
  distinguishing it from a forgery.
- **The QES poll no longer strands envelopes invisibly when the provider key is missing
  (PR-4 remediation).** A tenant that removes its key previously left every in-flight envelope
  open behind a per-envelope `logger.warn` — the shape that gets scrolled past. The key is
  now read once per sweep; when it is missing each affected envelope carries the reason in
  `last_error` (the durable record) and one alert goes out per tenant per sweep through the
  platform alert channels. The envelopes stay open: the poll advances them the moment the key
  is back.
- **The migration-scoping gate now covers the programme's `qes` files and
  `pg_trigger` lookups (PR-4 remediation).** `10785_qes_envelope.sql` and
  `10787_qes_events.sql` did not match the gate's file pattern, so they were outside the net
  for every future edit. The pattern now covers `qes` (applied files are not renamed — the
  ledger keys on filename), and the gate reads `pg_trigger` lookups as well as
  `pg_constraint`: the same database-wide catalog class, and it found a real one — 10781's
  name-only trigger check (PR-3) skipped the sandbox trigger on every provisioned tenant,
  leaving `signature_request.updated_at` dead in the sandbox. 10781 is applied and immutable,
  so the scoped repair lands in 10787 (the 10779 pattern), and the test grandfathering 10781's
  line asserts the repair exists, so the exemption cannot outlive the fix.
- **The external signing chain no longer stops silently at the second signature.** The public
  `/complete` passed no mailer to the chain advance, so after a counterparty signed, the next
  party was marked `SENT` with a token minted and nowhere delivered — and the tenant's "send next
  link" button could not find them, because it looks for `PENDING` parties. The chain advanced and
  stopped, silently, at the second signature. `signature_public.controller` now injects the same
  dispatcher the internal dispatch uses, so the next link goes out by email on every external
  completion (and it must, for the QES path, where a webhook has no operator to press the button).
  Found and closed on the way during PR-4; the QES wiring tests pin it.
- **Silent-catch ratchet after #228.** Adding lines to `explainSendError` moved
  three grandfathered empty catches in `mail.service.js` off
  `doc/silent-catch-baseline.json` (`file:line`), so `build-test` failed on
  `main` with three “NEW” sites. Classified the leftover swallows in place —
  Graph `getConnection` / `autoLink` / attachment skip / optional `setupPush`
  as `@silent:storage`, `markRead` logger require as `@silent:teardown` —
  instead of re-blessing the baseline.

- **SMTP sender-verify is no longer a Praxis 5xx.** Two classifiers survived
  the same merge: `mapSmtpError` labelled `550 Sender verify failed` as 502
  `SMTP_SENDER_REJECTED` (Test, system email, platform mail-fallback probe,
  inbound-intake reply), while mailbox compose used 422 `SENDER_NOT_AUTHORIZED`.
  The 502 path flooded the server-error monitor with a mailbox-config fault.
  One map now, classified by evidence not SMTP family: sender-verify / relay
  denied → 422 `SENDER_NOT_AUTHORIZED`; user-unknown → 422 `RECIPIENT_REJECTED`;
  535 / `EAUTH` → auth; 421/451/452 → transient 502. A bare 550 is no longer
  called a sender fault. Compose still names the connected mailbox.

- **PDF preview on client / supplier / corporate-entity document uploads showed
  Chrome's "This content is blocked" interstitial.** `FileDrop` previewed a
  picked PDF in a `sandbox=""` iframe pointed at a `data:` URL. Chrome's built-in
  PDF viewer is a plugin, so Helmet's default `object-src 'none'` and the empty
  sandbox (no plugin token exists) both refuse it — images kept working because
  they render in `<img>`. Previews now paint pages onto a canvas via pdf.js
  (loaded on demand, left out of the vendor chunk) so the operator can confirm
  they picked the right scan before submitting. A render failure still offers
  "Open in a new tab", which is top-level navigation and is not subject to
  `object-src`.
- **Saved dates came back blank on every edit form, and could not be re-saved
  (`NEW-11`).** node-postgres parsed a `date` column into a JS `Date` at midnight
  in the API's timezone, so `res.json()` sent `2021-09-20T23:00:00.000Z` for a
  registration issued on the 21st: the wrong day, in a format
  `<input type="date">` cannot render. Re-opening a corporate entity or one of
  its registrations, documents or tax registrations therefore showed an empty
  Issued on / Expires on for dates that were saved, and pressing Save posted the
  timestamp back — `issued_on: Use the format YYYY-MM-DD., That date doesn't
exist.` on a field nobody had touched. `date` columns now arrive as the
  `YYYY-MM-DD` string Postgres sent (`src/shared/db/pg-date-types.js`), which is
  the format the shared `isoDate` schema validates and the date inputs expect, so
  the value round-trips unchanged. `dateFmt` reads a bare date as a calendar date
  rather than a UTC instant, and the entity and nested-child forms normalise
  whatever they are seeded with, so a timestamp reaching a date control degrades
  to the right day instead of a blank box. Applies to every `date` column in the
  product, not only master data; `timestamptz` columns are unaffected.
- `win({ createDossier })` and the `opportunity.won` handler both 500'd or
  dead-lettered on every run (`NEW-08`).
- Client test suite: a test that could only run on Linux, a Zod instance split,
  a timezone-dependent assertion, and a shell rendered without the app's
  providers (`NEW-12`).

---

## 0.1.0

The state of the system at the time of the Phase-0 audits (2026-08-04). Recorded
as a baseline so `Unreleased` has something to be relative to; the history
before this point is `git log`.
