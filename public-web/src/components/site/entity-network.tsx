import * as React from "react";
import { useTranslation } from "react-i18next";
import { getLang } from "@/lib/i18n";
import {
  coverageLabels,
  mediaSrcSet,
  mediaUrl,
  pickBilingual,
  type PublicEntity,
} from "@/lib/site-api";
import { laneControl, type GraphNode } from "@/lib/corridor-graph";
import { LeaderGrid } from "./leader-card";
import { motionReduced, usePointerLight } from "@/lib/motion";
import { modeToken } from "@/lib/service-identity";
import { cn } from "@/lib/cn";

/**
 * The corporate entities, drawn as a network — guide §9.2.
 *
 * ── IT REUSES PR 3's SPATIAL IDEA RATHER THAN INVENTING A SECOND ──────────
 *
 * §9.2 is explicit about this: "Reuses PR 3's corridor scene rather than
 * inventing a second spatial idea." So the vocabulary is the corridor scene's,
 * exactly — nodes on a ring, chords between them bowed toward the centre by
 * `laneControl`, the shared `--lx`/`--ly` pointer light, one tab stop with
 * arrow keys inside it, `tabindex="-1"` on every node.
 *
 * What differs is what the nodes MEAN, and that is the whole point of §9.2:
 * "the group structure and the service network are the same picture". On the
 * homepage a node is a PLACE and a chord is a lane the tenant has run. Here a
 * node is a LEGAL COMPANY and a chord is a place two of them both cover — so
 * the drawing shows which subsidiaries actually overlap in the field, which is
 * a fact a group-structure org chart cannot state and a map would only imply.
 *
 * ── Q13 SAID "MAP-FIRST" AND THIS IS STILL NOT A MAP ──────────────────────
 *
 * §9.2 quotes Q13 option B — "Entities placed geographically". It is not drawn
 * geographically here, and the reason is the one D-12 and D-17 already gave
 * twice and that got stronger each time:
 *
 *   · Country geometry is tens of kilobytes against a 128 kB budget, to draw
 *     shapes carrying nothing the labels do not.
 *   · A CEMAC basemap hardcodes one tenant's region into a white-label
 *     product. The next tenant operates from Mombasa.
 *   · A projection adds INFERENCE. The facts are "this company is registered
 *     here" and "it says it covers these places". A map additionally implies
 *     distances, borders and routes nobody stated.
 *
 * Recorded as a deviation for the third time, because the third time is when a
 * spec is wrong rather than when three engineers were lazy.
 *
 * ── THE FALLBACK IS AN ORG CHART, AND §9.2 SAYS IT MUST BE CLEAN ──────────
 *
 * "An org-chart fallback for reduced motion and for narrow screens — and it
 * must be clean, not a squashed map." It is not a fallback in the CSS sense:
 * the cards below the figure are ALWAYS rendered and are the page's real
 * content. The figure is an illustration of them. Under reduced motion, and
 * below the width where a ring is legible, the figure is simply not drawn and
 * nothing is missing — which is the only version of a fallback anybody
 * maintains (§8.4's lesson, in ESG's own header).
 */

/** Ring position for node `i` of `n` — the same placement `corridor-graph.ts`
 *  uses, so the two scenes on this site share a geometry as well as a palette.
 *  Rotated so no node sits at exactly 12 o'clock, where it reads as a title. */
function ringPoint(i: number, n: number): { x: number; y: number } {
  const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2 + 0.35;
  return { x: Math.cos(a), y: Math.sin(a) };
}

type EntityNode = GraphNode & {
  entity: PublicEntity;
  /** Upper-cased ISO codes this company sits in or covers. The join key, and
   *  the only thing about a place this drawing uses. */
  codes: string[];
};

type Link = { from: number; to: number; shared: number };

/**
 * The graph: one node per public entity, one chord per pair that shares ground.
 *
 * ── THE JOIN IS ON `country_code` AND NOTHING ELSE ────────────────────────
 *
 * The same rule `site-api.ts` states for the corridor scene, for the same
 * reason: an exact code-to-code match, both sides authored by the tenant.
 * Matching an address against a place NAME is inference — "Douala" against
 * "Douala, Littoral, Cameroun" works until the first tenant who writes it
 * differently — and a page that quietly mislabels where a company operates is
 * exactly what N12 exists to prevent.
 *
 * A pair with no shared code gets NO chord. Two subsidiaries that do not
 * overlap are two nodes on a ring, which is the truth about them.
 */
export function buildEntityGraph(entities: PublicEntity[]): {
  nodes: EntityNode[];
  links: Link[];
} {
  const nodes: EntityNode[] = entities.map((e, i) => {
    const codes = new Set<string>();
    if (e.country_code) codes.add(e.country_code.toUpperCase());
    for (const c of e.coverage || []) {
      if (c?.country_code) codes.add(String(c.country_code).toUpperCase());
    }
    return {
      id: e.id,
      label: e.trading_name || e.legal_name,
      weight: codes.size,
      present: true,
      codes: [...codes],
      entity: e,
      ...ringPoint(i, entities.length),
    };
  });

  const links: Link[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const shared = nodes[i].codes.filter((c) => nodes[j].codes.includes(c)).length;
      if (shared > 0) links.push({ from: i, to: j, shared });
    }
  }
  return { nodes, links };
}

/** The transport colour of an entity's FIRST declared service focus, or null.
 *
 *  `modeToken` returns null rather than a fallback, deliberately (PR 4's note):
 *  an entity that declares no mode is not secretly a sea entity, and a
 *  positional colour must never appear where the page states a fact. A node
 *  with no mode takes the neutral ink. */
function entityMode(e: PublicEntity): string | null {
  const first = (e.focus || []).find((f) => f?.mode);
  return first?.mode ? modeToken(first.mode) : null;
}

export function EntityNetwork({ entities }: { entities: PublicEntity[] }) {
  const { t } = useTranslation();
  const still = motionReduced();
  const { nodes, links } = React.useMemo(() => buildEntityGraph(entities), [entities]);
  const [active, setActive] = React.useState(0);
  const nodeRefs = React.useRef<Array<SVGGElement | null>>([]);
  const lightRef = usePointerLight<HTMLDivElement>();

  /* ONE ENTITY IS NOT A NETWORK. A ring with a single node on it and no chords
     is a dot, and a dot presented as "our network" is a claim the data does not
     support. The cards below still render — one company is a perfectly good
     About page — and the figure simply is not drawn. */
  const drawable = nodes.length >= 2 && !still;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!nodes.length) return;
    let next = active;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (active + 1) % nodes.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (active - 1 + nodes.length) % nodes.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = nodes.length - 1;
    else if (e.key === "Escape") {
      /* Out of the nodes, onto the figure — and the next Tab genuinely
         continues down the page, because no node is in the tab sequence. F-19
         is the finding that made this the pattern: a roving `tabindex="0"`
         reads correctly and puts the visitor straight back inside the scene
         they asked to leave. */
      (e.currentTarget as HTMLElement).focus();
      return;
    } else return;
    e.preventDefault();
    setActive(next);
    nodeRefs.current[next]?.focus();
  };

  if (!nodes.length) return null;

  return (
    <div className="entity-network">
      {drawable ? (
        <div ref={lightRef} className="entity-stage">
          <svg
            viewBox="-130 -130 260 260"
            role="group"
            aria-label={t("site.about.networkLabel")}
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="entity-svg"
          >
            <circle r="100" className="corridor-ring" fill="none" strokeWidth="0.5" />
            {links.map((l, i) => {
              const a = nodes[l.from];
              const b = nodes[l.to];
              const c = laneControl(a, b);
              return (
                <path
                  key={i}
                  className="entity-link"
                  d={`M ${a.x * 100} ${a.y * 100} Q ${c.x * 100} ${c.y * 100} ${b.x * 100} ${b.y * 100}`}
                  fill="none"
                  /* Weight is the NUMBER of shared places, capped: two
                     companies covering eight of the same countries is a
                     stronger tie than two sharing one, and the cap stops a
                     tenant with a wide coverage list drawing one rope across
                     the middle. */
                  strokeWidth={0.6 + Math.min(l.shared, 5) * 0.35}
                  strokeLinecap="round"
                />
              );
            })}
            {nodes.map((n, i) => {
              const token = entityMode(n.entity);
              return (
                <g
                  key={n.id}
                  ref={(el) => {
                    nodeRefs.current[i] = el;
                  }}
                  /* Every node `tabindex="-1"`, the figure the single stop —
                     F-19 again. Programmatically focusable is all the arrow
                     keys need. */
                  tabIndex={-1}
                  role="button"
                  aria-label={n.label ?? undefined}
                  onFocus={() => setActive(i)}
                  onMouseEnter={() => setActive(i)}
                  className={cn("entity-node", i === active && "is-active")}
                  transform={`translate(${n.x * 100} ${n.y * 100})`}
                >
                  <circle r="12" fill="transparent" />
                  <circle className="entity-node-halo" r="9" />
                  <circle
                    className="entity-node-dot"
                    r="5"
                    style={token ? { fill: `rgb(var(${token}))` } : undefined}
                  />
                </g>
              );
            })}
          </svg>

          {/* The label for the focused node, OUTSIDE the svg — text in an SVG
              at this scale is a font-size fight with the viewBox and does not
              reflow. Same call the corridor scene made. */}
          <p className="entity-readout" aria-live="polite">
            <span className="entity-readout-name">{nodes[active]?.label}</span>
            {nodes[active] ? (
              <span className="entity-readout-count">
                {t("site.about.networkPlaces", { count: nodes[active].codes.length })}
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      {/* ALWAYS RENDERED. See the header: these cards are the content and the
          figure is an illustration of them, which is why there is no second
          "org chart" component to fall out of date. */}
      <ul className="entity-cards">
        {nodes.map((n, i) => (
          <li key={n.id}>
            <EntityCard
              entity={n.entity}
              highlighted={drawable && i === active}
              onHover={() => setActive(i)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One legal company.
 *
 * ── WHAT IS ON IT, AND WHAT CANNOT BE ─────────────────────────────────────
 *
 * §9.2's list: trading name, country, registered address, coverage areas,
 * service focus, cover asset, and that entity's leadership. Then: "**No RCCM,
 * no NIU** (§6.8)."
 *
 * Nothing in this component filters those out, because they are not in the
 * payload — `publicEntities` builds an explicit object field by field, and
 * `site-public-redaction.test.js` asserts on the serialised body that they are
 * absent. `about-page.test.tsx` asserts it a second time against the RENDERED
 * DOM, which is the check §9.7 actually asks for: "re-verified against the
 * rendered page".
 *
 * ── THE REGISTERED ADDRESS IS ALSO NOT HERE, AND THAT IS NOT AN OMISSION ──
 *
 * §9.2 lists it. `corporate_entity.address` is NOT in the public payload
 * either — 13787 selected a deliberate allow-list and left it out, and PR 2's
 * §6.9 shipped that. A postal address is a different disclosure from a country:
 * it is what somebody needs to send a courier, and also what somebody needs to
 * impersonate the company on headed paper. The country and the coverage the
 * tenant wrote are what the card carries. Recorded as a finding rather than
 * fixed here, because widening a public endpoint's allow-list on the last PR of
 * a programme is not a decision to take quietly.
 */
function EntityCard({
  entity,
  highlighted,
  onHover,
}: {
  entity: PublicEntity;
  highlighted: boolean;
  onHover: () => void;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const name = entity.trading_name || entity.legal_name;
  const summary = pickBilingual(
    {
      fr: String(entity.summary?.fr ?? ""),
      en: entity.summary?.en == null ? null : String(entity.summary.en),
    },
    lang,
  );
  const places = coverageLabels(entity, lang);
  const focus = (entity.focus || [])
    .map((f) =>
      pickBilingual(
        { fr: String(f?.label_fr ?? ""), en: f?.label_en == null ? null : String(f.label_en) },
        lang,
      ),
    )
    .filter(Boolean);
  const cover = mediaUrl(entity.cover_id);
  const avif = mediaSrcSet(entity.cover_id, entity.cover_variants ?? null, "avif");
  const webp = mediaSrcSet(entity.cover_id, entity.cover_variants ?? null, "webp");

  return (
    <article
      className={cn("entity-card", highlighted && "is-active")}
      onMouseEnter={onHover}
    >
      {cover ? (
        <div className="entity-cover">
          <picture>
            {avif ? <source type="image/avif" srcSet={avif} sizes="(min-width: 900px) 30rem, 90vw" /> : null}
            {webp ? <source type="image/webp" srcSet={webp} sizes="(min-width: 900px) 30rem, 90vw" /> : null}
            <img
              src={cover}
              /* The company's own name in a sentence from our dictionary — the
                 same split the portraits use, and the reason there is no
                 alt-text field in the upload control. */
              alt={t("site.about.entityCoverAlt", { name })}
              loading="lazy"
              decoding="async"
              className="entity-cover-img"
            />
          </picture>
        </div>
      ) : null}

      <div className="entity-card-body">
        <h3 className="entity-name">{name}</h3>
        {/* The legal name under the trading name, when they differ. A visitor
            checking a contract counterparty wants the registered one; a visitor
            reading the page wants the one on the door. */}
        {entity.trading_name && entity.trading_name !== entity.legal_name ? (
          <p className="entity-legal">{entity.legal_name}</p>
        ) : null}
        {summary ? <p className="entity-summary">{summary}</p> : null}

        {focus.length ? (
          <>
            <p className="micro mt-4">{t("site.about.entityFocus")}</p>
            <ul className="entity-chips">
              {focus.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </>
        ) : null}

        {places.length ? (
          <>
            <p className="micro mt-4">{t("site.about.entityCoverage")}</p>
            {/* The tenant's own words for the place. A two-letter code
                resolved against a country table would be OUR name for their
                market — the schema carries both languages precisely so it does
                not have to be. */}
            <p className="entity-places">{places.join(" · ")}</p>
          </>
        ) : null}

        {entity.leaders?.length ? (
          <>
            <p className="micro mt-5">{t("site.about.entityPeople")}</p>
            {/* THE SAME RENDERER as the group tier (§6.7, §9.3). One editor,
                one renderer, both tiers — so a country manager and a group
                chief executive cannot end up looking like different kinds of
                person. */}
            <LeaderGrid className="entity-leaders" leaders={entity.leaders} />
          </>
        ) : null}
      </div>
    </article>
  );
}
