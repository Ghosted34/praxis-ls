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
import { cell, dateFmt, money, money0, toDateInput } from "@/lib/format";

/** Kept in sync with rules.PLATFORMS in marketing_campaign.rules.js — the API
 *  validates against the same list, so a value added there and not here is a
 *  422 the user cannot explain. */
export const PLATFORMS: { value: string; label: string }[] = [
  { value: "META", label: "Meta Ads" },
  { value: "GOOGLE", label: "Google Ads" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "EMAIL", label: "Email" },
  { value: "OFFLINE", label: "Offline / Event" },
  { value: "OTHER", label: "Other" },
];

export const platformLabel = (v: unknown) =>
  PLATFORMS.find((p) => p.value === String(v))?.label ?? "Other";

/** The legacy's four target services, offered as suggestions rather than an
 *  enum: the column is unconstrained because a tenant's service catalogue is
 *  theirs to extend (BUILD_CONVENTIONS §6), so this is a datalist, not a
 *  <select> that would refuse anything else. */
const TARGET_SERVICES = [
  { value: "ALL", label: "General brand awareness" },
  { value: "SEA_FREIGHT", label: "Sea freight import/export" },
  { value: "AIR_FREIGHT", label: "Air freight" },
  { value: "WAREHOUSING", label: "Warehousing solutions" },
];

const CHANNELS = ["EMAIL", "SMS", "SOCIAL", "WEB", "OTHER"];

const numOrZero = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Cost per lead, mirroring rules.costPerLead: null (rendered "—") rather than
 *  zero when no leads are planned or recorded, because "0 XAF per lead" on a
 *  campaign that produced nothing is the most flattering reading of the worst
 *  result. */
function cpl(budget: number, leads: number): string {
  if (!leads || leads <= 0) return "—";
  return money0(budget / leads);
}

/**
 * The campaign plan — what we will spend and what we expect for it.
 *
 * WHY EVERY FIELD IS NOT ALWAYS EDITABLE. The plan closes when the campaign is
 * submitted: a budget that can still be changed after approval is not a budget
 * that was approved. The API enforces this (rules.assertEditable), and this form
 * mirrors it rather than relying on it — the legacy does the opposite, setting
 * `readOnly` from JS while its save endpoint accepts everything, so the lock
 * holds only for people who use the drawer.
 *
 * Recorded performance is NOT here. It is the other half of the record, it opens
 * exactly when this half closes, and mixing them in one form is what makes a
 * plan look like a result.
 */
export function CampaignForm({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing?: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState("");
  const [platform, setPlatform] = React.useState("META");
  const [channel, setChannel] = React.useState("EMAIL");
  const [targetService, setTargetService] = React.useState("ALL");
  const [startsOn, setStartsOn] = React.useState("");
  const [endsOn, setEndsOn] = React.useState("");
  const [budget, setBudget] = React.useState("0");
  const [currency, setCurrency] = React.useState("XAF");
  const [remarks, setRemarks] = React.useState("");
  const [tLeads, setTLeads] = React.useState("0");
  const [tOps, setTOps] = React.useState("0");
  const [tWon, setTWon] = React.useState("0");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ? String(editing.name) : "");
    setPlatform(editing?.platform ? String(editing.platform) : "META");
    setChannel(editing?.channel ? String(editing.channel) : "EMAIL");
    setTargetService(editing?.target_service ? String(editing.target_service) : "ALL");
    setStartsOn(toDateInput(editing?.starts_on));
    setEndsOn(toDateInput(editing?.ends_on));
    setBudget(editing?.budget_amount != null ? String(editing.budget_amount) : "0");
    setCurrency(editing?.budget_currency ? String(editing.budget_currency) : "XAF");
    setRemarks(editing?.remarks ? String(editing.remarks) : "");
    setTLeads(String(editing?.target_leads ?? 0));
    setTOps(String(editing?.target_opportunities ?? 0));
    setTWon(String(editing?.target_won ?? 0));
    setError(null);
  }, [open, editing]);

  const budgetNum = numOrZero(budget);
  const targetCpl = cpl(budgetNum, numOrZero(tLeads));

  async function submit() {
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      platform,
      channel,
      target_service: targetService.trim() || "ALL",
      starts_on: startsOn || null,
      ends_on: endsOn || null,
      budget_amount: budgetNum,
      budget_currency: currency,
      remarks: remarks.trim() || null,
      target_leads: numOrZero(tLeads),
      target_opportunities: numOrZero(tOps),
      target_won: numOrZero(tWon),
    };
    try {
      if (editing)
        await tenant(`/campaigns/${String(editing.campaign_id)}`, { method: "PATCH", body });
      else await tenant("/campaigns", { method: "POST", body });
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
      title={editing ? "Edit campaign plan" : "New campaign"}
      description="What it costs and what it is expected to return. The plan locks when the campaign is submitted for approval."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" required className="sm:col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q3 freight promo"
            />
          </Field>
          <Field label="Platform" required>
            <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Starts on">
            <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label="Ends on" hint="Blank means ongoing">
            <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
          <Field label="Send channel" hint="Used by the newsletter send">
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Budget" required>
            <Input
              type="number"
              min={0}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <Input
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Target service" hint="Or type your own">
            <Input
              list="campaign-target-services"
              value={targetService}
              onChange={(e) => setTargetService(e.target.value)}
            />
            <datalist id="campaign-target-services">
              {TARGET_SERVICES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </datalist>
          </Field>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Planned targets
            </p>
            <span className="num text-xs font-medium text-foreground">
              Target CPL: {targetCpl}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Leads">
              <Input type="number" min={0} value={tLeads} onChange={(e) => setTLeads(e.target.value)} />
            </Field>
            <Field label="Opportunities">
              <Input type="number" min={0} value={tOps} onChange={(e) => setTOps(e.target.value)} />
            </Field>
            <Field label="Deals won">
              <Input type="number" min={0} value={tWon} onChange={(e) => setTWon(e.target.value)} />
            </Field>
          </div>
        </div>

        <Field label="Remarks / justification">
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            placeholder="Why this campaign, and what management is being asked to fund…"
          />
        </Field>

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim() || busy}>
            {editing ? "Save plan" : "Create campaign"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Record what the campaign actually produced.
 *
 * These figures are TYPED BY A HUMAN from the ad manager's weekly report —
 * nothing in this system measures them, and F8 settles that campaign
 * attribution is out of scope. The notice below says so on the screen where the
 * numbers are entered, and the "last updated" line says when someone last did
 * it, so a stale figure looks stale instead of looking live.
 *
 * `actual_won` and `actual_opportunities` cannot exceed `actual_leads`; the
 * table enforces it, and the form says so before the save rather than after,
 * because that arithmetic is how a typo in a weekly update becomes a
 * conversion rate over 100% in a board pack.
 */
export function ActualsForm({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = !!campaign;
  const [leads, setLeads] = React.useState("0");
  const [ops, setOps] = React.useState("0");
  const [won, setWon] = React.useState("0");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !campaign) return;
    setLeads(String(campaign.actual_leads ?? 0));
    setOps(String(campaign.actual_opportunities ?? 0));
    setWon(String(campaign.actual_won ?? 0));
    setError(null);
  }, [open, campaign]);

  const nLeads = numOrZero(leads);
  const nOps = numOrZero(ops);
  const nWon = numOrZero(won);
  const budgetNum = Number(campaign?.budget_amount ?? 0);
  const incoherent = nWon > nLeads || nOps > nLeads;
  const ended = String(campaign?.status) === "ENDED";

  async function submit() {
    if (!campaign) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/campaigns/${String(campaign.campaign_id)}`, {
        method: "PATCH",
        body: { actual_leads: nLeads, actual_opportunities: nOps, actual_won: nWon },
      });
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
      title={ended ? "Amend recorded performance" : "Record performance"}
      description={
        ended
          ? "This campaign has ended. Amending its figures is an approver's action and is audited."
          : "Figures from the external ad manager report — typed in, not measured."
      }
      size="lg"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Manual entry mode.</span>{" "}
          Leads, opportunities and wins are not measured by this system — nothing
          links a lead back to a campaign. Update them weekly from your ad
          manager's report.
          <span className="block pt-1">
            {campaign?.actuals_updated_at
              ? `Last updated ${dateFmt(campaign.actuals_updated_at)}.`
              : "Never updated."}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Leads generated">
            <Input type="number" min={0} value={leads} onChange={(e) => setLeads(e.target.value)} />
          </Field>
          <Field label="Opportunities">
            <Input type="number" min={0} value={ops} onChange={(e) => setOps(e.target.value)} />
          </Field>
          <Field label="Deals won">
            <Input type="number" min={0} value={won} onChange={(e) => setWon(e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            Budget:{" "}
            <span className="num font-medium text-foreground">
              {money(budgetNum, campaign?.budget_currency ?? "XAF")}
            </span>
          </span>
          <span>
            Cost per lead:{" "}
            <span className="num font-medium text-foreground">{cpl(budgetNum, nLeads)}</span>
          </span>
          <span>
            Conversion:{" "}
            <span className="num font-medium text-foreground">
              {nLeads > 0 ? `${Math.round((nWon / nLeads) * 1000) / 10}%` : "—"}
            </span>
          </span>
        </div>

        {incoherent && (
          <ErrorState message="Opportunities and deals won cannot exceed the leads that produced them." />
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={busy || incoherent}>
            Save figures
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Send a pending campaign back to its planner, with a reason.
 *
 * The reason is required by the API and by the table's CHECK constraint, not
 * only by this form — the legacy asks for it in a browser alert, so a rejection
 * that skips the screen tells the submitter nothing about what to change.
 */
export function RejectCampaignModal({
  campaign,
  onClose,
  onRejected,
}: {
  campaign: Row | null;
  onClose: () => void;
  onRejected: () => void;
}) {
  const open = !!campaign;
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setReason("");
    setError(null);
  }, [open]);

  async function submit() {
    if (!campaign) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/campaigns/${String(campaign.campaign_id)}/reject`, {
        method: "POST",
        body: { reason: reason.trim() },
      });
      onRejected();
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
      title="Send back for correction"
      description="The campaign returns to draft and the planner sees your reason."
      size="lg"
    >
      <div className="space-y-4">
        <Field label="Reason" required>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Budget exceeds the Q1 allocation for sea freight — please reduce by 20%."
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!reason.trim() || busy}>
            Send back
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SubscriberForm({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
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
      await tenant("/campaigns/subscribers", {
        method: "POST",
        body: {
          email: email.trim(),
          name: name.trim() || undefined,
          source: source.trim() || undefined,
        },
      });
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
      title="Add subscriber"
      description="Add someone to the newsletter audience."
    >
      <div className="space-y-4">
        <Field label="Email" required>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@acme.cm"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
            />
          </Field>
          <Field label="Source">
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="website"
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
            disabled={!email.trim() || busy}
          >
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

export function SenderForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (row: Row) => void;
}) {
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
      const row = await tenant<Row>(CAMPAIGN_SENDERS, {
        method: "POST",
        body: { from_name: fromName.trim(), from_address: fromAddress.trim() },
      });
      onCreated(row);
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
      title="New sender"
      description="A sending identity a template can use. Verification is a manual admin stamp for now."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sender name" required>
            <Input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Praxis LS"
            />
          </Field>
          <Field label="Sender address" required>
            <Input
              type="email"
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              placeholder="news@tenant.cm"
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
            disabled={!fromName.trim() || !fromAddress.trim() || busy}
          >
            Add sender
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Keep in sync with MERGE_FIELDS in src/modules/sales/marketing_campaign/marketing_campaign.service.js. */
const MERGE_FIELDS = ["name", "email", "campaign", "year"];

export function TemplateForm({
  open,
  editing,
  senders,
  onClose,
  onSaved,
  onReloadSenders,
}: {
  open: boolean;
  editing: Row | null;
  senders: Row[] | null;
  onClose: () => void;
  onSaved: () => void;
  onReloadSenders: () => void;
}) {
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
    const payload = {
      name: name.trim(),
      subject: subject.trim() || null,
      body_html: body,
      from_sender_id: senderId || null,
    };
    try {
      if (editing)
        await tenant(`${CAMPAIGN_TEMPLATES}/${String(editing.template_id)}`, {
          method: "PATCH",
          body: payload,
        });
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
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit template" : "New email template"}
      description="A reusable campaign email that sends from a chosen sender identity."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Template name" required className="sm:col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Monthly newsletter"
            />
          </Field>
          <Field label="Subject" className="sm:col-span-2">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What's new this month"
            />
          </Field>
          <Field
            label="Sender"
            hint="The verified sending identity"
            className="sm:col-span-2"
          >
            <div className="flex gap-2">
              <div className="flex-1">
                <Select
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                >
                  <option value="">— none —</option>
                  {(senders || []).map((s) => (
                    <option
                      key={String(s.sender_id)}
                      value={String(s.sender_id)}
                    >
                      {senderLabel(s)}
                      {s.verified_at ? "" : " (unverified)"}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSenderOpen(true)}
              >
                New sender
              </Button>
            </div>
          </Field>
          <Field
            label="Body"
            className="sm:col-span-2"
            hint="HTML or plain text"
          >
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="<p>Hello {{name}},…</p>"
            />
          </Field>
          {/* Mirrors MERGE_FIELDS in marketing_campaign.service.js. Unknown tokens
              are left as written so a typo shows up in a test send. */}
          <div className="sm:col-span-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Merge fields</span> —
            usable in the subject and body, replaced per recipient:{" "}
            {MERGE_FIELDS.map((f) => (
              <code
                key={f}
                className="num mr-1.5 rounded bg-background px-1 py-0.5"
              >{`{{${f}}}`}</code>
            ))}
            <span className="block pt-1">
              <code className="num">{"{{name}}"}</code> falls back to the email
              name, then “there”. Anything not in this list is left as written.
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

export function SendCampaignModal({
  campaign,
  templates,
  onClose,
  onSent,
}: {
  campaign: Row | null;
  templates: Row[] | null;
  onClose: () => void;
  onSent: (queued: number) => void;
}) {
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
      const r = await tenant<{ queued?: number }>(
        `/campaigns/${String(campaign.campaign_id)}/send`,
        { method: "POST", body: { template_id: templateId } },
      );
      onSent(Number(r?.queued ?? 0));
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
      title="Send campaign"
      description="Queue this template to every active subscriber, sent from the template's sender identity."
      size="lg"
    >
      <div className="space-y-4">
        <Field label="Template" required>
          <Select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">— select a template —</option>
            {(templates || []).map((t) => (
              <option key={String(t.template_id)} value={String(t.template_id)}>
                {cell(t.name)}
              </option>
            ))}
          </Select>
        </Field>
        {(templates || []).length === 0 && (
          <p className="text-xs text-muted-foreground">
            No templates yet — create one on the Templates tab first.
          </p>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={!templateId || busy}
          >
            Send now
          </Button>
        </div>
      </div>
    </Modal>
  );
}
