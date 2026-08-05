/**
 * Marketing campaigns — the write surfaces.
 *
 * Split out of `features/sales/campaigns.tsx` in Phase 4 (audit F7). One
 * campaign needs four supporting records before it can go out — a subscriber
 * list, a verified sender identity, a message template, and the send run
 * itself — and all four are created from the campaigns screen rather than from
 * four more tabs. That is why this is the largest form file in Sales.
 */

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";
import { cell } from "@/lib/format";

const CHANNELS = ["EMAIL", "SMS", "SOCIAL", "WEB", "OTHER"];

export function CampaignForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
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

export function SubscriberForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
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
export const CAMPAIGN_TEMPLATES = "/campaigns/templates";
export const CAMPAIGN_SENDERS = "/campaigns/senders";

export function senderLabel(s: Row): string {
  const name = cell(s.from_name);
  const addr = cell(s.from_address);
  return name !== "—" ? `${name} · ${addr}` : addr;
}

export function SenderForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (row: Row) => void }) {
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

/** Keep in sync with MERGE_FIELDS in src/modules/sales/marketing_campaign/marketing_campaign.service.js. */
const MERGE_FIELDS = ["name", "email", "campaign", "year"];

export function TemplateForm({ open, editing, senders, onClose, onSaved, onReloadSenders }: { open: boolean; editing: Row | null; senders: Row[] | null; onClose: () => void; onSaved: () => void; onReloadSenders: () => void }) {
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
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="<p>Hello {{name}},…</p>" />
          </Field>
          {/* Mirrors MERGE_FIELDS in marketing_campaign.service.js. Unknown tokens
              are left as written so a typo shows up in a test send. */}
          <div className="sm:col-span-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Merge fields</span> — usable in the subject and body, replaced per recipient:{" "}
            {MERGE_FIELDS.map((f) => (
              <code key={f} className="num mr-1.5 rounded bg-background px-1 py-0.5">{`{{${f}}}`}</code>
            ))}
            <span className="block pt-1">
              <code className="num">{"{{name}}"}</code> falls back to the email name, then “there”. Anything not in this list is left as written.
            </span>
          </div>
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

export function SendCampaignModal({ campaign, templates, onClose, onSent }: { campaign: Row | null; templates: Row[] | null; onClose: () => void; onSent: (queued: number) => void }) {
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
