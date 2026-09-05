import * as React from "react";
import {
  Navigate,
  Route,
  Routes,
  useParams,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import { NotFoundPage } from "@/features/not-found/not-found-page";
import { Skeleton } from "@/components/ui/skeleton";
import { p, BASE_IS_DEFAULT, IS_ROOT, LEGACY_BASE } from "@/lib/base-path";

/**
 * The route table for the stranger-facing app.
 *
 * ── TWO PREFIXES, AND WHY THEY ARE THERE ───────────────────────────────────
 *
 * `/public/*` is the marketing site and everything a visitor reads without an
 * account; `/portal/*` is the external portal a client, investor or auditor signs
 * into. Both prefixes are deliberate, not inherited: this app is served from the
 * SAME origin as the tenant ERP (`src/server.js` mounts it beside `client/dist`),
 * so the prefix is what keeps `/track` — an ERP screen — from being quietly
 * reinterpreted as this app's `/track`. The one exception is the redirect table
 * below, which exists precisely so the old ERP links keep working.
 *
 * ── WHY EVERYTHING BUT THE BOUNDARY IS `React.lazy` ────────────────────────
 *
 * The heaviest screens here are also the least-visited from any given entry
 * point: a tracking visitor never downloads the portal's terminal tables, a
 * portal user never downloads the careers form or the PDF-bearing proposal
 * document. One shared entry chunk would make every one of them pay for all of
 * them — and the audience this app serves is a phone on a metered connection in
 * Douala, which is the reason `package.json` exists separately from `client/` at
 * all. The boundary is loaded eagerly because a page that cannot render without
 * a second request would flash.
 *
 * ── `/` REDIRECTS AND NOTHING ELSE DOES ────────────────────────────────────
 *
 * Rule inherited from the ERP's own landing behaviour: the bare root may redirect
 * (there is no other sensible thing to put there), a deep link never does. A
 * forwarded `/public/proposals/xyz?lang=FR` must land on exactly that page in
 * that language, or the shared link the sales team sent is wrong.
 *
 * ── AND ON A HOST THE SITE OWNS, `/` DOES NOT REDIRECT EITHER ──────────────
 *
 * `IS_ROOT` is true on a domain the client brought, where this app is the only
 * thing served and `p()` is `/`. Two things then have to change, and both are
 * about the same trap — a redirect whose source and target have become the same
 * string:
 *
 *   · `/` would redirect to `/`, which is a loop the browser reports as
 *     "too many redirects" and no stack trace explains.
 *   · the legacy block below would do it again per path: `/track` redirecting to
 *     `p("/track")`, which at the root IS `/track`.
 *
 * So both are skipped at the root, where those paths are not legacy aliases —
 * they are the canonical URLs. `/tracking`, `/proposal/:token` (singular) and
 * `/client-portal/*` still redirect there, because those spellings are wrong on
 * every host.
 */

const lazy = (
  factory: () => Promise<{ [k: string]: React.ComponentType }>,
  name: string,
) => React.lazy(() => factory().then((m) => ({ default: m[name] })));

const Marketing = lazy(
  () => import("@/features/marketing/marketing-page"),
  "MarketingPage",
);
const Track = lazy(() => import("@/features/tracking/track-page"), "TrackPage");
const ServicesIndex = lazy(
  () => import("@/features/services/services-page"),
  "ServicesIndexPage",
);
const ServiceDetail = lazy(
  () => import("@/features/services/services-page"),
  "ServiceDetailPage",
);
const PortfolioIndex = lazy(
  () => import("@/features/portfolio/portfolio-page"),
  "PortfolioIndexPage",
);
const PortfolioStory = lazy(
  () => import("@/features/portfolio/portfolio-page"),
  "PortfolioStoryPage",
);
const Quote = lazy(
  () => import("@/features/quote/quote-page"),
  "QuotePage",
);
const Insights = lazy(
  () => import("@/features/insights/insights-page"),
  "InsightsPage",
);
const Insight = lazy(
  () => import("@/features/insights/insight-page"),
  "InsightPage",
);
const Proposal = lazy(
  () => import("@/features/proposals/proposal-page"),
  "ProposalPage",
);
const Careers = lazy(
  () => import("@/features/careers/careers-page"),
  "CareersPage",
);
const Contact = lazy(
  () => import("@/features/contact/contact-page"),
  "ContactPage",
);
const Vacancy = lazy(
  () => import("@/features/careers/careers-page"),
  "VacancyPage",
);
const PortalApp = lazy(
  () => import("@/features/portal/portal-app"),
  "PortalApp",
);

/* ── legacy paths the ERP already sent people to ─────────────────────────── */

/** `/track?ref=X` → `/public/track?ref=X`: the query string is the payload of a
 *  tracking link, so a redirect that drops it redirects to an empty form. */
function LegacyQuery({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

/** Join a redirect target with its tail without emitting `//track`.
 *
 *  `to` is `"/"` on a host serving the site at its root, and `"/" + "/" + tail`
 *  is a protocol-relative URL — a browser reads `//track` as the host `track`,
 *  so the redirect leaves the site entirely. */
function under(to: string, tail: string): string {
  if (!tail) return to;
  return to === "/" ? `/${tail}` : `${to}/${tail}`;
}

/** `/portfolio/:slug` → `/public/portfolio/:slug`. The slug is re-encoded rather
 *  than pasted back raw, because a French slug contains spaces and accents and
 *  some of these links were typed by hand into an email months ago. */
function LegacyParam({ to }: { to: string }) {
  const params = useParams();
  const rest = Object.values(params)
    .filter((v): v is string => !!v)
    .map(encodeURIComponent)
    .join("/");
  return <Navigate to={under(to, rest)} replace />;
}

/** `/client-portal/anything/deeper?x=1` → `/portal/anything/deeper?x=1`.
 *  The staff app used to host the portal under this path; every invitation email
 *  ever sent points at it. */
function LegacySplat({ to }: { to: string }) {
  const { search, hash } = useLocation();
  const { "*": splat = "" } = useParams();
  const tail = splat
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return <Navigate to={`${under(to, tail)}${search}${hash}`} replace />;
}

/** The chunk-loading frame. Not the full `PageShell`: mounting the header during
 *  a 60 ms fetch would paint the nav, then paint it again with the page, and on a
 *  slow connection that is a visible jump. */
function RouteFallback() {
  return (
    <div className="min-h-screen bg-background">
      <div className="wrap py-16">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
        <div className="mt-10 grid gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}

/**
 * A new page starts at the top of itself.
 *
 * ── THE BUG ────────────────────────────────────────────────────────────────
 *
 * The browser resets scroll on a real navigation. A single-page app performs no
 * navigation — it swaps a subtree and leaves the window exactly where it was —
 * so somebody who read to the bottom of the services index and clicked
 * "Careers" landed halfway down a page they had never seen, with the top of it
 * above them. On the short pages that means below the content entirely: a blank
 * screen, on a marketing site, from a nav link.
 *
 * ── THE THREE CASES, BECAUSE ONLY ONE OF THEM WANTS THE TOP ────────────────
 *
 *   · A LINK to a new path — scroll to the top. This is the case above and the
 *     only one this component acts on.
 *   · BACK or FORWARD (`POP`) — leave it alone. The browser is restoring a
 *     position the reader had, and overriding that turns the Back button into a
 *     way to lose your place, which is worse than the bug being fixed.
 *   · A HASH (`/services#freight`, the home page's `#quote`) — leave it alone.
 *     The whole point of the anchor is to arrive somewhere that is not the top,
 *     and `scroll-mt-[var(--sticky-top)]` already positions it under the header.
 *
 * ── AND WHY `instant` IS SPELLED OUT ───────────────────────────────────────
 *
 * `index.css` sets `scroll-behavior: smooth` on `html`, which `behavior: "auto"`
 * inherits — so the default would ANIMATE the jump, and a reader who clicked a
 * nav link would watch three thousand pixels of a page they did not ask for
 * slide past. `instant` is the one value that ignores the CSS. Under
 * `prefers-reduced-motion` the umbrella in index.css turns the smooth scrolling
 * off anyway; this stays correct either way.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  React.useEffect(() => {
    if (navigationType === "POP" || hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    // `hash` is a dependency so that leaving an anchored URL for a plain one
    // still scrolls; `navigationType` so a PUSH to the path a POP just restored
    // is not mistaken for the POP.
  }, [pathname, hash, navigationType]);

  return null;
}

export function AppRouter() {
  return (
    /* ABOVE the Suspense boundary, not inside it. When a lazily-loaded route
       suspends, everything inside the boundary is replaced by the fallback and
       its effects are torn down — so a ScrollToTop in there would unmount on
       the very navigations that need it and only fire once the chunk resolved.
       Outside, it is never suspended and the scroll happens as the URL changes. */
    <>
      <ScrollToTop />
      <React.Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* At the root `p()` IS "/", and the marketing route below already
            claims it — a redirect here would point at itself. */}
        {IS_ROOT ? null : <Route path="/" element={<Navigate to={p()} replace />} />}

        {/* ── the public site ── */}
        <Route path={p()} element={<Marketing />} />
        <Route path={p("/track")} element={<Track />} />
        <Route path={p("/services")} element={<ServicesIndex />} />
        <Route path={p("/services/:slug")} element={<ServiceDetail />} />
        <Route path={p("/portfolio")} element={<PortfolioIndex />} />
        <Route path={p("/portfolio/:slug")} element={<PortfolioStory />} />
        <Route path={p("/proposals/:token")} element={<Proposal />} />
        <Route path={p("/insights")} element={<Insights />} />
        <Route path={p("/insights/:slug")} element={<Insight />} />
        <Route path={p("/careers")} element={<Careers />} />
        <Route path={p("/careers/:token")} element={<Vacancy />} />
        {/*
          The quote form has its own route again, and the redirect it replaces
          was the bug: the header's CTA pointed at `#quote`, which in an SPA
          scrolls to an element the lazy marketing chunk has not rendered yet
          (from another page) or re-renders what is already mounted without
          moving (from the home page). Either way the button did nothing.
          `features/quote/quote-page.tsx` records the rest.
        */}
        <Route path={p("/quote")} element={<Quote />} />
        {/*
          A page, not a redirect back to `…#contact`. That redirect was the
          same defect the quote CTA had: the fragment is discarded by
          `NavLink`'s active test — so the header highlighted Contact on the
          home page — and following it scrolls to an element the lazy marketing
          chunk has not rendered. `features/contact/contact-page.tsx` records
          the rest. The home page keeps `#contact` as a band that points here,
          so links already in circulation still land somewhere sensible.
        */}
        <Route path={p("/contact")} element={<Contact />} />

        {/* ── the external portal ── */}
        <Route path="/portal/*" element={<PortalApp />} />

        {/* ── legacy redirects, kept because the ERP published these URLs ──
            Skipped at the root, where these ARE the canonical paths and each
            line would be a route redirecting to itself. */}
        {IS_ROOT ? null : (
          <>
            <Route path="/track" element={<LegacyQuery to={p("/track")} />} />
            <Route
              path="/portfolio"
              element={<Navigate to={p("/portfolio")} replace />}
            />
            <Route
              path="/portfolio/:slug"
              element={<LegacyParam to={p("/portfolio")} />}
            />
            <Route
              path="/proposals/:token"
              element={<LegacyParam to={p("/proposals")} />}
            />
            <Route
              path="/careers"
              element={<Navigate to={p("/careers")} replace />}
            />
            <Route
              path="/careers/:token"
              element={<LegacyParam to={p("/careers")} />}
            />
          </>
        )}
        {/* The Kaizen Hub was renamed to Insights (WS5's resolved naming). The
            old path is redirected on every host rather than deleted: a URL that
            has been shared or indexed outlives the decision to rename it, and a
            404 is how a rename loses the readers it already had. */}
        <Route path="/kaizen" element={<Navigate to={p("/insights")} replace />} />
        <Route path="/kaizen/:slug" element={<LegacyParam to={p("/insights")} />} />
        {/* Wrong on EVERY host, root included: `/tracking` was the ERP's spelling
            and `/proposal` the singular the sales team still types. */}
        <Route path="/tracking" element={<LegacyQuery to={p("/track")} />} />
        <Route
          path="/proposal/:token"
          element={<LegacyParam to={p("/proposals")} />}
        />
        <Route path="/client-portal/*" element={<LegacySplat to="/portal" />} />
        {/* The ORIGINAL prefix, kept for good.
            `/public` was the only prefix until it became a per-tenant setting, so
            a tenant who renames to `/site` would otherwise strand every URL
            already printed on a card, sent in an email or indexed by Google.
            `shared/http/public-web-paths.js` claims `/public` on the server
            whatever the base is, precisely so this route can answer it.
            Skipped when the base IS `/public`, where it would redirect to
            itself. */}
        {BASE_IS_DEFAULT ? null : (
          <Route path={`${LEGACY_BASE}/*`} element={<LegacySplat to={p()} />} />
        )}
        {/* `/login` and `/reset-password` are NOT redirected: they belong to the
            ERP and are served by `client/dist` on the same origin. Landing them
            here would put a staff sign-in behind a marketing app. */}

        <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </React.Suspense>
    </>
  );
}
