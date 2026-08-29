import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { p } from "@/lib/base-path";

/**
 * The 404 — a real status, not a design flourish.
 *
 * `src/server.js` answers unknown paths under this app's prefixes with
 * `index.html`, so the router is what decides "not found"; that is also why the
 * page has to be reachable from a stale link rather than only from a typo. The
 * links on it are the two things a stranger who followed a bad link can still
 * use: the home page, and tracking by reference, which works without any link at
 * all.
 *
 * The `<h1>` is the sentence itself, and the response is a 200 with this content
 * rather than a redirect to `/public`: silently sending a broken link to the home
 * page is how a site teaches its owner that the link is broken but nothing looks
 * wrong, and it costs the crawler an index decision it was ready to make.
 */
export function NotFoundPage() {
  const { t } = useTranslation();
  useDocumentMeta({ title: t("site.notFound.title") });

  return (
    <PageShell label={t("site.notFound.title")}>
      <Section
        title={t("site.notFound.title")}
        lead={t("site.notFound.hint")}
        titleAs="h1"
      >
        <div className="flex flex-wrap gap-3">
          <Link
            to={p()}
            className="btn-primary inline-flex h-11 items-center rounded-[calc(var(--radius)-2px)] px-5 text-[0.9375rem] font-semibold"
          >
            {t("site.notFound.home")}
          </Link>
          <Link
            to={p("/track")}
            className="btn-surface inline-flex h-11 items-center rounded-[calc(var(--radius)-2px)] px-5 text-[0.9375rem] font-semibold"
          >
            {t("site.track.title")}
          </Link>
        </div>
      </Section>
    </PageShell>
  );
}
