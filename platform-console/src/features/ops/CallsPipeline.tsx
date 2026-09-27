import { ops, ago, type CommsCanary } from "@/lib/ops-api";
import { useAsync } from "@/lib/useAsync";
import { fmtDateTime } from "@/lib/format";
import { Card, Empty, Loading, Pill } from "@/components/ui";

/**
 * Health → Calls pipeline (calls audit PR-7, O5).
 *
 * The daily platform call check: the queue and worker, the live-signal
 * emitter, the scheduler, each transcription and summary provider (each forced
 * in turn), the TURN relay, and the cheap per-tenant checks. It runs on its
 * own daytime schedule and spends provider credit, so there is no "run now"
 * here; a failure and the recovery after it also land on the bell.
 *
 * Console only by design: tenants never see this, and a tenant's own run
 * lives in their Comms → Setup → Test calls.
 */
export function CallsPipeline() {
  const { data, loading, error } = useAsync<CommsCanary>(() => ops.commsCanary());
  const latest = data?.latest || null;
  const failedTenants = (latest?.tenant_checks || []).filter((t) => !t.ok);

  return (
    <Card
      title="Calls pipeline"
      actions={latest ? <Pill tone={latest.status === "PASSED" ? "ok" : "bad"}>{latest.status === "PASSED" ? "Passing" : "Failing"}</Pill> : undefined}
      style={{ marginTop: 16 }}
    >
      {loading ? (
        <Loading />
      ) : error ? (
        <Empty>Couldn’t load the call check — {error.message}</Empty>
      ) : !latest ? (
        <Empty>
          The daily call check has not run yet. It runs once a day at a daytime hour
          (COMMS_CALL_CANARY_CRON); a worker must be running for it to start.
        </Empty>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Last run {fmtDateTime(latest.started_at)} ({ago(latest.started_at)}).
          </p>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr><th>Check</th><th>Result</th><th>Time</th><th>Why</th></tr>
              </thead>
              <tbody>
                {latest.checks.map((c) => (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    <td><Pill tone={c.ok ? "ok" : "bad"}>{c.ok ? "OK" : "Failed"}</Pill></td>
                    <td className="muted">{c.ms === null ? "—" : `${Math.round(c.ms)} ms`}</td>
                    <td className="muted" style={{ fontSize: 12, maxWidth: 360 }}>{c.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 13, margin: "16px 0 6px" }}>
            Tenants — {latest.tenant_checks.length - failedTenants.length} of {latest.tenant_checks.length} environments clean
          </h3>
          {failedTenants.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Every tenant database answered; no call stuck past its deadline; no transcript stuck in processing.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {failedTenants.map((t) => (
                <li key={`${t.slug}-${t.env}`}>
                  <span className="mono">{t.slug}</span> ({t.env}): {t.problems.join("; ")}
                </li>
              ))}
            </ul>
          )}

          {data && data.history.length > 1 && (
            <>
              <h3 style={{ fontSize: 13, margin: "16px 0 6px" }}>Last {data.history.length} days</h3>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }} aria-label="Daily results, newest first">
                {data.history.map((h) => (
                  <span
                    key={h.run_id}
                    title={`${fmtDateTime(h.started_at)} — ${h.status === "PASSED" ? "passed" : `failed: ${h.failed.join(", ") || "tenant checks"}`}`}
                  >
                    <Pill tone={h.status === "PASSED" ? "ok" : "bad"}>{h.status === "PASSED" ? "✓" : "✗"}</Pill>
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}
