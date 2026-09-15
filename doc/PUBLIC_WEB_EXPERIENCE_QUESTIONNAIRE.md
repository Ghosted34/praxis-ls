# Public Web — Experience Redesign: Reality Read & 13-Question Decision Sheet

**Purpose.** You want `public-web` taken from "competent and static" to a piece of work that a
visitor wants to *stay inside* — depth, spatial physics, ergonomics, lighting, immersive
storytelling, and an About page carrying the group's corporate entities. This document does four
things:

1. Reports what is **actually in the tree today** — measured, not estimated — including the two
   hard walls that decide how much of the ambition is reachable and the three assets already built
   that most of it can stand on.
2. States the **one structural conflict** between the brief and the repo's own doctrine, and why I
   think the doctrine is on your side rather than against you.
3. Asks **13 decision questions** — 10 on the experience, 3 on the About page — each with concrete
   options and my recommendation.
4. Previews the **3-PR split** so you can react to the shape before I write the guide.

**How to use it.** Answer inline. Where you are happy with my recommendation, write "Rec".
Once returned, I write `doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md`: the build-ready specification —
token layer, motion system, depth and lighting model, component trees, per-PR acceptance criteria,
gates and test plan — in the same shape as `doc/SMART_MAIL_ENGINEERING_GUIDE.md`.

---

## 0. Reality check

### 0.1 The first wall: the payload budget is 93% consumed

I installed and built the app to get a real number rather than a guess:

```
    index-BQUWT9uS.js                    46.8 kB gzip
    vendor-C7hZmJMh.js                   59.3 kB gzip
    index-CVMS1HM4.css                   13.4 kB gzip
    TOTAL                               119.5 kB gzip  (budget 128 kB)
    fonts, not counted                  454.5 kB gzip  (18 files, subset by unicode-range)

    26 chunks, 112 static edges, acyclic; first paint is 93% of budget.
```

**There are 8.5 kB of gzipped headroom in the first-paint payload.** For scale: `three` is about
170 kB gzip on its own; `@react-three/fiber` adds ~30 kB; `drei` more again. `framer-motion` is
~34 kB. Even `gsap` core is ~24 kB. Every one of them is larger than the entire remaining budget,
and three of them are larger than the current *application*.

This does **not** mean 3D is impossible. `scripts/check-bundle.mjs` measures the entry chunk, its
static imports and the stylesheet — what `index.html` pulls up front. A route-level or
component-level `React.lazy` chunk is not counted. So the honest engineering answer is: **anything
heavy is deferred, capability-gated, and never on the critical path to LCP** — it arrives after the
page is already readable, on devices and connections that can carry it, and its absence is a
first-class designed state rather than a fallback. Question 1 asks you to confirm that is the trade
you want.

Two more numbers that bear on it:

- **`doc/WEB_BUILD_BRIEF.md` N9 says "JS < 100 KB compressed". The gate says 128 kB.** The brief and
  the gate disagree, and the tree is currently over the brief and under the gate. I need to know
  which number is real (Q1).
- **This app is client-rendered.** `public-head.js` says so in as many words — "the body is still
  empty, so this is not SSR and does not pretend to be". LCP is therefore gated on JavaScript
  parsing and executing before anything paints. That is the single biggest lever on "does it feel
  instant", and it is a bigger lever than any animation we add.

### 0.2 The second wall: this is one codebase serving many tenants

`public-web` is not Smart Logistics' website. It is the website *engine* — one build, repainted at
runtime by `lib/theme.ts` from each tenant's `GET /branding`. The staging site you screenshotted
(`staging.smartls.cm`) is that engine wearing Smart Logistics' orange and blue.

What a tenant supplies is narrow: `primary`, `primaryForeground`, `secondary`, `accent`,
`accentDeep`, `info`, `success`, `warn`, `danger`, three font stacks, a radius, a logo, and
optionally a hero image. `theme.ts` then *derives* an accessible `--primary-ink` by walking the
tenant's hue toward black or white until it clears 4.5:1, because a colour chosen to look good as a
button fill is usually illegible as type.

This is the constraint behind your line "we need to know how to use each brand's colours to the
best". The design cannot be hand-tuned to Smart Logistics' orange-and-blue unless we decide it
should be — and that decision changes the whole build (Q2, Q3).

### 0.3 What is already built and good — the three things worth standing on

Not everything needs inventing. Three assets in the tree are better than what most sites of this
kind ship, and the redesign should extend them rather than replace them:

| Asset | Where | Why it matters to this work |
| --- | --- | --- |
| **The freight-mode identity palette.** `--mode-sea` / `--mode-air` / `--mode-road` / `--mode-rail`, assigned by card position, used for the top bar, icon tile and panel — never for anything clickable. | `public-web/src/lib/service-identity.ts` | This is *already* a logistics-native colour system, and it is the reason the service cards in your second screenshot read as four distinct lines. It is the natural home for the second brand colour (Q3). |
| **A single-observer reveal system.** One `IntersectionObserver` for the whole page, unobserve-on-fire so nothing ever re-animates, and reduced-motion renders the settled state immediately rather than a faster animation. | `public-web/src/components/ui/reveal.tsx` | The hard part of scroll choreography — not scheduling thirty observers per frame — is solved. A scroll-linked narrative extends this, it does not start from zero. |
| **A depth vocabulary that is already tokenised.** `--shadow-s/m/l` (with separate dark-theme values), `--ease`, `--dur`, `.glass`, `.vignette`, and a two-layer hero scrim whose opacities were derived from measured contrast against a worst-case tenant photograph. | `public-web/src/index.css` | Somebody already did the work of making depth a system rather than a shadow typed into a component. "Spatial physics" has a foundation to build on. |

And a fourth, for the About page specifically: **the CMS already has the blocks.**
`src/modules/site/site_content/site_content.schema.js` defines **fifteen** block types. The frontend
renders **five** of them. Unconsumed and directly relevant to an About page:

`leader_message` · `pillar_framework` · `two_column_values` · `text_image` · `card_grid` ·
`testimonials` · `logo_strip` · `policies` · `form_block` · `contact_block`

Migration `12753_site_page_blocks.sql` names the page key in its own column comment:
`'home' | 'about' | ...`. **The About page is already modelled in the backend and simply has no
renderer.** That is a much better starting position than it looks (Q11, Q12).

### 0.4 The structural conflict — and why the doctrine is on your side

You should know this before you answer, because it is the one place the brief in your head and the
rules in the repo genuinely collide.

The tree is full of comments that reject exactly what you are asking for:

> *"Short, and only on arrival — a scrolling marketing page that animates every element is the
> idiom this product's own audit rejected."* — `public-web/tailwind.config.ts`

> *"The only decorative motion this app keeps, because on a route diagram it carries meaning —
> direction of travel — rather than delight."* — same file

> *"'Make it feel richer' is a request that usually turns into a shadow typed into a component."*
> — `public-web/src/index.css`

Read alone, that is a wall. But the gate that enforces it says something different — and it is worth
quoting in full, because it is the licence for this entire engagement:

> **"The front door.** `.landing-*` and `.login-*` are the marketing surface and the sign-in card:
> seen once per session, before any work starts, and **the only place in this product where
> 'impression' is the job.** F17's objection is about the workstation, not the doorway. Their long
> motion (a 26s Ken Burns, a 0.7-0.9s rise) stays."
> — `client/scripts/check-motion.mjs`

**The 250 ms motion budget is a rule about the ERP, written to protect a dispatcher who opens the
shipments table forty times a day.** It was never a rule about the marketing site, and its own
author carved the front door out of it explicitly. `public-web` is the front door. What you are
asking for is not a fight with the doctrine — it is the case the doctrine already anticipated.

What survives, and what I will hold us to regardless of your answers, because these are not taste:

- **`prefers-reduced-motion` renders the settled state, not a faster animation.** Non-negotiable,
  already the rule in `reveal.tsx`, and asserted by a gate.
- **WCAG AA in both themes**, keyboard operation, visible focus, one `<h1>` per page (N10).
- **No invented facts** — no stock faces, no fabricated metrics, no placeholder testimonials (N12).
  This one has teeth for "immersive storytelling"; see Q6.
- **No raw palette colours.** Everything through tokens, or white-labelling breaks (N3).
- **No `window.confirm` / `alert` / `prompt`.** ESLint error in all three apps.

The one thing I want to add rather than inherit: **a motion budget for `public-web` of its own** —
a different number from the ERP's 250 ms, with named exemptions for the narrative set pieces, so
that "the front door may be expressive" is written down and gated rather than left to whoever edits
the file next. That is Q8.

### 0.5 What is thin today, honestly

Beyond the visual flatness, the things that will limit how good this can get:

- **`/portfolio` renders "Nothing published yet."** Your third screenshot. The proof band on the
  homepage is in the same position. A masterpiece with no evidence in it is a brochure.
- **There is no About page**, and no `About` in the header nav (Services · Track · Our work ·
  Insights · Careers · Contact).
- **The hero art is a tenant-uploaded photograph or a hand-drawn SVG node network.** There is no
  image library, no rights to one, and N12 forbids buying our way out with stock.
- **The track result page is the most-visited screen on the site and the least designed.** Your
  audience arithmetic is in the hero's own comments: far more visitors are checking something that
  exists than shopping for something new. The lookup gets a beautiful door and then opens onto a
  plain room.
- **454 kB gzip of fonts across 18 files.** Not counted by the gate, but real bytes on a metered
  Douala connection, and worth a pass regardless of what we add.

---

## 1. The ten experience questions

### Q1 — When depth collides with the meter, which gives?

**The situation.** 8.5 kB of gzipped headroom; N9 asks for LCP < 1.5 s on Slow 4G on a mid-range
Android, page < 600 kB, Lighthouse ≥ 95 on all four categories in both languages; and the app is
client-rendered, so nothing paints until JS runs. Real WebGL costs 170 kB+ before a single triangle.

| | Option | What it means in practice |
| --- | --- | --- |
| **A** | **Budget is law.** No library above ~10 kB gzip. Everything is hand-written CSS/SVG/Canvas 2D. | Genuinely achievable — CSS 3D transforms, scroll-linked transforms, canvas particle/route work, and SVG lighting go a very long way. Nothing ever regresses on a cheap phone. Ceiling: no true 3D geometry, no real-time lighting. |
| **B** | **Tiered experience (Rec).** A budget-clean baseline that is complete and beautiful on its own, plus one deferred WebGL set piece that loads *after* LCP, only on devices that pass a capability check (device memory, connection type, `prefers-reduced-motion`, pointer type), and is never required for the page to make sense. | The 128 kB gate keeps passing because the heavy chunk is lazy. The Douala phone gets the fast, complete site. The procurement officer on a desktop gets the set piece. Costs: two states to design and test rather than one, and honest discipline about which is the "real" site. |
| **C** | **Ambition is law.** Raise the budget, accept a heavier site, ship R3F properly. | Delivers the most spectacular result and breaks N9. Only defensible if the audience assumption in the tree (metered mobile, mid-range Android) is out of date. |

**My recommendation: B.** And the reason is not caution — it is that A's ceiling is much higher than
it sounds. Almost everything in your brief that reads as "3D" (depth, parallax, spatial layering,
lighting, material) is reachable in CSS and SVG at a few kB. What genuinely needs WebGL is a small
list: real geometry, real-time light response, and volumetric effects. Tiering means we spend the
expensive budget on the two or three moments that actually need it instead of spreading it thin.

**I also need a ruling on the N9 discrepancy:** the brief says JS < 100 kB, the gate says 128 kB,
and the tree ships 119.5 kB. Which is the real number?

**Your answer:**

---

### Q2 — Are we designing Smart Logistics' website, or every tenant's?

**The situation.** One codebase, runtime-themed per tenant. A design hand-tuned to orange-and-blue
looks superb on `smartls.cm` and can look broken on a tenant whose brand is a single green.

| | Option | What it means |
| --- | --- | --- |
| **A** | **Engine.** Every decision is parametric and must hold for any tenant palette, including hostile ones (one colour, a very light primary, a near-black primary). | Protects the product. Slower, and the result is a *system* that is excellent rather than a *page* that is perfect. Every set piece needs a "what if they only gave us one colour" answer. |
| **B** | **Flagship, then generalise (Rec).** Design and build against Smart Logistics as the reference tenant, but every value goes through tokens with a documented derivation rule and a stated fallback for a single-colour tenant. Ship it to Smart Logistics first; the generalisation is proven by testing against 2–3 synthetic hostile palettes before rollout. | You get the masterpiece on the site you are judged by, and the engine stays honest. The derivation rules are the deliverable, not the hex values. |
| **C** | **Fork.** A Smart Logistics theme layer that other tenants do not receive. | Fastest to spectacular. Creates exactly the drift `packages/brand` was built to end, and someone maintains two sites forever. I would argue against this. |

**My recommendation: B**, with a hard rule: **no set piece may depend on a tenant having a second
colour.** Where a second colour exists it is used; where it does not, the design derives one
(analogous hue at fixed distance from primary, or a neutral from the slate ramp) and looks
deliberate either way. That single rule is what makes B safe.

**Your answer:**

---

### Q3 — How hard do we lean on the second colour, and what does it *mean*?

**The situation.** Smart Logistics is orange **and** blue — your logo's mark is blue, the wordmark is
orange, and your service cards already alternate. Today the second colour arrives almost by accident,
via the freight-mode identity palette assigned by card position. Meanwhile the doctrine says orange
is the only thing that looks clickable, and `--mode-*` is explicitly "an identity palette, not a
taxonomy": card three is `--mode-road` because it is third, and no claim is made that it moves by
road.

That is a defensible rule that also throws away the most logistics-native idea in the codebase.

| | Option | What it means |
| --- | --- | --- |
| **A** | **Keep it decorative.** Second colour stays a positional identity accent. | Safe, honest, and leaves the site looking like it has two colours for no reason. |
| **B** | **Make the mode palette mean something (Rec).** Sea / air / road / rail become a real, consistently-applied semantic system across the whole site — the track timeline, the route graphics, the service pages, the corridor panel, the About page's network map. Where the tenant tells us a service's mode, we use it; where they do not, position remains the fallback and nothing regresses. | This is the answer to "something that screams supply chain". A visitor learns the colour language in the first screen and reads the rest of the site with it. It is also the only way the second colour earns its place. Requires a way to know a service's mode — see below. |
| **C** | **Two-colour brand system.** Primary for action, secondary as a structural/atmospheric colour (deep grounds, lighting, gradients), modes stay decorative. | Handsome, more conventional, less distinctive. Reachable in PR 1 alone. |

**My recommendation: B *plus* C** — the mode palette carries meaning, and the second colour also does
atmospheric work in the dark bands' lighting. They are not in conflict; modes are chromatic accents
on content, atmosphere is the ground behind it.

**One thing I need from you for B:** does a tenant's published service record carry its freight mode
anywhere today, or would we be adding that field? If adding it, that is a backend change and it
lands in PR 1 rather than PR 2.

**Your answer:**

---

### Q4 — How far up the depth ladder do we go, and where exactly?

**The situation.** "3D where possible" is a technique; the design question is *where* depth carries
meaning. On a freight site there are obvious candidates: a container, a vessel, a route through
space, a warehouse volume, a document stack, a globe/corridor map.

The ladder, cheapest first:

| Rung | Technique | Cost | What it buys |
| --- | --- | --- | --- |
| 1 | Layered parallax, `translate3d`, scroll-linked transforms, real elevation tokens | ~0 kB | Depth as *space*: things sit at distances and respond to scroll and pointer |
| 2 | CSS 3D — `perspective`, `transform-style: preserve-3d`, real rotating objects built from planes | ~0 kB | A container that actually turns. Reads as 3D because it *is* 3D, just polygon-poor |
| 3 | SVG with derived lighting — gradients and masks computed from a stated light position, animated | ~1–3 kB | Material and light response on the drawn graphics, at no library cost |
| 4 | Canvas 2D — particles, route tracing, a flow field, a dot-matrix globe | ~3–6 kB hand-written | Motion at scale: freight moving through a network |
| 5 | WebGL, deferred and gated (needs Q1 = B or C) | 170 kB+, lazy | True geometry, real-time lighting, volumetric depth |

**What I need from you: which moments deserve which rung.** My proposal, to react to:

- **Hero** — rung 2 + 4. The route network gains real depth and a light source; the "cargo moving"
  idea becomes a live canvas rather than a static SVG. Loads with the page, stays budget-clean.
- **Track result** — rung 1 + 3. This is the most-visited page and it should be the most
  *ergonomic*, not the most spectacular: a timeline with real depth and material, where a shipment's
  progress is felt spatially. No heavy assets — this page is often opened on a phone, on data, by
  someone who wants one fact.
- **Services** — rung 2. Cards with genuine 3D response to pointer, mode-lit.
- **One signature set piece** — rung 5 if Q1 permits. My candidate is the **corridor / network
  scene**: the trade lanes this company actually runs, in space, that you can move through. It is the
  single most "supply chain" idea available and the only one that genuinely needs WebGL.
- **About** — rung 2 + 3. The group structure as a spatial object rather than an org chart image.

**Your answer — including any set piece you want that I have not listed:**

---

### Q5 — Hand-tracking and eye-gaze: the literal thing, or the principle behind it?

**The situation.** I want to be straight with you here rather than agreeable.

**Hand-tracking** on the web means WebXR (headset only — no phone or laptop browser exposes hand
joints) or MediaPipe Hands over `getUserMedia` (~2 MB of WASM, plus a camera permission prompt).
**Eye-gaze** means webcam gaze estimation: another camera prompt, low accuracy without calibration,
and it is roughly the least reliable input modality on the open web.

For a freight-forwarding site, the failure is not technical, it is the moment a procurement officer
in Douala who came to check a bill of lading gets a **camera permission prompt**. That prompt costs
trust — and in a white-label product it costs *your tenant's* trust, on their domain, with the
attendant data-protection question of why a logistics site wants their camera.

But the *principle* underneath your ask is completely right, and it is the part that actually makes
interfaces feel alive: **the interface should know where the person's attention is and respond to
it spatially.** That is achievable, cheaply, and on every device:

- **Pointer as a light source** — the scene's lighting and parallax follow the cursor. This is
  "gaze" in every way that matters on a desktop, because on a desktop the cursor *is* the gaze.
- **Device orientation on mobile** — gyroscope parallax, so tilting the phone moves the scene. This
  is the mobile equivalent and it is the one that makes people say "how did they do that".
- **Scroll as a scrub** — position in the document drives a continuous animation rather than firing
  discrete triggers.
- **Real dwell/proximity** — elements respond as the pointer *approaches*, not only on hover.
- **Genuine keyboard ergonomics** — the whole narrative operable without a mouse, which is also N10.
- **Touch drag** with proper inertia and rubber-banding on the spatial pieces.

| | Option | What it means |
| --- | --- | --- |
| **A** | **The principle (Rec).** Pointer-as-light, gyro parallax, scroll scrubbing, proximity response, full keyboard. No camera, ever. | Every visitor gets it, no permission prompts, no WASM, fits the budget. This is what the best studios actually ship. |
| **B** | **Principle + an opt-in lab.** As A, plus one clearly-labelled experimental surface — a "view in 3D / immersive mode" the visitor *chooses* — where WebXR hand-tracking works on a headset and nothing is requested from anyone who does not ask. | Gives you the genuine article for demos and press without putting a prompt in a stranger's path. Meaningful extra scope; I would put it after the three PRs, not inside them. |
| **C** | **Literal, on the main site.** Camera-based gaze/hand-tracking on entry. | I would not build this, and I would want it in writing if we do. |

**My recommendation: A now, B as a documented follow-on** if you want the headline capability.

**Your answer:**

---

### Q6 — What real material exists? (N12 is the constraint that decides how good this can be)

**The situation.** This is the question I am least able to answer from the code, and the one that
most determines the ceiling. N12 forbids inventing facts — no stock faces, no fabricated metrics, no
placeholder testimonials — and `/portfolio` currently renders "Nothing published yet."

Immersive storytelling needs something to tell. Please tell me which of these exist, or can be
produced, and by when:

- [ ] **Photography of your own operations** — vessels, containers, the warehouse, trucks, the team
      at work, Douala/Kribi/Yaoundé. *(Quantity? Resolution? Rights cleared?)*
- [ ] **Video or drone footage** — even 10 seconds of a yard or a crane changes what a hero can be.
- [ ] **Real figures we may publish** — TEU handled, tonnes cleared, on-time percentage, years in
      operation, staff count, corridor transit times. *(Which are true and approved for publication?)*
- [ ] **Real case notes / success stories** — the `/portfolio` engine exists and is empty. Even two
      would transform the proof band.
- [ ] **Named clients** — with permission to name them. *(N11 forbids a logo wall; a named case
      study is different and is allowed.)*
- [ ] **Certifications, licences, memberships** — customs broker licence, IATA, FIATA, ISO. These are
      facts, they are verifiable, and they are the most persuasive thing on a freight site.
- [ ] **Leadership photographs and biographies** — needed for the About page (Q13).
- [ ] **Real corridor / lane data** — which trade lanes you actually run, with real ports and
      transit times. *(This is the fuel for the Q4 set piece; without it the network scene is
      decorative.)*

**My recommendation:** treat this as the critical path. Design that carries no information is
decoration, and the difference between a good site and a masterpiece here is almost entirely whether
the spatial pieces are *showing something true*. If the honest answer is "very little", say so and I
will design for abstraction deliberately — a drawn, diagrammatic language that never pretends to be
photography — rather than leaving photo-shaped holes.

**Your answer:**

---

### Q7 — Dark-first, light-first, or two fully-designed expressions?

**The situation.** `doc/WEB_BUILD_BRIEF.md` N6 says dark is the default on first visit, the toggle is
two states, the choice persists, and light is fully designed because it will be printed. The staging
site you screenshotted is **light** on entry, with a dark hero band — so the tenant site and the
brief already disagree.

This matters more than usual for this work: depth, lighting and material are dramatically easier and
more striking on a dark ground, and every reference you named (Clay, Work & Co) does its most
spectacular work there. But light mode is what gets printed, what a procurement officer reads in
sunlight, and what a lot of West African B2B audiences expect from an established company.

| | Option | What it means |
| --- | --- | --- |
| **A** | **Dark-first**, per N6, light fully designed as an equal. | Best-looking result. Contradicts what the tenant site does today, so it is a visible change on `smartls.cm`. |
| **B** | **Light-first (current behaviour), dark fully designed (Rec).** Keep the entry as it is, but make the dark bands genuinely cinematic and let the toggle be a real second expression rather than an inversion. | No surprise for existing visitors, and it plays to a real strength: a light page with deep, lit dark bands has more *contrast of experience* than an all-dark page. The hero, the set piece and the About narrative all sit on dark grounds. |
| **C** | **Time/context aware** — dark after dark, light by day, still overridable. | Charming, and an extra state to test in every review. |

**My recommendation: B.** The alternation of light reading surfaces and deep lit bands is itself a
spatial device — the page has *rooms*. And it means the most expensive lighting work is concentrated
where it pays.

**Your answer:**

---

### Q8 — What is the narrative, and what is the one thing a visitor should do?

**The situation.** "Immersive storytelling" needs a story, and right now the homepage is a sequence
of correct bands rather than a narrative. The current order is a deliberate borrow from Maersk —
lookup → services → how-we-work → proof → CTA — and its reasoning is sound and documented: most
visitors are checking something that exists, not shopping.

A narrative spine has to be chosen, because it determines the whole scroll choreography.

| | Spine | The scroll experience |
| --- | --- | --- |
| **A** | **Follow one shipment.** The page *is* a journey — origin, vessel, port, customs, warehouse, delivery — and each band is a stage in it. Services, proof and the portal appear as things that happen along the way. | The most immersive and the most logistics-native. The set piece and the narrative are the same object. Risk: it can bury the commercial content if done indulgently. |
| **B** | **Zoom out then in.** Open on the network (the corridors, the region), then descend into one company, then into one file. Scale as the device. | Cinematic, very "Clay". Slightly more abstract; needs real corridor data (Q6) to be honest. |
| **C** | **Keep the current order, raise every band.** No new spine; each existing section becomes a considered, spatial, lit composition. | Lowest risk, respects the documented persuasion sequence, and honestly gets you 70% of the "wow" for 40% of the work. Not a masterpiece. |

**My recommendation: A, mapped onto the existing order rather than replacing it.** The current
sequence already *is* roughly a journey; making that explicit costs no persuasion logic and gains the
spine. The track widget stays first because that audience arithmetic is correct.

**And the second half of the question, which I cannot infer:** what is the single conversion this
site exists to produce? Request a quote? Track a shipment? A portal sign-in? A phone call? Right now
"Request a quote" is the primary CTA everywhere and the track widget takes the hero's best real
estate — those are two different answers, and the design should commit to one being *the* goal and
the other being *the* service.

**Your answer:**

---

### Q9 — May we extend the brand sheet — typography, and a motion budget of our own?

**Two related asks.**

**(a) Typography.** N5 pins three faces — IBM Plex Sans (display), Inter (body), JetBrains Mono
(figures) — and forbids *naming* any other family anywhere, including fallback stacks, enforced by
`check-fonts.mjs`. That is a good rule. It is also why the site's headings look competent rather than
distinctive: Inter and IBM Plex Sans are the two most-used faces on the B2B web, and nothing set in
them will ever be the reason someone remembers a page.

| | Option | Cost |
| --- | --- | --- |
| **A** | **Keep the three faces, do far more with them.** Extreme scale contrast, real optical sizing via the variable axes, tighter display tracking, tabular figures everywhere they belong, a proper editorial rhythm. | Free. Genuinely underexploited today — the type ramp goes to 72 px and the site never uses it. |
| **B** | **Add one display face** for headlines only, self-hosted, subset, ~15–25 kB. Amend the brand sheet and `check-fonts.mjs` allow-list. | The single highest-impact change available for the money. Needs your sign-off because it changes the brand. |
| **C** | **A variable display face with a wide weight axis**, used as an animated typographic device (weight/width responding to scroll or pointer). | Distinctive, on-trend, ~30 kB, and the kind of thing that gets a site noticed. |

**My recommendation: A in PR 1 regardless, and B if you will amend the brand sheet.** I would also
audit the 454 kB of fonts we already ship — 18 files is more than three families need, and there may
be weights we load and never set.

**(b) A motion budget for `public-web`.** As per §0.4, the ERP's 250 ms rule was never about this
app, and its own gate carves out the front door. I want to write `public-web`'s budget down and gate
it: a proposed **600 ms for entrance and narrative motion**, **200 ms for anything that responds to
an input** (a hover, a press, a focus — responsiveness is a different job from choreography), plus a
named exemption list for continuous/scroll-linked set pieces, plus the reduced-motion assertion the
ERP's gate already makes. Do you want that gate?

**Your answer:**

---

### Q10 — How does this ship, and what is "done"?

**The situation.** `staging.smartls.cm` exists, which is the right place to prove this. But
`public-web` serves every tenant from one build, so a merge to `main` repaints every tenant's public
site at once. And `.github/workflows/deploy.yaml` SSH-deploys the VPS when CI passes on `main`.

| | Option | What it means |
| --- | --- | --- |
| **A** | **In place.** Each PR merges and ships to everyone. | Simplest, and every tenant gets the improvement. A regression is live for all of them. |
| **B** | **Behind a flag (Rec).** The new experience is gated per tenant (a branding flag or a feature toggle), defaults off, on for Smart Logistics first. Removed once proven. | Lets us ship PR 1 and PR 2 without a big-bang, and lets Smart Logistics be the reference tenant in public while others are unaffected. Costs one flag and a period of two code paths. |
| **C** | **Long-lived branch**, one merge at the end. | Avoids flags, guarantees a painful merge and no feedback until the end. I would avoid it. |

**And "done" — please confirm the acceptance bar.** My proposal:

- `npm run ci` green, plus `public-web`'s own `lint` / `typecheck` / `test` / `check:bundle` /
  `check:i18n`.
- First paint within whichever budget Q1 settles, **reported as a real number in the PR**.
- Lighthouse ≥ 95 on all four categories, mobile profile, **in both EN and FR** (N9).
- Real-device check on a mid-range Android over throttled 4G — not just a Lighthouse score.
- WCAG AA verified in both themes; full keyboard pass on every narrative set piece; reduced-motion
  screenshots in the PR.
- Both languages rendered and read — FR typography per `BRAND_GLOSSARY_FR_EN.md` §5 (narrow NBSP
  before `: ; ! ?`, guillemets, accented capitals).
- Every new string through `tr()`; `check:i18n` green.

**Your answer:**

---

## 2. The three About-page questions

Context for all three: `src/modules/master/corporate_entity/` (MOD-01) already models the legal
companies a tenant operates — `legal_name`, `trading_name`, `country_code`, `legal_form`,
`incorporation_date`, RCCM / NIU, `parent_entity_id`, `relationship_type`, cap table, governance,
addresses, registrations, letterhead. It is **auth-gated and internal**; nothing about it is public
today. And `site_content` already carries `leader_message`, `pillar_framework`, `two_column_values`,
`text_image` and `card_grid` blocks that no frontend renders.

### Q11 — Which entities, and what about them may be public?

**The situation.** "The different corporate entities" could mean several things, and the legal
identity fields are the sensitive part: RCCM and NIU are matters of public record in Cameroon, but
publishing them on a marketing site is a choice, not a default — it is exactly the data a
counterparty-impersonation attempt wants.

- **Which entities belong on the page?** Please list them — legal name, trading name, country, what
  each one *does*, and the relationship between them (parent / subsidiary / branch / joint venture /
  agency).
- **What may be shown for each?**
  - [ ] Legal name and trading name
  - [ ] Country and registered address
  - [ ] Legal form (SARL, SA…) and incorporation date
  - [ ] **RCCM / NIU** — *my recommendation: no.* Verifiable elsewhere, low value to a visitor,
        and it is the raw material for impersonating you. If you want it, it belongs on a `/legal`
        page, not in the About narrative.
  - [ ] Sector / service scope, and the corridors each entity covers
  - [ ] Licences and accreditations held by that specific entity
  - [ ] Local contact and leadership
- **Is the group structure itself a selling point?** ("One group, four countries, one file" is a
  strong story for a freight forwarder — but only if it is true and you want it told.)

**My recommendation:** the page tells the *operational* story — what each entity does, where, and
what it lets a client do that a single-country forwarder cannot — and the statutory identifiers live
on a separate, plainer `/legal` page for people who need them.

**Your answer:**

---

### Q12 — Where does the entity data come from?

Three routes, and this decides whether PR 3 is backend-plus-frontend or frontend-only.

| | Option | What it means |
| --- | --- | --- |
| **A** | **New public read from MOD-01.** A `/public/site/entities` endpoint exposing an explicitly curated, allow-listed subset of `corporate_entity`, with a per-entity "publish on website" flag set in the ERP. | The data is entered once, in the place it already lives, and the About page cannot drift from the truth. Real backend work: migration for the flag and any public-copy fields, a new public route, rate limiting, `feature: "website"` gating, tests. It also means every tenant gets an About page that fills itself in — a genuine product feature, not just a page for you. |
| **B** | **Author it as `site_content` blocks.** Build renderers for the About-shaped blocks that already exist in the schema, add an `about` page key, and let the tenant write the page in the site editor. | No backend change. Unlocks *ten* unused block types, which is value well beyond this page. But the entity facts are then typed twice — once in MOD-01, once in the CMS — and will diverge. |
| **C** | **Both (Rec).** Entity *facts* come from MOD-01 via A; entity *narrative* — the story, the leader's message, the values, the history — is authored via B. | Each piece of content lives where it belongs: facts stay single-sourced, prose stays editable without a deploy. It is more work than either alone, and it is the version that is still correct in two years. |

**My recommendation: C**, sequenced — B's renderers first (they are pure frontend and unlock the
whole block library), A's endpoint second in the same PR.

**Your answer — and specifically: do you want the About page to be authorable by tenants in the site
editor, or hard-built for Smart Logistics?**

---

### Q13 — People, history, and how the group is drawn

Three sub-questions that together decide the page's shape:

- **Leadership.** Do we show named people with photographs and biographies? N12 forbids stock faces
  absolutely, so this is real photographs or no photographs. If yes: who, how many, and do we have
  the images and approved bios? The `leader_message` block exists in the schema and is a strong
  device — a signed message from the DG carries more on a Cameroonian B2B site than any amount of
  copy about values.
- **History.** Is there a timeline worth telling — founding year, first office, first licence,
  entity formations, corridor openings? A dated timeline is the single most credible thing an
  established company can put on an About page, it is entirely factual, and it is a natural fit for
  the scroll-linked spatial treatment (time as depth). Do the dates exist?
- **How the group is drawn.** The most distinctive option, and I want your view:

  | | Treatment |
  | --- | --- |
  | **A** | A clean, conventional org / structure diagram — legible, unremarkable |
  | **B** | **A map-first structure (Rec)** — entities placed geographically, connected by the corridors they actually run, so the group structure and the service network are the *same* picture. Reuses the Q4 network scene, and answers "why does this group exist" visually |
  | **C** | Entities as spatial cards in a 3D arrangement you can move through |

  **My recommendation: B.** It is the only one that makes the corporate structure mean something to
  a client rather than to a lawyer — and it gives the About page the same spatial language as the
  homepage instead of a separate idea.

**Your answer:**

---

## 3. Proposed PR split — react before I write the guide

Sized so each PR is independently reviewable, independently shippable, and leaves the site working.

### PR 1 — *The system.* `feat(public-web): spatial design system — depth, light, motion, colour`

The foundation, with no page rewritten. Boring to look at in a screenshot and the reason the other
two PRs are possible.

- Depth and lighting tokens: a stated light source, elevation as a real scale, material tokens
  (surface, glass, scrim) derived rather than typed.
- The motion system: budget, easing set, choreography primitives, the `public-web` motion gate
  (Q9b), scroll-scrubbing and pointer/gyro-parallax hooks built on the existing single observer.
- The colour doctrine: second-colour derivation, mode-palette semantics (Q3), hostile-palette
  fallbacks, contrast assertions for both themes.
- Typography: the ramp actually used (Q9a), optical sizing, the font audit.
- Primitives: the spatial card, the lit band, the depth stack — the things PRs 2 and 3 compose.
- Gates: motion gate, palette/contrast checks extended to this app, bundle number reported.

### PR 2 — *The front door.* `feat(public-web): the homepage journey and the track experience`

Where the "wow" lands, and where the signature set piece lives.

- Hero: depth, lighting, live network, pointer/gyro response, the tenant photograph properly lit.
- The narrative spine (Q8) across services, how-we-work, proof and portal bands.
- The signature set piece (Q4) — deferred, capability-gated, with a designed absent state.
- **The track result page**, brought to the same standard — the most-visited screen on the site.
- Both themes, both languages, reduced-motion, keyboard, real-device numbers in the PR.

### PR 3 — *About, and everything else raised to the system.*

- The About page: entity data (Q11–Q13), the map-first group structure, leadership, timeline.
- The `site_content` block renderers — `leader_message`, `pillar_framework`, `two_column_values`,
  `text_image`, `card_grid` and the rest — which unlocks the CMS for every tenant.
- `About` into the header nav and the footer.
- Services index and detail, Our work, Insights, Careers, Contact brought onto PR 1's system.
- The public entity endpoint if Q12 lands on A or C.

**Ordering note.** If Q6 comes back thin on real material, PR 3 moves ahead of PR 2 — because the
About page can be built from facts you certainly have (your own companies), while the homepage
set piece needs corridor data and photography to be honest rather than decorative.

---

## 4. What I need to start

1. The 13 answers above — brief is fine; "Rec" where you agree.
2. The N9 ruling: is the JS budget 100 kB or 128 kB (Q1)?
3. The content inventory (Q6). This is the critical path and the longest lead time.
4. The entity list (Q11).

On receipt I write `doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md` — the full specification, every upgrade
documented, split across the three PRs — and we build from it.

---

## 5. Answers — round 1 (Q1–Q13), recorded 2026-09-10

Recorded verbatim in substance so the guide is built from a written record rather than a chat log.

| # | Answer | What it settles |
| --- | --- | --- |
| **Q1** | **B — tiered.** Plus an explicit ruling: **`public-web` gets an express exception from the tenant-app doctrine.** This is the public face by which tenants are judged; it may accept what the ERP rejects. Highest level of design and engineering. | Deferred, capability-gated WebGL is authorised. A `public-web`-specific budget and motion doctrine replaces the ERP's, written down and gated. |
| **Q2** | **B — flagship then generalise.** Plus: **build a palette engine.** A tenant picks up to 3 colours; the system generates the full, accessible palette. Managed from a settings page that also governs other public-site parameters. Seed Smart Logistics for the perfect first view; every tenant configures their own. | The palette engine is a first-class deliverable, not a token file. Settings surface confirmed. |
| **Q3** | Deferred to Q14. | See below. |
| **Q4** | **All proposed rungs, plus anything further deemed necessary. Every page gets a hero / animated header section.** | No page ships without a designed entry moment. Scope covers every route, not just the homepage. |
| **Q5** | **A only** — the principle, never the camera. Pointer-as-light, gyro parallax, scroll scrubbing, proximity response, full keyboard. | No `getUserMedia`, no WASM tracking, no permission prompts. Closed. |
| **Q6** | **Seed what we can; omit what we can't.** Everything parametric — replaceable, addable, removable from settings tabs. Generated assets permitted. | Content is seeded-but-editable. The settings surface grows tabs for assets and metrics. |
| **Q7** | **Both themes fully designed.** Light/dark toggle **always present in the header**. Plus: **an announcements capability** — partnerships, certifications (JCTrans etc.) — parametric from settings, with a strong section on the site. | Theme toggle promoted to permanent header furniture. Announcements added to scope. |
| **Q8** | **A + C** — the shipment-journey spine, and every band raised. **No long static text blocks**: prioritise dynamic visuals, illustration, graphics, icons and micro-interactions. Text itself must be organised, designed, animated and transitioned. Explore a frame-sequencing pipeline (see Q16). | Copy density becomes a design constraint. Text treatment is a designed system, not a stylesheet default. |
| **Q9** | **A + B** — exploit the three faces properly *and* add a display face. Font selection exposed in the same settings tab as colour, **restricted to our own font library**. | Brand sheet amended; `check-fonts.mjs` allow-list extended; a curated picker, not a free text field. |
| **Q10** | **A — in place.** One tenant today (Smart Logistics), so no feature flag needed. | Simplifies rollout. Each PR ships on merge. |
| **Q11** | Corporate entities carry a **public storytelling section**, generated first from what the system already knows, then extended. **Addresses, locations, coverage areas and service focus are essential.** | Entity data becomes public-facing content. Geography is a first-class part of the story. |
| **Q12** | **Tenant-authored.** Seed the supplied Smart Logistics copy — refined, corporate, concise — editable from a new **Corporate Entity 360 public-story tab**. Where possible replace static prose with illustration and animation (ESG named specifically). | Real copy supplied and recorded in §6 below. The ESG block becomes a designed interactive, not three columns of text. |
| **Q13** | **Leadership teams for the global entity and for each entity**, with photographs. A concise per-entity About plus a **global About** editable in settings. Advice requested on structure. | Two-tier About model. My recommendation is written into the guide rather than posed as a question. |

---

## 6. Answers — round 2 (Q14–Q17), asked in chat 2026-09-10

These four were asked interactively once the round-1 answers reshaped the work. Recorded here so
the guide has a single source.

### Q14 — Should the freight-mode palette be generated from the tenant's brand colours?

*(This is the Q3 clarification.)* The site identifies service lines with a sea/air/road/rail
palette, and the ERP's Control Tower draws the same modes the same way — so regenerating them per
tenant risks desyncing marketing from product and destroying the modes' conventional legibility.

**Answer: harmonise, keep hue.** Modes keep their recognisable hues — sea deep-blue, air sky, road
amber, rail slate-violet — and the engine matches their **chroma and lightness** to the tenant's
palette so they sit in the same colour world. Meaning survives, coherence is gained, the ERP stays
in sync.

**Consequence for the build:** the palette engine has two outputs, not one — the tenant's derived
brand ramp, and a mode set harmonised into it under a bounded hue tolerance. Both need contrast
assertions in both themes.

### Q15 — What may generated imagery depict?

**Answer: options 1 and 2 — abstract/diagrammatic *and* photoreal non-specific.**

- **Permitted:** non-representational work — cargo networks, light and material studies, isometric
  containers, vessels, warehouses, corridor topography. And photoreal generated scenes used as
  **atmosphere** — a port at dusk, container stacks.
- **Excluded by the choice:** photoreal imagery depicting Smart Logistics' actual sites, fleet or
  staff.

**The guardrail this implies, which the guide will state as a rule.** Because option 2 is in play,
photoreal generated imagery must never be captioned, captioned-adjacent, or positioned so a
reasonable visitor concludes it is a photograph of the tenant's own operations. Concretely: no
generated photoreal image sits inside a case note, a proof band, an entity profile, or under a place
name. Atmosphere bands only, and every generated asset is recorded as generated in its manifest so a
later reader can tell what is documentary and what is not.

### Q16 — Frame sequences, video, or procedural?

The premise was corrected with real numbers: a 24-frame 1600px WebP sequence is ~400–800 kB, while
the same motion as AV1/WebM is ~80–150 kB. Modern codecs are **lighter** than frame sequences, not
heavier. Frame sequences win only where scroll position drives the frame, because video seeking is
janky.

**Answer: 1 and 2 — use both.**

**Reading, for the guide:** frame sequences are a sanctioned technique rather than a last resort, and
they are the **default where the scroll position is the timeline**. Video carries anything that
simply plays. Procedural canvas/CSS carries everything that can be generated. All three are governed
by a **per-sequence byte budget enforced by a gate**, because the failure mode here is not one heavy
sequence — it is the fourth one nobody measured.

### Q17 — Announcements: one engine or two?

**Answer — requirements given rather than an engine chosen:**

- Announcements need a **homepage presence near the hero**, with a **"view more"**.
- **Only for the very important announcements** — this is not a news feed.
- Modern treatment: scrolling / marquee / or equivalent.
- "More than important" — this is a priority band, not a footnote.

**My reading, to be corrected if wrong.** I will build the recommended shape unless told otherwise:
announcements become an **Insights `kind`** (they have bodies, dates and detail pages, and the
`content/insight` + `insight_public` CMS already exists), gaining a **priority/pinned flag** so only
flagged items reach the homepage band. Certifications and memberships become a **separate
lightweight credentials list** (logo, name, issued date, link) — because a certification is not an
article and should not carry article machinery. The homepage band sits directly beneath the hero
with a "view more" into the full list.

**⚠ OPEN — confirm or correct at the start of PR 1.**

### Also recorded

- **Assets incoming.** Real Smart Logistics assets will be supplied before the guide is written.
  Every tenant after Smart Logistics uploads their own — which confirms the seed-then-parametric
  model throughout, and means the asset pipeline must have an upload path from day one rather than
  a build-time-only one.

---

## 7. Supplied content — Smart Logistics & Services Ltd

Provided by the client for seeding, to be refined into concise corporate copy and, wherever
possible, replaced by illustration and animation rather than rendered as prose. Recorded raw here;
the refined bilingual version lives in the guide.

**Positioning.** Your trusted partner in the CEMAC region. Built for compliance, visibility and
dependable execution — operating from Douala as a gateway to the CEMAC region.

**Facts.** Founded 2021 · Base: Douala · Focus: CEMAC region.

**Overview.** Founded in 2021, Smart Logistics & Services Ltd has expanded rapidly from customs
brokerage to a full-service 3PL provider. Based in Douala, it serves as the gateway to the CEMAC
region.

**Mission.** To revolutionise the logistics landscape by delivering solutions that not only meet but
exceed customers' expectations; to create an environment that ignites passion, fuels creativity and
inspires the team to provide unparalleled customer experiences; to build a legacy on reliability,
flexibility and customer satisfaction.

**Vision.** To be the logistics leader of choice, setting the standard for excellence in Cameroon and
the CEMAC subregion, and the benchmark against which others are measured.

**Operational emphasis.** Disciplined processes and regulatory compliance · visibility and control
across complex operating environments · dependable last-mile delivery for project-driven operations ·
systems, expertise and partnerships for seamless cross-border trade · built to support trade
corridors as regional supply chains expand.

**Guiding principles.** Customer delight · team empowerment · excellence.

**Message from the CEO — Timothée MASSOMBA, Chief Executive Officer.** Logistics as a strategic
driver of trade, growth and competitiveness; responsibility beyond moving cargo — delivering control,
visibility and reliable execution in complex operating environments. From headquarters in Douala,
operating at a critical gateway to the CEMAC region and the wider African market, supporting
international organisations, multinationals and project-driven operations that require disciplined
processes, regulatory compliance and dependable last-mile delivery. Africa is entering an enhanced
phase of economic integration through the African Continental Free Trade Area; as cross-border flows
increase and supply chains become more regional, the need for efficient freight forwarding, customs
brokerage, coordinated transport and trusted project execution will intensify. Ambition: to be a
long-term logistics authority and a preferred gateway for regional and international trade.

**ESG — Environment.** Route optimisation to reduce fuel consumption and emissions · responsible
handling of hazardous and regulated cargo · waste reduction and recycling within warehouse
operations · gradual transition toward fuel-efficient fleets and equipment · compliance with local
and international environmental regulations.

**ESG — Social.** Strict health, safety and security standards across operations · continuous
training for operational and compliance staff · ethical labour practices and zero tolerance for
discrimination · support for humanitarian, development and NGO supply chains · local workforce
engagement within the CEMAC region.

**ESG — Governance.** Governed by a Strategic Planning Committee and an Operational Excellence
Committee. Clear accountability and decision-making structures · compliance with customs, trade and
international logistics standards · risk mitigation and internal control procedures · ethical
business conduct and transparency.

---

## 8. Status

**Round 1 and round 2 answered.** The engineering guide —
`doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md`, five PRs, with a progress log and a coverage percentage
updated on every PR completion — is **paused pending the Smart Logistics asset drop**, at the
client's instruction. It resumes on receipt.
