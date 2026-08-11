import { useState } from "react";
import { ops, canOperate, ago, type HostAvailability, type UptimeIncident, type ProbeTarget } from "@/lib/ops-api";
import { useAsync } from "@/lib/useAsync";
import { fmtDateTime } from "@/lib/format";
import { Button, Card, Empty, Loading, PageHeader, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { OpsNav } from "./OpsNav";

/**
 * WS-U1 — per-host availability and the incident list.
 *
 * The honest caveat is rendered on the page, not buried in a doc: availability
 * is only as trustworthy as the prober's vantage point. The in-process sweep
 * cannot observe the case where the API process itself is down — it is not
 * running to notice — so the banner tells the operator which prober produced
 * these numbers. A 100% figure from a prober that shares a fate with the thing
 * it measures is not 100%.
 */

const WINDOWS = [7, 30, 90];

const pct = (a: HostAvailability): number | null => a.availability_pct;

function tone(p: number | null): "ok" | "warn" | "bad" | "mute" {
  if (p === null) return "mute";
  if (p >= 99.5) return "ok";
  if (p >= 98) return "warn";
  return "bad";
}

export function OpsUptime() {
  const { toast, fail } = useToast();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);

  const avail = useAsync<HostAvailability[]>(() => ops.availability(days), [days]);
  const incidents = useAsync<UptimeIncident[]>(() => ops.incidents(days), [days]);
  const targets = useAsync<ProbeTarget[]>(() => ops.probeTargets());

  const probe = () => {
    setBusy(true);
    ops.probeNow()
      .then((r) => { toast(`Probed ${r.probed} host${r.probed === 1 ? "" : "s"} — ${r.down} down`); avail.reload(); incidents.reload(); })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const rows = (avail.data || []).slice().sort((a, b) => (pct(a) ?? 101) - (pct(b) ?? 101));

  return (
    <>
      <PageHeader
        title="Uptime"
        desc="Per-host availability from the external probe, with the incidents behind the number."
        actions={canOperate() ? <Button variant="primary" loading={busy} onClick={probe}>Probe now</Button> : undefined}
      />
      <OpsNav />

      <div className="banner info" style={{ marginBottom: 12 }}>
        Availability is only as good as where the probe runs from. Run <span className="mono">scripts/ops/uptime-probe.js</span> as
        its own process (or the <span className="mono">uptime-probe</span> compose service) so a probe failure means the host is
        genuinely unreachable, not that the API measuring itself went down with it.
      </div>

      <div className="toolbar">
        {WINDOWS.map((d) => (
          <Button key={d} size="sm" variant={d === days ? "primary" : "ghost"} onClick={() => setDays(d)}>
            {d} days
          </Button>
        ))}
        <span className="muted">{targets.data?.length ?? 0} host{(targets.data?.length ?? 0) === 1 ? "" : "s"} in rotation</span>
      </div>

      {avail.loading ? (
        <Loading />
      ) : avail.error ? (
        <Empty>Couldn’t load availability — {avail.error.message}</Empty>
      ) : rows.length === 0 ? (
        <Empty>
          No samples recorded. Start the uptime probe — until it runs, every host on this page is unmonitored,
          which is not the same as healthy.
        </Empty>
      ) : (
        <Card title={`Availability · last ${days} days`}>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr><th>Host</th><th>Availability</th><th>Samples</th><th>Missed</th><th>Avg latency</th><th>Last probe</th></tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const p = pct(a);
                  // Expected minus recorded: probes that should have run and did
                  // not. These count as down in the percentage, so showing them
                  // separately is what makes a surprising number explainable.
                  const missed = Math.max(0, a.expected - a.recorded);
                  return (
                    <tr key={a.host}>
                      <td className="mono">{a.host}</td>
                      <td><Pill tone={tone(p)}>{p === null ? "—" : `${p.toFixed(2)}%`}</Pill></td>
                      <td className="muted">
                        {a.up_samples}/{a.expected}
                        {a.recorded - a.up_samples > 0 && <span> · {a.recorded - a.up_samples} down</span>}
                      </td>
                      <td>{missed > 0 ? <Pill tone="warn">{missed}</Pill> : <span className="muted">—</span>}</td>
                      <td className="muted">{a.avg_latency_ms != null ? `${a.avg_latency_ms}ms` : "—"}</td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{ago(a.last_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title={`Incidents · last ${days} days`} style={{ marginTop: 16 }}>
        {incidents.loading ? (
          <Loading />
        ) : (incidents.data || []).length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>No incidents recorded in this window.</div>
        ) : (
          <div className="tbl-wrap" style={{ maxHeight: 380, overflow: "auto" }}>
            <table>
              <thead><tr><th>Host</th><th>Started</th><th>Until</th><th>Duration</th><th>Probes</th><th>Error</th></tr></thead>
              <tbody>
                {(incidents.data || []).map((i, n) => (
                  <tr key={n}>
                    <td className="mono">{i.host}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(i.from)}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {i.resolved ? fmtDateTime(i.until) : <Pill tone="bad">ongoing</Pill>}
                    </td>
                    <td className="muted">{i.duration_minutes}m</td>
                    <td className="muted">{i.samples}</td>
                    <td className="muted" style={{ fontSize: 12, maxWidth: 320 }} title={i.error || ""}>
                      {(i.error || "").slice(0, 80) || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
