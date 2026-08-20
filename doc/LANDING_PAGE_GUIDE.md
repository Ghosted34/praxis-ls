# praxisls.com — Site Guide

The build specification for the public marketing site: what it says, in which
language, in what order, on what stack.

**Companions:** `doc/BRAND_GUIDELINES.md` (the brand system) ·
`doc/BRAND_GLOSSARY_FR_EN.md` (every term, both languages) · `packages/brand/`
(the tokens, executable).

**This is not `client/src/features/landing/landing-page.tsx`.** That file is the
tenant's pre-auth screen at `/login`, branded per tenant. Different audience,
different owner, different codebase. They should feel like family — same spatial
rhythm, same restraint — while wearing different clothes.

---

## 1. The decisions

| #   | Decision                                                                          |
| --- | --------------------------------------------------------------------------------- |
| 1   | Category: the OHADA-native ERP for logistics operators                            |
| 2   | Audience order: **DG → Operations → Finance**                                     |
| 3   | Headline: definitional, outcome in the sub-line                                   |
| 4   | Hero: real product UI **and** an animated control tower                           |
| 5   | Language: explicit `/fr` `/en` prefixes, visible switcher, no forced redirect     |
| 6   | French is the **source** language; English is transcreated from it                |
| 7   | Dark default, persisted; light fully designed                                     |
| 8   | Brand: three colours, derived inks, IBM Plex / Inter / JetBrains Mono             |
| 9   | A real `/security` page — "controls we operate", not certifications we lack       |
| 10  | Narrative: OHADA ledger (moat) → control tower (demo) → intelligence (accelerant) |
| 11  | One named case study — Smart Logistics, sanitised. No logo wall.                  |
| 12  | Pricing: publish the shape, not the number                                        |
| 13  | One primary CTA: **Book a demo**                                                  |
| 14  | Landing + 5 solution pages + Security, Standards, Pricing, Customers, About       |
| 15  | Separate static site (Astro) at the apex, deployed independently                  |

---

## 2. URL map

Slugs are **localised**. A French URL that reads `/fr/solutions/freight-forwarding`
tells the reader the French is a skin over an English site — the same tell as a
mistranslated heading, and just as avoidable.

| EN                                         | FR                                                     |
| ------------------------------------------ | ------------------------------------------------------ |
| `/en/`                                     | `/fr/`                                                 |
| `/en/solutions/freight-forwarding-customs` | `/fr/solutions/transit-douane`                         |
| `/en/solutions/warehouse`                  | `/fr/solutions/entrepot`                               |
| `/en/solutions/fleet`                      | `/fr/solutions/flotte`                                 |
| `/en/solutions/finance-ohada`              | `/fr/solutions/comptabilite-ohada`                     |
| `/en/solutions/platform-it`                | `/fr/solutions/plateforme-dsi`                         |
| `/en/security`                             | `/fr/securite`                                         |
| `/en/standards`                            | `/fr/normes`                                           |
| `/en/pricing`                              | `/fr/tarifs`                                           |
| `/en/customers/smart-logistics`            | `/fr/references/smart-logistics`                       |
| `/en/about`                                | `/fr/a-propos`                                         |
| `/en/contact`                              | `/fr/contact`                                          |
| `/en/legal/privacy` · `/terms`             | `/fr/mentions-legales/confidentialite` · `/conditions` |

### The root, and the one redirect

Every content URL is explicit and is **never** redirected — that is what keeps
links shareable and lets Google crawl both trees. The single exception is the
bare root:

- `praxisls.com/` → **302** to `/fr/` or `/en/` on `Accept-Language`, defaulting
  to `/en/` when the header is absent or ambiguous.
- `hreflang`: `fr`, `en`, and `x-default` → `/en/`.
- Deep links are sacred. `praxisls.com/en/pricing` serves English to a French
  browser, always.
- First-time visitors whose `Accept-Language` disagrees with the page they
  landed on get a **dismissible banner** — "Cette page est disponible en
  français" — never a redirect. Dismissal persists.
- The switcher preserves the current path (`/en/pricing` ⇄ `/fr/tarifs`) via an
  explicit slug map. It must never dump the reader on the homepage.

---

## 3. The homepage, section by section

Each section below gives the layout, the English copy and the French copy.
**French was written first**; English is its peer, not its parent. Both are
final copy, not placeholders — edit them, don't regenerate them.

---

### 1 · Header

Sticky, 64px, `--brand-bg` at 88% with a backdrop blur, 1px `--brand-line` on scroll.

`[PRAXIS-LS mark]  Product · Solutions · Security · Pricing · About     [FR|EN] [◐] [Book a demo]`

| EN                                               | FR                                                 |
| ------------------------------------------------ | -------------------------------------------------- |
| Product · Solutions · Security · Pricing · About | Produit · Solutions · Sécurité · Tarifs · À propos |
| Book a demo                                      | Demander une démo                                  |

Five items, no dropdown on mobile beyond a single sheet. The CTA is the only
orange thing in the header.

---

### 2 · Hero

Full-bleed carbon. Left: eyebrow, H1, sub, two CTAs. Right: the real product UI,
dark mode, rotated 0° — no perspective mockup, no floating browser chrome. It is
software; show software.

**Eyebrow**

> EN — `OHADA-NATIVE ERP FOR LOGISTICS OPERATORS`
> FR — `ERP NATIF OHADA POUR LES OPÉRATEURS LOGISTIQUES`

**H1**

> EN — **One system for your operation files, your warehouses, your fleet — and the accounting they all post to.**
> FR — **Un seul système pour vos dossiers d'exploitation, vos entrepôts, votre flotte — et la comptabilité où tout s'impute.**

**Sub-line**

> EN — Praxis LS runs the whole operation on a native OHADA/SYSCOHADA ledger. Every transit file, every delivery, every invoice posts itself. Month-end becomes a review, not a reconstruction.
> FR — Praxis LS pilote toute l'exploitation sur un grand livre nativement OHADA/SYSCOHADA. Chaque dossier de transit, chaque livraison, chaque facture s'impute d'elle-même. La clôture devient une relecture, pas une reconstitution.

**CTAs**

> EN — `Book a demo` · `See how it works`
> FR — `Demander une démo` · `Voir comment ça marche`

Note what the H1 does **not** contain: "intelligent", "global", "leading",
"all-in-one". The em-dash clause is the whole argument — _the accounting they
all post to_ is the sentence no competitor can copy.

---

### 3 · Credibility strip

One row on `--brand-surface`. Facts only. **No logo wall.**

> EN — Live at **Smart Logistics**, Cameroon — an 84-table legacy system replaced end to end, accounting included.
> FR — En production chez **Smart Logistics**, Cameroun — un système hérité de 84 tables remplacé de bout en bout, comptabilité comprise.

`OHADA · 17 member states` — `70 modules` — `One dedicated database per customer`
`OHADA · 17 États membres` — `70 modules` — `Une base de données dédiée par client`

Smart Logistics has consented to be named with light sanitisation: **their
logo, their name, their sector — no operational volumes, no revenue, no client
names.** Everything above describes _our_ migration, which is ours to tell.

---

### 4 · The problem

Centred, narrow measure (60ch), large type, generous space. Their words, not ours.

> EN — **You run the operation in one system and the accounts in another.**
> The file closes in March. The entry is posted in June, by someone reading a
> spreadsheet and a WhatsApp thread. By the time the DSF is assembled, nobody can
> say which margin was real.
>
> FR — **Vous pilotez l'exploitation dans un système et la comptabilité dans un autre.**
> Le dossier se clôture en mars. L'écriture est passée en juin, par quelqu'un qui
> relit un tableur et un fil WhatsApp. Au moment de monter la DSF, plus personne
> ne sait quelle marge était la vraie.

---

### 5 · The spine — the moat

The most important section on the site. Diagram drawn in the **node network**:
orange nodes, orange 1px connectors, slate structure.

`Operation file → milestone → costing → invoice → journal entry → general ledger → DSF`
`Dossier d'exploitation → jalon → chiffrage → facture → écriture → grand livre → DSF`

> EN — **Every operation posts itself.**
> Praxis LS is not an operations tool with an accounting export. The ledger is
> the spine: a milestone, a disbursement, a delivery note and an invoice each
> carry their own posting rules, in SYSCOHADA, at the moment they happen. The
> chart of accounts, the tax engine, the journals and the statements are one
> system with the operation — not a monthly negotiation with it.
>
> FR — **Chaque opération s'impute d'elle-même.**
> Praxis LS n'est pas un outil d'exploitation doté d'un export comptable. Le
> grand livre en est la colonne vertébrale : un jalon, un débours, un bon de
> livraison, une facture — chacun porte ses propres règles d'imputation, en
> SYSCOHADA, au moment où il se produit. Plan comptable, moteur fiscal, journaux
> et états financiers ne font qu'un avec l'exploitation, au lieu de négocier avec
> elle tous les mois.

---

### 6 · The control tower — the demo

Scroll-driven. A single file advances through its milestones; the ledger panel
fills as it goes. Built as inline SVG using the node motif — no video, no
library — and degrading to a static diagram with `prefers-reduced-motion`.

> EN — **One file. From quotation to closed books.**
> Quotation, transit order, customs, haulage, warehouse, delivery, invoice,
> settlement. One file carries all of it — with its documents, its costs, its
> margin and its postings attached. Open it in March or in three years: it says
> the same thing.
>
> FR — **Un dossier. Du devis à la clôture.**
> Devis, ordre de transit, dédouanement, camionnage, entrepôt, livraison,
> facture, règlement. Un seul dossier porte l'ensemble — avec ses documents, ses
> coûts, sa marge et ses écritures attachés. Ouvrez-le en mars ou dans trois
> ans : il dit la même chose.

---

### 7 · By role

Four tabs, in the order the room actually works: **Direction · Operations ·
Finance · IT.**

|                | EN                                                                 | FR                                                                             |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Direction**  | See the whole company without asking anyone for a report.          | Voir toute l'entreprise sans demander de rapport à personne.                   |
| **Operations** | Every file, every milestone, every exception, on one board.        | Chaque dossier, chaque jalon, chaque exception, sur un seul tableau.           |
| **Finance**    | A ledger you can defend to an auditor, line by line.               | Un grand livre défendable devant un auditeur, ligne par ligne.                 |
| **IT**         | One database per customer. Your data, your credentials, your exit. | Une base de données par client. Vos données, vos accès, votre porte de sortie. |

---

### 8 · Coverage

The 13 module groups as one scannable grid — group name, one line, link to the
relevant solution page. Not 70 tiles. The number 70 appears as a figure, not as
a list.

---

### 9 · Governed intelligence

Ninth, deliberately. By here the reader has seen the ledger and the file, so
"intelligent" is a description of something they have watched work.

> EN — **Intelligence inside the guardrails.**
> The assistant drafts proposals, reads documents and takes dictation in French
> and English. Every action it proposes passes the same validation gate as a
> human's, is checked against the same permissions, and lands in the same audit
> trail. Spend is metered per organisation and visible to you. Nothing posts to
> your ledger because a model was confident.
>
> FR — **L'intelligence, à l'intérieur des garde-fous.**
> L'assistant rédige des propositions, lit les documents et prend la dictée, en
> français comme en anglais. Chaque action qu'il propose passe le même contrôle
> de validation qu'une action humaine, se heurte aux mêmes habilitations et
> atterrit dans la même piste d'audit. La consommation est mesurée par
> organisation et visible. Rien ne s'impute à votre grand livre parce qu'un
> modèle était sûr de lui.

---

### 10 · Trust

> EN — **We hold the code. You hold the data.**
> FR — **Nous détenons le code. Vous détenez vos données.**

Six controls, each one line, each already true in the product:

| EN                                                                                     | FR                                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A dedicated PostgreSQL database per customer — not a shared table with a tenant column | Une base PostgreSQL dédiée par client — pas une table partagée avec une colonne client           |
| An immutable ledger: entries are reversed, never edited                                | Un journal inaltérable : les écritures se contrepassent, elles ne se modifient pas               |
| Encrypted daily backups of every database                                              | Sauvegardes chiffrées quotidiennes de chaque base                                                |
| Restore drills that are run and recorded, not assumed                                  | Des tests de restauration réellement exécutés et consignés                                       |
| A central policy engine — permissions enforced server-side, not just hidden in the UI  | Un moteur d'habilitations central — appliqué côté serveur, pas seulement masqué dans l'interface |
| Ten-year document retention, with QR verification on issued documents                  | Conservation des documents sur dix ans, avec vérification QR sur les documents émis              |

→ `See the full security posture` / `Voir notre posture de sécurité complète`

Heading of `/security` is **"Controls we operate"** / **« Les contrôles que nous
opérons »** — never "certifications", which we do not yet hold. State the
certification roadmap in a line. Honesty here is a differentiator, not a
weakness: no regional competitor can publish this page at all.

---

### 11 · Deployment & white-label

> EN — **Your subdomain. Your logo. Your document numbering.**
> Praxis LS runs at `yourcompany.praxisls.com` in your colours, your fonts and
> both languages. Your team installs it as an app. Your documents carry your
> branding. A live environment and a test environment come as standard, and the
> test one is wiped on a schedule so nobody confuses the two.
>
> FR — **Votre sous-domaine. Votre logo. Votre numérotation documentaire.**
> Praxis LS tourne sur `votresociete.praxisls.com`, à vos couleurs, avec vos
> polices, dans les deux langues. Vos équipes l'installent comme une
> application. Vos documents portent votre marque. Un environnement de
> production et un environnement de test sont fournis d'office, et le second est
> purgé périodiquement pour que personne ne les confonde.

---

### 12 · Standards

> EN — **Which standard do you close in?**
> FR — **Selon quelle norme clôturez-vous ?**

| Standard          | EN                                               | FR                                                        |
| ----------------- | ------------------------------------------------ | --------------------------------------------------------- |
| OHADA / SYSCOHADA | **Live** — 17 member states, DSF, liasse fiscale | **En production** — 17 États membres, DSF, liasse fiscale |
| IFRS              | In development                                   | En cours de développement                                 |
| US GAAP           | Planned                                          | Prévu                                                     |

> EN — We publish this table because you are entitled to know what we run today
> and what we are building. It is updated when the code is, not when the
> marketing is.
> FR — Nous publions ce tableau parce que vous êtes en droit de savoir ce que
> nous exploitons aujourd'hui et ce que nous construisons. Il est mis à jour
> quand le code l'est, pas quand la communication l'est.

Keep that promise. A stale row on this table costs more than the page earns.

---

### 13 · Pricing shape

Three tiers by scale and commitment — **not by module**. An operator with four
trucks needs Fleet and is small; a 200-person forwarder needs none of it and is
your largest deal. Module-gating charges the wrong people.

| Tier           | Covers                                                                          |
| -------------- | ------------------------------------------------------------------------------- |
| **Core**       | Ledger, operation files, master data, invoicing, procurement. Everything posts. |
| **Operations** | Core + warehouse, fleet, costing, portals.                                      |
| **Enterprise** | Operations + multi-entity, customer-held database, SLA, migration.              |

Add-ons: customer-held database credentials · data migration from your existing
system · extra environments · training.

**Baseline AI is in every tier and metered** — never an Enterprise gate. If it
were, the homepage's "intelligent" would be false for every Core customer, and
the pricing page is exactly where a buyer checks.

Price on request, quoted in **XAF and EUR** (add USD when the first non-CEMAC
deal lands). Publishing the shape while withholding the number is honest;
publishing neither reads as evasive and loses mid-market deals before the call.

---

### 14 · Close

> EN — **Let's look at your operation.**
> Thirty minutes, your files, your questions. We'll show you the ledger behind
> them.
> `Book a demo`
>
> FR — **Regardons votre exploitation ensemble.**
> Trente minutes, vos dossiers, vos questions. Nous vous montrons le grand livre
> qui se trouve derrière.
> `Demander une démo`

---

### 15 · Footer

Four columns — Product · Company · Legal · Contact — then a baseline row with
`© JBS Praxis LLC`, the language switcher, and a link to the status page. The
mark sits in the baseline row at glyph size.

---

## 4. The demo form

Six fields maximum. Every extra field costs conversions and buys a CRM column
nobody reads.

| Field                       | Note                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| Full name                   |                                                                   |
| Work email                  | reject free providers politely, don't block                       |
| Company                     |                                                                   |
| Country                     | default from `Accept-Language` region, editable                   |
| Role                        | DG / Operations / Finance / IT / Other                            |
| What are you running today? | optional, one line, free text — the most useful field on the form |

Confirmation names a real response window and keeps it. Language of the
confirmation mail follows the language of the page the form was submitted from.

---

## 5. SEO

- One `<h1>` per page. Headings in real order.
- Titles: `{Page} — Praxis LS` / `{Page} — Praxis LS`. Home EN: `Praxis LS — the
OHADA-native ERP for logistics operators`. Home FR: `Praxis LS — l'ERP natif
OHADA pour les opérateurs logistiques`.
- Meta descriptions written per page, per language. Never generated.
- `hreflang` on every page: `fr`, `en`, `x-default`. Self-referencing canonical.
- One `sitemap.xml` with both language trees and their `hreflang` alternates.
- `Organization` and `SoftwareApplication` structured data; `FAQPage` on pricing
  and security.
- OG/Twitter images **per language** — a French preview card on a French page.
- Target the phrases operators actually type: _logiciel transitaire Cameroun_,
  _ERP OHADA_, _logiciel de dédouanement_, _comptabilité SYSCOHADA_, _freight
  forwarding software Africa_. The five solution pages exist to rank for these.

---

## 6. Performance & accessibility budgets

Non-negotiable. Your buyers are on mobile networks in Douala, Abidjan and
Libreville, and a slow site reads as an unserious vendor.

| Metric                           | Budget       |
| -------------------------------- | ------------ |
| LCP (Slow 4G, mid-range Android) | **< 1.5s**   |
| CLS                              | < 0.05       |
| INP                              | < 200ms      |
| JS shipped (compressed)          | **< 100 KB** |
| Total page weight                | < 600 KB     |
| Lighthouse (all four categories) | ≥ 95         |

- Self-host fonts (`@fontsource`, subset latin + latin-ext for French accents),
  `font-display: swap`, preload the display face only.
- Product screenshots as AVIF with WebP fallback, `width`/`height` always set,
  everything below the fold lazy.
- WCAG **AA in both themes** — the values in `packages/brand` already guarantee
  the palette; the layout has to hold up the rest.
- Full keyboard operation, visible focus rings (orange, `ink` variant), correct
  landmarks, `lang` attribute correct per tree.
- `prefers-reduced-motion` disables the control-tower animation.

---

## 7. Build & hosting

**Astro 5, static output**, deployed independently of the ERP. Islands only
where interaction is real: theme toggle, language switcher, role tabs, the
scroll animation. No SPA framework for a content site.

Brand tokens come from `packages/brand` — import `tokens.css` and read
`index.js` for anything computed. **Do not fork the palette into the site.**
That is the exact failure this whole exercise started from.

### DNS — read this before repointing anything

⚠️ **The apex is not idle.** `praxisls.com` is in `PLATFORM_HOSTS`
(`src/middleware/host-tenent-resolver.js:20`), and the mail OAuth callback is
explicitly designed to land on it — see the `OAUTH_CALLBACK` comment in that
file: a single canonical redirect URI serves the whole fleet because Google
forbids wildcard redirect URIs. `MS_GRAPH_REDIRECT_URI` and
`GOOGLE_REDIRECT_URI` default to empty (derived per-tenant), so **whether the
apex is live for OAuth today depends on what production actually sets.**

**Check that first.** Then:

- ✅ **Recommended — edge routing at the apex.** Put a CDN/edge in front of
  `praxisls.com`: `/mail/oauth/*` (and any other app path in use) proxy to the
  Express origin; everything else serves the static site. Marketing gets the
  apex, no redirect URI is re-registered, nothing breaks.
- **Alternative — move the callback.** Serve marketing from the apex on a CDN
  and relocate the OAuth callback to `api.praxisls.com`. Cleaner long-term, but
  it means re-registering redirect URIs with **both** Google and Microsoft and
  running both URIs in parallel through the cutover.
- ❌ **Do not** simply repoint the apex A record at a static host. If production
  sets those redirect URIs to the apex, mail OAuth breaks for every tenant, and
  it breaks silently at consent time.

`www.praxisls.com` → 301 to the apex. `*.praxisls.com` tenant resolution is
untouched by all of this.

### Repo

**A sibling repository — `praxis-ls-web` — not a folder in this one.** This is
not a matter of taste; the existing CI decides it:

- `.github/workflows/ci.yaml` runs on **every** PR to `main` with **no path
  filter**. A one-word copy fix would run backend lint, the Jest suite and a
  Docker image build.
- `.github/workflows/deploy.yaml` triggers on `workflow_run` when CI succeeds on
  `main`, and SSH-deploys the production VPS. **Merging a marketing change to
  `main` would roll the production ERP.**

Path filters could be added, but that means putting the ERP's deployment safety
in the hands of a `paths:` expression that a future marketing PR can slip past.
A separate repository makes the mistake impossible instead of unlikely.

`packages/brand` is the only shared surface. Consume it as a git dependency
pinned to a tag, or vendor `tokens.css` with a CI check that diffs it against
upstream — never fork the values.

---

## 8. Screenshots

`scripts/marketing/capture-screens.mjs` drives the real app against seeded
sandbox data and writes deterministic captures. Run it on every release so the
site's screenshots are never older than the product.

**The three hero shots:**

1. The operation file, 360° view
2. The milestone control tower
3. The general ledger, showing a journal entry an operation posted itself

Each in **dark and light, French and English** — twelve images. The French
screenshots are not optional: a French page showing an English UI undoes every
other thing this guide asks for.

---

## 9. Launch checklist

- [ ] Both language trees complete — no English string on a French page
- [ ] Glossary applied; French typography rules verified (`:` spacing, `«»`,
      accented capitals, `1 250 000,50 XAF`)
- [ ] FR layout survives +25% string length at 320px
- [ ] `hreflang` + canonical correct on every page; sitemap covers both trees
- [ ] Root 302 works; **no deep link redirects**; switcher preserves path
- [ ] Dark default; toggle persists; light mode fully designed
- [ ] Lighthouse ≥ 95 ×4, both languages, mobile profile
- [ ] AA verified in both themes; keyboard-complete; focus visible
- [ ] Screenshots regenerated from the current release, all twelve
- [ ] Demo form delivers, and someone owns the inbox
- [ ] Smart Logistics has approved their page **in writing**
- [ ] `/standards` matches what is actually shipped
- [ ] No superlative, no claimed scale, no tagline in any lockup
- [ ] Analytics chosen that a CFO would approve of; cookie banner only if truly needed

---

## 10. Explicitly out of scope for v1

A blog · a self-serve trial · a customer portal login on the marketing site ·
per-module pages (70 of them is a maintenance trap — the five solution pages
carry the SEO) · a chatbot · testimonial carousels · a partner directory.

Ship the fourteen sections and five pages well. Add `/docs` and a changelog
next — published engineering artefacts are a large part of why the companies you
want to be compared to feel serious.
