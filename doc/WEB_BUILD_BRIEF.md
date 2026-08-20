# praxisls.com — Build Brief

**For the engineer implementing the marketing site.** Read this whole file
before writing anything.

**How this engagement works.** You implement. A principal-engineer review runs
in a separate session against your branch or PR. The rules below are numbered
so review findings can cite them. Where this brief is wrong, silent, or fights
reality, **say so in `HANDOFF.md` rather than improvising quietly** — a
documented deviation is a design decision; an undocumented one is a defect.

---

## 1. Repositories

|                |                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read-only**  | `tomblakeasaah196/praxis-ls`, branch `claude/saas-landing-page-strategy-1trd7u` — the specification and the brand package. **Do not commit to this repo.** |
| **Build here** | A new repository, `praxis-ls-web`.                                                                                                                         |

**Why a separate repo, non-negotiably:** `.github/workflows/ci.yaml` in
`praxis-ls` runs on every PR to `main` with no path filter, and
`.github/workflows/deploy.yaml` SSH-deploys the production VPS when CI passes on
`main`. A marketing copy fix merged into that repo would roll the production
ERP. Path filters could mask it; a separate repo makes it impossible.

---

## 2. Read these first, in this order

| #   | Path                                                 | What it is                                                                                   |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | `doc/LANDING_PAGE_GUIDE.md`                          | **The specification.** §3 and §4 are the finished copy deck in both languages.               |
| 2   | `doc/BRAND_GUIDELINES.md`                            | The brand system — colour, type, mark, voice, theme.                                         |
| 3   | `doc/BRAND_GLOSSARY_FR_EN.md`                        | Every customer-facing term in both languages, plus the French typography and register rules. |
| 4   | `packages/brand/README.md`, `index.js`, `tokens.css` | The brand as code. The palette's single source of truth.                                     |
| 5   | `scripts/marketing/capture-screens.mjs`              | How product screenshots are produced.                                                        |

Useful background, not instructions: `client/src/lib/i18n-dict.ts` (the app's own
FR/EN voice — match it), `doc/FRONTEND_GUIDE.md` (how this team writes and
documents frontend code), `README.md` (what the product is).

---

## 3. Non-negotiables

**N1 — The copy is final. Use it verbatim.** `LANDING_PAGE_GUIDE.md` §3 carries
the finished English and French for all fourteen homepage sections. Do not
rewrite, "improve", shorten or regenerate it. If a string genuinely will not fit
a layout, change the layout; if it truly cannot work, log it as OPEN and leave
the copy alone.

**N2 — Never fork the brand values.** Consume `packages/brand` — as a pinned git
dependency, or by vendoring `tokens.css` with a CI check that diffs it against
upstream. Copying hex values into the site is the exact failure this whole
effort exists to end.

**N3 — No raw hex anywhere** except inside the vendored token file. Everything
else reads `var(--brand-*)`.

**N4 — The two colour rules that are easy to get wrong.** Orange as _text_ uses
`--brand-ink-orange`, never `--brand-orange` (`#FF5A00` on white is 3.13:1 and
fails AA). Text on an orange _fill_ is carbon, never white (white on orange is
also 3.13:1). Both are already correct in the tokens — do not override them.

**N5 — Fonts.** IBM Plex Sans (display), Inter (body/UI), JetBrains Mono
(figures). Self-hosted via `@fontsource`, subset `latin` + `latin-ext` so French
accents render. No other family may be _named_, including in fallback stacks —
end stacks with a bare generic keyword. Figures that sit in columns get
`font-variant-numeric: tabular-nums`.

**N6 — Theme.** Dark is the default on first visit. The toggle is two states
(not three), the choice persists, and it is never overridden afterwards. Light
mode is fully designed, not a filter — it will be printed. No flash of the wrong
theme on load: set the theme before first paint via an inline head script.

**N7 — i18n routing.** Localised slugs per `LANDING_PAGE_GUIDE.md` §2. Explicit
`/en/` and `/fr/` prefixes. `hreflang` (`fr`, `en`, `x-default`) plus a
self-referencing canonical on every page. **The only redirect in the system is
the bare root**, a 302 on `Accept-Language` defaulting to `/en/`. Deep links are
never redirected. The switcher maps to the _equivalent page_ in the other
language (`/en/pricing` ⇄ `/fr/tarifs`) via an explicit slug map — never a
fallback to the homepage. The cross-language suggestion is a dismissible banner,
and dismissal persists.

**N8 — French typography is checked, not assumed.** Narrow non-breaking space
before `: ; ! ?`, guillemets `« »`, accented capitals, sentence case in headings,
`1 250 000,50 XAF`, `15 %`, `20 août 2026`. `BRAND_GLOSSARY_FR_EN.md` §5 is the
full list. These are the details that decide whether the French reads native.

**N9 — Performance budgets.** LCP < 1.5s on Slow 4G / mid-range Android · CLS <
0.05 · INP < 200ms · **JS < 100 KB compressed** · page < 600 KB · Lighthouse ≥ 95
on all four categories, **measured in both languages** on a mobile profile.
Report the real numbers in `HANDOFF.md`.

**N10 — Accessibility.** WCAG AA in _both_ themes. Full keyboard operation,
visible focus (orange, ink variant), correct landmarks and heading order, one
`<h1>` per page, correct `lang` per tree, `prefers-reduced-motion` disables the
control-tower animation.

**N11 — Voice.** No superlatives, no claimed scale, no "trusted by", no logo
wall, no tagline in any lockup. `BRAND_GUIDELINES.md` §6 has the banned-word
list. If a sentence needs an adjective to work, the sentence is wrong.

**N12 — Invent nothing.** No placeholder testimonials, no fake logos, no made-up
metrics, no stock photos of people, no "500+ customers". Any fact not present in
the source documents goes to `HANDOFF.md` as OPEN and is left blank in the build.

**N13 — Do not touch `praxis-ls`.** No commits, no branches, no PRs. Read only.

---

## 4. Scope

**Homepage** — the fourteen sections of `LANDING_PAGE_GUIDE.md` §3, in order,
both languages.

**Five solution pages** — Freight forwarding & customs · Warehouse · Fleet ·
Finance & OHADA · Platform/IT. The guide gives the slugs; it does not give their
body copy. Draft each from the source documents (README module map, the
glossary, the homepage voice), keep it short, and **mark every page `DRAFT COPY —
needs review` in `HANDOFF.md`** so review knows copy approval is outstanding.
Same for the pages below.

**Supporting pages** — `/security` (heading: "Controls we operate" — the six
controls are in §3.10, plus the certification-roadmap line), `/standards` (the
three-row table from §12, and it must be trivial to update), `/pricing` (the
tier _shape_ from §13, no numbers), `/customers/smart-logistics` (from §3.3 only
— nothing beyond what is written there), `/about`, `/contact`, legal pages as
stubs.

**Demo form** — six fields (§4). It must be reachable and validate; wiring it to
a real destination is an OPEN question, so leave the submit handler behind one
clearly-named function.

**Product screenshots** — you cannot run `capture-screens.mjs`; it needs a live
seeded demo tenant. Use correctly-proportioned placeholders that carry the real
layout's aspect ratio and dominant tones, name them exactly as the script
outputs (`operation-file--dark--en.png`, etc.), and document the swap procedure
in `HANDOFF.md`. **Do not draw fake UI** — a hand-drawn "product" screenshot that
ships is worse than an obvious placeholder.

### Out of scope

A blog · a self-serve trial · a chatbot · testimonial carousels · per-module
pages · CMS integration · **any DNS change** · **any deployment**. Build it,
prove it, hand it over.

---

## 5. Stack

- **Astro 5**, `output: 'static'`, TypeScript strict.
- Astro's built-in i18n routing with explicit locale prefixes.
- **Plain modern CSS** over the brand tokens — nesting, custom properties,
  `@layer`. No CSS framework. Astro's scoped styles are enough.
- **Islands only where interaction is real**: theme toggle, language switcher,
  role tabs, the scroll-driven control tower, the form. Prefer vanilla TS; reach
  for a framework only if an island genuinely needs it, and justify it.
- The control tower is **inline SVG animated with CSS**, driven by
  `IntersectionObserver` / scroll. No animation library, no video, no Lottie.
  Static fallback under `prefers-reduced-motion`.
- Diagrams use the node-network language from `BRAND_GUIDELINES.md` §2: orange
  nodes, orange 1px connectors, slate structure. Hand-authored SVG, theme-aware
  via `currentColor` / tokens — never two exported bitmaps.
- Your own CI: build, typecheck, format, link-check, and Lighthouse CI against
  the budgets in N9.

---

## 6. Ask, do not invent

Log these in `HANDOFF.md` under OPEN and leave the surface blank:

- Anything about Smart Logistics beyond `LANDING_PAGE_GUIDE.md` §3.3 (they
  consented to be named **with sanitisation** — no volumes, no revenue, no
  client names).
- Any pricing figure.
- Team names, bios, photos, company address, registration details.
- The demo form's destination (inbox, CRM, calendar tool).
- The analytics choice.
- Whether the wordmark is `PRAXIS-LS` or `Praxis LS` in prose — this is a known
  open decision in `BRAND_GUIDELINES.md` §2. **Do not resolve it yourself.**
  Follow the table there and flag it.

---

## 7. Definition of done

Everything below is verified **by running it**, not by reading the code, and the
results go in `HANDOFF.md`:

- [ ] Every page renders in both languages, no English string on a French page
- [ ] Homepage copy matches §3 **exactly** — diff it, don't eyeball it
- [ ] French typography rules spot-checked on every page (N8)
- [ ] FR layout holds at 320px with strings ~25% longer than EN
- [ ] `hreflang` + canonical correct on every page; sitemap covers both trees
- [ ] Root 302 works; **no deep link redirects**; switcher preserves the page
- [ ] Dark default, persists, no flash of wrong theme; light fully designed
- [ ] Lighthouse ≥ 95 ×4, both languages, mobile profile — **numbers reported**
- [ ] JS payload measured and under 100 KB compressed — **number reported**
- [ ] AA verified in both themes with a real checker; keyboard-complete
- [ ] No raw hex outside the vendored token file (grep it and say so)
- [ ] No font named outside the three permitted families (grep it and say so)
- [ ] Placeholders obviously placeholders; swap procedure documented
- [ ] No invented facts, logos, numbers or testimonials anywhere

## 8. What to hand back

A `HANDOFF.md` at the repo root containing:

1. **Built** — what exists, page by page.
2. **Deviations** — everything you did differently from this brief or the guide,
   each with a reason. Cite the rule number.
3. **OPEN** — every question from §6, plus anything else blocking.
4. **Measurements** — Lighthouse per language, JS payload, LCP. Real numbers.
5. **Draft copy** — every page whose copy is drafted rather than specified.
6. **Disagreements** — anything in the spec you think is wrong. Say it plainly;
   this is wanted, not tolerated.

Then report the repository, the branch and the PR for review.
