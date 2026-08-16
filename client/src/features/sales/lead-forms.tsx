/**
 * Leads & intake — the write surfaces.
 *
 * Split out of `features/sales/leads.tsx` in Phase 4 (audit F7: no file over
 * 400 lines). Three modals, all of which mutate the funnel: create/edit a lead,
 * convert one into a client, and review a partnership request.
 *
 * TriageModal was removed by F9. The enquiry desk is its own screen now
 * (features/sales/enquiries.tsx), and its Manage drawer owns triage — including
 * the route-to-partnership path this modal never had. Leaving it here would
 * have left a second write surface posting the pre-F9 payload at the same
 * endpoint, which is the duplication F9 exists to remove.
 */

import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";
import { SearchSelect } from "@/components/ui/search-select";

const LEAD_SOURCES = ["MANUAL", "WEBSITE", "REFERRAL", "CAMPAIGN"];

export function LeadForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
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
    setInterest(
      editing?.service_interest ? String(editing.service_interest) : "",
    );
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
      if (editing)
        await tenant(`/leads/${String(editing.lead_id)}`, {
          method: "PATCH",
          body,
        });
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
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit lead" : "Capture lead"}
      description="Top of the sales funnel — qualify, then convert into a client."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Company"
            required
            className="sm:col-span-2"
            hint="Search existing clients, or type a new company"
          >
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
            <Input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Jane Doe"
            />
          </Field>
          <Field label="Service interest" hint="What they're after">
            <Input
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
              placeholder="Freight forwarding"
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@acme.cm"
            />
          </Field>
          <Field label="Phone">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+237 6XX XXX XXX"
            />
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

export function ConvertModal({
  lead,
  onClose,
  onDone,
}: {
  lead: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
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
      await tenant(`/leads/${String(lead.lead_id)}/convert`, {
        method: "POST",
        body: { client },
      });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Convert to client"
      description="Promote this qualified lead into the client master and link it back(→)."
    >
      <div className="space-y-4">
        <div className="grid gap-4">
          <Field label="Legal name" required>
            <Input
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Acme Logistics SARL"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
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
          <Button
            onClick={submit}
            loading={busy}
            disabled={!legalName.trim() || busy}
          >
            Convert to client
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * ReviewModal lived here and posted /intake/partnerships/:id/review with
 * REVIEWING / ACCEPTED / DECLINED. F10 removed it: the route moved to
 * /partnership-requests and migration 0688 replaced that status vocabulary with
 * NEW / IN_REVIEW / APPROVED / REJECTED, so every call it made would now be
 * refused by the CHECK constraint. Reviewing happens in
 * features/sales/partnership-forms.tsx, where approving can also open a draft
 * supplier — which is the decision this modal could not express.
 */
