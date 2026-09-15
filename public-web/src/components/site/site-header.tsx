import * as React from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getLang, setLang } from "@/lib/i18n";
import { useBranding } from "@/app/branding";
import {
  BrandGlyph,
  ChevronDownIcon,
  CloseIcon,
  MenuIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { p } from "@/lib/base-path";
import { usePointerLight } from "@/lib/motion";
import { useHeaderScroll, useTravellingPill } from "./use-header-scroll";
import { useServicesPanelReady } from "./nav-services-ready";

/**
 * The panel is LAZY, and the readiness rule that decides whether to render it
 * is not.
 *
 * The header must answer "is there a services panel" synchronously — a chevron
 * that appears a beat after the nav is a nav that moves under the pointer. It
 * must not pay for the panel to answer it: importing the panel here statically
 * dragged the icon set, the mode table and the identity helpers into the
 * first-paint bundle of every page and put `check:bundle` 2 kB over. See
 * `nav-services-ready.ts`.
 *
 * `Suspense` falls back to nothing rather than to a skeleton: this is chrome
 * the reader has not asked for yet, and a placeholder panel hanging under the
 * nav for one frame is worse than a panel that opens a beat after the very
 * first hover and instantly on every one after it.
 */
const NavServicesPanel = React.lazy(() => import("./nav-services-panel"));

/**
 * The header: a utility strip, then the brand nav.
 *
 * WHY TWO ROWS. maersk.com puts "Track & trace", "Log in" and the language
 * switcher in a strip ABOVE the brand nav, and that ordering is the whole point:
 * a shipping site has two audiences arriving at one URL — someone who wants to
 * buy a service, and someone who is here about a container already on the water.
 * The strip resolves the second one in a single click without turning the
 * homepage into a login page. The reverse (one nav whose primary button is
 * "Sign in") tells a prospect the site is a tool they have to be issued
 * credentials for.
 *
 * The tenant's own brand drives the mark: their logo if they uploaded one, else
 * their initial in a filled square. The wordmark is the tenant's NAME and never
 * "Praxis" — this is their front door, and `app/branding.tsx` says why painting
 * the vendor's identity on it is the one bug that would make every page wrong at
 * once.
 *
 * STICKY, and deliberately so: the nav is the only route back to tracking from a
 * long page, and on a phone a non-sticky nav means scrolling 3,000px to reach
 * it. `site-header` carries a backdrop blur for that reason — the strip sits
 * over full-bleed imagery, and a plain semi-transparent fill turns the labels
 * into a contrast gamble on whatever photo scrolls under them.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE HEADER AS AN OBJECT — what this file gained, and the one idea behind it
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The bar was a correct piece of chrome and it read as a screenshot: a flat
 * fill, a hairline, and seven links that grew a grey rectangle when pointed at.
 * On a site whose hero is a lit, parallaxed, pointer-tracked plate, the first
 * thing above it was the flattest thing on the page.
 *
 * Everything below is one idea applied four times: **the header is a machined
 * object lying on top of the document, and the reader's scroll and pointer are
 * the two forces acting on it.** Not four effects — four consequences.
 *
 *   1. IT CONDENSES UNDER TRAVEL. `--hdr` (0…1, from `useHeaderScroll`) is the
 *      one number the whole composition is a function of: the strip's height,
 *      the row's padding, the mark's scale, the depth of the blur, the strength
 *      of the lit edge, the shadow it casts. One value, so the parts cannot
 *      drift out of step, and it is DIRECTION-AWARE rather than positional —
 *      scrolling back up restores the bar in full at any depth, because a
 *      reader reversing is a reader looking for something.
 *
 *   2. THE STRIP DOES NOT SLIDE AWAY, IT ERODES. A row that translates out is a
 *      rectangle leaving. This one is masked by a dot grid whose cells close as
 *      `--hdr` rises, so the strip breaks into particles and blows upward —
 *      and, being a scrub, it reassembles under a reversed scroll rather than
 *      replaying. It is a mask and a transform: no canvas, no per-frame
 *      JavaScript, nothing on the LCP path. See `.hdr-erode` in index.css.
 *
 *   3. IT IS LIT, AND THE LIGHT IS THE SITE'S OWN. The 60° top-left source the
 *      corridor scene and the hero already state, as a real specular highlight
 *      along the top edge — brightest at the left, falling off to the right —
 *      plus a wide sheen that tracks the pointer through the SAME `--lx`/`--ly`
 *      contract the hero uses. Two specular layers, not one, moving at
 *      different rates: that lag is what separates "a gradient" from "thick
 *      glass with something under it".
 *
 *   4. ONE PIECE OF INK, WHICH TRAVELS. The nav's hover highlight and its
 *      current-page indicator are the SAME element. It measures the item it is
 *      pointed at and moves the real distance to it, rail trailing a beat
 *      behind, and rests on the current page when the pointer leaves. Seven
 *      backgrounds fading in and out became one object moving — which is the
 *      whole difference between a menu that responds and a menu that is alive.
 *
 * And the bottom hairline is not a hairline: it is the reading position of the
 * page (`--read`), which costs no vertical space because the border was already
 * there.
 *
 * ── WHAT PAYS FOR IT ───────────────────────────────────────────────────────
 *
 * One passive scroll listener and one pointer listener, both shared, both
 * writing custom properties and never React state — `lib/motion.ts` states that
 * doctrine and this obeys it. The frame loop parks itself when the value has
 * arrived, so a header at rest costs nothing. Under `prefers-reduced-motion`
 * `--hdr` is pinned at 0, no ember renders, no sheen attaches, and the bar is
 * simply the composed bar it always was.
 */
/**
 * Every entry is a PATH. The last one used to be `p("#contact")`, and a
 * fragment is exactly what `NavLink` throws away before it decides which item
 * is current — so `/public#contact` matched the home route and the nav marked
 * Contact as the page you were on the moment you arrived. Contact has its own
 * route now (`features/contact/contact-page.tsx`); nothing in this list may go
 * back to being an anchor.
 */
const NAV = [
  /* §9.1: "About into the header nav and the footer — it is absent from both
     today." First in the row, before the services: a visitor deciding whether
     to trust a forwarder reads who they are before what they sell, and the
     utility strip above already carries the two things somebody with cargo in
     transit came for. */
  { to: p("/about"), labelKey: "site.nav.about" },
  { to: p("/services"), labelKey: "site.nav.services", panel: true },
  { to: p("/track"), labelKey: "site.nav.track" },
  { to: p("/portfolio"), labelKey: "site.nav.portfolio" },
  { to: p("/insights"), labelKey: "site.nav.insights" },
  { to: p("/careers"), labelKey: "site.nav.careers" },
  { to: p("/contact"), labelKey: "site.nav.contact" },
] as const;

/**
 * How many particles the strip erodes into.
 *
 * They are DOM elements rather than a canvas because eighteen absolutely
 * positioned spans transformed by one inherited custom property are eighteen
 * composited layers the browser already knows how to move, and a canvas on the
 * critical path is a script, a context, and a frame loop for an effect that
 * lasts 200ms. Eighteen is where the row reads as breaking apart rather than as
 * a countable set of dots leaving.
 */
const EMBERS = 18;
const EMBER_INDICES = Array.from({ length: EMBERS }, (_, i) => i);

/** How long a pointer must rest on Services before its panel opens. An instant
 *  panel fires on the way past to Track and puts a wall of links in front of
 *  somebody who was aiming at something else. */
const PANEL_OPEN_MS = 110;

/** And how long it survives the pointer leaving, so crossing the gap between
 *  the nav item and the panel it opened does not close it. */
const PANEL_CLOSE_MS = 220;

export function SiteHeader() {
  const { t } = useTranslation();
  const { branding } = useBranding();
  const [open, setOpen] = React.useState(false);
  const location = useLocation();
  const lang = getLang();

  /* `--hdr` and `--read`, on the element every part of the header inherits
     from. Also the element the ResizeObserver below measures — one ref, because
     both want the same node. */
  const hostRef = useHeaderScroll<HTMLElement>();
  /* `--lx`/`--ly` for the sheen. Scoped to the bar rather than the whole header
     so the strip's erosion is not also chasing the pointer — one surface
     catches the light, and it is the one that is still there. */
  const barRef = usePointerLight<HTMLDivElement>({ idleMs: 2600 });

  const { navRef, aim, settle } = useTravellingPill<HTMLElement>();

  /* ── the Services panel ───────────────────────────────────────────────── */
  const panelReady = useServicesPanelReady();
  const [panelOpen, setPanelOpen] = React.useState(false);
  const panelTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const chevronRef = React.useRef<HTMLButtonElement>(null);

  const clearPanelTimer = () => {
    if (panelTimer.current) clearTimeout(panelTimer.current);
    panelTimer.current = undefined;
  };
  const schedulePanel = (next: boolean, delay: number) => {
    clearPanelTimer();
    panelTimer.current = setTimeout(() => setPanelOpen(next), delay);
  };
  React.useEffect(() => clearPanelTimer, []);

  // A menu still open after a navigation is a menu hiding the page that was
  // just asked for.
  React.useEffect(() => {
    setOpen(false);
    setPanelOpen(false);
    clearPanelTimer();
  }, [location.pathname]);

  /* The pill belongs to the page, so it re-measures when the page changes —
     and when the LANGUAGE changes, which is the case the first version missed:
     "Our work" and "Nos réalisations" are not the same width, and a pill left
     at the English measurement sits visibly off its item until the next hover.
     `settle` re-places it without animating, so neither reads as a transition
     nobody asked for. */
  React.useEffect(() => {
    settle();
  }, [location.pathname, lang, settle]);

  React.useEffect(() => {
    if (!open && !panelOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      if (panelOpen) {
        setPanelOpen(false);
        // Escape on a disclosure returns focus to the thing that opened it.
        // Without this, focus is left on a link inside a panel that is no
        // longer visible, and the next Tab comes from nowhere.
        chevronRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, panelOpen]);

  const name = branding.name || "Praxis";

  /**
   * Publish the header's real height as `--site-header-h`.
   *
   * Everything that has to clear this bar — the sticky asides, the anchor
   * scroll-margins — used to hardcode 6rem, which is shorter than the header
   * actually is, so pinned headings were sliced in half and anchor jumps landed
   * behind the nav. Measuring is the only version of this that stays right: the
   * row grows when the nav wraps at a narrow width, when a tenant uploads a
   * taller logo, and when the language switcher gains a third language.
   *
   * `ResizeObserver` rather than a resize listener, because none of those three
   * changes is a window resize. Guarded for older browsers, where the CSS
   * fallback stands.
   *
   * ── AND NOW THE BAR CONDENSES, WHICH MAKES THIS A HOT PATH ───────────────
   *
   * The height is no longer constant: it travels ~48px every time the reader
   * crosses the threshold. Publishing the LIVE height is the correct answer —
   * an anchor jump happens while scrolled, where the bar is condensed, and a
   * sticky aside offset from the resting height would sit 48px too low for the
   * entire length of the page. But it means this observer now fires through the
   * whole dissolve.
   *
   * So the write is coalesced into a frame and skipped when the rounded value
   * has not moved. At rest — which is nearly all of the time — that is zero
   * style writes; through a dissolve it is one per frame for about a fifth of a
   * second, each one a single custom property on the root.
   */
  React.useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let raf = 0;
    let last = -1;
    const publish = () => {
      raf = 0;
      const h = Math.round(el.getBoundingClientRect().height);
      if (h === last) return;
      last = h;
      document.documentElement.style.setProperty("--site-header-h", `${h}px`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(publish);
    };
    publish();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [hostRef]);

  return (
    <header ref={hostRef} className="site-shell sticky top-0 z-40">
      {/* ── the utility strip, which erodes ───────────────────────────────
          `.hdr-erode` collapses its height and dissolves its content through a
          dot mask as `--hdr` rises. It keeps `overflow: clip` so the embers
          leaving it do not paint over the bar below. */}
      <div className="site-utility hdr-erode">
        <div className="wrap flex h-10 items-center justify-between gap-4 text-xs">
          <Link
            to={p("/track")}
            className="font-medium text-[var(--hero-foreground)] transition-opacity hover:opacity-80"
          >
            {t("site.hero.cta2")}
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/portal/login"
              className="font-medium text-[var(--hero-foreground)] transition-opacity hover:opacity-80"
            >
              {t("site.chrome.portalEntry")}
            </Link>
            <span aria-hidden className="opacity-40">
              |
            </span>
            <LangToggle onDark />
          </div>
        </div>

        {/* The particles the strip breaks into. Decorative in the strictest
            sense — no text, no link, nothing to announce — so the whole layer
            is hidden from the accessibility tree, and it renders nothing at all
            under reduced motion (a `display: none` in the umbrella block, so
            there is no per-particle rule to keep in step). */}
        <span aria-hidden className="hdr-embers">
          {EMBER_INDICES.map((i) => (
            <span
              key={i}
              className="hdr-ember"
              style={{ "--i": i } as React.CSSProperties}
            />
          ))}
        </span>
      </div>

      <div ref={barRef} className="site-header">
        {/* The lit top edge — the site's own 60° source, brightest at the left
            and falling off across the bar. It strengthens with `--hdr`: a bar
            resting against the top of the document is not casting an edge, and
            one lifted off a scrolling page is. */}
        <span aria-hidden className="hdr-lit" />
        {/* The specular sheen, at the pointer. Under the content and over the
            fill, so it can never spend the contrast the labels need. */}
        <span aria-hidden className="hdr-sheen" />

        <div className="wrap flex items-center justify-between gap-4 hdr-row">
          <Link
            to={p()}
            className="hdr-mark flex min-w-0 items-center gap-2.5"
            aria-label={name}
          >
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={name}
                className="h-9 w-auto max-w-[180px] object-contain object-left"
              />
            ) : (
              <>
                <BrandGlyph name={name} size={34} />
                <span className="truncate font-display text-lg font-semibold tracking-tight text-foreground">
                  {name}
                </span>
              </>
            )}
          </Link>

          <nav
            ref={navRef as React.RefObject<HTMLElement>}
            aria-label="Main"
            className="navrow hidden items-center gap-1 lg:flex"
            /* Pointer leaving the row hands the ink back to the current page.
               Focus does the same on `onBlur`, which React fires as the
               bubbling focusout — so tabbing out of the nav settles it too. */
            onPointerLeave={() => aim(null)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                aim(null);
              }
            }}
          >
            {/* ONE highlight and ONE rail, for the whole row. They are siblings
                of the links rather than backgrounds on them, which is what lets
                them travel between items instead of cross-fading. Both are
                positioned from `--px`/`--pw`, written by `useTravellingPill`
                after it measures the item — see there for why measuring is the
                only version that survives French. */}
            <span aria-hidden className="navpill" />
            <span aria-hidden className="navrail" />

            {NAV.map((item) => {
              const hasPanel = "panel" in item && item.panel && panelReady;
              return (
                <span key={item.to} className="navitem">
                  <NavLink
                    to={item.to}
                    className="navlink"
                    onPointerEnter={(e) => {
                      aim(e.currentTarget);
                      // Pointing at anything that is not Services closes the
                      // panel — otherwise it hangs over the row while the
                      // reader is plainly headed somewhere else.
                      schedulePanel(!!hasPanel, hasPanel ? PANEL_OPEN_MS : 0);
                    }}
                    onFocus={(e) => aim(e.currentTarget)}
                  >
                    {t(item.labelKey)}
                  </NavLink>
                  {hasPanel ? (
                    <button
                      ref={chevronRef}
                      type="button"
                      className="navchevron"
                      aria-expanded={panelOpen}
                      aria-controls="nav-services-panel"
                      onClick={() => {
                        clearPanelTimer();
                        setPanelOpen((v) => !v);
                      }}
                      onPointerEnter={() => schedulePanel(true, PANEL_OPEN_MS)}
                    >
                      <ChevronDownIcon size={14} aria-hidden />
                      <span className="sr-only">
                        {t("site.nav.servicesToggle")}
                      </span>
                    </button>
                  ) : null}
                </span>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to={p("/quote")}
              className="btn-primary hdr-cta hidden h-11 items-center rounded-[calc(var(--radius)-2px)] px-5 text-[0.9375rem] font-semibold md:inline-flex"
            >
              {t("site.hero.cta")}
            </Link>
            <button
              type="button"
              className="btn-surface grid h-11 w-11 place-items-center rounded-[calc(var(--radius)-2px)] lg:hidden"
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
              <span className="sr-only">
                {open ? t("site.chrome.closeMenu") : t("site.chrome.menu")}
              </span>
            </button>
          </div>
        </div>

        {/* Rendered whether or not it is open — it animates closed as well as
            open, and there is nothing to animate about an unmounted element.
            Only when the tenant has services to put in it. */}
        {panelReady ? (
          <div
            className="nav-panel-host hidden lg:block"
            onPointerEnter={clearPanelTimer}
            onPointerLeave={() => schedulePanel(false, PANEL_CLOSE_MS)}
          >
            <React.Suspense fallback={null}>
              <NavServicesPanel
                id="nav-services-panel"
                open={panelOpen}
                onClose={() => schedulePanel(false, PANEL_CLOSE_MS)}
              />
            </React.Suspense>
          </div>
        ) : null}

        {/* THE BOTTOM BORDER IS THE PROGRESS RAIL. Not an added element and not
            added height — the hairline was always there, and it now says how
            much of the page is behind the reader. Driven by `--read`, which is
            written even under reduced motion: this is information, and a reader
            who dislikes animation still deserves an answer to "how much more of
            this is there". */}
        <span aria-hidden className="hdr-rail" />

        {open ? (
          <nav
            id="site-menu"
            aria-label="Mobile"
            className="site-drawer border-t bg-background lg:hidden"
          >
            <ul className="wrap py-1">
              {NAV.map((item, i) => (
                <li
                  key={item.to}
                  className="drawer-row"
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <Link to={item.to} className="block border-b py-3 font-medium">
                    {t(item.labelKey)}
                  </Link>
                </li>
              ))}
              <li
                className="drawer-row flex items-center justify-between gap-3 border-b py-3"
                style={{ "--i": NAV.length } as React.CSSProperties}
              >
                <Link
                  to="/portal/login"
                  className="font-medium text-primary-ink"
                >
                  {t("site.chrome.portalEntry")}
                </Link>
                <LangToggle />
              </li>
              <li
                className="drawer-row py-3"
                style={{ "--i": NAV.length + 1 } as React.CSSProperties}
              >
                <Link
                  to={p("/quote")}
                  className="btn-primary flex h-11 items-center justify-center rounded-[calc(var(--radius)-2px)] font-semibold"
                >
                  {t("site.hero.cta")}
                </Link>
              </li>
            </ul>
          </nav>
        ) : null}
      </div>
    </header>
  );
}

/**
 * EN / FR — two buttons, not a `<select>`. The choice is binary; a select costs a
 * second click and renders as a native control that cannot be made to look the
 * same across the Android/iOS/webkit spread this market is actually on.
 *
 * Each button announces WHICH LANGUAGE it switches to (not just "FR"), because
 * `aria-pressed` on a two-letter label tells a screen-reader user nothing about
 * what pressing it does.
 */
export function LangToggle({ onDark = false }: { onDark?: boolean }) {
  const { t } = useTranslation();
  const lang = getLang();
  return (
    <span
      role="group"
      aria-label={t("site.chrome.language")}
      className="inline-flex items-center gap-0.5"
    >
      {(["en", "fr"] as const).map((code) => {
        const active = lang === code;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            aria-current={active ? "true" : undefined}
            onClick={() => setLang(code)}
            aria-label={
              code === "fr"
                ? t("site.chrome.toFrench")
                : t("site.chrome.toEnglish")
            }
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase transition-colors",
              onDark
                ? active
                  ? "bg-[rgb(237_238_238/0.2)] text-[var(--hero-foreground)]"
                  : "text-[var(--hero-muted)] hover:text-[var(--hero-foreground)]"
                : active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            {code}
          </button>
        );
      })}
    </span>
  );
}
