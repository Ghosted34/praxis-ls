import * as React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBranding } from "@/app/branding";
import { getLang } from "@/lib/i18n";
import { pickSlug, pickText } from "@/lib/services-api";
import { usePublishedServices } from "@/lib/use-services";
import { BrandGlyph } from "@/components/ui/icons";
import { LangToggle } from "./site-header";
import { ThemeToggle } from "./theme-toggle";
import { NewsletterForm } from "./newsletter-form";
import { afterPaint } from "@/lib/after-paint";
import { p } from "@/lib/base-path";

/**
 * The footer. Four columns and a small print line, which is what a logistics
 * site's footer carries on maersk.com and here for the same reason: by the time a
 * reader scrolls past the last section they have decided whether to trust the
 * page, and what they are looking for now is a way out — a phone, a legal page, a
 * language switch, the login they were sent earlier.
 *
 * ── NO DEAD LINKS ──────────────────────────────────────────────────────────
 *
 * Every target below is a route this app actually mounts. A "Terms of service"
 * column that 404s is worse than no column — it tells a procurement officer the
 * site is not maintained, which is an inference they will extend to the freight.
 * Legal pages and the tenant's address/phone are still OPEN items in README.md:
 * the API has no public field for any of them (`GET /branding` returns colours,
 * a name and logos), and inventing a registration number for a tenant we do not
 * know is forbidden by the same rule that keeps fake testimonials out
 * (`WEB_BUILD_BRIEF.md` N12).
 *
 * ── WHAT §9.5 ADDED, AND WHAT IT DID NOT ─────────────────────────────────
 *
 * "Footer gains About, the credentials line, and the legal entity line."
 *
 * About and the credentials line are here. Both are real: `/about` is a route
 * this PR mounts, and the credentials line names certifications the tenant has
 * entered and that have not expired — the read filters expiry, so a lapsed
 * licence leaves the footer on its own.
 *
 * THE LEGAL ENTITY LINE IS THE TENANT'S NAME AND NOTHING MORE, and that is the
 * honest version of it. A legal entity line normally carries a registration
 * number, and `GET /public/site/entities` deliberately does not publish one
 * (13787, §6.8): a trade-register number changes no visitor's decision and is
 * most of what somebody needs to impersonate a company to its own suppliers.
 * Printing "SARL au capital de …" for a tenant nobody asked would be inventing
 * it. So the line states the company's own legal name where an entity is
 * published, and the copyright line alone where none is.
 */
export function SiteFooter() {
  const { t } = useTranslation();
  const { branding } = useBranding();
  const name = branding.name || "Praxis";
  const year = new Date().getFullYear();

  const links = {
    services: [
      { to: p("/services"), label: t("site.services.all") },
      { to: p("/quote"), label: t("site.footer.quote") },
    ],
    // Tracking moved out of `services` and into this column: it is something a
    // CLIENT does, not something the tenant sells, and it was appearing in both.
    //
    // The portal had two entries — `site.footer.portal` and
    // `site.chrome.portalEntry` are different keys that render the same two
    // words, pointing at /portal and /portal/login — so the column read "Client
    // portal / Client portal / Track a shipment". check:i18n cannot catch that:
    // both keys exist in both languages, and it looks for missing text, not for
    // two keys that happen to agree.
    //
    // Two links, not three. The obvious third — /portal/set-password, for an
    // invited user — is a dead end from here: that page needs the `?token=`
    // from the invitation email and, reached bare, can only answer "that link
    // is incomplete". The marketing page's portal band offers it correctly,
    // under the sentence "Have an invitation link?"; a footer has no room for
    // that condition, and a link that can only fail is worse than the
    // duplicate it would replace.
    clients: [
      { to: "/portal/login", label: t("site.footer.portal") },
      { to: p("/track"), label: t("site.footer.track") },
    ],
    company: [
      // §9.1: About was absent from the footer as well as from the nav, and
      // `site.footer.about` has been in the dictionary unused since PR 1.
      { to: p("/about"), label: t("site.footer.about") },
      { to: p("#how"), label: t("site.how.title") },
      { to: p("/portfolio"), label: t("site.footer.portfolio") },
      { to: p("/careers"), label: t("site.footer.careers") },
      { to: p("/contact"), label: t("site.footer.contact") },
    ],
  };

  return (
    <footer className="band-hero no-print">
      <div className="wrap py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link to={p()} className="flex items-center gap-2.5">
              {branding.logoAltUrl || branding.logoUrl ? (
                <img
                  src={branding.logoAltUrl || branding.logoUrl || undefined}
                  alt={name}
                  className="h-8 w-auto max-w-[160px] object-contain object-left"
                />
              ) : (
                <>
                  <BrandGlyph name={name} size={30} />
                  <span className="font-display text-base font-semibold tracking-tight text-[var(--hero-foreground)]">
                    {name}
                  </span>
                </>
              )}
            </Link>
            <p className="mt-3 max-w-60 text-sm text-[var(--hero-muted)]">
              {t("site.hero.eyebrow")}
            </p>
          </div>

          {(
            [
              [t("site.footer.services"), links.services, true],
              [t("site.footer.clients"), links.clients, false],
              [t("site.footer.company"), links.company, false],
            ] as const
          ).map(([title, items, withServices]) => (
            <nav key={title} aria-label={title}>
              <h2 className="text-micro font-semibold uppercase tracking-[0.08em] text-[var(--hero-muted)]">
                {title}
              </h2>
              <ul className="mt-3 space-y-2">
                {items
                  .filter((i) => i.label)
                  .map((i) => (
                    <li key={i.to + i.label}>
                      <Link
                        to={i.to}
                        className="text-sm text-[var(--hero-foreground)] underline-offset-4 hover:underline"
                      >
                        {i.label}
                      </Link>
                    </li>
                  ))}
              </ul>
              {withServices ? <PublishedServiceLinks /> : null}
            </nav>
          ))}
        </div>

        <div className="mt-10 border-t border-[var(--hero-line)] pt-8">
          <NewsletterForm />
        </div>

        <FooterExtras />

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 text-xs text-[var(--hero-muted)]">
          <p>
            © {year} {name}. {t("site.footer.rights")}
          </p>
          <div className="flex items-center gap-3">
            <LangToggle onDark />
            <ThemeToggle onDark />
            <span>{t("site.footer.powered")}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

/** The service column, when the tenant has published profiles: the links a
 *  quote-hungry visitor wants are the ones that name what they already buy. It
 *  reads the shared cache in `lib/use-services.ts`, so the footer costs no extra
 *  request on any page that already fetched them. */
function PublishedServiceLinks() {
  const { services } = usePublishedServices();
  const lang = getLang();
  if (!services.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {services.slice(0, 6).map((s) => (
        <li key={s.service_type_id}>
          <Link
            to={p(`/services/${pickSlug(s, lang)}`)}
            className="text-sm text-[var(--hero-foreground)] underline-offset-4 hover:underline"
          >
            {pickText(s, "name", lang)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The social row and the small print — §9.5, loaded AFTER PAINT and OFF THE
 * FIRST-PAINT PATH.
 *
 * ── WHY THIS IS A DYNAMIC IMPORT AND NOT AN ORDINARY COMPONENT ────────────
 *
 * The footer is in the entry chunk: every route renders it, so anything it
 * statically imports is downloaded before the hero paints. What §9.5 adds is
 * two network reads, seven social glyph paths and the readers behind them —
 * and the first `check:bundle` run after writing them put first paint at
 * 129.4 kB against a 128 kB budget. The budget is not a target to be raised
 * (PR 4 left it at 96%); the content genuinely does not belong on the critical
 * path.
 *
 * Nothing is lost by deferring it. Both reads were already behind
 * `after-paint`, both blocks are below the fold on every route, and neither can
 * render anything before its answer arrives. So the chunk is fetched at exactly
 * the moment the data is, and a visitor who never scrolls has paid for
 * neither.
 *
 * ── EVERY FAILURE IS SILENT, AND THAT IS WHY IT IS NOT `React.lazy` ───────
 *
 * `React.lazy` propagates a failed chunk fetch to the nearest error boundary.
 * For a footer decoration that is the wrong trade by a wide margin: a flaky
 * CDN response would blank the page a visitor is reading. This is the pattern
 * `corridor-scene.tsx` already uses for its WebGL enhancement — import, set
 * state, and on any failure simply never render. There is no error state,
 * because there is no error: there is a footer, and it is the one above.
 */
function FooterExtras() {
  const [Extras, setExtras] = React.useState<React.ComponentType | null>(null);

  React.useEffect(() => {
    let alive = true;
    const cancel = afterPaint(() => {
      import("./footer-extras")
        .then((mod) => {
          if (alive) setExtras(() => mod.FooterExtrasContent);
        })
        .catch(() => {
          /* silent-catch: PRESENTATION. See the header — the footer above is
             complete and this is an addition to it. doc/ERROR_HANDLING.md */
        });
    });
    return () => {
      alive = false;
      cancel();
    };
  }, []);

  return Extras ? <Extras /> : null;
}
