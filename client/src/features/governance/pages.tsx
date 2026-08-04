/**
 * Governance — audit ledger, notifications, the workflow ENGINE (definitions +
 * ordered validate/approve step chains), and the runtime approvals queue.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { HubCrumb } from "@/components/tabbed-hub";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { money, num, dateFmt, enumLabel, humanizeRef } from "@/lib/format";
import * as wf from "@/lib/workflow-api";
import { fetchRoles } from "@/lib/rbac";
import { fetchScopeTree, buildScopeTree, type ScopeTreeNode } from "@/lib/scope-api";
import { reportActionError } from "@/lib/action-error";
import { PushOptIn } from "@/components/pwa/push-opt-in";

/* ═════════════════════════ shared local primitives ══════════════════════════ */

const shell = pageShell.wide;


function Acts({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>{children}</div>;
}

/** Short display for a user id when the /users list isn't readable. */
const shortId = (id?: string | null) => (id ? `…${String(id).slice(-8)}` : "—");

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

/** Pretty-print a jsonb column without exploding on a null/primitive. */
function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="micro">—</span>;
  return (
    <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function LedgerDetail({ row, actorName, onClose }: { row: LedgerEntry; actorName: Record<string, string>; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="xl" title={row.action} description="Ledger entries are append-only — a database trigger forbids update and delete.">
      <div className="space-y-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div><div className="micro uppercase tracking-wide">Entity</div><span className="num">{row.entity_ref || "—"}</span></div>
          <div><div className="micro uppercase tracking-wide">Module</div>{row.module_key || "—"}</div>
          <div><div className="micro uppercase tracking-wide">Actor</div>{row.actor_user_id ? actorName[row.actor_user_id] || shortId(row.actor_user_id) : "—"}{row.actor_role ? ` · ${row.actor_role}` : ""}</div>
          <div><div className="micro uppercase tracking-wide">When</div><span className="num">{dateFmt(row.created_at)}</span>{row.ip ? <span className="num text-muted-foreground"> · {row.ip}</span> : null}</div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="micro mb-1 uppercase tracking-wide">Before</div>
            <Json value={row.before_json} />
          </div>
          <div>
            <div className="micro mb-1 uppercase tracking-wide">After</div>
            <Json value={row.after_json} />
          </div>
        </div>
        <div className="flex justify-end pt-2"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  );
}

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
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Q3 2026 access recertification" />
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
    { key: "action", label: "Action", render: (r) => <span className="font-medium text-[rgb(var(--primary))]">{enumLabel(r.action)}</span> },
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
    { key: "_a", label: "", render: (r) => <Acts><Button size="sm" variant="outline" onClick={() => setOpenReview(r)}>Open</Button></Acts> },
  ];
  const restoreCols: Column<SoftDelete>[] = [
    { key: "entity_ref", label: "Record", render: (r) => <span className="num font-medium text-foreground">{r.entity_ref}</span> },
    { key: "deleted_by", label: "Deleted by", render: (r) => actor(r.deleted_by) },
    { key: "deleted_at", label: "Deleted", render: (r) => <span className="num">{dateFmt(r.deleted_at)}</span> },
    { key: "state", label: "State", render: (r) => (r.restore_requested_by ? <Pill tone="warn">Restore requested</Pill> : <Pill tone="mute">Soft-deleted</Pill>) },
    {
      key: "_a", label: "", render: (r) => (
        <Acts>
          {!r.restore_requested_by && (
            <Button size="sm" variant="outline" disabled={busy === r.soft_delete_id} onClick={() => softDeleteAction(r.soft_delete_id, "request-restore")}>Request restore</Button>
          )}
          <Button size="sm" variant="outline" disabled={busy === r.soft_delete_id} onClick={() => softDeleteAction(r.soft_delete_id, "restore")}>Restore</Button>
        </Acts>
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

      {detail && <LedgerDetail row={detail} actorName={actorName} onClose={() => setDetail(null)} />}
      {openReview && <ReviewDetail review={openReview} actorName={actorName} onClose={() => setOpenReview(null)} onChanged={reviews.reload} />}
      {newReview && <NewReviewForm onClose={() => setNewReview(false)} onSaved={reviews.reload} />}
    </section>
  );
}

/* ═══════════════════════════════ Notifications ══════════════════════════════ */

type Notification = {
  notification_id: string;
  channel?: string | null;
  event_type_key?: string | null;
  category?: string | null;
  title: string;
  body?: string | null;
  entity_ref?: string | null;
  priority?: string | null;
  read_at?: string | null;
  created_at?: string | null;
};
type Preference = { channel: string; category: string; enabled: boolean };

const CHANNELS = ["IN_APP", "EMAIL", "SMS", "WHATSAPP"];
/**
 * The backend accepts any category string (it's free text), so this list is a UI
 * convention rather than a contract. Categories the user already has a stored
 * preference for are merged in, so nothing saved elsewhere disappears from view.
 */
type Category = { key: string; label: string; security: boolean };
// Fallback if the catalog endpoint is unavailable — keeps the panel usable.
const FALLBACK_CATEGORIES: Category[] = [
  { key: "security", label: "Security", security: true },
  { key: "approvals", label: "Approvals", security: false },
  { key: "finance", label: "Finance", security: false },
  { key: "operations", label: "Operations", security: false },
  { key: "sales", label: "Sales & CRM", security: false },
  { key: "compliance", label: "Compliance", security: false },
  { key: "system", label: "System", security: false },
];

function PreferencesPanel() {
  const prefs = useResource<Preference[] | { preferences?: Preference[] }>(() => tenant("/notifications/preferences"), []);
  const catalog = useResource<Category[]>(() => tenant("/notifications/categories"), []);
  const [draft, setDraft] = React.useState<Record<string, boolean> | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const stored: Preference[] = React.useMemo(() => {
    const d = prefs.data;
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.preferences)) return d.preferences;
    return [];
  }, [prefs.data]);

  const catMeta: Category[] = React.useMemo(
    () => (Array.isArray(catalog.data) && catalog.data.length ? catalog.data : FALLBACK_CATEGORIES),
    [catalog.data],
  );
  const categories = React.useMemo(() => catMeta.map((c) => c.key), [catMeta]);
  const labelOf = React.useCallback((k: string) => catMeta.find((c) => c.key === k)?.label || k, [catMeta]);
  const isSecurity = React.useCallback((k: string) => !!catMeta.find((c) => c.key === k)?.security, [catMeta]);

  // Defaults when the user has set no explicit row: IN_APP on (cheap, in-product),
  // outbound channels (EMAIL/SMS/WHATSAPP) off — they're opt-in so we never
  // message someone who didn't ask. Mirrors notification.repo.isChannelEnabled.
  const key = (c: string, ch: string) => `${ch}::${c}`;
  const current = React.useMemo(() => {
    const m: Record<string, boolean> = {};
    categories.forEach((c) => CHANNELS.forEach((ch) => { m[key(c, ch)] = ch === "IN_APP"; }));
    stored.forEach((p) => { m[key(p.category, p.channel)] = p.enabled; });
    return m;
  }, [categories, stored]);

  const value = draft || current;
  const dirty = !!draft && Object.keys(value).some((k) => value[k] !== current[k]);

  function toggle(c: string, ch: string) {
    const k = key(c, ch);
    setSaved(false);
    setDraft({ ...value, [k]: !value[k] });
  }

  async function save() {
    setBusy(true); setError(null);
    const payload: Preference[] = [];
    categories.forEach((c) => CHANNELS.forEach((ch) => {
      payload.push({ channel: ch, category: c, enabled: value[key(c, ch)] });
    }));
    try {
      await tenant("/notifications/preferences", { method: "PUT", body: { preferences: payload } });
      setDraft(null);
      setSaved(true);
      prefs.reload();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  if (prefs.error) return <ErrorState message={prefs.error} />;
  if (prefs.loading) return <span className="micro">Loading preferences…</span>;

  return (
    <div className="space-y-4">
      <PushOptIn />
      <p className="text-sm text-muted-foreground">
        Choose how you're told about each kind of event. These are yours alone — no grant needed, and they don't affect anyone else.
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Category</th>
              {CHANNELS.map((ch) => (
                <th key={ch} className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">{ch.replace("_", "-")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => {
              const locked = isSecurity(c);
              return (
                <tr key={c} className="border-t">
                  <td className="px-3 py-2 font-medium text-foreground">
                    {labelOf(c)}
                    {locked && <span className="ml-2 align-middle text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Always on</span>}
                  </td>
                  {CHANNELS.map((ch) => (
                    <td key={ch} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={locked ? true : !!value[key(c, ch)]}
                        disabled={locked}
                        title={locked ? "Security alerts can't be turned off" : undefined}
                        onChange={() => !locked && toggle(c, ch)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <ErrorState message={error} />}
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="micro">Preferences saved.</span>}
        {dirty && <Button variant="outline" onClick={() => { setDraft(null); setSaved(false); }} disabled={busy}>Discard</Button>}
        <Button onClick={save} loading={busy} disabled={!dirty || busy}>Save preferences</Button>
      </div>
    </div>
  );
}

export function NotificationsPage() {
  const [tab, setTab] = React.useState<"inbox" | "preferences">("inbox");
  const { rows, error, loading, reload } = useList<Notification>("/notifications");
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const all = rows || [];
  const unread = all.filter((n) => !n.read_at);
  const list = unreadOnly ? unread : all;

  async function markRead(id: string) {
    setBusy(id); setActionError(null);
    try { await tenant(`/notifications/${id}/read`, { method: "POST" }); reload(); }
    catch (e) { setActionError(errMsg(e)); } finally { setBusy(null); }
  }
  async function markAll() {
    setBusy("__all"); setActionError(null);
    try { await tenant("/notifications/read-all", { method: "POST" }); reload(); }
    catch (e) { setActionError(errMsg(e)); } finally { setBusy(null); }
  }

  const columns: Column<Notification>[] = [
    {
      key: "title", label: "Notification",
      render: (r) => (
        <div className="min-w-0">
          <div className={r.read_at ? "text-muted-foreground" : "font-semibold text-foreground"}>{r.title}</div>
          {r.body && <div className="truncate text-xs text-muted-foreground">{r.body}</div>}
        </div>
      ),
    },
    { key: "priority", label: "Priority", render: (r) => <Pill tone={String(r.priority).toUpperCase() === "HIGH" ? "bad" : "mute"}>{r.priority || "NORMAL"}</Pill> },
    { key: "category", label: "Category", render: (r) => (r.category ? <Pill tone={r.category === "security" ? "bad" : "blue"}>{r.category}</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "event_type_key", label: "Event", render: (r) => <span className="text-muted-foreground">{r.event_type_key ? enumLabel(r.event_type_key) : "—"}</span> },
    { key: "created_at", label: "When", render: (r) => <span className="num">{dateFmt(r.created_at)}</span> },
    {
      key: "_a", label: "",
      render: (r) => (
        <Acts>
          {r.read_at ? <Pill tone="mute">Read</Pill> : <Button size="sm" variant="outline" disabled={busy === r.notification_id} onClick={() => markRead(r.notification_id)}>Mark read</Button>}
        </Acts>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Governance" to="/governance" />}
        title="Notifications"
        description="Your inbox. System-generated only — Watch-the-Watcher writes HIGH alerts here on security-critical changes."
        action={tab === "inbox" && unread.length > 0 ? <Button variant="outline" onClick={markAll} loading={busy === "__all"}>Mark all read</Button> : undefined}
      />
      <Segmented
        label="Notifications section"
        variant="solid"
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[{ value: "inbox", label: `Inbox${unread.length ? ` (${unread.length})` : ""}` }, { value: "preferences", label: "Preferences" }]}
      />
      {actionError && <div className="mb-3"><ErrorState message={actionError} /></div>}

      {tab === "inbox" ? (
        <>
          <KpiRow>
            <KpiTile label="Unread" value={num(unread.length)} />
            <KpiTile label="Total" value={num(all.length)} />
            <KpiTile label="High priority" value={num(all.filter((n) => String(n.priority).toUpperCase() === "HIGH").length)} />
          </KpiRow>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[{ k: false, label: "All" }, { k: true, label: "Unread" }].map((o) => (
              <button key={String(o.k)} onClick={() => setUnreadOnly(o.k)}
                className={unreadOnly === o.k
                  ? "rounded-full border border-transparent bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm"
                  : "rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"}>
                {o.label}
              </button>
            ))}
          </div>
          <DataList columns={columns} rows={loading ? null : list} error={error} loading={loading}
            rowKey={(r) => r.notification_id}
            empty={{ title: unreadOnly ? "Nothing unread" : "No notifications", hint: "Alerts arrive here as events fire." }} />
        </>
      ) : (
        <PreferencesPanel />
      )}
    </section>
  );
}

/* ═══════════════════ Workflows — definitions + step chains ═══════════════════ */
function Toggle({ on, busy, onClick }: { on: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy} role="switch" aria-checked={on}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-[rgb(var(--ink-3)/0.3)]"} ${busy ? "opacity-60" : ""}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function band(s: wf.WorkflowStep): string {
  if (s.min_amount_xaf == null && s.max_amount_xaf == null) return "any amount";
  if (s.min_amount_xaf != null && s.max_amount_xaf != null) return `${money(s.min_amount_xaf)} – ${money(s.max_amount_xaf)}`;
  if (s.min_amount_xaf != null) return `≥ ${money(s.min_amount_xaf)}`;
  return `≤ ${money(s.max_amount_xaf)}`;
}

function StepForm({ workflowId, nextSeq, onClose, onSaved }: { workflowId: string; nextSeq: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ step_seq: String(nextSeq), step_kind: "APPROVE", capability_code: "APPROVER", role_id: "", scope_id: "", min_amount_xaf: "", max_amount_xaf: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Who may act on this step. Until these existed, every step built here was
  // saved with role_id = NULL, which meant the task it opened was assigned to
  // nobody and notified nobody (audit finding W1).
  const roles = useResource(() => fetchRoles(), []);
  const scopes = useResource(() => fetchScopeTree(), []);
  const scopeTree = React.useMemo(() => buildScopeTree(scopes.data || []), [scopes.data]);
  const flatScopes = React.useMemo(() => {
    const out: ScopeTreeNode[] = [];
    const walk = (ns: ScopeTreeNode[]) => ns.forEach((n) => { out.push(n); walk(n.children); });
    walk(scopeTree);
    return out;
  }, [scopeTree]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await wf.addStep(workflowId, {
        step_seq: Number(f.step_seq), step_kind: f.step_kind as "VALIDATE" | "APPROVE",
        capability_code: f.capability_code as "VALIDATOR" | "APPROVER",
        role_id: f.role_id || undefined,
        scope_id: f.scope_id || undefined,
        min_amount_xaf: f.min_amount_xaf === "" ? undefined : Number(f.min_amount_xaf),
        max_amount_xaf: f.max_amount_xaf === "" ? undefined : Number(f.max_amount_xaf),
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Add step" description="A stage in the chain — who acts, where in the company, and (optionally) the amount band it applies to.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Order" required><Input type="number" min="1" className="num" value={f.step_seq} onChange={(e) => set("step_seq", e.target.value)} /></Field>
          <Field label="Kind" required>
            <Select value={f.step_kind} onChange={(e) => { set("step_kind", e.target.value); set("capability_code", e.target.value === "VALIDATE" ? "VALIDATOR" : "APPROVER"); }}>
              <option value="VALIDATE">Validate</option>
              <option value="APPROVE">Approve</option>
            </Select>
          </Field>
          <Field label="Role" hint="Who decides this step. Leave as Anyone and the step is open to any approver.">
            <Select value={f.role_id} onChange={(e) => set("role_id", e.target.value)}>
              <option value="">Anyone</option>
              {(roles.data || []).map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Part of the company" hint="The organigramme node this decision belongs to. Anyone above it in the tree can act; leave blank for company-wide.">
            <Select value={f.scope_id} onChange={(e) => set("scope_id", e.target.value)}>
              <option value="">Company-wide</option>
              {flatScopes.map((s) => (
                <option key={s.scope_id} value={s.scope_id}>{`${"  ".repeat(s.depth)}${s.code} · ${s.name}`}</option>
              ))}
            </Select>
          </Field>
          <Field label="Capability" required hint="Segregation-of-duties overlay — the actor must hold this authority.">
            <Select value={f.capability_code} onChange={(e) => set("capability_code", e.target.value)}>
              <option value="VALIDATOR">Validator</option>
              <option value="APPROVER">Approver</option>
            </Select>
          </Field>
          <div />
          <Field label="Min amount (XAF)"><Input type="number" min="0" className="num text-right" value={f.min_amount_xaf} onChange={(e) => set("min_amount_xaf", e.target.value)} placeholder="Any" /></Field>
          <Field label="Max amount (XAF)"><Input type="number" min="0" className="num text-right" value={f.max_amount_xaf} onChange={(e) => set("max_amount_xaf", e.target.value)} placeholder="Any" /></Field>
        </div>
        {!scopes.loading && !flatScopes.length && (
          <p className="micro">
            No scopes defined yet — build the tree under Security &rsaquo; Scopes to route steps to a branch or department.
          </p>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy}>Add step</Button>
        </div>
      </form>
    </Modal>
  );
}

function WorkflowDrawer({ workflow, onClose, onChanged }: { workflow: wf.Workflow; onClose: () => void; onChanged: () => void }) {
  const steps = useResource(() => wf.listSteps(workflow.workflow_id), [workflow.workflow_id]);
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const chain = (steps.data || []).slice().sort((a, b) => a.step_seq - b.step_seq);

  // Resolve the ids a step binds to into names, so the chain reads as
  // "Finance · Douala branch" rather than two UUIDs the reader can't check.
  const roles = useResource(() => fetchRoles(), []);
  const scopes = useResource(() => fetchScopeTree(), []);
  const roleName = (id?: string | null) =>
    (roles.data || []).find((r) => r.role_id === id)?.name || null;
  const scopeName = (id?: string | null) => {
    const s = (scopes.data || []).find((x) => x.scope_id === id);
    return s ? `${s.code} · ${s.name}` : null;
  };
  const nextSeq = chain.length ? Math.max(...chain.map((s) => s.step_seq)) + 1 : 1;

  async function remove(s: wf.WorkflowStep) {
    setBusy(s.workflow_step_id);
    try { await wf.removeStep(workflow.workflow_id, s.workflow_step_id); steps.reload(); onChanged(); } catch (e) { reportActionError(e); } finally { setBusy(null); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={workflow.name} description={workflow.event_type_key ? `On event: ${workflow.event_type_key}` : undefined}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="micro uppercase tracking-wide">Approval chain</span>
          <Button size="sm" onClick={() => setAdding(true)}>Add step</Button>
        </div>
        {steps.loading ? <div className="py-6 text-center micro">Loading…</div> : steps.error ? <ErrorState message={errMsg(steps.error)} /> : chain.length ? (
          <ol className="space-y-2">
            {chain.map((s) => (
              <li key={s.workflow_step_id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-[rgb(var(--primary))]">{s.step_seq}</span>
                  <Pill tone={s.step_kind === "VALIDATE" ? "blue" : "ok"}>{s.step_kind}</Pill>
                  {/* An unbound step is open to anyone — say so plainly rather than
                      showing a capability that reads like a restriction. */}
                  <span className="text-sm">{roleName(s.role_id) || "Anyone"}</span>
                  <span className="micro">· {scopeName(s.scope_id) || "company-wide"}</span>
                  {s.capability_code && <span className="micro">· {s.capability_code}</span>}
                  <span className="micro">· {band(s)}</span>
                </span>
                <Button size="sm" variant="ghost" loading={busy === s.workflow_step_id} onClick={() => remove(s)}>Remove</Button>
              </li>
            ))}
          </ol>
        ) : <p className="micro">No steps yet — add the first stage of the chain.</p>}
      </div>
      {adding && <StepForm workflowId={workflow.workflow_id} nextSeq={nextSeq} onClose={() => setAdding(false)} onSaved={() => { steps.reload(); onChanged(); }} />}
    </Modal>
  );
}

function WorkflowForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: events } = useList<wf.EventType>("/event-types");
  const approvable = (events || []).filter((e) => e.is_approvable);
  const [f, setF] = React.useState({ name: "", event_type_key: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await wf.createWorkflow({ name: f.name, event_type_key: f.event_type_key }); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New workflow" description="Bind an approval chain to an approvable event.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Expense approval over 500k" /></Field>
          <Field label="Event" required className="sm:col-span-2">
            <Select value={f.event_type_key} onChange={(e) => set("event_type_key", e.target.value)}>
              <option value="">Select an approvable event…</option>
              {approvable.map((e) => <option key={e.key} value={e.key}>{e.name || e.key}</option>)}
            </Select>
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.name || !f.event_type_key || busy}>Create workflow</Button>
        </div>
      </form>
    </Modal>
  );
}

export function WorkflowsPage() {
  const { rows, error, loading, reload } = useList<wf.Workflow>("/workflows");
  const [creating, setCreating] = React.useState(false);
  const [view, setView] = React.useState<wf.Workflow | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const list = rows || [];

  async function toggleActive(w: wf.Workflow) {
    setBusy(w.workflow_id);
    try { await wf.updateWorkflow(w.workflow_id, { is_active: !w.is_active }); reload(); } catch (e) { reportActionError(e); } finally { setBusy(null); }
  }

  const columns: Column<wf.Workflow>[] = [
    { key: "name", label: "Workflow", render: (w) => <span className="font-medium text-foreground">{w.name}</span> },
    { key: "event", label: "On event", render: (w) => (w.event_type_key ? <Pill tone="mute">{w.event_type_key}</Pill> : "—") },
    { key: "steps", label: "Steps", className: "num text-right", render: (w) => num(w.step_count ?? 0) },
    { key: "active", label: "Active", render: (w) => <Toggle on={!!w.is_active} busy={busy === w.workflow_id} onClick={() => toggleActive(w)} /> },
    { key: "_a", label: "", render: (w) => <div className="flex justify-end" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="outline" onClick={() => setView(w)}>Edit chain</Button></div> },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Governance" to="/governance" />} title="Workflows" description="Validate/approve chains bound to approvable events — the org's approval routing." action={<Button onClick={() => setCreating(true)}>New workflow</Button>} />
      <KpiRow>
        <KpiTile label="Workflows" value={num(list.length)} />
        <KpiTile label="Active" value={num(list.filter((w) => w.is_active).length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(w) => w.workflow_id} onRowClick={(w) => setView(w)} empty={{ title: "No workflows", hint: "Create a chain to route approvals for an event." }} />
      {creating && <WorkflowForm onClose={() => setCreating(false)} onSaved={reload} />}
      {view && <WorkflowDrawer workflow={view} onClose={() => setView(null)} onChanged={reload} />}
    </section>
  );
}

/* ═══════════════════════ Approvals — runtime queue ═══════════════════════ */
type ApprovalTask = {
  approval_task_id?: string; id?: string; entity_ref?: string | null; status?: string | null;
  step_kind?: string | null; step_seq?: number | null; amount_xaf?: number | string | null; workflow_name?: string | null; created_at?: string | null;
  leave_kind?: string | null; leave_employee?: string | null; leave_starts?: string | null; leave_ends?: string | null;
};
const actTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "APPROVED" || u === "VALIDATED") return "ok";
  if (u === "REJECTED") return "bad";
  if (u === "PENDING") return "warn";
  return "mute";
};
const LEAVE_KIND: Record<string, string> = { leave: "Leave", salary_advance: "Salary advance", mission: "Mission" };
/** Human title + subtitle for an approval row's entity (leave summary, else humanised ref). */
function entityLabel(r: ApprovalTask): { title: string; sub?: string } {
  if (r.leave_employee) {
    const kind = LEAVE_KIND[r.leave_kind || "leave"] || "Leave";
    const dates = [r.leave_starts, r.leave_ends].filter(Boolean).map((d) => dateFmt(d)).join(" – ");
    return { title: `${kind} · ${r.leave_employee}`, sub: dates || undefined };
  }
  return { title: humanizeRef(r.entity_ref) };
}

export function ApprovalsPage() {
  const { rows, error, loading, reload } = useList<ApprovalTask>("/approvals?status=PENDING");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actError, setActError] = React.useState<string | null>(null);
  const list = rows || [];
  const idOf = (r: ApprovalTask) => String(r.approval_task_id || r.id || "");

  async function act(r: ApprovalTask, action: "validate" | "approve" | "reject") {
    const id = idOf(r);
    if (!id) return;
    const note = action === "reject" ? window.prompt("Reason for rejection (optional):") ?? undefined : undefined;
    setBusy(id + action);
    // Was `alert(errMsg(e))`. The refusals this screen now produces —
    // SELF_APPROVAL, NOT_ELIGIBLE, WRONG_ACTION_FOR_STEP — are explanatory
    // messages a user needs to read next to the row, not dismiss in a modal.
    try { await tenant(`/approvals/${id}/act`, { method: "POST", body: { action, note } }); setActError(null); reload(); }
    catch (e) { setActError(errMsg(e)); } finally { setBusy(null); }
  }

  const columns: Column<ApprovalTask>[] = [
    { key: "entity_ref", label: "Item", render: (r) => {
      const { title, sub } = entityLabel(r);
      return <div className="min-w-0"><div className="font-medium text-foreground">{title}</div>{sub && <div className="num micro">{sub}</div>}</div>;
    } },
    { key: "workflow", label: "Workflow", render: (r) => <span className="text-muted-foreground">{r.workflow_name || "—"}</span> },
    { key: "stage", label: "Stage", render: (r) => (r.step_kind ? <Pill tone="blue">{enumLabel(r.step_kind)}{r.step_seq ? ` · ${r.step_seq}` : ""}</Pill> : "—") },
    { key: "amount", label: "Amount · XAF", className: "num text-right", render: (r) => money(r.amount_xaf) },
    { key: "created", label: "Raised", render: (r) => dateFmt(r.created_at) },
    { key: "status", label: "Status", render: (r) => <Pill tone={actTone(r.status)}>{r.status || "PENDING"}</Pill> },
    {
      key: "_a", label: "", render: (r) => {
        const id = idOf(r);
        return (
          <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            {r.step_kind === "VALIDATE" && <Button size="sm" variant="outline" loading={busy === id + "validate"} onClick={() => act(r, "validate")}>Validate</Button>}
            <Button size="sm" loading={busy === id + "approve"} onClick={() => act(r, "approve")}>Approve</Button>
            <Button size="sm" variant="outline" loading={busy === id + "reject"} onClick={() => act(r, "reject")}>Reject</Button>
          </div>
        );
      },
    },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Governance" to="/governance" />} title="Approvals" description="Your runtime approval queue — validate or approve/reject items routed to you by workflow." />
      <KpiRow>
        <KpiTile label="Pending" value={num(list.length)} />
        <KpiTile label="To validate" value={num(list.filter((r) => r.step_kind === "VALIDATE").length)} />
        <KpiTile label="To approve" value={num(list.filter((r) => r.step_kind === "APPROVE").length)} />
      </KpiRow>
      {actError && <ErrorState message={actError} />}
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => idOf(r)} empty={{ title: "Nothing awaiting you", hint: "Items needing your validation or approval land here." }} />
    </section>
  );
}
