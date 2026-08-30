import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { messageFor, requestIdFor } from "@/lib/api";
import {
  coverUrl,
  insightExcerpt,
  insightSlug,
  insightTitle,
  listInsights,
  type InsightCard,
  type InsightIndex,
} from "@/lib/insights-api";
import { getLang, tStatic } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { p } from "@/lib/base-path";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Chip } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import { SectionHead } from "@/components/site/section-head";
import { BadgePill } from "@/components/ui/badge-pill";
import { IconTile } from "@/components/ui/icon-tile";
import { BgMap } from "@/components/ui/bg-map";
import { Reveal } from "@/components/ui/reveal";
import { DocumentIcon } from "@/components/ui/icons";

/**
 * `/public/insights` — the tenant's own writing.
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * smartls.cm's "Kaizen Hub", renamed per the resolved decision. Five faults,
 * fixed here rather than reproduced:
 *
 *   1. **Their filter bar hides articles.** Four hardcoded buttons over six tags
 *      in the data: two articles cannot be reached by ANY filter. The bar below
 *      is whatever `tags` the server sends, derived from the tags in use, so the
 *      bug is not expressible here.
 *   2. **No dates anywhere.** Every card is dated, and the article page sends
 *      `article:published_time`.
 *   3. **No excerpt** — their cards carry title and author only.
 *   4. **Search is title-only, client-side, over hardcoded DOM.** Fine at five
 *      articles, useless at thirty. There is no search here yet; the tag filter
 *      is server-side and paginated, which is the half that scales. A real
 *      search belongs in the API once there is enough to search.
 *   5. **Author names inside translation keys.** Names are not translatable
 *      content; ours come from the staff record.
 *
 * ── THE FILTER IS A URL, NOT STATE ─────────────────────────────────────────
 *
 * `?tag=` and `?page=`, for the reason the tracking page gives about `?ref=`: a
 * filtered view somebody wants to send is a filtered view that has to have an
 * address. It also makes the Back button walk the filters, which is what a
 * reader expects after clicking three of them.
 */
export function InsightsPage() {
  const { t } = useTranslation();
  const lang = getLang();
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag") || "";
  const page = Math.max(1, Number(params.get("page") || 1) || 1);
  const [nonce, setNonce] = React.useState(0);
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "ready"; view: InsightIndex }
    | { kind: "error"; message: string; requestId: string | null }
  >({ kind: "loading" });

  useDocumentMeta({
    title: t("site.insights.title"),
    description: t("site.insights.sub"),
  });

  React.useEffect(() => {
    const ctl = new AbortController();
    setState({ kind: "loading" });
    listInsights({ tag: tag || undefined, page, signal: ctl.signal })
      .then((view) => setState({ kind: "ready", view }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setState({
          kind: "error",
          message: messageFor(e, tStatic("errors.loadFailed")),
          requestId: requestIdFor(e),
        });
      });
    return () => ctl.abort();
  }, [tag, page, nonce]);

  /** Changing a filter always returns to page one — page 4 of "strategy" is
   *  usually not a page at all, and an empty result there reads as "no
   *  articles" rather than "no fourth page". */
  const choose = (next: string) => {
    const q = new URLSearchParams();
    if (next) q.set("tag", next);
    setParams(q);
  };

  const goToPage = (next: number) => {
    const q = new URLSearchParams();
    if (tag) q.set("tag", tag);
    if (next > 1) q.set("page", String(next));
    setParams(q);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <PageShell label={t("site.insights.title")} footer>
      <section className="band-hero relative overflow-hidden">
        <BgMap />
        <PageContainer className="relative">
          <BadgePill onDark>{t("site.insights.kicker")}</BadgePill>
          <SectionHead
            className="mt-4"
            as="h1"
            titleClass="hero-title"
            onDark
            title={t("site.insights.titleMain")}
            accent={t("site.insights.titleAccent")}
            lead={t("site.insights.sub")}
          />

          {/*
            The filter bar lives IN the hero, which is where their Kaizen page
            puts its search and filters — and it is right for the same reason
            the wizard's step dots sit above the form: this is the page's
            primary control, and below the hero it is under the fold on a phone,
            where a reader has to scroll past three cards to discover the page
            can be filtered at all.

            Rendered only once the list has answered: a bar that appears empty
            and then fills is a layout that jumps under somebody's thumb.
          */}
          {state.kind === "ready" && state.view.tags.length > 0 && (
            <nav aria-label={t("site.insights.filterLabel")} className="mt-8">
              <ul className="flex flex-wrap gap-2">
                <li>
                  <FilterButton active={!tag} onClick={() => choose("")}>
                    {t("site.insights.all")}
                  </FilterButton>
                </li>
                {state.view.tags.map((entry) => (
                  <li key={entry.tag}>
                    <FilterButton
                      active={tag === entry.tag}
                      onClick={() => choose(entry.tag)}
                    >
                      {entry.tag}
                      <span className="num ml-1.5 text-xs opacity-70">{entry.count}</span>
                    </FilterButton>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </PageContainer>
      </section>

      <Section>
        {state.kind === "loading" ? (
          <LoadingState
            label={t("site.insights.loading")}
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="lux-card overflow-hidden">
                <Skeleton className="h-40 w-full rounded-none" />
                <div className="p-5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-5 w-full" />
                  <Skeleton className="mt-2 h-4 w-4/5" />
                </div>
              </div>
            ))}
          </LoadingState>
        ) : state.kind === "error" ? (
          <ErrorState
            message={state.message}
            requestId={state.requestId}
            action={<Button onClick={() => setNonce((n) => n + 1)}>{t("common.retry")}</Button>}
          />
        ) : state.view.articles.length === 0 ? (
          <EmptyState
            title={tag ? t("site.insights.noneForTag") : t("site.insights.none")}
            hint={tag ? t("site.insights.noneForTagHint") : t("site.insights.noneHint")}
            action={
              tag ? (
                <Button variant="outline" onClick={() => choose("")}>
                  {t("site.insights.showAll")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {state.view.articles.map((a, i) => (
                <Reveal
                  as="li"
                  key={a.slug_fr || a.slug_en || insightTitle(a, lang)}
                  // Staggered by COLUMN, not by index: a three-across grid
                  // whose ninth card waits half a second is a grid the reader
                  // has finished looking at. The row resets the delay.
                  delay={(i % 3) as 0 | 1 | 2}
                >
                  <ArticleCard article={a} lang={lang} />
                </Reveal>
              ))}
            </ul>

            {(page > 1 || state.view.has_more) && (
              <nav
                aria-label={t("site.insights.pagination")}
                className="mt-10 flex items-center justify-between gap-4"
              >
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  {t("site.insights.previous")}
                </Button>
                <p className="text-sm text-muted-foreground">
                  {t("site.insights.pageOf", {
                    page,
                    total: Math.max(1, Math.ceil(state.view.total / state.view.per_page)),
                  })}
                </p>
                <Button disabled={!state.view.has_more} onClick={() => goToPage(page + 1)}>
                  {t("site.insights.next")}
                </Button>
              </nav>
            )}
          </>
        )}
      </Section>
    </PageShell>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // `aria-pressed`, not `aria-current`: these are toggles over one list, not
      // navigation between pages, and a screen reader announces the two
      // differently.
      aria-pressed={active}
      className={cn(
        "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        active
          ? "border-[var(--brand-orange)] bg-[var(--brand-orange)] font-semibold text-[var(--primary-foreground)]"
          // On the hero plate `--ink` is inverted, so a resting chip has to
          // borrow the band's own foreground rather than the page's.
          : "border-[rgb(237_238_238/0.25)] text-[var(--hero-muted)] hover:bg-[rgb(237_238_238/0.10)]",
      )}
    >
      {children}
    </button>
  );
}

/**
 * One card: cover, date, title, excerpt, author.
 *
 * The cover renders only once it LOADS. `has_cover` says a document is attached,
 * not that the allowlist will stream it — the public media route re-checks and
 * 404s a draft's cover — and a broken frame on a marketing page is worse than a
 * card with no image. The same rule `portfolio-api` states: never render media
 * this app did not get a URL for.
 */
function ArticleCard({ article, lang }: { article: InsightCard; lang: string }) {
  const [coverOk, setCoverOk] = React.useState(true);
  const slug = insightSlug(article, lang);
  const title = insightTitle(article, lang);
  const excerpt = insightExcerpt(article, lang);
  const src = coverUrl(article.cover_id);

  const body = (
    <>
      {src && coverOk ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setCoverOk(false)}
          className="h-40 w-full object-cover"
        />
      ) : (
        /* Not every article has a cover, and one that does not must not read as
           a broken card beside three illustrated ones. A tinted plate with the
           section's own glyph is an honest placeholder — it says "an article",
           which is true, rather than standing in for a photograph nobody took. */
        <div className="flex h-40 w-full items-center justify-center bg-[rgb(var(--ink)/0.04)]">
          <IconTile icon={DocumentIcon} size="lg" />
        </div>
      )}
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {article.published_at && (
            <time dateTime={article.published_at} className="num">
              {dateFmt(article.published_at)}
            </time>
          )}
          {article.tags.slice(0, 2).map((tg) => (
            <Chip key={tg}>{tg}</Chip>
          ))}
        </div>
        <h2 className="mt-2 font-display text-title font-semibold leading-snug tracking-tight">
          {title}
        </h2>
        {excerpt && (
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{excerpt}</p>
        )}
        {article.author && (
          <p className="mt-4 text-xs text-muted-foreground">
            {article.author.name}
            {article.author.title ? " · " + article.author.title : ""}
          </p>
        )}
      </div>
    </>
  );

  // An article with no slug in either language has no address. It still renders
  // — the desk published it — but as a tile rather than a dead link.
  return slug ? (
    <Link
      to={p("/insights/" + encodeURIComponent(slug))}
      className="lux-card block h-full overflow-hidden transition-shadow hover:shadow-md"
    >
      {body}
    </Link>
  ) : (
    <div className="lux-card h-full overflow-hidden">{body}</div>
  );
}
