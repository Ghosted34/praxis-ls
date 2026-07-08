# Praxis LS — Frontend (kickoff outline, not yet started)

There is no working frontend in this repo yet — this file is a placeholder
marking where it starts, once the backend Security/IAM slice in
`doc/RBAC_SECURITY_KICKOFF.md` is in and testable end-to-end (you need a
working `/auth/login` to build a login screen against).

## Two references — know which is which

- `doc/reference/reference-mock-lovable/` — a Lovable-generated React +
  Vite + **TanStack Router** + **shadcn/ui** scaffold. Only `src/routes/index.tsx`
  and `__root.tsx` are real routes; the rest is the shadcn component library
  (`src/components/ui/*.tsx`) and Lovable boilerplate. Use it for **UI
  patterns and component primitives** (it's already wired for the visual
  language), not for app structure — it has no auth, no API client, no
  data model tied to this backend.
- `doc/reference/legacy_codebase/` — the old PHP/Bootstrap system
  (`administration/`, duplicated once more nested under
  `public_html/smart-logistics/administration/` — same code, two copies).
  Use it for **behavior**: what a screen needs to do, what fields matter,
  how a flow like `user-role-management.php` or `role_guard.php` worked.
  Its actual auth model (one flat `$_SESSION['auth']['role']`) is exactly
  what the new RBAC schema (role x capability x scope x permission) replaces
  — don't port the model, just the behavior.

## Stack — one open decision

Root `README.md` §2 specifies plain **React 18 + Vite + TypeScript**. The
Lovable mock is built on **TanStack Router** + shadcn/ui instead. Pick one
before scaffolding for real:
- Plain Vite + React Router: matches the README as written, less to inherit.
- Keep TanStack Router + shadcn/ui: reuses the mock's routing/component
  setup directly, less rework translating components.

## Planned structure (mirrors `src/modules/<group>/<module>` on the backend)

```
client/
  src/
    app/            # router setup, layout shell, auth guard
    features/
      security/     # login, role/permission/scope/capability admin, sessions, audit ledger
      <group>/<module>/   # one folder per backend module, same group names
    lib/
      api-client.ts # fetch wrapper, attaches Bearer token, refresh-on-401
      auth-context.tsx # holds access token + user, calls POST /auth/refresh
    components/     # shared UI (start from the shadcn set in the mock)
```

## Login page — no spec conflict after all

Corrected: the tech lead's "ad for JBS Praxis" comment meant execution
quality, not a literal marketing panel — "do so good a job that people ask
who did this," attribution carried entirely by the existing "Powered by
JBS Praxis LLC" footer line (README §3). No split-screen, no separate
showcase panel. Pure white-label login as originally specced: tenant logo,
tenant colour tokens (from `setting`/`corporate_entity`), the footer line,
nothing else competing for attention.

What this actually means for the build: the bar is on craft, not on adding
surface area — smooth transitions, no layout jank, real loading/error
states (not blank spinners), correct on mobile, fast. The login screen is
the first thing anyone sees, tenant staff and any onlooker alike, so it's
worth the extra polish pass precisely because it stays simple.

## First screen to build (once backend auth lands)

Login → protected shell → Security group: role list (already has a working
API via `iam_role`), then the four new admin screens this kickoff added
(`capability`, `scope`, `permission` grant-matrix, `field_visibility`) —
these are the most useful first screens because they let a Super Admin
actually configure access without touching SQL, and they exercise the
full auth + RBAC round-trip the rest of the frontend will depend on.
