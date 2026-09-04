import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBranding } from "@/app/branding";
import { TrackWidget } from "./track-widget";
import { SectionHead } from "./section-head";
import { RouteGraphic } from "./graphics";
import { p } from "@/lib/base-path";

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

export function Hero({ copy = null }: { copy?: HeroCopy | null }) {
  const { t } = useTranslation();
  const { branding, login } = useBranding();
  // The tenant's own marketing artwork first; their login backdrop second.
  //
  // The fallback is not tidiness — it is the migration. Until `site/hero` existed
  // this band could only show `login.backgroundUrl`, so every tenant who wanted a
  // photograph here set one there. Preferring the new field without the fallback
  // would blank the hero for all of them on deploy, to fix a problem they had
  // already worked around.
  const image = branding?.siteHeroUrl || login?.backgroundUrl || null;

  return (
    <section className="band-hero relative overflow-hidden">
      {image ? (
        <>
          <img
            src={image}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/*
            THE SCRIM, AND THE NUMBERS IN IT.

            What was here was a flat wash, carbon 95% → 72% across the band. It
            kept every pixel of copy safe and made the photograph invisible: 72%
            carbon over even a bright image is still, to the eye, a black
            rectangle. A tenant could upload artwork and see no difference, and
            the hero read as a SaaS band rather than a freight company's door.

            The binding constraint is the EYEBROW, not the headline — which is
            the opposite of what it looks like. Measured against the worst case a
            tenant can upload (a blown-out, near-white photo), the minimum scrim
            opacity for each piece of hero copy is:

              headline  #edeeee  large   3.0:1 needed   α ≥ 0.48
              sub-line  #9ea1a4  normal  4.5:1 needed   α ≥ 0.82
              eyebrow   #ff5a00  small   4.5:1 needed   α ≥ 0.87   ← binds

            So 0.90 is the floor anywhere copy sits, and the reveal has to come
            from where copy ISN'T. Two layers rather than one, because the layout
            changes shape: at lg the copy is a left column and the track card
            holds the right, so the scrim can fall away horizontally; below lg the
            two stack and copy spans the full width, so it can only fall away
            downward, under the card.
          */}
          <div
            aria-hidden
            className="absolute inset-0 lg:hidden"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--hero) 94%, transparent) 0%, color-mix(in srgb, var(--hero) 90%, transparent) 58%, color-mix(in srgb, var(--hero) 55%, transparent) 100%)",
            }}
          />
          <div
            aria-hidden
            className="absolute inset-0 hidden lg:block"
            style={{
              background:
                "radial-gradient(118% 130% at 20% 50%, color-mix(in srgb, var(--hero) 95%, transparent) 0%, color-mix(in srgb, var(--hero) 92%, transparent) 44%, color-mix(in srgb, var(--hero) 46%, transparent) 74%, color-mix(in srgb, var(--hero) 20%, transparent) 100%)",
            }}
          />
        </>
      ) : null}

      {/* Structure, not decoration: the node network sits behind the copy at a
          low opacity so the band reads as a route diagram rather than a black
          rectangle, and `pointer-events-none` keeps it out of the tab order. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[46%] opacity-[0.16] lg:block"
      >
        <RouteGraphic className="h-full w-full text-[var(--hero-foreground)]" />
      </div>

      <div className="wrap relative grid items-center gap-10 py-14 md:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:py-24">
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
          <SectionHead
            onDark
            as="h1"
            titleClass="hero-title"
            eyebrow={copy ? copy.kicker : t("site.hero.eyebrow")}
            title={copy ? copy.title : t("site.hero.titleMain")}
            accent={copy ? undefined : t("site.hero.titleAccent")}
            lead={copy ? copy.lead : t("site.hero.sub")}
          />

          <div className="mt-8 flex flex-wrap items-center gap-3">
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

        <div className="track-widget p-5 md:p-6">
          <p className="micro">{t("site.track.kicker")}</p>
          <h2 className="mt-1 font-display text-h3 font-semibold leading-tight tracking-tight">
            {t("site.track.title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("site.track.hint")}
          </p>
          <div className="mt-4">
            <TrackWidget variant="compact" />
          </div>
          <Link
            to="/portal/login"
            className="mt-4 inline-flex text-sm text-primary-ink underline-offset-4 hover:underline"
          >
            {t("site.chrome.portalEntry")}
          </Link>
        </div>
      </div>
    </section>
  );
}
