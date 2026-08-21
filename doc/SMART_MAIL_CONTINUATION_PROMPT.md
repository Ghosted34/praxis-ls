# Starting a new session on Smart Mail

Paste the block below as your first message. It is written to be self-contained:
a fresh session has none of this conversation, so everything it needs to not
re-derive the situation is stated explicitly.

---

```
Repo: C:\Users\DELL\Documents\victor_work\praxis-ls (branch main)

Read these three first, in this order:
  doc/SMART_MAIL_PR2_PR5_QC_AUDIT.md   ← start here; §11.3 and §12.6 are the open-work list
  doc/SMART_MAIL_ENGINEERING_GUIDE.md  ← the plan of record; §3 is cross-cutting, §6–§9 are the chapters
  doc/SMART_MAIL_FIELD_NOTES.md        ← what broke after each PR merged and why

SITUATION. PR-0 and PR-1 were built properly. PR-2 through PR-5 were merged as
one commit (980bd6d8, PR #238) by an automated agent, and a QC pass found that
the schema was complete, the leaf logic was good, and almost none of it was
WIRED: eleven tables created by those migrations were referenced by zero lines
of application code. Three commits since then closed the worst of it:

  721ca0bf  visibility applied to every read; archive/anti-spoof/DSN hooked into
            ingest and send; SLA + follow-up sweeps written and scheduled
  ec816f5e  three-channel mentions; mail-context cache; the missing §3.7 tests
  585c0e73  mail.core/mail.composer/mail.antispoof actually gate things;
            attachments folded into the archive hash; offboarding revokes grants

WHAT IS STILL OPEN (audit §11.3 and §12):
  · PR-4's AI layer is a FACADE. No LLM call is made on any mail path.
    assist.service.compose() returns a prompt string; draft() returns whatever
    facts it was handed and the route never passes any. No metering, no
    grounding execution, no summaries, no OCR, no voice, no semantic search.
  · PR-3: five of six dossier tabs are stubs, two of seven action cards exist,
    inbound document intake is not built, conversion is preview-only.
  · PR-5: ~10 endpoints from §9.9 are missing (soft locks, SLA-policy and
    business-hours admin, thread sharing, verified-domain admin, /mail/bounces,
    secure-link listing). Secure links return a label rather than the document.
    Scheduled send is not implemented.
  · The frontend for PR-3 → PR-5 does not exist at all.

THE RULE THAT MATTERS MOST. Read §8 of the audit before writing a test. Every
test the mega-commit shipped imports the leaf module and calls it directly, so
4,518 tests were green while the features did not run. A test that imports a
module and calls it has tested that module; it has NOT tested that the product
uses it. Where the guide says a behaviour happens *on ingest*, *on send*, or *on
every read path*, assert at the CALL SITE — that the sync loop writes the row,
that the send path consults the check, that the list query carries the
predicate. tests/security/mail-visibility-wiring.test.js and
tests/security/mail-ingest-hooks-wiring.test.js are the pattern to copy.

Two standing gates already enforce the class, and they will fail your build if
you add a table nobody reads or a flag nobody checks:
  tests/security/mail-orphan-sweep.test.js
  tests/security/mail-feature-gating.test.js

GATES TO RUN BEFORE YOU CALL ANYTHING DONE:
  npm test
  npm run lint
  npm run db:check:idempotency
  npm run db:check:columns
  node scripts/check-citext-arrays.js

MIGRATIONS. §3.8 reserves ranges per PR, but reserving a range does not reserve
it on main — PR-0 had to be renumbered once already. The highest tenant
migration is currently 11740. Rebase and re-check the numbering before a final
push rather than trusting the table.

TWO LANDMINES, both documented at length in the guide, both worth reading before
you write a file:
  §3.2  src/modules/mail/ is a GROUP. Anything adding a directory under it must
        give it a matching <name>.routes.js, and nothing may put a loose
        *.routes.js back at the group root, or the whole mailbox API 404s at
        boot with no error.
  FN-1  citext[] columns have no node-postgres parser. Every READ must be cast
        ::text[] or you get the raw Postgres literal as a string. The gate above
        catches it.

TASK: <say what you want done — e.g. "close PR-5's missing endpoints from §9.9",
or "build PR-4's engine: wire compose/draft/translate to llm.service with
grounding, fact-fence and metering", or "build the PR-3 dossier drawer and notes
tab frontend">.

Work on main. Commit when a coherent chunk is green.
```

---

## Notes for whoever pastes it

- Swap the `TASK:` line for the one track you want. Handing a fresh session all
  four at once produces a shallow pass at each; the audit's §10 gives a
  defensible order if you want one.
- On this machine `git status` and `git commit` on the repo can exceed a
  45-second tool timeout, because the working tree is large and mounted. If a
  commit times out, `git write-tree` + `git commit-tree` + `git update-ref` does
  the same job without the working-tree refresh. Stale `.git/index.lock` and
  `.git/HEAD.lock` files may need renaming out of the way first.
- The mail test suites worth running while iterating, rather than the whole
  4,700:
  `npx jest tests/security/mail- tests/unit/mail- tests/integration/mail-`
