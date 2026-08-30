import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PublicApiError, messageFor, requestIdFor } from "@/lib/api";
import { trackShipment, type TrackingResult } from "@/lib/tracking-api";
import { getLang, tStatic } from "@/lib/i18n";
import { dateFmt, dateTimeFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { p } from "@/lib/base-path";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NotFoundState,
  MilestoneMarker,
  MilestoneStatePill,
  ModeIcon,
  isClosed,
  milestoneState,
} from "@/components/state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/pill";
import { TrackWidget } from "@/components/site/track-widget";

/**
 * `/public/track` — the public lookup, and the page most visitors of this whole
 * app are actually here for.
 *
 * ── WHY THE REFERENCE LIVES IN THE URL ─────────────────────────────────────
 *
 * `?ref=…` IS the state, so the page is reproducible, shareable and
 * bookmarkable, and the Back button means something. Freight references get copied
 * out of WhatsApp messages and read aloud over the phone; a lookup whose result
 * cannot be expressed as a URL is a lookup that cannot be handed to the next
 * person. The hero widget on every other page writes the same parameter, so the
 * handoff from the homepage is a navigation rather than a second code path.
 *
 * ── WHAT THIS PAGE IS NOT ──────────────────────────────────────────────────
 *
 * It is not a carrier integration. `tracking_public.routes.js` reads the tenant's
 * own milestone ledger and computes a status from it — no project44, no carrier
 * portal, no scraping of a line's tracking site. Which is why the empty answer is
 * "we have no record of that reference" and never "your vessel is delayed": there
 * is no feed behind this page to support a claim like that. The milestone set is
 * exactly what the tenant's operations team marked client-visible, so the copy
 * says whose judgement produced this list rather than implying a global network.
 *
 * ── THE FIVE OUTCOMES, AND WHY NONE OF THEM SHARE A COMPONENT ──────────────
 *
 * idle · loading · found · not-found · rate-limited · failed. `doc/
 * PUBLIC_WEB_PLAN.md` §3.3 requires the middle four to be designed and, in
 * particular, requires not-found to be distinguishable from empty: "no shipment
 * matches that reference" and "this file has no visible stages yet" are
 * different facts with different next actions, and a client whose file was
 * opened this morning must not be told their reference is wrong.
 *
 * The rate limit gets its own outcome for the same reason. The lookup allows 30
 * attempts per 15 minutes per connection, an office behind one NAT address
 * shares that ceiling, and it is reached at 17:00 on a busy day. Folded into a
 * generic failure it would leave the twelfth colleague concluding their shipment
 * has vanished — so it is stated plainly, and it is the one failure that does
 * NOT offer a retry button, because retrying is exactly what it is asking the
 * visitor to stop doing.
 */
type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; view: TrackingResult }
  | { kind: "notfound" }
  | { kind: "limited" }
  | { kind: "error"; message: string; requestId: string | null };

export function TrackPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const ref = (params.get("ref") || "").trim();
  const [nonce, setNonce] = React.useState(0);
  const [state, setState] = React.useState<State>({ kind: "idle" });

  React.useEffect(() => {
    if (!ref) {
      setState({ kind: "idle" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    trackShipment(ref)
      .then((view) => alive && setState({ kind: "found", view }))
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof PublicApiError && e.isNotFound) {
          setState({ kind: "notfound" });
        } else if (e instanceof PublicApiError && e.isRateLimited) {
          setState({ kind: "limited" });
        } else {
          setState({
            kind: "error",
            message: messageFor(e, tStatic("errors.loadFailed")),
            requestId: requestIdFor(e),
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [ref, nonce]);

  return (
    <PageShell label={t("site.trackPage.title")} footer>
      <section className="band-hero">
        <PageContainer>
          <p className="eyebrow text-[var(--brand-orange)]">
            {t("site.track.kicker")}
          </p>
          <h1 className="hero-title mt-3 text-[var(--hero-foreground)]">
            {t("site.trackPage.title")}
          </h1>
          <p className="mt-4 max-w-measure text-[var(--hero-muted)]">
            {t("site.trackPage.sub")}
          </p>
          <div className="mt-7 max-w-2xl">
            <TrackWidget variant="page" onDark />
          </div>
        </PageContainer>
      </section>

      <Section>
        {state.kind === "idle" ? (
          <EmptyState title={t("site.track.empty")} hint={t("site.track.hint")} />
        ) : state.kind === "loading" ? (
          <TrackingSkeleton />
        ) : state.kind === "notfound" ? (
          <NotFoundState
            className="mx-auto max-w-prose"
            title={t("site.track.notFound")}
            hint={t("site.track.notFoundHint")}
            action={
              <ButtonLink to={p("/quote")} variant="outline">
                {t("site.trackPage.searchAgain")}
              </ButtonLink>
            }
          />
        ) : state.kind === "limited" ? (
          // No retry button, deliberately: the answer to a rate limit is to
          // stop, and a button labelled "try again" invites the opposite.
          <NotFoundState
            className="mx-auto max-w-prose"
            title={t("site.track.limited")}
            hint={t("site.track.limitedHint")}
          />
        ) : state.kind === "error" ? (
          <ErrorState
            message={state.message}
            requestId={state.requestId}
            action={
              <Button onClick={() => setNonce((n) => n + 1)}>
                {t("common.retry")}
              </Button>
            }
          />
        ) : (
          <TrackingView view={state.view} reference={ref} />
        )}
      </Section>
    </PageShell>
  );
}

/**
 * The loading state, in the shape of the answer.
 *
 * §3.3: "a skeleton of the real shape. Never a spinner on a blank page." The
 * blocks below are the summary card and four timeline rows, at the sizes the
 * real ones occupy, so the result lands in place instead of pushing the page
 * down under somebody's thumb on a phone.
 */
function TrackingSkeleton() {
  return (
    <LoadingState label={tStatic("site.trackPage.loading")} className="space-y-6">
      <Card padded>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-7 w-64 max-w-full" />
            <Skeleton className="mt-3 h-4 w-48" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Skeleton className="mt-6 h-2 w-full rounded-full" />
      </Card>
      <div className="space-y-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-52 max-w-full" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    </LoadingState>
  );
}

/** The milestone ledger, rendered the way the operations desk reads it: what the
 *  file is, how far through it is, then what has happened to it. */
function TrackingView({
  view,
  reference,
}: {
  view: TrackingResult;
  reference: string;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const milestones = view.milestones || [];
  const percent = Math.max(
    0,
    Math.min(100, Number(view.progress?.percent ?? 0)),
  );
  const total = view.progress?.total ?? milestones.length;
  const done =
    view.progress?.completed ?? milestones.filter((m) => m.is_complete).length;
  const closed = isClosed(view.computed_status);
  // name_en is nullable and name_fr is not (0310_operations.sql), so English
  // falls back to French rather than to a blank chip.
  const serviceName = view.service_type
    ? (lang === "fr"
        ? view.service_type.name_fr
        : view.service_type.name_en || view.service_type.name_fr) || null
    : null;

  return (
    <div className="space-y-6">
      <Card padded>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="micro">{t("site.track.reference")}</p>
            <h2 className="mt-1 break-words font-display text-h3 font-semibold tracking-tight">
              {view.reference || reference}
            </h2>
            {view.service_type ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <ModeIcon
                  mode={view.service_type.mode}
                  className="text-[var(--brand-orange)]"
                />
                <span className="min-w-0 truncate">
                  {serviceName || view.service_type.key}
                </span>
              </p>
            ) : null}
            {view.origin || view.destination ? (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {view.origin ? (
                  <span>
                    <span className="micro mr-1.5">
                      {t("site.trackPage.origin")}
                    </span>
                    {view.origin}
                  </span>
                ) : null}
                {view.origin && view.destination ? (
                  <span aria-hidden className="h-px w-6 bg-border" />
                ) : null}
                {view.destination ? (
                  <span>
                    <span className="micro mr-1.5">
                      {t("site.trackPage.destination")}
                    </span>
                    {view.destination}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <StatusPill status={view.computed_status} />
            {view.current_stage && !closed ? (
              <p className="text-right text-xs text-muted-foreground">
                {t("site.trackPage.current")}:{" "}
                <span className="font-medium text-foreground">
                  {view.current_stage.label || view.current_stage.code}
                </span>
              </p>
            ) : null}
            {closed ? (
              <p className="text-right text-xs text-muted-foreground">
                {t("site.trackPage.closed")}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>{t("site.trackPage.progress")}</span>
            <span className="num">
              {done}/{total} {t("site.trackPage.ofStages")}
            </span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("site.trackPage.progress")}
          >
            <div
              className="h-full rounded-full bg-[var(--brand-orange)] transition-[width] duration-500 ease-[var(--ease)]"
              style={{ width: `${percent}%` }}
            />
          </div>
          {/* When it last MOVED, not when the record was last touched — the API
              derives this from the latest completion for that reason. Absent
              rather than faked while nothing has completed. */}
          <p className="mt-3 text-xs text-muted-foreground">
            <span className="micro mr-1.5">{t("site.trackPage.lastUpdate")}</span>
            {view.last_update ? (
              <time dateTime={view.last_update} className="num">
                {dateTimeFmt(view.last_update)}
              </time>
            ) : (
              t("site.trackPage.lastUpdateNone")
            )}
          </p>
        </div>
      </Card>

      {milestones.length > 0 ? (
        <div>
          <h2 className="text-title font-semibold tracking-tight">
            {t("site.trackPage.timeline")}
          </h2>
          <ol className="mt-5" aria-label={tStatic("site.trackPage.timeline")}>
            {milestones.map((m, i) => {
              const state = milestoneState(m);
              const at = m.completed_at || m.due_date;
              return (
                <li
                  key={`${m.code}-${i}`}
                  className="relative flex gap-4 pb-6 last:pb-0"
                >
                  {i < milestones.length - 1 ? (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-3 top-7 -ml-px h-[calc(100%-1.75rem)] w-px",
                        state === "COMPLETED"
                          ? "bg-[var(--brand-orange)]"
                          : "bg-border",
                      )}
                    />
                  ) : null}
                  <MilestoneMarker state={state} index={i} />
                  <div
                    className={cn(
                      "min-w-0 flex-1",
                      state === "UPCOMING" && "text-muted-foreground",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className={cn(
                          "leading-6",
                          state === "CURRENT"
                            ? "font-semibold text-foreground"
                            : "font-medium",
                        )}
                      >
                        {m.label || m.code}
                      </h3>
                      <MilestoneStatePill state={state} />
                    </div>
                    {m.location || at ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[m.location, at ? dateFmt(at) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                    {m.progress_note ? (
                      <p className="mt-1.5 text-sm text-muted-foreground">
                        {m.progress_note}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        // Found the file, and it has no client-visible stages yet. This is the
        // state §3.3 insists must not read as "no such reference".
        <EmptyState
          title={t("site.trackPage.noStages")}
          hint={t("site.trackPage.noStagesHint")}
          action={
            <ButtonLink to={p("/portal/login")} variant="outline">
              {t("site.trackPage.openPortal")}
            </ButtonLink>
          }
        />
      )}

      <Card padded className="max-w-prose bg-muted">
        <p className="text-sm text-muted-foreground">
          {t("site.trackPage.needAccount")}
        </p>
        <Link
          to={p("/portal/login")}
          className="mt-2 inline-flex text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
        >
          {t("site.trackPage.openPortal")}
        </Link>
      </Card>
    </div>
  );
}
