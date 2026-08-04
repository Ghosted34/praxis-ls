/**
 * Leads & intake — the write surfaces.
 *
 * Split out of `features/sales/leads.tsx` in Phase 4 (audit F7: no file over
 * 400 lines). Four modals, all of which mutate the funnel: create/edit a lead,
 * convert one into a client, and the two intake triage paths (enquiry →
 * qualified lead, partnership → reviewed).
 */

import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";
import { cell } from "@/lib/format";
import { SearchSelect } from "@/components/ui/search-select";

const LEAD_SOURCES = ["MANUAL", "WEBSITE", "REFERRAL", "CAMPAIGN"];

export function LeadForm({ open, editing, onClose, onSaved }: { open: boolean; editing: Row | null; onClose: () => void; onSaved: () => void }) {
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

export function ConvertModal({ lead, onClose, onDone }: { lead: Row | null; onClose: () => void; onDone: () => void }) {
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

export function TriageModal({ enquiry, onClose, onDone }: { enquiry: Row | null; onClose: () => void; onDone: () => void }) {
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
      await tenant(`/intake/enquiries/${String(enquiry.contact_enquiry_id)}/triage`, { method: "POST", body: { to_lead: toLead, close } });
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

export function ReviewModal({ partnership, onClose, onDone }: { partnership: Row | null; onClose: () => void; onDone: () => void }) {
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
      await tenant(`/intake/partnerships/${String(partnership.partnership_request_id)}/review`, { method: "POST", body: { status } });
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
