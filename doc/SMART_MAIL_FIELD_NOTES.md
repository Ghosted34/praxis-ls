# Smart Mail — field notes

**What this is.** A running record of what broke after a Smart Mail PR merged, why,
and what now stops it recurring. It is deliberately **separate from**
`doc/SMART_MAIL_ENGINEERING_GUIDE.md`: the guide is the plan of record and should
read as the plan, not as a defect log. Read the guide to know what we are
building; read this to know what the building actually taught us.

Newest first.

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
   the forgiving behaviours pinned so a "cleanup" cannot break the search box.
2. `tests/integration/mail-shared-inbox.test.js` — the claim race driven for
   real through the router; the emulation only applies the `assigned_user_id
   IS NULL` guard if the SQL still carries it, so a read-then-write regression
   shows up as two winners.
3. The four triage writes gate through `getThread` and carry
   `visibility.clause` inside the UPDATE; claim distinguishes missing (404)
   from claimed (409).
4. The parser now honours its own "quotes group" contract (`word1 <-> word2`
   phrases, and `subject:"bill of lading"` is one filter, not a stray phrase).

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
