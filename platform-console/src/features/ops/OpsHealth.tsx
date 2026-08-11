import { useMemo, useState } from "react";
import { ops, canOperate, ago, type FleetHealth, type HealthStatus, type TenantHealth } from "@/lib/ops-api";
import { useAsync } from "@/lib/useAsync";
import { fmtDateTime } from "@/lib/format";
import { Button, Card, Empty, Loading, Modal, PageHeader, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { OpsNav } from "./OpsNav";

/**
 * WS-H1 / WS-H2 — the fleet grid.
 *
 * The failure this screen exists for is the one fleet-wide metrics are
 * structurally blind to: the process is up, thirty-nine tenants are fine, and
 * one tenant's database is wedged. So the default sort is worst-first, and a
 * tenant the collector has never sampled is shown as UNKNOWN rather than being
 * quietly absent — an unmonitored tenant looks exactly like a healthy one if you
 * only render the rows that have data.
 */

const TONE: Record<string, "ok" | "warn" | "bad" | "mute"> = {
  GREEN: "ok",
  AMBER: "warn",
  RED: "bad",
};

const RANK: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 3 };
const rankOf = (s: HealthStatus | null) => (s ? (RANK[s] ?? 2) : 2); // unknown sorts above GREEN

export function OpsHealth() {
  const { toast, fail } = useToast();
  const { data, loading, error, reload } = useAsync<FleetHealth>(() => ops.fleetHealth());
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<TenantHealth | null>(null);
  const [q, setQ] = useState("");

  const tenants = useMemo(() => {
    const rows = data?.tenants || [];
    const f = q.trim().toLowerCase();
    return rows
      .filter((t) => !f || t.slug.toLowerCase().includes(f))
      .slice()
      .sort((a, b) => rankOf(a.status) - rankOf(b.status) || a.slug.localeCompare(b.slug));
  }, [data, q]);

  const counts = useMemo(() => {
    const rows = data?.tenants || [];
    return {
      total: rows.length,
      red: rows.filter((t) => t.status === "RED").length,
      amber: rows.filter((t) => t.status === "AMBER").length,
      green: rows.filter((t) => t.status === "GREEN").length,
      unknown: rows.filter((t) => !t.status).length,
    };
  }, [data]);

  const collect = () => {
    setBusy(true);
    ops.collectHealth()
      .then((r) => { toast(`Collected — ${r.green} green, ${r.amber} amber, ${r.red} red`); reload(); })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  return (
    <>
      <PageHeader
        title="Fleet health"
        desc="Per-tenant status from the health collector — the signal fleet-wide metrics can't see."
        actions={
          canOperate() ? (
            <Button variant="primary" loading={busy} onClick={collect}>Collect now</Button>
          ) : undefined
        }
      />
      <OpsNav />

      {loading ? (
        <Loading />
      ) : error ? (
        <Empty>Couldn’t load fleet health — {error.message}</Empty>
      ) : counts.total === 0 ? (
        <Empty>No tenants yet.</Empty>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 16 }}>
            <Stat n={counts.total} l="Tenants" />
            <Stat n={counts.red} l="Red" tone={counts.red ? "bad" : undefined} />
            <Stat n={counts.amber} l="Amber" tone={counts.amber ? "warn" : undefined} />
            <Stat n={counts.green} l="Green" tone="ok" />
            <Stat n={counts.unknown} l="Never sampled" tone={counts.unknown ? "warn" : undefined} />
          </div>

          {counts.unknown > 0 && (
            <div className="banner warn" style={{ marginBottom: 12 }}>
              {counts.unknown} tenant{counts.unknown === 1 ? " has" : "s have"} never been sampled by the
              health collector. A tenant with no data is not a healthy tenant — check that the ops sweep
              is scheduled.
            </div>
          )}

          <div className="toolbar">
            <input className="search" placeholder="Filter by slug…" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="muted">{tenants.length} of {counts.total}</span>
          </div>

          <Card>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tenant</th><th>Status</th><th>Why</th><th>Liveness</th>
                    <th>Pool</th><th>Schema</th><th>Jobs failed 24h</th><th>Sampled</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.tenant_id} style={{ cursor: "pointer" }} onClick={() => setDetail(t)}>
                      <td className="mono">{t.slug}</td>
                      <td><Pill tone={TONE[t.status || ""] || "mute"}>{t.status || "Unknown"}</Pill></td>
                      <td className="muted" style={{ fontSize: 12, maxWidth: 280 }}>
                        {(t.reasons || []).join(" · ") || (t.status === "GREEN" ? "—" : "no reason recorded")}
                      </td>
                      <td>
                        {t.liveness_ok === null ? "—" : t.liveness_ok
                          ? <span className="muted">{t.liveness_ms}ms</span>
                          : <Pill tone="bad">failed</Pill>}
                      </td>
                      <td className="muted">
                        {t.pool_total === null ? "—" : `${t.pool_idle ?? 0}/${t.pool_total}`}
                        {(t.pool_waiting ?? 0) > 0 && <Pill tone="warn"> {t.pool_waiting} waiting</Pill>}
                      </td>
                      <td>
                        {t.schema_unreachable ? <Pill tone="bad">unreachable</Pill>
                          : (t.schema_behind ?? 0) > 0 ? <Pill tone="warn">{t.schema_behind} behind</Pill>
                          : <span className="muted">current</span>}
                      </td>
                      <td className={(t.jobs_failed_24h ?? 0) > 0 ? "" : "muted"}>{t.jobs_failed_24h ?? "—"}</td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{ago(t.captured_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {detail && <HistoryModal tenant={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

/** Drill-down: the last 24h of samples for one tenant. */
function HistoryModal({ tenant, onClose }: { tenant: TenantHealth; onClose: () => void }) {
  const [hours, setHours] = useState(24);
  const { data, loading, error } = useAsync<TenantHealth[]>(
    () => ops.tenantHealth(tenant.tenant_id, hours),
    [tenant.tenant_id, hours],
  );
  const rows = data || [];

  return (
    <Modal title={<span className="row" style={{ gap: 8 }}><span className="mono">{tenant.slug}</span> health history</span>} onClose={onClose} maxWidth={720}>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        {[6, 24, 72, 168].map((h) => (
          <Button key={h} size="sm" variant={h === hours ? "primary" : "ghost"} onClick={() => setHours(h)}>
            {h < 24 ? `${h}h` : `${h / 24}d`}
          </Button>
        ))}
      </div>

      {loading ? <Loading /> : error ? (
        <div className="muted">Couldn’t load history — {error.message}</div>
      ) : rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>No samples in this window.</div>
      ) : (
        <>
          <StatusStrip rows={rows} />
          <div className="tbl-wrap" style={{ maxHeight: 320, overflow: "auto", marginTop: 12 }}>
            <table>
              <thead><tr><th>When</th><th>Status</th><th>Liveness</th><th>Why</th></tr></thead>
              <tbody>
                {rows.slice().reverse().map((r, i) => (
                  <tr key={i}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.captured_at)}</td>
                    <td><Pill tone={TONE[r.status || ""] || "mute"}>{r.status}</Pill></td>
                    <td className="muted">{r.liveness_ok === false ? "failed" : r.liveness_ms != null ? `${r.liveness_ms}ms` : "—"}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{(r.reasons || []).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

/**
 * A status timeline as coloured blocks. Deliberately not a line chart: the value
 * being plotted is categorical (three states), and the question is "when did it
 * change colour", which a strip answers at a glance and a line chart obscures.
 */
function StatusStrip({ rows }: { rows: TenantHealth[] }) {
  const colour = (s: HealthStatus | null) =>
    s === "GREEN" ? "var(--ok)" : s === "AMBER" ? "var(--warn)" : s === "RED" ? "var(--bad)" : "var(--line-2)";
  return (
    <div>
      <div className="f" style={{ marginBottom: 6 }}>Timeline (oldest → newest)</div>
      <div style={{ display: "flex", gap: 1, height: 26, borderRadius: 6, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <div
            key={i}
            title={`${r.status} · ${fmtDateTime(r.captured_at)}${(r.reasons || []).length ? "\n" + (r.reasons || []).join("\n") : ""}`}
            style={{ flex: 1, minWidth: 2, background: colour(r.status) }}
          />
        ))}
      </div>
    </div>
  );
}

function Stat({ n, l, tone }: { n: number; l: string; tone?: "ok" | "bad" | "warn" }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : "var(--ink)";
  return (
    <div className="stat">
      <div className="n" style={{ color }}>{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}
