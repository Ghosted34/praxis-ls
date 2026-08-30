import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PublicApiError, messageFor } from "@/lib/api";
import { trackShipment, type TrackingResult } from "@/lib/tracking-api";
import { currentLocale, tStatic } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/pill";
import { CheckIcon } from "@/components/ui/icons";
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
 * person.
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
 * ── WHY 404 AND 500 CANNOT SHARE A SENTENCE ────────────────────────────────
 *
 * The lookup is limited to 30 attempts per 15 minutes per connection. An office
 * behind one NAT address shares that ceiling, so "too many attempts" arrives
 * occasionally at 17:00 and means nothing about the cargo. Folding it into a
 * generic failure would leave the twelfth colleague of the day concluding their
 * shipment has vanished; the states below are therefore separate, and only the
 * retryable one offers a retry.
 */
type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; view: TrackingResult }
  | { kind: "notfound" }
  | { kind: "limited" }
  | { kind: "error"; message: string };

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
          <EmptyState title={t("site.track.empty")} />
        ) : state.kind === "loading" ? (
          <Skeleton className="h-64" />
        ) : state.kind === "notfound" ? (
          <Card padded className="max-w-prose">
            <EmptyState
              title={t("site.track.notFound")}
              hint={t("site.track.notFoundHint")}
            />
          </Card>
        ) : state.kind === "limited" ? (
          <Card padded className="max-w-prose">
            <EmptyState
              title={t("site.track.limited")}
              hint={t("site.track.limitedHint")}
            />
          </Card>
        ) : state.kind === "error" ? (
          <ErrorState
            message={state.message}
            action={
              <Button onClick={() => setNonce((n) => n + 1)}>
                {t("common.retry")}
              </Button>
            }
          />
        ) : (
          <TrackingResult view={state.view} reference={ref} />
        )}
      </Section>
    </PageShell>
  );
}

/** The milestone ledger, rendered the way the operations desk reads it: where the
 *  file is now, how far that is through the visible stages, then what happened. */
function TrackingResult({
  view,
  reference,
}: {
  view: TrackingResult;
  reference: string;
}) {
  const { t } = useTranslation();
  const milestones = view.milestones || [];
  const percent = Math.max(
    0,
    Math.min(100, Number(view.progress?.percent ?? 0)),
  );
  const total = view.progress?.total ?? milestones.length;
  const done =
    view.progress?.completed ?? milestones.filter((m) => m.is_complete).length;

  const stamp = (v: string | null) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime())
      ? v
      : new Intl.DateTimeFormat(currentLocale(), {
          dateStyle: "medium",
        }).format(d);
  };

  return (
    <div className="space-y-6">
      <Card padded>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="micro">{t("site.track.reference")}</p>
            <h2 className="mt-1 break-words font-display text-h3 font-semibold tracking-tight">
              {view.reference || reference}
            </h2>
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
            {view.current_stage ? (
              <p className="text-right text-xs text-muted-foreground">
                {t("site.trackPage.current")}:{" "}
                <span className="font-medium text-foreground">
                  {view.current_stage.label || view.current_stage.code}
                </span>
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
        </div>
      </Card>

      {milestones.length > 0 && (
        <div>
          <h2 className="text-title font-semibold tracking-tight">
            {t("site.trackPage.timeline")}
          </h2>
          <ol className="mt-5">
            {milestones.map((m, i) => {
              const at = stamp(m.completed_at) || stamp(m.due_date);
              const isDone = !!m.is_complete || m.public_state === "COMPLETED";
              const isCurrent = !!m.is_current || m.public_state === "CURRENT";
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
                        isDone ? "bg-[var(--brand-orange)]" : "bg-border",
                      )}
                    />
                  ) : null}
                  <span
                    aria-hidden
                    className={cn(
                      "relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background",
                      isDone
                        ? "border-[var(--brand-orange)] bg-[var(--brand-orange)] text-[var(--primary-foreground)]"
                        : isCurrent
                          ? "border-[var(--brand-orange)] text-[var(--brand-orange)]"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {isDone ? (
                      <CheckIcon size={13} />
                    ) : (
                      <span className="num text-[10px] font-semibold">
                        {i + 1}
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium leading-6">
                        {m.label || m.code}
                      </h3>
                      <StatusPill status={m.public_state} />
                      {isCurrent && !isDone ? (
                        <span className="text-xs font-medium text-primary-ink">
                          {t("site.track.current")}
                        </span>
                      ) : null}
                    </div>
                    {(m.location || at) && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[m.location, at].filter(Boolean).join(" · ")}
                      </p>
                    )}
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
      )}

      <Card padded className="max-w-prose bg-muted">
        <p className="text-sm text-muted-foreground">
          {t("site.trackPage.needAccount")}
        </p>
        <Link
          to="/portal/login"
          className="mt-2 inline-flex text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
        >
          {t("site.trackPage.openPortal")}
        </Link>
      </Card>
    </div>
  );
}
