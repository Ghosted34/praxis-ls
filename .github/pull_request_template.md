<!--
  TITLE FORMAT — REQUIRED. CI's `build-test` job fails the PR if the title
  does not start with a Conventional Commits type prefix, because a
  squash-merge writes the changelog from the PR title.

      type(scope): what changed

  Types:  feat  fix  chore  docs  refactor  perf  test  build  ci  revert
  Scope is optional but useful. End the summary with what actually changed,
  not why — the body is where "why" goes.

  Examples:
      fix(ledger): reject unbalanced entries at the database
      feat(ribbon): show all master-data sections at xl and above
      chore(deps): bump vitest to 4.1

  Remove this comment before submitting.
-->

## What changed

<!-- One or two sentences on the diff itself. -->

## Why

<!-- Motivation. Link the ticket or the report that led here. -->

## How it was verified

<!-- Which tests were run, which screens were exercised, or why manual verification was enough. -->

## Frontend checklist

<!-- Delete this section if the PR touches no frontend code. -->

- [ ] No `window.confirm` / `window.alert` / `window.prompt` — used `useConfirm()`,
      `usePrompt()`, `<Callout>` or `useToast()` instead (doc/FRONTEND_GUIDE.md §3.10).
      Native dialogs are drawn by the browser, so they ignore the tenant's white-label
      branding entirely. `npm run lint` fails on them.
- [ ] Colour comes from tokens — no raw palette classes (`npm run check:palette`).
- [ ] Light and dark both check out.
- [ ] `npm run lint` and `npm test` pass in every frontend app the PR touches.
