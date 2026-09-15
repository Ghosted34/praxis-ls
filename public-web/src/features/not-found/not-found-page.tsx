import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { SectionHead } from "@/components/site/section-head";
import { BadgePill } from "@/components/ui/badge-pill";
import { BgMap } from "@/components/ui/bg-map";
import { StagedLines } from "@/components/ui/type";
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
    <PageShell label={t("site.notFound.title")} footer>
      {/*
        A 404 GETS A DESIGNED ENTRANCE TOO, and this is the route where that is
        least obvious and most worth it.

        §8.7 says every route in `router.tsx`, and a 404 is the one page nobody
        designs because nobody plans to visit it — which is exactly backwards.
        It is reached by a mistyped URL, an old printed link and a stale search
        result, so it is often a stranger's FIRST page on this site. Leaving it
        as a bare heading on white means the one visitor who arrived by accident
        is the only one who sees an undesigned product.

        The same plate as every other route, and the two ways out kept exactly
        where they were: this page's job is to be left, and the entrance must
        not put anything between the reader and the door.
      */}
      <section className="band-hero relative overflow-hidden">
        <BgMap />
        <PageContainer className="relative">
          <BadgePill onDark>{t("site.notFound.kicker")}</BadgePill>
          <SectionHead
            className="mt-4"
            as="h1"
            titleClass="hero-title"
            onDark
            /* F-17: on the one route where a slow paint is most likely to be
               read as "this site is broken too". */
            title={
              <StagedLines paintImmediately text={t("site.notFound.title")} />
            }
            lead={t("site.notFound.hint")}
          />
        </PageContainer>
      </section>

      <Section>
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
