import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { platform } from "@/lib/api";
import type { AuditRow } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { fmtDateTime } from "@/lib/format";
import { Empty, Loading, PageHeader } from "@/components/ui";

export function Audit() {
  const { data, loading, error } = useAsync<AuditRow[]>(() => platform.audit({ limit: 300 }) as Promise<AuditRow[]>);
  const [q, setQ] = useState("");
  const rows = data || [];

  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((a) =>
      [a.action, a.tenant_slug, a.actor_name, a.actor_email, a.entity_ref].some((x) => String(x || "").toLowerCase().includes(f)),
    );
  }, [rows, q]);

  return (
    <>
      <PageHeader title="Audit trail" desc="Every provisioning, feature and lifecycle action taken from this console (append-only, Watch-the-Watcher)." />
      {loading ? (
        <Loading />
      ) : error ? (
        <Empty>Couldn’t load the audit trail — {error.message}</Empty>
      ) : rows.length === 0 ? (
        <Empty>No platform actions recorded yet.</Empty>
      ) : (
        <>
          <div className="toolbar">
            <input className="search" placeholder="Filter by action, tenant, actor…" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="muted">{shown.length} of {rows.length}</span>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr><th>When</th><th>Action</th><th>Tenant</th><th>Actor</th><th>Ref</th><th>Details</th></tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.audit_id}>
                    <td className="dim" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(a.created_at)}</td>
                    <td><span className="mono">{a.action}</span></td>
                    <td>{a.tenant_slug ? <Link to={"/tenants/" + a.tenant_slug} className="mono" style={{ color: "var(--brand-2)" }}>{a.tenant_slug}</Link> : <span className="muted">—</span>}</td>
                    <td className="dim">{a.actor_name || a.actor_email || "—"}</td>
                    <td className="mono dim">{a.entity_ref || "—"}</td>
                    <td className="dim" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.payload && Object.keys(a.payload).length > 0 ? (
                        <span className="mono" style={{ fontSize: 12 }}>{JSON.stringify(a.payload)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={6} className="empty">No matches.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
