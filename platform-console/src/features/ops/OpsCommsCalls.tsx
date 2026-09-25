import { useState } from "react";
import { ops, type CommsCalls, type CommsTenantRow } from "@/lib/ops-api";
import { useAsync } from "@/lib/useAsync";
import { fmtDateTime } from "@/lib/format";
import { Card, Empty, Loading, PageHeader, Pill } from "@/components/ui";
import { OpsNav } from "./OpsNav";

/**
 * WS-C3 — call health (Smart Comms PR-3, §7.2/§7.4.4).
 *
 * WHAT THIS SCREEN IS FOR. The calls programme's promises are promises about a
 * person standing in a yard with a phone: the ring reaches them, the call holds,
 * and the transcript survives. Two of those are invisible from the outside —
 * a ring that never landed looks exactly like a person who did not answer, and
 * a transcript that fell back to the browser looks exactly like one that went
 * through the provider. This screen is where those two become a number.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not have a "collect now" button.
 * The numbers come from each tenant's own database, aggregated once a night by
 * a job (services/platform/comms-metrics.service.js); a button here would mean a
 * cross-tenant fan-out on a page load, which is the query shape that once took
 * the fleet down. The `computed_at` line says how fresh the answer is instead,
 * and a stale answer is visible rather than silently re-queried.
 *
 * THE THREE QUESTIONS THE TILES ANSWER, in the order an operator asks them:
 *
 *   1. Is the RING working?  → the ring-channel split. `none` is the alarming
 *      column: nobody's device acknowledged, which on a fleet with working push
 *      subscriptions means the ring is not reaching people.
 *   2. Are calls CONNECTING? → answered vs started vs failed, kept apart.
 *   3. Is the TRANSCRIPT surviving? → TRANSCRIPTION_FAILED *with its reasons*,
 *      and the threshold the alarm is actually using, so the operator can see
 *      whether the number in front of them is already over the line.
 */

const WINDOWS = [7, 30, 90];

/**
 * `comms_call.end_reason` in operator words (FN-2). `hangup` is the healthy
 * majority and is shown for scale; the other three are the signal, because
 * each names a different fault:
 *
 *   disconnected  the liveness sweep ended it — both devices unreachable
 *   ice_failed    the media path never came back; often a missing TURN relay
 *   max_duration  the 30-minute cap, which is a product question, not a fault
 */
const END_REASON_LABEL: Record<string, string> = {
  hangup: "Somebody hung up",
  disconnected: "Both devices lost connection",
  ice_failed: "Audio path failed",
  max_duration: "Hit the 30-minute cap",
  "reason not recorded": "Reason not recorded",
};

/** The endings nobody chose: what an operator is actually looking for. */
const UNCHOSEN = new Set(["disconnected", "ice_failed"]);

function dur(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

/** The ring split as one honest stacked bar; the labels carry the numbers, so
 *  the colour is never the only signal. */
function RingSplit({ rings }: { rings: { socket: number; notification: number; push: number; none: number } }) {
  const total = rings.socket + rings.notification + rings.push + rings.none;
  if (!total) return <span className="muted">no rings in this window</span>;
  const parts = [
    { key: "socket", label: "in-app", n: rings.socket, color: "var(--ok)" },
    { key: "notification", label: "notification", n: rings.notification, color: "var(--brand-blue, #2f6fd0)" },
    { key: "push", label: "push", n: rings.push, color: "var(--warn)" },
    { key: "none", label: "no ack", n: rings.none, color: "var(--bad)" },
  ].filter((p) => p.n > 0);
  return (
    <div>
      <div className="row" style={{ height: 8, borderRadius: 4, overflow: "hidden", gap: 0, background: "var(--line, #e5e7eb)" }}>
        {parts.map((p) => (
          <span key={p.key} style={{ width: `${(p.n / total) * 100}%`, background: p.color, display: "block" }} />
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {parts.map((p) => `${p.label} ${p.n} (${pct(p.n, total)})`).join(" · ")}
      </div>
    </div>
  );
}

export function OpsCommsCalls() {
  const [days, setDays] = useState(30);
  const q = useAsync<CommsCalls>(() => ops.commsCalls(days), [days]);

  const data = q.data;
  const fleet = data?.fleet;
  const overThreshold = Boolean(
    data && fleet && fleet.transcription_failed >= data.alert.threshold,
  );

  return (
    <>
      <PageHeader
        title="Comms calls"
        desc="Call health across the fleet: rings that reached people, calls that connected, and transcripts that survived."
      />
      <OpsNav />

      <div className="banner info" style={{ marginBottom: 12 }}>
        Aggregated nightly from each tenant's own database
        {fleet?.last_computed_at ? ` — last computed ${fmtDateTime(fleet.last_computed_at)}` : ""}.
        A call that was never answered is counted as an answer outcome, not a failure: the
        ring column is where "did it reach them" is answered.
      </div>

      <div className="toolbar">
        {WINDOWS.map((d) => (
          <button
            key={d}
            className={"btn sm " + (d === days ? "" : "ghost")}
            onClick={() => setDays(d)}
          >
            {d} days
          </button>
        ))}
      </div>

      {q.loading && !data ? (
        <Loading />
      ) : q.error ? (
        <Empty>Could not read the call metrics: {q.error.message}</Empty>
      ) : !fleet || (fleet.started === 0 && fleet.transcription_failed === 0) ? (
        <Empty>No calls recorded in this window.</Empty>
      ) : (
        <>
          <div className="grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
            <Card title="Calls started">
              <div style={{ fontSize: 28, fontWeight: 600 }}>{fleet.started}</div>
              <div className="muted" style={{ fontSize: 12 }}>{fleet.answered} answered ({pct(fleet.answered, fleet.started)})</div>
            </Card>
            <Card title="Average duration">
              <div style={{ fontSize: 28, fontWeight: 600 }}>{dur(fleet.avg_duration_seconds)}</div>
              <div className="muted" style={{ fontSize: 12 }}>across answered calls</div>
            </Card>
            <Card title="Failed calls">
              <div style={{ fontSize: 28, fontWeight: 600 }}>{fleet.failed}</div>
              <div className="muted" style={{ fontSize: 12 }}>ICE never connected</div>
            </Card>
            <Card
              title="Transcription fell back"
              actions={
                <Pill tone={overThreshold ? "bad" : fleet.transcription_failed ? "warn" : "ok"}>
                  {overThreshold ? "over threshold" : "below threshold"}
                </Pill>
              }
            >
              <div style={{ fontSize: 28, fontWeight: 600 }}>{fleet.transcription_failed}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                alarm at {data?.alert.threshold} per {data?.alert.window_hours}h (
                {data?.alert.source})
              </div>
            </Card>
          </div>

          <Card title="How the ring reached people" style={{ marginBottom: 16 }}>
            <RingSplit rings={{
              socket: fleet.ring_socket,
              notification: fleet.ring_notification,
              push: fleet.ring_push,
              none: fleet.ring_none,
            }} />
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              The split is built from the callee's own acknowledgement of the ring, so it says
              which channel a device actually got — not which channel the server sent to.
              Push is the last tier: a healthy fleet shows it low, a fleet with closed apps
              shows it carrying the load.
            </div>
          </Card>

          {Object.keys(fleet.end_reasons || {}).length > 0 && (
            <Card title="How answered calls ended" style={{ marginBottom: 16 }}>
              <table className="table">
                <thead>
                  <tr><th>Ending</th><th style={{ textAlign: "right" }}>Calls</th><th style={{ textAlign: "right" }}>Share</th></tr>
                </thead>
                <tbody>
                  {Object.entries(fleet.end_reasons)
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, n]) => (
                      <tr key={reason}>
                        <td>
                          {END_REASON_LABEL[reason] || reason}
                          {UNCHOSEN.has(reason) && n > 0 && <> <Pill tone="warn">look</Pill></>}
                        </td>
                        <td style={{ textAlign: "right" }}>{n}</td>
                        <td style={{ textAlign: "right" }}>
                          {pct(n, Object.values(fleet.end_reasons).reduce((a, b) => a + b, 0))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Answered calls only — a ring that timed out is counted in Started, not here.
                A rising <strong>Audio path failed</strong> across tenants usually means no TURN
                relay is configured, so calls between mobile networks cannot connect. A rising
                <strong> Both devices lost connection</strong> is a network or socket problem
                rather than a media one.
              </div>
            </Card>
          )}

          {Object.keys(fleet.reasons || {}).length > 0 && (
            <Card title="Why the transcript fell back" style={{ marginBottom: 16 }}>
              <table className="table">
                <thead>
                  <tr><th>Reason</th><th style={{ textAlign: "right" }}>Calls</th></tr>
                </thead>
                <tbody>
                  {Object.entries(fleet.reasons)
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, n]) => (
                      <tr key={reason}>
                        <td>{reason}</td>
                        <td style={{ textAlign: "right" }}>{n}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          )}

          <Card title="Per tenant" style={{ marginBottom: 16 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Env</th>
                  <th style={{ textAlign: "right" }}>Started</th>
                  <th style={{ textAlign: "right" }}>Answered</th>
                  <th style={{ textAlign: "right" }}>Avg</th>
                  <th style={{ textAlign: "right" }}>Failed</th>
                  <th style={{ textAlign: "right" }}>Fell back</th>
                  <th>Ring</th>
                </tr>
              </thead>
              <tbody>
                {(data?.tenants || []).map((t: CommsTenantRow) => (
                  <tr key={t.tenant_slug}>
                    <td className="mono">{t.tenant_slug}</td>
                    <td>{t.envs.join(", ")}</td>
                    <td style={{ textAlign: "right" }}>{t.started}</td>
                    <td style={{ textAlign: "right" }}>{t.answered} ({pct(t.answered, t.started)})</td>
                    <td style={{ textAlign: "right" }}>{dur(t.avg_duration_seconds)}</td>
                    <td style={{ textAlign: "right" }}>{t.failed}</td>
                    <td style={{ textAlign: "right" }}>{t.transcription_failed}</td>
                    <td style={{ minWidth: 220 }}><RingSplit rings={t.rings} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title={`Daily (${fleet.series.length} day${fleet.series.length === 1 ? "" : "s"})`}>
            <table className="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th style={{ textAlign: "right" }}>Started</th>
                  <th style={{ textAlign: "right" }}>Answered</th>
                  <th style={{ textAlign: "right" }}>Failed</th>
                  <th style={{ textAlign: "right" }}>Fell back</th>
                </tr>
              </thead>
              <tbody>
                {fleet.series.slice().reverse().map((d) => (
                  <tr key={d.date}>
                    <td className="mono">{d.date}</td>
                    <td style={{ textAlign: "right" }}>{d.started}</td>
                    <td style={{ textAlign: "right" }}>{d.answered}</td>
                    <td style={{ textAlign: "right" }}>{d.failed}</td>
                    <td style={{ textAlign: "right" }}>{d.transcription_failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
