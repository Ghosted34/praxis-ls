# Smart Mail — field notes

**What this is.** A running record of what broke after a Smart Mail PR merged, why,
and what now stops it recurring. It is deliberately **separate from**
`doc/SMART_MAIL_ENGINEERING_GUIDE.md`: the guide is the plan of record and should
read as the plan, not as a defect log. Read the guide to know what we are
building; read this to know what the building actually taught us.

Newest first.

---

## FN-5 · 2026-08-29 · Eighteen finished capabilities that no screen could reach — and the two gates that were both looking the wrong way

**Severity:** the mailbox worked, and a substantial part of what had been built
for it was invisible. Nothing was broken; a great deal was unreachable.
**Found by:** a walk of the product against §5.6, §8.3, §8.7 and §5.6.3, then a
walk of every mail route against the client.

**The eighteen**, so the number is checkable rather than rhetorical: `bcc_address`;
the `color`, `highlight`, `textAlign` and `image` marks; the `starred`, `unread`,
`vip` and `has_attachment` thread filters; `GET /mail/drafts` and
`DELETE /mail/drafts/:id`; `GET /mail/outbox` and `POST /mail/send/:id/cancel`
outside the composer; `DELETE /mail/threads/:id` and `POST /mail/folders/empty`;
the bulk `"delete"` verb; `label_fr` on every action card; and
`services/ai/transcription.service`, which mail needed and could not reach.

A separate group — reply-all, forward, remote-image blocking, quoted-history
folding, and disconnecting a mailbox — was specified and simply not built, on
either side. Those are ordinary unfinished work. The eighteen above are the
interesting ones, because every gate we have was green over them.

### The shape

FN-3 named this class — "three finished features that no screen could reach" —
and fixed the three it found. It did not ask how many more there were. There
were eighteen, and they fall into three groups.

**Things the server has accepted for several PRs, that nothing ever asked for.**
`listThreads` has taken `starred`, `unread`, `vip` and `has_attachment` since
PR-1A: the repo builds a predicate for each, `thread.service` parses each,
`ThreadQuery` declares all four. The rail offered none. So a person could star a
conversation — the list draws a star on every row, and it flips optimistically,
so people used it — and then had no way to ever see what they had starred. The
VIP lane §5.6 specifies did not exist as a lane at all, though `thread.repo`
already orders `is_vip DESC` and the row already draws the pill.

Same shape, five more times: `bcc_address` (column, draft field, send payload,
serializer case — no box to type it into, so the one recipient a forwarder most
often needs to hide could only go in Cc, where the counterparty sees them);
`Color`, `Highlight`, `TextAlign` and `Image` (loaded in the editor, rendered by
`compose.js`, no toolbar control); `"delete"` on the bulk verb list.

**Halves of a feature.** §8.7's voice is audio → transcript → toned email. The
second half was built, tested and reachable. The first did not exist, so the
composer shipped a button labelled **Dictate** over a textarea you had to TYPE
into — not a smaller version of dictation, the opposite of it, under a label
promising the thing it could not do.

`POST /assist/compose` is the same story from the other side. It reached the
model with the operator's draft and the thread transcript, and never with the
SUBJECT — which on a new message is the only thing that has been typed, and is
almost always the topic in full. So "Write it for me" on a blank composer asked
a model to write about nothing and got courteous filler back, every time.

**Whole features with no wrapper at all.** H-1's deletion is retention-aware,
ledgered, and tells the mail server so a deleted message does not return on the
next sync. It had no client wrapper, so Trash accumulated for ever and §9.6's
promise that "deletion of an archived message is blocked in the service layer"
protected nothing — nothing could delete anything, so nothing needed blocking.
The draft list and the outbox were the same: `GET /mail/drafts`,
`DELETE /mail/drafts/:id`, `GET /mail/outbox` and `POST /mail/send/:id/cancel`
all worked, and the composer told people in as many words "you can cancel it
from the outbox until then" while there was no outbox.

### Why both gates were green

`mail-client-api-wiring.test.js` walks the WRAPPERS in `mail-api.ts` and asks
who calls them. It is a good gate and it found three real defects. It cannot ask
its question of an endpoint that has no wrapper — so deletion was invisible to
it, and it had even grandfathered `listOutbox` with the reason "superseded by
the thread list", which is not merely stale but wrong: the queue is precisely
the mail that is NOT in the thread list yet.

`mail-orphan-sweep`, `orphan-wiring-sweep`, `mail-send-point-wiring` and
`mail-feature-gating` all ask their question of `src/`. None can see a query
parameter the server accepts and no client sends, because from `src/`'s side
`q.starred` IS referenced — by the repo that implements it.

So the whole class sits in the gap: a capability is declared in one place,
implemented in a second, and never named in a third, and every gate is looking
at the first two.

### The two shapes worth internalising

**A default that looks harmless is a decision nobody made.** `ActionCards` took
`language = "en"`. Every card carries `label_en` and `label_fr`, the server has
always sent both, and no caller ever passed the prop — so `label_fr` was never
once rendered and a French operator read English card names in an otherwise
French rail. Nothing failed. Nothing could fail. The English default WAS the
behaviour, and it was chosen by a parameter list.

**A promise in the UI is a test that nobody wrote.** Three sentences on screen
described behaviour that did not exist: "you can cancel it from the outbox
until then", "Dictate", and — before FN-3 — "the composer checks this list
before a send". Each was written by somebody implementing the server half, in
good faith, in the same week. A sentence in the interface is a claim about the
system, and the cheapest place to catch a false one is a test that pins the
sentence to its call site, the way FN-3's `mail-client-api-wiring` now pins the
Trust tab's.

### What now prevents it

- `mail-client-api-wiring.test.js` asks its question from **both ends**. Every
  `router.<verb>` under `src/modules/mail` has a wrapper, or is named in one of
  two lists with a reason: routes a browser must never call (webhooks, OAuth
  redirect targets, the public secure-link page) and endpoints ahead of their
  screen — the latter capped, like the wrapper-side allowance, so it can only
  shrink. Path normalisation counts braces rather than pattern-matching them,
  because the interpolations in `mail-api.ts` nest; a `\$\{[^}]*\}` stops at the
  first `}` and reports six wired routes as orphans.
- The wrapper-side allowance went 23 → 21, and both entries came off because a
  screen now calls them rather than because the reason was rewritten.
- `message-body.test.ts` pins §5.6.3's two reading-pane rules — remote images
  held back, quoted history folded, in both languages — as pure functions,
  which is what let them be written at all.
- `pending.test.tsx` pins the outbox's promise: Cancel is offered only on a
  HELD row, because `repo.cancel` is `UPDATE … WHERE status = 'HELD'` and a
  button on any other status can only ever 409.

### One thing this exposed and did not close

FN-1's second open item still stands: `mail.service.explainSendError` and
`smtp-error.map.js` are two SMTP classifiers, and the send path uses the one
FN-1 diagnosed as wrong. This sweep touched the send path only to add Bcc, and
a behaviour change there deserves its own review with its own fixtures.

`tests/integration/mail-model-backfill.test.js`, named by §5.9, is still absent
for the reason FN-3 recorded: it needs a CI harness change, not a test file.

---

## FN-4 · 2026-08-22 · The backfill split the recipients on the message and not on the thread

**Severity:** every conversation that arrived with two recipients before 10731
carries a participant that is both addresses joined by a comma — and is missing
the second correspondent entirely. **Found by:** writing the test §5.9 named and
nobody had written, and running it against a real Postgres.
**Fixed in:** migration 11743, in the same pass.

### The shape

The pre-10731 table held recipients as one comma-joined `citext`. 10731's
backfill splits it correctly into the message:

```sql
string_to_array(b.to_address::text, ', ')::citext[]
```

and does not, four lines earlier, into the thread:

```sql
ARRAY(SELECT DISTINCT x FROM unnest(
        array_agg(b.from_address) || array_agg(COALESCE(b.to_address,'')::citext)
      ) AS x WHERE x <> '')
```

So `participants` ends up as

```
{client@maersk.cm, "client@maersk.cm, ops@maersk.cm", billing@smartls.cm}
```

Same author, same statement about the same column, two lines apart, handled in
one place and not the other. Reading the SQL, both lines look like they are
doing the obvious thing. **Running it is what tells them apart** — which is the
entire argument for the test, and the reason the defect survived four sweeps
that each read this file.

### Why it is not cosmetic

`participants` is the thread's own recipient set and three things read it: the
thread list renders it, `binding/cards/_facts.js` feeds it to the assistant as
grounded fact, and `binding/convert.service.js` takes `participants[0]` as the
address to create a client or lead FROM when the thread has no `from_address`.
That last one mints a party whose e-mail is the string
`"client@maersk.cm, ops@maersk.cm"` — an address no duplicate check will match
and no message will reach. Message-level `to_address` is right throughout, and
that is what search indexes, so search is unaffected.

### The thing worth internalising

**A migration you cannot re-run is a migration nobody has watched work.**
10731's backfill only executes where legacy mail exists, and CI provisions a
tenant from nothing — so its `legacy_exists` guard made the whole block a no-op
in the one place it could have been exercised. Four gates read that file; none
of them could run it.

The way in was to rebuild the legacy world inside a transaction that never
commits: rename `email_attachment.email_message_id` back to `email_inbound_id`
(10737 renamed it AFTER 10731, and the backfill still reads the old name),
rename `email_inbound_legacy` back to `email_inbound`, insert the four shapes of
legacy row, re-apply the file verbatim, assert, ROLLBACK. DDL is transactional
in Postgres, so the tenant database is byte-identical afterwards and it is safe
in the same pass as every other integration suite.

Also worth keeping: **the fix is a new migration, never an edit.** The migrator
keys its ledger on filename and verifies the recorded `sha256`, so editing an
applied file does not re-run it and does raise drift on every tenant carrying
it — and the only tenants with the defect are the ones that already applied it.

### What now prevents it

1. `tests/integration/mail-model-backfill.test.js` — the five claims 10731 asks
   a reader to take on trust, each asserted against rows that actually moved:
   ids preserved, one thread key one conversation, an unthreaded message keyed
   on itself, read state landing on the mailbox owner, `entity_ref` carried from
   the most recent message that had one. It self-skips without `DATABASE_URL`
   rather than passing without a database.
2. `migrations/tenant/11743_email_thread_participants_repair.sql`, idempotent by
   construction and with a DOWN that says why it is deliberately not reversible.
3. CI counts that suite's assertions **by name**. The existing "the integration
   suites asserted nothing" check is satisfied by any one suite, and this is the
   most skippable of them — it is the only test 10731 has.
4. `tests/security/mail-test-manifest.test.js` — every test file the guide names
   must exist or be mapped to the one that covers it. §17 found two missing and
   §18 found ten more, nine of them naming mismatches; the expensive part was
   never writing the tests but working out which of the ten mattered, twice.

---

## FN-3 · 2026-08-22 · Three finished features that no screen could reach

**Severity:** a collision warning that could not fire, a pre-send safety check
that did not run under a caption saying it did, and no way for a lead to hand a
thread over. **Found by:** the fifth sweep, asking what the four standing gates
have in common. **Fixed in:** the same pass.

### The question that found them

Four sweeps had produced four gates — tables, workers and events, send points,
feature flags. Each is good, each caught real defects, and **every one of them
asks its question of `src/`.** Nothing in the programme had ever asked it of the
client.

Three features answered badly. In each, the schema, the service, the route, the
gate and the typed client wrapper were all present, correct and tested — and no
component called the wrapper:

- **§9.2's soft lock.** `email_thread_lock` could only ever hold zero rows, so
  the "Marie is writing a reply" bar was structurally incapable of appearing,
  under a file header stating that opening the composer takes a two-minute lock.
- **§9.8's recipient check.** `POST /mail/bounces/check` is gated
  `requireFeature("mail.composer")` — a route whose own gate names the one
  surface it is for — and the Trust tab told the operator that "the composer
  checks this list before a send". It did not.
- **§9.1's assignment.** Claim shipped, assign did not.

### The two shapes worth internalising

**A gate that reads one directory answers about one directory.** `mail-orphan-
sweep` was green throughout, and correctly: `email_thread_lock` *is* referenced
by a line of `src/`, which is the only question it asks. The four gates between
them cover every way a *backend* declaration can go unread, and their success
is what made the client's silence look like coverage. The fifth gate,
`mail-client-api-wiring`, asks it of the last mile.

**A caption is a claim, and it ages the way code does.** §15.2 found a caption
promising a feature that had already shipped and called it "worse than never
promising it, because the operator reads it, believes the feature is missing,
and attaches the 18 MB PDF anyway". This is that error with the sign flipped —
a caption asserting a control that does not run — and it is the more dangerous
direction, because the person reading it is deciding whether to send. The
sentence and the call site that makes it true are now pinned together in one
test: remove the caller and the assertion about the sentence fails.

### The one that was only latent, and the gate that was looking away

`mail.repo.setEntityRef` still ran `UPDATE email_inbound` — the table 10731
renamed to `email_inbound_legacy`, in a migration whose header names
`setEntityRef` among the three writers the rename obliged it to rewrite. It
threw for nobody across four PRs because nothing called it.

`check-query-columns` could not have caught it: `ALTER TABLE x RENAME TO y`
marked `x` **opaque** — a shape it can no longer reason about, and so never
checks again. That is right for columns and exactly wrong for existence. A
renamed-away table is not unknown, it is gone. The script now tracks
renamed-away and dropped names separately and fails on any statement naming one.
Verified by reintroducing the write and watching it fail; run against the tree
it produces exactly one finding and no false positives across 348 tables.

Second-order, and the reason the function's *type* was also wrong everywhere it
touched the client: **an interface nobody calls is not checked by anything.**
`ThreadLock` declared a `taken: boolean` the server has never sent;
`releaseThreadLock` was typed as returning a lock and returns `{ released }`;
`checkAddresses` declared a `Record` where the server returns rows. `tsc` was
green on all three because a type is only as true as its first caller.

### What now prevents it

1. `tests/security/mail-client-api-wiring.test.js` — every exported mail API
   wrapper must be called from a screen, with a capped, reasoned allowance list
   for the 23 that are honestly ahead of their screen.
2. The three restored call sites are asserted **by name** as well, because the
   sweep is deliberately generous about what counts as a caller and a hook that
   nothing mounts would still satisfy it — the exact shape §9.2 failed in.
3. `check-query-columns` fails on a query naming a table a migration renamed
   away or dropped.
4. `workflow.addressStatus` no longer answers a failed query with the empty
   array a clean recipient list produces. §13.5's rule for anti-spoof verdicts,
   applied to the check that says *do not send to this address*: an absent
   verdict renders nothing, never a green tick.

### One thing this exposed and did not close

`tests/integration/mail-model-backfill.test.js` is named by §5.9 and does not
exist, and unlike the other nine absent filenames this sweep triaged, it is not
a naming mismatch: 10731's backfill — which moved every existing message into
the new three-table model — has no test. It needs a database, and CI's
`migrations` job provisions a tenant from nothing, where the backfill's
`legacy_exists` guard makes it a no-op. Closing it means seeding `email_inbound`
rows before 10731 runs. That is a CI harness change rather than a test file, and
it is the honest remaining item.

---

## FN-2 · 2026-08-21 · A specified search operator did nothing, and the triage writes leaked what the reads protected

**Severity:** a silent search no-op; a visibility leak through `RETURNING *` on
the PR-5 write routes. **Found by:** the QC pass of this session, when two test
files the guide names by name turned out not to exist.
**Fixed in:** the same pass.

### The two named-but-missing tests were the symptom

`tests/integration/mail-search.test.js` (§3.7) and
`tests/integration/mail-shared-inbox.test.js` (§9.11) were both absent from the
tree, and both chapters read as complete without them. Every earlier sweep had
asked "what did a migration create that nothing reads?" and "what did a worker
register that nothing enqueues?" — and had **not** asked the test-plan's own
question: "does the test the guide names by name exist?" The audit's §9 listed
both as missing; §11–§16 never claimed to have written them; the gap survived
three sweeps because each sweep measured code, not tests.

### What writing them uncovered

`client:` is in the guide's mini-language (§5.x). The parser stored it and
`queryFrom()` dropped it — a search operator that silently did nothing, which
is worse than an unknown one, because an unknown one is searched as text and a
known one reads as working.

The triage write routes — claim, assign, status, visibility PATCH — all ended
in `RETURNING *` with no visibility predicate. §5.1's critical had been fixed
at the repo layer (list, get, search, timeline); the fix never reached the
route layer, where four writes returned the thread they were writing to. Any
colleague holding MOD-72 edit could read a PRIVATE thread's subject by
claiming it — and could widen an invisible PRIVATE thread to TEAM, the
shortest route into it. The read gate was `threadRepo.getThread`; the routes
did not call it.

### The two shapes worth internalising

**A write that RETURNS the row is a read.** The visibility sweep enumerated
repos and query builders; nobody enumerated `RETURNING` on writes. Where a
route returns entity content, the §9.5 predicate applies to it as surely as to
a list endpoint.

**A test plan is a checklist, and a checklist with two unchecked boxes reads
as done.** The guide names ~20 test files; the tree had 18 of them. The missing
two were each one line away from the code they would have caught — the same
"gap between the mock and the database" shape as FN-1, one layer up.

### What now prevents it

1. `tests/integration/mail-search.test.js` — parser + call-site SQL, including
   the forgiving behaviours pinned so a "cleanup" cannot break the search box,
   and a 50,000-underscore hostile parse that fails if the tokeniser ever
   grows a backtrackable quantifier again (CodeQL caught the first draft).
2. `tests/integration/mail-shared-inbox.test.js` — the claim race driven for
   real through the router; the emulation only applies the `assigned_user_id
   IS NULL` guard if the SQL still carries it, so a read-then-write regression
   shows up as two winners.
3. The four triage writes gate through `getThread` and carry
   `visibility.clause` inside the UPDATE; claim distinguishes missing (404)
   from claimed (409).
4. The parser now honours its own "quotes group" contract (`word1 <-> word2`
   phrases, and `subject:"bill of lading"` is one filter, not a stray phrase),
   with `tokenise` as a hand-scanned linear pass — a regex that has to decide
   both where the operator ends and where the quote ends is a ReDoS.

---

## FN-1 · 2026-08-19 · The Mailbox tab would not open

**Severity:** the Mailbox tab was unusable, and mail ingestion was silently broken.
**Introduced by:** PR-1A (#225). **Found by:** the CEO, in TEST mode, on the screen.
**Fixed in:** the PR that carries this note.

### What was seen

```
This screen couldn't be displayed
(t.participants || []).filter is not a function
```

The whole of Comms → Mailbox — folder rail, conversation list, reading pane —
replaced by an error boundary.

### What actually happened

`email_thread.participants`, `email_message.to_address` and `.cc_address` are
`citext[]`. That type buys case-insensitive comparison on addresses, which is
why it was chosen, and it was the right choice.

The cost nobody accounted for: **`citext` comes from an extension, so its array
type has no fixed OID, and node-postgres ships no parser for it.** Reading one
hands JavaScript the raw Postgres literal as a *string*:

```
"{client@maersk.cm,billing@co.cm}"      ← what arrived
["client@maersk.cm","billing@co.cm"]    ← what every reader expected
```

`.filter` is not a function on a string. Because the throw was inside a row
renderer, React's error boundary took the entire screen for one bad field on one
conversation.

### The second bug, which was worse

`upsertThread` returns `RETURNING *`, so it too handed back the raw string.
`mail.service.ingestMessage` passes that row into `threading.foldIntoThread`,
which does `existing.participants.map(...)` — and threw.

So **every message after the first in a conversation failed to ingest.** It
failed inside the sync worker, where the per-folder error isolation caught it
and wrote it to `email_folder.last_error`. No alert, no red screen. Mail simply
stopped arriving, quietly. That is the more dangerous of the two by a distance,
and no one had noticed it yet.

### The third bug, which only became visible once the first two were fixed

With the crash gone, participants were still wrong: `upsertThread`'s
`ON CONFLICT` did `participants = EXCLUDED.participants` — a blind overwrite.
Every neighbouring field on that clause is written defensively (`COALESCE`,
`OR`, `LEAST`, `GREATEST`) precisely so a later message cannot clobber the
conversation. Participants was the one exception, and it is the field that most
obviously has to accumulate: the upsert runs with only *this* message's
addresses, so a thread ended up listing whoever spoke last. It now unions.

### This had already happened once, in another module

Widening the new gate to see schema-qualified tables (`CREATE TABLE platform.x`,
which its first draft skipped) turned up a fifth `citext[]` column —
`platform.feature_catalogue.depends_on` — and, at its only read site, this:

> `depends_on` is a `citext[]`. citext is an extension type with no array parser
> registered in node-postgres, so the driver returns the raw Postgres array
> literal as a STRING … iterating that string character-by-character once turned
> **EVERY feature off**, including no-dependency ones, because `"{"` is not a key.
>
> — `src/services/platform/provisioning.service.js`

Same driver, same type, same failure mode, a different module and an earlier
session. It was diagnosed correctly, fixed correctly with a cast plus a
belt-and-braces normaliser, and the explanation was written down **as a comment
at the fix site** — where only someone already reading that function would ever
find it. Nothing generalised the finding, so mail rediscovered it from scratch
at the cost of a broken tab and a silently stalled ingest.

That is the real argument for the gate over the fix. A comment records what
happened here; a gate records what must not happen anywhere. The three sites now
known (`provisioning`, `orchestrator`, mail) are all cast, and the gate is what
keeps the fourth from being found by a user.

### Why every gate was green

This is the part worth internalising, because the same shape will recur.

| Layer | What it supplied for `participants` |
| --- | --- |
| `mail-service.test.js` | a mock whose `upsertThread` returned no `participants` at all → `[]` |
| `mail-threads.test.js` | a mocked repo, so the SQL never ran |
| `inbox.test.tsx` | a hand-written JS array in the fixture |
| the repo SQL smoke | ran the real query, but asserted on `unread_count` and `is_starred` — never on the **type** of `participants` |

Four layers, and **not one of them could produce the string the database
actually returns.** The defect lived exactly in the gap between "the mock says
array" and "the database says string". Mutation-testing the component tests
would not have caught it either: the mutation I would have made is to the
component, and the component was correct for the input it was given.

**The lesson is narrower and more useful than "test more":** a test that
supplies its own fixture for a value that *crosses a driver boundary* is not
testing that boundary. Where a type is decoded by a driver — arrays, JSON,
intervals, numerics, enums, anything from an extension — something has to assert
on the shape the driver really returns.

### What now prevents it

1. **`scripts/check-citext-arrays.js`**, wired into `ci-local.js` and the
   `build-test` job. It discovers the `(table, column)` pairs from the
   migrations — so a column added later is covered without editing the script,
   and a *scalar* `citext` that shares a name is not confused for an array — and
   fails the build on a read that is not cast to `::text[]`. It covers
   schema-qualified declarations, which is how the `platform.*` pairs surface.
   Writes are deliberately not checked: pg coerces a JS array going in, and a
   gate that cries wolf gets switched off. Verified by reintroducing both original bugs
   and watching it fail on each.
2. **A real-database assertion on the shape**, not just the value.
3. **The client normalises at the API boundary** and the renderers use
   `Array.isArray` rather than `|| []` — a truthy non-array passes `|| []` and
   then throws. The worst case is now one odd-looking row.
4. It also found **a pre-existing instance outside mail**:
   `ai_answer_feedback.action_keys` in `services/ai/orchestrator.service.js`,
   fixed in the same pass, and it now stands guard over the two platform sites
   that had been fixed by hand.

### One more thing this exposed

There are now **two SMTP error classifiers with different verdicts**:

- `mail.service.explainSendError` — every 550 → `SENDER_NOT_AUTHORIZED`, 422.
  This is the one on the **send path**, used by the queue flusher.
- `smtp-error.map.js` `mapSmtpError` — evidence-based ladder (auth → sender →
  recipient → transient → other), used by the connection test, system email and
  the deploy probes. Rewritten by PR #228.

**PR #228's reasoning is correct and mine was wrong**: RFC 5321 makes a bare 550
"mailbox unavailable", which covers user-unknown and policy as well as
sender-verify. Telling an operator to fix their From address when they mistyped
a recipient sends them to the wrong panel. But #228 fixed the classifier that is
*not* on the send path, so the send path still has the defect it diagnosed.

`outbox.service.retryPlan` also names two codes that nothing emits —
`RECIPIENT_REJECTED` and `AUTH_FAILED`. Harmless today (the `status === 422`
check catches the real ones), but dead names in a list that reads as
authoritative.

**Not fixed here**, because it is a behaviour change on the send path with its
own test expectations and deserves its own review. Recommended as the first item
of PR-2.
