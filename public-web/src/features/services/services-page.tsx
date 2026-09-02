import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getService,
  isFeatureDisabled,
  pickList,
  pickSlug,
  pickText,
  type ServiceProfile,
} from "@/lib/services-api";
import { PublicApiError, messageFor } from "@/lib/api";
import { currentLocale, getLang, setLang, tStatic } from "@/lib/i18n";
import { usePublishedServices } from "@/lib/use-services";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { MediaCard, MoreLink, Section } from "@/components/site/section";
import { Card } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { Panel } from "@/components/ui/panel";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/state";
import { PageSkeleton } from "@/components/ui/skeleton";
import {
  BoltIcon,
  BoxIcon,
  CheckIcon,
  ChevronDownIcon,
} from "@/components/ui/icons";
import {
  iconByName,
  serviceColor,
  serviceIdentity,
} from "@/lib/service-identity";
import { SectionHead } from "@/components/site/section-head";
import { BadgePill } from "@/components/ui/badge-pill";
import { Reveal } from "@/components/ui/reveal";
import { Markdown } from "@/components/ui/markdown";
import { QuoteWizard } from "@/components/site/quote-wizard";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { p } from "@/lib/base-path";

/**
 * `/public/services` and `/public/services/:slug` — the tenant's published service
 * profiles, off `GET /public/services[/:slug]`.
 *
 * ── WHY NOTHING HERE IS WRITTEN BY US ──────────────────────────────────────
 *
 * Every heading, paragraph, highlight and FAQ answer on these two pages is a row
 * the tenant authored in their admin and published to the web. The scaffold owns
 * the LAYOUT and the language handling; it owns no copy. The alternative — seeding a
 * "Sea Freight" page with invented transit times and included services — is the
 * failure `WEB_BUILD_BRIEF.md` N12 names, and it is more dangerous here than
 * anywhere else on the site, because a service page is the page a buyer forwards to
 * whoever signs.
 *
 * ── WHY THE OTHER LANGUAGE LINK IS A MAP LOOKUP ────────────────────────────
 *
 * `GET /public/services/:slug` returns `alternates: {en, fr}` because the profile
 * stores both slugs for one row. A switcher built on that map can promise the
 * equivalent page; a switcher built on "translate the URL" cannot, and the usual
 * fallback — send the unknown one to the homepage — strands a French reader on a
 * page they never asked for. No `alternates`, no switcher.
 */
export function ServicesIndexPage() {
  const { t } = useTranslation();
  const lang = getLang();
  const { groups, services, loading } = usePublishedServices();

  useDocumentMeta({
    title: `${t("site.servicesPage.title")} · ${t("site.hero.eyebrow")}`,
    description: t("site.servicesPage.sub"),
  });

  return (
    <PageShell label={t("site.servicesPage.title")}>
      <Section
        eyebrow={t("site.services.eyebrow")}
        eyebrowIcon={BoxIcon}
        title={t("site.servicesPage.title")}
        lead={t("site.servicesPage.sub")}
        // Index page with no hero band — this is the page h1.
        titleAs="h1"
      >
        {services.length ? (
          /* Pillars, not a list (migration 12755). A services page in this
             industry is a small number of named sections — Freight / Logistics /
             Value-Added — with the services underneath them and an anchor per
             section, and the flat grid this used to render could not express
             that however many cards it drew.

             `key` is the anchor and it is null for the trailing bucket the
             server collects unassigned services into. That bucket renders
             without a heading rather than under an invented one: every tenant
             starts there on the day the column ships, and a service returns
             there when its pillar is retired. */
          <div className="space-y-14">
            {groups.map((group, gi) => {
              const label =
                lang === "en"
                  ? group.name_en || group.name_fr
                  : group.name_fr || group.name_en;
              // Identity is indexed across the WHOLE page, not per pillar, so
              // the first card of the second pillar does not repeat the colour,
              // glyph and code of the first card of the first.
              const offset = groups
                .slice(0, gi)
                .reduce((n, g) => n + (g.services?.length || 0), 0);
              return (
                <section
                  key={group.key || `ungrouped-${gi}`}
                  id={group.key || undefined}
                  className="scroll-mt-24"
                >
                  {label ? (
                    /* The pillar's own icon, by name (12755). Unrecognised
                       names draw nothing rather than a fallback glyph: a
                       heading with no icon is a smaller failure than a heading
                       wearing the wrong one. */
                    <div className="mb-6 flex items-center gap-3">
                      {iconByName(group.icon) ? (
                        <IconTile icon={iconByName(group.icon)!} size="md" />
                      ) : null}
                      <h2 className="section-title">{label}</h2>
                    </div>
                  ) : null}
                  <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
                    {group.services.map((s, i) => {
                      // The same table the home page reads, indexed the same
                      // way, so a line keeps its colour, glyph and code between
                      // the two grids. `BoxIcon` on every card was the version
                      // of this that made an eleven-service index look like one
                      // card repeated eleven times.
                      const identity = serviceIdentity(offset + i);
                      return (
                        <Reveal
                          as="li"
                          key={s.service_type_id}
                          // Staggered by COLUMN, the way the insights grid is: a
                          // card in the fourth row must not wait for the three
                          // above it.
                          delay={(i % 3) as 0 | 1 | 2}
                        >
                          <MediaCard
                            className="h-full"
                            image={s.cover_url}
                            imageAlt={pickText(s, "name", lang) || ""}
                            // A tenant with one photograph and four services
                            // gets one illustrated card and three text boxes
                            // without this.
                            icon={identity.icon}
                            mode={identity.mode}
                            accent={s.accent}
                            code={identity.code}
                            /* The closing proof line (12755). It is deliberately
                               NOT `highlights[0]` — the migration rejects that
                               positional convention — so it renders as the
                               card's footer, below the description and above
                               the link, in the card's own colour. */
                            footer={
                              pickText(s, "claim", lang) ? (
                                <p
                                  className="mt-3 text-sm font-semibold"
                                  style={{
                                    color: serviceColor(
                                      s.accent,
                                      identity.mode,
                                    ),
                                  }}
                                >
                                  {pickText(s, "claim", lang)}
                                </p>
                              ) : undefined
                            }
                            eyebrow={s.published_month || undefined}
                            title={
                              pickText(s, "name", lang) || pickSlug(s, lang)
                            }
                            to={p(
                              `/services/${encodeURIComponent(pickSlug(s, lang))}`,
                            )}
                            linkLabel={t("site.services.more")}
                          >
                            {pickText(s, "short_description", lang)}
                          </MediaCard>
                        </Reveal>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : loading ? (
          <PageSkeleton rows={3} cols={3} />
        ) : (
          // Every not-loading, no-rows case lands here — a tenant who has
          // published nothing, a disabled `website` feature, a failed fetch.
          // They are one screen on purpose: the visitor's next move is the same
          // in all three, and a skeleton that never resolves (which is what the
          // old ordering produced for the 200-empty case) is the one answer that
          // helps nobody.
          //
          // No quote button here: the band below is the same offer, and two CTAs
          // a screen apart read as a page unsure what it wants.
          <EmptyState title={t("site.servicesPage.empty")} />
        )}
      </Section>

      {/* The alternating surface §4 pattern 6 asks for — and the one band this
          page was missing: an index that ends on its own grid ends with no way
          out. The copy is the quote desk's own, not a second version of it. */}
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

type DetailState =
  | { kind: "loading" }
  | { kind: "found"; profile: ServiceProfile }
  | { kind: "gone" }
  | { kind: "error"; message: string };

/** One profile. The slug may be EITHER language's: the server resolves both
 *  columns, so a French link pasted into an English reader's browser still lands
 *  on the page, in the reader's language. */
export function ServiceDetailPage() {
  const { t } = useTranslation();
  const { slug = "" } = useParams();
  const lang = getLang();
  const [state, setState] = React.useState<DetailState>({ kind: "loading" });
  /* The published list, for identity only — it is the module-cached read the
     index page and the footer already share, so this costs no request. A line's
     colour has to be the SAME colour it had on the card the visitor clicked, and
     the only stable key for that is its position in the published order. */
  const { services } = usePublishedServices();

  React.useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    getService(decodeURIComponent(slug))
      .then((profile) => alive && setState({ kind: "found", profile }))
      .catch((e: unknown) => {
        if (!alive) return;
        // A disabled web module and an unpublished slug look the same to a
        // stranger, so they get the same page: the list, and the quote form.
        if (
          isFeatureDisabled(e) ||
          (e instanceof PublicApiError && e.isNotFound)
        ) {
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
    // `lang` is a dependency because the payload is bilingual and the endpoint is
    // keyed by slug — a French slug fetched while the reader switches to English
    // must re-read, or the page keeps the other language's `alternates`.
  }, [slug, lang]);

  const profile = state.kind === "found" ? state.profile : null;

  useDocumentMeta(
    profile
      ? {
          title:
            pickText(profile, "meta_title", lang) ||
            `${pickText(profile, "name", lang)} · ${t("site.services.eyebrow")}`,
          description: pickText(profile, "meta_description", lang) || undefined,
          alternates: {
            en: p(`/services/${encodeURIComponent(profile.slug_en)}?lang=en`),
            fr: p(`/services/${encodeURIComponent(profile.slug_fr)}?lang=fr`),
          },
        }
      : { title: t("site.servicesPage.unavailable") },
  );

  if (state.kind === "loading") {
    return (
      <PageShell label={t("site.servicesPage.title")}>
        <PageContainer>
          <PageSkeleton rows={6} cols={2} />
        </PageContainer>
      </PageShell>
    );
  }

  if (state.kind === "error") {
    return (
      <PageShell label={t("site.servicesPage.title")}>
        <PageContainer>
          <ErrorState message={state.message} />
        </PageContainer>
      </PageShell>
    );
  }

  if (!profile) {
    return (
      <PageShell label={t("site.servicesPage.unavailable")}>
        <Section title={t("site.servicesPage.unavailable")}>
          <div className="max-w-prose">
            <p className="text-sm text-muted-foreground">
              {t("site.servicesPage.empty")}
            </p>
            <div className="mt-5">
              <MoreLink to={p("/services")}>
                {t("site.services.all")}
              </MoreLink>
            </div>
          </div>
        </Section>
      </PageShell>
    );
  }

  /* `-1` until the list arrives, or for a profile the list does not carry — a
     slug reached directly while `GET /public/services` was refused, say. No
     index, no colour: a bar in the wrong colour is worse than no bar, because
     the whole claim of the palette is that the colour identifies the line. */
  const identityIndex = services.findIndex(
    (row) => row.service_type_id === profile.service_type_id,
  );
  const identity = identityIndex < 0 ? null : serviceIdentity(identityIndex);

  const name = pickText(profile, "name", lang) || "";
  const shortText = pickText(profile, "short_description", lang);
  const longText = pickText(profile, "long_description", lang);
  const highlights = pickList(profile, "highlights", lang);
  const coverage = pickText(profile, "coverage", lang);
  const gallery = Array.isArray(profile.gallery_urls)
    ? profile.gallery_urls
    : [];
  const faq = Array.isArray(profile.faq) ? profile.faq : [];
  const related = Array.isArray(profile.related) ? profile.related : [];
  const altLang = lang === "en" ? "fr" : "en";
  const altSlug = profile.alternates?.[altLang];
  const month = profile.published_month
    ? new Intl.DateTimeFormat(currentLocale(), {
        month: "long",
        year: "numeric",
      }).format(new Date(profile.published_month))
    : null;

  /**
   * The bands below the body alternate their surface (§4 pattern 6), and both
   * the FAQ and the related list are optional — a profile with no FAQ would
   * otherwise show two plain bands in a row, which is the flatness the pattern
   * exists to break. So the surface is DERIVED from how many bands have
   * actually been emitted, in render order, rather than typed onto each one.
   */
  const emitted: Array<"default" | "muted"> = [];
  const nextSurface = (): "default" | "muted" => {
    const v: "default" | "muted" =
      emitted.length % 2 === 0 ? "muted" : "default";
    emitted.push(v);
    return v;
  };

  return (
    <PageShell label={name}>
      {/* Muted: the body band below it is plain, and a plain hero over a plain
          band is the two-adjacent-surfaces case §6.4 rules out.

          The 6px rule across the top is the same identity the card carried in
          the grid, full-bleed: a reader who clicked a green card lands on a page
          that is still green, which is what "recognisable by colour before it is
          read" has to mean if it is to mean anything past the index. */}
      <section
        className="band band-muted"
        style={
          identity
            ? {
                borderTop: `6px solid ${serviceColor(profile.accent, identity.mode)}`,
              }
            : undefined
        }
      >
        <PageContainer size="reading">
          <nav aria-label={t("site.services.eyebrow")} className="mb-6">
            <Link
              to={p("/services")}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              {t("site.servicesPage.back")}
            </Link>
          </nav>
          {/* The shared heading block, not a hand-rolled eyebrow and h1 — the
              regression §9 tells a reviewer to catch. The name is the tenant's
              own row, so it carries no accent word: splitting somebody else's
              service name across two colours is a decision we do not get to
              make for them. */}
          <div className="flex flex-wrap items-center gap-3">
            <BadgePill>{t("site.services.eyebrow")}</BadgePill>
            {identity ? (
              <span
                className="font-mono text-[11px] font-semibold tracking-tight"
                style={{
                  color: serviceColor(profile.accent, identity.mode),
                }}
              >
                {identity.code}
              </span>
            ) : null}
          </div>
          <SectionHead
            className="mt-4"
            as="h1"
            title={name}
            lead={shortText || undefined}
          />
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {month ? (
              <span className="text-muted-foreground">
                {t("site.servicesPage.updated")}{" "}
                <span className="num font-mono">{month}</span>
              </span>
            ) : null}
            {altSlug ? (
              <button
                type="button"
                onClick={() => {
                  setLang(altLang);
                  // A full navigation, not a router push: the URL's slug changes
                  // language too, and the new page must boot with the new `lang`
                  // already in effect rather than re-render on stale state.
                  window.location.assign(
                    p(`/services/${encodeURIComponent(altSlug)}`),
                  );
                }}
                className="text-primary-ink underline underline-offset-4"
              >
                {altLang === "fr"
                  ? t("site.chrome.toFrench")
                  : t("site.chrome.toEnglish")}
              </button>
            ) : null}
          </div>
          {/* The cover, which this page has been throwing away.

              `GET /public/services/:slug` has always returned `cover_url` —
              allowlisted, streamed by the route itself, null when the vault
              would refuse it — and the detail page rendered the name, the lead
              and the body without ever showing the photograph the tenant
              uploaded for exactly this screen. The index grid used it; the page
              the index links to did not.

              It is an image in the band, not a background behind the heading. A
              scrim over tenant-uploaded artwork is a contrast problem solved per
              photograph (see `hero.tsx`, where the floor is set by the eyebrow at
              α ≥ 0.87), and there is no floor that holds for every image a
              stranger may upload. Beneath the type it needs no scrim at all. */}
          {profile.cover_url ? (
            <div className="mt-8 overflow-hidden rounded-[var(--radius)] border">
              <img
                src={profile.cover_url}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="aspect-[16/7] w-full object-cover"
              />
            </div>
          ) : null}
        </PageContainer>
      </section>

      <Section divided>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="min-w-0 max-w-prose">
            {longText ? (
              <div className="prose-site">
                <Markdown text={longText} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("site.servicesPage.noLong")}
              </p>
            )}

            {gallery.length > 0 && (
              <Reveal className="mt-8">
                <figure>
                <div className="grid grid-cols-2 gap-3">
                  {gallery.slice(0, 4).map((u) => (
                    <img
                      key={u}
                      src={u}
                      // No caption is invented: the allowlist that let this file
                      // through carries no alt text, and a screen reader told
                      // "Warehouse" under a photograph of a container yard is a
                      // lie about a picture nobody has described.
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
              </Reveal>
            )}
          </div>

          <div className="space-y-6">
            {highlights.length > 0 && (
              <Panel title={t("site.servicesPage.highlights")} titleAs="h2">
                <ul className="space-y-2.5">
                  {highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2.5 text-sm">
                      <CheckIcon size={15} className="mt-1 text-[var(--ok)]" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {coverage && (
              <Panel title={t("site.servicesPage.coverage")} titleAs="h2">
                <p className="text-sm text-muted-foreground">{coverage}</p>
              </Panel>
            )}
            {profile.video_url ? (
              <Card padded>
                <h2 className="text-title font-semibold tracking-tight">
                  {t("site.servicesPage.video")}
                </h2>
                {/* `preload="none"` — a stranger on a metered connection should not
                    pay for a film they did not ask for. */}
                <video
                  src={profile.video_url}
                  controls
                  preload="none"
                  className="mt-3 aspect-video w-full rounded-[calc(var(--radius)-2px)] bg-black"
                />
              </Card>
            ) : null}
            <ButtonLink
              to={p("/quote")}
              size="lg"
              className="w-full justify-center"
            >
              {t("site.servicesPage.cta")}
            </ButtonLink>
          </div>
        </div>
      </Section>

      {faq.length > 0 && (
        <Section variant={nextSurface()} title={t("site.servicesPage.faq")} divided>
          <Reveal className="max-w-prose divide-y divide-[var(--border)]">
            {faq.map((f) => (
              <details key={f.faq_id} className="group py-4">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-medium">
                  <span>{pickText(f, "question", lang)}</span>
                  <ChevronDownIcon className="mt-1 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">
                  {pickText(f, "answer", lang)}
                </p>
              </details>
            ))}
          </Reveal>
        </Section>
      )}

      {related.length > 0 && (
        <Section
          variant={nextSurface()}
          title={t("site.servicesPage.related")}
          divided
        >
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r, i) => {
              // `related` carries a name and two slugs and nothing else, so
              // every one of these cards is coverless by construction — and its
              // identity has to be looked up rather than derived from `i`, or a
              // service would wear one colour in the grid and another in the
              // "related" row of the page beside it.
              const at = services.findIndex(
                (row) => row.slug_en === r.slug_en,
              );
              const relId = at < 0 ? null : serviceIdentity(at);
              return (
                <Reveal as="li" key={r.slug_en} delay={(i % 3) as 0 | 1 | 2}>
                  <MediaCard
                    className="h-full"
                    icon={relId ? relId.icon : BoxIcon}
                    mode={relId ? relId.mode : undefined}
                    code={relId ? relId.code : undefined}
                    title={pickText(r, "name", lang) || ""}
                    to={p(`/services/${encodeURIComponent(pickSlug(r, lang))}`)}
                    linkLabel={t("site.services.more")}
                  />
                </Reveal>
              );
            })}
          </ul>
        </Section>
      )}

      {/* Never two plain bands next to each other — which is most of why a long
          page reads as one flat column (§6.4). */}
      <Section
        id="quote"
        variant={nextSurface()}
        title={t("site.quote.title")}
        lead={t("site.quote.sub")}
        divided
      >
        <Card padded className="max-w-reading">
          <QuoteWizard />
        </Card>
      </Section>
    </PageShell>
  );
}
