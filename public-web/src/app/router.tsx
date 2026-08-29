import * as React from "react";
import {
  Navigate,
  Route,
  Routes,
  useParams,
  useLocation,
} from "react-router-dom";
import { NotFoundPage } from "@/features/not-found/not-found-page";
import { Skeleton } from "@/components/ui/skeleton";

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
const Proposal = lazy(
  () => import("@/features/proposals/proposal-page"),
  "ProposalPage",
);
const Careers = lazy(
  () => import("@/features/careers/careers-page"),
  "CareersPage",
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

/** `/portfolio/:slug` → `/public/portfolio/:slug`. The slug is re-encoded rather
 *  than pasted back raw, because a French slug contains spaces and accents and
 *  some of these links were typed by hand into an email months ago. */
function LegacyParam({ to }: { to: string }) {
  const params = useParams();
  const rest = Object.values(params)
    .filter((v): v is string => !!v)
    .map(encodeURIComponent)
    .join("/");
  return <Navigate to={rest ? `${to}/${rest}` : to} replace />;
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
  return (
    <Navigate to={`${to}${tail ? `/${tail}` : ""}${search}${hash}`} replace />
  );
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

export function AppRouter() {
  return (
    <React.Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/public" replace />} />

        {/* ── the public site ── */}
        <Route path="/public" element={<Marketing />} />
        <Route path="/public/track" element={<Track />} />
        <Route path="/public/services" element={<ServicesIndex />} />
        <Route path="/public/services/:slug" element={<ServiceDetail />} />
        <Route path="/public/portfolio" element={<PortfolioIndex />} />
        <Route path="/public/portfolio/:slug" element={<PortfolioStory />} />
        <Route path="/public/proposals/:token" element={<Proposal />} />
        <Route path="/public/careers" element={<Careers />} />
        <Route path="/public/careers/:token" element={<Vacancy />} />
        {/* The form used to live at its own path; the band on the home page is the
            same fields, and a bookmark should reach it rather than 404. */}
        <Route
          path="/public/quote"
          element={<Navigate to="/public#quote" replace />}
        />
        <Route
          path="/public/contact"
          element={<Navigate to="/public#contact" replace />}
        />

        {/* ── the external portal ── */}
        <Route path="/portal/*" element={<PortalApp />} />

        {/* ── legacy redirects, kept because the ERP published these URLs ── */}
        <Route path="/track" element={<LegacyQuery to="/public/track" />} />
        <Route path="/tracking" element={<LegacyQuery to="/public/track" />} />
        <Route
          path="/portfolio"
          element={<Navigate to="/public/portfolio" replace />}
        />
        <Route
          path="/portfolio/:slug"
          element={<LegacyParam to="/public/portfolio" />}
        />
        <Route
          path="/proposal/:token"
          element={<LegacyParam to="/public/proposals" />}
        />
        <Route
          path="/proposals/:token"
          element={<LegacyParam to="/public/proposals" />}
        />
        <Route
          path="/careers"
          element={<Navigate to="/public/careers" replace />}
        />
        <Route
          path="/careers/:token"
          element={<LegacyParam to="/public/careers" />}
        />
        <Route path="/client-portal/*" element={<LegacySplat to="/portal" />} />
        {/* `/login` and `/reset-password` are NOT redirected: they belong to the
            ERP and are served by `client/dist` on the same origin. Landing them
            here would put a staff sign-in behind a marketing app. */}

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </React.Suspense>
  );
}
