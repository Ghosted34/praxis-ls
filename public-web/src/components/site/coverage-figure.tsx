import { useTranslation } from "react-i18next";
import { getLang } from "@/lib/i18n";
import { coverageLabels, type PublicEntity } from "@/lib/site-api";

/**
 * Where the tenant stands, and where they deliver — §8.5's "office/coverage
 * map", drawn from `/public/site/entities` (§6.9).
 *
 * ── IT IS A NETWORK, NOT A PROJECTION, AND THAT IS DELIBERATE ─────────────
 *
 * §8.5 says "map" and this is not one. The same call PR 3 made for the corridor
 * scene (D-12), for two reasons that both still hold and one that is new:
 *
 *   · **A projection needs geometry.** Country outlines are tens of kilobytes
 *     even simplified, on a page with a 128 kB first-paint budget, to draw
 *     shapes that carry no information the labels do not. Shipping a CEMAC
 *     basemap would be worse still: it hardcodes one tenant's region into a
 *     white-label product, and the next tenant operates from Mombasa.
 *   · **A projection adds inference, not data.** PR 3's `corridor-panel.tsx`
 *     put it best and it generalises: a line drawn between two points invites
 *     the reader to trace it. Here the facts are "this entity is registered in
 *     this country" and "this entity says it covers these places". A map would
 *     additionally imply distances, borders and routes the tenant never stated.
 *   · **The tenant's own words are the naming.** Coverage rows carry
 *     `label_fr`/`label_en`, so the figure prints what they wrote. A map would
 *     need our country names under our borders, which is a claim about
 *     somebody else's market.
 *
 * So it is a bipartite fan: offices on the left, the places they cover on the
 * right, a line for each relationship the tenant actually recorded. Every mark
 * corresponds to one row. Nothing is interpolated between them.
 *
 * ── AND IT DRAWS NOTHING WHEN THERE IS NOTHING ────────────────────────────
 *
 * `public_enabled` is off until somebody turns it on deliberately (13787), so
 * the normal state for a new tenant is zero entities. The figure returns null
 * rather than an empty frame — no "our network" heading over white space, which
 * is the N12 failure this whole app is careful about.
 */

/** Vertical rhythm of the fan, in SVG units. */
const ROW = 34;
const PAD = 18;

export function CoverageFigure({ entities }: { entities: PublicEntity[] }) {
  const { t } = useTranslation();
  const lang = getLang();

  /*
   * One row per RELATIONSHIP, flattened, because that is what the drawing
   * shows. An entity with no coverage still appears — it is an office, which is
   * a fact worth stating — but it contributes no line.
   */
  const offices = (entities || [])
    .map((e) => ({
      id: e.id,
      name: e.trading_name || e.legal_name,
      country: e.country_code || null,
      covers: coverageLabels(e, lang),
    }))
    .filter((o) => !!o.name);

  if (!offices.length) return null;

  // Every place any office covers, de-duplicated and in first-seen order, so a
  // country served by two offices is one node with two lines into it rather
  // than two nodes saying the same thing.
  const places: string[] = [];
  for (const o of offices) {
    for (const c of o.covers) if (!places.includes(c)) places.push(c);
  }

  const height = Math.max(offices.length, places.length, 1) * ROW + PAD * 2;
  const officeY = (i: number) =>
    PAD + ROW / 2 + i * ROW + ((height - PAD * 2 - offices.length * ROW) / 2);
  const placeY = (i: number) =>
    PAD + ROW / 2 + i * ROW + ((height - PAD * 2 - places.length * ROW) / 2);

  return (
    <figure className="coverage-figure">
      <svg
        viewBox={`0 0 320 ${height}`}
        className="coverage-art"
        role="img"
        /* The figure is a drawing of the list beneath it, so its accessible
           name says that. The offices and places are real text in the DOM
           below and are read normally — describing the picture too would
           announce the same content twice. */
        aria-label={t("site.contact.coverageAlt")}
      >
        {offices.map((o, i) =>
          o.covers.map((place) => {
            const j = places.indexOf(place);
            const y1 = officeY(i);
            const y2 = placeY(j);
            return (
              <path
                key={`${o.id}-${place}`}
                className="coverage-link"
                pathLength="1"
                /* A curve rather than a straight line, so two links landing on
                   the same node stay distinguishable where they meet. */
                d={`M96 ${y1} C 160 ${y1}, 160 ${y2}, 224 ${y2}`}
              />
            );
          }),
        )}
        {offices.map((o, i) => (
          <circle
            key={o.id}
            className="coverage-node coverage-office"
            cx="96"
            cy={officeY(i)}
            r="5"
          />
        ))}
        {places.map((place, i) => (
          <circle
            key={place}
            className="coverage-node"
            cx="224"
            cy={placeY(i)}
            r="4"
          />
        ))}
      </svg>

      {/* THE TEXT IS THE FIGURE'S CONTENT, not its caption.
          Positioned over the drawing at wide widths and stacked beneath it when
          there is no room — the same arrangement, and the same reasoning, as
          the ESG triptych's annotations. */}
      <div className="coverage-labels">
        <div className="coverage-col coverage-col-l">
          <p className="micro">{t("site.contact.offices")}</p>
          <ul>
            {offices.map((o) => (
              <li key={o.id}>{o.name}</li>
            ))}
          </ul>
        </div>
        <div className="coverage-col coverage-col-r">
          <p className="micro">{t("site.contact.covers")}</p>
          {places.length ? (
            <ul>
              {places.map((place) => (
                <li key={place}>{place}</li>
              ))}
            </ul>
          ) : (
            /* Offices but no declared coverage. Said plainly — an office IS the
               answer to "where are you", and a blank second column would read
               as a page that failed to load half of itself. */
            <p className="text-sm text-muted-foreground">
              {t("site.contact.coverageNone")}
            </p>
          )}
        </div>
      </div>
    </figure>
  );
}
