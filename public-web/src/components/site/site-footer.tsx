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
 * Legal pages, an about page and the tenant's address/phone are OPEN items in
 * README.md: the API has no public field for any of them (`GET /branding` returns
 * colours, a name and logos), and inventing a registration number for a tenant we
 * do not know is forbidden by the same rule that keeps fake testimonials out
 * (`WEB_BUILD_BRIEF.md` N12).
 */
export function SiteFooter() {
  const { t } = useTranslation();
  const { branding } = useBranding();
  const name = branding.name || "Praxis";
  const year = new Date().getFullYear();

  const links = {
    services: [
      { to: "/public/services", label: t("site.services.all") },
      { to: "/public#quote", label: t("site.footer.quote") },
      { to: "/public/track", label: t("site.footer.track") },
    ],
    clients: [
      { to: "/portal", label: t("site.footer.portal") },
      { to: "/portal/login", label: t("site.chrome.portalEntry") },
      { to: "/public/track", label: t("site.hero.cta2") },
    ],
    company: [
      { to: "/public#how", label: t("site.how.title") },
      { to: "/public/portfolio", label: t("site.footer.portfolio") },
      { to: "/public/careers", label: t("site.footer.careers") },
      { to: "/public#contact", label: t("site.footer.contact") },
    ],
  };

  return (
    <footer className="band-hero no-print">
      <div className="wrap py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link to="/public" className="flex items-center gap-2.5">
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

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 text-xs text-[var(--hero-muted)]">
          <p>
            © {year} {name}. {t("site.footer.rights")}
          </p>
          <div className="flex items-center gap-3">
            <LangToggle onDark />
            <ThemeToggle onDark />
            <span className="opacity-70">{t("site.footer.powered")}</span>
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
            to={`/public/services/${pickSlug(s, lang)}`}
            className="text-sm text-[var(--hero-foreground)] underline-offset-4 hover:underline"
          >
            {pickText(s, "name", lang)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
