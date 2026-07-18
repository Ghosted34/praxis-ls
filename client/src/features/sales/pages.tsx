/**
 * Sales & CRM — funnel screens wired to live endpoints.
 *   - LeadsPage         → /leads  (+ folded-in Inbound intake, /inbound)
 *   - MeetingsPage      → /meetings (+ /:id notes)
 *   - OpportunitiesPage → /opportunities (Kanban board + list; move/win/lose)
 *
 * Design: the Pixie "Hub" CRM reference (dark command-centre) — tabbed header,
 * a filter-chip row and avatar list-rows for the funnel — re-expressed through
 * the app's own --primary design tokens (lux-card, status pills) rather than the
 * mock's crimson, so it re-tints per tenant like every other screen.
 *
 * Intake is folded in here as a tab (not a standalone screen): the leads list is
 * the funnel, inbound enquiries/partnerships are its raw feed, and triage flows
 * one straight into the other. /sales/inbound-intake now redirects to ?tab=intake.
 *
 * AI panels are gated globally (components/ai-actions.tsx).
 */
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { Row, errMsg, cell, when, fmtMoney, useList, Badge, Segmented, Chips, Avatar, MetricTile, SearchSelect } from "./ui";

/* ═══════════════════════════════════ LEADS ═══════════════════════════════════ */

const LEADS_AI: AiAction[] = [
  { label: "Triage inbound enquiry", kind: "assist", describe: "Triage an enquiry into a qualified lead (optionally converting it)." },
  { label: "Suggest next action", kind: "assist", describe: "Suggest the next best action for a stale lead based on its history." },
  { label: "Draft outreach", kind: "write", describe: "Draft a first-contact email for a new lead (human-confirmed before send)." },
];

const LEAD_SOURCES = ["MANUAL", "WEBSITE", "REFERRAL", "CAMPAIGN"];
const LEAD_FILTERS = [
  { value: "", label: "All leads" },
  { value: "NEW", label: "New" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "QUALIFIED", label: "Qualified" },
  { value: "CONVERTED", label: "Converted" },
  { value: "LOST", label: "Lost" },
];
const NEXT_STATUS: Record<string, string> = { NEW: "CONTACTED", CONTACTED: "QUALIFIED" };

function LeadForm({ open, editing, onClose, onSaved }: { open: boolean; editing: Row | null; onClose: () => void; onSaved: () => void }) {
  const [company, setCompany] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [source, setSource] = React.useState("MANUAL");
  const [interest, setInterest] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCompany(editing?.company_name ? String(editing.company_name) : "");
    setContact(editing?.contact_name ? String(editing.contact_name) : "");
    setEmail(editing?.email ? String(editing.email) : "");
    setPhone(editing?.phone ? String(editing.phone) : "");
    setSource(editing?.source ? String(editing.source) : "MANUAL");
    setInterest(editing?.service_interest ? String(editing.service_interest) : "");
    setError(null);
  }, [open, editing]);

  const canSubmit = !!company.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      company_name: company.trim(),
      contact_name: contact.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      source,
      service_interest: interest.trim() || undefined,
    };
    try {
      if (editing) await tenant(`/leads/${String(editing.lead_id)}`, { method: "PATCH", body });
      else await tenant("/leads", { method: "POST", body });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit lead" : "Capture lead"} description="Top of the sales funnel — qualify, then convert into a client." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" required className="sm:col-span-2" hint="Search existing clients, or type a new company">
            <SearchSelect
              path="/clients"
              value={company || null}
              placeholder="Search clients or type a new company…"
              getLabel={(r) => String(r.name ?? "")}
              getKey={(r) => String(r.client_id ?? r.name)}
              onSelect={(r) => setCompany(String(r.name ?? ""))}
              allowFreeText
              onFreeText={(t) => setCompany(t)}
            />
          </Field>
          <Field label="Contact name">
            <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Service interest" hint="What they're after">
            <Input value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="Freight forwarding" />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme.cm" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+237 6XX XXX XXX" />
          </Field>
          <Field label="Source">
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {editing ? "Save changes" : "Capture lead"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ConvertModal({ lead, onClose, onDone }: { lead: Row | null; onClose: () => void; onDone: () => void }) {
  const open = !!lead;
  const [legalName, setLegalName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!lead) return;
    setLegalName(lead.company_name ? String(lead.company_name) : "");
    setEmail(lead.email ? String(lead.email) : "");
    setPhone(lead.phone ? String(lead.phone) : "");
    setError(null);
  }, [lead]);

  async function submit() {
    if (!lead) return;
    setBusy(true);
    setError(null);
    const client: Record<string, unknown> = {
      legal_name: legalName.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
    };
    try {
      await tenant(`/leads/${String(lead.lead_id)}/convert`, { method: "POST", body: { client } });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Convert to client" description="Promote this qualified lead into the client master and link it back(→).">
      <div className="space-y-4">
        <div className="grid gap-4">
          <Field label="Legal name" required>
            <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Acme Logistics SARL" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!legalName.trim() || busy}>
            Convert to client
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function LeadsTab() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/leads", nonce);
  const [filter, setFilter] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [converting, setConverting] = React.useState<Row | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  async function transition(id: string, to: string) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/leads/${id}/transition`, { method: "POST", body: { to } });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (filter && String(r.status) !== filter) return false;
      if (!q) return true;
      return [r.company_name, r.contact_name, r.email].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a lead — company, contact, email…" />
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Capture lead
        </Button>
      </div>
      <Chips value={filter} options={LEAD_FILTERS} onChange={setFilter} />

      {rowError && <ErrorState message={rowError} />}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow label="Loading leads…" />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length ? "No leads match" : "No leads yet"} hint={rows.length ? "Try a different filter or search." : "Capture your first lead, or triage an inbound enquiry into one."} />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const id = String(r.lead_id);
            const status = String(r.status || "NEW");
            const next = NEXT_STATUS[status];
            const terminal = status === "CONVERTED" || status === "LOST";
            return (
              <div key={id} className="lux-card flex items-center gap-3 p-3">
                <Avatar name={String(r.company_name || "?")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{cell(r.company_name)}</p>
                    <Badge label={status} />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[cell(r.contact_name), cell(r.email)].filter((x) => x !== "—").join(" · ") || "No contact details"}
                    {r.service_interest ? ` · ${cell(r.service_interest)}` : ""}
                  </p>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:block">{cell(r.source).toLowerCase()}</span>
                {!terminal && (
                  <div className="flex gap-2">
                    {status === "QUALIFIED" ? (
                      <Button size="sm" onClick={() => setConverting(r)}>
                        Convert
                      </Button>
                    ) : next ? (
                      <Button size="sm" variant="outline" loading={rowBusy === id} onClick={() => transition(id, next)}>
                        {next === "CONTACTED" ? "Mark contacted" : "Qualify"}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" disabled={rowBusy === id} onClick={() => transition(id, "LOST")}>
                      Lost
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <LeadForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={reload} />
      <ConvertModal lead={converting} onClose={() => setConverting(null)} onDone={reload} />
    </div>
  );
}

/* ═══════════════════════════════ INBOUND INTAKE ═══════════════════════════════ */

function TriageModal({ enquiry, onClose, onDone }: { enquiry: Row | null; onClose: () => void; onDone: () => void }) {
  const open = !!enquiry;
  const [toLead, setToLead] = React.useState(true);
  const [close, setClose] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enquiry) return;
    setToLead(true);
    setClose(false);
    setError(null);
  }, [enquiry]);

  async function submit() {
    if (!enquiry) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/inbound/enquiries/${String(enquiry.contact_enquiry_id)}/triage`, { method: "POST", body: { to_lead: toLead, close } });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Triage enquiry" description="Route this website/email enquiry into the funnel.">
      <div className="space-y-4">
        {enquiry && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{cell(enquiry.subject) === "—" ? "(no subject)" : cell(enquiry.subject)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {[cell(enquiry.name), cell(enquiry.email)].filter((x) => x !== "—").join(" · ") || "Anonymous"}
            </p>
            {enquiry.message ? <p className="mt-2 text-xs text-muted-foreground">{cell(enquiry.message)}</p> : null}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={toLead} onChange={(e) => setToLead(e.target.checked)} />
          Create a lead from this enquiry
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} />
          Close the enquiry (no further action)
        </label>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Triage
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReviewModal({ partnership, onClose, onDone }: { partnership: Row | null; onClose: () => void; onDone: () => void }) {
  const open = !!partnership;
  const [status, setStatus] = React.useState("REVIEWING");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!partnership) return;
    setStatus("REVIEWING");
    setError(null);
  }, [partnership]);

  async function submit() {
    if (!partnership) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/inbound/partnerships/${String(partnership.partnership_request_id)}/review`, { method: "POST", body: { status } });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Review partnership request" description="Decide on an inbound partnership proposal.">
      <div className="space-y-4">
        {partnership && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{cell(partnership.company_name)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{[cell(partnership.contact_name), cell(partnership.email)].filter((x) => x !== "—").join(" · ") || "—"}</p>
            {partnership.proposal_text ? <p className="mt-2 text-xs text-muted-foreground">{cell(partnership.proposal_text)}</p> : null}
          </div>
        )}
        <Field label="Decision">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="REVIEWING">Reviewing</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="DECLINED">Declined</option>
          </Select>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Save decision
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function IntakeTab() {
  const [sub, setSub] = React.useState<"enquiries" | "partnerships">("enquiries");
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows: enquiries, error: enqErr } = useList("/inbound/enquiries", nonce, sub === "enquiries");
  const { rows: partnerships, error: partErr } = useList("/inbound/partnerships", nonce, sub === "partnerships");
  const [triaging, setTriaging] = React.useState<Row | null>(null);
  const [reviewing, setReviewing] = React.useState<Row | null>(null);

  return (
    <div className="space-y-4">
      <Segmented
        value={sub}
        onChange={setSub}
        options={[
          { value: "enquiries", label: "Enquiries" },
          { value: "partnerships", label: "Partnership requests" },
        ]}
      />

      {sub === "enquiries" ? (
        enqErr ? (
          <ErrorState message={enqErr} />
        ) : enquiries === null ? (
          <LoadingRow label="Loading enquiries…" />
        ) : enquiries.length === 0 ? (
          <EmptyState title="No enquiries" hint="Contact-form and email enquiries land here for triage into leads." />
        ) : (
          <div className="space-y-2">
            {enquiries.map((r) => {
              const done = String(r.status) === "TRIAGED" || String(r.status) === "CLOSED";
              return (
                <div key={String(r.contact_enquiry_id)} className="lux-card flex items-center gap-3 p-3">
                  <Avatar name={String(r.name || r.email || "?")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{cell(r.subject) === "—" ? "(no subject)" : cell(r.subject)}</p>
                      <Badge label={String(r.status || "NEW")} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {[cell(r.name), cell(r.email)].filter((x) => x !== "—").join(" · ") || "Anonymous"} · {cell(r.source).toLowerCase()} · {when(r.created_at)}
                    </p>
                  </div>
                  {!done && (
                    <Button size="sm" variant="outline" onClick={() => setTriaging(r)}>
                      Triage
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : partErr ? (
        <ErrorState message={partErr} />
      ) : partnerships === null ? (
        <LoadingRow label="Loading partnership requests…" />
      ) : partnerships.length === 0 ? (
        <EmptyState title="No partnership requests" hint="Inbound partnership proposals land here for review." />
      ) : (
        <div className="space-y-2">
          {partnerships.map((r) => (
            <div key={String(r.partnership_request_id)} className="lux-card flex items-center gap-3 p-3">
              <Avatar name={String(r.company_name || "?")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{cell(r.company_name)}</p>
                  <Badge label={String(r.status || "NEW")} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {[cell(r.contact_name), cell(r.email)].filter((x) => x !== "—").join(" · ") || "—"} · {when(r.created_at)}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setReviewing(r)}>
                Review
              </Button>
            </div>
          ))}
        </div>
      )}

      <TriageModal enquiry={triaging} onClose={() => setTriaging(null)} onDone={reload} />
      <ReviewModal partnership={reviewing} onClose={() => setReviewing(null)} onDone={reload} />
    </div>
  );
}

/* ─────────────────────────────── Leads page (tabbed) ─────────────────────────────── */

export function LeadsPage() {
  const initialTab = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "intake" ? "intake" : "leads";
  const [tab, setTab] = React.useState<"leads" | "intake">(initialTab as "leads" | "intake");

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5">
        <h1 className="font-display text-2xl tracking-tight">Leads & intake</h1>
        <p className="mt-1 text-sm text-muted-foreground">The top of the sales funnel — capture and qualify leads, and triage inbound enquiries into them(·).</p>
      </header>

      <div className="mb-5">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "leads", label: "Leads" },
            { value: "intake", label: "Inbound intake" },
          ]}
        />
      </div>

      {tab === "leads" ? <LeadsTab /> : <IntakeTab />}

      <AiActions actions={LEADS_AI} />
    </section>
  );
}

/* ═══════════════════════════════════ MEETINGS ═══════════════════════════════════ */

const MEETINGS_AI: AiAction[] = [
  { label: "Summarise minutes", kind: "assist", describe: "Summarise a meeting's notes/transcript into concise minutes and action items." },
  { label: "Draft follow-up", kind: "write", describe: "Draft a follow-up email from the meeting minutes (human-confirmed before send)." },
];

function MeetingForm({ open, leads, clients, onClose, onSaved }: { open: boolean; leads: Row[] | null; clients: Row[] | null; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = React.useState("");
  const [withKind, setWithKind] = React.useState<"none" | "lead" | "client">("none");
  const [withId, setWithId] = React.useState("");
  const [scheduledAt, setScheduledAt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSubject("");
    setWithKind("none");
    setWithId("");
    setScheduledAt("");
    setError(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      subject: subject.trim(),
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
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
  const withLabel = !withId ? null : withKind === "lead" ? String(selLead?.company_name ?? "") : String(selClient?.name ?? selClient?.legal_name ?? "");

  return (
    <Modal open={open} onClose={onClose} title="Schedule meeting" description="Log a meeting against a lead or client — the CRM activity trail." size="lg">
      <div className="space-y-4">
        <Field label="Subject" required>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Kickoff call — freight contract" />
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
                placeholder={withKind === "lead" ? "Search leads…" : "Search clients…"}
                getLabel={(r) => (withKind === "lead" ? String(r.company_name ?? "") : String(r.name ?? r.legal_name ?? ""))}
                getKey={(r) => String(withKind === "lead" ? r.lead_id : r.client_id)}
                onSelect={(r) => setWithId(String(withKind === "lead" ? r.lead_id : r.client_id))}
              />
            </Field>
          )}
          <Field label="Scheduled at" className={withKind === "none" ? "sm:col-span-2" : undefined}>
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!subject.trim() || busy}>
            Schedule meeting
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MeetingDetail({ meeting, onClose, onChanged }: { meeting: Row | null; onClose: () => void; onChanged: () => void }) {
  const open = !!meeting;
  const [data, setData] = React.useState<Row | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [body, setBody] = React.useState("");
  const [isMinutes, setIsMinutes] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!meeting) return;
    let live = true;
    setData(null);
    setError(null);
    setBody("");
    setIsMinutes(false);
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
      await tenant(`/meetings/${String(meeting.meeting_id)}/notes`, { method: "POST", body: { body: body.trim(), is_minutes: isMinutes } });
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

  return (
    <Modal open={open} onClose={onClose} title={meeting ? cell(meeting.subject) : "Meeting"} description="Notes and minutes for this meeting." size="lg">
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {data === null && !error ? (
          <LoadingRow label="Loading notes…" />
        ) : (
          <div className="space-y-2">
            {notes.length === 0 ? (
              <EmptyState title="No notes yet" hint="Add the first note or minutes below." />
            ) : (
              notes.map((n) => (
                <div key={String(n.meeting_note_id)} className="rounded-lg border bg-muted/30 p-3">
                  <div className="mb-1 flex items-center gap-2">
                    {n.is_minutes ? <Badge label="minutes" /> : <span className="text-xs text-muted-foreground">note</span>}
                    <span className="text-xs text-muted-foreground">{when(n.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{cell(n.body)}</p>
                </div>
              ))
            )}
          </div>
        )}

        <div className="space-y-2 border-t pt-4">
          <Field label="Add note">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              placeholder="What was discussed, decisions, action items…"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isMinutes} onChange={(e) => setIsMinutes(e.target.checked)} />
            Mark as minutes
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button onClick={addNote} loading={busy} disabled={!body.trim() || busy}>
              Add note
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function MeetingsPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/meetings", nonce);
  const { rows: leads } = useList("/leads", nonce);
  const { rows: clients } = useList("/clients", nonce);
  const [formOpen, setFormOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<Row | null>(null);

  const leadName = React.useMemo(() => new Map((leads || []).map((l) => [String(l.lead_id), cell(l.company_name)])), [leads]);
  const clientName = React.useMemo(() => new Map((clients || []).map((c) => [String(c.client_id), cell(c.name ?? c.legal_name)])), [clients]);

  function withLabel(r: Row): string {
    if (r.lead_id) return `Lead · ${leadName.get(String(r.lead_id)) ?? "—"}`;
    if (r.client_id) return `Client · ${clientName.get(String(r.client_id)) ?? "—"}`;
    return "—";
  }

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Meetings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Scheduling and minutes against a lead or client — the CRM activity log.</p>
        </div>
        <Button onClick={() => setFormOpen(true)}>Schedule meeting</Button>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow label="Loading meetings…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No meetings yet" hint="Schedule the first meeting against a lead or client." />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <button
              key={String(r.meeting_id)}
              type="button"
              onClick={() => setDetail(r)}
              className="lux-card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-primary/40"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{cell(r.subject)}</p>
                <p className="truncate text-xs text-muted-foreground">{withLabel(r)}</p>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:block">{r.scheduled_at ? new Date(String(r.scheduled_at)).toLocaleString() : "Unscheduled"}</span>
            </button>
          ))}
        </div>
      )}

      <AiActions actions={MEETINGS_AI} />

      <MeetingForm open={formOpen} leads={leads} clients={clients} onClose={() => setFormOpen(false)} onSaved={reload} />
      <MeetingDetail meeting={detail} onClose={() => setDetail(null)} onChanged={reload} />
    </section>
  );
}

/* ═══════════════════════════════ OPPORTUNITIES ═══════════════════════════════ */

const OPP_AI: AiAction[] = [
  { label: "Pipeline health", kind: "read", describe: "Summarise the open pipeline — stage counts, weighted value and stalled deals." },
  { label: "Move / create opportunity", kind: "write", describe: "Create an opportunity or move it to another stage (human-confirmed)." },
  { label: "Win / lose", kind: "write", describe: "Mark an opportunity won (optionally open a delivery dossier) or lost." },
];

function OpportunityForm({ open, editing, stages, leads, clients, onClose, onSaved }: { open: boolean; editing: Row | null; stages: Row[] | null; leads: Row[] | null; clients: Row[] | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState("");
  const [withKind, setWithKind] = React.useState<"none" | "lead" | "client">("none");
  const [withId, setWithId] = React.useState("");
  const [stageId, setStageId] = React.useState("");
  const [value, setValue] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [probability, setProbability] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const openStages = React.useMemo(() => (stages || []).filter((s) => !s.is_won && !s.is_lost), [stages]);

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ? String(editing.name) : "");
    setWithKind(editing?.client_id ? "client" : editing?.lead_id ? "lead" : "none");
    setWithId(editing?.client_id ? String(editing.client_id) : editing?.lead_id ? String(editing.lead_id) : "");
    setStageId(editing?.pipeline_stage_id ? String(editing.pipeline_stage_id) : String(openStages[0]?.pipeline_stage_id ?? ""));
    setValue(editing?.estimated_value != null ? String(editing.estimated_value) : "");
    setCurrency(editing?.currency ? String(editing.currency) : "XAF");
    setProbability(editing?.probability != null ? String(editing.probability) : "");
    setError(null);
  }, [open, editing, openStages]);

  async function submit() {
    setBusy(true);
    setError(null);
    const common: Record<string, unknown> = {
      name: name.trim(),
      estimated_value: value === "" ? undefined : Number(value),
      currency: currency.trim().toUpperCase() || "XAF",
      probability: probability === "" ? undefined : Number(probability),
    };
    try {
      if (editing) {
        await tenant(`/opportunities/${String(editing.opportunity_id)}`, { method: "PATCH", body: common });
      } else {
        await tenant("/opportunities", {
          method: "POST",
          body: {
            ...common,
            pipeline_stage_id: stageId || undefined,
            lead_id: withKind === "lead" && withId ? withId : undefined,
            client_id: withKind === "client" && withId ? withId : undefined,
          },
        });
      }
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
  const withLabel = !withId ? null : withKind === "lead" ? String(selLead?.company_name ?? "") : String(selClient?.name ?? selClient?.legal_name ?? "");

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit opportunity" : "New opportunity"} description="A deal in the sales pipeline — value × probability drives the weighted forecast." size="lg">
      <div className="space-y-4">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme — Q3 freight contract" />
        </Field>
        {!editing && (
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
            {withKind !== "none" ? (
              <Field label={withKind === "lead" ? "Lead" : "Client"}>
                <SearchSelect
                  path={withKind === "lead" ? "/leads" : "/clients"}
                  value={withLabel}
                  placeholder={withKind === "lead" ? "Search leads…" : "Search clients…"}
                  getLabel={(r) => (withKind === "lead" ? String(r.company_name ?? "") : String(r.name ?? r.legal_name ?? ""))}
                  getKey={(r) => String(withKind === "lead" ? r.lead_id : r.client_id)}
                  onSelect={(r) => setWithId(String(withKind === "lead" ? r.lead_id : r.client_id))}
                />
              </Field>
            ) : (
              <Field label="Stage">
                <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  {openStages.map((s) => (
                    <option key={String(s.pipeline_stage_id)} value={String(s.pipeline_stage_id)}>
                      {cell(s.name)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {withKind !== "none" && (
              <Field label="Stage" className="sm:col-span-2">
                <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  {openStages.map((s) => (
                    <option key={String(s.pipeline_stage_id)} value={String(s.pipeline_stage_id)}>
                      {cell(s.name)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Estimated value">
            <Input type="number" min="0" step="1" className="num text-right" value={value} onChange={(e) => setValue(e.target.value)} placeholder="5000000" />
          </Field>
          <Field label="Currency">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="XAF" maxLength={3} />
          </Field>
          <Field label="Probability %">
            <Input type="number" min="0" max="100" step="1" className="num text-right" value={probability} onChange={(e) => setProbability(e.target.value)} placeholder="40" />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim() || busy}>
            {editing ? "Save changes" : "Create opportunity"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function WinModal({ opp, entities, onClose, onDone }: { opp: Row | null; entities: Row[] | null; onClose: () => void; onDone: () => void }) {
  const open = !!opp;
  const [createDossier, setCreateDossier] = React.useState(false);
  const [entityId, setEntityId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!opp) return;
    setCreateDossier(false);
    setEntityId("");
    setError(null);
  }, [opp]);

  async function submit() {
    if (!opp) return;
    if (createDossier && !entityId) {
      setError("Choose the entity to open the dossier under.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await tenant(`/opportunities/${String(opp.opportunity_id)}/win`, { method: "POST", body: { create_dossier: createDossier, entity_id: createDossier ? entityId : undefined } });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const winEntity = (entities || []).find((e) => String(e.entity_id) === entityId);
  const entityLabel = winEntity ? (winEntity.code ? `${cell(winEntity.code)} · ${cell(winEntity.legal_name)}` : cell(winEntity.legal_name)) : null;

  return (
    <Modal open={open} onClose={onClose} title="Mark opportunity won" description="Settle this deal — optionally open the delivery dossier and link it(→).">
      <div className="space-y-4">
        {opp && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{cell(opp.name)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{fmtMoney(opp.estimated_value, opp.currency)}</p>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={createDossier} onChange={(e) => setCreateDossier(e.target.checked)} />
          Open a delivery dossier now
        </label>
        {createDossier && (
          <Field label="Entity" hint="Which legal entity delivers this" required>
            <SearchSelect
              path="/entities"
              value={entityLabel}
              placeholder="Search entities…"
              getLabel={(en) => (en.code ? `${cell(en.code)} · ${cell(en.legal_name)}` : cell(en.legal_name))}
              getKey={(en) => String(en.entity_id)}
              onSelect={(en) => setEntityId(String(en.entity_id))}
            />
          </Field>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Mark won
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function OpportunitiesPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows: stages, error: stErr } = useList("/opportunities/stages", nonce);
  const { rows: opps, error: oppErr } = useList("/opportunities", nonce);
  const { rows: board } = useList("/opportunities/board", nonce);
  const { rows: leads } = useList("/leads", nonce);
  const { rows: clients } = useList("/clients", nonce);
  const { rows: entities } = useList("/entities", nonce);

  const [view, setView] = React.useState<"board" | "list">("board");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [winning, setWinning] = React.useState<Row | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);

  const clientName = React.useMemo(() => new Map((clients || []).map((c) => [String(c.client_id), cell(c.name ?? c.legal_name)])), [clients]);
  const leadName = React.useMemo(() => new Map((leads || []).map((l) => [String(l.lead_id), cell(l.company_name)])), [leads]);
  const boardBy = React.useMemo(() => new Map((board || []).map((b) => [String(b.pipeline_stage_id), b])), [board]);

  function withLabel(o: Row): string {
    if (o.client_id) return clientName.get(String(o.client_id)) ?? "Client";
    if (o.lead_id) return leadName.get(String(o.lead_id)) ?? "Lead";
    return "—";
  }

  const openOpps = React.useMemo(() => (opps || []).filter((o) => String(o.status) === "OPEN"), [opps]);
  const forecast = React.useMemo(() => {
    const value = openOpps.reduce((a, o) => a + (Number(o.estimated_value) || 0), 0);
    const weighted = openOpps.reduce((a, o) => a + ((Number(o.estimated_value) || 0) * (Number(o.probability) || 0)) / 100, 0);
    const won = (opps || []).filter((o) => String(o.status) === "WON").length;
    const lost = (opps || []).filter((o) => String(o.status) === "LOST").length;
    const winRate = won + lost ? Math.round((won / (won + lost)) * 100) : null;
    return { value, weighted: Math.round(weighted), open: openOpps.length, winRate };
  }, [openOpps, opps]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setRowBusy(id);
    setRowError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }
  const move = (id: string, stageId: string) => act(id, () => tenant(`/opportunities/${id}/move`, { method: "POST", body: { pipeline_stage_id: stageId } }));
  const lose = (id: string) => act(id, () => tenant(`/opportunities/${id}/lose`, { method: "POST", body: {} }));

  function onDrop(stageId: string) {
    setDragOver(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const opp = openOpps.find((o) => String(o.opportunity_id) === id);
    if (!opp || String(opp.pipeline_stage_id) === stageId) return;
    move(id, stageId);
  }

  const loading = stages === null || opps === null;
  const err = stErr || oppErr;

  return (
    <section className="mx-auto max-w-[1400px] animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Opportunities</h1>
          <p className="mt-1 text-sm text-muted-foreground">The sales pipeline — drag deals across stages; value × probability is the weighted forecast.</p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "board", label: "Board" },
              { value: "list", label: "List" },
            ]}
          />
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            New opportunity
          </Button>
        </div>
      </header>

      {/* Forecast strip (Pixie "Today" metric row) */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="Open pipeline" value={fmtMoney(forecast.value)} />
        <MetricTile label="Weighted forecast" value={fmtMoney(forecast.weighted)} accent />
        <MetricTile label="Open deals" value={String(forecast.open)} />
        <MetricTile label="Win rate" value={forecast.winRate === null ? "—" : `${forecast.winRate}%`} />
      </div>

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {err ? (
        <ErrorState message={err} />
      ) : loading ? (
        <LoadingRow label="Loading pipeline…" />
      ) : (stages || []).length === 0 ? (
        <EmptyState title="No pipeline stages configured" hint="Add pipeline stages in Settings → Pipeline stages, then deals can flow across them." />
      ) : view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {(stages || []).map((s) => {
            const sid = String(s.pipeline_stage_id);
            const cards = openOpps.filter((o) => String(o.pipeline_stage_id) === sid);
            const metric = boardBy.get(sid) as Row | undefined;
            const won = s.is_won === true;
            const lost = s.is_lost === true;
            return (
              <div
                key={sid}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(sid);
                }}
                onDragLeave={() => setDragOver((d) => (d === sid ? null : d))}
                onDrop={() => onDrop(sid)}
                className={`flex w-72 shrink-0 flex-col rounded-xl border bg-muted/20 transition-colors ${dragOver === sid ? "border-primary/60 bg-primary/5" : ""}`}
              >
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${won ? "bg-emerald-500" : lost ? "bg-rose-500" : "bg-primary"}`} />
                    <span className="text-sm font-semibold text-foreground">{cell(s.name)}</span>
                    <span className="text-xs text-muted-foreground">{cards.length}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{fmtMoney(metric?.value ?? 0)}</span>
                </div>
                <div className="flex min-h-[8rem] flex-1 flex-col gap-2 p-2">
                  {cards.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">Drop deals here</p>
                  ) : (
                    cards.map((o) => {
                      const id = String(o.opportunity_id);
                      return (
                        <div
                          key={id}
                          draggable
                          onDragStart={() => setDragId(id)}
                          onDragEnd={() => setDragId(null)}
                          className={`lux-card cursor-grab p-3 active:cursor-grabbing ${rowBusy === id ? "opacity-50" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">{cell(o.name)}</p>
                            {o.probability != null && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{cell(o.probability)}%</span>}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{withLabel(o)}</p>
                          <p className="mt-1 text-xs font-semibold text-foreground">{fmtMoney(o.estimated_value, o.currency)}</p>
                          <div className="mt-2 flex gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={rowBusy === id} onClick={() => setWinning(o)}>
                              Win
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={rowBusy === id} onClick={() => lose(id)}>
                              Lose
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                setEditing(o);
                                setFormOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List view */
        <div className="space-y-2">
          {(opps || []).length === 0 ? (
            <EmptyState title="No opportunities yet" hint="Create the first opportunity, or convert a qualified lead." />
          ) : (
            (opps || []).map((o) => {
              const id = String(o.opportunity_id);
              const settled = String(o.status) !== "OPEN";
              return (
                <div key={id} className="lux-card flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{cell(o.name)}</p>
                      <Badge label={String(o.status || "OPEN")} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {withLabel(o)} · {cell(o.stage_name)} · {o.probability != null ? `${cell(o.probability)}%` : "—"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{fmtMoney(o.estimated_value, o.currency)}</span>
                  {!settled && (
                    <div className="flex items-center gap-2">
                      <Select
                        value={String(o.pipeline_stage_id ?? "")}
                        onChange={(e) => move(id, e.target.value)}
                        className="h-8 w-40 text-xs"
                        disabled={rowBusy === id}
                      >
                        {(stages || []).map((s) => (
                          <option key={String(s.pipeline_stage_id)} value={String(s.pipeline_stage_id)}>
                            {cell(s.name)}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="outline" disabled={rowBusy === id} onClick={() => setWinning(o)}>
                        Win
                      </Button>
                      <Button size="sm" variant="ghost" disabled={rowBusy === id} onClick={() => lose(id)}>
                        Lose
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(o);
                          setFormOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <AiActions actions={OPP_AI} />

      <OpportunityForm open={formOpen} editing={editing} stages={stages} leads={leads} clients={clients} onClose={() => setFormOpen(false)} onSaved={reload} />
      <WinModal opp={winning} entities={entities} onClose={() => setWinning(null)} onDone={reload} />
    </section>
  );
}

/* ═══════════════════════════════════ PROPOSALS ═══════════════════════════════════ */

const PROPOSAL_AI: AiAction[] = [
  { label: "Draft proposal", kind: "assist", describe: "Draft a proposal — narrative sections + line items — from an opportunity or brief (human-reviewed before send)." },
  { label: "Tighten narrative", kind: "assist", describe: "Rewrite a proposal's narrative sections for clarity and tone." },
  { label: "Send / accept", kind: "write", describe: "Submit, send, reject or accept a proposal (optionally spin a quotation)." },
];

const PROPOSAL_FILTERS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "IN_REVIEW", label: "In review" },
  { value: "SENT", label: "Sent" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "REJECTED", label: "Rejected" },
];

type LineRow = { label: string; qty: string; unit_price: string };
type NarrRow = { section: string; body: string };

function lineTotal(l: { qty?: unknown; unit_price?: unknown }): number {
  return (Number(l.qty) || 0) * (Number(l.unit_price) || 0);
}

function ProposalForm({ open, editing, leads, clients, opportunities, onClose, onSaved }: { open: boolean; editing: Row | null; leads: Row[] | null; clients: Row[] | null; opportunities: Row[] | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = React.useState("");
  const [withKind, setWithKind] = React.useState<"none" | "lead" | "client">("none");
  const [withId, setWithId] = React.useState("");
  const [opportunityId, setOpportunityId] = React.useState("");
  const [aiGenerated, setAiGenerated] = React.useState(false);
  const [lines, setLines] = React.useState<LineRow[]>([]);
  const [narratives, setNarratives] = React.useState<NarrRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ? String(editing.title) : "");
    setWithKind(editing?.client_id ? "client" : editing?.lead_id ? "lead" : "none");
    setWithId(editing?.client_id ? String(editing.client_id) : editing?.lead_id ? String(editing.lead_id) : "");
    setOpportunityId(editing?.opportunity_id ? String(editing.opportunity_id) : "");
    setAiGenerated(editing?.ai_generated === true);
    const el = (editing?.lines as Row[] | undefined) || [];
    setLines(el.length ? el.map((l) => ({ label: cell(l.label) === "—" ? "" : String(l.label), qty: l.qty != null ? String(l.qty) : "1", unit_price: l.unit_price != null ? String(l.unit_price) : "0" })) : [{ label: "", qty: "1", unit_price: "0" }]);
    const en = (editing?.narratives as Row[] | undefined) || [];
    setNarratives(en.length ? en.map((n) => ({ section: String(n.section ?? ""), body: String(n.body ?? "") })) : [{ section: "Overview", body: "" }]);
    setError(null);
  }, [open, editing]);

  function setLine(i: number, patch: Partial<LineRow>) {
    setLines((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function setNarr(i: number, patch: Partial<NarrRow>) {
    setNarratives((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const total = lines.reduce((a, l) => a + lineTotal(l), 0);

  async function submit() {
    setBusy(true);
    setError(null);
    const cleanLines = lines.filter((l) => l.label.trim()).map((l) => ({ label: l.label.trim(), qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0 }));
    const cleanNarr = narratives.filter((n) => n.section.trim()).map((n, i) => ({ section: n.section.trim(), body: n.body, sort_order: i }));
    try {
      if (editing) {
        await tenant(`/proposals/${String(editing.proposal_id)}`, {
          method: "PATCH",
          body: { title: title.trim(), opportunity_id: opportunityId || null, lines: cleanLines, narratives: cleanNarr },
        });
      } else {
        await tenant("/proposals", {
          method: "POST",
          body: {
            title: title.trim(),
            lead_id: withKind === "lead" && withId ? withId : undefined,
            client_id: withKind === "client" && withId ? withId : undefined,
            opportunity_id: opportunityId || undefined,
            ai_generated: aiGenerated,
            lines: cleanLines,
            narratives: cleanNarr,
          },
        });
      }
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
  const withLabel = !withId ? null : withKind === "lead" ? String(selLead?.company_name ?? "") : String(selClient?.name ?? selClient?.legal_name ?? "");

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit proposal" : "New proposal"} description="Narrative sections + priced line items — drafted, reviewed, then sent." size="xl">
      <div className="space-y-4">
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Freight & customs — Acme 2026" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {editing ? (
            <Field label="With">
              <Input value={withKind === "none" ? "—" : `${withKind === "lead" ? "Lead" : "Client"} (linked)`} disabled />
            </Field>
          ) : (
            <>
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
                    placeholder={withKind === "lead" ? "Search leads…" : "Search clients…"}
                    getLabel={(r) => (withKind === "lead" ? String(r.company_name ?? "") : String(r.name ?? r.legal_name ?? ""))}
                    getKey={(r) => String(withKind === "lead" ? r.lead_id : r.client_id)}
                    onSelect={(r) => setWithId(String(withKind === "lead" ? r.lead_id : r.client_id))}
                  />
                </Field>
              )}
            </>
          )}
          <Field label="Opportunity" hint="Optional — link to a pipeline deal">
            <Select value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
              <option value="">— none —</option>
              {(opportunities || []).map((o) => (
                <option key={String(o.opportunity_id)} value={String(o.opportunity_id)}>
                  {cell(o.name)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Narrative sections */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Narrative sections</p>
            <Button size="sm" variant="ghost" onClick={() => setNarratives((n) => [...n, { section: "", body: "" }])}>
              + Section
            </Button>
          </div>
          {narratives.map((n, i) => (
            <div key={i} className="rounded-lg border p-2">
              <div className="flex items-center gap-2">
                <Input value={n.section} onChange={(e) => setNarr(i, { section: e.target.value })} placeholder="Section heading (e.g. Scope)" />
                <Button size="sm" variant="ghost" onClick={() => setNarratives((rs) => rs.filter((_, idx) => idx !== i))}>
                  ✕
                </Button>
              </div>
              <textarea
                value={n.body}
                onChange={(e) => setNarr(i, { body: e.target.value })}
                rows={2}
                className="mt-2 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                placeholder="Section body…"
              />
            </div>
          ))}
        </div>

        {/* Line items */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Line items</p>
            <Button size="sm" variant="ghost" onClick={() => setLines((l) => [...l, { label: "", qty: "1", unit_price: "0" }])}>
              + Line
            </Button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="Service / description" className="flex-1" />
              <Input type="number" min="0" step="1" className="num w-20 text-right" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="qty" />
              <Input type="number" min="0" step="1" className="num w-28 text-right" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} placeholder="unit price" />
              <span className="w-28 text-right text-sm text-muted-foreground">{fmtMoney(lineTotal(l))}</span>
              <Button size="sm" variant="ghost" onClick={() => setLines((rs) => rs.filter((_, idx) => idx !== i))}>
                ✕
              </Button>
            </div>
          ))}
          <div className="flex justify-end pr-10 text-sm font-semibold">Total (HT): {fmtMoney(total)}</div>
        </div>

        {!editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={aiGenerated} onChange={(e) => setAiGenerated(e.target.checked)} />
            Mark as AI-drafted (for the record)
          </label>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!title.trim() || busy}>
            {editing ? "Save changes" : "Create draft"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ProposalDetail({ proposal, entities, onClose, onChanged, onEdit }: { proposal: Row | null; entities: Row[] | null; onClose: () => void; onChanged: () => void; onEdit: (p: Row) => void }) {
  const open = !!proposal;
  const [data, setData] = React.useState<Row | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [action, setAction] = React.useState<null | "send" | "accept">(null);
  const [entityId, setEntityId] = React.useState("");
  const [createQuotation, setCreateQuotation] = React.useState(false);

  React.useEffect(() => {
    if (!proposal) return;
    let live = true;
    setData(null);
    setError(null);
    setAction(null);
    setEntityId("");
    setCreateQuotation(false);
    tenant<Row>(`/proposals/${String(proposal.proposal_id)}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [proposal]);

  const status = data ? String(data.status) : "";
  const lines = (data?.lines as Row[] | undefined) || [];
  const narratives = (data?.narratives as Row[] | undefined) || [];
  const total = lines.reduce((a, l) => a + lineTotal(l), 0);
  const entityLabel = (() => {
    const en = (entities || []).find((e) => String(e.entity_id) === entityId);
    return en ? (en.code ? `${cell(en.code)} · ${cell(en.legal_name)}` : cell(en.legal_name)) : null;
  })();

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }
  const id = proposal ? String(proposal.proposal_id) : "";
  const transitionTo = (to: string, entity?: string) => run(() => tenant(`/proposals/${id}/transition`, { method: "POST", body: { to, entity_id: entity } }));
  const doAccept = () => run(() => tenant(`/proposals/${id}/accept`, { method: "POST", body: { create_quotation: createQuotation, entity_id: createQuotation ? entityId : undefined } }));

  return (
    <Modal open={open} onClose={onClose} title={proposal ? cell(proposal.title) : "Proposal"} description="Review the proposal, then move it through its lifecycle." size="xl">
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {data === null && !error ? (
          <LoadingRow label="Loading proposal…" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge label={status || "DRAFT"} />
              {data?.doc_number ? <span className="text-xs text-muted-foreground">№ {cell(data.doc_number)}</span> : null}
              {data?.ai_generated ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">AI-drafted</span> : null}
            </div>

            {narratives.length > 0 && (
              <div className="space-y-2">
                {narratives.map((n) => (
                  <div key={String(n.proposal_narrative_id)}>
                    <p className="text-sm font-semibold text-foreground">{cell(n.section)}</p>
                    {n.body ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{cell(n.body)}</p> : null}
                  </div>
                ))}
              </div>
            )}

            {lines.length > 0 && (
              <div className="rounded-lg border">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Item</span>
                  <span className="w-12 text-right">Qty</span>
                  <span className="w-24 text-right">Unit</span>
                  <span className="w-28 text-right">Total</span>
                </div>
                {lines.map((l) => (
                  <div key={String(l.proposal_line_id)} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-1.5 text-sm">
                    <span>{cell(l.label)}</span>
                    <span className="w-12 text-right">{cell(l.qty)}</span>
                    <span className="w-24 text-right">{fmtMoney(l.unit_price)}</span>
                    <span className="w-28 text-right">{fmtMoney(lineTotal(l))}</span>
                  </div>
                ))}
                <div className="border-t px-3 py-2 text-right text-sm font-semibold">Total (HT): {fmtMoney(total)}</div>
              </div>
            )}

            {/* Inline action panels */}
            {action === "send" && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <Field label="Entity" hint="Numbers the proposal on send" required>
                  <SearchSelect
                    path="/entities"
                    value={entityLabel}
                    placeholder="Search entities…"
                    getLabel={(en) => (en.code ? `${String(en.code)} · ${String(en.legal_name ?? "")}` : String(en.legal_name ?? ""))}
                    getKey={(en) => String(en.entity_id)}
                    onSelect={(en) => setEntityId(String(en.entity_id))}
                  />
                </Field>
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAction(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button size="sm" loading={busy} disabled={!entityId} onClick={() => transitionTo("SENT", entityId)}>
                    Confirm send
                  </Button>
                </div>
              </div>
            )}
            {action === "accept" && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={createQuotation} onChange={(e) => setCreateQuotation(e.target.checked)} />
                  Create a quotation from these lines
                </label>
                {createQuotation && (
                  <Field label="Entity" required>
                    <SearchSelect
                      path="/entities"
                      value={entityLabel}
                      placeholder="Search entities…"
                      getLabel={(en) => (en.code ? `${String(en.code)} · ${String(en.legal_name ?? "")}` : String(en.legal_name ?? ""))}
                      getKey={(en) => String(en.entity_id)}
                      onSelect={(en) => setEntityId(String(en.entity_id))}
                    />
                  </Field>
                )}
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAction(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button size="sm" loading={busy} disabled={createQuotation && !entityId} onClick={doAccept}>
                    Confirm accept
                  </Button>
                </div>
              </div>
            )}

            {/* Lifecycle actions */}
            {!action && (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
                {status === "DRAFT" && proposal && (
                  <>
                    <Button variant="outline" onClick={() => onEdit(data ?? proposal)}>
                      Edit
                    </Button>
                    <Button loading={busy} onClick={() => transitionTo("IN_REVIEW")}>
                      Submit for review
                    </Button>
                  </>
                )}
                {status === "IN_REVIEW" && (
                  <>
                    <Button variant="ghost" loading={busy} onClick={() => transitionTo("DRAFT")}>
                      Back to draft
                    </Button>
                    <Button onClick={() => setAction("send")}>Send…</Button>
                  </>
                )}
                {status === "SENT" && (
                  <>
                    <Button variant="ghost" loading={busy} onClick={() => transitionTo("REJECTED")}>
                      Reject
                    </Button>
                    <Button onClick={() => setAction("accept")}>Accept…</Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export function ProposalsPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/proposals", nonce);
  const { rows: leads } = useList("/leads", nonce);
  const { rows: clients } = useList("/clients", nonce);
  const { rows: opportunities } = useList("/opportunities", nonce);
  const { rows: entities } = useList("/entities", nonce);
  const [filter, setFilter] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [detail, setDetail] = React.useState<Row | null>(null);

  const clientName = React.useMemo(() => new Map((clients || []).map((c) => [String(c.client_id), cell(c.name ?? c.legal_name)])), [clients]);
  const leadName = React.useMemo(() => new Map((leads || []).map((l) => [String(l.lead_id), cell(l.company_name)])), [leads]);
  function withLabel(p: Row): string {
    if (p.client_id) return clientName.get(String(p.client_id)) ?? "Client";
    if (p.lead_id) return leadName.get(String(p.lead_id)) ?? "Lead";
    return "—";
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (filter && String(r.status) !== filter) return false;
      if (!q) return true;
      return String(r.title ?? "").toLowerCase().includes(q);
    });
  }, [rows, filter, search]);

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Proposals</h1>
          <p className="mt-1 text-sm text-muted-foreground">Formal proposals with narrative + line items — drafted, reviewed, sent, then accepted.</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          New proposal
        </Button>
      </header>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Chips value={filter} options={PROPOSAL_FILTERS} onChange={setFilter} />
        <div className="w-full sm:max-w-xs">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search proposals…" />
        </div>
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow label="Loading proposals…" />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length ? "No proposals match" : "No proposals yet"} hint={rows.length ? "Try another filter." : "Draft your first proposal, or generate one with AI from an opportunity."} />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <button key={String(r.proposal_id)} type="button" onClick={() => setDetail(r)} className="lux-card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-primary/40">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{cell(r.title)}</p>
                  <Badge label={String(r.status || "DRAFT")} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {withLabel(r)}
                  {r.doc_number ? ` · № ${cell(r.doc_number)}` : ""} · {when(r.created_at)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <AiActions actions={PROPOSAL_AI} />

      <ProposalForm
        open={formOpen}
        editing={editing}
        leads={leads}
        clients={clients}
        opportunities={opportunities}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
      />
      <ProposalDetail
        proposal={detail}
        entities={entities}
        onClose={() => setDetail(null)}
        onChanged={reload}
        onEdit={(p) => {
          setDetail(null);
          setEditing(p);
          setFormOpen(true);
        }}
      />
    </section>
  );
}

/* ═══════════════════════════════ MARKETING CAMPAIGNS ═══════════════════════════════ */

const CAMPAIGN_AI: AiAction[] = [
  { label: "Draft campaign copy", kind: "assist", describe: "Draft subject lines / body copy for a channel (human-reviewed before send)." },
  { label: "Summarise audience", kind: "read", describe: "Summarise the active newsletter audience and recent growth." },
];

const CHANNELS = ["EMAIL", "SMS", "SOCIAL", "WEB", "OTHER"];
const CAMPAIGN_ACTIONS: Record<string, { to: string; label: string }[]> = {
  DRAFT: [{ to: "ACTIVE", label: "Activate" }],
  ACTIVE: [{ to: "PAUSED", label: "Pause" }, { to: "ENDED", label: "End" }],
  PAUSED: [{ to: "ACTIVE", label: "Resume" }, { to: "ENDED", label: "End" }],
  ENDED: [],
};

function CampaignForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState("");
  const [channel, setChannel] = React.useState("EMAIL");
  const [startsOn, setStartsOn] = React.useState("");
  const [endsOn, setEndsOn] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setChannel("EMAIL");
    setStartsOn("");
    setEndsOn("");
    setError(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/campaigns", { method: "POST", body: { name: name.trim(), channel, starts_on: startsOn || undefined, ends_on: endsOn || undefined } });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New campaign" description="An outbound campaign — activate, pause or end it as it runs." size="lg">
      <div className="space-y-4">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 freight promo" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Channel">
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Starts on">
            <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label="Ends on">
            <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim() || busy}>
            Create campaign
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SubscriberForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [source, setSource] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEmail("");
    setName("");
    setSource("");
    setError(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/campaigns/subscribers", { method: "POST", body: { email: email.trim(), name: name.trim() || undefined, source: source.trim() || undefined } });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add subscriber" description="Add someone to the newsletter audience.">
      <div className="space-y-4">
        <Field label="Email" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme.cm" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Source">
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="website" />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!email.trim() || busy}>
            Add subscriber
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* Campaign email templates + sending identities are now a first-class MOD-22
 * module (GET/POST/PATCH/DELETE /campaigns/templates + /campaigns/senders), so a
 * marketing role can manage them without settings-admin. A template references a
 * configured sender identity rather than embedding a raw From address. */
const CAMPAIGN_TEMPLATES = "/campaigns/templates";
const CAMPAIGN_SENDERS = "/campaigns/senders";

function senderLabel(s: Row): string {
  const name = cell(s.from_name);
  const addr = cell(s.from_address);
  return name !== "—" ? `${name} · ${addr}` : addr;
}

function SenderForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (row: Row) => void }) {
  const [fromName, setFromName] = React.useState("");
  const [fromAddress, setFromAddress] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFromName("");
    setFromAddress("");
    setError(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const row = await tenant<Row>(CAMPAIGN_SENDERS, { method: "POST", body: { from_name: fromName.trim(), from_address: fromAddress.trim() } });
      onCreated(row);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New sender" description="A sending identity a template can use. Verification is a manual admin stamp for now." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sender name" required>
            <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Praxis LS" />
          </Field>
          <Field label="Sender address" required>
            <Input type="email" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="news@tenant.cm" />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!fromName.trim() || !fromAddress.trim() || busy}>
            Add sender
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TemplateForm({ open, editing, senders, onClose, onSaved, onReloadSenders }: { open: boolean; editing: Row | null; senders: Row[] | null; onClose: () => void; onSaved: () => void; onReloadSenders: () => void }) {
  const [name, setName] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [senderId, setSenderId] = React.useState("");
  const [body, setBody] = React.useState("");
  const [senderOpen, setSenderOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ? String(editing.name) : "");
    setSubject(editing?.subject ? String(editing.subject) : "");
    setSenderId(editing?.from_sender_id ? String(editing.from_sender_id) : "");
    setBody(editing?.body_html ? String(editing.body_html) : "");
    setError(null);
  }, [open, editing]);

  const canSubmit = !!name.trim() && !busy;
  async function submit() {
    setBusy(true);
    setError(null);
    const payload = { name: name.trim(), subject: subject.trim() || null, body_html: body, from_sender_id: senderId || null };
    try {
      if (editing) await tenant(`${CAMPAIGN_TEMPLATES}/${String(editing.template_id)}`, { method: "PATCH", body: payload });
      else await tenant(CAMPAIGN_TEMPLATES, { method: "POST", body: payload });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit template" : "New email template"} description="A reusable campaign email that sends from a chosen sender identity." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Template name" required className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly newsletter" />
          </Field>
          <Field label="Subject" className="sm:col-span-2">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What's new this month" />
          </Field>
          <Field label="Sender" hint="The verified sending identity" className="sm:col-span-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <Select value={senderId} onChange={(e) => setSenderId(e.target.value)}>
                  <option value="">— none —</option>
                  {(senders || []).map((s) => (
                    <option key={String(s.sender_id)} value={String(s.sender_id)}>
                      {senderLabel(s)}
                      {s.verified_at ? "" : " (unverified)"}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="button" variant="outline" onClick={() => setSenderOpen(true)}>
                New sender
              </Button>
            </div>
          </Field>
          <Field label="Body" className="sm:col-span-2" hint="HTML or plain text">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="<p>Hello…</p>" className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {editing ? "Save template" : "Create template"}
          </Button>
        </div>
      </div>
      <SenderForm
        open={senderOpen}
        onClose={() => setSenderOpen(false)}
        onCreated={(row) => {
          onReloadSenders();
          if (row && row.sender_id) setSenderId(String(row.sender_id));
        }}
      />
    </Modal>
  );
}

function SendCampaignModal({ campaign, templates, onClose, onSent }: { campaign: Row | null; templates: Row[] | null; onClose: () => void; onSent: (queued: number) => void }) {
  const open = !!campaign;
  const [templateId, setTemplateId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTemplateId("");
    setError(null);
  }, [open]);

  async function submit() {
    if (!campaign) return;
    setBusy(true);
    setError(null);
    try {
      const r = await tenant<{ queued?: number }>(`/campaigns/${String(campaign.campaign_id)}/send`, { method: "POST", body: { template_id: templateId } });
      onSent(Number(r?.queued ?? 0));
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Send campaign" description="Queue this template to every active subscriber, sent from the template's sender identity." size="lg">
      <div className="space-y-4">
        <Field label="Template" required>
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">— select a template —</option>
            {(templates || []).map((t) => (
              <option key={String(t.template_id)} value={String(t.template_id)}>
                {cell(t.name)}
              </option>
            ))}
          </Select>
        </Field>
        {(templates || []).length === 0 && <p className="text-xs text-muted-foreground">No templates yet — create one on the Templates tab first.</p>}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!templateId || busy}>
            Send now
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CampaignsPage() {
  const [tab, setTab] = React.useState<"campaigns" | "subscribers" | "templates">("campaigns");
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows: campaigns, error } = useList("/campaigns", nonce);
  const { rows: subscribers } = useList("/campaigns/subscribers", nonce);
  const { rows: templates } = useList(CAMPAIGN_TEMPLATES, nonce);
  const { rows: senders } = useList(CAMPAIGN_SENDERS, nonce);
  const [formOpen, setFormOpen] = React.useState(false);
  const [subOpen, setSubOpen] = React.useState(false);
  const [tplEditing, setTplEditing] = React.useState<Row | null>(null);
  const [tplOpen, setTplOpen] = React.useState(false);
  const [sendFor, setSendFor] = React.useState<Row | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  async function act(id: string, fn: () => Promise<unknown>) {
    setRowBusy(id);
    setRowError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }
  const transition = (id: string, to: string) => act(id, () => tenant(`/campaigns/${id}/transition`, { method: "POST", body: { to } }));
  const unsubscribe = (email: string) => act(email, () => tenant("/campaigns/subscribers/unsubscribe", { method: "POST", body: { email } }));
  const deleteTemplate = (id: string) => act(id, () => tenant(`${CAMPAIGN_TEMPLATES}/${id}`, { method: "DELETE" }));
  const openTemplate = (t: Row | null) => {
    setTplEditing(t);
    setTplOpen(true);
  };
  const senderName = React.useMemo(() => new Map((senders || []).map((s) => [String(s.sender_id), senderLabel(s)])), [senders]);

  const counts = React.useMemo(() => {
    const cs = campaigns || [];
    return {
      active: cs.filter((c) => String(c.status) === "ACTIVE").length,
      draft: cs.filter((c) => String(c.status) === "DRAFT").length,
      ended: cs.filter((c) => String(c.status) === "ENDED").length,
    };
  }, [campaigns]);

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Marketing campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">Outbound campaigns and the newsletter audience — launch, pause, measure.</p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "campaigns", label: "Campaigns" },
              { value: "subscribers", label: "Subscribers" },
              { value: "templates", label: "Templates" },
            ]}
          />
          {tab === "campaigns" ? (
            <Button onClick={() => setFormOpen(true)}>New campaign</Button>
          ) : tab === "subscribers" ? (
            <Button onClick={() => setSubOpen(true)}>Add subscriber</Button>
          ) : (
            <Button onClick={() => openTemplate(null)}>New template</Button>
          )}
        </div>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile label="Active" value={String(counts.active)} accent />
        <MetricTile label="Draft" value={String(counts.draft)} />
        <MetricTile label="Ended" value={String(counts.ended)} />
        <MetricTile label="Subscribers" value={subscribers === null ? "…" : String(subscribers.length)} />
      </div>

      {notice && (
        <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{notice}</div>
      )}
      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {tab === "campaigns" ? (
        error ? (
          <ErrorState message={error} />
        ) : campaigns === null ? (
          <LoadingRow label="Loading campaigns…" />
        ) : campaigns.length === 0 ? (
          <EmptyState title="No campaigns yet" hint="Create your first campaign to reach the newsletter audience." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((c) => {
              const id = String(c.campaign_id);
              const status = String(c.status || "DRAFT");
              const actions = CAMPAIGN_ACTIONS[status] || [];
              return (
                <div key={id} className="lux-card flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{cell(c.name)}</p>
                    <Badge label={status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{cell(c.channel)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.starts_on || c.ends_on ? `${when(c.starts_on)} → ${when(c.ends_on)}` : "No dates set"}
                  </p>
                  {actions.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      {actions.map((a, i) => (
                        <Button key={a.to} size="sm" variant={i === 0 ? "outline" : "ghost"} loading={rowBusy === id} onClick={() => transition(id, a.to)}>
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {status !== "ENDED" && (
                    <div className="mt-2">
                      <Button size="sm" variant="ghost" onClick={() => setSendFor(c)}>
                        Send…
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : tab === "subscribers" ? (
        subscribers === null ? (
          <LoadingRow label="Loading subscribers…" />
        ) : subscribers.length === 0 ? (
          <EmptyState title="No subscribers yet" hint="Add subscribers, or they arrive via the public newsletter form." />
      ) : (
        <div className="space-y-2">
          {subscribers.map((s) => {
            const email = String(s.email);
            return (
              <div key={email} className="lux-card flex items-center gap-3 p-3">
                <Avatar name={String(s.name || s.email || "?")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{cell(s.name) === "—" ? email : cell(s.name)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {cell(s.name) === "—" ? cell(s.source) : `${email} · ${cell(s.source)}`} · {when(s.subscribed_at)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" loading={rowBusy === email} onClick={() => unsubscribe(email)}>
                  Unsubscribe
                </Button>
              </div>
            );
            })}
          </div>
        )
      ) : templates === null ? (
        <LoadingRow label="Loading templates…" />
      ) : (templates || []).length === 0 ? (
        <EmptyState title="No email templates yet" hint="Create a reusable campaign email — each carries its own sender name and address." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(templates || []).map((t) => {
            const id = String(t.template_id);
            return (
              <div key={id} className="lux-card flex flex-col p-4">
                <p className="text-sm font-semibold text-foreground">{cell(t.name)}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{cell(t.subject)}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  From: {t.from_sender_id ? senderName.get(String(t.from_sender_id)) ?? "—" : "No sender"}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openTemplate(t)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" loading={rowBusy === id} onClick={() => deleteTemplate(id)}>
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AiActions actions={CAMPAIGN_AI} />

      <CampaignForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={reload} />
      <SubscriberForm open={subOpen} onClose={() => setSubOpen(false)} onSaved={reload} />
      <TemplateForm open={tplOpen} editing={tplEditing} senders={senders} onClose={() => setTplOpen(false)} onSaved={reload} onReloadSenders={reload} />
      <SendCampaignModal
        campaign={sendFor}
        templates={templates}
        onClose={() => setSendFor(null)}
        onSent={(queued) => {
          setNotice(`Queued to ${queued} subscriber${queued === 1 ? "" : "s"}.`);
          reload();
        }}
      />
    </section>
  );
}

/* ═══════════════════════════════ SUCCESS STORIES ═══════════════════════════════ */

const STORY_AI: AiAction[] = [
  { label: "Draft success story", kind: "assist", describe: "Draft a case study from a delivered dossier — title, summary and body." },
  { label: "Polish for publishing", kind: "assist", describe: "Tighten a success story's copy before sign-off." },
];

const STORY_FILTERS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "SIGNED_OFF", label: "Signed off" },
  { value: "PUBLISHED", label: "Published" },
];

function storyStatus(r: Row): string {
  if (r.is_published) return "PUBLISHED";
  if (r.signed_off_by) return "SIGNED_OFF";
  return "DRAFT";
}

function StoryForm({ open, editing, onClose, onSaved }: { open: boolean; editing: Row | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [body, setBody] = React.useState("");
  const [aiGenerated, setAiGenerated] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ? String(editing.title) : "");
    setSummary(editing?.summary ? String(editing.summary) : "");
    setBody(editing?.body ? String(editing.body) : "");
    setAiGenerated(editing?.ai_generated === true);
    setError(null);
  }, [open, editing]);

  async function submit() {
    setBusy(true);
    setError(null);
    const body_ = { title: title.trim(), summary: summary.trim() || undefined, body: body.trim() || undefined };
    try {
      if (editing) await tenant(`/success-stories/${String(editing.success_story_id)}`, { method: "PATCH", body: body_ });
      else await tenant("/success-stories", { method: "POST", body: { ...body_, ai_generated: aiGenerated } });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit success story" : "New success story"} description="A portfolio case study — draft, sign off, then publish." size="lg">
      <div className="space-y-4">
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cutting Acme's customs clearance time by 40%" />
        </Field>
        <Field label="Summary" hint="One or two lines for the portfolio card">
          <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="How we streamlined a multi-modal import lane." />
        </Field>
        <Field label="Body">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            placeholder="The full case study…"
          />
        </Field>
        {!editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={aiGenerated} onChange={(e) => setAiGenerated(e.target.checked)} />
            Mark as AI-drafted (for the record)
          </label>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!title.trim() || busy}>
            {editing ? "Save changes" : "Create draft"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SuccessStoriesPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/success-stories", nonce);
  const [filter, setFilter] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  async function act(id: string, fn: () => Promise<unknown>) {
    setRowBusy(id);
    setRowError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }
  const signOff = (id: string) => act(id, () => tenant(`/success-stories/${id}/sign-off`, { method: "POST", body: {} }));
  const publish = (id: string) => act(id, () => tenant(`/success-stories/${id}/publish`, { method: "POST", body: {} }));
  const unpublish = (id: string) => act(id, () => tenant(`/success-stories/${id}/unpublish`, { method: "POST", body: {} }));

  const filtered = React.useMemo(() => (rows || []).filter((r) => !filter || storyStatus(r) === filter), [rows, filter]);

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Success stories</h1>
          <p className="mt-1 text-sm text-muted-foreground">Portfolio case studies — draft, sign off, then publish.</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          New story
        </Button>
      </header>

      <div className="mb-4">
        <Chips value={filter} options={STORY_FILTERS} onChange={setFilter} />
      </div>

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow label="Loading stories…" />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length ? "No stories match" : "No success stories yet"} hint={rows.length ? "Try another filter." : "Draft your first case study, or generate one with AI from a delivered dossier."} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((r) => {
            const id = String(r.success_story_id);
            const status = storyStatus(r);
            return (
              <div key={id} className="lux-card flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{cell(r.title)}</p>
                  <Badge label={status} />
                </div>
                {r.summary ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{cell(r.summary)}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">{r.is_published ? `Published ${when(r.published_at)}` : `Created ${when(r.created_at)}`}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!r.is_published && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  )}
                  {status === "DRAFT" && (
                    <Button size="sm" variant="outline" loading={rowBusy === id} onClick={() => signOff(id)}>
                      Sign off
                    </Button>
                  )}
                  {status === "SIGNED_OFF" && (
                    <Button size="sm" loading={rowBusy === id} onClick={() => publish(id)}>
                      Publish
                    </Button>
                  )}
                  {status === "PUBLISHED" && (
                    <Button size="sm" variant="ghost" loading={rowBusy === id} onClick={() => unpublish(id)}>
                      Unpublish
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AiActions actions={STORY_AI} />

      <StoryForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={reload} />
    </section>
  );
}
