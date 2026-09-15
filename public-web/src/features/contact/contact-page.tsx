import { useTranslation } from "react-i18next";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { tList } from "@/lib/i18n";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { MediaCard, Section } from "@/components/site/section";
import { SectionHead } from "@/components/site/section-head";
import { BadgePill } from "@/components/ui/badge-pill";
import { BgMap } from "@/components/ui/bg-map";
import { Card } from "@/components/ui/card";
import { ContactForm } from "@/components/site/contact-form";
import { CoverageFigure } from "@/components/site/coverage-figure";
import { StagedLines } from "@/components/ui/type";
import { GlobeIcon } from "@/components/ui/icons";
import { listPublicEntities, type PublicEntity } from "@/lib/site-api";
import { afterPaint } from "@/lib/after-paint";
import * as React from "react";
import { p } from "@/lib/base-path";

/**
 * `/contact` — the general enquiry desk, on its own page.
 *
 * ── WHY THIS IS A ROUTE AND NOT A HASH ─────────────────────────────────────
 *
 * The header's "Contact" entry pointed at `p("#contact")`, and that one string
 * was two separate defects:
 *
 *   · **It highlighted itself on the home page.** `NavLink` decides "active" by
 *     PATH and discards the fragment, so `/public#contact` IS `/public` — the
 *     home route — and the nav painted Contact as the current page for every
 *     visitor who had merely landed on the site. A reader who has not navigated
 *     anywhere was being told they were somewhere.
 *   · **It did nothing when clicked**, in the two ways
 *     `features/quote/quote-page.tsx` records at length: from another page the
 *     browser scrolls to `#contact` before the lazy marketing chunk has rendered
 *     it, and from the home page the hash changes without a navigation, so
 *     nothing moves.
 *
 * A route fixes both, and buys the same three things the quote desk got: a URL
 * somebody can send, its own title and share card, and a home page that no
 * longer ships this form to a visitor who came to read about services.
 *
 * ── WHAT IS AND IS NOT ON THIS PAGE ────────────────────────────────────────
 *
 * No address, no phone number, no office hours. `GET /branding` returns colours,
 * a name and logos — the tenant's postal details are an OPEN item in README.md,
 * and `WEB_BUILD_BRIEF.md` N12 forbids inventing the ones we do not have. What
 * the page can say truthfully is what happens to a message after it is sent (the
 * promise list, already written) and which of the other doors is faster for the
 * thing the visitor probably wants — a shipment already moving belongs in
 * tracking or the portal, not in a general enquiry that waits behind a desk.
 */
/**
 * The tenant's public entities, read AFTER paint.
 *
 * Nobody on this page is waiting for it — the form is the page's job and it is
 * above this — so the read goes behind `after-paint`, the deferral primitive
 * PR 3 left for exactly this shape. Every failure is the empty answer: a
 * network error, a disabled `website` package and a tenant with no
 * public-enabled entity are one fact here, which is that there is no figure to
 * draw.
 */
function usePublicEntities(): PublicEntity[] {
  const [rows, setRows] = React.useState<PublicEntity[]>([]);
  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const cancel = afterPaint(() => {
      listPublicEntities({ signal: controller.signal })
        .then((next) => {
          if (alive) setRows(Array.isArray(next) ? next : []);
        })
        .catch(() => {
          /* silent-catch: PRESENTATION. A marketing figure that cannot load is
             a figure that is not drawn; there is no action for the visitor and
             no state to recover. doc/ERROR_HANDLING.md */
        });
    });
    return () => {
      alive = false;
      cancel();
      controller.abort();
    };
  }, []);
  return rows;
}

export function ContactPage() {
  const { t } = useTranslation();
  const entities = usePublicEntities();
  const promise = tList<{ t: string; d: string }>("site.contact.promise");

  useDocumentMeta({
    title: t("site.contact.title"),
    description: t("site.contact.sub"),
  });

  const elsewhere = [
    {
      to: p("/track"),
      title: t("site.footer.track"),
      body: t("site.contact.otherTrack"),
    },
    {
      to: "/portal/login",
      title: t("site.footer.portal"),
      body: t("site.contact.otherPortal"),
    },
    {
      to: p("/quote"),
      title: t("site.quote.bandCta"),
      body: t("site.contact.otherQuote"),
    },
  ];

  return (
    <PageShell label={t("site.contact.title")} footer>
      <section className="band-hero relative overflow-hidden">
        <BgMap />
        {/* Positioned, so the copy sits above the map rather than under it —
            the same arrangement the quote hero uses. */}
        <PageContainer className="relative">
          <BadgePill onDark>{t("site.contact.kicker")}</BadgePill>
          <SectionHead
            className="mt-4"
            as="h1"
            titleClass="hero-title"
            onDark
            /* F-17: the LCP element on this route, like every other §8 page. */
            title={<StagedLines paintImmediately text={t("site.contact.titleMain")} />}
            accent={t("site.contact.titleAccent")}
            lead={t("site.contact.sub")}
          />
        </PageContainer>
      </section>

      <Section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Card padded>
            <ContactForm />
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

      {/* §8.5's office/coverage figure, fed by §6.9's entities.
          "Where are you" is the second question a contact page is asked and
          this one could not answer it — the endpoint has existed since PR 2 and
          nothing read it. It draws nothing at all for a tenant with no
          public-enabled entity, which is the default (13787). */}
      {entities.length ? (
        <Section
          divided
          eyebrow={t("site.contact.coverageKicker")}
          eyebrowIcon={GlobeIcon}
          title={t("site.contact.coverageTitle")}
        >
          <div className="mx-auto max-w-3xl">
            <CoverageFigure entities={entities} />
          </div>
        </Section>
      ) : null}

      {/* The faster doors. A page that offers only a form routes everything
          through one queue — including the two questions this product answers
          without a person: where is my cargo, and what will it cost. */}
      <Section variant="muted" title={t("site.contact.otherTitle")} divided>
        <ul className="grid gap-5 md:grid-cols-3">
          {elsewhere.map((item) => (
            <li key={item.to}>
              <MediaCard
                className="h-full"
                title={item.title}
                to={item.to}
                linkLabel={t("site.contact.otherGo")}
              >
                {item.body}
              </MediaCard>
            </li>
          ))}
        </ul>
      </Section>
    </PageShell>
  );
}
