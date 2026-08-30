import { useTranslation } from "react-i18next";
import { useDocumentMeta } from "@/lib/use-document-meta";
import { tList } from "@/lib/i18n";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
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
      <section className="band-hero">
        <PageContainer>
          {/* The badge pill their portal carries above its h1, which
              doc/UI_UPGRADE_PLAN.md §7.1 left open on this page. It marks what
              KIND of page this is before the heading says what it is about. */}
          <p className="eyebrow inline-flex items-center rounded-full border border-[rgb(237_238_238/0.25)] px-3 py-1 text-[var(--brand-orange)]">
            {t("site.quote.kicker")}
          </p>
          <h1 className="hero-title mt-4 text-[var(--hero-foreground)]">
            {t("site.quote.titleMain")}{" "}
            {/* The accent word (§4 pattern 2). One <span> inside the heading,
                so the h1 keeps a single accessible name. */}
            <span className="text-[var(--brand-orange)]">
              {t("site.quote.titleAccent")}
            </span>
          </h1>
          <p className="mt-4 max-w-measure text-[var(--hero-muted)]">
            {t("site.quote.sub")}
          </p>
        </PageContainer>
      </section>

      <Section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Card padded>
            <QuoteWizard services={services} />
          </Card>
          <div>
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
