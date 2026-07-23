import { useMemo } from "react";
import { Link } from "react-router-dom";
import { platform } from "@/lib/api";
import type { AuditRow, TenantListRow } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { fmtDateTime, titleCase } from "@/lib/format";
import { Card, Empty, Loading, PageHeader, Pill } from "@/components/ui";

export function Overview() {
  const tenants = useAsync<TenantListRow[]>(() => platform.tenants() as Promise<TenantListRow[]>);
  const audit = useAsync<AuditRow[]>(() => platform.audit({ limit: 12 }) as Promise<AuditRow[]>);

  const rows = tenants.data || [];
  const stats = useMemo(() => {
    const by = (s: string) => rows.filter((r) => String(r.status || "").toUpperCase() === s).length;
    const planDist: Record<string, number> = {};
    for (const r of rows) {
      const p = r.plan || "—";
      planDist[p] = (planDist[p] || 0) + 1;
    }
    return {
      total: rows.length,
      live: rows.filter((r) => r.is_live).length,
      suspended: by("SUSPENDED"),
      provisioning: by("PROVISIONING"),
      overrides: rows.reduce((n, r) => n + (Number(r.overrides) || 0), 0),
      planDist,
    };
  }, [rows]);

  return (
    <>
      <PageHeader title="Overview" desc="Platform health at a glance across every tenant." />
      {tenants.loading ? (
        <Loading />
      ) : tenants.error ? (
        <Empty>Couldn’t load tenants — {tenants.error.message}</Empty>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 16 }}>
            <Stat n={stats.total} l="Tenants" />
            <Stat n={stats.live} l="Live" tone="ok" />
            <Stat n={stats.suspended} l="Suspended" tone={stats.suspended ? "bad" : undefined} />
            <Stat n={stats.provisioning} l="Provisioning" tone={stats.provisioning ? "warn" : undefined} />
            <Stat n={stats.overrides} l="Feature overrides" />
          </div>

          <div className="grid2">
            <Card title="By plan">
              {Object.keys(stats.planDist).length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>No tenants yet.</div>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  {Object.entries(stats.planDist).sort((a, b) => b[1] - a[1]).map(([plan, n]) => (
                    <div key={plan} className="between">
                      <Pill tone="mute">{plan}</Pill>
                      <span className="dim">{n}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Recent platform activity" actions={<Link to="/audit" className="btn-link">View all →</Link>}>
              {audit.loading ? (
                <Loading />
              ) : (audit.data || []).length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>No activity recorded yet.</div>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {(audit.data || []).slice(0, 8).map((a) => (
                    <div key={a.audit_id} className="between" style={{ gap: 10, alignItems: "baseline" }}>
                      <div style={{ minWidth: 0 }}>
                        <span className="mono" style={{ fontSize: 12.5 }}>{a.action}</span>
                        {a.tenant_slug && <span className="muted" style={{ fontSize: 12 }}> · {a.tenant_slug}</span>}
                      </div>
                      <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{fmtDateTime(a.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ n, l, tone }: { n: number; l: string; tone?: "ok" | "bad" | "warn" }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : "var(--ink)";
  return (
    <div className="stat">
      <div className="n" style={{ color }}>{n}</div>
      <div className="l">{titleCase(l)}</div>
    </div>
  );
}
