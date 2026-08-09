/**
 * Overview page health widget — spec §8.2.
 *
 * Deliberately MINIMAL. The spec's placement table is explicit that Overview
 * shows only uptime and error rate, and that the full KPI set belongs on the
 * Error Center. Duplicating the KPI row here would give two pages that disagree
 * the moment their queries drift, and would bury the tenant summary that is the
 * actual point of Overview.
 *
 * Fails quietly: an admin whose role lacks `errors.read` gets a 403 from the
 * stats endpoint, and this renders nothing rather than an error card on a page
 * that is otherwise fine.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { errorsApi, ago, type ErrorStats, type HealthSummary } from "@/lib/errors-api";
import { can } from "@/lib/api";

/** "over the last 6 hours" / "30d" — see `measured_from` in HealthSummary. */
function coverage(h: HealthSummary): string {
  if (!h.measured_from) return `${h.window_days}d`;
  const hours = (Date.now() - new Date(h.measured_from).getTime()) / 3_600_000;
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function SystemHealthWidget() {
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!can("errors.read")) return;
    errorsApi
      // Whole 24h window, all statuses — "errors today" counts what happened,
      // not what is still outstanding.
      .stats({ status: "all", from: new Date(Date.now() - 86_400_000).toISOString() })
      .then(setStats)
      .catch(() => setFailed(true));
    // Independent of stats: uptime is a different measurement with a different
    // failure mode, and a missing collector must not blank the error counts.
    errorsApi.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  if (failed || !can("errors.read")) return null;

  const today = stats?.today ?? null;
  const fatal = stats?.fatal ?? 0;

  /**
   * STATUS DESCRIBES NOW. That is the whole fix.
   *
   * This read `fatal > 0 → "Degraded"`, and `fatal` counts every fatal in the
   * last 24h whether or not anyone fixed it. So the card sat there reading
   *
   *     100.00% UPTIME · 5 ERRORS TODAY · 2 FATAL (24H) · 100% RESOLVED · Degraded
   *
   * — self-contradictory on its own face: full uptime, everything resolved, and
   * a red light. A status that will not go back to green after the work is done
   * is one people stop reading, which is the same failure mode as a muted alert
   * channel: the indicator survives, the information does not.
   *
   * `fatal_active` and `active` are the open counts. `fatal` stays on the KPI
   * card beside it, where "2 fatal in 24h" is exactly the right number.
   *
   * Order still matters. "All systems operational" inferred from an absence of
   * errors is a claim about our own logging, not about the platform — a process
   * that is down logs nothing and would read as perfectly healthy. A MEASURED
   * outage therefore outranks a quiet feed.
   */
  const fatalActive = stats?.fatal_active ?? 0;
  const active = stats?.active ?? 0;
  const outages = health && health.uptime_percent !== null && health.incidents ? health.incidents.length : 0;

  const status =
    outages > 0
      ? { label: `${outages} outage${outages === 1 ? "" : "s"} in ${coverage(health as HealthSummary)}`, tone: "var(--bad, #991B1B)" }
      : today === null ? { label: "Checking…", tone: "var(--ink-3)" }
        : fatalActive > 0 ? { label: "Degraded", tone: "var(--bad, #991B1B)" }
          : active > 0 ? { label: "Errors logged", tone: "var(--warn, #854D0E)" }
            // Everything that happened has been dealt with. Distinct from a
            // genuinely quiet window, because "we had five and fixed them all"
            // and "nothing happened" are different facts about the day.
            : today > 0 ? { label: "Recovered — all resolved", tone: "var(--ok, #166534)" }
              : { label: "All systems operational", tone: "var(--ok, #166534)" };

  // Never fabricate a figure. `collector: "disabled"` and "no samples yet" are
  // different answers from "100%", and conflating them is exactly why migration
  // 0090 refused to create a metrics table with no producer.
  //
  // Pulled into a single local so the null check narrows once. Repeating
  // `health?.uptime_percent !== null` at each use reads as safe and does not
  // narrow `health.uptime_percent` for TypeScript at the comparison below.
  const pct = health && health.uptime_percent !== null ? health.uptime_percent : null;
  const uptimeValue = pct === null ? "—" : `${pct.toFixed(2)}%`;
  const uptimeLabel =
    !health || health.collector === "disabled" ? "Uptime (off)"
      : pct === null ? "Uptime (no data)"
        : `Uptime (${coverage(health)})`;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="hd">
        <h3 style={{ fontSize: 15 }}>System health</h3>
        <Link to="/error-center" className="btn-link">Error Center →</Link>
      </div>
      <div className="bd">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 12 }}>
          <Metric
            value={uptimeValue}
            label={uptimeLabel}
            tone={pct !== null && pct < 99 ? "var(--warn, #854D0E)" : undefined}
            title={
              health && pct !== null
                ? `${health.samples} of ${health.expected_samples} expected samples healthy. A missing sample counts as downtime.`
                : undefined
            }
          />
          <Metric
            value={today === null ? "—" : String(today)}
            label="Errors today"
            tone={fatal > 0 ? "var(--bad, #991B1B)" : undefined}
          />
          <Metric value={stats ? String(stats.fatal) : "—"} label="Fatal (24h)" tone={fatal > 0 ? "var(--bad, #991B1B)" : undefined} />
          <Metric value={stats ? `${stats.resolved_rate}%` : "—"} label="Resolved" />
          <div>
            <div className="row" style={{ gap: 6, alignItems: "center" }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: status.tone, display: "inline-block" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: status.tone }}>{status.label}</span>
            </div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", marginTop: 4 }}>
              Status
            </div>
          </div>
        </div>

        {/*
          Appendix A.5. The only failure in this module the dashboard cannot
          show you as a wrong number — a broken capture path renders a clean,
          empty, GREEN feed, and "zero errors" reads as "everything is fine".
          So it gets a banner rather than a metric: the point is to interrupt
          someone who is being reassured by silence.
        */}
        {health?.capture?.stale && (
          <div
            style={{
              marginTop: 12, padding: "8px 10px", borderRadius: 8, fontSize: 11.5,
              background: "#FEF9C3", color: "#854D0E", border: "1px solid #FDE047",
            }}
          >
            ⚠ No errors captured in {health.capture.quiet_hours}h while the platform was up.
            Either it has been a genuinely quiet day, or error capture has stopped —
            those look identical here. Last error{" "}
            {health.capture.last_error_at ? ago(health.capture.last_error_at) : "never"}.
          </div>
        )}

        {health && health.p95_db_latency_ms !== null && (
          <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
            Database p95 {health.p95_db_latency_ms}ms
            {health.avg_db_latency_ms !== null ? ` · avg ${health.avg_db_latency_ms}ms` : ""}
            {health.degraded_samples > 0 ? ` · ${health.degraded_samples} degraded samples` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ value, label, tone, title }: { value: string; label: string; tone?: string; title?: string }) {
  return (
    <div title={title}>
      <div style={{ fontSize: 21, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: tone || "var(--ink-1)", lineHeight: 1.1 }}>
        {value}
      </div>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", marginTop: 3 }}>
        {label}
      </div>
    </div>
  );
}
