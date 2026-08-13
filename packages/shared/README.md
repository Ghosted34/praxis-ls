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
  return next(
    new AppError(
      "VALIDATION_ERROR",
      "Invalid body",
      422,
      parsed.error.flatten().fieldErrors,
    ),
  );
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
2. Export it from `index.js` and declare it in `index.d.ts`. Use
   **`exports.name = name;`**, never `module.exports = { name }` — see below.
3. Point the backend validator at it and delete the local copy.
4. Use it in the client form.

Step 3 is the one that matters. A schema here that the backend does not use is
just a third definition with better branding.

### `exports.x =`, never `module.exports = { x }`

The two are identical to Node, so the API cannot tell them apart. The client
can: it is **bundled**, and `cjs-module-lexer` — which both esbuild and Rollup
use to discover a CommonJS module's named exports — cannot see through the
object-literal form.

This is not a style preference. With `module.exports = { … }` the client was
broken in every bundler path at once, and nobody noticed for as long as no
routed screen imported the package:

| Path         | Symptom                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `vite build` | `"finalInvoice" is not exported by "packages/shared/index.js"`                                             |
| `vite dev`   | the import silently resolved to `undefined` — a form with no validation, then a crash inside `zodResolver` |
| `vitest`     | **passed** — Vitest loads this CommonJS through Node, which does not care                                  |

That last row is why it survived review: the only path that exercised the
package was the only one that could not see the problem. `npm run check:shared`
now builds a probe against the real Vite config on every CI run, so a
regression fails the build instead of waiting for the next screen.

### Zod stays a peer dependency

Never add `zod` to this package's own `dependencies`. A second copy on disk
means `instanceof z.ZodType` is false across the FE/BE boundary and `zodResolver`
gets a schema from the "wrong" Zod. The client resolves the single instance in
`client/config/shared-alias.ts`; the API resolves it from the repo root.

One subtlety recorded there and worth repeating: **one copy on disk is not one
instance.** Zod's `exports` map has separate `import` (`./index.js`, ESM) and
`require` (`./index.cjs`, CJS) entries, so a bundler alias pointing at the
package _directory_ still hands client code the ESM build and this package's
`require("zod")` the CJS one. The alias must pin an entry file.
