# UI upgrade plan — the tenant public website

**Status:** drafted 2026-08-30. **Steps 1–3 of §10 are built** — the tokens, the
shared components, insights as their first consumer, and `Reveal` / `BgMap`
measured. §7.3–7.5 (services, tracking, the remaining pages) are open.

Two specs below were **wrong and are corrected in place** — §6.4 and §6.6. Both
were written before the code was read, and building them proved them wrong.

**Audience:** whoever picks up the next page. This is a build-from spec, not a
sketch — where it gives a measurement or a state, build that.

---

## 1. Why this document exists

`doc/PUBLIC_WEB_PLAN.md` studied smartls.cm for **behaviour and data**: the dead
backend, the four PHP endpoints, `data-counter="41850"`, the `data-tags` filter
mismatch, `onsubmit="return false;"`, the unkeyed Photon geocoder. That study was
right and it drove WS1–WS5.

It did not study their **design**, and the instruction was explicit: *"better also
means prettier."* The result was a site that is more correct than theirs and
plainer than theirs — the quote wizard shipped with four 44-pixel buttons where
theirs has four selection cards, no progress bar, no step counter, and a selected
state carried by a 1px border. Side by side, ours looked like the prototype.

This document closes that gap. It is written from their actual markup, extracted
from the six pages pasted into the build session, not from screenshots.

**Their source, for anyone who needs to look again.** The pages are in the build
session transcript (`~/.claude/projects/-home-user/…jsonl`) as six user messages
containing full HTML: home, services, tracking (`smart-track`), kaizen,
about, quote (`smart-quote`). `smartls.cm` is blocked by the egress proxy from
the build container, so re-fetching is not an option — extract from the
transcript.

Their CSS itself (`css/style.css`) was never pasted and is **not** available. What
follows is derived from class names, structure, inline styles, and rendered
screenshots. Where a value is inferred rather than read, it says so.

---

## 2. The improvement, and how a visitor sees it

The rest of this document is about adopting patterns their site already has. That
is the smaller half of the job and, on its own, it is the wrong thing to put in
front of a client. **They are paying for a rebuild. The rebuild has to be visibly
better, not quietly equal.**

So this section is the case, and — the part that matters — the **design work that
makes each advantage legible to somebody who will never see the code.** An
improvement a visitor cannot perceive is not an improvement they are getting
value from. Every row below has a "make it visible" item, and those items are
work, not commentary.

### 2.1 The page knows things. Theirs cannot.

This is the whole difference and everything else is a consequence of it. Their
site is a good marketing site with a dead backend: the headline statistics are
literals in the markup (`data-counter="41850"`), the five articles are `<div>`s,
the services are `<div>`s. Four PHP endpoints are the only living things on it.

Ours renders the ERP. That is not an abstract advantage — it is the reason every
number on the page is true this morning.

| What it is | Theirs | Ours |
|---|---|---|
| Headline statistics | typed into HTML | resolved per render from `dossier_visible` |
| Services offered | hand-written `<div>`s | the tenant's own `service_type` rows |
| Shipment tracking | a lookup with no progress model | milestone ledger, with a real percentage |
| Vacancies | hand-maintained | the vacancy operations opened; closes itself when filled |
| Article authors | names inside translation keys | staff records, with job titles |

**Make it visible:**

- **Date the numbers.** A stat band that reads *"41,850 CBM cleared · as at 30
  August"* makes a claim their site structurally cannot make, and the freshness
  line is the entire point. Build it into the stat block; do not let a tenant
  publish a number without one.
- **Draw the progress bar on tracking.** `progress.percent` has no equivalent in
  their payload. It is the most obvious "this is a real system" signal on the
  whole site and it should be the largest object on the tracking result.
- **Show a vacancy's age and closing date.** "Posted 6 days ago · closes 14
  September" says a human is behind it. A careers page whose listings are stale is
  the single most common failure of the genre, and ours cannot be stale.
- **Put the author's photograph and job title on an article.** We hold both.
  Theirs holds a string in a translation file.

### 2.2 It weighs a fraction of theirs

Measured, on the region's connections, this is felt before anything else is seen.

Every one of their six pages loads:

- Bootstrap 5.3.3 — CSS **and** the JS bundle
- Font Awesome 6.5.2, the entire icon set, to use a handful of glyphs
- **`html2pdf.bundle.min.js` — on all six pages**, including the five with no PDF
  feature anywhere on them
- two Google font families, one requested at nine weights
- 43–80 kB of HTML per document before any of that

Ours: **115.7 kB gzip, measured**, for the entire first paint — app, vendor and
CSS — against a 128 kB budget the build fails on. One hand-authored icon set
(`components/ui/icons.tsx` records why: an icon library is how you ship 40 kB of
geometry to use eleven glyphs). No CSS framework.

*Honest caveat: ours is a measured gzip total; theirs is a list of named
dependencies, because their assets cannot be fetched from the build container.
Do not quote a gzip figure for theirs without measuring it.*

**Make it visible:** it already is — the page arrives. Keep it that way. The
budget check is in the acceptance list of this document precisely so a design
pass cannot quietly spend the advantage.

### 2.3 It is genuinely bilingual. Theirs is a text swap.

Theirs is one URL with 87 `data-i18n` attributes on the home page and JavaScript
rewriting the text. Consequences: Google indexes one language, a French page
cannot be linked to or shared, and the French version has no address.

Ours is bilingual to the database column (`*_fr` / `*_en` on every content table),
serves **real URLs per language**, and emits `hreflang` alternates and a
self-referencing canonical.

**Make it visible:** the language toggle must change the URL, visibly. A reader
who switches language and can then send that link has been shown the difference
without being told about it.

### 2.4 It works when things go wrong

Theirs uses `alert()`. Its forms are `onsubmit="return false;"` with the real
submit on a button's `onclick`, so every `required` attribute on the page is
decorative and native validation never runs. There are no designed empty or error
states.

Ours has four designed presentation states on every list, panel and form
(`PUBLIC_WEB_PLAN.md` §3.3), inline per-field validation, a not-found that is
distinct from an empty, and an error that carries a request id support can
actually trace.

**Make it visible:** this is the one a client never sees in a demo and always sees
in production. Show them the states deliberately — a walk through an unknown
tracking reference, a rate-limited lookup and a failed load is a better
demonstration of build quality than any happy path.

### 2.5 It is theirs to run

Their site is a hardcoded blue-and-orange build; changing the brand is a
developer task. Ours re-tints from the tenant's branding row, and the content —
services, articles, pages, statistics — is edited by the tenant in the ERP they
already use. Nobody comes back to engineering to publish an article or retire a
service.

**Make it visible:** the editor is the deliverable here, not the page. A client
who publishes an article themselves during handover has understood the difference
permanently.

### 2.6 It can be reached by everyone

Radio groups with arrow-key navigation, one tab stop per group, `aria-current` on
the step they are on, visible focus rings, `prefers-reduced-motion` honoured, and
a page that renders with JavaScript disabled. Theirs puts `role="button"` and
`onclick` on `<div>`s.

**Make it visible:** it is invisible by design, and it is also the thing that
makes the site usable on a bad phone in bad light — which is most of the traffic
this site will get.

---

**How to use this section.** When the design work in §7 is done, each row above
should have a screen you can point at. If an advantage has no screen, it has not
been delivered to the client — it has only been delivered to the repository.

---

## 3. The rule that governs every change here

**Adopt their visual GRAMMAR. Do not adopt their palette, their fonts, their
copy, or their Bootstrap.**

Their site is a Bootstrap 5.3.3 + Font Awesome build with a hardcoded blue/orange
brand. Ours is a tokenised, tenant-brandable, 115 kB-first-paint app whose colours
come from the tenant's own branding row. Copying their hexes would break every
tenant that is not SmartLS, and pulling Font Awesome would add 40 kB of geometry
to use eleven glyphs (`components/ui/icons.tsx` documents why we hand-author).

So: take the *shapes* — the icon tile, the card with a description, the progress
bar, the eyebrow, the accent word — and build them from our tokens.

**Never inline a hex, a font, or a radius.** `doc/PUBLIC_WEB_PLAN.md` §3.4 already
says this and it is the rule most likely to be broken while chasing a look. Every
value below is expressed as a token for that reason.

---

## 4. Their design grammar, itemised

Eleven patterns repeat across all six pages. Ours uses four of them.

| # | Pattern | Their classes | Ours today |
|---|---|---|---|
| 1 | **Eyebrow above every heading**, uppercase + tracked, often with an icon | `__kicker`, `__eyebrow`, `about-page__eyebrow` | `.eyebrow` exists, used in heroes only |
| 2 | **Accent word in the title** — second word in the brand colour | `__h1-accent`, `__title-accent` | not used |
| 3 | **Badge pill above the h1** | `quote-portal__badge-pill` | not used |
| 4 | **Icon tile on cards** — glyph in a filled rounded square, colour variants | `__icon`, `__icon--orange`, `__icon--green`, `__svc-icon` | bare glyphs, no tile |
| 5 | **Card with title + description line** | `__svc-title` + `__svc-text`, `__list-title` + `__list-text` | titles only in several places |
| 6 | **Alternating section surfaces** | `__section` / `__section--surface` | one flat surface |
| 7 | **Progress bar** on multi-step flows | `quote-portal__progress-bar` | ✅ added (§7.1) |
| 8 | **Step counter chip** — "⚡ Step 1 of 4" | `quote-portal__step-counter` | ✅ added (§7.1) |
| 9 | **Three designed states per milestone**, distinct icon AND badge | `__t-ico--done/--active/--pending` | ✅ `MilestoneMarker` |
| 10 | **Decorative background map** behind hero bands | `quote-portal__bg-map`, `track-page__bg-map` | not used |
| 11 | **Scroll reveal** on nearly every block | `data-reveal` | not used |

Patterns 1–6, 10 and 11 are the work.

---

## 5. Token additions

Add to `public-web/src/index.css`. Nothing below introduces a new colour — each
is a role assembled from tokens that already exist.

```css
:root {
  /* The icon tile (§4 pattern 4). Two surfaces: resting and selected. */
  --tile-bg:        rgb(var(--ink) / 0.06);
  --tile-fg:        var(--muted-foreground);
  --tile-bg-active: var(--brand-orange);
  --tile-fg-active: var(--primary-foreground);

  /* Selection. Three signals at once — see §6.2 for why one is not enough. */
  --pick-ring: 0 0 0 1px var(--brand-orange),
               0 8px 24px -12px var(--brand-orange);

  /* Alternating band (§4 pattern 6). */
  --band-surface: var(--secondary);
}
```

The dark palette redefines `--ink`, `--secondary` and `--primary-foreground`
already, so every value above follows the theme with no second definition.

---

## 6. Component specs

Build these in `public-web/src/components/ui/` unless stated. Each is used by more
than one page; a page that hand-rolls one is the regression to catch in review.

### 6.1 `IconTile`

The glyph-in-a-square that carries most of the difference in perceived quality.

```
<IconTile icon={ShipIcon} active={boolean} size="md" />
```

- **md** (default): 44×44, `rounded-[calc(var(--radius)-2px)]`, glyph at 22px.
- **sm**: 36×36, glyph 18px. For list rows.
- **lg**: 56×56, glyph 28px. For section headers.
- Resting: `--tile-bg` / `--tile-fg`. Active: `--tile-bg-active` /
  `--tile-fg-active`.
- `transition-colors` at 200ms. `aria-hidden` always — the tile is never the
  accessible name, the adjacent text is.

### 6.2 `SelectCard`

A single choice among several, rendered as a card. **A radio group, not toggle
buttons.**

```
<SelectCard name="mode" value="SEA" checked icon={ShipIcon}
            title="By sea" description="Containers, FCL or LCL…" />
```

Structure: `<label>` wrapping a visually-hidden `<input type="radio" class="peer sr-only">`
and a visible `<span>` sibling. Focus ring is drawn on the card via
`peer-focus-visible`.

**Why radios rather than `aria-pressed` buttons** (our first version): a group
gives arrow-key navigation, one tab stop instead of four, and a screen reader that
says "2 of 4". Their markup gets this right and it was the thing worth copying.

**The selected state changes THREE things at once** — border colour, background
tint, and the icon tile filling. A selected state carried by border colour alone
is invisible on a phone in sunlight and invisible to anyone who does not see that
hue; that was the defect in the shipped version.

- Card: `rounded-[var(--radius)]`, `border`, `p-4`, `h-full`, flex column.
- Selected: `border-[var(--brand-orange)]`,
  `bg-[rgb(var(--brand-orange)/0.06)]`, `shadow-[var(--pick-ring)]`.
- Resting hover: `hover:border-[rgb(var(--ink)/0.25)]`,
  `hover:bg-[rgb(var(--ink)/0.03)]`.
- **The description is required, not optional.** A prospect who does not know
  whether "By road or rail" covers a Douala → N'Djamena run picks nothing, and
  picking nothing is where a form loses them.

### 6.3 `SectionHead`

Eyebrow + title + optional accent word + optional lead. Replaces the ad-hoc
heading blocks on every page.

```
<SectionHead eyebrow="Insights" icon={DocumentIcon}
             title="What we are" accent="learning"
             lead="…" align="center" />
```

- Eyebrow: existing `.eyebrow` recipe, optional 14px leading glyph, `gap-2`.
- Title: `.section-title` (or `.hero-title` in a hero).
- **Accent**: a `<span className="text-[var(--brand-orange)]">` inside the
  heading — one element, so the heading stays one accessible name.
- Lead: `max-w-measure`, `text-muted-foreground`, `mt-3`.
- `align`: `"left" | "center"`. Centre for hero and step headings, left for
  in-page sections.

### 6.4 `Band` — **DO NOT BUILD. It already exists.**

`Section` has taken `variant="plain" | "muted" | "dark"` all along, and `muted`
already paints the band surface. A separate `Band` would have been a second
wrapper around the same element, drifting from the first — which is the fault
this document tells a reviewer to catch.

What was actually missing was the token: `.band-muted` painted `var(--secondary)`
directly and now paints `var(--band-surface)`, so a tenant who wants a tinted
band changes one role rather than hunting for the recipe.

**Use `<Section variant="muted">`. Alternate down every page** — two adjacent
plain bands read as one long undifferentiated column, which is most of why a
page feels flat.

The same correction applies half-way to §6.3: `Section` already rendered an
eyebrow, a title and a lead, so `SectionHead` is the ONE implementation and
`Section` renders it internally. Heroes, which are not `Section`s, use it
directly.

### 6.5 `BadgePill`

The small capsule above an h1 (`quote-portal__badge-pill`). Border, `rounded-full`,
`px-3 py-1`, `.eyebrow` type, `text-[var(--brand-orange)]`. One per page maximum
— it marks the page's *kind*, and a page with three of them marks nothing.

### 6.6 `Reveal`

Scroll-reveal wrapper (§4 pattern 11) — the cheapest perceived-quality win on the
list.

- `IntersectionObserver`, one shared observer, `threshold: 0.12`, unobserve after
  firing. **Never re-animate**: an element that fades on every scroll-past is a
  page that feels broken.
- From `opacity: 0; translateY(12px)` to settled, 420ms, `var(--ease)`.
- Optional `delay` prop, capped at 3 steps of 60ms for a grid row. More than
  three and the last card arrives after the reader has looked away.
- **`prefers-reduced-motion: reduce` renders the settled state immediately** —
  not a shorter animation, none. Non-negotiable; `Skeleton` already sets this
  precedent.
- ~~Must render its children on first paint for a crawler and with JS disabled.~~
  **Corrected.** That requirement is meaningless in this app and satisfying it
  would have cost a flash of content on every block. `public-web` is
  client-rendered — `public-head.js` says so in as many words, *"the body is
  still empty, so this is not SSR and does not pretend to be"* — so with
  JavaScript off nothing renders at all and there is no content for a hidden
  class to hide. What a crawler reads is the `<head>`, built on the server and
  untouched by any of this.

  What DOES matter, and is built: an old browser with no `IntersectionObserver`
  renders the settled state immediately rather than a page of invisible blocks.

### 6.7 `BgMap`

The decorative map behind a hero band (§4 pattern 10). Inline SVG at ~4% opacity
of `--ink`, `aria-hidden`, `pointer-events-none`, `object-cover`.

**Inline SVG, not an image request.** A decorative background that costs a network
round trip on first paint is a decorative background that arrives after the hero
it was meant to decorate. Keep it under 3 kB; simplify the path until it is.

---

## 7. Per-page work

### 7.1 Quote wizard — ✅ DONE (the worked example)

`components/site/quote-wizard.tsx`, `components/ui/stepper.tsx`.

- Mode selector rebuilt as a radio-group card set with icon tiles and
  descriptions (`site.quote.mode*Hint`, both languages).
- Progress bar in `Stepper`, `aria-hidden` — the counter and `aria-current`
  already state the same fact, and a third announcement is noise.
- Step counter chip with a bolt glyph, `hidden md:inline-flex`.
- Step heading centred, `font-display text-h3`, lead at `max-w-measure`.
- Continue carries a right arrow.

**Still open on this page:** the badge pill and accent word on the standalone
`/quote` hero, and `BgMap` behind it.

### 7.2 Insights index — highest value, newest code

`features/insights/insights-page.tsx`.

- `SectionHead` in the hero with `BadgePill` + accent word.
- Cards: add an `IconTile` fallback where an article has no cover, so a coverless
  card is not a bare text block beside three illustrated ones.
- `Reveal` on the grid, staggered by column.
- Their hero carries the search and filters inside the band. **Move the filter bar
  into the hero** — it is the page's primary control and currently sits below the
  fold on a phone.
- Do **not** copy their search box until the API has search. A search that filters
  the current page of nine, client-side, is the bug their site has.

### 7.3 Services

`features/services/services-page.tsx`.

- Pillars become `Band surface="muted"` alternating with plain.
- `SectionHead` per pillar with the pillar's `icon` in an `IconTile`.
- Service cards get `__card-top`-style icon tiles and their existing description
  line promoted to always-visible.

### 7.4 Tracking

`features/tracking/track-page.tsx`.

- `MilestoneMarker` already does three designed states — **keep it**, and give the
  CURRENT state a motion glyph the way theirs does (`fa-truck-moving`). Ours uses
  a clock, which reads as "waiting" rather than "moving".
- `SectionHead` + accent word on the hero.
- `BgMap` behind the hero band, as theirs has.

### 7.5 Success stories / careers / about

- `SectionHead` and `Band` alternation throughout.
- Careers: vacancy cards get an `IconTile` per department.
- These pages are structurally fine; this is a typography-and-rhythm pass.

---

## 8. What NOT to copy

Recorded so nobody re-imports a fault while chasing the look:

1. **Their filter bar.** Four hardcoded buttons over six tags — two articles
   unreachable. Ours derives the bar from the tags in use.
2. **Their `onsubmit="return false;"`** with the real submit on a button's
   `onclick`. Every `required` on their page is decorative.
3. **Their mandatory attachment.** Loses every prospect still shopping.
4. **Their browser-side Photon geocoder** that never submits the coordinates.
5. **`kaizen_by_prefix_article`** — author names inside translation keys.
6. **Bootstrap and Font Awesome.** See §3.
7. **Their `.shake-btn` error animation.** Shaking a control at somebody who has
   just made a mistake is a punishment, not a hint; our inline field errors say
   what to fix.

---

## 9. Acceptance

A page is done when:

- Every heading block is a `SectionHead`; no page hand-rolls eyebrow + title.
- Every card that offers a choice is a `SelectCard`, with a description.
- Every glyph that sits beside a heading or leads a card is an `IconTile`.
- Bands alternate; no two adjacent plain bands.
- `Reveal` wraps the page's major blocks, honours `prefers-reduced-motion`, and
  the page renders fully with JavaScript disabled.
- **No new raw hex, font-family or radius literal** — `npm run lint` plus a read
  of the diff.
- `npm run check:i18n` passes: every new string in both languages, French
  typography clean.
- `npm run check:bundle` passes. First paint is at **115.7 kB of a 128 kB
  budget** as of this writing; `Reveal` and `BgMap` are the two items here with
  real weight, and they must be measured, not assumed.
- The four presentation states of `PUBLIC_WEB_PLAN.md` §3.3 still render — a
  design pass that only styles the happy path is half a design pass.

---

## 10. Order

1. Tokens (§5) and `IconTile`, `SectionHead`, `Band`, `BadgePill` — no page
   changes, all four land together.
2. Insights (§7.2) as the first consumer, because it is newest and has no legacy
   markup to unpick.
3. `Reveal` and `BgMap`, measured against the bundle budget before adopting.
4. Services, tracking (§7.3–7.4).
5. The remaining pages (§7.5).

**Steps 1–3 are built.** The budget gate was honoured by measuring at each step
rather than by waiting for a merge:

| | first paint | of 128 kB |
|---|---|---|
| baseline | 116.0 kB | 91% |
| after steps 1–2 | 116.4 kB | 91% |
| after step 3 | 116.6 kB | 91% |

`Reveal` and `BgMap` cost **0.2 kB** on first paint, because both are used only
by lazily-loaded routes — only their CSS utilities reach the entry chunk. That is
the number the gate existed to find, and it clears comfortably. **Re-measure
before adopting either on a page in the shell** (header, footer), where they
would land in the entry chunk instead.
