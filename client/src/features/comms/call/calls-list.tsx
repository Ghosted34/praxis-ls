/**
 * Comms → Calls: the user's calls, newest first (calls audit A6, E14: there was
 * no call history anywhere, and a summary the nightly sweep drafted had no
 * screen that could open it).
 *
 * A row opens the call's record (call-record.tsx): its page on a desktop, a
 * sheet on a phone. A draft waiting for the caller carries a badge; that badge,
 * not a push, is how a draft made by the daily sweep is found (audit A4).
 */
import { Link } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { dateTimeFmt } from "@/lib/format";
import { ListPage } from "@/components/list-page";
import type { Column } from "@/components/data-list";
import { Pill } from "@/components/ui/pill";
import { useList } from "@/lib/use-resource";
import { useRecordOpener } from "@/lib/record-360";
import type { CallListRow } from "@/lib/smartcomm-api";
import { myUserId } from "./call-session";
import { callDuration, callOutcome, peerOf, summaryBadge } from "./call-labels";
import { CallStatePill } from "./call-state-pill";
import { CALLS_PATH, CallRecordModal } from "./call-record";

type Row = CallListRow & Record<string, unknown>;

export function CallsListPage() {
  const { rows, error, loading } = useList<Row>("/smartcomm/calls");
  const me = myUserId();
  const { openRecord, sheetId, sheetRecord, closeSheet } = useRecordOpener(CALLS_PATH, rows, (r) => r.call_id);

  const columns: Column<Row>[] = [
    {
      key: "peer",
      label: tr("With"),
      className: "font-medium",
      render: (r) => peerOf(r, me) || tr("Unknown"),
    },
    { key: "started_at", label: tr("When"), render: (r) => dateTimeFmt(r.started_at) },
    {
      key: "duration_seconds",
      label: tr("Duration"),
      className: "num",
      render: (r) => callDuration(r.duration_seconds) || "—",
    },
    { key: "status", label: tr("Outcome"), render: (r) => callOutcome(r, r.caller_id === me) },
    {
      key: "summary",
      label: tr("Summary"),
      render: (r) => {
        const badge = summaryBadge(r, r.caller_id === me);
        return (
          <span className="flex flex-wrap gap-1">
            {badge && (
              <Pill tone={badge.tone}>
                <span>{badge.label}</span>
              </Pill>
            )}
            <CallStatePill state={r.transcription_state} />
          </span>
        );
      },
    },
  ];

  return (
    <ListPage
      title={tr("Calls")}
      description={tr("Your calls, newest first. Open one to review its summary and transcript.")}
      action={
        <Link to="/settings/calls" className="text-sm text-primary-ink hover:underline">
          {tr("Call settings")}
        </Link>
      }
      columns={columns}
      rows={rows}
      error={error}
      loading={loading}
      rowKey={(r) => r.call_id}
      onRowClick={openRecord}
      empty={{
        title: tr("No calls yet"),
        hint: tr("Start a call from the phone icon on a direct conversation."),
      }}
    >
      {sheetId && (
        <CallRecordModal
          id={sheetId}
          title={sheetRecord ? peerOf(sheetRecord, me) : null}
          onClose={closeSheet}
        />
      )}
    </ListPage>
  );
}
