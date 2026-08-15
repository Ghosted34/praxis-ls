/**
 * Sales & CRM — Meetings, and the per-meeting notes drawer.
 *
 * Split out of `features/sales/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { SearchSelect } from "@/components/ui/search-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs } from "@/components/ui/tabs";
import { DiscoveryCapture } from "@/features/sales/meeting-discovery";
import { DiscoveryWizard } from "@/features/sales/discovery-wizard";

/* ═══════════════════════════════════ MEETINGS ═══════════════════════════════════ */

const MEETINGS_AI: AiAction[] = [
  {
    label: "Summarise minutes",
    kind: "assist",
    describe:
      "Summarise a meeting's notes/transcript into concise minutes and action items.",
  },
  {
    label: "Draft follow-up",
    kind: "write",
    describe:
      "Draft a follow-up email from the meeting minutes (human-confirmed before send).",
  },
];

/**
 * Now, as a datetime-local input wants it — local clock, not UTC, because
 * `toISOString()` here would show a user in Douala an hour they did not mean.
 * Pre-filled for the same reason the legacy pre-fills its meeting date: this
 * is logged straight after the meeting, and a date nobody sets is a column
 * nobody can sort the register by.
 */
function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MeetingForm({
  open,
  leads,
  clients,
  onClose,
  onSaved,
}: {
  open: boolean;
  leads: Row[] | null;
  clients: Row[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [subject, setSubject] = React.useState("");
  const [withKind, setWithKind] = React.useState<"none" | "lead" | "client">(
    "none",
  );
  const [withId, setWithId] = React.useState("");
  const [scheduledAt, setScheduledAt] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSubject("");
    setWithKind("none");
    setWithId("");
    setScheduledAt(nowLocalInput());
    setLocation("");
    setError(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      subject: subject.trim(),
      scheduled_at: scheduledAt
        ? new Date(scheduledAt).toISOString()
        : undefined,
      location: location.trim() || undefined,
      lead_id: withKind === "lead" && withId ? withId : undefined,
      client_id: withKind === "client" && withId ? withId : undefined,
    };
    try {
      await tenant("/meetings", { method: "POST", body });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const selLead = (leads || []).find((l) => String(l.lead_id) === withId);
  const selClient = (clients || []).find((c) => String(c.client_id) === withId);
  const withLabel = !withId
    ? null
    : withKind === "lead"
      ? String(selLead?.company_name ?? "")
      : String(selClient?.name ?? selClient?.legal_name ?? "");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule meeting"
      description="Log a meeting against a lead or client — the CRM activity trail."
      size="lg"
    >
      <div className="space-y-4">
        <Field label="Subject" required>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Kickoff call — freight contract"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="With">
            <Select
              value={withKind}
              onChange={(e) => {
                setWithKind(e.target.value as "none" | "lead" | "client");
                setWithId("");
              }}
            >
              <option value="none">— none —</option>
              <option value="lead">Lead</option>
              <option value="client">Client</option>
            </Select>
          </Field>
          {withKind !== "none" && (
            <Field label={withKind === "lead" ? "Lead" : "Client"}>
              <SearchSelect
                path={withKind === "lead" ? "/leads" : "/clients"}
                value={withLabel}
                placeholder={
                  withKind === "lead" ? "Search leads…" : "Search clients…"
                }
                getLabel={(r) =>
                  withKind === "lead"
                    ? String(r.company_name ?? "")
                    : String(r.name ?? r.legal_name ?? "")
                }
                getKey={(r) =>
                  String(withKind === "lead" ? r.lead_id : r.client_id)
                }
                onSelect={(r) =>
                  setWithId(
                    String(withKind === "lead" ? r.lead_id : r.client_id),
                  )
                }
              />
            </Field>
          )}
          <Field label="Scheduled at">
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </Field>
          {/* The discovery wizard asks for it and the old schema had nowhere
              to put it, so it was lost at the point of capture. */}
          <Field label="Location">
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Client HQ, Douala"
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={!subject.trim() || busy}
          >
            Schedule meeting
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * One meeting, two records.
 *
 * "Client discovery" is the structured capture a proposal is later drafted from
 * — three named sections, typed or dictated. "Notes & minutes" is the ordinary
 * activity trail. They are deliberately separate: the legacy has only the free
 * box, and a proposal drafted from free text is a proposal drafted from
 * whatever the salesperson happened to write down.
 */
function MeetingDetail({
  meeting,
  onClose,
  onChanged,
}: {
  meeting: Row | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const open = !!meeting;
  const [data, setData] = React.useState<Row | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [body, setBody] = React.useState("");
  const [isMinutes, setIsMinutes] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  const [tab, setTab] = React.useState("discovery");

  React.useEffect(() => {
    if (!meeting) return;
    let live = true;
    setData(null);
    setError(null);
    setBody("");
    setIsMinutes(false);
    setTab("discovery");
    tenant<Row>(`/meetings/${String(meeting.meeting_id)}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [meeting, tick]);

  async function addNote() {
    if (!meeting || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/meetings/${String(meeting.meeting_id)}/notes`, {
        method: "POST",
        body: { body: body.trim(), is_minutes: isMinutes },
      });
      setBody("");
      setIsMinutes(false);
      setTick((t) => t + 1);
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const notes = (data?.notes as Row[] | undefined) || [];

  const notesPanel = (
    <div className="space-y-4 pt-4">
      {data === null && !error ? (
        <LoadingRow label="Loading notes…" />
      ) : (
        <div className="space-y-2">
          {notes.length === 0 ? (
            <EmptyState
              title="No notes yet"
              hint="Add the first note or minutes below."
            />
          ) : (
            notes.map((n) => (
              <div
                key={String(n.meeting_note_id)}
                className="rounded-lg border bg-muted/30 p-3"
              >
                <div className="mb-1 flex items-center gap-2">
                  {n.is_minutes ? (
                    <StatusPill status="minutes" />
                  ) : (
                    <span className="text-xs text-muted-foreground">note</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {dateFmt(n.created_at)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {cell(n.body)}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      <div className="space-y-2 border-t pt-4">
        <Field label="Add note">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What was discussed, decisions, action items…"
          />
        </Field>
        <Checkbox
          checked={isMinutes}
          onCheckedChange={(v) => setIsMinutes(v === true)}
          label="Mark as minutes"
        />
        <div className="flex justify-end">
          <Button
            onClick={addNote}
            loading={busy}
            disabled={!body.trim() || busy}
          >
            Add note
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meeting ? cell(meeting.subject) : "Meeting"}
      description="Client discovery, notes and minutes for this meeting."
      size="xl"
    >
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {meeting && (
          <Tabs
            value={tab}
            onValueChange={setTab}
            label="Meeting record"
            tabs={[
              {
                value: "discovery",
                label: "Client discovery",
                content: (
                  <div className="pt-4">
                    <DiscoveryCapture
                      meetingId={String(meeting.meeting_id)}
                    />
                  </div>
                ),
              },
              {
                value: "notes",
                label: "Notes & minutes",
                content: notesPanel,
              },
            ]}
          />
        )}
        <div className="flex justify-end border-t pt-4">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function MeetingsPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/meetings");
  const { rows: leads } = useList("/leads");
  const { rows: clients } = useList("/clients");
  const [formOpen, setFormOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<Row | null>(null);
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const leadName = React.useMemo(
    () =>
      new Map(
        (leads || []).map((l) => [String(l.lead_id), cell(l.company_name)]),
      ),
    [leads],
  );
  const clientName = React.useMemo(
    () =>
      new Map(
        (clients || []).map((c) => [
          String(c.client_id),
          cell(c.name ?? c.legal_name),
        ]),
      ),
    [clients],
  );

  function withLabel(r: Row): string {
    if (r.lead_id) return `Lead · ${leadName.get(String(r.lead_id)) ?? "—"}`;
    if (r.client_id)
      return `Client · ${clientName.get(String(r.client_id)) ?? "—"}`;
    return "—";
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Meetings"
        description="Scheduling and minutes against a lead or client — the CRM activity log."
        action={
          <div className="flex gap-2">
            {/* "Live meeting" is the business's own name for this — it is what
                the legacy button says, and what F1 is called. A label invented
                here ("Capture discovery") would be a second name for a thing
                the people using it already have a word for. First, and primary:
                the diagnostic is the reason to be on this screen after a client
                visit. Scheduling is the lesser action. */}
            <Button onClick={() => setWizardOpen(true)}>Live meeting</Button>
            <Button variant="outline" onClick={() => setFormOpen(true)}>
              Schedule meeting
            </Button>
          </div>
        }
      />
      <HubTabs />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No meetings yet"
          hint="Schedule the first meeting against a lead or client."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <button
              key={String(r.meeting_id)}
              type="button"
              onClick={() => setDetail(r)}
              className="lux-card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-primary/40"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-ink">
                <svg
                  viewBox="0 0 24 24"
                  width={16}
                  height={16}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {cell(r.subject)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {withLabel(r)}
                </p>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:block">
                {r.scheduled_at
                  ? new Date(String(r.scheduled_at)).toLocaleString()
                  : "Unscheduled"}
              </span>
            </button>
          ))}
        </div>
      )}

      <AiActions actions={MEETINGS_AI} />

      <DiscoveryWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSaved={(meeting) => {
          reload();
          // Straight into the meeting's own discovery tab: the sections just
          // typed are there, and so are the microphones the wizard cannot
          // offer before the record exists.
          setDetail(meeting);
        }}
      />
      <MeetingForm
        open={formOpen}
        leads={leads}
        clients={clients}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
      />
      <MeetingDetail
        meeting={detail}
        onClose={() => setDetail(null)}
        onChanged={reload}
      />
    </section>
  );
}
