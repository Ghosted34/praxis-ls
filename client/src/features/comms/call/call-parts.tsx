/**
 * Pieces every call surface shares (calls audit PR-6): the clock, the
 * recording notice, the quality line and the noise filter's honest status.
 * Solid, token-coloured, in the layout flow (F1, F2, F3).
 */
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { QualitySample } from "./call-engine";

/**
 * The recording notice (decision row 5; F6). `future` is the ring's version:
 * the call WILL be recorded if answered normally. `detail` names who
 * processes the audio (G2).
 */
export function RecordingNotice({ future = false, detail = "", compact = false }: { future?: boolean; detail?: string; compact?: boolean }) {
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground", compact && "py-1.5")}>
      <span aria-hidden className="mt-1 inline-block h-2 w-2 flex-none rounded-full bg-destructive" />
      <span className="min-w-0">
        <span className="block">
          {future
            ? tr("This call will be recorded and summarised — both parties are informed.")
            : tr("This call is recorded and summarised — both parties are informed.")}
        </span>
        {detail && <span className="mt-0.5 block text-muted-foreground">{detail}</span>}
      </span>
    </div>
  );
}

const QUALITY_DOT: Record<QualitySample["state"], string> = {
  good: "bg-ok",
  fair: "bg-warn",
  poor: "bg-bad",
};
const QUALITY_LABEL: Record<QualitySample["state"], string> = {
  good: "Good connection",
  fair: "Fair connection",
  poor: "Poor connection",
};

/** The link quality from getStats (§3.4): colour AND words, never colour alone. */
export function QualityLine({ quality }: { quality: QualitySample }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", QUALITY_DOT[quality.state])} />
      {tr(QUALITY_LABEL[quality.state])}
    </p>
  );
}
