import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as api from "@/lib/careers-api";
import * as insights from "@/lib/insights-api";
import { PublicApiError, messageFor } from "@/lib/api";
import { currentLocale, tStatic } from "@/lib/i18n";
import { dateAgo, enumText } from "@/lib/format";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { MediaCard, Section } from "@/components/site/section";
import { Card } from "@/components/ui/card";
import { Panel } from "@/components/ui/panel";
import { ButtonLink } from "@/components/ui/button";
import { ErrorState, SuccessState } from "@/components/state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Chip } from "@/components/ui/pill";
import { Markdown } from "@/components/ui/markdown";
import {
  AlertIcon,
  BoltIcon,
  BoxIcon,
  ClockIcon,
  DocumentIcon,
  PlaneIcon,
  ShieldIcon,
  ShipIcon,
  TruckIcon,
  WarehouseIcon,
} from "@/components/ui/icons";
import { IconTile, type IconComponent } from "@/components/ui/icon-tile";
import { SectionHead } from "@/components/site/section-head";
import { BgMap } from "@/components/ui/bg-map";
import { StagedLines } from "@/components/ui/type";
import { BadgePill } from "@/components/ui/badge-pill";
import { Reveal } from "@/components/ui/reveal";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { useSitePage } from "@/lib/use-site-page";
import { CAREERS_PAGE_KEY, featureList, pickBilingual } from "@/lib/site-api";
import { LazyCandidateForm } from "./candidate-form-lazy";
import { NotHiring, UnsubscribePage } from "./careers-empty";
import { p } from "@/lib/base-path";
// Registers `site.careers.*`, which lives in this chunk rather than in the
// entry dictionary. Imported for the side effect; see careers-i18n.ts.
import "./careers-i18n";

/**
 * `/public/careers` and `/public/careers/:token` — the one screen in this product
 * a stranger reads twice before they trust it, because what they are submitting is
 * themselves.
 *
 * ── WHAT THE PORT KEEPS FROM `client/src/features/careers/careers-page.tsx` ──
 *
 * Three behaviours, all of them load-bearing:
 *
 *   1. THE RECEIPT SAYS WHETHER THE CV LANDED. `apply()` returns
 *      `{ received, reference, cv_attached }`, and the server records the
 *      application even when the upload fails ("better a candidate with a
 *      reference than a candidate with nothing"). Rendering only "Thank you"
 *      would tell a person their CV is in a pile when it may not be — so the
 *      confirmation is a different sentence for each case.
 *   2. THE FILE IS CHECKED BEFORE IT IS SENT. `FileInput` refuses a wrong type
 *      outright and refuses an oversized one AFTER compressing, against
 *      `ATTACHMENT_MAX_BYTES` — the same 8 MB `CV_MAX_BYTES` enforces in
 *      `careers.service`. So an unusable file is a message at selection time and
 *      not a lost form after a minute on a metered connection, and a CV
 *      photographed on a phone is resized rather than refused.
 *   3. WHAT THE ROLE INSISTS ON IS SAID FIRST. `apply_config` carries
 *      `require_cover_letter` / `require_portfolio`; the server enforces them and
 *      returns named field errors, so the form marks them required up front
 *      instead of letting somebody write five paragraphs and then be refused.
 *
 * ── WHAT CHANGES HERE ─────────────────────────────────────────────────────
 *
 * The `salaryBand` phrase comes from the dictionary in both languages (the ERP's
 * version hardcodes "From"/"Up to", so a French advert read "From 1 250 000
 * FCFA"), and the sandbox banner is a sentence in both languages rather than an
 * English-only string. A test advert that only warns the English-reading half of
 * the applicants is a warning that did not happen.
 */
export function CareersPage() {
  const { t } = useTranslation();
  const lang = currentLocale().startsWith("fr") ? "fr" : "en";
  const [rows, setRows] = React.useState<api.PublicVacancy[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<api.CareersSettings | null>(null);

  React.useEffect(() => {
    let alive = true;
    api
      .listVacancies()
      .then((r) => alive && setRows(Array.isArray(r) ? r : []))
      .catch((e: unknown) => {
        if (!alive) return;
        // A 404/403 means the tenant has not published any roles: an empty list,
        // not a failure. Only a real fault gets an error line.
        if (e instanceof PublicApiError && (e.isNotFound || e.status === 403))
          setRows([]);
        else setError(messageFor(e, tStatic("errors.loadFailed")));
      });
    return () => {
      alive = false;
    };
  }, []);

  /* Separate from the list, and never chained behind it. The two answer
     different questions — "what is open" and "what may this page offer" — and a
     tenant with no vacancies still has switches. Chaining would also make the
     not-hiring band wait for a request it does not depend on, which is the
     slowest path on the page in the state the page is usually in. `getSettings`
     never rejects, so there is no error branch to write. */
  React.useEffect(() => {
    let alive = true;
    api.getSettings().then((v) => alive && setSettings(v));
    return () => {
      alive = false;
    };
  }, []);

  /* The tenant's own "why work here", if they have written one. `null` for
     every tenant who has not, which is every tenant on day one — and the bands
     below simply do not render, rather than showing a heading over nothing. */
  const { page: careersPage } = useSitePage(CAREERS_PAGE_KEY);
  const features = featureList(careersPage);

  useDocumentMeta({
    title: t("site.careers.title"),
    description: t("site.careers.sub"),
  });

  return (
    <PageShell label={t("site.careers.title")} footer>
      {/* §8.5's entrance. This page shipped as a bare `<h1>` on white, and it is
          the page whose EMPTY state is the common one — a company is not always
          hiring — so the band is most of what a visitor sees on it. The form's
          ergonomics below are untouched: §8.5 is explicit that "a job applicant
          on a phone is not an audience to experiment on", so the entrance is the
          same plate every other route uses and nothing about the vacancy list or
          the application flow changes. */}
      <section className="band-hero relative overflow-hidden">
        <BgMap />
        <PageContainer className="relative">
          <BadgePill onDark>{t("site.careers.list")}</BadgePill>
          <SectionHead
            className="mt-4"
            as="h1"
            titleClass="hero-title"
            onDark
            /* F-17: the LCP element here too. */
            title={<StagedLines paintImmediately text={t("site.careers.titleMain")} />}
            accent={t("site.careers.titleAccent")}
            lead={t("site.careers.sub")}
          />
        </PageContainer>
      </section>

      {/* ── the roles, or the answer that there are none ──────────────────
          The list is a SLOT in a page rather than the whole page (13792). What
          used to be here was the list and, in its absence, a dashed box: so the
          commonest state of this route was also its emptiest, and everything a
          tenant might say about working for them had nowhere to go. */}
      <Section>
        {error ? (
          <ErrorState message={error} />
        ) : rows === null ? (
          <PageSkeleton rows={4} cols={2} />
        ) : rows.length === 0 ? (
          /* Held until the switches land. They decide whether this band has one
             button, two or none, and painting the contact-only version first
             and swapping it for an application form a beat later is the flicker
             `site-copy.ts` holds first paint to avoid on the heading above. */
          settings === null ? (
            <PageSkeleton rows={2} cols={1} />
          ) : (
            <NotHiring settings={settings} />
          )
        ) : (
          <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {rows.map((v, i) => (
              <Reveal as="li" key={v.token} delay={(i % 3) as 0 | 1 | 2}>
                <Link
                  to={p(`/careers/${encodeURIComponent(v.token)}`)}
                  className="group flex items-start gap-4 py-6 transition-colors"
                >
                  <IconTile icon={departmentIcon(v.department)} />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
                    <div className="min-w-0">
                      <h2 className="text-title font-semibold leading-snug tracking-tight group-hover:text-primary-ink">
                        {v.title}
                      </h2>
                      <VacancyFacts v={v} />
                      <VacancyDates v={v} />
                    </div>
                    <span className="shrink-0 text-sm font-medium text-primary-ink underline-offset-4 group-hover:underline">
                      {t("site.careers.apply")}
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </ul>
        )}
      </Section>

      {/* ── why work here, in the tenant's own words ──────────────────────
          Rendered whether or not roles are open, which is the point: a candidate
          who DID find a role wants this too, and building it as an empty-state
          decoration would mean the effort only ever reached the people who found
          nothing. Absent for a tenant who has authored no `careers` page, and
          absent is the correct empty state — a heading over three blank cards
          reads as a company that did not finish writing its own values. */}
      {features && features.items.length > 0 && (
        <Section
          variant="muted"
          divided
          title={pickBilingual(features.title, lang) || t("site.careers.lookingFor")}
        >
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.items.map((item, i) => (
              <Reveal as="li" key={pickBilingual(item.title, lang) || i} delay={(i % 3) as 0 | 1 | 2}>
                <h3 className="text-base font-semibold leading-snug tracking-tight">
                  {pickBilingual(item.title, lang)}
                </h3>
                {item.text && (
                  <p className="mt-1.5 max-w-measure text-sm text-muted-foreground">
                    {pickBilingual(item.text, lang)}
                  </p>
                )}
              </Reveal>
            ))}
          </ul>
        </Section>
      )}

      {/* ── life here, from the tenant's own posts ────────────────────────
          A tag rather than a second content store, for the reason 13792 gives:
          `insight` already has an editor, a publish flag and tags, and a
          careers-only copy of all three would be three chances to disagree with
          the originals. No tag configured means no band. */}
      {settings?.culture_tag ? <CultureStrip tag={settings.culture_tag} /> : null}
    </PageShell>
  );
}

/**
 * The tenant's own posts about working there, filtered to one tag (13792).
 *
 * Fetched here rather than in the page, because it is the one band that is
 * conditional on a setting the page has already fetched — hoisting the request
 * would mean every visitor pays for it including the tenants who configured no
 * tag, which is most of them.
 *
 * Renders NOTHING on an empty answer or a failure. A tenant who set a tag that
 * matches no published post has a band with no content, and a heading with an
 * empty grid under it is worse on a careers page than no band: it reads as a
 * company whose website is broken, to the audience least willing to overlook it.
 */
function CultureStrip({ tag }: { tag: string }) {
  const { t } = useTranslation();
  const lang = currentLocale().startsWith("fr") ? "fr" : "en";
  const [rows, setRows] = React.useState<insights.InsightCard[]>([]);

  React.useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    insights
      .listInsights({ tag, signal: ac.signal })
      .then((r) => alive && setRows((r?.articles || []).slice(0, 3)))
      .catch(() => undefined);
    return () => {
      alive = false;
      ac.abort();
    };
  }, [tag]);

  if (!rows.length) return null;
  return (
    <Section
      divided
      title={t("site.careers.cultureTitle")}
    >
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((a, i) => {
          const slug = insights.insightSlug(a, lang);
          return (
            <MediaCard
              /* The slug, not an id: `InsightCard` is the PUBLIC shape and
                 carries no `insight_id` — the index is addressed by slug all
                 the way through. The positional fallback covers a post with no
                 slug in either language, which cannot be linked either. */
              key={slug || `card-${i}`}
              image={insights.coverUrl(a.cover_id)}
              icon={BoxIcon}
              title={insights.insightTitle(a, lang)}
              to={slug ? p(`/insights/${encodeURIComponent(slug)}`) : undefined}
              linkLabel={slug ? t("site.careers.cultureMore") : undefined}
            >
              {insights.insightExcerpt(a, lang)}
            </MediaCard>
          );
        })}
      </div>
    </Section>
  );
}

/**
 * `/careers/alerts/unsubscribe/:token` — where every job-alert digest's footer
 * points (13792).
 *
 * It gets the same entrance as every other route in this app rather than a bare
 * confirmation card. That is not only the acceptance criterion in
 * `route-entrances.test.tsx`: somebody arriving here has just decided they want
 * less from this company, and the last page they see should still look like the
 * company's, not like a 1990s form handler.
 *
 * Four path segments, so it cannot be shadowed by `/careers/:token` — react-router
 * ranks a static segment above a dynamic one and these do not even have the same
 * length.
 */
export function CareersUnsubscribePage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  useDocumentMeta({ title: t("site.careers.unsubTitle") });
  return (
    <PageShell label={t("site.careers.unsubTitle")} footer>
      <section className="band-hero relative overflow-hidden">
        <BgMap />
        <PageContainer className="relative">
          <BadgePill onDark>{t("site.careers.list")}</BadgePill>
          <SectionHead
            className="mt-4"
            as="h1"
            titleClass="hero-title"
            onDark
            title={<StagedLines paintImmediately text={t("site.careers.unsubTitle")} />}
          />
        </PageContainer>
      </section>
      <Section>
        <UnsubscribePage token={decodeURIComponent(token)} />
      </Section>
    </PageShell>
  );
}

/**
 * A glyph for a department (UI_UPGRADE_PLAN §7.5).
 *
 * `department` is free text a recruiter typed, in either language, so this is a
 * keyword match and not a lookup — and it is DECORATION, which is what makes
 * that acceptable: the department is printed as a chip two lines below, so a
 * miss costs a slightly generic square and never a wrong fact. Anything
 * unmatched gets the box, the same "freight, kind unstated" glyph `ModeIcon`
 * falls back to, rather than a guess dressed up as a category.
 */
const DEPARTMENT_ICON: Array<[RegExp, IconComponent]> = [
  [/sea|ocean|marit|fret marit|shipping/i, ShipIcon],
  [/air|aérien|aerien|avia/i, PlaneIcon],
  [
    /transport|truck|road|route|routier|fleet|flotte|chauffeur|driver/i,
    TruckIcon,
  ],
  [/warehouse|entrep|stock|magasin/i, WarehouseIcon],
  [
    /customs|douane|declar|déclar|compliance|conformité|conformite|legal|jurid|finance|comptab|admin/i,
    DocumentIcon,
  ],
  [
    /hr|rh|ressources|people|talent|qhse|hse|safety|sécurité|securite/i,
    ShieldIcon,
  ],
  [/sales|commercial|business|marketing|client/i, BoltIcon],
];

function departmentIcon(department?: string | null): IconComponent {
  const d = String(department || "");
  for (const [re, icon] of DEPARTMENT_ICON) if (re.test(d)) return icon;
  return BoxIcon;
}

/**
 * Posted when, closes when — the line their site structurally cannot write
 * (UI_UPGRADE_PLAN §2.1).
 *
 * The age is relative ("6 days ago"), because that is the fact a candidate is
 * actually checking: a careers page whose listings are stale is the commonest
 * failure of the genre, and ours cannot be stale — the vacancy closes itself.
 * Past a year `dateAgo` returns null and the exact date stands in, because
 * "13 months ago" is worse than the date it replaced.
 */
function VacancyDates({ v }: { v: api.PublicVacancy }) {
  const { t } = useTranslation();
  const exact = (d: string) =>
    new Intl.DateTimeFormat(currentLocale(), { dateStyle: "long" }).format(
      new Date(d),
    );
  const posted = v.published_at
    ? dateAgo(v.published_at) || exact(v.published_at)
    : null;
  const closes = v.closes_on ? exact(v.closes_on) : null;
  if (!posted && !closes) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {posted ? (
        <span>
          {t("site.careers.published")} <span className="num">{posted}</span>
        </span>
      ) : null}
      {closes ? (
        <span className="inline-flex items-center gap-1.5">
          <ClockIcon size={14} />
          {t("site.careers.closeNote")} <span className="num">{closes}</span>
        </span>
      ) : null}
    </p>
  );
}

/** Department · location · type · experience · salary, as chips.
 *
 *  `enumLabel`+`tr` on the employment type because the API stores `FULL_TIME` and
 *  a job advert that reads "FULL_TIME" to a French candidate is a database dump,
 *  not a page. */
function VacancyFacts({ v }: { v: api.PublicVacancy }) {
  const { t } = useTranslation();
  const band = api.salaryBand(v, {
    from: t("site.careers.salaryFrom"),
    upTo: t("site.careers.salaryUpTo"),
  });
  const chips = [
    v.department,
    v.location,
    v.employment_type ? enumText(v.employment_type) : null,
    v.experience_years_min
      ? `${v.experience_years_min}+ ${t("site.careers.years")}`
      : null,
    band,
  ].filter(Boolean) as string[];
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <Chip key={c}>{c}</Chip>
      ))}
    </div>
  );
}

/* ── The advert ─────────────────────────────────────────────────────────── */

export function VacancyPage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const [v, setV] = React.useState<api.PublicVacancy | null>(null);
  const [gone, setGone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    api
      .getVacancy(decodeURIComponent(token))
      .then((row) => alive && setV(row))
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof PublicApiError && e.isNotFound) setGone(true);
        else setError(messageFor(e, tStatic("errors.loadFailed")));
      });
    return () => {
      alive = false;
    };
  }, [token]);

  useDocumentMeta({
    title: v ? `${v.title} · ${t("site.careers.title")}` : undefined,
  });

  if (error) {
    return (
      <PageShell label={t("site.careers.title")}>
        <PageContainer>
          <ErrorState message={error} />
        </PageContainer>
      </PageShell>
    );
  }

  if (gone || !v) {
    // A withdrawn advert is not a 404 in the rude sense: the role may have been
    // filled yesterday, and the person reading this link has already spent time
    // on it. Say it closed, offer the list, invent nothing about why.
    return (
      <PageShell label={t("site.careers.title")}>
        <Section
          title={gone ? t("site.careers.closed") : t("site.careers.title")}
        >
          <div className="max-w-prose">
            {gone ? (
              <p className="text-sm text-muted-foreground">
                {t("site.careers.closedHint")}
              </p>
            ) : (
              <PageSkeleton rows={3} cols={2} />
            )}
            <div className="mt-6">
              <ButtonLink to={p("/careers")} variant="outline">
                {t("site.careers.back")}
              </ButtonLink>
            </div>
          </div>
        </Section>
      </PageShell>
    );
  }

  return (
    <PageShell label={v.title}>
      {/* Muted, so the advert does not open with two plain bands stacked — the
          hairline under the body band is not enough on its own (§6.4). */}
      <section className="band band-muted">
        <PageContainer size="reading">
          <nav aria-label={t("site.careers.title")} className="mb-6">
            <Link
              to={p("/careers")}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              {t("site.careers.back")}
            </Link>
          </nav>

          <BadgePill className="mb-4">{t("site.careers.list")}</BadgePill>

          {v.environment === "sandbox" && (
            <p
              role="note"
              className="mb-5 flex items-start gap-2 rounded-[calc(var(--radius)-2px)] border border-warn/40 bg-warn-fill/10 p-3 text-sm"
            >
              <AlertIcon size={16} className="mt-0.5 text-warn" />
              <span>{t("site.careers.testPosting")}</span>
            </p>
          )}

          <div className="flex items-start gap-4">
            <IconTile icon={departmentIcon(v.department)} size="lg" />
            <div className="min-w-0">
              {/* The role's own name, so no accent word — see the service
                  detail page for why we do not split somebody else's noun. */}
              <SectionHead as="h1" title={v.title} />
              <VacancyFacts v={v} />
              <VacancyDates v={v} />
            </div>
          </div>
        </PageContainer>
      </section>

      <Section divided>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {/* The advert copy is revealed; the form beside it is NOT. A candidate
              who has scrolled to the application is a candidate reaching for a
              field, and a field that fades in under a thumb is one that gets
              mis-tapped. Same rule as the contact band on the home page. */}
          <Reveal className="min-w-0 max-w-prose">
            {v.description ? (
              <div className="prose-site">
                {/* Tenant-authored advert copy, rendered by the same dependency-free
                    renderer the staff app uses. It escapes everything, so an HTML
                    snippet pasted into the advert field by a recruiter in a hurry is
                    text, not markup. */}
                <Markdown text={v.description} />
              </div>
            ) : null}

            {v.skills_required?.length ? (
              <Panel
                title={t("site.careers.lookingFor")}
                titleAs="h2"
                className="mt-8"
              >
                <ul className="grid gap-2 sm:grid-cols-2">
                  {v.skills_required.map((s) => (
                    <li key={s} className="flex items-start gap-2 text-sm">
                      <DocumentIcon
                        size={14}
                        className="mt-1 text-muted-foreground"
                      />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </Reveal>

          <Card padded className="h-fit lg:sticky lg:top-[var(--sticky-top)]">
            <h2 className="text-title font-semibold tracking-tight">
              {t("site.careers.applyTitle")}
            </h2>
            <ApplyForm key={v.token} vacancy={v} />
          </Card>
        </div>
      </Section>
    </PageShell>
  );
}

/** The application itself. */
/**
 * Applying to a ROLE.
 *
 * Everything that used to live here — the picker, the compression, the preview,
 * the honeypot, the field-error wiring — moved into `CandidateForm` when 13792
 * added a second form asking the same questions. What stays is what is actually
 * specific to a vacancy: the two things `apply_config` can insist on, where the
 * body is posted, and a confirmation that can promise a pipeline because there
 * is one.
 */
function ApplyForm({ vacancy: v }: { vacancy: api.PublicVacancy }) {
  const { t } = useTranslation();
  return (
    <LazyCandidateForm
      send={(body) => api.apply(v.token, body)}
      requireCover={!!v.apply_config?.require_cover_letter}
      requirePortfolio={!!v.apply_config?.require_portfolio}
      coverLabel={t("site.careers.coverNote")}
      coverHint={t("site.careers.coverHint")}
      submitLabel={t("site.careers.submit")}
      renderSent={(r) => (
        <div className="mt-4">
          <SuccessState
            title={t("site.careers.sentTitle")}
            hint={
              <>
                {r.cv_attached
                  ? t("site.careers.sentCv", { reference: r.reference })
                  : t("site.careers.sentNoCv", { reference: r.reference })}
                <span className="mt-2 block">{t("site.careers.sentNote")}</span>
              </>
            }
          />
          <Link
            to={p("/careers")}
            className="mt-4 inline-flex text-sm text-primary-ink underline underline-offset-4"
          >
            {t("site.careers.anotherRole")}
          </Link>
        </div>
      )}
    />
  );
}
