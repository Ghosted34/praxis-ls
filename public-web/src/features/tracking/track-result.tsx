import * as React from "react";
import { useTranslation } from "react-i18next";
import { getLang, tStatic } from "@/lib/i18n";
import { dateFmt, dateTimeFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { p } from "@/lib/base-path";
import { ButtonLink } from "@/components/ui/button";
import { usePointerLight } from "@/lib/motion";
import { modeToken } from "@/lib/service-identity";
import {
  EmptyState,
  MilestoneStatePill,
  modeIconFor,
  isClosed,
  milestoneState,
  motionIcon,
  type MilestoneState,
} from "@/components/state";
import { IconTile } from "@/components/ui/icon-tile";
import type { PublicMilestone, TrackingResult } from "@/lib/tracking-api";

/**
 * The answer half of `/public/track` (guide §8.1).
 *
 * ── WHY THIS PAGE IS THE ONE THAT GETS ERGONOMICS AND NOT SPECTACLE ────────
 *
 * §8.1 calls this "the most-visited screen on the site and today the least
 * designed", and then immediately constrains how it may be fixed: depth rungs
 * 1 and 3 only, no WebGL, no frame sequence, no deferred chunk. The reason is
 * the audience. This page is opened on a phone, on mobile data, by somebody who
 * wants one fact — where is my cargo — and every kilobyte between them and that
 * fact is a cost they did not choose. So everything below is statically
 * imported, the depth is elevation plus a pointer-driven separation that a
 * phone never even computes, and the heaviest thing on the screen is a
 * gradient.
 *
 * ── THE ONE FACT FIRST, AND WHAT "ETA" HONESTLY MEANS HERE ────────────────
 *
 * §8.1 asks for "status and ETA above everything, at display size, before the
 * timeline". Status is straightforward. ETA is not, and the deviation is worth
 * stating because it is about N12 rather than about layout:
 *
 *   **There is no ETA in this API and there is no feed behind this page.**
 *   `tracking_public.routes.js` reads the tenant's own milestone ledger. It has
 *   no carrier integration, no vessel schedule and no arrival estimate, and
 *   `tracking-api.ts` says so in as many words. Computing one — from a
 *   transit-time average, from the remaining stage count, from anything — would
 *   put a date in front of a client that no one at the desk ever committed to,
 *   which is the exact failure N12 exists to prevent, on the page where it
 *   would cost the most.
 *
 * So the display line states the LAST SCHEDULED DATE THE TENANT ENTERED: the
 * due date of the final incomplete stage, labelled as that stage's scheduled
 * date rather than as an arrival promise. Where the desk has scheduled nothing,
 * the slot carries the current stage's name instead and no date is shown. A
 * missing date is a designed state here, not a gap.
 */

/** The mode's triplet for this file, or null where the desk has not classified
 *  it. Null leaves `--mode` unset and the CSS falls back to the tenant's own
 *  accent — see `service-identity.ts` on why an unclassified file must not be
 *  painted as though it were a sea file. */
function modeStyle(view: TrackingResult): React.CSSProperties | undefined {
  const token = modeToken(view.service_type?.mode);
  return token ? ({ "--mode": token } as React.CSSProperties) : undefined;
}

/**
 * The one scheduled date this file actually carries, if any.
 *
 * The LAST incomplete stage with a due date, not the next one: a visitor asking
 * "when does this land" means the end of the file, and the next stage's date is
 * a different (smaller) question the timeline below already answers per row.
 * Returns null when the desk has scheduled nothing, which is common on a file
 * opened this morning.
 */
export function scheduledEnd(milestones: PublicMilestone[]): PublicMilestone | null {
  let found: PublicMilestone | null = null;
  for (const m of milestones) {
    if (!m.is_complete && m.due_date) found = m;
  }
  return found;
}

/** The verdict plate: the fact, at display size, lit by the file's own mode. */
function Verdict({
  view,
  reference,
}: {
  view: TrackingResult;
  reference: string;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const milestones = view.milestones || [];
  const closed = isClosed(view.computed_status);
  const end = scheduledEnd(milestones);
  const percent = Math.max(0, Math.min(100, Number(view.progress?.percent ?? 0)));
  const total = view.progress?.total ?? milestones.length;
  const done =
    view.progress?.completed ?? milestones.filter((m) => m.is_complete).length;
  // name_en is nullable and name_fr is not (0310_operations.sql), so English
  // falls back to French rather than to a blank chip.
  const serviceName = view.service_type
    ? (lang === "fr"
        ? view.service_type.name_fr
        : view.service_type.name_en || view.service_type.name_fr) || null
    : null;

  const statusLabel = closed
    ? t("site.trackPage.verdictDone")
    : view.computed_status === "IN_PROGRESS"
      ? t("site.trackPage.verdictMoving")
      : t("site.trackPage.verdictOpened");

  return (
    <section className="track-verdict p-6 sm:p-8" style={modeStyle(view)}>
      {/* Positioned above the plate's two pseudo-element layers. */}
      <div className="relative">
        <p className="micro">{t("site.trackPage.theAnswer")}</p>

        {/* THE ONE FACT. An `<h2>` because the hero above owns the page's h1,
            and a heading rather than a styled paragraph because it is the
            structural answer to the question the page asks. */}
        <h2 className="track-headline mt-2">{statusLabel}</h2>

        {/* The date, or the stage — never both, and never an invented one.
            `num` is tabular figures, which is what stops a date jittering when
            the language toggle changes its length. */}
        <p className="mt-3 text-lg text-muted-foreground">
          {closed ? (
            /* "Delivered" is the answer; this is the qualification that keeps
               it honest. The ledger only ever held the stages the desk marked
               client-visible, so "every stage is done" would be a claim about a
               list the visitor cannot see. Losing this sentence when the
               headline replaced the old status pill was a real regression — the
               test that asserts it is why it came back. */
            <span>{t("site.trackPage.closed")}</span>
          ) : end ? (
            <>
              <span className="micro mr-2">{t("site.trackPage.scheduled")}</span>
              <time dateTime={end.due_date || undefined} className="num font-medium text-foreground">
                {dateFmt(end.due_date)}
              </time>
              <span className="ml-2">· {end.label || end.code}</span>
            </>
          ) : view.current_stage ? (
            <>
              <span className="micro mr-2">{t("site.trackPage.current")}</span>
              <span className="font-medium text-foreground">
                {view.current_stage.label || view.current_stage.code}
              </span>
            </>
          ) : (
            /* No schedule and no current stage. Said plainly rather than left
               blank: an empty line under a status reads as a page that failed
               to load something. */
            <span>{t("site.trackPage.noSchedule")}</span>
          )}
        </p>

        {/* The identifying facts, demoted below the answer. This is the
            inversion §8.1 asks for — the reference used to be the h2 and the
            status a pill in the corner, which put the thing the visitor
            already knows above the thing they came to find out. */}
        <dl className="mt-6 flex flex-wrap items-start gap-x-8 gap-y-4 border-t border-border pt-5 text-sm">
          <div className="min-w-0">
            <dt className="micro">{t("site.track.reference")}</dt>
            <dd className="num mt-1 break-words font-medium">
              {view.reference || reference}
            </dd>
          </div>
          {serviceName || view.service_type ? (
            <div className="min-w-0">
              <dt className="micro">{t("site.trackPage.service")}</dt>
              <dd className="mt-1 flex items-center gap-2 font-medium">
                {view.service_type ? (
                  <IconTile icon={modeIconFor(view.service_type.mode)} size="sm" />
                ) : null}
                <span className="min-w-0 truncate">
                  {serviceName || view.service_type?.key}
                </span>
              </dd>
            </div>
          ) : null}
          {view.origin ? (
            <div className="min-w-0">
              <dt className="micro">{t("site.trackPage.origin")}</dt>
              <dd className="mt-1 font-medium">{view.origin}</dd>
            </div>
          ) : null}
          {view.destination ? (
            <div className="min-w-0">
              <dt className="micro">{t("site.trackPage.destination")}</dt>
              <dd className="mt-1 font-medium">{view.destination}</dd>
            </div>
          ) : null}
        </dl>

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
            {/* The mode's colour, so the bar and the rail below agree about what
                kind of shipment this is. */}
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-[var(--ease)]"
              style={{
                width: `${percent}%`,
                background: "rgb(var(--mode, var(--brand-orange)))",
              }}
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
      </div>
    </section>
  );
}

/**
 * One stage, at its real elevation.
 *
 * The three states are three heights off the page, not three colours: a
 * completed stage rests at `--elev-1`, the current one is lifted to `--elev-3`
 * with an emissive rim in the mode's colour, and an upcoming one is flush and
 * dimmed. That is what makes the column read as objects on a surface rather
 * than as a list with a highlighted row — and it survives greyscale, which a
 * colour-only encoding does not.
 */
function Stage({
  milestone,
  state,
  mode,
  last,
}: {
  milestone: PublicMilestone;
  state: MilestoneState;
  mode: React.ComponentType<{ size?: number; className?: string }>;
  last: boolean;
}) {
  const Motion = mode;
  const at = milestone.completed_at || milestone.due_date;
  const done = state === "COMPLETED";
  const now = state === "CURRENT";

  return (
    <li className="relative pb-3 last:pb-0">
      {/* The rail, lit only where the leg is complete. Drawn from this row down
          to the next, so the LAST row draws none — a line trailing off the end
          of a timeline suggests a stage that is not there. */}
      {!last ? (
        <span
          aria-hidden
          className={cn(
            "track-rail top-9 h-[calc(100%-1.5rem)]",
            done && "track-rail-lit",
          )}
        />
      ) : null}
      <div
        className={cn(
          "track-stage flex gap-4",
          done && "track-stage-done",
          now && "track-stage-now",
          state === "UPCOMING" && "track-stage-next",
        )}
      >
        {/* The marker. Not `MilestoneMarker` from the state module: that one
            paints itself in `--brand-orange` unconditionally, and on this page
            the marker has to carry the FILE's mode so the glyph, the rail and
            the progress bar agree. Same glyph table, same three states, one
            colour source. */}
        <span
          aria-hidden
          className={cn(
            "relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
            done && "border-transparent text-[var(--primary-foreground)]",
            now && "border-transparent text-[var(--primary-foreground)]",
            !done && !now && "border-border bg-background text-muted-foreground",
          )}
          style={
            done || now
              ? { background: "rgb(var(--mode, var(--brand-orange)))" }
              : undefined
          }
        >
          <Motion size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={cn(
                "leading-6",
                now ? "font-semibold text-foreground" : "font-medium",
              )}
            >
              {milestone.label || milestone.code}
            </h3>
            <MilestoneStatePill state={state} />
          </div>
          {milestone.location || at ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[milestone.location, at ? dateFmt(at) : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {milestone.progress_note ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              {milestone.progress_note}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** The milestone ledger as a spatial column. */
export function TrackingView({
  view,
  reference,
}: {
  view: TrackingResult;
  reference: string;
}) {
  const { t } = useTranslation();
  const milestones = view.milestones || [];
  /*
   * Rung 3, and the ONLY motion on this page.
   *
   * `usePointerLight` writes `--lx`/`--ly` on this element; `.track-stage`
   * multiplies them by its own `--depth`, so the current stage separates from
   * the rail further than a completed one and an upcoming one does not move at
   * all. The hook declines coarse pointers outright, so on the phone this page
   * is designed for nothing is measured, nothing is written and nothing moves.
   * Under reduced motion the properties are never written either and both
   * translations evaluate to zero — the settled state, with no rule needed.
   */
  const lightRef = usePointerLight<HTMLDivElement>();
  const motion = motionIcon(view.service_type?.mode);

  return (
    <div ref={lightRef} className="space-y-8" style={modeStyle(view)}>
      <Verdict view={view} reference={reference} />

      {milestones.length > 0 ? (
        <section>
          <h2 className="text-title font-semibold tracking-tight">
            {t("site.trackPage.timeline")}
          </h2>
          <ol className="mt-5" aria-label={tStatic("site.trackPage.timeline")}>
            {milestones.map((m, i) => (
              <Stage
                key={`${m.code}-${i}`}
                milestone={m}
                state={milestoneState(m)}
                mode={motion}
                last={i === milestones.length - 1}
              />
            ))}
          </ol>
        </section>
      ) : (
        // Found the file, and it has no client-visible stages yet. This is the
        // state PUBLIC_WEB_PLAN §3.3 insists must not read as "no such
        // reference".
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

      <div className="track-quiet max-w-prose p-5">
        <p className="text-sm text-muted-foreground">
          {t("site.trackPage.needAccount")}
        </p>
        <ButtonLink to={p("/portal/login")} variant="outline" className="mt-3">
          {t("site.trackPage.openPortal")}
        </ButtonLink>
      </div>
    </div>
  );
}
