# Tenant review of 29 Sep 2026 ("meeting 6") — the four PRs

Everything that came out of the sixth review with the first tenant (SMART Logistics &
Services) lives here:

| File | What it is |
| --- | --- |
| [register.md](register.md) | Every finding, verified against the code with file:line evidence, plus the owner's decisions. The source of truth for all four PRs and for their QC. |
| [pr1-client-portal-go-live.md](pr1-client-portal-go-live.md) | PR 1 — client documents and KYC, who is told about a client and how, taps that land, invitations and install, the public website. |
| [pr2-quote-requests.md](pr2-quote-requests.md) | PR 2 — quote requests: one service-type model across website, portal and desk; Incoterms per service; documents; tying a request to a client; the request in the portal. |
| [pr3-finance-master-data.md](pr3-finance-master-data.md) | PR 3 — the fixed EUR parity, débours / own-cost toggle, AI-suggested OHADA posting, VAT basis, ISO coverage, discarding a draft client, phone signing with a 5-minute window, the LIVE go-live checklist. |
| [pr4-quotations.md](pr4-quotations.md) | PR 4 — quotations from a costing to the client's portal (families, e-signed acceptance), Quotations beside Proposals in Sales & CRM, and ⌘K search that finds every page, tab and record, with a gate. |

## Order

- **PR 1 and PR 2** are independent and can run at the same time.
- **PR 3** depends on nothing.
- **PR 4 starts after PR 2 is merged** — it builds on PR 2's request ↔ client link and the
  portal's quote screens.

Each PR has its own migration-number range (see the table at the end of
[register.md](register.md)), so sessions running in parallel cannot collide.

## Starting a session

Give a fresh session only this, with the PR's number and file filled in:

```
Read CLAUDE.md, then doc/tenant-review-2026-09-29/register.md and
doc/tenant-review-2026-09-29/<prN-file>.md. Implement PR <N> exactly as that file describes —
its owner decisions are final — and open one pull request to main as it specifies.
```

## Changing a prompt

The prompt files are the brief, so change them here and nowhere else: a decision that moves is
edited in the prompt **and** recorded under "Owner decisions" in the register, in the same
commit. A session already running is sent the changed section as a follow-up message.
