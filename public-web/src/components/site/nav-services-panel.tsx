import * as React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getLang } from "@/lib/i18n";
import { usePublishedServices } from "@/lib/use-services";
import { iconByName, modeToken } from "@/lib/service-identity";
import { MODE_ICONS } from "@/lib/service-modes";
import { ArrowRightIcon } from "@/components/ui/icons";
import { p } from "@/lib/base-path";
import type { ServiceCard, ServiceGroup } from "@/lib/services-api";

/**
 * The Services panel — the bar extending downward, not a popup over it.
 *
 * ── IT IS THE TENANT'S SERVICES, AND IT IS ABSENT WHEN THERE ARE NONE ──────
 *
 * Nothing in this file names a service, a pillar or a transport mode. The
 * groups come from `/public/services`, which is what the tenant published, and
 * the mode colours are the same four the services grid and the corridor scene
 * already speak — so the panel is the site's own colour language rather than a
 * second one invented for the header.
 *
 * A tenant who has published nothing, or whose `website` package is off, gets
 * NO PANEL AND NO CHEVRON: the Services entry stays exactly the plain link it
 * was. Same rule as the announcements band, and for the same reason — a
 * disclosure that opens onto an empty grid is worse than no disclosure, and it
 * is the tenant's own homepage that would be showing it.
 *
 * ── WHY THE TRIGGER IS A LINK *AND* A BUTTON ──────────────────────────────
 *
 * A nav item that opens a panel on hover is unreachable by keyboard, and one
 * that opens on click stops being a link to the services page. The WAI pattern
 * for exactly this is a link plus a small adjacent disclosure button, and it is
 * what is built here: the label navigates, the chevron toggles, `aria-expanded`
 * lives on the chevron where a screen reader will find it, and hover is a
 * pointer-only convenience layered on top that changes nothing about either.
 *
 * ── AND WHY IT DOES NOT TRAP FOCUS ─────────────────────────────────────────
 *
 * This is a disclosure, not a dialog. Tabbing out of the last link must reach
 * the CTA in the header, not wrap back to the first service. Escape closes and
 * returns focus to the chevron, which is the one dialog-ish behaviour that
 * belongs here.
 */

/** How many services one pillar shows before the panel points at the full page
 *  instead. A tenant with thirty published profiles must not get all thirty in
 *  a drop panel — that is the services page, and it exists. */
const PER_GROUP = 5;

/** The most pillars the grid draws. Four is what fits the wrap at 1280px
 *  without the columns becoming unreadably narrow; the rest are one line away
 *  on the services page. */
const MAX_GROUPS = 4;

const groupName = (g: ServiceGroup, lang: string) =>
  (lang === "en" ? g.name_en || g.name_fr : g.name_fr || g.name_en) || null;

const serviceName = (s: ServiceCard, lang: string) =>
  (lang === "en" ? s.name_en || s.name_fr : s.name_fr || s.name_en) || "";

const serviceSlug = (s: ServiceCard, lang: string) =>
  (lang === "en" ? s.slug_en || s.slug_fr : s.slug_fr || s.slug_en) || "";

/**
 * DEFAULT-EXPORTED, and the readiness rule lives in `nav-services-ready.ts`.
 *
 * This module is loaded by `React.lazy` from the header, so everything it pulls
 * in — the icon set, the mode table, the identity helpers — stays out of the
 * first-paint bundle. `nav-services-ready.ts` says what that separation cost to
 * discover. The default export is what `lazy()` wants; the named one is kept
 * for the tests, which have no reason to go through Suspense.
 */
export function NavServicesPanel({
  id,
  open,
  onClose,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const { groups } = usePublishedServices();

  const shown = groups.slice(0, MAX_GROUPS);
  /* A pillar the tenant never named — 12755's trailing bucket, where every
     service that belongs to no group lands. It is a real column of real
     services and it gets the generic heading rather than an empty one, because
     a column with no head reads as the previous column having overflowed. */
  const heading = (g: ServiceGroup) => groupName(g, lang) || t("site.nav.servicesAll");

  return (
    <div
      id={id}
      className="nav-panel"
      /* Not `hidden`, and not unmounted: the panel animates CLOSED as well as
         open, and an element removed from the DOM has nothing to animate. It is
         inert in every other sense — see `.nav-panel` in index.css, which drops
         pointer events and visibility together so a closed panel is neither
         clickable nor in the tab order. */
      data-open={open ? "true" : "false"}
      aria-hidden={open ? undefined : "true"}
      onMouseLeave={onClose}
    >
      {/* The lit edge along the top, continuing the bar's own. It is what makes
          the panel read as the header extruding downward rather than as a card
          that happened to appear underneath it. */}
      <span aria-hidden className="nav-panel-edge" />

      <div className="wrap grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-8 gap-y-6 pb-8 pt-7">
        {shown.map((g, gi) => {
          const GroupIcon = iconByName(g.icon);
          return (
            <div
              key={g.key ?? `ungrouped-${gi}`}
              className="nav-panel-col"
              /* The stagger. Read by the stylesheet as a delay so the columns
                 arrive left to right — the direction the panel is read in. */
              style={{ "--i": gi } as React.CSSProperties}
            >
              <div className="micro nav-panel-head">
                {GroupIcon ? <GroupIcon size={15} aria-hidden /> : null}
                <span>{heading(g)}</span>
              </div>
              <ul className="flex flex-col gap-0.5">
                {g.services.slice(0, PER_GROUP).map((s) => {
                  const slug = serviceSlug(s, lang);
                  const ModeIcon = MODE_ICONS[s.mode];
                  const tone = modeToken(s.mode);
                  return (
                    <li key={s.service_type_id}>
                      <Link
                        to={p(`/services/${encodeURIComponent(slug)}`)}
                        className="nav-panel-link"
                        /* The lane colour, or nothing. `modeToken` answers null
                           for CUSTOMS, WAREHOUSE and OTHER on purpose: the four
                           hues mean the four ways cargo MOVES, and a customs
                           file does not move. Those rows take the foreground
                           ink instead of borrowing a meaning they do not have. */
                        style={
                          tone
                            ? ({ "--tone": tone } as React.CSSProperties)
                            : undefined
                        }
                        data-toned={tone ? "true" : "false"}
                      >
                        <span aria-hidden className="nav-panel-glyph">
                          <ModeIcon size={14} />
                        </span>
                        <span className="nav-panel-label">
                          {serviceName(s, lang)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
                {g.services.length > PER_GROUP ? (
                  <li>
                    <Link
                      to={p("/services")}
                      className="more-link py-1.5 text-[0.8125rem]"
                    >
                      {t("site.nav.servicesMore", {
                        count: g.services.length - PER_GROUP,
                      })}
                    </Link>
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })}

        {/* The closing column: where the panel sends somebody who did not find
            their answer in it. A quote is the commercial exit and the services
            page is the exhaustive one — both, because they are different
            questions and the panel has room to answer each once. */}
        <div
          className="nav-panel-col flex flex-col items-start gap-2.5"
          style={{ "--i": shown.length } as React.CSSProperties}
        >
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            {t("site.nav.servicesPitch")}
          </p>
          {/* `.btn-primary` and `.more-link`, not panel-specific copies of
              them. Guide §3.5: the primitives exist, and a second definition of
              "the commercial button" is the one that stops matching the CTA in
              the bar above it. */}
          <Link
            to={p("/quote")}
            className="btn-primary inline-flex h-[2.375rem] items-center gap-2 rounded-[calc(var(--radius)-2px)] px-[0.9375rem] text-sm font-semibold"
          >
            {t("site.hero.cta")}
            <ArrowRightIcon size={14} />
          </Link>
          <Link
            to={p("/services")}
            className="more-link py-1.5 text-[0.8125rem]"
          >
            {t("site.nav.servicesAll")}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default NavServicesPanel;
