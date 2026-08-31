import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getStory,
  listStories,
  type PortfolioCard,
  type PortfolioStory,
} from "@/lib/portfolio-api";
import { PublicApiError, messageFor } from "@/lib/api";
import { listCorridors, type Corridor } from "@/lib/corridors-api";
import { CorridorPanel } from "@/components/site/corridor-panel";
import { currentLocale, tStatic } from "@/lib/i18n";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { MediaCard, MoreLink, Section } from "@/components/site/section";
import { Card } from "@/components/ui/card";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState } from "@/components/state";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Chip } from "@/components/ui/pill";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { p } from "@/lib/base-path";
import { ButtonLink } from "@/components/ui/button";
import { BoltIcon, DocumentIcon } from "@/components/ui/icons";
import { SectionHead } from "@/components/site/section-head";
import { BadgePill } from "@/components/ui/badge-pill";
import { Reveal } from "@/components/ui/reveal";

/**
 * `/public/portfolio` and `/public/portfolio/:slug` — published case notes, from
 * `GET /public/portfolio[/:slug]`.
 *
 * ── WHY THE GALLERY IS ALLOWLIST-DRIVEN ────────────────────────────────────
 *
 * `portfolio_public.service.js` composes every media URL from a `*_allowed` flag
 * and returns `null` when the flag is not set: a story can exist with a cover the
 * tenant never marked public. So this page renders `cover_url` and nothing else —
 * it does not build `/api/tenant/public/portfolio/media/<id>` out of the id it can
 * see, which would be a frontend re-implementing an allowlist it does not have a
 * copy of, and would leak exactly the files the flag exists to hold back.
 *
 * ── WHY THE KPI BLOCK IS RENDERED AS WRITTEN ───────────────────────────────
 *
 * `{label, value}` pairs come back pre-formatted ("42 TEU", "−9 days"). They are
 * the tenant's numbers, published deliberately, so they are shown with no
 * formatting, no rounding and no "results may vary" hedge added by us: the second
 * the scaffold starts decorating figures it has to explain where the decoration
 * came from. What it does add is structure — `dl/dt/dd`, so a screen reader
 * announces the pair rather than two adjacent numbers.
 *
 * An empty list is an honest empty state. There is no fallback set of invented
 * case notes here (N12), because a fabricated "how we moved a factory" story on a
 * logistics site is the fastest way to lose the buyer it was meant to catch.
 */
export function PortfolioIndexPage() {
  const { t } = useTranslation();
  const [rows, setRows] = React.useState<PortfolioCard[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /* The lanes, for the empty case only — and fetched unconditionally beside the
     stories rather than after them, because a page that waits for one empty
     answer before asking the next question spends two round trips to show
     nothing. The home page's proof band makes the same call for the same
     reason. */
  const [lanes, setLanes] = React.useState<Corridor[] | null>(null);

  React.useEffect(() => {
    let alive = true;
    listStories()
      .then((r) => alive && setRows(Array.isArray(r) ? r : []))
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof PublicApiError && (e.isNotFound || e.status === 403))
          setRows([]);
        else setError(messageFor(e, tStatic("errors.loadFailed")));
      });
    listCorridors()
      .then((r) => alive && setLanes(Array.isArray(r) ? r : []))
      // FEATURE_DISABLED is a configuration state, not an outage: no lanes, no
      // noise.
      .catch(() => alive && setLanes([]));
    return () => {
      alive = false;
    };
  }, []);

  useDocumentMeta({
    title: t("site.portfolioPage.title"),
    description: t("site.portfolioPage.sub"),
  });

  return (
    <PageShell label={t("site.portfolioPage.title")}>
      <Section
        eyebrow={t("site.proof.eyebrow")}
        eyebrowIcon={DocumentIcon}
        title={t("site.portfolioPage.titleMain")}
        accent={t("site.portfolioPage.titleAccent")}
        lead={t("site.portfolioPage.sub")}
        // Index page with no hero band — this is the page h1.
        titleAs="h1"
      >
        {error ? (
          <ErrorState message={error} />
        ) : rows === null ? (
          <div className="grid gap-5 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
        ) : !rows.length ? (
          /* Two answers, in descending order of what they prove — the same pair
             the home page's proof band offers, and deliberately the same
             component rather than a second version of it.

             No case notes does not mean nothing to show. The lanes are not copy:
             they are a GROUP BY over completed itinerary legs, floored so that
             no corridor can identify a client's shipment. N12 forbids inventing
             proof; it does not forbid counting it. Below the floor, or before
             the ledger has enough history, the honest sentence is still the
             answer. */
          lanes && lanes.length ? (
            <CorridorPanel lanes={lanes} />
          ) : (
            <EmptyState
              title={t("site.portfolioPage.empty")}
              hint={t("site.proof.empty")}
            />
          )
        ) : (
          <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((s, i) => (
              <Reveal as="li" key={s.slug} delay={(i % 3) as 0 | 1 | 2}>
                <MediaCard
                  className="h-full"
                  image={s.cover_url}
                  imageAlt={s.client_name || s.title}
                  // A story whose cover the tenant never marked public is the
                  // normal case, not the exception — the allowlist nulls it.
                  icon={DocumentIcon}
                  eyebrow={s.client_name || undefined}
                  title={s.title}
                  to={p(`/portfolio/${encodeURIComponent(s.slug)}`)}
                  linkLabel={t("site.proof.more")}
                >
                  {s.service_category ? (
                    <Chip>{s.service_category}</Chip>
                  ) : null}
                </MediaCard>
              </Reveal>
            ))}
          </ul>
        )}
      </Section>

      {/* The alternating surface, and the way out of a page whose whole job is
          to make somebody want one (§4 pattern 6). */}
      <Section
        variant="muted"
        divided
        eyebrow={t("site.quote.kicker")}
        eyebrowIcon={BoltIcon}
        title={t("site.quote.title")}
        lead={t("site.quote.sub")}
      >
        <ButtonLink to={p("/quote")} size="lg">
          {t("site.quote.bandCta")}
        </ButtonLink>
      </Section>
    </PageShell>
  );
}

/** One case note. */
export function PortfolioStoryPage() {
  const { t } = useTranslation();
  const { slug = "" } = useParams();
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "found"; story: PortfolioStory }
    | { kind: "gone" }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  React.useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    getStory(decodeURIComponent(slug))
      .then((story) => alive && setState({ kind: "found", story }))
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof PublicApiError && (e.isNotFound || e.status === 403)) {
          setState({ kind: "gone" });
          return;
        }
        setState({
          kind: "error",
          message: messageFor(e, tStatic("errors.loadFailed")),
        });
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  const story = state.kind === "found" ? state.story : null;

  useDocumentMeta({
    title: story
      ? `${story.title} · ${t("site.portfolioPage.title")}`
      : undefined,
    description: story?.headline || undefined,
  });

  if (state.kind === "loading") {
    return (
      <PageShell label={t("site.portfolioPage.title")}>
        <PageContainer>
          <PageSkeleton rows={6} cols={2} />
        </PageContainer>
      </PageShell>
    );
  }

  if (state.kind === "error") {
    return (
      <PageShell label={t("site.portfolioPage.title")}>
        <PageContainer>
          <ErrorState message={state.message} />
        </PageContainer>
      </PageShell>
    );
  }

  if (!story) {
    return (
      <PageShell label={t("site.portfolioPage.unavailable")}>
        <Section title={t("site.portfolioPage.unavailable")}>
          <div className="max-w-prose">
            <p className="text-sm text-muted-foreground">
              {t("site.portfolioPage.empty")}
            </p>
            <div className="mt-5">
              <MoreLink to={p("/portfolio")}>
                {t("site.portfolioPage.back")}
              </MoreLink>
            </div>
          </div>
        </Section>
      </PageShell>
    );
  }

  const kpis = Array.isArray(story.kpis)
    ? story.kpis.filter((k) => k && (k.label || k.value))
    : [];
  const gallery = Array.isArray(story.gallery_urls) ? story.gallery_urls : [];
  const month =
    story.published_month || story.published_at
      ? new Intl.DateTimeFormat(currentLocale(), {
          month: "long",
          year: "numeric",
        }).format(
          new Date(story.published_month || (story.published_at as string)),
        )
      : null;

  return (
    <PageShell label={story.title}>
      <article>
        <section className="band band-muted">
          <PageContainer size="reading">
            <nav aria-label={t("site.portfolioPage.title")} className="mb-6">
              <Link
                to={p("/portfolio")}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                {t("site.portfolioPage.back")}
              </Link>
            </nav>
            {story.cover_url ? (
              <img
                src={story.cover_url}
                alt={story.client_name || story.title}
                className="mb-8 aspect-[21/9] w-full rounded-[calc(var(--radius)+4px)] border object-cover"
              />
            ) : null}
            <BadgePill>
              {story.service_category || t("site.proof.eyebrow")}
            </BadgePill>
            <SectionHead
              className="mt-4"
              as="h1"
              title={story.title}
              lead={story.headline || undefined}
            />
            <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {story.client_name ? <Chip>{story.client_name}</Chip> : null}
              {month ? (
                <span className="num">
                  {t("site.servicesPage.updated")} {month}
                </span>
              ) : null}
            </div>
          </PageContainer>
        </section>

        <Section divided>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {/* The narrative, which a reader scrolls to. The KPI panel beside
                it gets its own Reveal rather than sharing this one: on a phone
                they stack, and one wrapper would hold the figures hidden until
                the prose above them had arrived. */}
            <Reveal className="min-w-0 max-w-prose space-y-8">
              {story.executive_summary ? (
                <div>
                  <h2 className="text-h3 font-semibold tracking-tight">
                    {t("site.portfolioPage.summary")}
                  </h2>
                  <div className="prose-site mt-3">
                    <p>{story.executive_summary}</p>
                  </div>
                </div>
              ) : null}
              {story.operations_execution ? (
                <div>
                  <h2 className="text-h3 font-semibold tracking-tight">
                    {t("site.portfolioPage.execution")}
                  </h2>
                  <div className="prose-site mt-3">
                    <p>{story.operations_execution}</p>
                  </div>
                </div>
              ) : null}

              {gallery.length > 0 && (
                <figure>
                  <div className="grid grid-cols-2 gap-3">
                    {gallery.slice(0, 4).map((u) => (
                      <img
                        key={u}
                        src={u}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="aspect-[4/3] w-full rounded-[calc(var(--radius)-2px)] border object-cover"
                      />
                    ))}
                  </div>
                  <figcaption className="mt-2 text-xs text-muted-foreground">
                    {t("site.servicesPage.gallery")}
                  </figcaption>
                </figure>
              )}
            </Reveal>

            <Reveal className="space-y-6" delay={1}>
              {kpis.length > 0 && (
                <Panel title={t("site.portfolioPage.results")} titleAs="h2">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
                    {kpis.map((k) => (
                      <div key={`${k.label}-${k.value}`}>
                        <dt className="micro">{k.label}</dt>
                        <dd className="num mt-1 text-h3 font-semibold leading-none tracking-tight">
                          {k.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Panel>
              )}
              {story.client_name ? (
                <Card padded>
                  <p className="micro">{t("site.portfolioPage.client")}</p>
                  <div className="mt-2 flex items-center gap-3">
                    {story.client_logo_url ? (
                      <img
                        src={story.client_logo_url}
                        alt={story.client_name}
                        className="h-8 w-auto max-w-24 object-contain object-left"
                      />
                    ) : null}
                    <p className="text-sm font-medium">{story.client_name}</p>
                  </div>
                </Card>
              ) : null}
              <MoreLink to={p("/quote")}>{t("site.hero.cta")}</MoreLink>
            </Reveal>
          </div>
        </Section>
      </article>
    </PageShell>
  );
}
