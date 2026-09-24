/**
 * One call: who, when, how long, its summary and its transcript
 * (calls audit A6: the summary notification needed somewhere to land).
 *
 * The house record shape (FRONTEND_GUIDE §3.11): one body, `CallRecord`, in
 * two shells. `CallRecordPage` is the route `/comms/calls/:callId`, which is
 * where the summary notification links; `CallRecordModal` is the phone sheet
 * the Calls list opens with `?focus=`. The body fetches everything by id.
 */
import * as React from "react";
import { useParams } from "react-router-dom";
import { tr, tv } from "@/lib/i18n";
import { dateTimeFmt } from "@/lib/format";
import { Dialog } from "@/components/ui/dialog";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { LoadingRow } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { Record360Header, Record360Page } from "@/components/record-360";
import * as api from "@/lib/smartcomm-api";
import type { Call, CallTranscriptView } from "@/lib/smartcomm-api";
import { myUserId } from "./call-session";
import { CallSummaryEditor } from "./summary-draft";
import { callDuration, callOutcome, peerOf } from "./call-labels";
import { CallStatePill } from "./call-state-pill";

export const CALLS_PATH = "/comms/calls";

/** The attributed transcript, loaded when asked for. */
function TranscriptSection({ callId }: { callId: string }) {
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<CallTranscriptView | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setError(null);
    api.getCallTranscript(callId)
      .then(setView)
      .catch(() => setError(tr("The transcript is not available.")));
  }, [callId]);

  React.useEffect(() => {
    if (open && !view) load();
  }, [open, view, load]);

  return (
    <Panel
      title={tr("Transcript")}
      action={
        <Button variant="outline" size="sm" icon={null} onClick={() => setOpen((o) => !o)}>
          {open ? tr("Hide transcript") : tr("Show transcript")}
        </Button>
      }
    >
      {!open && <p className="text-sm text-muted-foreground">{tr("Transcripts are long; open it when you need it.")}</p>}
      {open && error && <ScreenError message={error} what={tr("Transcript")} onRetry={load} />}
      {open && !error && !view && <LoadingRow />}
      {open && view && (
        view.sides.every((s) => !s.parts.length) ? (
          <p className="text-sm text-muted-foreground">{tr("No words were transcribed for this call.")}</p>
        ) : (
          <div className="space-y-4">
            {view.sides.filter((s) => s.parts.length).map((s) => (
              <section key={s.side}>
                <h3 className="text-sm font-semibold text-foreground">
                  {s.side === "caller" ? tr("Caller") : tr("Callee")}
                  {s.name ? ` · ${s.name}` : ""}
                </h3>
                <div className="mt-1 space-y-1">
                  {s.parts.map((p) => (
                    <p key={p.part_index} className="text-sm text-foreground">
                      <span className="text-micro uppercase text-muted-foreground">{p.language}</span>{" "}
                      {p.text}
                      {!p.certified && (
                        <span className="text-micro text-muted-foreground"> ({tr("from the browser capture, unverified")})</span>
                      )}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )
      )}
    </Panel>
  );
}

export function CallRecord({ callId, variant }: { callId: string; variant: "page" | "modal" }) {
  const [call, setCall] = React.useState<Call | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setError(null);
    api.getCall(callId)
      .then(setCall)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : tr("This call could not be loaded.")));
  }, [callId]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (error) return <ScreenError message={error} what={tr("Call")} onRetry={load} />;
  if (!call) return <LoadingRow />;

  const me = myUserId();
  const isCaller = call.caller_id === me;
  const peer = peerOf(call, me) || tr("Unknown");
  // A draft is shown whenever one exists: an old call whose only words came
  // from the retired browser capture is NO_RECORDING now, and still has one.
  const hasDraft = !!call.draft_status;
  const recorded = hasDraft
    || (call.recording_enabled !== false && call.transcription_state !== "NO_RECORDING");
  const failedWithoutDraft = !hasDraft && call.transcription_state === "TRANSCRIPTION_FAILED";

  return (
    <div className="space-y-4">
      {variant === "page" && (
        <Record360Header
          title={tv("Call with {{name}}", { name: peer })}
          pills={<CallStatePill state={call.transcription_state} />}
          meta={[
            dateTimeFmt(call.started_at),
            callDuration(call.duration_seconds),
            callOutcome(call, isCaller),
            isCaller ? tr("You called") : tr("They called you"),
          ]}
        />
      )}
      <Panel title={tr("Call summary")}>
        {!recorded ? (
          <p className="text-sm text-muted-foreground">
            {tr("This call was not recorded, so there is no summary.")}
          </p>
        ) : failedWithoutDraft ? (
          <p className="text-sm text-muted-foreground">
            {tr("The transcript could not be produced yet. It is retried once a day.")}
          </p>
        ) : isCaller ? (
          <CallSummaryEditor callId={callId} onChanged={load} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {tr("The caller reviews and sends the summary; it appears in your conversation when they do.")}
          </p>
        )}
      </Panel>
      {recorded && <TranscriptSection callId={callId} />}
    </div>
  );
}

/** `/comms/calls/:callId`: the desktop shell, and where the notification lands. */
export function CallRecordPage() {
  const { callId = "" } = useParams();
  return (
    <Record360Page basePath={CALLS_PATH} backLabel={tr("Calls")} id={callId}>
      <CallRecord callId={callId} variant="page" />
    </Record360Page>
  );
}

/** The phone sheet, opened from the Calls list with `?focus=`. */
export function CallRecordModal({
  id,
  title,
  onClose,
}: {
  id: string;
  /** From the list row, so the sheet names itself on the first frame. */
  title?: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} size="xl" title={title || tr("Call")}>
      <CallRecord callId={id} variant="modal" />
    </Dialog>
  );
}
