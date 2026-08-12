import { useState } from "react";
import { platform } from "@/lib/api";
import { ops, canMaintain, type MaintenanceWindow } from "@/lib/ops-api";
import type { TenantListRow } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { fmtDateTime } from "@/lib/format";
import { Button, Card, ConfirmModal, Empty, Field, Loading, Modal, PageHeader, Pill } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { OpsNav } from "./OpsNav";

/**
 * WS-M1 — maintenance windows.
 *
 * The mode distinction is the thing to get right in the UI, because the two are
 * very different acts wearing the same shape. ANNOUNCE puts a banner in front of
 * tenant users and changes nothing else. READ_ONLY parks their writes — it is a
 * deliberate, scoped outage. So READ_ONLY is styled as the dangerous choice and
 * spelled out in the form rather than being one innocuous item in a dropdown.
 */

/** <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in LOCAL time. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function windowState(w: MaintenanceWindow): { label: string; tone: "ok" | "warn" | "bad" | "mute" | "info" } {
  const now = Date.now();
  if (w.cancelled_at) return { label: "Cancelled", tone: "mute" };
  if (new Date(w.ends_at).getTime() <= now) return { label: "Finished", tone: "mute" };
  if (new Date(w.starts_at).getTime() <= now) {
    return w.mode === "READ_ONLY" ? { label: "Active · read-only", tone: "bad" } : { label: "Active", tone: "warn" };
  }
  return { label: "Scheduled", tone: "info" };
}

export function OpsMaintenance() {
  const { toast, fail } = useToast();
  const [includePast, setIncludePast] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<MaintenanceWindow | null>(null);

  const windows = useAsync<MaintenanceWindow[]>(() => ops.maintenance(includePast), [includePast]);
  const tenants = useAsync<TenantListRow[]>(() => platform.tenants() as Promise<TenantListRow[]>);

  const rows = windows.data || [];

  return (
    <>
      <PageHeader
        title="Maintenance"
        desc="Announced windows and scoped read-only periods — the only ops action tenant users can see."
        actions={canMaintain() ? <Button variant="primary" onClick={() => setCreating(true)}>Schedule window</Button> : undefined}
      />
      <OpsNav />

      <div className="toolbar">
        <Button size="sm" variant={includePast ? "ghost" : "primary"} onClick={() => setIncludePast(false)}>Upcoming & active</Button>
        <Button size="sm" variant={includePast ? "primary" : "ghost"} onClick={() => setIncludePast(true)}>All</Button>
        <span className="muted">{rows.length} window{rows.length === 1 ? "" : "s"}</span>
      </div>

      {windows.loading ? (
        <Loading />
      ) : windows.error ? (
        <Empty>Couldn’t load maintenance windows — {windows.error.message}</Empty>
      ) : rows.length === 0 ? (
        <Empty>
          {includePast ? "No maintenance windows have ever been scheduled." : "Nothing scheduled. Tenants see no banner."}
        </Empty>
      ) : (
        <Card>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr><th>Title</th><th>Scope</th><th>Mode</th><th>State</th><th>Notice</th><th>Starts</th><th>Ends</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((w) => {
                  const st = windowState(w);
                  const live = !w.cancelled_at && new Date(w.ends_at).getTime() > Date.now();
                  return (
                    <tr key={w.maintenance_window_id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 12.5 }}>{w.title}</div>
                        {w.message && <div className="muted" style={{ fontSize: 11.5, maxWidth: 320 }}>{w.message}</div>}
                      </td>
                      <td>
                        {w.slug
                          ? <span className="mono">{w.slug}</span>
                          : <Pill tone="info">whole fleet</Pill>}
                      </td>
                      <td>
                        {w.mode === "READ_ONLY"
                          ? <Pill tone="bad">read-only</Pill>
                          : <Pill tone="mute">announce</Pill>}
                      </td>
                      <td><Pill tone={st.tone}>{st.label}</Pill></td>
                      <td>
                        {w.notice_hours === 0
                          ? <Pill tone="warn">none</Pill>
                          : <span className="muted">{w.notice_hours}h</span>}
                      </td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(w.starts_at)}</td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(w.ends_at)}</td>
                      <td style={{ textAlign: "right" }}>
                        {canMaintain() && live && (
                          <Button size="sm" variant="ghost" onClick={() => setCancelling(w)}>End now</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {creating && (
        <ScheduleModal
          tenants={tenants.data || []}
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); windows.reload(); }}
        />
      )}

      {cancelling && (
        <ConfirmModal
          title="End this window now?"
          body={
            <>
              <span className="mono">{cancelling.title}</span> ends immediately. Any banner disappears
              {cancelling.mode === "READ_ONLY" ? " and writes are unparked" : ""}. The original schedule is kept
              on the record rather than erased.
            </>
          }
          confirmLabel="End it"
          onConfirm={() =>
            ops.cancelMaintenance(cancelling.maintenance_window_id)
              .then(() => { toast("Window ended"); windows.reload(); })
              .catch(fail)
          }
          onClose={() => setCancelling(null)}
        />
      )}
    </>
  );
}

function ScheduleModal({ tenants, onClose, onDone }: { tenants: TenantListRow[]; onClose: () => void; onDone: () => void }) {
  const { toast, fail } = useToast();
  const now = new Date();
  const inTwoHours = new Date(now.getTime() + 2 * 3600_000);

  const [tenantSlug, setTenantSlug] = useState<string>("");
  const [title, setTitle] = useState("Scheduled maintenance");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"ANNOUNCE" | "READ_ONLY">("ANNOUNCE");
  const [startsAt, setStartsAt] = useState(toLocalInput(now));
  const [endsAt, setEndsAt] = useState(toLocalInput(inTwoHours));
  const [noticeHours, setNoticeHours] = useState(24);
  const [busy, setBusy] = useState(false);

  const invalid = !title.trim() || new Date(endsAt) <= new Date(startsAt);

  const save = () => {
    setBusy(true);
    ops.scheduleMaintenance({
      tenant_slug: tenantSlug || null,
      // datetime-local has no zone; new Date() reads it as local and toISOString
      // converts, so the operator schedules in their own clock and the server
      // stores UTC — which is the only way "starts at 02:00" means what they meant.
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      title: title.trim(),
      message: message.trim() || null,
      mode,
      notice_hours: noticeHours,
    })
      .then(() => { toast("Maintenance window scheduled"); onDone(); })
      .catch((e) => { fail(e); setBusy(false); });
  };

  return (
    <Modal
      title="Schedule maintenance"
      onClose={onClose}
      maxWidth={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={invalid}>Schedule</Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Scope" hint="Leave as the whole fleet for a platform-wide deploy or migration.">
          <select value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)}>
            <option value="">Whole fleet — every tenant</option>
            {tenants.map((t) => (
              <option key={t.slug} value={t.slug}>{t.slug}</option>
            ))}
          </select>
        </Field>

        <Field label="Title" hint="Tenant users read this. Say what is happening, not the ticket number.">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>

        <Field label="Message (optional)">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} />
        </Field>

        <div className="grid2">
          <Field label="Starts"><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>
          <Field label="Ends"><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></Field>
        </div>
        {new Date(endsAt) <= new Date(startsAt) && (
          <div className="banner warn">The end time has to be after the start time.</div>
        )}

        <Field
          label="Mode"
          hint={
            mode === "READ_ONLY"
              ? "Read-only parks tenant writes for the whole window. This is a deliberate, scoped outage — use it only when writes would actually be unsafe."
              : "Announce shows a banner and changes nothing else."
          }
        >
          <select value={mode} onChange={(e) => setMode(e.target.value as "ANNOUNCE" | "READ_ONLY")}>
            <option value="ANNOUNCE">Announce — banner only</option>
            <option value="READ_ONLY">Read-only — park writes</option>
          </select>
        </Field>

        <Field
          label="Advance notice"
          hint={
            noticeHours === 0
              ? "No warning — the banner appears the moment the window opens. Honest for an emergency, but users get no chance to finish what they were doing."
              : `Tenant users see the banner ${noticeHours}h before it starts.`
          }
        >
          <select value={noticeHours} onChange={(e) => setNoticeHours(Number(e.target.value))}>
            <option value={0}>None — banner appears when it starts</option>
            <option value={1}>1 hour before</option>
            <option value={4}>4 hours before</option>
            <option value={24}>24 hours before</option>
            <option value={72}>3 days before</option>
            <option value={168}>1 week before</option>
          </select>
        </Field>

        {mode === "READ_ONLY" && (
          <div className="banner warn">
            Tenant users will be unable to save anything for the duration of this window.
            {noticeHours === 0 && " With no advance notice, saving will stop without warning."}
          </div>
        )}
      </div>
    </Modal>
  );
}
