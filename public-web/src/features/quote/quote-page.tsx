import { useTranslation } from "react-i18next";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { tList } from "@/lib/i18n";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
import { SectionHead } from "@/components/site/section-head";
import { BadgePill } from "@/components/ui/badge-pill";
import { BgMap } from "@/components/ui/bg-map";
import { Card } from "@/components/ui/card";
import { QuoteWizard } from "@/components/site/quote-wizard";
import { usePublishedServices } from "@/lib/use-services";

/**
 * `/quote` — the quote desk, on its own page.
 *
 * ── WHY THIS IS NOT A BAND ON THE HOME PAGE ────────────────────────────────
 *
 * It was one, and the header's "Request a quote" button pointed at
 * `/public#quote`. That is broken in a single-page app in two different ways,
 * and both of them look like a dead button to a visitor:
 *
 *   · **From another page**, the router navigates to the home page and the
 *     browser tries to scroll to `#quote` before the lazily-loaded marketing
 *     chunk has rendered the element. There is nothing to scroll to yet, so the
 *     visitor lands at the top of the home page having asked for a form.
 *   · **From the home page itself**, the URL's hash changes and React Router
 *     re-renders what is already mounted. No navigation, no scroll, nothing
 *     happens at all.
 *
 * A route fixes both because there is no scroll to time — the page IS the form.
 *
 * It also buys three things a hash cannot:
 *
 *   · a URL somebody can send. "Fill this in" is the single most-pasted link a
 *     sales desk produces, and `…/#quote` drops a recipient at the top of a
 *     marketing page.
 *   · its own title, description and share card. A quote form is a conversion
 *     page and it is worth indexing on its own terms.
 *   · a lighter home page. The wizard, the place picker and the file reader are
 *     a route-level chunk now, so a visitor who came to read about services no
 *     longer downloads a four-step form to scroll past it.
 *
 * The home page keeps `#quote` as a band that points here, so links already in
 * circulation still land somewhere that makes sense.
 */
export function QuotePage() {
  const { t } = useTranslation();
  const { services } = usePublishedServices();
  const steps = tList<{ t: string; d: string }>("site.quote.steps");

  useDocumentMeta({
    title: t("site.quote.title"),
    description: t("site.quote.sub"),
  });

  return (
    <PageShell label={t("site.quote.title")} footer>
      <section className="band-hero relative overflow-hidden">
        <BgMap />
        {/* The container is positioned so the copy sits ABOVE the map rather
            than being painted over by it. */}
        <PageContainer className="relative">
          {/* The shared components, not a hand-rolled pill and heading — this
              hero was written before they existed and was the second instance
              the plan's acceptance list tells a reviewer to catch. */}
          <BadgePill onDark>{t("site.quote.kicker")}</BadgePill>
          <SectionHead
            className="mt-4"
            as="h1"
            titleClass="hero-title"
            onDark
            title={t("site.quote.titleMain")}
            accent={t("site.quote.titleAccent")}
            lead={t("site.quote.sub")}
          />
        </PageContainer>
      </section>

      <Section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Card padded>
            <QuoteWizard services={services} />
          </Card>
          {/* Sticky, and `self-start` is what makes that work: a grid item
              stretches to the row height by default, so a sticky child inside a
              full-height column has nothing to stick within and scrolls away
              with the form. `top-24` clears the sticky site header.

              It stops being sticky below `lg`, where the two columns stack and
              a pinned block would sit on top of the form it is explaining. */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <h2 className="text-title font-semibold tracking-tight">
              {t("site.quote.whatHappens")}
            </h2>
            <ol className="mt-5 space-y-5">
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
    </PageShell>
  );
}
