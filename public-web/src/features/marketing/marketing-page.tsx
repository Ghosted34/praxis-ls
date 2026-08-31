import * as React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getLang, tList } from "@/lib/i18n";
import { usePublishedServices } from "@/lib/use-services";
import { pickSlug, pickText } from "@/lib/services-api";
import { listStories, type PortfolioCard } from "@/lib/portfolio-api";
import {
  listCorridors,
  MODE_ACCENT,
  type Corridor,
} from "@/lib/corridors-api";
import { Hero } from "@/components/site/hero";
import {
  MediaCard,
  MoreLink,
  Section,
  StepList,
} from "@/components/site/section";
import { PortalPreview, RouteGraphic } from "@/components/site/graphics";
import { PageShell } from "@/components/site/page-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ButtonLink } from "@/components/ui/button";
import {
  ArrowRightIcon,
  BoxIcon,
  DocumentIcon,
  ShipIcon,
  TruckIcon,
  WarehouseIcon,
} from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { ContactForm } from "@/components/site/contact-form";
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
 * One glyph per card, cycling with position.
 *
 * §7.3 is right that a tinted tile is the honest stand-in for a cover the tenant
 * has not uploaded — but it was drawn with `BoxIcon` on all four cards, and four
 * identical glyphs in a row is the thing that reads as unfinished. Repetition is
 * what a visitor notices, not absence.
 *
 * The cycle is keyed on POSITION, never on what the card says. Matching a glyph
 * to a tenant-authored name ("a ship for the sea-freight profile") means this
 * file guessing at the meaning of strings it did not write, in two languages,
 * and being wrong on the first tenant who writes "Maritime & Air". Position is a
 * fact; the service's mode is not ours to infer. `BoxIcon` stays in the cycle as
 * the neutral member rather than as the default for everything.
 */
const CARD_ICONS = [ShipIcon, DocumentIcon, WarehouseIcon, TruckIcon, BoxIcon];

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
        to: p(`/services/${pickSlug(s, lang)}`),
      }))
    : tList<{ t: string; d: string }>("site.services.items").map((i) => ({
        key: i.t,
        title: i.t,
        desc: i.d,
        // The dict fallback describes what a service TYPE does; there is no
        // tenant artwork behind it, and N12 forbids inventing one.
        image: null as string | null,
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
        {items.map((s, i) => (
          <Reveal as="li" key={s.key} delay={(i % 4) as 0 | 1 | 2 | 3}>
            <MediaCard
              className="h-full"
              image={s.image}
              imageAlt={s.title || ""}
              // The dict fallback has no artwork by design (N12), and the four
              // text boxes that produced were the flattest thing on the home
              // page. A glyph tile is the honest stand-in (§7.3) — one glyph
              // PER CARD, so the row reads as four things rather than one
              // repeated four times.
              icon={CARD_ICONS[i % CARD_ICONS.length]}
              title={s.title}
              to={s.to}
              linkLabel={t("site.services.more")}
            >
              {s.desc}
            </MediaCard>
          </Reveal>
        ))}
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
                  <span className="num text-xs">{s.published_month}</span>
                ) : null}
              </MediaCard>
            </Reveal>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * The lanes panel — the proof a tenant has before they have written any.
 *
 * ── WHY A LIST AND NOT A MAP ───────────────────────────────────────────────
 *
 * `geo_place` carries latitude and longitude, so a world map with arcs is one
 * projection away and it is the obvious thing to build. It is also the thing
 * that turns eight aggregated rows into a picture of somebody's network: an arc
 * drawn between two points invites the reader to trace it, and the endpoints are
 * exactly what the k-anonymity floor spent its design on protecting. A list
 * states the same fact — this lane, this often — and states it once.
 *
 * A list is also the honest shape for the data: these rows are ordered by volume
 * and that order is the information. A map has no first row.
 */
function CorridorPanel({ lanes }: { lanes: Corridor[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border bg-[var(--secondary)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 pb-4 pt-5 md:px-6">
        <h3 className="font-display text-title font-semibold tracking-tight">
          {t("site.proof.lanes")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("site.proof.lanesSub")}
        </p>
      </div>
      {/* Hairline-separated rows rather than cards: eight cards is a grid of
          boxes competing with the four service cards directly above, and these
          are rows of a ledger, which is what they should look like. */}
      <ul className="border-t">
        {lanes.map((lane) => {
          const accent = MODE_ACCENT[lane.mode];
          return (
            <li
              key={`${lane.origin}-${lane.destination}-${lane.mode}`}
              className="flex items-center gap-4 border-b bg-background px-5 py-3.5 last:border-b-0 md:px-6"
            >
              <span
                aria-hidden
                className="h-8 w-1 shrink-0 rounded-full"
                style={{
                  background: accent
                    ? `rgb(var(--mode-${accent}))`
                    : "var(--border)",
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-semibold tracking-tight">
                  {lane.origin}
                  <span aria-hidden className="mx-2 text-muted-foreground">
                    &rarr;
                  </span>
                  {lane.destination}
                </p>
                {lane.origin_country || lane.destination_country ? (
                  <p className="micro mt-0.5 normal-case">
                    {[lane.origin_country, lane.destination_country]
                      .filter(Boolean)
                      .join(" \u2192 ")}
                  </p>
                ) : null}
              </div>
              <p className="shrink-0 text-right">
                <span className="num font-mono text-sm font-semibold tabular-nums">
                  {lane.files}
                </span>
                <span className="micro ml-2 normal-case">
                  {t("site.proof.files")}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </div>
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
      // Muted: without it this band sits between two plain ones and the middle
      // third of the home page reads as a single undifferentiated column (§6.4).
      variant="muted"
      eyebrow={t("site.portalBand.eyebrow")}
      title={t("site.portalBand.title")}
      lead={t("site.portalBand.sub")}
      divided
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
          <p className="mt-4 text-sm text-muted-foreground">
            {t("site.portalBand.invited")}{" "}
            <Link
              to="/portal/set-password"
              className="text-primary-ink underline underline-offset-4"
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

/** The general enquiry — the form for a visitor who is NOT buying: a supplier, a
 *  journalist, someone whose file has gone wrong. Both write to the tenant's
 *  inbound queue and both come back with a reference, which is the part the
 *  current marketing page omits: a public form with no receipt is a form whose
 *  sender can never prove they sent it. */
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
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card padded>
          <ContactForm />
        </Card>
        <dl className="space-y-5">
          {promise.map((p) => (
            <div key={p.t}>
              <dt className="text-sm font-semibold">{p.t}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{p.d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
