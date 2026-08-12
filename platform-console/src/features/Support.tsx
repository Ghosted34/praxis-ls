import { useMemo, useState } from "react";
import { platform } from "@/lib/api";
import { ops, type SupportContext } from "@/lib/ops-api";
import type { SupportTicket, TicketKind, TicketStatus } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { fmtDateTime, titleCase } from "@/lib/format";
import { Button, Empty, Loading, Modal, PageHeader, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";

const LANES: TicketStatus[] = ["NEW", "TRIAGED", "IN_PROGRESS", "SHIPPED", "DECLINED"];
const KINDS: TicketKind[] = ["SUPPORT", "BUG", "FEATURE"];

function kindTone(k: TicketKind) {
  return k === "BUG" ? "bad" : k === "FEATURE" ? "ok" : "info";
}
function statusTone(s: TicketStatus): "mute" | "warn" | "info" | "ok" | "bad" {
  return s === "NEW" ? "warn" : s === "TRIAGED" ? "info" : s === "IN_PROGRESS" ? "info" : s === "SHIPPED" ? "ok" : "bad";
}

export function Support() {
  const { data, loading, error, reload } = useAsync<SupportTicket[]>(() => platform.supportTickets() as Promise<SupportTicket[]>);
  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState("");
  const [active, setActive] = useState<SupportTicket | null>(null);

  const tickets = data || [];
  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase();
    return tickets.filter((t) =>
      (!kind || t.kind === kind) &&
      (!f || [t.title, t.tenant_slug, t.tenant_name, t.raised_by_email].some((x) => String(x || "").toLowerCase().includes(f))),
    );
  }, [tickets, kind, q]);

  const byLane = (s: TicketStatus) => filtered.filter((t) => t.status === s);

  return (
    <>
      <PageHeader title="Support & Feedback" desc="Tenant tickets, bugs and feature requests — triage across every tenant (PRD §11.2)." />

      {loading ? (
        <Loading />
      ) : error ? (
        <Empty>Couldn’t load tickets — {error.message}</Empty>
      ) : (
        <>
          <div className="toolbar">
            <input className="search" placeholder="Search title, tenant, requester…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: "auto" }}>
              <option value="">All kinds</option>
              {KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
            </select>
            <span className="muted">{filtered.length} of {tickets.length}</span>
          </div>

          {tickets.length === 0 ? (
            <Empty>No tickets yet. They’ll appear here as tenants raise them from their Support page.</Empty>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 12, alignItems: "start" }}>
              {LANES.map((lane) => {
                const items = byLane(lane);
                return (
                  <div key={lane} className="card">
                    <div className="hd" style={{ padding: "10px 12px" }}>
                      <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--ink-3)" }}>{titleCase(lane)}</h3>
                      <span className="pill mute">{items.length}</span>
                    </div>
                    <div className="bd" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 80 }}>
                      {items.map((t) => (
                        <button key={t.ticket_id} className="ticket-card" onClick={() => setActive(t)}>
                          <div className="row between" style={{ gap: 6 }}>
                            <Pill tone={kindTone(t.kind)}>{titleCase(t.kind)}</Pill>
                            {t.csat != null && <span className="muted" style={{ fontSize: 11 }}>★ {t.csat}</span>}
                          </div>
                          <div style={{ fontWeight: 600, fontSize: 12.5, margin: "6px 0 4px", lineHeight: 1.3 }}>{t.title}</div>
                          <div className="mono muted" style={{ fontSize: 11 }}>{t.tenant_slug}</div>
                        </button>
                      ))}
                      {items.length === 0 && <div className="muted" style={{ fontSize: 11.5, textAlign: "center", padding: "12px 0" }}>—</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {active && <TicketModal ticket={active} onClose={() => setActive(null)} onChanged={() => { setActive(null); reload(); }} />}
    </>
  );
}

function TicketModal({ ticket, onClose, onChanged }: { ticket: SupportTicket; onClose: () => void; onChanged: () => void }) {
  const { toast, fail } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const move = (status: TicketStatus) => {
    setBusy(status);
    platform.setTicketStatus(ticket.ticket_id, status)
      .then(() => { toast(`Ticket → ${titleCase(status)}`); onChanged(); })
      .catch((e) => { fail(e); setBusy(null); });
  };

  const ctx = ticket.context && Object.keys(ticket.context).length > 0 ? ticket.context : null;

  return (
    <Modal
      title={<span className="row" style={{ gap: 8 }}><Pill tone={kindTone(ticket.kind)}>{titleCase(ticket.kind)}</Pill> Ticket</span>}
      onClose={onClose}
      maxWidth={560}
      footer={
        <div className="row wrap" style={{ gap: 6, justifyContent: "flex-end", flex: 1 }}>
          <span className="muted" style={{ fontSize: 12, marginRight: "auto" }}>Move to:</span>
          {LANES.filter((s) => s !== ticket.status).map((s) => (
            <Button key={s} size="sm" variant={s === "DECLINED" ? "danger" : s === "SHIPPED" ? "primary" : "default"} loading={busy === s} onClick={() => move(s)}>
              {titleCase(s)}
            </Button>
          ))}
        </div>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div>
          <div style={{ fontWeight: 650, fontSize: 15 }}>{ticket.title}</div>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <Pill tone={statusTone(ticket.status)}>{titleCase(ticket.status)}</Pill>
            <span className="mono muted" style={{ fontSize: 12 }}>{ticket.tenant_slug}</span>
            {ticket.csat != null && <span className="muted" style={{ fontSize: 12 }}>CSAT ★ {ticket.csat}/5</span>}
          </div>
        </div>
        <dl className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
          <dt>Tenant</dt><dd>{ticket.tenant_name || ticket.tenant_slug}</dd>
          <dt>Raised by</dt><dd>{ticket.raised_by_email || "—"}</dd>
          <dt>Created</dt><dd>{fmtDateTime(ticket.created_at)}</dd>
          <dt>Updated</dt><dd>{fmtDateTime(ticket.updated_at)}</dd>
        </dl>
        {ticket.body && (
          <div>
            <div className="f" style={{ marginBottom: 4 }}>Details</div>
            <div style={{ fontSize: 13, whiteSpace: "pre-wrap", background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px" }}>{ticket.body}</div>
          </div>
        )}
        <TenantTelemetry ticketId={ticket.ticket_id} />
        {ctx && (
          <div>
            <div className="f" style={{ marginBottom: 4 }}>Context</div>
            <pre className="mono" style={{ fontSize: 11.5, margin: 0, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", overflow: "auto" }}>{JSON.stringify(ctx, null, 2)}</pre>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * WS-M2 — the tenant's platform state, next to their complaint.
 *
 * The backend for this shipped some time ago and nothing called it, so triage
 * still began by going and looking each of these up by hand. The ordering here
 * is the point: the one-line verdict leads, because a triager wants an answer
 * before they want six panels to correlate.
 *
 * Failure renders as a note, not as an error state. This is supporting context
 * for a ticket that is perfectly readable without it — breaking the modal
 * because telemetry is unavailable would make the feature a liability.
 */
function TenantTelemetry({ ticketId }: { ticketId: string }) {
  const { data, loading, error } = useAsync<SupportContext>(
    () => ops.supportContext(ticketId) as Promise<SupportContext>,
    [ticketId],
  );

  if (loading) return <div className="muted" style={{ fontSize: 12 }}>Loading tenant telemetry…</div>;
  if (error || !data) {
    return <div className="muted" style={{ fontSize: 12 }}>Tenant telemetry unavailable{error ? ` — ${error.message}` : ""}.</div>;
  }

  const h = data.health;
  const tone = h?.status === "RED" ? "bad" : h?.status === "AMBER" ? "warn" : h?.status === "GREEN" ? "ok" : "mute";
  const over = (data.usage || []).filter((u) => u.over);
  // Warnings only matter here when nothing is already over — otherwise the
  // breach is the story and the approach to it is noise.
  const nearing = over.length ? [] : (data.usage || []).filter((u) => u.warning);

  return (
    <div>
      <div className="f" style={{ marginBottom: 4 }}>Tenant state</div>
      <div style={{ background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px" }}>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <Pill tone={tone}>{h?.status || "Unknown"}</Pill>
          <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>{data.summary}</div>
        </div>

        {h?.reasons && h.reasons.length > 0 && (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--ink-2)" }}>
            {h.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}

        <dl className="kv" style={{ gridTemplateColumns: "130px 1fr", marginTop: 10, fontSize: 12 }}>
          {data.history && (
            <>
              <dt>Last {data.history.window_hours}h</dt>
              <dd>
                {data.history.degraded_in_window
                  // Named explicitly because "healthy now" plus "was red on
                  // Tuesday" is the combination a status page hides and a
                  // ticket is usually about.
                  ? `${data.history.red} red / ${data.history.amber} amber of ${data.history.red + data.history.amber + data.history.green} samples`
                  : "green throughout"}
              </dd>
            </>
          )}
          {h?.error_count_24h != null && (
            <><dt>Errors (24h)</dt><dd>{h.error_count_24h}</dd></>
          )}
          {h?.pool_utilisation_pct != null && (
            <>
              <dt>Capacity</dt>
              <dd>{h.pool_utilisation_pct}% of pool{h.pool_max ? ` (${h.pool_total ?? "?"}/${h.pool_max})` : ""}</dd>
            </>
          )}
          {data.backups && (
            <>
              <dt>Last backup</dt>
              <dd>
                {data.backups.last_ok_dump ? fmtDateTime(data.backups.last_ok_dump) : "never"}
                {data.backups.stale && <span className="pill warn" style={{ marginLeft: 6 }}>stale</span>}
                {!!data.backups.failures_7d && <span className="pill bad" style={{ marginLeft: 6 }}>{data.backups.failures_7d} failed (7d)</span>}
              </dd>
            </>
          )}
          {data.last_drill && (
            <>
              <dt>Restore proven</dt>
              <dd>
                {data.last_drill.ok ? "yes" : "NO — last drill failed"} · {fmtDateTime(data.last_drill.ran_at)}
                {data.last_drill.rto_seconds != null && ` · ${Math.round(data.last_drill.rto_seconds / 60)}m`}
              </dd>
            </>
          )}
          {(over.length > 0 || nearing.length > 0) && (
            <>
              <dt>Plan</dt>
              <dd>
                {over.map((u) => (
                  <span key={u.metric} className="pill bad" style={{ marginRight: 6 }}>
                    {u.label} {u.used}/{u.limit}{u.hard ? " (blocking)" : ""}
                  </span>
                ))}
                {nearing.map((u) => (
                  <span key={u.metric} className="pill warn" style={{ marginRight: 6 }}>
                    {u.label} {u.pct}%
                  </span>
                ))}
              </dd>
            </>
          )}
          {data.maintenance && data.maintenance.length > 0 && (
            <>
              <dt>Maintenance</dt>
              <dd>{data.maintenance.map((m) => `${m.title} (${fmtDateTime(m.starts_at)})`).join("; ")}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
