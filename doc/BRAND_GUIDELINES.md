# Praxis LS — Brand Guidelines

**Status:** adopted 2026-08-20. Supersedes the logo presentation sheet on two
points (the tagline, and the palette's fourth colour).
**Code:** `packages/brand/` is the executable half of this document. Where the
two disagree, **the code wins and this file is a bug** — the same rule
`doc/FRONTEND_GUIDE.md` runs on.

---

## 0. The decisions this is built on

Twenty questions were put and answered. The five that shape everything else:

|               | Decision                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------- |
| **Category**  | The OHADA-native ERP for logistics operators. Not "global ERP".                           |
| **Lockup**    | Mark + wordmark. **No tagline.**                                                          |
| **Mark**      | Two-part system — the cube is structure, the node network is a reusable graphic language. |
| **Palette**   | Three colours. The blue is retired from brand.                                            |
| **Expansion** | Never rebrand. Elastic brand, specific campaign.                                          |

---

## 1. Positioning

> **Praxis LS is the ERP that speaks OHADA — one system for a logistics
> operator's files, warehouses, fleet and accounting.**

Three claims, in the order they earn attention:

1. **Every operation posts itself to a SYSCOHADA-compliant ledger.** The moat.
   No global vendor will build it; no local competitor can.
2. **One dossier, from quotation to closed books.** The demo — the screen that
   makes an operations director lean in.
3. **Intelligence inside a governed system.** The accelerant, and never the
   opening line.

### The elasticity rule

The brand names no accounting standard. **The logo makes no claim; the H1 makes
no claim; the campaign does.** OHADA lives in the sub-line, the proof points,
the solution pages and the `/standards` page — all a pull request to change.

That is what makes IFRS an _announcement_ rather than a rebrand, and it is why
the tagline came out of the lockup. A claim welded into a logo has to be redrawn
every time the company grows past it.

| Standard          | Status                                       |
| ----------------- | -------------------------------------------- |
| OHADA / SYSCOHADA | Live — 17 member states, DSF, liasse fiscale |
| IFRS              | In development                               |
| US GAAP           | Planned                                      |

Publish that table. Keep it honest. A CFO reading it sees a company with a
roadmap and the nerve to date it.

### Geography

**Cameroon is the beachhead, never the brand.** OHADA is seventeen states; XAF
and XOF are both euro-pegged and the accounting standard is identical across
all of them. Say "OHADA's 17 member states". No Cameroonian flags, no Douala
skyline, no national colours anywhere in the system. Douala is a case study.

### Audience order

**DG → Operations → Finance.** The DG signs, but in a Cameroonian logistics
firm the Operations Manager is heard before the DAF, and the page must respect
that. The DAF closes the deal on the ledger and the DSF — third in sequence, and
decisive.

---

## 2. The mark

### Construction

An isometric cube of three slate faces, overlaid with an orange node network —
a central node, radiating spokes, terminal dots. It is a good mark because it is
literally the product: **a container, and the connections that route it.**

### The two-part system

| Element              | Means                             | Used for                                                                                                                                                            |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The cube**         | structure, containment, the file  | the full lockup, the app icon, section frames, large-format watermarks                                                                                              |
| **The node network** | intelligence, routing, connection | **a reusable graphic language** — milestone chains, entity relationships, the event engine, empty states, loading states, section dividers, every technical diagram |

The node network is the most ownable asset in the brand and it must not stay
locked inside the logo. Every diagram on the site, in the docs and in the deck
is drawn in it: **orange nodes, orange 1px connectors, slate structure.** Do that
consistently and a Praxis diagram is recognisable at a glance with the logo
cropped off — which is the whole return on having a mark like this.

### The glyph

The node cluster alone, no cube, is the **favicon, app icon and avatar**. It
survives 16px where the full mark does not.

### Rules

- **Clear space** on all four sides = the width of one cube face.
- **Minimum width** 32px for the horizontal lockup; below that, glyph only.
- The mark is **slate + orange on carbon** (primary) or **slate + orange on
  white** (secondary). No other colourway exists.
- Never: recolour it to a tenant's palette · rotate it · add a gradient, bevel,
  shadow or outline · stretch it · place it on a photograph without a solid
  plate · redraw the wordmark in a system font.

### Naming

| Context                     | Form                                                                   |
| --------------------------- | ---------------------------------------------------------------------- |
| The drawn wordmark          | `PRAXIS-LS`                                                            |
| Running text, all languages | **Praxis LS**                                                          |
| Legal / contracts / footer  | JBS Praxis LLC                                                         |
| Code, packages, repos       | `praxis-ls`, `@praxis/*`                                               |
| `SmartLS`                   | **Legacy. Internal only.** Never appears on a customer-facing surface. |

> **Open — confirm.** The sheet draws `PRAXIS-LS`; the README writes `Praxis LS`.
> The rule above keeps the hyphen as a drawn device in the mark and drops it in
> prose. If you would rather they match exactly, the wordmark is the cheaper of
> the two to change and this table should be updated before any asset is cut.

---

## 3. Colour

Values live in `packages/brand/index.js` and `tokens.css`. This section is the
reasoning; that is the source of truth.

### Three colours

|                    | Hex       | Role                                             |
| ------------------ | --------- | ------------------------------------------------ |
| **Carbon Black**   | `#0A0A0A` | the ground                                       |
| **Slate Gray**     | `#7E8286` | structure — the mark, rules, diagram scaffolding |
| **Optical Orange** | `#FF5A00` | the single accent                                |

### The 5% rule

**Orange is a scalpel.** On any given screen it should touch roughly one
twentieth of the pixels: the primary CTA, the mark, one number per section, the
active nav item, the node connectors in a diagram. Carbon and slate do all the
rest of the work.

Generous orange reads as a cheap template. Restrained orange on a carbon ground
reads as an instrument — and an instrument is what you are selling to somebody
whose ledger you want to run.

### The blue is not brand

`#1C9BD7` and its family (`#0C4A7A`, `#34AAE2`, `#1884C4`) had become a de-facto
second brand colour: `--brand-2` in the platform console, plus every link, focus
ring and `.btn-link`, over a background gradient running orange _and_ blue. The
console was a blue product with orange accents while the logo declared no blue
at all.

It is **demoted to semantics**. It survives as `status.info*` only, re-derived
to pass as text. Console links and focus rings become orange, in the `ink`
variant so they clear AA.

### Accessibility, measured

These are the numbers that decide the rules, not opinions about them:

| Combination                       | Ratio      |                                              |
| --------------------------------- | ---------- | -------------------------------------------- |
| `#FF5A00` text on white           | **3.13:1** | fails AA — never do this                     |
| `#C74600` text on white           | 4.88:1     | the light-theme orange ink                   |
| `#FF5A00` text on carbon          | 6.33:1     | passes as-is — no dark ink needed            |
| **White label on `#FF5A00` fill** | **3.13:1** | **fails AA — this is the trap**              |
| Carbon label on `#FF5A00` fill    | 6.33:1     | the correct button treatment                 |
| `#7E8286` text on white           | 3.87:1     | fails — slate is graphics on light, not type |

Two rules fall straight out:

1. **Orange type is `--brand-ink-orange`, never `--brand-orange`.**
2. **Text on an orange fill is carbon, never white.** Every orange button in the
   product is currently white-labelled; on the new orange that is a WCAG failure
   at body size. The platform console already had this right.

The asymmetry — orange passing as text on dark but not on light — is a real
property of the colour, and it is a large part of why dark is the primary
expression rather than a preference.

---

## 4. Typography

| Role      | Face               | Job                                      |
| --------- | ------------------ | ---------------------------------------- |
| Display   | **IBM Plex Sans**  | headings, hero, eyebrows, console chrome |
| Body / UI | **Inter**          | paragraphs, interface, dense tables      |
| Mono      | **JetBrains Mono** | **every figure that must align**         |

All three already ship in `client/src/lib/fonts.ts`, self-hosted under OFL /
Apache-2.0. `scripts/check-fonts.mjs` fails the build on any family named
outside that library — including anything added here. **Montserrat comes out of
the platform console.**

**Why IBM Plex Sans.** The wordmark is wide, geometric and flat-terminalled — a
drawn object, not a typeface, and it stays that way. Plex is the shipped face
closest to its engineered register, so headings read as continuous with the mark
instead of merely adjacent to it. Commissioning a bespoke display face from the
wordmark is a Series-A purchase, not a pre-launch one.

**Why mono is non-negotiable.** Invoice totals, GL balances, container numbers,
tenant ids and dates go in JetBrains Mono with `font-variant-numeric:
tabular-nums`. In an accounting product ragged decimals are not a design
detail — a DAF reading a screenshot with misaligned columns has already decided
about you, and they are not wrong to.

### Scale

Display sizes use `--brand-tracking-display` (`-0.015em`); tightening is what
keeps large Plex from looking soft. Eyebrows are uppercase at
`--brand-tracking-eyebrow` (`0.12em`), echoing the wordmark at a fraction of its
strength. Body copy is never tracked.

| Token        | Size / line | Use                              |
| ------------ | ----------- | -------------------------------- |
| `display-xl` | 60/64       | hero H1 only, one per page       |
| `display-l`  | 40/48       | section H2                       |
| `display-m`  | 28/36       | card and sub-section H3          |
| `body-l`     | 18/30       | hero sub-line, section intros    |
| `body`       | 16/26       | everything else                  |
| `caption`    | 13/20       | labels, footnotes, table headers |
| `eyebrow`    | 12/16       | uppercase, tracked, slate ink    |

---

## 5. Theme

**Dark is the primary expression.** It is the brand sheet's own call, it is
where the mark is strongest, and — per §3 — it is where the orange is legible
as type without compromise.

- `praxisls.com` **opens dark.** A toggle sits in the header; the choice is
  persisted; it is never overridden afterwards.
- Light mode is **fully designed, not a filter.** Procurement prints. Older
  enterprise buyers in the region read light. A light mode that is visibly an
  afterthought tells them which of them you were thinking about.
- Both themes ship AA-clean. There is no third "auto" state in the UI on
  praxisls.com — the toggle is two states, and `prefers-color-scheme` only
  decides pages that have no controller (status page, an emailed preview).

---

## 6. Voice

Precise, plain, unhurried. Short sentences. Concrete nouns. The register of an
engineer explaining a system they built and understand — never a vendor
performing enthusiasm.

**We say:** what the system does · what it posts · which standard · which
country · what is live and what is not.
**We never say:** world-class · cutting-edge · revolutionary · seamless ·
one-stop · leverage · unlock · empower · "global leader" · any superlative we
cannot put a number behind.

**We do not claim scale.** No "trusted by hundreds". No logo wall of unknowns.
One named customer with real numbers outperforms twenty logos, and padding the
strip is the fastest way to look small to the exact buyer you want.

Adjectives are a debt: "intelligent" in a headline is a word anyone can type; in
section 9, with a working assistant behind it, it is a demonstration. Move
claims down the page until they have evidence standing under them.

---

## 7. Application by surface

| Surface                                                     | Layer      | Rules                                                                                                                                              |
| ----------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `praxisls.com`                                              | **Brand**  | Dark default. Full system. No tenant anything.                                                                                                     |
| `admin.praxisls.com` (platform console)                     | **Brand**  | Adopts `tokens.css`. Blue out, Montserrat out, orange links and rings in. You demo this to prospects — it is the worst surface to be off-brand on. |
| Status page, docs, changelog                                | **Brand**  | Same tokens, minimal chrome.                                                                                                                       |
| Mail from `praxisls.com`                                    | **Brand**  | `no-reply@` / `support@` shells carry Praxis brand.                                                                                                |
| Splash screen / PWA install chrome                          | **Brand**  | Currently `#9aa8a6` and `#101418`, which are in no palette at all. Must come from `packages/brand`.                                                |
| **Tenant workspace**                                        | **Tenant** | Their logo, their colour, their fonts. Praxis appears only in the footer line.                                                                     |
| **Tenant login page** (`features/landing/landing-page.tsx`) | **Tenant** | Theirs, not ours. It should feel like family with praxisls.com — same spatial rhythm, same restraint — while wearing the tenant's palette.         |
| Tenant documents & PDFs                                     | **Tenant** | Their branding, `Powered by JBS Praxis LLC` footer.                                                                                                |

The footer line stays subtle and stays present. It is the only co-branding in
the system, and a tenant who paid for white-label should never find more.

---

## 8. Checklist before anything ships

- [ ] No raw hex outside `packages/brand/` and `client/src/index.css`
- [ ] No blue used as brand — only `status.info*`
- [ ] Orange type uses the `ink` variant; orange fills carry **carbon** labels
- [ ] No font named outside `client/src/lib/fonts.ts` (`npm run check:fonts`)
- [ ] Figures in mono with `tabular-nums`
- [ ] Both themes AA-clean; keyboard reachable throughout
- [ ] No tagline in any lockup
- [ ] No claim of scale, no superlative without a number
- [ ] Cameroon appears only inside a case study, never in positioning
