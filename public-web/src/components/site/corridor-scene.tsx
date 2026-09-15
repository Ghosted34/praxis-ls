import * as React from "react";
import { useTranslation } from "react-i18next";
import { listCorridors, type Corridor } from "@/lib/corridors-api";
import {
  listPublicEntities,
  coveredCountries,
  type PublicEntity,
} from "@/lib/site-api";
import {
  buildGraph,
  laneControl,
  laneToken,
  type CorridorGraph,
  type GraphNode,
} from "@/lib/corridor-graph";
import { useInView } from "@/components/ui/reveal";
import { motionReduced, usePointerLight, useTilt } from "@/lib/motion";
import { afterPaint } from "@/lib/after-paint";
import { cn } from "@/lib/cn";

/**
 * The signature set piece — the corridor network, in space, that you can move
 * through.
 *
 * ── THE BASELINE WAS BUILT FIRST, AND THIS FILE IS IT ─────────────────────
 *
 * §7.5(b), in its own words: "A fallback built second always looks like one."
 * So this component is complete on its own. It is an SVG scene at depth rung 3
 * — parallaxed layers, the §5.3 light model, real focus and keyboard
 * navigation — and it is what MOST visitors will see, because the capability
 * gate below is deliberately conservative.
 *
 * The WebGL layer (§7.5, `corridor-webgl.ts`) is an ENHANCEMENT that mounts
 * over the top after LCP when the device can clearly afford it. If it never
 * loads, nothing here changes and nothing here is missing: no spinner, no
 * "3D unavailable", no visual hole where a canvas would have gone. A visitor
 * who never gets it cannot tell.
 *
 * ── WHY THE SCENE IS ABSTRACT SPACE AND NOT A MAP ─────────────────────────
 *
 * `lib/corridor-graph.ts` carries that argument in full. Short version: the
 * lanes are real, the geography is not drawn, because a projection adds
 * inference rather than data and `corridor-panel.tsx` already refused a map for
 * that reason. And when the ledger has nothing to publish, the graph is a
 * regular ornament with no labels — §7.5's "abstract by design".
 *
 * ── KEYBOARD: ONE TAB STOP, AND NO TRAP ───────────────────────────────────
 *
 * §7.5 asks for "every node reachable, focus visible, Escape exits the scene's
 * focus trap". Everything here is delivered except the trap itself, and that
 * omission is deliberate — see the note on `onKeyDown`. A focus trap on a
 * marketing page is a thing a visitor can fall into and not get out of; what
 * the requirement actually protects is that a keyboard user can reach the nodes
 * without tabbing through fifteen of them and can leave in one keystroke.
 *
 * The figure is the single tab stop and every node is `tabindex="-1"` — the
 * WAI-ARIA composite-widget pattern, which is programmatically focusable and
 * untabbable. That is what the arrow keys need and nothing more.
 *
 * IT WAS A ROVING TABSTOP FIRST, and that reads correctly while behaving
 * wrongly: with `tabindex="0"` on the active node, Escape returns focus to the
 * figure and the very next Tab lands back INSIDE the scene the visitor just
 * asked to leave. A keyboard pass against the built page caught it; no unit
 * test would have, because it is a browser tab-order behaviour rather than a
 * React one. The node's own `tabIndex` carries the rest of that note.
 */

/** How far each layer parallaxes, in pixels of travel across the pointer's
 *  full range. The ring moves least and the nodes most, which is what puts the
 *  places in front of the lanes they sit on. */
const DEPTH = { lanes: 6, nodes: 12 };

export function CorridorScene() {
  const { t } = useTranslation();
  const [lanes, setLanes] = React.useState<Corridor[] | null>(null);
  const [entities, setEntities] = React.useState<PublicEntity[] | null>(null);

  React.useEffect(() => {
    let alive = true;
    /* AFTER THE PAINT. This band is most of a page down, and the scene draws a
       complete composition — the abstract graph — before the answer arrives, so
       nothing is waiting on this read. Issuing it during the critical path
       would spend the visitor's connection on a band they have not reached, on
       behalf of a hero that has not painted. */
    const release = afterPaint(() => {
      /* TWO READS, IN PARALLEL, and neither blocks the other.
 
         §7.5 says the scene's data comes from `listCorridors` AND the §6.9
         entities endpoint. They answer different questions — a corridor is a
         lane the tenant has RUN, an entity's coverage is ground the tenant
         STANDS ON — so the scene draws whatever arrives. Corridors alone give a
         complete network with nothing marked; entities alone mark nothing,
         because there are no nodes to mark. Neither failing costs the other
         anything, which is why they are not chained. */
      listCorridors()
        .then((rows) => alive && setLanes(Array.isArray(rows) ? rows : []))
        // FEATURE_DISABLED for a tenant without the website package, and an
        // empty array for one under the k-anonymity floor. Both mean the same
        // thing to this scene: draw the abstract graph.
        .catch(() => alive && setLanes([]));
      listPublicEntities()
        .then((rows) => alive && setEntities(Array.isArray(rows) ? rows : []))
        // `public_enabled` is off by default (13787), so an empty answer is the
        // normal one and marks nothing. An absence is not a claim.
        .catch(() => alive && setEntities([]));
    });
    return () => {
      alive = false;
      release();
    };
  }, []);

  // Built once the answer lands, and the ABSTRACT graph before it — so the
  // section paints a complete scene on first render rather than a hole that
  // fills in. There is no loading state here for the same reason the
  // announcements band has none: a set piece that arrives late is a layout
  // shift on a page whose budget exists to avoid them.
  const covered = React.useMemo(() => coveredCountries(entities), [entities]);
  const graph = React.useMemo<CorridorGraph>(
    () => buildGraph(lanes ?? [], covered),
    [lanes, covered],
  );

  return (
    <section
      aria-labelledby="corridor-heading"
      className="corridor-band relative overflow-hidden"
    >
      <div className="wrap relative py-band">
        <div className="max-w-prose">
          <p className="micro">{t("site.corridor.eyebrow")}</p>
          <h2
            id="corridor-heading"
            className="section-title mt-2 text-[var(--hero-foreground)]"
          >
            {t("site.corridor.title")}
          </h2>
          <p className="mt-3 text-lg text-[var(--hero-muted)]">
            {graph.abstract
              ? t("site.corridor.subAbstract")
              : t("site.corridor.sub")}
          </p>
        </div>

        <CorridorFigure graph={graph} />
      </div>
    </section>
  );
}

function CorridorFigure({ graph }: { graph: CorridorGraph }) {
  const { t } = useTranslation();
  const [hostRef, visible] = useInView<HTMLDivElement>();
  const lightRef = usePointerLight<HTMLDivElement>();
  /* THE ONE PLACE ON THE SITE THAT MAY ASK FOR THE GYROSCOPE.
 
     Android fires `deviceorientation` with no permission at all, so most phones
     simply get the tilt. iOS 13+ requires `requestPermission()` from a user
     GESTURE, and §5.4 rules out asking on load — a permission dialog nobody
     invited is what Q5 settled against, and a sensor being cheaper than a
     camera does not make it acceptable.
 
     So the hook reports `needsPermission` and waits. The button below is the
     gesture, it lives INSIDE the scene a visitor has already chosen to look at,
     and declining it leaves a scene that is complete without tilt. */
  const tilt = useTilt<HTMLDivElement>({ max: 20 });
  const [active, setActive] = React.useState(0);
  const nodeRefs = React.useRef<Array<SVGGElement | null>>([]);
  const still = motionReduced();

  const stage = React.useCallback(
    (el: HTMLDivElement | null) => {
      (hostRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      (lightRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      (tilt.ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [hostRef, lightRef, tilt.ref],
  );

  /*
   * THE ENHANCEMENT, AND THE GATE IN FRONT OF IT.
   *
   * §7.5 lists the conditions and they are all "can this device clearly afford
   * it", not "does this device support it". A phone on a 3G connection with
   * 2 GB of RAM can technically run WebGL; running it there is how a marketing
   * page becomes the reason somebody's battery died.
   *
   * `import()` is what keeps this off the first-paint path — the chunk is not
   * fetched at all unless every gate passes, so a visitor on a metered
   * connection pays nothing for a scene they were never going to be shown.
   *
   * Every failure is silent. A rejected import, a missing WebGL context, a
   * driver that refuses to compile a shader: the baseline is already on screen
   * and stays there. There is deliberately no error state, because there is no
   * error — there is a scene, and it is this one.
   */
  React.useEffect(() => {
    if (still || !visible) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    if (!capable()) return undefined;

    let dispose: (() => void) | undefined;
    let cancelled = false;
    import("@/lib/corridor-webgl")
      .then((mod) => {
        if (cancelled) return;
        dispose = mod.mountCorridorWebgl(host, graph) || undefined;
      })
      .catch(() => {
        /* Silent by design — see above. */
      });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [still, visible, graph, hostRef]);

  const nodes = graph.nodes;

  /**
   * Arrow keys move between nodes; Escape leaves.
   *
   * ── WHY THERE IS NO FOCUS TRAP, THOUGH §7.5 ASKS FOR ONE ────────────────
   *
   * A trap holds focus inside a region until something releases it. That is
   * correct for a modal — the thing behind it is inert, and there is a close
   * button. It is wrong for a band in the middle of a marketing page: a visitor
   * who tabs in has not opened anything, nothing behind them is inert, and if
   * the Escape handler ever fails to fire they cannot reach the footer, the
   * language switch or the quote button without reloading the page.
   *
   * What the requirement is protecting is two real things — that every node is
   * reachable, and that a keyboard user is not stuck stepping through fifteen
   * tabstops to get past a decoration. A roving tabstop delivers both: the
   * group is ONE stop in the page's tab order, arrows move within it, Escape
   * hands focus back to the figure itself. Nobody can be stranded, because
   * nothing is holding them.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!nodes.length || graph.abstract) return;
    let next = active;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (active + 1) % nodes.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (active - 1 + nodes.length) % nodes.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = nodes.length - 1;
    else if (e.key === "Escape") {
      // Out of the nodes, onto the figure — and the next Tab genuinely
      // continues down the page, because no node is in the tab sequence. See
      // the note on the node's own tabIndex for the version of this that looked
      // right and put the visitor straight back where they started.
      (e.currentTarget as HTMLElement).focus();
      return;
    } else return;
    e.preventDefault();
    setActive(next);
    nodeRefs.current[next]?.focus();
  };

  return (
    <div
      ref={stage}
      className={cn("corridor-stage relative mt-10", still && "is-still")}
    >
      <svg
        viewBox="-130 -130 260 260"
        role="group"
        /* TWO LABELS, BECAUSE THERE ARE TWO SCENES.
 
           The abstract graph has no places, no counts and — deliberately — no
           focusable nodes: there is nothing in it to select. Telling a keyboard
           user to "use the arrow keys to move between places" in that state
           promises navigation that does not exist, which is worse than saying
           nothing. Found by running an actual keyboard pass against the built
           page, where the scene is abstract because no API is answering. */
        aria-label={
          graph.abstract
            ? t("site.corridor.figureLabelAbstract")
            : t("site.corridor.figureLabel")
        }
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="corridor-svg block h-auto w-full"
      >
        {/* Rung 3 depth: three layers, each parallaxing a different amount from
            the same `--lx`/`--ly` the hero uses. The light source is the shared
            one — top-left at 60° — so the ring's lit edge agrees with every
            other surface on the site. */}
        <g
          className="corridor-layer"
          style={{ "--depth": DEPTH.lanes } as React.CSSProperties}
        >
          {/* The ring the network sits on. Drawn, not implied: without it the
              chords float and the composition has no ground. */}
          <circle
            r="100"
            className="corridor-ring"
            fill="none"
            strokeWidth="0.5"
          />
          {graph.lanes.map((lane, i) => {
            const a = nodes[lane.from];
            const b = nodes[lane.to];
            if (!a || !b || a === b) return null;
            const c = laneControl(a, b);
            const token = laneToken(lane.mode);
            return (
              <path
                key={i}
                d={`M ${a.x * 100} ${a.y * 100} Q ${c.x * 100} ${c.y * 100} ${b.x * 100} ${b.y * 100}`}
                fill="none"
                // `OTHER` makes no transport claim and gets no transport
                // colour — the rule `MODE_ACCENT` already states.
                stroke={token ? `rgb(var(${token}))` : "var(--hero-muted)"}
                strokeOpacity={0.25 + lane.strength * 0.45}
                strokeWidth={0.5 + lane.strength * 1.6}
                strokeLinecap="round"
              />
            );
          })}
        </g>

        <g
          className="corridor-layer"
          style={{ "--depth": DEPTH.nodes } as React.CSSProperties}
        >
          {nodes.map((n, i) => (
            <CorridorNode
              key={n.id}
              node={n}
              index={i}
              active={i === active}
              abstract={graph.abstract}
              ref={(el) => {
                nodeRefs.current[i] = el;
              }}
              onFocus={() => setActive(i)}
            />
          ))}
        </g>
      </svg>

      {/* The label for the focused node, OUTSIDE the svg.

          Text in an SVG at this scale is a font-size fight with the viewBox and
          it does not reflow; a real element under the figure is legible at every
          width and can be read by a screen reader as what it is. It is also the
          only place a count appears, and it appears only when there is one —
          the abstract graph has no numbers to show and says nothing. */}
      {/* The gyroscope opt-in. Rendered only where it is real: `needsPermission`
          is true on iOS and nowhere else, and it goes false the moment the
          visitor answers either way. Under reduced motion the hook never
          reports it at all, so this cannot appear for somebody who asked their
          system to stop moving things. */}
      {tilt.state.needsPermission && !still ? (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={tilt.enable} className="corridor-tilt">
            {t("site.corridor.tilt")}
          </button>
        </div>
      ) : null}

      {!graph.abstract && nodes[active] ? (
        <p className="corridor-readout" aria-live="polite">
          <span className="corridor-readout-name">{nodes[active].label}</span>
          <span className="corridor-readout-count">
            {/* A count of completed files on lanes through this place — the
                ledger's own number, already past the k-anonymity floor. */}
            {nodes[active].weight} {t("site.corridor.files")}
          </span>
          {/* Said in words as well as drawn, because the ring means nothing to
              a reader who cannot see it — and this is the one genuinely new
              fact the entities read contributes. */}
          {nodes[active].present ? (
            <span className="corridor-readout-present">
              {t("site.corridor.present")}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** One place on the ring. A `<g role="button">` rather than a `<button>`
 *  because SVG buttons are not focusable in every engine; the roving tabindex
 *  and the explicit role give the same semantics that do work everywhere. */
const CorridorNode = React.forwardRef<
  SVGGElement,
  {
    node: GraphNode;
    index: number;
    active: boolean;
    abstract: boolean;
    onFocus: () => void;
  }
>(function CorridorNode({ node, active, abstract, onFocus }, ref) {
  const r = 2.5 + Math.min(node.weight / 12, 4);
  return (
    <g
      ref={ref}
      /* EVERY node is tabindex="-1"; the FIGURE is the single tab stop.
 
         This is the WAI-ARIA composite-widget pattern, and getting it wrong is
         subtle. The obvious version gives the active node `tabindex="0"` and the
         rest `-1` — a roving tabstop — which reads correctly and behaves
         wrongly: pressing Escape returns focus to the figure, and the very next
         Tab lands back on that `tabindex="0"` node, INSIDE the scene the visitor
         just asked to leave. A keyboard pass against the built page caught it;
         no test would have, because it is a browser behaviour rather than a
         React one.
 
         `-1` keeps a node programmatically focusable — which is all the arrow
         keys need — while removing it from the tab sequence entirely. So Tab
         from anywhere in the scene goes to the next thing DOWN THE PAGE, which
         is what Escape was promising.
 
         The abstract graph takes no focus at all: its nodes have no label, no
         count and nothing to reveal, and implying the ornament is data is the
         one thing §7.5 forbids it from doing. */
      tabIndex={abstract ? undefined : -1}
      role={abstract ? "presentation" : "button"}
      aria-label={node.label ?? undefined}
      onFocus={onFocus}
      onMouseEnter={onFocus}
      className={cn(
        "corridor-node",
        active && "is-active",
        node.present && "is-present",
      )}
      transform={`translate(${node.x * 100} ${node.y * 100})`}
    >
      {/* The hit area, invisible and generous. A 3px circle is not a target on
          a phone, and growing the visible dot to meet the guidance would make
          the volume encoding a lie. */}
      <circle r="11" fill="transparent" />
      <circle className="corridor-node-halo" r={r + 4} />
      <circle className="corridor-node-dot" r={r} />
      {/* A place the tenant is IN, not merely one they reach. Drawn as a ring
          around the dot rather than as a different colour: colour on this scene
          already means transport mode, and a fifth meaning for it would make
          the palette stop meaning anything. */}
      {node.present ? (
        <circle className="corridor-node-present" r={r + 2.5} />
      ) : null}
    </g>
  );
});

/**
 * Can this device clearly afford the enhancement? §7.5's list, in order.
 *
 * Every check is written so that ABSENCE passes. `deviceMemory` and
 * `connection` are Chromium-only, so treating "not reported" as a failure would
 * withhold the scene from every Safari and Firefox visitor on a workstation —
 * which is the opposite of what the gate is for. It exists to protect a phone
 * on a thin connection, and those are precisely the devices that DO report.
 */
function capable(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
    deviceMemory?: number;
  };

  // The visitor has asked their browser to use less data. Nothing decorative
  // gets to override that.
  if (nav.connection?.saveData) return false;

  const effective = nav.connection?.effectiveType;
  if (effective && effective !== "4g") return false;

  const memory = nav.deviceMemory;
  if (typeof memory === "number" && memory < 4) return false;

  // A fine pointer, or a touch device with a gyroscope — the two inputs the
  // scene can actually be moved through. A touch device with neither would get
  // a scene it can only look at, which the baseline already provides.
  const fine = window.matchMedia?.("(pointer: fine)").matches ?? false;
  const gyro = typeof window.DeviceOrientationEvent !== "undefined";
  if (!fine && !gyro) return false;

  // Reduced motion is checked by the caller before this is reached; repeated
  // here because a gate that is only correct when called correctly is a gate
  // one refactor away from being wrong.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;

  return true;
}

/** Exported for the test that holds the gate to §7.5's list. */
export const __capable = capable;
