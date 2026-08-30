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

## Before you write frontend code

`doc/FRONTEND_GUIDE.md` is **the** frontend document — CI fails if it names a
component that does not exist, so it can be trusted. §3.5 lists the primitives
you must not hand-roll; §6 is the pre-PR checklist.

Other gates that fail the build, all run from `client/`:

```
npm run lint            # includes the dialog ban and the a11y rules
npm run check:palette   # no raw palette colours — they break white-labelling
npm run check:contrast  # every text-on-surface token pair clears WCAG AA
npm run check:docs      # the frontend guide is not lying
npm run check:motion    # motion budget
npm test
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

## Conventions worth knowing

- **Validation comes from `packages/shared`**, so the API and the form agree. Do
  not re-declare a validator on one side.
- **Colour comes from tokens**, never from raw Tailwind palette classes. Accent
  *text* is `text-primary-ink`; `text-primary` is a fill.
- **Silent catches carry a taxonomy marker** — see `doc/ERROR_HANDLING.md`.
- **RBAC action is `edit`**, not `update` — the backend spells it that way.
- PR titles must start with a Conventional Commits prefix; CI gates on it
  because the changelog is written from the title.
