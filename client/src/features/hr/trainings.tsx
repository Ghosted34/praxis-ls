/**
 * Trainings (MOD-18 / 0702) — sessions that happen, and certificates that lapse.
 *
 * ── WHY THIS SCREEN WAS DARK ───────────────────────────────────────────────
 *
 * Every request under it returned 403 FEATURE_DISABLED, because
 * `middleware/feature-gate.js` reads a MISSING `feature_state` row the same way
 * it reads one set to 'off' — and a tenant that was never re-projected after
 * seed 9111 has no row at all. The message said the feature was off for this
 * tenant, so an administrator went to the console, saw it enabled, and had
 * nowhere else to look. 0702 backfills the row; this screen now says which of
 * the two things happened rather than printing a red box.
 *
 * ── WHAT CHANGED BESIDES THAT ──────────────────────────────────────────────
 *
 * A training used to be a title, a DATE and a tick box. It now has a start and
 * an end, a mode, a join link, a capacity, and a live state — and closing a
 * session derives who attended from who actually joined, rather than asking a
 * facilitator to remember twenty names.
 *
 * ── LAYOUT ─────────────────────────────────────────────────────────────────
 *
 * Desktop-first and vertical: the list and the open session sit side by side on
 * a laptop (`xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]`) so that opening a
 * session does not cover the list you are working down, and the detail pane
 * scrolls inside its own height rather than growing the page. Below `xl` the
 * detail becomes a sheet, because side-by-side at 900px gives both halves too
 * little to be useful.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { EmployeePicker } from "@/components/employee-picker";
import { Markdown } from "@/components/markdown";
import { useResource, errMsg, isFeatureDisabled } from "@/lib/use-resource";
import { dateTimeFmt, dateFmt, enumLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";

const shell = pageShell.wide;

const STATUS_TONE: Record<string, Tone> = {
  SCHEDULED: "blue",
  LIVE: "ok",
  DONE: "mute",
  CANCELLED: "bad",
};
const MODE_LABEL: Record<string, string> = {
  IN_PERSON: "In person",
  ONLINE: "Online",
  HYBRID: "Hybrid",
};
/** The four compliance states, in the order somebody would act on them.
 *  EXPIRING is `warn` and not `ok`: it is the only one where doing something
 *  now still prevents a lapse, so it has to catch the eye. */
const COMPLIANCE_TONE: Record<api.ComplianceStatus, Tone> = {
  CURRENT: "ok",
  EXPIRING: "warn",
  EXPIRED: "bad",
  NEVER: "orange",
};
const COMPLIANCE_LABEL: Record<api.ComplianceStatus, string> = {
  CURRENT: "Current",
  EXPIRING: "Expiring",
  EXPIRED: "Expired",
  NEVER: "Never held",
};

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in LOCAL time; the API speaks ISO
 *  in UTC. Both directions live here so the two conversions cannot drift. */
function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/* ══ Schedule form ═════════════════════════════════════════════════════════ */

function ScheduleForm({
  training,
  requirements,
  onClose,
  onSaved,
}: {
  training?: api.Training | null;
  requirements: api.TrainingRequirement[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    title: training?.title || "",
    description: training?.description || "",
    starts_at: toLocalInput(training?.starts_at),
    ends_at: toLocalInput(training?.ends_at),
    mode: (training?.mode || "IN_PERSON") as "IN_PERSON" | "ONLINE" | "HYBRID",
    location: training?.location || "",
    join_url: training?.join_url || "",
    capacity: training?.capacity == null ? "" : String(training.capacity),
    facilitator: training?.facilitator || "",
    training_requirement_id: training?.training_requirement_id || "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Mirrors the server's `assertReachable`. Stated on the form because being
  // told at 09:00 on the day that nobody can get in is the failure this
  // prevents — not being told at save time.
  const needsLink = f.mode === "ONLINE" || f.mode === "HYBRID";
  const needsRoom = f.mode === "IN_PERSON" || f.mode === "HYBRID";
  const reachable = (!needsLink || !!f.join_url.trim()) && (!needsRoom || !!f.location.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: api.TrainingInput = {
      title: f.title,
      description: f.description || null,
      starts_at: fromLocalInput(f.starts_at),
      ends_at: fromLocalInput(f.ends_at),
      mode: f.mode,
      location: f.location || null,
      join_url: f.join_url || null,
      capacity: f.capacity ? Number(f.capacity) : null,
      facilitator: f.facilitator || null,
      training_requirement_id: f.training_requirement_id || null,
    };
    try {
      if (training) await api.updateTraining(training.training_id, body);
      else await api.createTraining(body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={training ? "Edit session" : "Schedule a training"}
      description="A session has a time, a way in, and — optionally — the qualification it satisfies."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Title")} required>
          <Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Forklift safety" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Starts")} hint="Local time.">
            <Input type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} />
          </Field>
          <Field label={tr("Ends")}>
            <Input type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mode">
            <Select value={f.mode} onChange={(e) => set("mode", e.target.value)}>
              <option value="IN_PERSON">In person</option>
              <option value="ONLINE">Online</option>
              <option value="HYBRID">{tr("Hybrid")}</option>
            </Select>
          </Field>
          <Field label={tr("Capacity")} hint="Leave blank for no limit.">
            <Input
              type="number"
              min="1"
              className="num text-right"
              value={f.capacity}
              onChange={(e) => set("capacity", e.target.value)}
            />
          </Field>
        </div>
        {needsRoom && (
          <Field label={tr("Location")} required>
            <Input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Training room, Douala depot" />
          </Field>
        )}
        {needsLink && (
          <Field label="Join link" required hint="Attendees join from here; the link opens 15 minutes before the start.">
            <Input
              type="url"
              value={f.join_url}
              onChange={(e) => set("join_url", e.target.value)}
              placeholder="https://meet.example.com/forklift"
            />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Facilitator">
            <Input value={f.facilitator} onChange={(e) => set("facilitator", e.target.value)} placeholder="External trainer or staff name" />
          </Field>
          <Field label="Satisfies requirement" hint="Sets the certificate expiry when one is issued.">
            <Select value={f.training_requirement_id} onChange={(e) => set("training_requirement_id", e.target.value)}>
              <option value="">{tr("— none —")}</option>
              {requirements.map((r) => (
                <option key={r.training_requirement_id} value={r.training_requirement_id}>
                  {r.title}
                  {r.valid_months ? ` (valid ${r.valid_months} months)` : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={tr("Description")}>
          <textarea
            className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm"
            rows={3}
            value={f.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!f.title || !reachable || busy}>
            {training ? "Save" : "Schedule"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ══ The open session ══════════════════════════════════════════════════════ */

function AttendeeRow({
  a,
  onToggle,
  busy,
}: {
  a: api.TrainingAttendee;
  onToggle: () => void;
  busy: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">
          {a.employee_name || a.employee_id?.slice(0, 8) || "—"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {a.joined_at ? `Joined ${dateTimeFmt(a.joined_at)}` : "Not joined"}
          {a.certificate_expires_on ? ` · certificate to ${dateFmt(a.certificate_expires_on)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* Observed vs asserted, said out loud. A tick somebody typed and a
            join the system watched are different kinds of evidence, and the
            appraisal scorer treats them differently. */}
        {a.attended && a.attendance_observed && <Pill tone="ok">Observed</Pill>}
        <Button size="sm" variant={a.attended ? "default" : "outline"} loading={busy} onClick={onToggle}>
          {a.attended ? "Attended" : "Mark attended"}
        </Button>
      </div>
    </li>
  );
}

function SessionPanel({
  trainingId,
  onClose,
  onChanged,
}: {
  trainingId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const session = useResource(() => api.getTraining(trainingId), [trainingId]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const t = session.data;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      session.reload();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  if (session.loading) return <div className="lux-card p-6 micro">Loading session…</div>;
  if (session.error) return <ErrorState message={session.error} />;
  if (!t) return null;

  const roster = t.attendees || [];
  const cap = t.capacity_state;
  const notes = t.notes || [];
  const canOpen = t.status === "SCHEDULED";
  const canClose = t.status === "SCHEDULED" || t.status === "LIVE";

  return (
    <div className="lux-card flex max-h-[calc(100vh-11rem)] flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{t.title}</p>
          <p className="text-xs text-muted-foreground">
            {t.starts_at ? dateTimeFmt(t.starts_at) : "Unscheduled"}
            {t.planned_minutes ? ` · ${t.planned_minutes} min` : ""}
            {t.mode ? ` · ${MODE_LABEL[t.mode] || t.mode}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Pill tone={STATUS_TONE[t.status] || "mute"}>{enumLabel(t.status)}</Pill>
          <button type="button" className="chip" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {/* The join link, and why it is not usable when it is not. */}
      {t.join_state && (
        <div className="flex flex-wrap items-center gap-2">
          {t.join_state.can_join && t.join_url ? (
            <a className="chip on" href={t.join_url} target="_blank" rel="noreferrer noopener">
              Open the session link
            </a>
          ) : null}
          <span className="micro">{t.join_state.message}</span>
        </div>
      )}
      {t.location && <p className="text-xs text-muted-foreground">Location: {t.location}</p>}

      <div className="flex flex-wrap gap-2">
        {canOpen && (
          <Button size="sm" loading={busy === "LIVE"} onClick={() => run("LIVE", () => api.setTrainingStatus(t.training_id, "LIVE"))}>
            Start session
          </Button>
        )}
        {canClose && (
          <Button
            size="sm"
            variant="outline"
            loading={busy === "DONE"}
            onClick={() => run("DONE", () => api.setTrainingStatus(t.training_id, "DONE"))}
          >
            End &amp; settle attendance
          </Button>
        )}
        {t.status !== "CANCELLED" && t.status !== "DONE" && (
          <Button
            size="sm"
            variant="outline"
            loading={busy === "CANCELLED"}
            onClick={() => run("CANCELLED", () => api.setTrainingStatus(t.training_id, "CANCELLED"))}
          >
            Cancel
          </Button>
        )}
      </div>

      {t.status === "LIVE" && (
        <Callout tone="info" title="Session is open">
          Attendance is being recorded from who joins. Ending the session marks
          those people attended and leaves everyone it has no evidence for
          exactly as they are — it never marks anybody absent.
        </Callout>
      )}

      {/* ── Roster ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="micro">{tr("Roster")}</p>
          <p className="micro">
            {roster.length} booked
            {cap?.capacity ? ` of ${cap.capacity}` : ""}
            {cap?.is_over ? " · over capacity" : ""}
          </p>
        </div>
        {roster.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center micro">Nobody booked yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border px-3">
            {roster.map((a) => (
              <AttendeeRow
                key={a.training_attendance_id}
                a={a}
                busy={busy === a.training_attendance_id}
                onToggle={() =>
                  run(a.training_attendance_id, () =>
                    api.setTrainingAttendee(t.training_id, a.training_attendance_id, { attended: !a.attended }),
                  )
                }
              />
            ))}
          </ul>
        )}
        {t.status !== "DONE" && t.status !== "CANCELLED" && (
          <EmployeePicker
            exclude={new Set(roster.map((a) => a.employee_id || ""))}
            disabled={!!busy || !!cap?.is_full}
            onPick={(e) => run("add", () => api.addTrainingAttendee(t.training_id, e.employee_id))}
          />
        )}
        {cap?.is_full && <p className="micro">This session is full.</p>}
      </div>

      {/* ── Notes and minutes ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <p className="micro">Notes &amp; minutes</p>
        {notes.length > 0 && (
          <ul className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
            {notes.map((n) => (
              <li key={n.training_note_id} className="text-sm">
                <span className={cn("mr-2 text-xs", n.is_minutes ? "text-[rgb(var(--ok))]" : "text-muted-foreground")}>
                  {n.is_minutes ? "Minutes" : "Note"}
                </span>
                {n.body}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was covered…" />
          <Button
            size="sm"
            variant="outline"
            disabled={!note.trim() || !!busy}
            loading={busy === "note"}
            onClick={() => run("note", async () => {
              await api.addTrainingNote(t.training_id, note.trim(), true);
              setNote("");
            })}
          >
            Add
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          loading={busy === "sum"}
          disabled={notes.length === 0 || !!busy}
          onClick={() => run("sum", () => api.summariseTraining(t.training_id))}
        >
          {t.ai_summary ? "Redraft minutes" : "Draft minutes with AI"}
        </Button>
        {t.ai_summary && (
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2">
              {/* Which produced it. A raw-notes filing must never be read as a
                  reviewed summary. */}
              <Pill tone={t.ai_model && t.ai_model !== "notes" ? "blue" : "mute"}>
                {t.ai_model && t.ai_model !== "notes" ? `Drafted by ${t.ai_model}` : "Your notes, filed as-is"}
              </Pill>
            </div>
            <Markdown text={t.ai_summary} />
          </div>
        )}
      </div>

      {error && <ErrorState message={error} />}
    </div>
  );
}

/* ══ Requirements & compliance ═════════════════════════════════════════════ */

function RequirementForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ title: "", department: "", job_title: "", valid_months: "", warn_days: "30" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title="New requirement"
      description="A rule about a role — who must hold this, and for how long it lasts."
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.createTrainingRequirement({
              title: f.title,
              department: f.department || null,
              job_title: f.job_title || null,
              valid_months: f.valid_months ? Number(f.valid_months) : null,
              warn_days: f.warn_days ? Number(f.warn_days) : 30,
            });
            onSaved();
            onClose();
          } catch (err) {
            setError(errMsg(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={tr("Title")} required>
          <Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Manual handling" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Department")} hint="Blank means everybody.">
            <Input value={f.department} onChange={(e) => set("department", e.target.value)} />
          </Field>
          <Field label={tr("Job title")} hint="Blank means every role in the department.">
            <Input value={f.job_title} onChange={(e) => set("job_title", e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valid for (months)" hint="Blank means it never lapses.">
            <Input type="number" min="1" className="num text-right" value={f.valid_months} onChange={(e) => set("valid_months", e.target.value)} />
          </Field>
          <Field label="Warn (days before)" hint="How much notice you need to book a refresher.">
            <Input type="number" min="0" className="num text-right" value={f.warn_days} onChange={(e) => set("warn_days", e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!f.title || busy}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CompliancePanel() {
  const reqs = useResource(() => api.listTrainingRequirements(), []);
  const [picked, setPicked] = React.useState<string>("");
  const [creating, setCreating] = React.useState(false);
  const rows = reqs.data || [];
  const active = picked || rows[0]?.training_requirement_id || "";
  const compliance = useResource(
    () => (active ? api.getTrainingCompliance(active) : Promise.resolve(null)),
    [active],
  );
  const c = compliance.data;

  if (reqs.error) return <ErrorState message={reqs.error} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[16rem] flex-1">
          <label className="micro" htmlFor="req-pick">
            Requirement
          </label>
          <Select id="req-pick" value={active} onChange={(e) => setPicked(e.target.value)}>
            {rows.map((r) => (
              <option key={r.training_requirement_id} value={r.training_requirement_id}>
                {r.title}
                {r.department ? ` — ${r.department}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="outline" onClick={() => setCreating(true)}>
          New requirement
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No training requirements"
          hint="A requirement states who must hold a qualification and how long it lasts. Without one, compliance can only be answered backwards — who came to a course — never who was supposed to."
          action={<Button onClick={() => setCreating(true)}>New requirement</Button>}
        />
      ) : compliance.loading ? (
        <p className="micro">Working out who is current…</p>
      ) : compliance.error ? (
        <ErrorState message={compliance.error} />
      ) : c ? (
        <>
          {/* Named counts rather than a percentage. "4 expired" is actionable;
              "87% compliant" is a number for a slide. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(Object.keys(COMPLIANCE_LABEL) as api.ComplianceStatus[]).map((k) => (
              <div key={k} className="lux-card p-3">
                <p className="micro">{COMPLIANCE_LABEL[k]}</p>
                <p className="num text-xl text-foreground">{c.counts[k] ?? 0}</p>
              </div>
            ))}
          </div>
          <DataList
            columns={
              [
                {
                  key: "name",
                  label: "Employee",
                  render: (p) => <span className="font-medium text-foreground">{p.full_name || "—"}</span>,
                },
                { key: "role", label: "Role", render: (p) => <span className="text-muted-foreground">{p.job_title || "—"}</span> },
                {
                  key: "last",
                  label: "Last passed",
                  render: (p) => (
                    <span className="num text-muted-foreground">{p.attended_on ? dateFmt(p.attended_on) : "—"}</span>
                  ),
                },
                {
                  key: "exp",
                  label: "Expires",
                  render: (p) => (
                    <span className="num text-muted-foreground">{p.expires_on ? dateFmt(p.expires_on) : "—"}</span>
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  render: (p) => (
                    <span className="flex items-center gap-2">
                      <Pill tone={COMPLIANCE_TONE[p.status]}>{COMPLIANCE_LABEL[p.status]}</Pill>
                      {p.days_remaining != null && p.status === "EXPIRING" && (
                        <span className="micro">{p.days_remaining} d</span>
                      )}
                    </span>
                  ),
                },
              ] as Column<api.TrainingCompliance["people"][number]>[]
            }
            rows={c.people}
            error={compliance.error}
            loading={compliance.loading}
            rowKey={(p) => p.employee_id}
            empty={{
              title: "Nobody is covered by this requirement",
              hint: "Narrow it by department or job title, or leave both blank to cover all staff.",
            }}
          />
        </>
      ) : null}

      {creating && <RequirementForm onClose={() => setCreating(false)} onSaved={reqs.reload} />}
    </div>
  );
}

/* ══ Page ══════════════════════════════════════════════════════════════════ */

export function TrainingsPage() {
  const trainings = useResource(() => api.listTrainings(), []);
  const requirements = useResource(() => api.listTrainingRequirements(), []);
  const [tab, setTab] = React.useState<"sessions" | "compliance">("sessions");
  const [editing, setEditing] = React.useState<api.Training | null | undefined>(undefined);
  const [openId, setOpenId] = React.useState<string | null>(null);

  // THE dark-screen case. The backend has always sent the discriminator and the
  // screen used to throw it away — the difference between "the tenant does not
  // have this" and "you do not have the grant" sends an administrator to two
  // completely different places, and one of them is the wrong one.
  const gated = isFeatureDisabled(trainings.errorCode);

  const cols: Column<api.Training>[] = [
    {
      key: "title",
      label: "Session",
      render: (t) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{t.title || "—"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t.mode ? MODE_LABEL[t.mode] || t.mode : ""}
            {t.location ? ` · ${t.location}` : ""}
            {t.requirement_title ? ` · ${t.requirement_title}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "when",
      label: "When",
      render: (t) => (
        <span className="num text-muted-foreground">{t.starts_at ? dateTimeFmt(t.starts_at) : "—"}</span>
      ),
    },
    {
      key: "fac",
      label: "Facilitator",
      render: (t) => <span className="text-muted-foreground">{t.facilitator || t.facilitator_name || "—"}</span>,
    },
    {
      key: "roster",
      label: "Roster",
      render: (t) => (
        <span className="num text-muted-foreground">
          {num(t.attended_count)}/{num(t.booked_count)}
          {t.capacity ? ` of ${t.capacity}` : ""}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (t) => <Pill tone={STATUS_TONE[t.status] || "mute"}>{enumLabel(t.status)}</Pill>,
    },
    {
      key: "_a",
      label: "",
      render: (t) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
            Edit
          </Button>
          <Button size="sm" variant={t.status === "LIVE" ? "default" : "outline"} onClick={() => setOpenId(t.training_id)}>
            {t.status === "LIVE" ? "Open live" : "Open"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Human capital" to="/hr" />}
        title={tr("Trainings")}
        description="Schedule sessions, run them, and see who holds a current qualification."
        action={<Button onClick={() => setEditing(null)}>Schedule training</Button>}
      />
      <HubTabs />

      {gated ? (
        <Callout tone="warn" title="Training is not enabled for this workspace">
          The module is switched off in the platform console. An administrator
          can enable it there — this is not a permissions problem, so a role
          change will not help.
        </Callout>
      ) : (
        <>
          <div className="flex gap-2">
            <button type="button" className={cn("chip", tab === "sessions" && "on")} onClick={() => setTab("sessions")}>
              Sessions
            </button>
            <button type="button" className={cn("chip", tab === "compliance" && "on")} onClick={() => setTab("compliance")}>
              Who is current
            </button>
          </div>

          {tab === "compliance" ? (
            <CompliancePanel />
          ) : (
            /* Desktop: list and open session side by side, so opening one does
               not hide the list you are working down. Below xl the detail moves
               under the list rather than squeezing both. */
            <div className={cn("grid gap-4", openId && "xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]")}>
              <DataList
                columns={cols}
                rows={trainings.data}
                error={trainings.error}
                loading={trainings.loading}
                rowKey={(t) => t.training_id}
                empty={{
                  title: "No trainings",
                  hint: "Schedule a session to get started.",
                }}
              />
              {openId && (
                <SessionPanel
                  trainingId={openId}
                  onClose={() => setOpenId(null)}
                  onChanged={trainings.reload}
                />
              )}
            </div>
          )}
        </>
      )}

      {editing !== undefined && (
        <ScheduleForm
          training={editing}
          requirements={requirements.data || []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            trainings.reload();
            requirements.reload();
          }}
        />
      )}
      <ScreenAi path="hr/trainings" />
    </section>
  );
}

export default TrainingsPage;
