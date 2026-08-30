# UI upgrade plan — the tenant public website

**Status:** drafted 2026-08-30. The quote wizard is done as the worked example
(§6.1); everything else is open.

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

## 2. The rule that governs every change here

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

## 3. Their design grammar, itemised

Eleven patterns repeat across all six pages. Ours uses four of them.

| # | Pattern | Their classes | Ours today |
|---|---|---|---|
| 1 | **Eyebrow above every heading**, uppercase + tracked, often with an icon | `__kicker`, `__eyebrow`, `about-page__eyebrow` | `.eyebrow` exists, used in heroes only |
| 2 | **Accent word in the title** — second word in the brand colour | `__h1-accent`, `__title-accent` | not used |
| 3 | **Badge pill above the h1** | `quote-portal__badge-pill` | not used |
| 4 | **Icon tile on cards** — glyph in a filled rounded square, colour variants | `__icon`, `__icon--orange`, `__icon--green`, `__svc-icon` | bare glyphs, no tile |
| 5 | **Card with title + description line** | `__svc-title` + `__svc-text`, `__list-title` + `__list-text` | titles only in several places |
| 6 | **Alternating section surfaces** | `__section` / `__section--surface` | one flat surface |
| 7 | **Progress bar** on multi-step flows | `quote-portal__progress-bar` | ✅ added (§6.1) |
| 8 | **Step counter chip** — "⚡ Step 1 of 4" | `quote-portal__step-counter` | ✅ added (§6.1) |
| 9 | **Three designed states per milestone**, distinct icon AND badge | `__t-ico--done/--active/--pending` | ✅ `MilestoneMarker` |
| 10 | **Decorative background map** behind hero bands | `quote-portal__bg-map`, `track-page__bg-map` | not used |
| 11 | **Scroll reveal** on nearly every block | `data-reveal` | not used |

Patterns 1–6, 10 and 11 are the work.

---

## 4. Token additions

Add to `public-web/src/index.css`. Nothing below introduces a new colour — each
is a role assembled from tokens that already exist.

```css
:root {
  /* The icon tile (§3 pattern 4). Two surfaces: resting and selected. */
  --tile-bg:        rgb(var(--ink) / 0.06);
  --tile-fg:        var(--muted-foreground);
  --tile-bg-active: var(--brand-orange);
  --tile-fg-active: var(--primary-foreground);

  /* Selection. Three signals at once — see §5.2 for why one is not enough. */
  --pick-ring: 0 0 0 1px var(--brand-orange),
               0 8px 24px -12px var(--brand-orange);

  /* Alternating band (§3 pattern 6). */
  --band-surface: var(--secondary);
}
```

The dark palette redefines `--ink`, `--secondary` and `--primary-foreground`
already, so every value above follows the theme with no second definition.

---

## 5. Component specs

Build these in `public-web/src/components/ui/` unless stated. Each is used by more
than one page; a page that hand-rolls one is the regression to catch in review.

### 5.1 `IconTile`

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

### 5.2 `SelectCard`

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

### 5.3 `SectionHead`

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

### 5.4 `Band`

```
<Band surface="plain" | "muted" | "hero">
```

Wraps `<Section>`. `muted` paints `--band-surface`. **Alternate down every
page** — two adjacent `plain` bands read as one long undifferentiated column,
which is most of why our pages feel flat.

### 5.5 `BadgePill`

The small capsule above an h1 (`quote-portal__badge-pill`). Border, `rounded-full`,
`px-3 py-1`, `.eyebrow` type, `text-[var(--brand-orange)]`. One per page maximum
— it marks the page's *kind*, and a page with three of them marks nothing.

### 5.6 `Reveal`

Scroll-reveal wrapper (§3 pattern 11) — the cheapest perceived-quality win on the
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
- Must render its children on first paint for a crawler and with JS disabled —
  the animation is a class applied after mount, never a mount gate.

### 5.7 `BgMap`

The decorative map behind a hero band (§3 pattern 10). Inline SVG at ~4% opacity
of `--ink`, `aria-hidden`, `pointer-events-none`, `object-cover`.

**Inline SVG, not an image request.** A decorative background that costs a network
round trip on first paint is a decorative background that arrives after the hero
it was meant to decorate. Keep it under 3 kB; simplify the path until it is.

---

## 6. Per-page work

### 6.1 Quote wizard — ✅ DONE (the worked example)

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

### 6.2 Insights index — highest value, newest code

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

### 6.3 Services

`features/services/services-page.tsx`.

- Pillars become `Band surface="muted"` alternating with plain.
- `SectionHead` per pillar with the pillar's `icon` in an `IconTile`.
- Service cards get `__card-top`-style icon tiles and their existing description
  line promoted to always-visible.

### 6.4 Tracking

`features/tracking/track-page.tsx`.

- `MilestoneMarker` already does three designed states — **keep it**, and give the
  CURRENT state a motion glyph the way theirs does (`fa-truck-moving`). Ours uses
  a clock, which reads as "waiting" rather than "moving".
- `SectionHead` + accent word on the hero.
- `BgMap` behind the hero band, as theirs has.

### 6.5 Success stories / careers / about

- `SectionHead` and `Band` alternation throughout.
- Careers: vacancy cards get an `IconTile` per department.
- These pages are structurally fine; this is a typography-and-rhythm pass.

---

## 7. What NOT to copy

Recorded so nobody re-imports a fault while chasing the look:

1. **Their filter bar.** Four hardcoded buttons over six tags — two articles
   unreachable. Ours derives the bar from the tags in use.
2. **Their `onsubmit="return false;"`** with the real submit on a button's
   `onclick`. Every `required` on their page is decorative.
3. **Their mandatory attachment.** Loses every prospect still shopping.
4. **Their browser-side Photon geocoder** that never submits the coordinates.
5. **`kaizen_by_prefix_article`** — author names inside translation keys.
6. **Bootstrap and Font Awesome.** See §2.
7. **Their `.shake-btn` error animation.** Shaking a control at somebody who has
   just made a mistake is a punishment, not a hint; our inline field errors say
   what to fix.

---

## 8. Acceptance

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

## 9. Order

1. Tokens (§4) and `IconTile`, `SectionHead`, `Band`, `BadgePill` — no page
   changes, all four land together.
2. Insights (§6.2) as the first consumer, because it is newest and has no legacy
   markup to unpick.
3. `Reveal` and `BgMap`, measured against the bundle budget before adopting.
4. Services, tracking (§6.3–6.4).
5. The remaining pages (§6.5).

Steps 1 and 2 are one PR. Do not start step 3 before the budget has been checked
with steps 1–2 merged.
