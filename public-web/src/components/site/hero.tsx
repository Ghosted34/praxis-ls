import * as React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBranding } from "@/app/branding";
import { cn } from "@/lib/cn";
import { TrackWidget } from "./track-widget";
import { SectionHead } from "./section-head";
import { RouteCanvas } from "./route-canvas";
import { usePointerLight, useTilt } from "@/lib/motion";
import { useInView, useRevealed } from "@/components/ui/reveal";
import { StagedLines, WeightScrub } from "@/components/ui/type";
import { p } from "@/lib/base-path";
/*
 * THIS BAND'S OWN STYLESHEET, AND WHY IT IS AN IMPORT RATHER THAN MORE OF
 * `index.css`.
 *
 * Everything in it is mounted here and nowhere else, and this component is
 * reachable only from `marketing-page.tsx`, which `router.tsx` loads with
 * `React.lazy`. In `index.css` those rules sat on the first-paint path of every
 * route in the app — the track page, the portal login, a policy page — none of
 * which can render a hero. Imported here, Rollup attaches them to the marketing
 * chunk instead, which is the only chunk that can use them.
 *
 * O-13 held this back until PR #330: both gates read `src/index.css` and only
 * that file, so splitting would have bought first-paint headroom by making them
 * blind to the thing being moved. They walk every stylesheet under `src/` now.
 * The file's own header carries the rest, including why nothing in it is in an
 * `@layer`.
 */
import "./hero.css";

/**
 * The hero — a dark plate, one promise, two ways out.
 *
 * ── WHAT THE LAYOUT IS DOING (the maersk.com borrow, specifically) ─────────
 *
 * The category's front doors — Maersk, CMA CGM, MSC, DHL — put the same three
 * things in the first screenful in the same order: a headline that names the
 * service rather than the brand's feelings, the functional box most visitors came
 * for, and one commercial CTA. The reason is audience arithmetic: on a freight
 * site far more people are checking something that already exists than shopping
 * for something new, and a hero optimised for the smaller group fails the
 * majority. So the lookup sits ON the hero — the only input above the fold — and
 * the CTA is "Request a quote", not "Sign in": a visitor who already has
 * credentials was sent a direct link and is not deciding here.
 *
 * ── WHY THE ART IS A DRAWING UNLESS THE TENANT SUPPLIES A PHOTO ─────────────
 *
 * No stock imagery (N12: nothing invented, including a stranger's face). If the
 * tenant has uploaded a login background on Settings → Login, that artwork is
 * theirs and gets used — under a scrim, because `BRAND_GUIDELINES.md` forbids
 * placing the identity on a photograph without a solid plate, and because white
 * type over an unknown JPEG is a contrast gamble that only looks fine in the
 * design file.
 *
 * ── WHAT PR 3 ADDED, AND WHAT IT DELIBERATELY DID NOT TOUCH ───────────────
 *
 * Guide §7.1 asks for depth, a stated light source, and a route network that is
 * alive rather than drawn. It also states, in the same breath, that this is the
 * LCP ELEMENT: nothing on this path may wait for a lazy import, so everything
 * below is statically imported and the canvas is hand-written rather than
 * pulled from a package.
 *
 * WHAT DID NOT CHANGE, ON PURPOSE: the two-layer scrim and its measured
 * opacities, and the track widget's place in the layout. The scrim's numbers
 * are re-stated below with their derivation because §7.1 requires any new
 * treatment to re-derive them or keep them — this keeps them, and the pointer
 * light is applied UNDER the scrim so it cannot spend them (see `.hero-light`
 * in index.css for why that is a guarantee rather than a hope). The track
 * widget's real estate is not up for redesign either; it gains material and
 * depth, not demotion.
 *
 * ── WHY `--brand-orange` FOR THE EYEBROW AND NOT `--primary-ink` ───────────
 *
 * The `.eyebrow` recipe sets `--primary-ink`, which is the AA-corrected orange
 * for TYPE ON WHITE (#C74600, 4.88:1). On carbon it measures about 3.4:1 and
 * fails, while the brand colour itself (#FF5A00) measures 6.33:1. That asymmetry
 * is documented in `@praxis/brand` as a property of the colour, not an
 * oversight — so a dark band uses the fill value as text, which is what the ink
 * step-down exists to make unnecessary on light grounds.
 */
/**
 * What a tenant-authored `hero` block supplies, already read in the visitor's
 * language. Absent on every tenant who has not published one, which is the
 * normal case and why every field below has a dictionary fallback beside it.
 */
export type HeroCopy = {
  kicker: string;
  title: string;
  lead: string;
  ctaLabel: string;
  ctaHref: string;
};

/**
 * THE SCRIM FLOORS, AS NUMBERS A TEST CAN READ.
 *
 * These were a comment. Guide §7.1 requires any new treatment of this band to
 * "re-derive them or keep them", and a comment cannot enforce that — the next
 * person to make the photograph more visible will nudge a percentage in a
 * gradient string and no gate will notice, because nothing in the tree knows
 * these numbers mean anything.
 *
 * So they are constants, `hero.test.tsx` asserts every stop where copy sits is
 * at or above the binding floor, and changing one now means changing a test
 * that says what it protects.
 *
 * The derivation, unchanged. Measured against the worst case a tenant can
 * upload — a blown-out, near-white photograph — the minimum scrim opacity for
 * each piece of hero copy is:
 *
 *   headline  #edeeee  large   3.0:1 needed   α ≥ 0.48
 *   sub-line  #9ea1a4  normal  4.5:1 needed   α ≥ 0.82
 *   eyebrow   #ff5a00  small   4.5:1 needed   α ≥ 0.87   ← binds
 */
export const SCRIM_FLOOR = 0.87;

/**
 * THE BEAM'S BRIGHTNESS CEILING, AS A NUMBER A TEST CAN READ.
 *
 * Same argument as `SCRIM_FLOOR` above, for the same element. The pass lightens
 * the ground behind the copy, and the eyebrow — #ff5a00 at 11px, needing 4.5:1 —
 * is what breaks first, exactly as it is for the scrim. On carbon:
 *
 *     a = 0.18   ground L = 0.0196   eyebrow 4.96:1
 *     a = 0.22   ground L = 0.0237   eyebrow 4.56:1   ← the ceiling
 *     a = 0.26   ground L = 0.0281   eyebrow 4.30:1   ✗
 *
 * The value that actually paints is `--beam-peak` in index.css, because that is
 * where the gradient is; this is the ceiling it is held to, and `hero.test.tsx`
 * reads both and compares them. Neither the contrast gate nor the motion gate
 * can catch this on its own — one measures token pairs, the other durations,
 * and a passing light is neither.
 */
export const BEAM_PEAK = 0.22;

/**
 * The two scrims, as stop lists rather than as strings.
 *
 * `over` marks the stops that sit under copy. Those are held to `SCRIM_FLOOR`;
 * the rest are where the photograph is allowed to come through, which is the
 * whole reason this is two layers and not one flat wash. The layout changes
 * shape at `lg` — copy is a left column with the track card on the right, so
 * the scrim can fall away horizontally; below `lg` the two stack and copy spans
 * the full width, so it can only fall away downward, under the card.
 */
const SCRIM_STACKED = {
  shape: "linear-gradient(180deg",
  stops: [
    { at: "0%", alpha: 0.94, over: true },
    { at: "58%", alpha: 0.9, over: true },
    { at: "100%", alpha: 0.55, over: false },
  ],
} as const;

const SCRIM_SPLIT = {
  shape: "radial-gradient(118% 130% at 20% 50%",
  stops: [
    { at: "0%", alpha: 0.95, over: true },
    { at: "44%", alpha: 0.92, over: true },
    { at: "74%", alpha: 0.46, over: false },
    { at: "100%", alpha: 0.2, over: false },
  ],
} as const;

/** Both scrims are the same colour at different strengths, so the recipe is
 *  written once. `--hero` is the band's own ground token, never a literal. */
const scrimCss = (scrim: { shape: string; stops: ReadonlyArray<{ at: string; alpha: number }> }) =>
  `${scrim.shape}, ${scrim.stops
    .map((s) => `color-mix(in srgb, var(--hero) ${Math.round(s.alpha * 100)}%, transparent) ${s.at}`)
    .join(", ")})`;

/** Exported for the test that holds the floors. */
export const HERO_SCRIMS = { stacked: SCRIM_STACKED, split: SCRIM_SPLIT, css: scrimCss };

export function Hero({ copy = null }: { copy?: HeroCopy | null }) {
  const { t } = useTranslation();
  const { branding, login } = useBranding();
  /*
   * ONE CONTRACT, TWO INPUTS.
   *
   * `usePointerLight` and `useTilt` both write `--lx` / `--ly` on the element
   * they are attached to, so the CSS below reads one pair of properties and
   * does not care whether a cursor or a gyroscope moved them (§5.4). Each hook
   * declines the input that is not its own — the pointer hook skips coarse
   * pointers, the tilt hook needs a `DeviceOrientationEvent` — so attaching
   * both to the same node is how a laptop and a phone get the same effect from
   * the hardware each actually has.
   *
   * Neither ever prompts. iOS gates the gyroscope behind a gesture-initiated
   * permission dialog, and §5.4 rules that out on load: `state.needsPermission`
   * is reported and the hero simply does not tilt, which is a designed state.
   * The set piece (§7.5) is where the explicit opt-in affordance lives, because
   * that is a scene a visitor has chosen to engage with. A permission dialog on
   * the front door is what Q5 settled against, and it does not become
   * acceptable because the sensor is cheaper than a camera.
   */
  const lightRef = usePointerLight<HTMLElement>();
  const tilt = useTilt<HTMLElement>({ max: 18 });
  /*
   * TWO OBSERVERS, TWO DIFFERENT QUESTIONS, BOTH SHARED.
   *
   * `useRevealed` answers "has this arrived yet" once and unobserves — it
   * drives the entrance sequence, which must never re-run. `useInView` answers
   * "is it on screen right now", continuously — it is the only thing that lets
   * the beam's loop run, so a hero four screens above the reader is not
   * spending a phone's battery on a light show nobody can see.
   *
   * Both ride the shared instances in reveal.tsx. Neither is a new observer,
   * which is the rule that file states and the reason `useInView` was built
   * there rather than here.
   */
  const [liveRef, live] = useInView<HTMLDivElement>();
  const [enterRef, entered] = useRevealed<HTMLDivElement>();
  /* Both hooks hand back `RefObject`, whose `current` React types as readonly —
     it is the shape you ATTACH, not the shape you assign. Two hooks want the
     same node, so one of them has to be written by hand, and the cast is the
     honest way to say that rather than duplicating the element. */
  const bandRef = React.useCallback(
    (el: HTMLElement | null) => {
      (lightRef as React.MutableRefObject<HTMLElement | null>).current = el;
      (tilt.ref as React.MutableRefObject<HTMLElement | null>).current = el;
    },
    [lightRef, tilt.ref],
  );
  // The tenant's own marketing artwork first; their login backdrop second.
  //
  // The fallback is not tidiness — it is the migration. Until `site/hero` existed
  // this band could only show `login.backgroundUrl`, so every tenant who wanted a
  // photograph here set one there. Preferring the new field without the fallback
  // would blank the hero for all of them on deploy, to fix a problem they had
  // already worked around.
  const image = branding?.siteHeroUrl || login?.backgroundUrl || null;

  return (
    /* `vignette` darkens the corners of whatever photograph the tenant
       uploaded, which is where an unlucky image puts something bright directly
       under the navigation. Costs nothing, needs no per-image tuning, and gives
       every photograph the same contrast floor. */
    <section
      ref={bandRef}
      /* `data-live` is what unpauses the pass. It is an attribute rather than a
         class because it is STATE, not styling: the CSS reads
         `.band-hero[data-live="true"]`, and a reader of either file can see at a
         glance that nothing animates until the band says it is visible. */
      data-live={live ? "true" : "false"}
      className="band-hero vignette relative overflow-hidden"
    >
      {image ? (
        <>
          <img
            src={image}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/*
            THE LIGHT, WHICH THIS BAND HAS BEEN DESCRIBING AND NOT RENDERING.

            `.hero-light` has been in index.css since PR 3, with a note in this
            file saying "the pointer light is applied UNDER the scrim so it
            cannot spend them". It was never mounted. The comment was true about
            the design and false about the page, which is the worst combination
            — every later reader trusted it.

            It is inside the `image` branch, and that is the whole safety
            argument rather than an accident of where it was typed. The
            derivation the scrim floors rest on is "lightening cannot take an
            image past white, so the copy's contrast is bounded below by the
            near-white case that was measured". That argument needs a scrim
            above the light, and the scrims only exist when there is a
            photograph. On a band with no upload there is no scrim, so the same
            glow would lighten the carbon directly under the copy — where the
            eyebrow, at 4.5:1, is the thing that breaks first.
          */}
          <div aria-hidden className="hero-light" />
        </>
      ) : null}

      {/* THE PASS — AND IT IS MOUNTED HERE, BETWEEN THE LIGHT AND THE SCRIMS,
          FOR THE SAME REASON THE LIGHT IS WHERE IT IS.

          One raked beam crosses the band every `--beam-cycle`, passing BEHIND
          the headline word by word and handing off to the plate's edge as it
          leaves — one event, two consumers, one token.

          Paint order is the whole safety argument, and it is why this sits in
          its own block between two conditionals rather than tidily inside one
          of them. With a tenant photograph the scrims below render AFTER it and
          therefore above it, so the wash that caps the image caps the beam and
          the measured floors bind unchanged. Without one there is no scrim, and
          the beam is on bare carbon under the copy at `--beam-peak` — 22 %,
          derived against the eyebrow in the token block. Either way no type on
          this band changes colour as the beam passes; only the ground behind it
          does.

          The long note on `.hero-beam-track` in index.css carries the rest: why
          a loop is allowed here at all, why it stops when the band is off
          screen, why each layer's BASE style is already its settled state so
          the reduced-motion umbrella leaves the band correct, and what the
          first draft of this did to the eyebrow when the beam was on top
          instead. */}
      <div ref={liveRef} aria-hidden className="hero-beam-track">
        <span className="hero-beam" />
      </div>

      {image ? (
        <>
          {/*
            THE SCRIM, AND THE NUMBERS IN IT.

            What was here before was a flat wash, carbon 95% → 72% across the
            band. It kept every pixel of copy safe and made the photograph
            invisible: 72% carbon over even a bright image is still, to the eye,
            a black rectangle. A tenant could upload artwork and see no
            difference, and the hero read as a SaaS band rather than a freight
            company's door.

            The binding constraint is the EYEBROW, not the headline — which is
            the opposite of what it looks like. The measurement and the floor it
            produces are `SCRIM_FLOOR` at the top of this file, where a test can
            reach them; the reveal comes from where copy ISN'T, which is why
            this is two layers and not one.
          */}
          <div
            aria-hidden
            className="absolute inset-0 lg:hidden"
            style={{ background: HERO_SCRIMS.css(SCRIM_STACKED) }}
          />
          <div
            aria-hidden
            className="absolute inset-0 hidden lg:block"
            style={{ background: HERO_SCRIMS.css(SCRIM_SPLIT) }}
          />        </>
      ) : null}

      {/* Structure, not decoration — and now alive.
 
          This was `RouteGraphic`, a static SVG whose dashes marched. It said
          "these are routes"; §7.1 asks for "these are routes in use", so the
          drawing became a canvas that carries cargo along the lanes in the
          harmonised mode colours (see route-canvas.tsx for why a canvas rather
          than twenty animated SVG nodes on the LCP element).
 
          It keeps everything that made the SVG safe here: `aria-hidden`,
          `pointer-events-none`, low alpha behind the copy, and — new — it stops
          when the hero scrolls away and renders one settled frame under reduced
          motion. `RouteGraphic` is still the right drawing elsewhere and is
          untouched; the proof band and the empty states use it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[52%] lg:block"
      >
        <RouteCanvas className="h-full w-full" alpha={0.42} />
      </div>

      <div
        ref={enterRef}
        className="wrap tilt-stage relative grid items-center gap-10 py-14 md:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:py-24"
      >
        <div className="max-w-prose">
          {/* The shared heading block. This hero was the LAST hand-rolled
              eyebrow + h1 in the app — the most-seen heading on the site, and
              the one a sweep is most likely to skip because it lives in a
              component rather than on a page. `onDark` is what makes the
              eyebrow the brand fill rather than the AA-corrected ink: on carbon
              the ink step-down measures 3.4:1 and fails, and the note at the top
              of this file records why that is a property of the colour. */}
          {/* The tenant's headline, or ours.
 
              The dictionary version is split across `titleMain` and
              `titleAccent` so the second half carries the accent colour — the
              §4 pattern-2 treatment. A tenant-authored title is ONE string and
              stays one colour, deliberately: splitting somebody else's sentence
              at a word we picked, in two languages, is a decision about their
              writing that we do not get to make. They get their words; the
              accent is what they trade for writing them. */}
          {/* §7.1's two type primitives, on the one headline that earns them.
 
              `StagedLines` splits at RENDER and staggers in CSS — never on a
              timer — and puts the whole sentence on the container as
              `aria-label`, so a screen reader announces one heading rather than
              nine words. `WeightScrub` wraps the contents INCLUDING the accent
              word (that is what `titleWrapper` exists for): a headline whose
              first half thickens on scroll while its accent stays put is a
              headline that looks broken, not composed.
 
              `hero-lit` is the §5.3 light model applied to type — the shadow
              falls away from the pointer light. On a carbon ground under light
              copy that ADDS separation from the photograph, so it spends none
              of the scrim's measured contrast. */}
          <SectionHead
            onDark
            as="h1"
            titleClass="hero-title hero-lit"
            titleWrapper={(children) => (
              <WeightScrub as="span" from={520} to={700}>
                {children}
              </WeightScrub>
            )}
            eyebrowClass={cn("hero-enter hero-enter-eyebrow", entered && "is-in")}
            leadClass={cn("hero-enter hero-enter-lead", entered && "is-in")}
            eyebrow={copy ? copy.kicker : t("site.hero.eyebrow")}
            title={
              /* `paintImmediately` because this headline IS the LCP element.
                 Text at zero opacity is not painted, so the default fade-in
                 delays the page's largest paint by its own entrance — measured
                 at +691 ms — in exchange for a reveal that fires instantly
                 anyway, the hero being in view at load. The words still stagger;
                 they are simply legible while they arrive.
 
                 `masked` is the same constraint honoured a second time. A word
                 rising out of a clipped edge is the reveal this band wanted, and
                 a clip tall enough to hide the word first would cost the same
                 691 ms in a different property — clipped text is no more painted
                 than transparent text. So the clip is sized to the glyphs and
                 the travel is 0.4em: four-fifths of every word is painted on the
                 first frame, and the fifth that is cut is the fifth the eye
                 reads as an edge. Measured over seven loads of the built page,
                 248 ms median either way, the H1 both times.
 
                 `startDelay` opens the line at 80 ms rather than at zero, so the
                 eyebrow above it is already there when the headline moves. */
              <StagedLines
                paintImmediately
                masked
                startDelay={80}
                wordClassName="hero-word-light"
                text={copy ? copy.title : t("site.hero.titleMain")}
              />
            }
            accent={
              /* THE ACCENT WORD GETS THE ONLY FADE ON THIS BAND, AND THE BEAT
                 BEFORE IT IS THE POINT.
 
                 340 ms is after the last word of the line has started moving
                 (80 + four steps of 45), so the sentence lands, holds for a
                 breath, and then the word that carries the promise arrives on
                 its own — rising and fading up in the accent colour rather than
                 merely being present in it.
 
                 It can afford what the rest of the line cannot. LCP measures the
                 headline BLOCK, and one short word out of six is a sliver of its
                 area: the h1 still paints on the first frame. That is the whole
                 reason the split exists — the expensive effect is spent where it
                 is cheap, and only there.
 
                 A tenant-authored title is one string and gets no accent at all
                 (the note above the component records why), so this is the
                 dictionary path only. */
              copy ? undefined : (
                /* `wordOffset` is the count of words in the line above, so the
                   accent word is the SIXTH light in the pass rather than a
                   second first. The dictionary line is "Freight that moves your
                   business" in English and "Le fret qui fait avancer" in French
                   — five words either way, which is luck rather than design, so
                   it is counted rather than typed. */
                <StagedLines
                  masked
                  startDelay={340}
                  wordOffset={
                    (copy ? "" : t("site.hero.titleMain")).trim().split(/\s+/)
                      .length
                  }
                  wordClassName="hero-word-light hero-word-light-accent"
                  text={t("site.hero.titleAccent")}
                />
              )
            }
            lead={copy ? copy.lead : t("site.hero.sub")}
          />

          <div
            className={cn(
              "hero-enter hero-enter-cta mt-8 flex flex-wrap items-center gap-3",
              entered && "is-in",
            )}
          >
            {/* A route, not an in-page jump. This was `href="#quote"` back when
                the form was a band below — which meant the primary CTA on the
                site depended on a scroll landing on an element the lazy chunk
                had rendered. It is a page now, so the link is a link. */}
            {/* An INTERNAL path only. The block schema also admits mailto,
                tel and https, and `p()` would prefix the site base onto those
                and produce `/public/https://…`. A router `<Link>` cannot leave
                the app anyway, so anything that is not a rooted path falls back
                to the quote page rather than rendering a dead button. */}
            <Link
              to={
                copy?.ctaHref?.startsWith("/") ? p(copy.ctaHref) : p("/quote")
              }
              className="btn-primary inline-flex h-11 items-center rounded-[calc(var(--radius)-2px)] px-6 text-[0.9375rem] font-semibold"
            >
              {copy?.ctaLabel || t("site.hero.cta")}
            </Link>
            <Link
              to={p("/track")}
              className="btn-ghost-hero inline-flex h-11 items-center rounded-[calc(var(--radius)-2px)] px-5 text-[0.9375rem] font-semibold"
            >
              {t("site.hero.cta2")}
            </Link>
          </div>
        </div>

        {/* `.track-widget` carries the glass itself — see its note in
            index.css on why stacking `.glass` here would lose the cascade.
 
            `.tilt-plate` adds §7.1's depth rung 2 on top of it: a real rotation
            in the stage's perspective, three degrees at the most, which goes
            flat the moment anybody focuses a field inside. The widget keeps its
            real estate and gains material — that audience arithmetic is not up
            for redesign, and this is not a demotion of it. */}
        {/* THE ENTRANCE IS A WRAPPER, AND IT HAS TO BE.
 
            `.tilt-plate` owns `transform` on the plate and rewrites it every
            frame from the pointer. An entrance animating the same property
            would either be wiped by the first mouse movement or wipe the tilt,
            depending on which won the cascade — and it would look correct in
            review either way, because a still screenshot cannot show a conflict
            that only appears once the pointer moves. Two transforms, two
            elements, `preserve-3d` on the wrapper so it does not flatten the
            rotation it contains. */}
        <div
          className={cn(
            "hero-plate-enter hero-enter-plate",
            entered && "is-in",
          )}
        >
          <div className="track-widget tilt-plate p-5 md:p-6">
            {/* The sheen, and the ring that catches the beam. Both are
                decoration on a pane of glass: hidden from assistive technology,
                deaf to the pointer, and drawn UNDER the contents — the ring sits
                at `inset: -1px`, outside the padding box, so nothing here can
                come between a finger and the field. */}
            <span aria-hidden className="hero-plate-glare" />
            <span aria-hidden className="hero-beam-edge" />
            {/* Positioned, so it paints above the glare. An in-flow child would
                render BENEATH a positioned sibling however late it appears in
                the markup, which is the one ordering rule that catches everyone
                exactly once. */}
            <div className="relative">
              {/* The plate is dark glass in both themes now (see
                  `.track-widget`), so its accent type takes the same swap the
                  hero eyebrow beside it takes: `.micro` carries the light-theme
                  muted ink, which measures 3.37:1 on this ground and fails.
                  `--brand-orange` is 6.44:1 here.
 
                  It is Praxis's orange rather than the tenant's for the same
                  reason the eyebrow and the accent word are — that colour was
                  measured on carbon and `--primary-ink` was not. The beam and
                  the glass tint DO use the tenant's `--primary`, because those
                  are light rather than type and carry no contrast duty. The
                  note on `.hero-beam-track` records the follow-up that would
                  make all four of them the tenant's. */}
              <p
                className={cn(
                  "micro",
                  "text-[rgb(var(--brand-orange))]", // ink-on-dark: 6.44:1 on the carbon under --hero-plate; --primary-ink is ~3.4:1 there
                )}
              >
                {t("site.track.kicker")}
              </p>
              <h2 className="mt-1 font-display text-h3 font-semibold leading-tight tracking-tight">
                {t("site.track.title")}
              </h2>
              <p className="mt-2 text-sm text-[var(--hero-muted)]">
                {t("site.track.hint")}
              </p>
              <div className="mt-4">
                {/* `onDark` at last. The prop has existed since the widget was
                    written, for the case where the plate is dark — which, until
                    this change, the hero's plate only was when the visitor had
                    switched the whole site to dark mode. */}
                <TrackWidget variant="compact" onDark shimmer />
              </div>
              <Link
                to="/portal/login"
                className={cn(
                  "mt-4 inline-flex text-sm underline-offset-4 hover:underline",
                  "text-[rgb(var(--brand-orange))]", // ink-on-dark: 6.44:1 on the carbon under --hero-plate; --primary-ink is ~3.4:1 there
                )}
              >
                {t("site.chrome.portalEntry")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
