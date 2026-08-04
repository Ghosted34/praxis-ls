# `@praxis/shared`

Validation schemas shared by the Express API (`src/`) and the React client
(`client/`). **One definition of "valid" per payload.**

## Why this exists

`README.md` at the repo root has described this package since the project
started:

> `packages/shared` # Zod schemas, types, posting-rules & tax libraries, i18n
> dictionaries (shared FE/BE)
>
> Shared TypeScript types live in `packages/shared` so there is one definition of
> every entity across API and web.

**The directory did not exist.** The desktop UI audit records the consequence
(F12): the backend validates with Zod, the client re-implements the same rules as
ad-hoc booleans — `finance/pages.tsx:141`'s `canSubmit` being the clearest case
— and the two drift. When they drift, the user finds out by submitting a form
the client thought was fine and getting a 422 back.

This is that package, created for real.

## Deliberate constraints

**CommonJS, plain JavaScript, hand-written `.d.ts`.** The repo has no build
step for the backend, and adding one to share a few schemas would be a poor
trade. `src/` `require`s these directly; the client imports them through the
`@shared` Vite alias and gets types from the declaration file. Nothing to
compile, nothing to keep in sync but the types.

**Zod 3, pinned as a peer dependency.** The backend has been on `zod@^3.23.8`
since before this package existed. The client was briefly installed with Zod 4
during Phase 2 and moved back to 3 — a schema object cannot cross a major
version boundary, so the shared package only works if both sides agree. It is a
peer dependency precisely so a mismatch fails at install rather than at runtime.

**No `pnpm`/Turborepo.** The root README names both; the repo uses npm and has
no workspace configuration. Introducing a package manager migration inside a
frontend PR would be the wrong place for it. This package is wired with an npm
`file:` dependency and a Vite alias, which works today. If the repo does move to
pnpm workspaces later, this package is already shaped for it.

## Layout

```
packages/shared/
  index.js         # barrel — everything the API and client import
  index.d.ts       # hand-written types for the client
  schemas/         # one file per domain
```

## Using it — backend

```js
const { z } = require("zod");
const { finalInvoice } = require("@praxis/shared");

const parsed = finalInvoice.createDraft.safeParse(req.body);
if (!parsed.success) {
  return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, parsed.error.flatten().fieldErrors));
}
```

## Using it — client

```tsx
import { finalInvoice } from "@shared";
import { useZodForm } from "@/lib/use-zod-form";

const form = useZodForm(finalInvoice.createDraft);
```

The client never re-states the rule. If the API starts requiring
`entry_date`, the form starts requiring it in the same commit.

## Adding a schema

1. Write it in `schemas/<domain>.js` **against the API's existing validator** —
   this package exists to remove a second definition, not to add a third.
2. Export it from `index.js` and declare it in `index.d.ts`.
3. Point the backend validator at it and delete the local copy.
4. Use it in the client form.

Step 3 is the one that matters. A schema here that the backend does not use is
just a third definition with better branding.
