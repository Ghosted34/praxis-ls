import * as React from "react";
import { useTranslation } from "react-i18next";
import { getLang } from "@/lib/i18n";
import {
  getSitePage,
  HOME_PAGE_KEY,
  pickBilingual,
  statChips,
  statCounters,
  type SitePage,
} from "@/lib/site-api";
import { CountUp } from "@/components/ui/count-up";

/**
 * The proof strip — figures and credentials, directly under the hero.
 *
 * ── WHY THIS BAND EXISTS ───────────────────────────────────────────────────
 *
 * A visitor who scrolls one screen should have seen a number, a certification
 * and a network name. Without them the page is a well-mannered brochure that
 * asks to be trusted and offers nothing to trust — and a reader who has not
 * seen proof by the time they reach the services grid reads the whole page as
 * a new company.
 *
 * ── WHY EVERY WORD IN IT BELONGS TO THE TENANT ────────────────────────────
 *
 * `WEB_BUILD_BRIEF.md` N12, and it binds hardest here. A figure is the one
 * thing on a marketing page worth the most when true and costing the most when
 * not, and this is a white-label product: a "41,850 CBM managed" typed into
 * this file would be a claim on every tenant's public website that nobody at
 * that tenant ever made. So the strip renders `stat_counters` and `stat_chips`
 * blocks the tenant authored on their own home page, and the server has already
 * replaced each figure with the live value where the block named a metric
 * (`site_content.metrics.js`) — which is the thing no web agency can sell them:
 * numbers that are true this morning rather than true on the day somebody typed
 * them.
 *
 * ── AND WHY IT DRAWS NOTHING RATHER THAN A PLACEHOLDER ────────────────────
 *
 * No page, no published page, no `website` package, no stat blocks: the band is
 * simply not there. The alternative — a row of dashes, or "statistics coming
 * soon" — is the same category of harm as an invented number, in the honest
 * direction: it advertises that the site is unfinished on the screen that
 * decides whether a reader keeps scrolling.
 *
 * It also means the band POPS IN on a slow connection rather than reserving
 * space, and that is the deliberate side of the trade. A skeleton here would
 * hold a hole open on every tenant who has no strip, which is most of them
 * until they write one; a band that appears when it has something to say holds
 * nothing open for anybody.
 *
 * ── CARBON, AND WHY THAT IS NOT A SECOND DARK BAND ────────────────────────
 *
 * It butts straight under the hero on the same `--hero` ground, separated by a
 * hairline rather than by a gap, so hero and strip read as one plate. The one
 * dark LANDMARK further down the page is the portal band; this is the bottom
 * edge of the first one.
 */
export function ProofStrip() {
  const { t } = useTranslation();
  const lang = getLang();
  const [page, setPage] = React.useState<SitePage | null>(null);

  React.useEffect(() => {
    let alive = true;
    getSitePage(HOME_PAGE_KEY).then((row) => {
      if (alive) setPage(row);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Three or four figures. A fifth makes the row a table, and the fourth is
  // already the one a reader stops reading at.
  const figures = statCounters(page).slice(0, 4);
  // Six is two rows of pills at the narrowest useful width; past that the row
  // stops being a glance and starts being a list.
  const chips = statChips(page).slice(0, 6);

  if (!figures.length && !chips.length) return null;

  return (
    <section
      className="band-hero border-t border-[var(--hero-line)]"
      aria-label={t("site.proof.stripLabel")}
    >
      <div className="wrap py-10 md:py-12">
        {figures.length ? (
          <ul className="grid grid-cols-1 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {figures.map((f, i) => (
              <li
                key={`${pickBilingual(f.label, lang)}-${i}`}
                // Hairlines only where the row is actually a row. At sm the
                // grid wraps, and a left rule on the third cell would draw a
                // divider in the middle of nothing.
                className="lg:border-l lg:border-[var(--hero-line)] lg:pl-6 lg:first:border-l-0 lg:first:pl-0"
              >
                <p className="stat-figure">
                  <CountUp value={f.value} />
                  {f.unit ? (
                    <span className="ml-2 text-[0.6em] font-semibold uppercase text-[var(--hero-muted)]">
                      {f.unit}
                    </span>
                  ) : null}
                </p>
                <p className="stat-label mt-2">{pickBilingual(f.label, lang)}</p>
                {f.sublabel ? (
                  <p className="mt-1 text-xs text-[var(--hero-muted)]">
                    {pickBilingual(f.sublabel, lang)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {chips.length ? (
          <ul
            className={`flex flex-wrap items-center gap-2 ${figures.length ? "mt-9 border-t border-[var(--hero-line)] pt-7" : ""}`}
          >
            {chips.map((c, i) => {
              const value = pickBilingual(c.value, lang);
              const label = pickBilingual(c.label, lang);
              return (
                <li key={`${value}-${i}`} className="credential-pill">
                  <span className="font-semibold">{value}</span>
                  {label && label !== value ? (
                    <span className="text-[var(--hero-muted)]">{label}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
