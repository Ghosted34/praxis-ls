import * as React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getLang, tList } from "@/lib/i18n";
import { usePublishedServices } from "@/lib/use-services";
import { pickSlug, pickText } from "@/lib/services-api";
import { listStories, type PortfolioCard } from "@/lib/portfolio-api";
import { Hero } from "@/components/site/hero";
import {
  MediaCard,
  MoreLink,
  Section,
  StepList,
} from "@/components/site/section";
import { PortalPreview } from "@/components/site/graphics";
import { PageShell } from "@/components/site/page-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRightIcon } from "@/components/ui/icons";
import { QuoteForm } from "@/components/site/quote-form";
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
        to: p("#quote"),
      }));

  return (
    <Section
      id="services"
      eyebrow={t("site.services.eyebrow")}
      title={t("site.services.title")}
      lead={t("site.services.sub")}
      aside={
        services.length ? (
          <MoreLink to={p("/services")}>{t("site.services.all")}</MoreLink>
        ) : undefined
      }
      divided
    >
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((s) => (
          <MediaCard
            key={s.key}
            image={s.image}
            imageAlt={s.title || ""}
            title={s.title}
            to={s.to}
            linkLabel={t("site.services.more")}
          >
            {s.desc}
          </MediaCard>
        ))}
      </div>
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
      <StepList steps={steps} />
    </Section>
  );
}

/** Published case notes, straight from `GET /public/portfolio`. */
function ProofBand() {
  const { t } = useTranslation();
  const [stories, setStories] = React.useState<PortfolioCard[] | null>(null);

  React.useEffect(() => {
    let alive = true;
    listStories()
      .then((rows) => alive && setStories(Array.isArray(rows) ? rows : []))
      .catch(() => alive && setStories([]));
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
        <p className="max-w-prose text-sm text-muted-foreground">
          {t("site.proof.empty")}
        </p>
      ) : (
        <div className="grid gap-5 md:grid-cols-3">
          {stories.slice(0, 3).map((s) => (
            <MediaCard
              key={s.slug}
              image={s.cover_url}
              imageAlt={s.client_name || s.title}
              eyebrow={s.client_name || undefined}
              title={s.title}
              to={p(`/portfolio/${encodeURIComponent(s.slug)}`)}
              linkLabel={t("site.proof.more")}
            >
              {s.published_month ? (
                <span className="num text-xs">{s.published_month}</span>
              ) : null}
            </MediaCard>
          ))}
        </div>
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
      eyebrow={t("site.portalBand.eyebrow")}
      title={t("site.portalBand.title")}
      lead={t("site.portalBand.sub")}
      divided
    >
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
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
      </div>
    </Section>
  );
}

/** The quote desk. `id="quote"` is the target of the hero CTA and the header
 *  button; `Section`'s `scroll-mt-24` is what keeps the sticky header off the
 *  first field after the jump. */
function QuoteBand() {
  const { t } = useTranslation();
  const { services } = usePublishedServices();
  const steps = tList<{ t: string; d: string }>("site.quote.steps");

  return (
    <Section
      id="quote"
      title={t("site.quote.title")}
      lead={t("site.quote.sub")}
      divided
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card padded>
          <QuoteForm services={services} />
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
