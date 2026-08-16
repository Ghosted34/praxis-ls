/**
 * Partnership & vendor applications — write surfaces (F10).
 *
 * Two modals and a document panel:
 *   - PartnershipForm: capture / edit an application. Network memberships are
 *     typed as a comma-separated list and sent as an ARRAY — the server stores
 *     an array either way, but sending the string would leave the parsing to
 *     the API and the legacy's two rival decoders are exactly what that costs.
 *   - ReviewModal: the vetting drawer. Start review, approve, reject, re-open.
 *     Approve is the only action here with a side effect outside this register,
 *     so it says so in words before it runs rather than after.
 *   - ProfilePanel: the applicant's corporate profile, into the vault. It only
 *     appears once the application has been saved — there is nothing to attach
 *     a document to while the form is still a draft in the browser.
 */

import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/pill";
import { openVaultDoc, readFileAsDataUrl, SCAN_ACCEPT } from "@/lib/vault-file";
import { errMsg, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";

const TYPES = [
  { value: "AGENCY_PARTNERSHIP", label: "Agency partnership" },
  { value: "VENDOR_REGISTRATION", label: "Vendor registration" },
];
const INTAKE_CHANNELS = ["MANUAL", "WEBSITE", "REFERRAL", "CAMPAIGN"];

/** 10 MB — the server's PROFILE_MAX_BYTES. Checked here so an oversized file is
 *  refused before it is read and base64-expanded in the browser. */
const PROFILE_MAX_BYTES = 10 * 1024 * 1024;

const toList = (s: string) =>
  s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 25);

const memberships = (r: Row | null): string[] => {
  const v = r?.network_memberships;
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : toList(v);
    } catch {
      return toList(v);
    }
  }
  return [];
};

export function NetworkPills({ list }: { list: string[] }) {
  if (!list.length) {
    return <span className="text-xs italic text-muted-foreground">No memberships listed</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((n) => (
        <span
          key={n}
          className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {n}
        </span>
      ))}
    </span>
  );
}

export function PartnershipForm({
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
  const [country, setCountry] = React.useState("");
  const [type, setType] = React.useState("AGENCY_PARTNERSHIP");
  const [channel, setChannel] = React.useState("MANUAL");
  const [contact, setContact] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [networks, setNetworks] = React.useState("");
  const [proposal, setProposal] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCompany(editing?.company_name ? String(editing.company_name) : "");
    setCountry(editing?.country_of_origin ? String(editing.country_of_origin) : "");
    setType(editing?.proposal_type ? String(editing.proposal_type) : "AGENCY_PARTNERSHIP");
    setChannel(editing?.intake_channel ? String(editing.intake_channel) : "MANUAL");
    setContact(editing?.contact_name ? String(editing.contact_name) : "");
    setTitle(editing?.contact_title ? String(editing.contact_title) : "");
    setEmail(editing?.email ? String(editing.email) : "");
    setPhone(editing?.contact_phone ? String(editing.contact_phone) : "");
    setWebsite(editing?.website ? String(editing.website) : "");
    setNetworks(memberships(editing).join(", "));
    setProposal(editing?.proposal_text ? String(editing.proposal_text) : "");
    setError(null);
  }, [open, editing]);

  async function save() {
    if (!company.trim()) {
      setError("The company name is required — it is what the application is filed under.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        company_name: company.trim(),
        country_of_origin: country || undefined,
        proposal_type: type,
        intake_channel: channel,
        contact_name: contact || undefined,
        contact_title: title || undefined,
        email: email || undefined,
        contact_phone: phone || undefined,
        website: website || undefined,
        network_memberships: toList(networks),
        proposal_text: proposal || undefined,
      };
      if (editing?.partnership_request_id) {
        await tenant(`/partnership-requests/${editing.partnership_request_id}`, { method: "PATCH", body: payload });
      } else {
        await tenant(`/partnership-requests`, { method: "POST", body: payload });
      }
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
      title={editing ? `Edit ${cell(editing.company_name)}` : "Record an application"}
      description="A forwarding agent or vendor applying to work with the company."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy}>{editing ? "Save changes" : "Record application"}</Button>
        </div>
      }
    >
      {error && <ErrorState message={error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company" required>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <Field label="Country of origin">
          <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Cameroon" />
        </Field>
        <Field label="Application type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Came in via">
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {INTAKE_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Contact person">
          <Input value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Website">
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field
            label="Network memberships"
            hint="Comma separated — WCA, JCTrans, FIATA. This is how a forwarding agent is vetted."
          >
            <Input value={networks} onChange={(e) => setNetworks(e.target.value)} placeholder="WCA, JCTrans" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="What they are proposing">
            <Textarea rows={3} value={proposal} onChange={(e) => setProposal(e.target.value)} />
          </Field>
        </div>
      </div>

      {editing?.partnership_request_id ? (
        <ProfilePanel request={editing} onChanged={onSaved} />
      ) : null}
    </Modal>
  );
}

export function ProfilePanel({ request, onChanged }: { request: Row; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const vaultId = request.corporate_profile_vault_id ? String(request.corporate_profile_vault_id) : null;

  async function upload(file: File) {
    setError(null);
    if (file.size > PROFILE_MAX_BYTES) {
      setError(`${file.name} is larger than 10 MB.`);
      return;
    }
    setBusy(true);
    try {
      await tenant(`/partnership-requests/${request.partnership_request_id}/profile`, {
        method: "POST",
        body: { file: await readFileAsDataUrl(file), filename: file.name },
      });
      onChanged();
    } catch (e) {
      // The server's own message is the actionable one — "this file says it is
      // a PDF but its contents are image/png" beats "Something went wrong."
      setError(errMsg(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mt-5 border-t pt-4">
      <div className="flex items-center justify-between">
        <p className="micro">Corporate profile</p>
        <div className="flex items-center gap-2">
          {vaultId ? (
            <Button variant="ghost" onClick={() => void openVaultDoc(vaultId)}>Open</Button>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept={SCAN_ACCEPT}
            className="sr-only"
            id={`pr-profile-${request.partnership_request_id}`}
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) void upload(f);
            }}
          />
          <Button variant="outline" loading={busy} onClick={() => inputRef.current?.click()}>
            {vaultId ? "Replace" : "Attach profile"}
          </Button>
        </div>
      </div>
      {error && <ErrorState message={error} />}
      <p className="mt-2 text-sm text-muted-foreground">
        {vaultId
          ? "Stored in the vault. Replacing it archives the previous version rather than deleting it — it is what the applicant actually sent."
          : "PDF or image, up to 10 MB. The prospectus the application turns on."}
      </p>
    </div>
  );
}

export function ReviewModal({
  request,
  onClose,
  onDone,
}: {
  request: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [alsoSupplier, setAlsoSupplier] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<string | null>(null);

  const status = String(request?.status || "NEW");
  const isVendor = String(request?.proposal_type) === "VENDOR_REGISTRATION";
  const willCreateSupplier = isVendor || alsoSupplier;

  React.useEffect(() => {
    if (!request) return;
    setNotes(request.internal_notes ? String(request.internal_notes) : "");
    setReason("");
    setAlsoSupplier(false);
    setError(null);
    setResult(null);
  }, [request]);

  if (!request) return null;
  const id = String(request.partnership_request_id);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onDone();
      if (label !== "approve") onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const move = (to: string) =>
    run(to, () => tenant(`/partnership-requests/${id}/transition`, { method: "POST", body: { to, notes } }));

  const approve = () =>
    run("approve", async () => {
      const out: any = await tenant(`/partnership-requests/${id}/approve`, {
        method: "POST",
        body: { create_supplier: alsoSupplier, notes },
      });
      const data = out && out.supplier !== undefined ? out : out?.data;
      const s = data?.supplier;
      setResult(
        s
          ? `${data?.supplier_reused ? "Linked to the existing supplier" : "Draft supplier created"} — ${String(s.ref || s.name)}. It buys nothing until somebody verifies it in the supplier registry.`
          : "Approved. No supplier record was created.",
      );
    });

  const reject = () =>
    run("reject", () =>
      tenant(`/partnership-requests/${id}/reject`, { method: "POST", body: { reason, notes } }));

  return (
    <Modal
      open
      onClose={onClose}
      title={cell(request.company_name)}
      description={`${cell(request.proposal_type).replace("_", " ")} · received ${dateFmt(request.created_at)}`}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {status === "NEW" && (
            <Button variant="outline" loading={busy === "IN_REVIEW"} onClick={() => void move("IN_REVIEW")}>
              Start review
            </Button>
          )}
          {status === "REJECTED" && (
            <Button variant="outline" loading={busy === "IN_REVIEW"} onClick={() => void move("IN_REVIEW")}>
              Re-open
            </Button>
          )}
          {(status === "NEW" || status === "IN_REVIEW") && (
            <Button variant="outline" loading={busy === "reject"} disabled={!reason.trim()} onClick={() => void reject()}>
              Reject
            </Button>
          )}
          {status === "IN_REVIEW" && (
            <Button loading={busy === "approve"} onClick={() => void approve()}>Approve</Button>
          )}
        </div>
      }
    >
      {error && <ErrorState message={error} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill status={status} />
        <span className="text-xs text-muted-foreground">{cell(request.country_of_origin)}</span>
        <NetworkPills list={memberships(request)} />
      </div>

      <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="micro">Contact</dt>
          <dd>{[cell(request.contact_name), cell(request.contact_title)].filter((x) => x !== "—").join(" · ") || "—"}</dd>
        </div>
        <div>
          <dt className="micro">Reach them on</dt>
          <dd>{[cell(request.email), cell(request.contact_phone)].filter((x) => x !== "—").join(" · ") || "—"}</dd>
        </div>
      </dl>

      {request.proposal_text ? (
        <p className="mb-4 whitespace-pre-wrap text-sm text-muted-foreground">{String(request.proposal_text)}</p>
      ) : null}

      <ProfilePanel request={request} onChanged={onDone} />

      <div className="mt-5 border-t pt-4">
        <Field label="Internal notes" hint="Due diligence. Kept whatever the decision is; never shown to the applicant.">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
        </Field>

        {status === "IN_REVIEW" && !isVendor ? (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={alsoSupplier}
              onChange={(e) => setAlsoSupplier(e.target.checked)}
            />
            <span>
              Also open a draft supplier for this agent
              <span className="block text-xs text-muted-foreground">
                Tick this if we will be invoiced by them — destination charges, agency fees. Leave it if we only send
                them work.
              </span>
            </span>
          </label>
        ) : null}

        {status === "IN_REVIEW" && willCreateSupplier ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Approving creates a <strong>DRAFT</strong> supplier carrying this company&apos;s name, country and contact.
            Nothing is payable and no purchase order can draw on it until somebody with the approve permission verifies
            it in the supplier registry.
          </p>
        ) : null}

        {(status === "NEW" || status === "IN_REVIEW") && (
          <div className="mt-3">
            <Field label="Reason (required to reject)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="No verifiable network membership" />
            </Field>
          </div>
        )}

        {request.decision_reason ? (
          <p className="mt-3 text-sm">
            <span className="micro">Previous decision</span>
            <span className="block text-muted-foreground">{String(request.decision_reason)}</span>
          </p>
        ) : null}

        {result ? <p className="mt-3 text-sm font-medium text-ok">{result}</p> : null}
      </div>
    </Modal>
  );
}
