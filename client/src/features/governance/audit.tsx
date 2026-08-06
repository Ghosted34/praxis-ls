/**
 * Governance — the audit ledger and access reviews.
 *
 * Split out of `features/governance/pages.tsx` (928 lines) in Phase 4, audit F7.
 */

import * as React from "react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { HubCrumb } from "@/components/tabbed-hub";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { num, dateFmt, enumLabel } from "@/lib/format";
import { RowActions } from "@/components/ui/row-actions";
import { AuditDetailModal } from "@/components/audit/audit-detail-modal";
import { shell, shortId } from "./shared";

/** Resolve actor ids → names. A 403 on /users is normal for non-IAM roles. */
function useActorNames() {
  const { rows } = useList<{ user_id: string; full_name?: string | null; email?: string | null }>("/users");
  return React.useMemo(() => {
    const m: Record<string, string> = {};
    (rows || []).forEach((u) => { m[u.user_id] = u.full_name || u.email || u.user_id; });
    return m;
  }, [rows]);
}

/* ═══════════════════════════ Audit & governance ═════════════════════════════ */

type LedgerEntry = {
  ledger_id: number | string;
  actor_user_id?: string | null;
  actor_role?: string | null;
  action: string;
  module_key?: string | null;
  entity_ref?: string | null;
  before_json?: unknown;
  after_json?: unknown;
  ip?: string | null;
  created_at?: string | null;
};
type SecurityEvent = {
  event_id: number | string;
  event_type_key: string;
  module_key?: string | null;
  entity_ref?: string | null;
  actor_user_id?: string | null;
  priority?: string | null;
  payload?: unknown;
  created_at?: string | null;
};
type ReviewEntry = {
  entry_id: string;
  user_id: string;
  roles_snapshot?: unknown;
  decision?: string | null;
  note?: string | null;
  decided_at?: string | null;
};
type Review = {
  review_id: string;
  name: string;
  created_by?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
  entries?: ReviewEntry[];
};
type SoftDelete = {
  soft_delete_id: string;
  entity_ref: string;
  payload_json?: unknown;
  deleted_by?: string | null;
  deleted_at?: string | null;
  restore_requested_by?: string | null;
  restored_at?: string | null;
};

const decisionTone = (d?: string | null): Tone =>
  d === "approved" ? "ok" : d === "revoked" ? "bad" : d === "flagged" ? "warn" : "mute";

// LedgerDetail is now `AuditDetailModal` in `components/audit/audit-detail-modal.tsx`
// — the Control Tower's Recent activity widget uses the same modal, and the
// old copy hard-coded the raw `row.action` as the modal title, which is the
// "Auth token refreshed" defect the rebuild was written to fix. Extracted so
// both readers agree on the sentence AND the "Sensitive" pill. The Json
// helper that rendered `before_json`/`after_json` moved with it.

function ReviewDetail({ review, actorName, onClose, onChanged }: { review: Review; actorName: Record<string, string>; onClose: () => void; onChanged: () => void }) {
  const detail = useResource<Review>(() => tenant<Review>(`/audit/reviews/${review.review_id}`), [review.review_id]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const done = !!detail.data?.completed_at;

  async function decide(entryId: string, decision: string) {
    setBusy(entryId); setError(null);
    try {
      await tenant(`/audit/reviews/${review.review_id}/entries/${entryId}`, { method: "PATCH", body: { decision, note: note || null } });
      setNote("");
      detail.reload();
      onChanged();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }
  async function complete() {
    setBusy("__complete"); setError(null);
    try {
      await tenant(`/audit/reviews/${review.review_id}`, { method: "PATCH" });
      detail.reload();
      onChanged();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }

  const entries = detail.data?.entries || [];
  const decided = entries.filter((e) => e.decision).length;

  return (
    <Modal open onClose={onClose} size="xl" title={review.name} description="Recertify each user's access. Decisions are recorded against the live identity schema, so a review always reflects real access.">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            <span className="num font-medium text-foreground">{decided}</span> of <span className="num font-medium text-foreground">{entries.length}</span> decided
            {done && <Pill tone="ok" className="ml-2">Completed {dateFmt(detail.data?.completed_at)}</Pill>}
          </div>
          {!done && (
            <Button size="sm" onClick={complete} loading={busy === "__complete"} disabled={!entries.length || decided < entries.length}>
              Complete review
            </Button>
          )}
        </div>
        {!done && decided < entries.length && (
          <Field label="Note" hint="Optional — attached to the next decision you record.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for revoking / flagging" />
          </Field>
        )}
        {error && <ErrorState message={error} />}
        {detail.error ? <ErrorState message={detail.error} /> : detail.loading ? <span className="micro">Loading entries…</span> : (
          <div className="max-h-96 space-y-2 overflow-auto">
            {entries.map((e) => {
              const roles = Array.isArray(e.roles_snapshot) ? (e.roles_snapshot as unknown[]).map(String) : [];
              return (
                <div key={e.entry_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{actorName[e.user_id] || shortId(e.user_id)}</div>
                    <div className="micro">{roles.length ? roles.join(" · ") : "no roles"}</div>
                    {e.note && <div className="micro italic">{e.note}</div>}
                  </div>
                  {e.decision ? (
                    <Pill tone={decisionTone(e.decision)}>{e.decision}</Pill>
                  ) : done ? (
                    <Pill tone="mute">undecided</Pill>
                  ) : (
                    <div className="flex gap-1.5">
                      {["approved", "revoked", "flagged"].map((d) => (
                        <Button key={d} size="sm" variant="outline" disabled={busy === e.entry_id} onClick={() => decide(e.entry_id, d)}>
                          {d.charAt(0).toUpperCase() + d.slice(1)}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!entries.length && <span className="micro">This review has no entries.</span>}
          </div>
        )}
        <div className="flex justify-end pt-2"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  );
}

function NewReviewForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await tenant("/audit/reviews", { method: "POST", body: { name } });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New access review" description="Snapshots every user and their roles right now, then asks you to approve, revoke or flag each one.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Name" required hint="e.g. Q3 2026 access recertification">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 2026 access recertification" />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !name}>Start review</Button>
        </div>
      </form>
    </Modal>
  );
}

export function AuditPage() {
  const [tab, setTab] = React.useState<"ledger" | "events" | "reviews" | "restores">("ledger");
  const actorName = useActorNames();
  const [q, setQ] = React.useState("");

  const ledger = useList<LedgerEntry>(tab === "ledger" ? "/audit" : null);
  const events = useList<SecurityEvent>(tab === "events" ? "/audit/events" : null);
  const reviews = useList<Review>(tab === "reviews" ? "/audit/reviews" : null);
  const softDeletes = useList<SoftDelete>(tab === "restores" ? "/audit/soft-deletes" : null);

  const [detail, setDetail] = React.useState<LedgerEntry | null>(null);
  const [openReview, setOpenReview] = React.useState<Review | null>(null);
  const [newReview, setNewReview] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const hit = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const actor = (id?: string | null) => (id ? actorName[id] || shortId(id) : "—");

  async function softDeleteAction(id: string, kind: "request-restore" | "restore") {
    setBusy(id); setError(null);
    try {
      await tenant(`/audit/soft-deletes/${id}/${kind}`, { method: "POST" });
      softDeletes.reload();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }

  const ledgerCols: Column<LedgerEntry>[] = [
    { key: "action", label: "Action", render: (r) => <span className="font-medium text-primary-ink">{enumLabel(r.action)}</span> },
    { key: "module_key", label: "Module", render: (r) => (r.module_key ? <Pill tone="mute">{r.module_key}</Pill> : "—") },
    { key: "entity_ref", label: "Entity", render: (r) => <span className="num text-muted-foreground">{r.entity_ref || "—"}</span> },
    { key: "actor_user_id", label: "Actor", render: (r) => actor(r.actor_user_id) },
    { key: "created_at", label: "When", render: (r) => <span className="num">{dateFmt(r.created_at)}</span> },
  ];
  const eventCols: Column<SecurityEvent>[] = [
    { key: "priority", label: "Priority", render: (r) => <Pill tone={String(r.priority).toUpperCase() === "HIGH" ? "bad" : "mute"}>{r.priority || "NORMAL"}</Pill> },
    { key: "event_type_key", label: "Event", render: (r) => <span className="font-medium text-foreground">{r.event_type_key ? enumLabel(r.event_type_key) : "—"}</span> },
    { key: "module_key", label: "Module", render: (r) => r.module_key || "—" },
    { key: "entity_ref", label: "Entity", render: (r) => <span className="num text-muted-foreground">{r.entity_ref || "—"}</span> },
    { key: "actor_user_id", label: "Actor", render: (r) => actor(r.actor_user_id) },
    { key: "created_at", label: "When", render: (r) => <span className="num">{dateFmt(r.created_at)}</span> },
  ];
  const reviewCols: Column<Review>[] = [
    { key: "name", label: "Review", render: (r) => <span className="font-medium text-foreground">{r.name}</span> },
    { key: "created_by", label: "Opened by", render: (r) => actor(r.created_by) },
    { key: "created_at", label: "Opened", render: (r) => <span className="num">{dateFmt(r.created_at)}</span> },
    { key: "state", label: "State", render: (r) => (r.completed_at ? <Pill tone="ok">Completed</Pill> : <Pill tone="warn">In progress</Pill>) },
    { key: "_a", label: "", render: (r) => <RowActions><Button size="sm" variant="outline" onClick={() => setOpenReview(r)}>Open</Button></RowActions> },
  ];
  const restoreCols: Column<SoftDelete>[] = [
    { key: "entity_ref", label: "Record", render: (r) => <span className="num font-medium text-foreground">{r.entity_ref}</span> },
    { key: "deleted_by", label: "Deleted by", render: (r) => actor(r.deleted_by) },
    { key: "deleted_at", label: "Deleted", render: (r) => <span className="num">{dateFmt(r.deleted_at)}</span> },
    { key: "state", label: "State", render: (r) => (r.restore_requested_by ? <Pill tone="warn">Restore requested</Pill> : <Pill tone="mute">Soft-deleted</Pill>) },
    {
      key: "_a", label: "", render: (r) => (
        <RowActions>
          {!r.restore_requested_by && (
            <Button size="sm" variant="outline" disabled={busy === r.soft_delete_id} onClick={() => softDeleteAction(r.soft_delete_id, "request-restore")}>Request restore</Button>
          )}
          <Button size="sm" variant="outline" disabled={busy === r.soft_delete_id} onClick={() => softDeleteAction(r.soft_delete_id, "restore")}>Restore</Button>
        </RowActions>
      ),
    },
  ];

  const ledgerRows = (ledger.rows || []).filter((r) => hit(`${r.action} ${r.entity_ref || ""} ${r.module_key || ""}`));
  const eventRows = (events.rows || []).filter((r) => hit(`${r.event_type_key} ${r.entity_ref || ""} ${r.module_key || ""}`));
  const highEvents = (events.rows || []).filter((r) => String(r.priority).toUpperCase() === "HIGH").length;

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Governance" to="/governance" />}
        title="Audit ledger"
        description="Append-only trail of every create, lock, post, reverse, permission change and AI action. Writes are blocked at the database, not just the API."
        action={tab === "reviews" ? <Button onClick={() => setNewReview(true)}>New review</Button> : undefined}
      />
      <Segmented
        label="Audit section"
        variant="solid"
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "ledger", label: "Ledger" },
          { value: "events", label: "Security events" },
          { value: "reviews", label: "Access reviews" },
          { value: "restores", label: "Restore queue" },
        ]}
      />
      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      {tab === "ledger" && (
        <>
          <div className="mb-3 flex justify-end">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search action, entity or module…" className="w-full max-w-xs" />
          </div>
          <DataList columns={ledgerCols} rows={ledger.loading ? null : ledgerRows} error={ledger.error} loading={ledger.loading}
            rowKey={(r) => String(r.ledger_id)} onRowClick={(r) => setDetail(r)}
            empty={{ title: "Ledger is empty", hint: "Entries appear as documents are locked, posted or reversed." }} />
        </>
      )}

      {tab === "events" && (
        <>
          <KpiRow>
            <KpiTile label="Events" value={num((events.rows || []).length)} />
            <KpiTile label="High priority" value={num(highEvents)} hint="Watch-the-Watcher alerts" />
          </KpiRow>
          <div className="mb-3 flex justify-end">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search event or entity…" className="w-full max-w-xs" />
          </div>
          <DataList columns={eventCols} rows={events.loading ? null : eventRows} error={events.error} loading={events.loading}
            rowKey={(r) => String(r.event_id)}
            empty={{ title: "No security events", hint: "Auth and RBAC activity lands here. These read from the live schema, so TEST shows the same rows." }} />
        </>
      )}

      {tab === "reviews" && (
        <DataList columns={reviewCols} rows={reviews.rows} error={reviews.error} loading={reviews.loading}
          rowKey={(r) => r.review_id} onRowClick={(r) => setOpenReview(r)}
          empty={{ title: "No access reviews", hint: "Start one to snapshot every user's roles and recertify them." }} />
      )}

      {tab === "restores" && (
        <>
          <div className="mb-4 rounded-xl border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn)/0.08)] px-4 py-3 text-sm">
            Restore is maker-checker: the person who deleted a record cannot be the one who restores it, and the database enforces that.
          </div>
          <DataList columns={restoreCols} rows={softDeletes.rows} error={softDeletes.error} loading={softDeletes.loading}
            rowKey={(r) => r.soft_delete_id}
            empty={{ title: "Nothing soft-deleted", hint: "Deleted records wait here until restored or purged in God Mode." }} />
        </>
      )}

      {detail && <AuditDetailModal row={detail} actorName={actorName} onClose={() => setDetail(null)} />}
      {openReview && <ReviewDetail review={openReview} actorName={actorName} onClose={() => setOpenReview(null)} onChanged={reviews.reload} />}
      {newReview && <NewReviewForm onClose={() => setNewReview(false)} onSaved={reviews.reload} />}
    </section>
  );
}

/* ═══════════════════════════════ Notifications ══════════════════════════════ */
