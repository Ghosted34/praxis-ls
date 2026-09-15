import * as React from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { useApproaching } from "@/components/ui/reveal";
import type { CandidateFormProps } from "./candidate-form";

/**
 * The candidate form, deferred — `quote-band.tsx`'s pattern, for its reason.
 *
 * ── WHY IT IS DEFERRED AT ALL ─────────────────────────────────────────────
 *
 * `check-bundle.mjs` caps what a route ADDS to the first paint, and its own
 * header names the defect it was calibrated on: `services-page` at 16.3 kB
 * because it "imported the whole quote wizard statically for a form two screens
 * below the fold". This is the same shape. The careers routes carry an upload
 * engine — a file picker, image compression, a data-URL reader — and on the
 * index route the form is not rendered at all until somebody presses a button,
 * while on the advert it sits under a full job description.
 *
 * Both careers routes are one chunk (the router lazily imports `CareersPage`
 * and `VacancyPage` from the same module), so deferring at one call site alone
 * would save nothing. This module is what both of them go through.
 *
 * ── WHY `useApproaching` AND NOT BARE `React.lazy` ────────────────────────
 *
 * `React.lazy` alone starts the fetch when the element renders, which on the
 * advert is the same moment the page renders — the chunk leaves the critical
 * path and then races the reader anyway, and a fallback swapping for a form of
 * a different height is a layout shift under somebody's thumb. A screen of lead
 * means the form is normally in place before it is legible.
 *
 * On the not-hiring band the form is mounted BY a click, so it is already on
 * screen when it mounts and `near` is true almost immediately. The hook costs
 * nothing there and the one code path serves both.
 *
 * ── AND WHY THE PLACEHOLDER RESERVES ONE HONEST HEIGHT ────────────────────
 *
 * Not a faithful skeleton of the controls. `quote-band` says why and names this
 * very route as the counter-example: `/careers` scored CLS 0.093 from a
 * four-row `PageSkeleton` standing in for a list of a different length. This
 * reserves roughly the height of the form's first three fields and says what is
 * coming, rather than imitating eleven.
 */
const CandidateForm = React.lazy(() =>
  import("./candidate-form").then((m) => ({ default: m.CandidateForm })),
);

function FormPlaceholder({ label }: { label: string }) {
  return (
    <div className="mt-4 space-y-3.5" aria-busy="true" aria-live="polite">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <span className="block text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function LazyCandidateForm(props: CandidateFormProps) {
  const { t } = useTranslation();
  const [ref, near] = useApproaching<HTMLDivElement>();
  const placeholder = <FormPlaceholder label={t("common.loading")} />;

  return (
    <div ref={ref}>
      {near ? (
        <React.Suspense fallback={placeholder}>
          <CandidateForm {...props} />
        </React.Suspense>
      ) : (
        placeholder
      )}
    </div>
  );
}
