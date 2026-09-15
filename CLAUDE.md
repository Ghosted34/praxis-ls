# CLAUDE.md — working rules for this repository

Read this before writing code. It is short on purpose; the detail lives in
`doc/`, and the pointers below are the ones worth following.

Praxis LS is a **white-label, multi-tenant** logistics and OHADA-accounting ERP.
"White-label" is not a marketing word here — it is the property most of the
frontend rules exist to protect. Every colour, every font and every dialog a
tenant sees is supposed to be *theirs*.

## The frontend rule that trips people up first

**Never use `window.confirm`, `window.alert` or `window.prompt`. Not anywhere,
not temporarily, not "just for now".**

This is enforced by the `praxis/no-native-dialogs` ESLint rule as an **error** in
all three frontend apps (`client/`, `platform-console/`, `public-web/`), so code
that uses one does not merge. The rule catches the aliases too — `window["confirm"]`,
`const { confirm } = window`, and `const ask = window.confirm` are all the same
violation.

Reach for these instead:

| Instead of       | Use                                                                    |
| ---------------- | ---------------------------------------------------------------------- |
| `window.confirm` | `useConfirm()` from `@/components/ui/use-confirm` (or `<ConfirmDialog>`) |
| `window.prompt`  | `usePrompt()` from `@/components/ui/use-prompt` (or a `<Dialog>` with a `<Field>`) |
| `window.alert`   | `<Callout>` for something they are reading, `useToast()` otherwise      |

`useConfirm()` returns an `await`-able call plus the element to render, so the
call site keeps the same top-to-bottom shape the `confirm()` had. Full example
and the copy rules — name the outcome in the title, name the action in the
button, `destructive` for anything irreversible — are in
**`doc/FRONTEND_GUIDE.md` §3.10**.

**Why it is a hard rule and not a preference.** A native dialog is the one piece
of UI a tenant sees that the *browser* draws rather than us. It renders in OS
chrome titled "app.praxis-ls.com says", which discards the tenant's white-label
branding at the exact moment the product is asking them to destroy something. It
has no token colours, so a destructive action cannot look destructive. Its
buttons say "OK" and "Cancel", which never name the action. It cannot be
translated by `tr()`. And `alert`/`confirm` **block the event loop**, which has
already caused a real defect here: a draft autosave landing after a discard.

If you believe you have found the exception, you almost certainly have not.
`eslint-disable-next-line praxis/no-native-dialogs` exists, requires a written
reason next to it, and nothing in the tree needs one today.

## The second frontend rule: dates are day-first

**Never `<input type="date">` or `<input type="datetime-local">`. Use
`<DateField>` / `<DateTimeField>` from `@/components/ui/`.**

This is enforced by `scripts/check-date-format.js` (`npm run check:dates`),
which runs in CI and in `npm run ci`, so a native date input does not merge.

A native date input renders in the **operating system's** locale, and no HTML
attribute overrides it — `lang` is ignored for the value display. On a
US-configured workstation it shows and accepts mm/dd/yyyy. Praxis serves a
corridor that reads dates day-first, so the operator types 03/07 meaning the 3rd
of July and the control stores the 7th of March.

Nothing catches that, which is the entire reason it is a gate. Both readings are
real dates: the value validates, the API accepts it, the round-trip is clean and
every test stays green. It surfaces months later as a licence that expired in a
month nobody expected or a customs deadline missed by a quarter.

`DateField` reads and writes dd/mm/yyyy while storing the ISO `YYYY-MM-DD` the
API already wants, so nothing downstream changes. It takes `min`, `max`,
`required`, and a react-hook-form `{...field}` spread. `DateTimeField` is the
same thing with `HH:mm` on the end. (`type="month"` is fine — no day in it.)

The same rule covers **displaying** a date. `toLocaleDateString()` with no
locale means "whatever this machine is set to" — month-first on a US
workstation, and in a container with no `LANG`, which is how server-rendered
dates were month-first too. Use the formatters in `lib/format.ts` (`dateFmt`,
`dateDmy`, `dateTimeFmt`) or pin `en-GB`; never `undefined`, `[]`, `"en"` or
`"en-US"` for a format that renders a day number.

**ISO `YYYY-MM-DD` is not the bug** — it is the wire format the API contract,
the `@shared` validators and every `date` column are built on, and it stays.
What changes is where a PERSON reads a date: document and PDF templates
(`services/documents/templates` — an invoice prints `27/07/2026`), xlsx/CSV
exports (`services/spreadsheet`), and screens. The gate flags ISO in those two
backend paths and nowhere else.

Three escape hatches, each costing a written reason next to it:
`@date-format:foreign` for an incoming third-party format (a bank statement
genuinely arrives month-first, and refusing to parse it does not make it
day-first), `@date-format:parts` for an `Intl.DateTimeFormat` built only to call
`formatToParts()`, which renders nothing, and `@date-format:filename` for an ISO
day in a filename (`/` is not legal in one, and ISO is what makes downloads
sort). Full detail in
**`doc/FRONTEND_GUIDE.md` §3.12**.

## The third frontend rule: uploads go through the engine

**Never `<input type="file">`. Use `<ImageUpload>` (upload on pick) or
`<FilePicker>` + `<UploadList>` + `useUpload({ autoStart: false })` (upload on
Save), from `@/components/ui/image-upload` and `@/lib/use-upload`.**

Enforced by the `praxis/no-raw-upload` ESLint rule as an **error** in all three
frontend apps, with **no baseline allow-list** — every upload site in the tree is
on the engine. It catches the rewrites too: `<input type={"file"} />` and
`el.type = "file"` after `createElement` are the same violation.

`public-web/` carries its own copy of the engine (`components/ui/file-input.tsx`,
`lib/image-compress.ts`) because that app installs only its own dependencies in
CI and cannot import from `client/`. Keep the two in step.

The engine gives every upload three things, none of them optional: a **preview**
from the moment the picker closes, a **0→100% percentage** ending in an explicit
*Upload complete* once the server has answered, and **compression** before the
bytes leave the device.

A `<FileDrop>` is also gated: `praxis/require-upload-progress` fails one that
passes neither `{...fileDropProps(upload.items[0])}` nor an explicit
`uploadProgress`. That rule exists because the first one did not cover it —
`no-raw-upload` passed the whole tree while fourteen `<FileDrop>`s still showed
a filename and then a tick with no percentage between them.

`profile` is required and is not cosmetic — it decides whether the image is
tonally corrected. `document` and `brand` never are: auto-levelling a customs
scan makes it stop matching the paper, and stretching a logo's histogram hands
the tenant back a different green. `photo` and `avatar` are. Full detail,
including the delivery side (`<ResponsiveImage>`, AVIF/WebP derivatives), is in
**`doc/FRONTEND_GUIDE.md` §3.13**.

**Why it is a hard rule.** `FileDrop` has accepted `uploadProgress` and
`uploadSuccess` props since it was written, and 2 of ~30 upload sites passed
them. Nobody decided those screens should have no progress bar — the raw input
was closer to hand than four pieces of state and a cleanup effect. A bare upload
costs the user a preview (picking the wrong scan is invisible for months), a
percentage (a slow upload is indistinguishable from a frozen screen, so people
double-upload) and compression (the original is served back at full size into a
96px cell, forever).

Backend side: `src/services/image-pipeline.service.js` is the one engine every
image write goes through, and callers must hash the master **it returns**, never
the bytes they received — `document_signature` records `artifact_hash` from the
vault row's `content_hash` and `document_verification` compares the two.

## Before you write frontend code

`doc/FRONTEND_GUIDE.md` is **the** frontend document — CI fails if it names a
component that does not exist, so it can be trusted. §3.5 lists the primitives
you must not hand-roll; §6 is the pre-PR checklist.

Other gates that fail the build, all run from `client/` — `npm run ci` runs the
lot, so this list is for when you want one of them on its own:

```
npm run lint            # includes the dialog ban and the a11y rules
npm run check:palette   # no raw palette colours — they break white-labelling
npm run check:contrast  # every text-on-surface token pair clears WCAG AA
npm run check:docs      # the frontend guide is not lying
npm run check:motion    # motion budget
npm run check:shared    # the bundler can consume @praxis/shared, on one Zod
npm run check:schemas   # a shared schema is used by BOTH sides, and migrated
                        # validators have not grown their own rules back
npm run check:bundle    # chunk graph is acyclic — needs `npm run build` first
npm test
```

One more runs from the repo ROOT rather than `client/`, because it covers the
backend and all three frontends at once:

```
npm run check:dates     # no month-first dates anywhere — see the rule above
```

`platform-console/` and `public-web/` each have their own `npm run lint`. All
three share the local rules in `client/eslint-local-rules/` — that directory is
the single copy, re-exported by the other two apps, because a second copy of a
gate is a gate that drifts.

## Repository shape

```
src               # Node/Express backend (CommonJS)
client            # Tenant ERP — React 18 + Vite + TS (PWA)
platform-console  # Praxis-side admin console — React + Vite + TS
public-web        # Stranger-facing: marketing site + external portal
packages/shared   # Zod schemas shared by API and frontends — one definition each
migrations        # SQL, numbered; see the CI gates on numbering and reversibility
doc/              # PRD, OHADA knowledge base, architecture and frontend guides
```

Node 20 (`.nvmrc`), npm. Backend lint and tests run from the repo root; each
frontend app has its own toolchain and is linted, tested and built separately in
CI.

## Before you push: `npm run ci`

**Not `npm run lint && npx jest`.** That is two of the thirty-odd gates CI runs,
and passing them is not evidence about the other twenty-eight.

```
npm run ci               # every gate that needs no infrastructure, full report
npm run ci --fast        # stop at the first failure
npm run ci --backend     # or --frontend, when you only touched one side
node scripts/ci-local.js --list      # what it runs, and each gate's own command
```

It runs the gates in CI's own order and reports **all** the failures rather than
the first, so five unrelated breakages cost one run instead of five pushes. Read
`scripts/ci-local.js` — its header states exactly what it SKIPS (a live
Postgres, PgBouncer, the Docker build, the Playwright layout gate), so a green
run here is "the gates that need no infrastructure pass" and not a promise.

Two classes of gate are the ones people actually get caught by, because neither
is a test and neither fails while you are working on the thing that breaks it:

- **Generated artefacts drift.** `doc/API_REFERENCE.md` and `doc/ERROR_CODES.md`
  are generated from the code, and `generate-api-docs.js --check` fails when
  they are stale. Adding one `throw new AppError(...)` changes a count in a
  table and reddens `build-test`. The fix is never to edit the file — run
  `node scripts/generate-api-docs.js` and commit what it writes.
- **Cross-cutting gates fire from a file you did not open.** `check:schemas`
  treats any `*.validator.js` that imports `@praxis/shared` as a migrated
  adapter, so ADDING that import to a validator that still declares its own
  shape turns a green file red — the failure is in a file you only added one
  line to. Put the rule in `packages/shared`, or add an `ALLOW_LOCAL_SCHEMA`
  entry in `client/scripts/check-schemas.mjs` with the reason (partly-migrated
  validators are what the hatch is for).

And the older trap, which `npm run ci` also covers: CI's `build-test` runs
`npx jest` across the **entire** backend. A change to a **shared** function — a
service like `foldDetails`, a repo helper, a validator — breaks a suite you did
not name in a targeted `jest <file>` run, so a subset pass reads as green while
CI is not. Running one file is never a substitute for the suite.

## Conventions worth knowing

- **Validation comes from `packages/shared`**, so the API and the form agree. Do
  not re-declare a validator on one side.
- **Colour comes from tokens**, never from raw Tailwind palette classes. Accent
  *text* is `text-primary-ink`; `text-primary` is a fill.
- **Silent catches carry a taxonomy marker** — see `doc/ERROR_HANDLING.md`.
- **RBAC action is `edit`**, not `update` — the backend spells it that way.
- PR titles must start with a Conventional Commits prefix; CI gates on it
  because the changelog is written from the title.
