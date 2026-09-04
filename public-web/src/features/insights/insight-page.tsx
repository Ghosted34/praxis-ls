import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PublicApiError, messageFor, requestIdFor } from "@/lib/api";
import {
  coverUrl,
  getInsight,
  insightBody,
  insightExcerpt,
  insightTitle,
  type InsightArticle,
} from "@/lib/insights-api";
import { getLang, tStatic } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import { p } from "@/lib/base-path";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
import { Button, ButtonLink } from "@/components/ui/button";
import { Chip } from "@/components/ui/pill";
import { Markdown } from "@/components/ui/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, LoadingState, NotFoundState } from "@/components/state";

/**
 * `/public/insights/:slug` — one article.
 *
 * ── THE SLUG IS PER LANGUAGE, AND THE LOOKUP MATCHES EITHER ────────────────
 *
 * `insight.repo.getBySlug` matches `slug_fr` OR `slug_en`, so a reader who
 * follows a French link and switches to English lands on the same article
 * without a redirect table. `alternates` below is what tells a crawler the two
 * URLs are the same piece — §3.2's whole point, and the thing their `data-i18n`
 * swap cannot express because it has one URL for both.
 *
 * ── WHY NOT-FOUND IS NOT AN ERROR ──────────────────────────────────────────
 *
 * An unpublished article and an unknown slug are the same 404 by design (the
 * service refuses to distinguish them, so a draft cannot be confirmed at a
 * guessed URL). To a reader that is a content state — the link is old, or
 * mistyped — not a failure, so it gets the designed not-found and a way back to
 * the index rather than a red alert with a retry that will never succeed.
 */
export function InsightPage() {
  const { t } = useTranslation();
  const lang = getLang();
  const { slug = "" } = useParams();
  const [nonce, setNonce] = React.useState(0);
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "ready"; article: InsightArticle }
    | { kind: "notfound" }
    | { kind: "error"; message: string; requestId: string | null }
  >({ kind: "loading" });

  React.useEffect(() => {
    const ctl = new AbortController();
    setState({ kind: "loading" });
    getInsight(slug, { signal: ctl.signal })
      .then((article) => setState({ kind: "ready", article }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        if (e instanceof PublicApiError && e.isNotFound) {
          setState({ kind: "notfound" });
          return;
        }
        setState({
          kind: "error",
          message: messageFor(e, tStatic("errors.loadFailed")),
          requestId: requestIdFor(e),
        });
      });
    return () => ctl.abort();
  }, [slug, nonce]);

  const article = state.kind === "ready" ? state.article : null;
  const title = article ? insightTitle(article, lang) : "";

  useDocumentMeta({
    title: article
      ? (lang === "fr" ? article.meta_title_fr : article.meta_title_en) || title
      : t("site.insights.title"),
    description: article
      ? (lang === "fr" ? article.meta_description_fr : article.meta_description_en) ||
        insightExcerpt(article, lang) ||
        undefined
      : undefined,
    // Only real, existing URLs. An article published in one language has no twin,
    // and pointing `hreflang="en"` at a French page is worse than saying nothing.
    alternates: article
      ? {
          fr: article.slug_fr ? p("/insights/" + encodeURIComponent(article.slug_fr)) : undefined,
          en: article.slug_en ? p("/insights/" + encodeURIComponent(article.slug_en)) : undefined,
        }
      : undefined,
  });

  return (
    <PageShell label={title || t("site.insights.title")} footer>
      <Section>
        <p className="mb-6">
          <Link
            to={p("/insights")}
            className="text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
          >
            {t("site.insights.backToIndex")}
          </Link>
        </p>

        {state.kind === "loading" ? (
          <LoadingState label={t("site.insights.loadingArticle")} className="max-w-prose">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-4 h-9 w-full" />
            <Skeleton className="mt-2 h-9 w-3/4" />
            <Skeleton className="mt-6 h-56 w-full" />
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="mt-3 h-4 w-full" />
            ))}
          </LoadingState>
        ) : state.kind === "notfound" ? (
          <NotFoundState
            className="mx-auto max-w-prose"
            title={t("site.insights.gone")}
            hint={t("site.insights.goneHint")}
            action={
              <ButtonLink to={p("/insights")} variant="outline">
                {t("site.insights.backToIndex")}
              </ButtonLink>
            }
          />
        ) : state.kind === "error" ? (
          <ErrorState
            message={state.message}
            requestId={state.requestId}
            action={<Button onClick={() => setNonce((n) => n + 1)}>{t("common.retry")}</Button>}
          />
        ) : (
          <Article article={state.article} lang={lang} title={title} />
        )}
      </Section>
    </PageShell>
  );
}

function Article({
  article,
  lang,
  title,
}: {
  article: InsightArticle;
  lang: string;
  title: string;
}) {
  const { t } = useTranslation();
  const [coverOk, setCoverOk] = React.useState(true);
  const body = insightBody(article, lang);
  const src = coverUrl(article.cover_id);
  const [broken, setBroken] = React.useState<string[]>([]);
  const gallery = (article.gallery_ids || []).filter((id) => !broken.includes(id));

  return (
    <article className="mx-auto max-w-prose">
      <header>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {article.published_at && (
            <time dateTime={article.published_at} className="num">
              {dateFmt(article.published_at)}
            </time>
          )}
          {article.tags.map((tg) => (
            <Chip key={tg}>{tg}</Chip>
          ))}
        </div>
        <h1 className="mt-3 font-display text-h1 font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        {article.author && (
          <p className="mt-4 text-sm text-muted-foreground">
            {/* The name is a fact from a staff record, not a translated string —
                which is the bug on theirs, where "By Joseph MOUKOKO" lives
                inside a translation key. Only the word "by" is translated. */}
            {t("site.insights.by")}{" "}
            <span className="font-medium text-foreground">{article.author.name}</span>
            {article.author.title ? " · " + article.author.title : ""}
          </p>
        )}
      </header>

      {src && coverOk && (
        <img
          src={src}
          alt=""
          onError={() => setCoverOk(false)}
          className="mt-8 w-full rounded-[var(--radius)] object-cover"
        />
      )}

      {body ? (
        <div className="prose-site mt-8">
          <Markdown text={body} />
        </div>
      ) : (
        // Publishing refuses an article with no body, so this is only reachable
        // for a piece written in the OTHER language — say so rather than
        // printing a heading over white space.
        <p className="mt-8 text-muted-foreground">{t("site.insights.otherLanguageOnly")}</p>
      )}

      {/* The gallery, below the body rather than inside it.

          In-prose placement would need a marker in the prose, and the marker
          would be image markup — which `Markdown` refuses on purpose: it builds
          React nodes directly with no `dangerouslySetInnerHTML`, and that is
          what keeps tenant-authored text safe on a page a stranger loads. A
          fixed strip underneath is the honest version of the feature.

          Each image drops itself on error rather than leaving a broken frame.
          The media route 404s a document whose article is not published, and it
          404s one removed from the gallery since this page was rendered — both
          are ordinary, and a grey box with a torn-page icon is not the way to
          say so. */}
      {gallery.length > 0 && (
        <figure className="mt-10">
          <div className="grid grid-cols-2 gap-3">
            {gallery.map((id) => (
              <img
                key={id}
                src={coverUrl(id) || undefined}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setBroken((b) => [...b, id])}
                className="aspect-[4/3] w-full rounded-[calc(var(--radius)-2px)] border object-cover"
              />
            ))}
          </div>
          {/* No caption is invented. The allowlist that let these through
              carries no alt text, and a screen reader told "Warehouse" under a
              photograph nobody has described is a lie about a picture. */}
          <figcaption className="mt-2 text-xs text-muted-foreground">
            {t("site.insights.gallery")}
          </figcaption>
        </figure>
      )}
    </article>
  );
}
