import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBranding } from "@/app/branding";
import { TrackWidget } from "./track-widget";
import { RouteGraphic } from "./graphics";

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
export function Hero() {
  const { t } = useTranslation();
  const { login } = useBranding();
  const image = login?.backgroundUrl || null;

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
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(100deg, color-mix(in srgb, var(--hero) 95%, transparent) 34%, color-mix(in srgb, var(--hero) 72%, transparent) 100%)",
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
          <p className="eyebrow text-[var(--brand-orange)]">
            {t("site.hero.eyebrow")}
          </p>
          <h1 className="hero-title mt-4 text-[var(--hero-foreground)]">
            {t("site.hero.title")}
          </h1>
          <p className="mt-5 max-w-measure text-lg text-[var(--hero-muted)]">
            {t("site.hero.sub")}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {/* A plain anchor for the in-page jump: the browser's own
                `scroll-behavior: smooth` does the work, `#quote` survives being
                pasted into a chat, and a router navigation to the same URL would
                only re-render what is already mounted. */}
            <a
              href="#quote"
              className="btn-primary inline-flex h-11 items-center rounded-[calc(var(--radius)-2px)] px-6 text-[0.9375rem] font-semibold"
            >
              {t("site.hero.cta")}
            </a>
            <Link
              to="/public/track"
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
