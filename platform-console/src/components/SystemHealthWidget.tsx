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
import { errorsApi, type ErrorStats } from "@/lib/errors-api";
import { can } from "@/lib/api";

export function SystemHealthWidget() {
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!can("errors.read")) return;
    errorsApi
      // Whole 24h window, all statuses — "errors today" counts what happened,
      // not what is still outstanding.
      .stats({ status: "all", from: new Date(Date.now() - 86_400_000).toISOString() })
      .then(setStats)
      .catch(() => setFailed(true));
  }, []);

  if (failed || !can("errors.read")) return null;

  const today = stats?.today ?? null;
  const fatal = stats?.fatal ?? 0;

  // Status is derived from what we can actually observe. Claiming "All systems
  // operational" from a green constant would be worse than showing nothing.
  const status =
    today === null ? { label: "Checking…", tone: "var(--ink-3)" }
      : fatal > 0 ? { label: "Degraded", tone: "var(--bad, #991B1B)" }
      : today > 0 ? { label: "Errors logged", tone: "var(--warn, #854D0E)" }
      : { label: "All systems operational", tone: "var(--ok, #166534)" };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="hd">
        <h3 style={{ fontSize: 15 }}>System health</h3>
        <Link to="/error-center" className="btn-link">Error Center →</Link>
      </div>
      <div className="bd">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12 }}>
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
      </div>
    </div>
  );
}

function Metric({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 21, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: tone || "var(--ink-1)", lineHeight: 1.1 }}>
        {value}
      </div>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", marginTop: 3 }}>
        {label}
      </div>
    </div>
  );
}
