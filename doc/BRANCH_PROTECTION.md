# Branch protection — TC-CI1

**Critical.** `main` is unprotected, 45% of changes are pushed straight to it,
and every green push auto-deploys to production. This is a GitHub *settings*
change, not code, which is why it lives here rather than in a commit.

It should be done now rather than later, because the rest of the safety net is
finally in place: pre-migration backups, tagged images, `scripts/rollback.sh`,
a readiness gate that can fail, and deploy announcements. Branch protection is
the last structural gap in that chain — the one that stops a bad change reaching
the chain at all.

The six consecutive deploy failures on 2026-08-04 all went straight to
production with no review. They happened to be crashes. A crash is the *lucky*
version: it fails loudly and touches nothing. The same path was open to a
migration that corrupts data.

---

## Do this — Settings → Branches → Add rule, `main`

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | **on** | Closes the 45% direct-push path |
| Required approvals | **1** | On a small team, 1 is real review; 2 becomes rubber-stamping |
| Dismiss stale approvals on new commits | **on** | An approval should describe the code being merged |
| Require status checks to pass | **on** | See the list below |
| Require branches to be up to date | **on** | Stops two green PRs merging into a red `main` |
| Require conversation resolution | **on** | Cheap; stops review comments being merged past |
| Do not allow bypassing | **on** | Including admins. An exception you can always take is not a control — see below |
| Allow force pushes | **off** | |
| Allow deletions | **off** | |

### Required status checks

Tick every job the CI workflow defines:

- `build-test` — syntax, shell-script LF/parse, lint, **808 tests**, migration
  numbering, migration reversibility
- `security` — dependency audit (reporting), secret scan
- `frontend (client)` and `frontend (platform-console)` — lint, contrast,
  tests, build, bundle-graph cycle check
- `docker-build`

`docker-build` matters more than it looks: the `@praxis/shared` bug
(commit 5ed5870) was a broken *image* that every other check passed cleanly.

### On "do not allow bypassing"

Turning this on for admins is the difference between a control and a
suggestion. If you need an emergency path, make it explicit and noisy —
temporarily disable the rule, do the thing, turn it back on — so it appears in
the audit log. A permanent admin bypass is how a protected branch quietly
becomes an unprotected one.

---

## Then: stop deploying straight from a green `main`

Branch protection alone still auto-deploys on merge. Two options, in order of
preference:

1. **Deploy on tag.** Change `.github/workflows/deploy.yaml` to trigger on
   `push: tags: ['v*']` instead of on CI success. Merging becomes safe;
   releasing becomes deliberate. This also closes **TC-R1** (no releases, tags
   or changelog) and **TC-D7** (the server pulls `main`, so you cannot deploy a
   chosen commit).
2. **Keep auto-deploy, add an environment gate.** Settings → Environments →
   `production` → required reviewers. The deploy job then waits for a human.

Option 1 is the better fit: `scripts/deploy.sh` already tags images by commit
and `rollback.sh` already selects among them, so tag-based deploys make the
artifact, the git ref and the rollback target the same thing.

---

## Verify it took

```bash
gh api repos/:owner/:repo/branches/main/protection | python3 -m json.tool
```

Before this change that endpoint returns `404 Branch not protected` — which is
exactly how the audit established the finding. A settings change nobody verifies
is the failure mode this whole workstream has been about; check the API, not the
checkbox.

---

## What this does not fix

**TC-CI2** — `main` is red on 15% of runs. Protection stops *new* breakage
landing, but if `main` is red today it must be made green before the rule starts
blocking everyone's merges. Check the current state first.

**TC-D6** — there is still no pre-production environment for builds. Review plus
a green pipeline is not the same as having run the thing somewhere first, as
2026-08-04 demonstrated at some length.
