import * as React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getLang, tList } from "@/lib/i18n";
import { usePublishedServices } from "@/lib/use-services";
import { pickSlug, pickText } from "@/lib/services-api";
import { listStories, type PortfolioCard } from "@/lib/portfolio-api";
import { listCorridors, type Corridor } from "@/lib/corridors-api";
import { Hero } from "@/components/site/hero";
import {
  MediaCard,
  MoreLink,
  Section,
  StepList,
} from "@/components/site/section";
import { CorridorPanel } from "@/components/site/corridor-panel";
import { PortalPreview, RouteGraphic } from "@/components/site/graphics";
import { ProofStrip } from "@/components/site/proof-strip";
import { PageShell } from "@/components/site/page-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ButtonLink } from "@/components/ui/button";
import { ArrowRightIcon, BoxIcon, DocumentIcon } from "@/components/ui/icons";
import {
  IDENTITY_COUNT,
  serviceColor,
  serviceIdentity,
} from "@/lib/service-identity";
import { Reveal } from "@/components/ui/reveal";
import { p } from "@/lib/base-path";

/**
 * The marketing home — `/public`.
 *
 * ── SECTION ORDER, WHICH IS NOT DECORATIVE ────────────────────────────────
 *
 * Maersk's front page runs: lookup → services → how-we-work → proof → commercial
 * CTA. That is a persuasion sequence borrowed from industrial procurement, not
 * from consumer landing pages: establish that the company can do the thing, that
 * the reader understands what working with them feels like, that someone else has
 * already been carried through it — and only THEN ask for the enquiry. The order
 * matters more than any single band, so the quote form sits sixth of six and the
 * track widget sits first, because the track widget is why half of this page's
 * audience came.
 *
 * ── WHAT IS NOT HERE ──────────────────────────────────────────────────────
 *
 * No metric strip, no logo wall, no testimonial, no "since 2009". The backend
 * exposes no public statistics, no client logos and no quotes, and
 * `WEB_BUILD_BRIEF.md` N12 forbids inventing one — a fabricated "98 % on-time" on
 * a scaffold is not a placeholder, it is a lie a tenant has to find and delete
 * before launch, and the ones they miss are the ones that end up in front of a
 * procurement officer. The proof band therefore shows the tenant's published case
 * notes or a sentence saying there are none yet, which is the only honest version
 * of that section this product can currently render.
 *
 * ── ONE `<h1>` PER PAGE ────────────────────────────────────────────────────
 *
 * The hero owns it; every band below is a `Section`, whose default heading is
 * `h2` (N10). Adding a second h1 to "make the CTA band shout" is how the heading
 * outline stops meaning anything to a screen reader.
 */
export function MarketingPage() {
  const { t } = useTranslation();
  return (
    <PageShell label={t("site.hero.title")}>
      <Hero />
      {/* Directly under the hero, on the hero's own ground: a visitor who
          scrolls one screen has seen a number, a certification and a network
          name — or, on a tenant who has authored none, nothing at all. */}
      <ProofStrip />
      <ServicesBand />
      <HowBand />
      <ProofBand />
      <PortalBand />
      <QuoteBand />
      <ContactBand />
    </PageShell>
  );
}

/**
 * One IDENTITY per card, cycling with position — glyph, mode colour and code
 * together, from `lib/service-identity.ts`.
 *
 * It was a glyph cycle here, for the reason that still governs the table: four
 * identical stroke icons in a row is what reads as unfinished, and repetition
 * is what a visitor notices rather than absence. Colour and a code now travel
 * with the glyph because the three have to agree — a card whose panel is green
 * and whose tile is blue is not one card, it is two half-designed ones.
 *
 * The cycle is keyed on POSITION, never on what the card says. Matching an
 * identity to a tenant-authored name means guessing at the meaning of strings
 * we did not write, in two languages, and being wrong on the first tenant who
 * writes "Maritime & Air". The service-identity module records the rest.
 */

/** Dict fallback under the tenant's real profiles.
 *
 *  An unconfigured workspace must not launch a homepage with an empty services
 *  band, so the four generic cards in `site.services.items` stand in until
 *  `GET /public/services` answers. They describe what THIS product's service types
 *  do — they name no client, no volume and no lane the tenant has not published,
 *  which is the line N12 draws. The moment real profiles exist they win outright:
 *  `services.length` is the switch, not a merge, so a tenant never sees a card
 *  they did not write. */
function ServicesBand() {
  const { t } = useTranslation();
  const lang = getLang();
  const { services, disabled, failed } = usePublishedServices();

  const items = services.length
    ? services.map((s) => ({
        key: s.service_type_id,
        title: pickText(s, "name", lang),
        desc: pickText(s, "short_description", lang),
        // The API returns a cover per service type and `MediaCard` has always
        // accepted one — this band was the only caller that dropped it, so the
        // home page showed four text boxes for services the /public/services
        // index renders as image cards. `ProofBand` below passes the same field
        // to the same component.
        image: s.cover_url,
        // The tenant's own brand token for this line (migration 12755). The
        // positional palette below is what runs when this is null.
        accent: s.accent as string | null,
        // The one emphasised line closing the card, authored per service.
        claim: pickText(s, "claim", lang),
        to: p(`/services/${pickSlug(s, lang)}`),
      }))
    : tList<{ t: string; d: string }>("site.services.items").map((i) => ({
        key: i.t,
        title: i.t,
        desc: i.d,
        // The dict fallback describes what a service TYPE does; there is no
        // tenant artwork behind it, and N12 forbids inventing one.
        image: null as string | null,
        // A dict card is not a tenant service, so it has no tenant choice to
        // honour — it takes the positional colour and nothing else, and it has
        // no claim, because a claim is a thing a tenant says about their own
        // operation (N12).
        accent: null as string | null,
        claim: null as string | null,
        to: p("/quote"),
      }));

  return (
    <Section
      id="services"
      eyebrow={t("site.services.eyebrow")}
      eyebrowIcon={BoxIcon}
      title={t("site.services.title")}
      lead={t("site.services.sub")}
      aside={
        services.length ? (
          <MoreLink to={p("/services")}>{t("site.services.all")}</MoreLink>
        ) : undefined
      }
      divided
    >
      <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Four, and the aside links to the rest. Four is the width of the
            identity palette, so this row is the one place on the site where no
            two cards can share a colour — which is what makes the palette read
            as four service lines rather than as decoration. A tenant with
            eleven published services shows all eleven on /services, where
            repetition past the fourth is the honest cost of a four-colour set. */}
        {items.slice(0, IDENTITY_COUNT).map((s, i) => {
          const identity = serviceIdentity(i);
          return (
            <Reveal as="li" key={s.key} delay={(i % 4) as 0 | 1 | 2 | 3}>
              <MediaCard
                className="h-full"
                image={s.image}
                imageAlt={s.title || ""}
                // The dict fallback has no artwork by design (N12), and the
                // four text boxes that produced were the flattest thing on the
                // home page. The composed panel is the honest stand-in (§7.3):
                // it says "a service, and that one", which is true, rather than
                // standing in for a photograph nobody took.
                icon={identity.icon}
                mode={identity.mode}
                accent={s.accent}
                code={identity.code}
                footer={
                  s.claim ? (
                    <p
                      className="mt-3 text-sm font-semibold"
                      style={{ color: serviceColor(s.accent, identity.mode) }}
                    >
                      {s.claim}
                    </p>
                  ) : undefined
                }
                title={s.title}
                to={s.to}
                linkLabel={t("site.services.more")}
              >
                {s.desc}
              </MediaCard>
            </Reveal>
          );
        })}
      </ul>
      {(disabled || failed) && !services.length ? (
        <p className="mt-6 text-xs text-muted-foreground">
          {t("site.servicesPage.empty")}
        </p>
      ) : null}
    </Section>
  );
}

/** Three steps, three endpoints: `POST /public/intake/quote-requests`, the quote
 *  the desk writes back, and the milestone ledger `GET /public/tracking/:ref`
 *  reads. The band is a description of the product, not an invention about it. */
function HowBand() {
  const { t } = useTranslation();
  const steps = tList<{ t: string; d: string }>("site.how.steps").map((s) => ({
    title: s.t,
    body: s.d,
  }));
  return (
    <Section
      id="how"
      variant="muted"
      eyebrow={t("site.how.eyebrow")}
      title={t("site.how.title")}
      lead={t("site.how.sub")}
      divided
    >
      {/* Reveal wraps blocks a reader scrolls TO. It never wraps a form, a
          control, or the answer to a query somebody just submitted: a field
          that fades in under a thumb is a field that gets mis-tapped, which is
          why the contact form below keeps its plain first paint. */}
      <Reveal>
        <StepList steps={steps} />
      </Reveal>
    </Section>
  );
}

/** Published case notes, straight from `GET /public/portfolio`. */
function ProofBand() {
  const { t } = useTranslation();
  const [stories, setStories] = React.useState<PortfolioCard[] | null>(null);
  /* Corridors are the SECOND-choice proof and are fetched unconditionally
     anyway: the request is one cheap aggregate, it starts in parallel with the
     stories rather than after them, and a band that waits for one empty answer
     before asking the next question spends two round trips to show nothing. */
  const [lanes, setLanes] = React.useState<Corridor[] | null>(null);

  React.useEffect(() => {
    let alive = true;
    listStories()
      .then((rows) => alive && setStories(Array.isArray(rows) ? rows : []))
      .catch(() => alive && setStories([]));
    listCorridors()
      .then((rows) => alive && setLanes(Array.isArray(rows) ? rows : []))
      // A tenant without the `website` feature answers FEATURE_DISABLED here,
      // which is a configuration state and not an outage: no lanes, no noise.
      .catch(() => alive && setLanes([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Section
      id="work"
      eyebrow={t("site.proof.eyebrow")}
      title={t("site.proof.title")}
      lead={t("site.proof.sub")}
      aside={
        <MoreLink to={p("/portfolio")}>{t("site.services.all")}</MoreLink>
      }
      divided
    >
      {stories === null ? (
        <div className="grid gap-5 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : !stories.length ? (
        /* Three answers, in descending order of what they prove.
 
           No case notes does not mean nothing to show. The lanes below are not
           copy — they are a GROUP BY over completed itinerary legs, floored so
           that no corridor can identify a client's shipment — so they say
           something true about this business without anybody writing a sentence.
           N12 forbids inventing proof; it does not forbid counting it.
 
           Below the floor, or before the ledger has enough history, the answer is
           the honest sentence it always was — now inside a composed panel with
           the brand's own route drawing, which names no port and no number,
           rather than floating alone in a 200px band. */
        lanes && lanes.length ? (
          <CorridorPanel lanes={lanes} />
        ) : (
          <div className="grid items-center gap-8 rounded-[var(--radius)] border bg-[var(--secondary)] p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:p-8">
            <p className="max-w-prose text-sm text-muted-foreground">
              {t("site.proof.empty")}
            </p>
            <div aria-hidden className="opacity-[0.55]">
              <RouteGraphic className="text-foreground" />
            </div>
          </div>
        )
      ) : (
        <ul className="grid gap-5 md:grid-cols-3">
          {stories.slice(0, 3).map((s, i) => (
            <Reveal as="li" key={s.slug} delay={(i % 3) as 0 | 1 | 2}>
              <MediaCard
                className="h-full"
                image={s.cover_url}
                imageAlt={s.client_name || s.title}
                icon={DocumentIcon}
                eyebrow={s.client_name || undefined}
                title={s.title}
                to={p(`/portfolio/${encodeURIComponent(s.slug)}`)}
                linkLabel={t("site.proof.more")}
              >
                {s.published_month ? (
                  <span className="num font-mono text-xs">
                    {s.published_month}
                  </span>
                ) : null}
              </MediaCard>
            </Reveal>
          ))}
        </ul>
      )}
    </Section>
  );
}


/** "Your account is here." Deliberately placed after the proof and before the
 *  form: a visitor who already has credentials should not be walked through a
 *  quote-request flow to reach the sign-in they came for.
 *
 *  The preview panel next to it is a DRAWING, not a screenshot — see
 *  `components/site/graphics.tsx`. A screenshot of a session in this product is
 *  a screenshot of somebody's data, and any real reference in it would be either
 *  a secret or a fake; the mock is labelled as a mock by its own typography. */
function PortalBand() {
  const { t } = useTranslation();
  const stages = tList<{ label: string; state: "done" | "current" | "next" }>(
    "site.preview.stages",
  );

  return (
    <Section
      id="portal"
      /*
        CARBON, and it is the only band on the page that is.

        Seven bands alternating #ffffff and #f7f8f8 — a 3% difference — divided
        by the same hairline means that after the hero the page never changes
        register again, and scrolling produces no events. This band is the right
        one to spend the change on: the mock's orange ticks gain enormous
        contrast on carbon, and the page acquires a landmark exactly halfway
        down.

        ONE dark band, not two. Two makes the page striped rather than
        punctuated, which is why the proof strip under the hero butts against
        the hero's own plate instead of standing as a second dark section.

        `divided` comes off with it: `rule-top` is a light-ground hairline, and
        a change of ground is already a stronger division than any rule.
      */
      variant="dark"
      eyebrow={t("site.portalBand.eyebrow")}
      title={t("site.portalBand.title")}
      lead={t("site.portalBand.sub")}
    >
      <Reveal className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/portal/login"
              className="btn-primary inline-flex h-11 items-center gap-2 rounded-[calc(var(--radius)-2px)] px-5 text-[0.9375rem] font-semibold"
            >
              {t("site.portalBand.cta")}
              <ArrowRightIcon size={16} />
            </Link>
          </div>
          {/* On carbon the light-ground text tokens do not carry: `--primary-ink`
              is the AA-corrected orange for type on WHITE and measures about
              3.4:1 here, while the brand fill measures 6.33:1. `hero.tsx`
              records why that asymmetry is a property of the colour rather than
              an oversight, and `SectionHead` makes the same swap for its
              eyebrow. */}
          <p className="mt-4 text-sm text-[var(--hero-muted)]">
            {t("site.portalBand.invited")}{" "}
            <Link
              to="/portal/set-password"
              className="text-[var(--brand-orange)] underline underline-offset-4"
            >
              {t("portal.setPasswordTitle")}
            </Link>
          </p>
        </div>
        <PortalPreview
          reference={t("site.preview.reference")}
          percent={68}
          statusLabel={t("site.preview.status")}
          stages={stages}
          /* The one deliberate overlap on the site. The card crosses the
             boundary into the band above, carrying `--shadow-l`, so the page
             acquires a foreground rather than a stack. `.band-overlap` is a
             media query rather than a Tailwind prefix because the pull is
             computed from `--py-band`, and it does not apply below lg, where
             the columns stack and the card would land on the copy. */
          className="band-overlap relative z-10"
        />
      </Reveal>
    </Section>
  );
}

/** The pitch for the quote desk, and the link to it.
 *
 *  `id="quote"` is kept because links to `…/#quote` are already in circulation
 *  — the hero CTA and the header button pointed here until the form got its own
 *  route — and this is where they should land. `Section`'s `scroll-mt-24` keeps
 *  the sticky header off the heading when one of those old links is followed. */
function QuoteBand() {
  const { t } = useTranslation();
  const steps = tList<{ t: string; d: string }>("site.quote.steps");

  return (
    <Section
      id="quote"
      title={t("site.quote.title")}
      lead={t("site.quote.sub")}
      divided
    >
      {/*
        A BAND that points at /quote, not the form itself.

        The wizard lives at its own route now (features/quote/quote-page.tsx
        records why the hash version was broken). Keeping a second copy here
        would mean two places to keep in step and would put the wizard, the
        place picker and the file reader into the home page's payload — which a
        visitor who came to read about services would download to scroll past.

        The `id="quote"` stays: links to `…/#quote` are already in circulation,
        and this is where they should land.
      */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card padded className="flex flex-col justify-center">
          <p className="max-w-measure text-muted-foreground">
            {t("site.quote.bandLead")}
          </p>
          <div className="mt-6">
            <ButtonLink to={p("/quote")} size="lg">
              {t("site.quote.bandCta")}
              <ArrowRightIcon size={16} className="ml-2" />
            </ButtonLink>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {t("site.quote.privacy")}
          </p>
        </Card>
        <div>
          <ol className="space-y-5">
            {steps.map((s, i) => (
              <li key={s.t} className="flex gap-3.5">
                <span
                  aria-hidden
                  className="num mt-0.5 text-micro font-semibold text-[var(--primary-ink)]"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{s.t}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-xs text-muted-foreground">
            {t("site.quote.requiredNote")}
          </p>
        </div>
      </div>
    </Section>
  );
}

/** The general enquiry — for a visitor who is NOT buying: a supplier, a
 *  journalist, someone whose file has gone wrong. It writes to the tenant's
 *  inbound queue and comes back with a reference, which is the part the previous
 *  marketing page omitted: a public form with no receipt is a form whose sender
 *  can never prove they sent it. */
function ContactBand() {
  const { t } = useTranslation();
  const promise = tList<{ t: string; d: string }>("site.contact.promise");

  return (
    <Section
      id="contact"
      variant="muted"
      title={t("site.contact.title")}
      lead={t("site.contact.sub")}
      divided
    >
      {/*
        A BAND that points at /contact, not the form itself — the same move the
        quote desk made two bands up, for the same two reasons: one copy of the
        form to keep in step rather than two, and a home page that does not make
        a visitor who came to read about services download it to scroll past.

        The `id="contact"` stays. Links to `…/#contact` are already in
        circulation — the header and the footer both pointed here until Contact
        got its own route — and this is where they should land.
      */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card padded className="flex flex-col justify-center">
          <p className="max-w-measure text-muted-foreground">
            {t("site.contact.bandLead")}
          </p>
          <div className="mt-6">
            <ButtonLink to={p("/contact")} size="lg">
              {t("site.contact.bandCta")}
              <ArrowRightIcon size={16} className="ml-2" />
            </ButtonLink>
          </div>
        </Card>
        <dl className="space-y-5">
          {promise.map((item) => (
            <div key={item.t}>
              <dt className="text-sm font-semibold">{item.t}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{item.d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
