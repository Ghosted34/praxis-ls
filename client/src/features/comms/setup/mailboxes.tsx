/**
 * Comms → Setup → Mailboxes (administrators).
 *
 * The whole inventory in one table, and above it the catalogue of team addresses
 * the company SHOULD have — because an empty table tells a new tenant nothing,
 * while a list of seven slots with five unfilled tells them exactly what to do
 * next.
 *
 * ── SLOTS FIRST, MAILBOXES SECOND ───────────────────────────────────────────
 *
 * The seven seeded team addresses (operations, billing, sales, support,
 * procurement, HR, general enquiries) are the shape a freight forwarder runs on,
 * and several already have ERP modules waiting to be wired to them. Showing them
 * as slots turns configuration into a checklist rather than a blank form.
 *
 * ── MEMBERS ARE THE POINT OF A SHARED MAILBOX ───────────────────────────────
 *
 * Reading a team's mail and sending as it are different rights, so the member
 * drawer grants a level rather than a boolean. The picker searches the employee
 * roster server-side and shows each person's job title, because "which Marie" is
 * the question the name alone does not answer.
 */
import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Modal, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill, type Tone } from "@/components/ui/pill";
import { XIcon } from "@/components/ui/icons";
import { DataList, PageHeader, type Column } from "@/components/data-list";
import { EmployeePicker } from "@/components/employee-picker";
import { useResource, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { reportActionError } from "@/lib/action-error";
import { SmtpErrorGuide } from "@/components/mail/smtp-guide";
import * as api from "@/lib/mail-api";
import { HealthPill } from "./health-pill";

const ROLE_LABEL: Record<api.MemberRole, string> = {
  VIEWER: "Read only",
  AGENT: "Can send",
  MANAGER: "Manager",
};
const ROLE_HINT: Record<api.MemberRole, string> = {
  VIEWER: "Reads the mailbox. Cannot send as it.",
  AGENT: "Reads and sends as the mailbox.",
  MANAGER: "Sends, and manages members and settings.",
};

const statusTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "CONNECTED") return "ok";
  if (u === "PENDING") return "warn";
  if (u === "ARCHIVED" || u === "DISABLED") return "mute";
  return "bad";
};

/* ── Create a shared mailbox from a catalogue slot ───────────────────────── */

function CreateSharedModal({
  slot, onClose, onDone,
}: { slot: api.CatalogueEntry | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = React.useState({
    email_address: "", display_name: slot?.label_en || "",
    imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 465,
    auth_user: "", password: "", department: slot?.department || "",
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function preset() {
    if (!f.email_address) return;
    setBusy(true); setError(null);
    try {
      const p = await api.cpanelPreset(f.email_address);
      setF((s) => ({
        ...s, imap_host: p.imap_host, imap_port: p.imap_port,
        smtp_host: p.smtp_host, smtp_port: p.smtp_port, auth_user: p.auth_user,
      }));
      setNote(p.note);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.createSharedMailbox({
        catalogue_key: slot?.catalogue_key ?? null,
        email_address: f.email_address,
        display_name: f.display_name || undefined,
        department: f.department || null,
        imap_host: f.imap_host, imap_port: Number(f.imap_port), imap_secure: true,
        smtp_host: f.smtp_host, smtp_port: Number(f.smtp_port), smtp_secure: true,
        auth_user: f.auth_user || f.email_address,
        password: f.password,
      });
      onDone(); onClose();
    } catch (err) { setError(err); reportActionError(err); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={slot ? `${tr("Set up")} ${slot.label_en}` : tr("Set up a shared mailbox")}
      description={slot?.description_en || tr("A team address several people work together.")}
    >
      <form className="space-y-3" onSubmit={submit}>
        <Field
          label={tr("Address")}
          required
          hint={slot ? `${tr("Usually")} ${slot.suggested_local_part}@yourcompany.cm` : undefined}
        >
          <div className="flex gap-2">
            <Input
              value={f.email_address}
              onChange={set("email_address")}
              placeholder={`${slot?.suggested_local_part || "team"}@yourcompany.cm`}
              type="email"
            />
            <Button type="button" variant="outline" onClick={preset} disabled={!f.email_address || busy}>
              {tr("cPanel settings")}
            </Button>
          </div>
        </Field>
        {note && <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">{note}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("Display name")}><Input value={f.display_name} onChange={set("display_name")} /></Field>
          <Field label={tr("Department")}><Input value={f.department} onChange={set("department")} placeholder={tr("Finance")} /></Field>
          <Field label={tr("IMAP host")} required><Input value={f.imap_host} onChange={set("imap_host")} /></Field>
          <Field label={tr("IMAP port")} required><Input value={String(f.imap_port)} onChange={set("imap_port")} inputMode="numeric" /></Field>
          <Field label={tr("SMTP host")} required><Input value={f.smtp_host} onChange={set("smtp_host")} /></Field>
          <Field label={tr("SMTP port")} required><Input value={String(f.smtp_port)} onChange={set("smtp_port")} inputMode="numeric" /></Field>
          <Field label={tr("Username")} required hint={tr("On cPanel, the full address.")}><Input value={f.auth_user} onChange={set("auth_user")} /></Field>
          <Field label={tr("Password")} required><Input value={f.password} onChange={set("password")} type="password" autoComplete="off" /></Field>
        </div>
        {error != null && (<><ErrorState message={errMsg(error)} /><SmtpErrorGuide err={error} /></>)}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" loading={busy} disabled={busy}>{tr("Create and test")}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Members ─────────────────────────────────────────────────────────────── */

function MembersModal({ mailbox, onClose }: { mailbox: api.Mailbox; onClose: () => void }) {
  const members = useResource(() => api.listMembers(mailbox.email_connection_id), [mailbox.email_connection_id]);
  const [role, setRole] = React.useState<api.MemberRole>("AGENT");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  const chosen = new Set((members.data || []).map((m) => m.user_id));

  async function add(employeeId: string) {
    setBusy(true); setError(null);
    try {
      await api.grantMember(mailbox.email_connection_id, employeeId, role);
      members.reload();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function remove(userId: string) {
    setBusy(true); setError(null);
    try {
      await api.revokeMember(mailbox.email_connection_id, userId);
      members.reload();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${tr("Who can work")} ${mailbox.email_address}`}
      description={tr("Reading a team's mail and sending as it are different rights.")}
    >
      <div className="space-y-4">
        <Field label={tr("Access level for the next person you add")}>
          <Select value={role} onChange={(e) => setRole(e.target.value as api.MemberRole)}>
            {(Object.keys(ROLE_LABEL) as api.MemberRole[]).map((r) => (
              <option key={r} value={r}>{tr(ROLE_LABEL[r])} — {tr(ROLE_HINT[r])}</option>
            ))}
          </Select>
        </Field>

        <EmployeePicker
          label={tr("Add someone")}
          placeholder={tr("Search by name or job title…")}
          exclude={chosen}
          disabled={busy}
          onPick={(e) => add(e.employee_id)}
        />

        {error != null && <ErrorState message={errMsg(error)} />}
        {members.error && <ErrorState message={members.error} />}

        <div>
          <div className="micro mb-1">
            {(members.data || []).length}{" "}
            {(members.data || []).length === 1 ? tr("person") : tr("people")} {tr("with access")}
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(members.data || []).map((m) => (
              <li key={m.email_connection_member_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm">{m.full_name}</div>
                  <div className="micro truncate text-muted-foreground">
                    {[m.job_title, m.department].filter(Boolean).join(" · ") || m.email}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={m.member_role === "VIEWER" ? "mute" : "blue"}>{tr(ROLE_LABEL[m.member_role])}</Pill>
                  <Button type="button" variant="outline" onClick={() => remove(m.user_id)} disabled={busy}>
                    {tr("Remove")}
                  </Button>
                </div>
              </li>
            ))}
            {!members.loading && (members.data || []).length === 0 && (
              <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                {tr("Nobody has been added yet. Only the owner can see this mailbox.")}
              </li>
            )}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

/* ── Limits ──────────────────────────────────────────────────────────────── */

function LimitsModal({ mailbox, onClose, onDone }: { mailbox: api.Mailbox; onClose: () => void; onDone: () => void }) {
  const [f, setF] = React.useState({
    send_limit_hourly: mailbox.send_limit_hourly ?? "",
    send_limit_daily: mailbox.send_limit_daily ?? "",
    sync_depth_days: mailbox.sync_depth_days ?? "",
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const eff = mailbox.effective_limits;

  const num = (v: string | number) => (v === "" || v === null ? null : Number(v));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.setMailboxLimits(mailbox.email_connection_id, {
        send_limit_hourly: num(f.send_limit_hourly),
        send_limit_daily: num(f.send_limit_daily),
        sync_depth_days: num(f.sync_depth_days),
      });
      onDone(); onClose();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${tr("Limits for")} ${mailbox.email_address}`}
      description={tr("Leave a field empty to use the company default.")}
    >
      <form className="space-y-3" onSubmit={submit}>
        <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">
          {tr("Most shared hosts, cPanel included,")} <strong>{tr("suspend")}</strong>{" "}
          {tr("a mailbox that sends more than its hourly allowance. Praxis holds anything over the limit for the next hour and tells the sender when it will go, rather than letting the host cut the mailbox off.")}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={tr("Per hour")} hint={eff ? `${tr("Company default")} ${eff.send_limit_hourly}` : undefined}>
            <Input value={String(f.send_limit_hourly)} inputMode="numeric"
              onChange={(e) => setF((s) => ({ ...s, send_limit_hourly: e.target.value }))} />
          </Field>
          <Field label={tr("Per day")} hint={eff ? `${tr("Company default")} ${eff.send_limit_daily}` : undefined}>
            <Input value={String(f.send_limit_daily)} inputMode="numeric"
              onChange={(e) => setF((s) => ({ ...s, send_limit_daily: e.target.value }))} />
          </Field>
          <Field label={tr("History to sync (days)")} hint={eff ? `${tr("Company default")} ${eff.sync_depth_days}` : undefined}>
            <Input value={String(f.sync_depth_days)} inputMode="numeric"
              onChange={(e) => setF((s) => ({ ...s, sync_depth_days: e.target.value }))} />
          </Field>
        </div>
        {error != null && <ErrorState message={errMsg(error)} />}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" loading={busy} disabled={busy}>{tr("Save")}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Handover ────────────────────────────────────────────────────────────── */

function HandoverModal({
  mailbox, catalogue, onClose, onDone,
}: { mailbox: api.Mailbox; catalogue: api.CatalogueEntry[]; onClose: () => void; onDone: () => void }) {
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const free = catalogue.filter((c) => !c.configured);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.handoverMailbox(mailbox.email_connection_id, { catalogue_key: key || null });
      onDone(); onClose();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`${tr("Hand over")} ${mailbox.email_address}`}
      description={tr("Turns one person's mailbox into a team one.")}>
      <form className="space-y-3" onSubmit={submit}>
        <div className="rounded-lg border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn))]/5 px-3 py-2 text-sm">
          {tr("This takes")} <strong>{mailbox.owner_name || tr("one person")}</strong>&apos;s{" "}
          {tr("correspondence and makes it visible to a team. It is the right thing when somebody leaves and a colleague has to answer their clients, and the wrong thing to do by accident — so it is recorded on the audit trail with your name against it.")}
        </div>
        <Field label={tr("Team address it becomes")} hint={tr("Optional. Leave empty for a shared mailbox with no catalogue slot.")}>
          <Select value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">{tr("— none —")}</option>
            {free.map((c) => <option key={c.catalogue_key} value={c.catalogue_key}>{c.label_en}</option>)}
          </Select>
        </Field>
        {error != null && <ErrorState message={errMsg(error)} />}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" loading={busy} disabled={busy}>{tr("Hand it over")}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── The page ────────────────────────────────────────────────────────────── */

export function MailboxesTab() {
  const boxes = useResource(() => api.allMailboxes(), []);
  const catalogue = useResource(() => api.listCatalogue(), []);
  const [creating, setCreating] = React.useState<api.CatalogueEntry | null | undefined>(undefined);
  const [members, setMembers] = React.useState<api.Mailbox | null>(null);
  const [limits, setLimits] = React.useState<api.Mailbox | null>(null);
  const [handover, setHandover] = React.useState<api.Mailbox | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  const reload = () => { boxes.reload(); catalogue.reload(); };

  async function archive(m: api.Mailbox) {
    setError(null);
    try { await api.archiveMailbox(m.email_connection_id); reload(); }
    catch (err) { setError(err); reportActionError(err); }
  }

  const columns: Column<api.Mailbox & Record<string, unknown>>[] = [
    {
      key: "email_address", label: tr("Address"),
      render: (m) => (
        <div className="min-w-0">
          <div className="num truncate text-sm">{m.email_address}</div>
          <div className="micro truncate text-muted-foreground">
            {m.kind === "PERSONAL" ? m.owner_name || tr("personal") : m.catalogue_label || tr("shared")}
          </div>
        </div>
      ),
    },
    { key: "kind", label: tr("Kind"), render: (m) => <Pill tone={m.kind === "PERSONAL" ? "mute" : "blue"}>{m.kind}</Pill> },
    { key: "status", label: tr("Status"), render: (m) => <Pill tone={statusTone(m.status)}>{m.status}</Pill> },
    { key: "health", label: tr("Health"), render: (m) => <HealthPill health={m.health} /> },
    {
      key: "member_count", label: tr("People"),
      render: (m) => (m.kind === "PERSONAL" ? <span className="text-muted-foreground">—</span> : <span className="num">{m.member_count ?? 0}</span>),
    },
    { key: "last_success_at", label: tr("Last sync"), render: (m) => <span className="num">{m.last_success_at ? dateFmt(m.last_success_at) : "—"}</span> },
    {
      key: "_a", label: "",
      render: (m) => (
        <div className="flex flex-wrap justify-end gap-1">
          {m.kind !== "PERSONAL" && (
            <Button type="button" variant="outline" onClick={() => setMembers(m)}>{tr("People")}</Button>
          )}
          {m.kind === "PERSONAL" && (
            <Button type="button" variant="outline" onClick={() => setHandover(m)}>{tr("Hand over")}</Button>
          )}
          <Button type="button" variant="outline" onClick={() => setLimits(m)}>{tr("Limits")}</Button>
          <Button type="button" variant="outline" onClick={() => archive(m)}>{tr("Retire")}</Button>
        </div>
      ),
    },
  ];

  const unfilled = (catalogue.data || []).filter((c) => !c.configured && c.is_enabled);

  return (
    <section className="space-y-5">
      <PageHeader
        title={tr("Mailboxes")}
        description={tr("Every mailbox in the company — the personal ones people connect themselves, and the team addresses you set up for them.")}
        action={<Button onClick={() => setCreating(null)}>{tr("New shared mailbox")}</Button>}
      />

      {error != null && <ErrorState message={errMsg(error)} />}

      {unfilled.length > 0 && (
        <div className="rounded-xl border border-border p-4">
          <div className="text-sm font-medium">{tr("Team addresses not set up yet")}</div>
          <p className="micro mt-1 text-muted-foreground">
            {tr("These are the addresses a logistics business normally runs. Set one up and the parts of the product that belong to it can send from it.")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {unfilled.map((c) => (
              <button
                key={c.catalogue_key}
                type="button"
                onClick={() => setCreating(c)}
                title={c.description_en || undefined}
                className="rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-accent"
              >
                <div className="font-medium">{c.label_en}</div>
                <div className="micro text-muted-foreground">{c.suggested_local_part}@…</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <DataList
        columns={columns}
        rows={(boxes.data || []) as (api.Mailbox & Record<string, unknown>)[]}
        error={boxes.error}
        loading={boxes.loading}
        rowKey={(m) => m.email_connection_id}
        empty={{
          title: tr("No mailboxes yet"),
          hint: tr("People connect their own from the My mailbox tab. Team addresses are set up here."),
          action: <Button onClick={() => setCreating(null)}>{tr("New shared mailbox")}</Button>,
        }}
      />

      {creating !== undefined && (
        <CreateSharedModal slot={creating} onClose={() => setCreating(undefined)} onDone={reload} />
      )}
      {members && <MembersModal mailbox={members} onClose={() => { setMembers(null); reload(); }} />}
      {limits && <LimitsModal mailbox={limits} onClose={() => setLimits(null)} onDone={reload} />}
      {handover && (
        <HandoverModal mailbox={handover} catalogue={catalogue.data || []}
          onClose={() => setHandover(null)} onDone={reload} />
      )}
    </section>
  );
}

/* ── Mailbox connections (moved from the removed features/comms/mail.tsx) ── */
/*
 * The connect/test/sync surface for the mailboxes a user sends from —
 * IMAP/SMTP, Microsoft 365 and Google Workspace. It lived on the legacy
 * Mail page's "Mailboxes" mode; when that page was reduced to the inbox
 * (PR-1B), the management UI moved here rather than being deleted, because
 * connecting a mailbox is still how a person gets into the product's mail.
 */

const connTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "CONNECTED") return "ok";
  if (u === "PENDING") return "warn";
  return "bad";
};
const providerLabel: Record<api.Provider, string> = {
  imap_smtp: "IMAP / SMTP",
  microsoft_graph: "Microsoft 365",
  google_gmail: "Google Workspace",
};

function ImapConnectForm({
  existing,
  onDone,
}: {
  existing?: api.Connection;
  onDone: () => void;
}) {
  const editing = !!existing;
  const [f, setF] = React.useState({
    email_address: existing?.email_address || "",
    display_name: existing?.display_name || "",
    imap_host: existing?.imap_host || "",
    imap_port: existing?.imap_port != null ? String(existing.imap_port) : "993",
    smtp_host: existing?.smtp_host || "",
    smtp_port: existing?.smtp_port != null ? String(existing.smtp_port) : "587",
    auth_user: existing?.auth_user || "",
    password: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [discovering, setDiscovering] = React.useState(false);
  const [hint, setHint] = React.useState<string>("");
  const [result, setResult] = React.useState<api.TestResult | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  async function discover() {
    if (!f.email_address) return;
    setDiscovering(true);
    setHint("");
    setError(null);
    try {
      const cfg = await api.autodiscover(f.email_address);
      setF((s) => ({
        ...s,
        imap_host: cfg.imap_host || s.imap_host,
        imap_port: cfg.imap_port ? String(cfg.imap_port) : s.imap_port,
        smtp_host: cfg.smtp_host || s.smtp_host,
        smtp_port: cfg.smtp_port ? String(cfg.smtp_port) : s.smtp_port,
      }));
      setHint(
        cfg.oauth_hint
          ? `Tip: ${cfg.oauth_hint === "google_gmail" ? "Google" : "Microsoft"} — consider OAuth above instead of a password.`
          : `Settings from ${cfg.source}. Verify, then connect.`,
      );
    } catch (err) {
      setError(err);
    } finally {
      setDiscovering(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = {
        email_address: f.email_address,
        display_name: f.display_name || undefined,
        imap_host: f.imap_host,
        imap_port: Number(f.imap_port) || undefined,
        smtp_host: f.smtp_host,
        smtp_port: Number(f.smtp_port) || undefined,
        auth_user: f.auth_user || undefined,
        password: f.password || undefined,
      };
      const r = existing
        ? await api.updateImapConnection(existing.email_connection_id, body)
        : await api.connectImap({ ...body, password: f.password });
      setResult(r.test || { ok: r.status === "CONNECTED" });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="micro mb-3">
        Any host (cPanel, private server, provider). Password is encrypted at
        rest.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email address" required>
          <Input
            value={f.email_address}
            onChange={(e) => set("email_address", e.target.value)}
            placeholder="info@company.cm"
          />
        </Field>
        <Field label={tr("Display name")}>
          <Input
            value={f.display_name}
            onChange={(e) => set("display_name", e.target.value)}
            placeholder="Company Info"
          />
        </Field>
        <Field label="IMAP host" required>
          <Input
            value={f.imap_host}
            onChange={(e) => set("imap_host", e.target.value)}
            placeholder="mail.company.cm"
          />
        </Field>
        <Field label="IMAP port">
          <Input
            type="number"
            className="num"
            value={f.imap_port}
            onChange={(e) => set("imap_port", e.target.value)}
          />
        </Field>
        <Field label={tr("SMTP host")} required>
          <Input
            value={f.smtp_host}
            onChange={(e) => set("smtp_host", e.target.value)}
            placeholder="mail.company.cm"
          />
        </Field>
        <Field label={tr("SMTP port")}>
          <Input
            type="number"
            className="num"
            value={f.smtp_port}
            onChange={(e) => set("smtp_port", e.target.value)}
          />
        </Field>
        <Field label="Login user" hint="Defaults to the email address.">
          <Input
            value={f.auth_user}
            onChange={(e) => set("auth_user", e.target.value)}
            placeholder={tr("optional")}
          />
        </Field>
        <Field
          label={tr("Password")}
          required={!editing}
          hint={
            editing ? "Leave blank to keep the current password." : undefined
          }
        >
          <Input
            type="password"
            value={f.password}
            onChange={(e) => set("password", e.target.value)}
            placeholder="••••••"
          />
        </Field>
      </div>
      {hint && <p className="mt-2 micro">{hint}</p>}
      {error != null && (
        <div className="mt-2">
          <ErrorState message={errMsg(error)} />
          <SmtpErrorGuide err={error} />
        </div>
      )}
      {result && (
        <div className="mt-2 micro">
          {result.ok ? (
            <span className="text-[rgb(var(--ok))]">✓ Connected</span>
          ) : (
            <span className="text-[rgb(var(--bad))]">
              ✗ {String(result.error || "Failed").slice(0, 90)}
            </span>
          )}
        </div>
      )}
      {result && !result.ok && (
        <SmtpErrorGuide code={result.code} message={result.error} />
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={discover}
          loading={discovering}
          disabled={discovering || !f.email_address}
        >
          Autodiscover
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={busy}
          disabled={
            busy ||
            !f.email_address ||
            !f.imap_host ||
            !f.smtp_host ||
            (!editing && !f.password)
          }
        >
          {editing ? "Save & test" : "Connect & test"}
        </Button>
      </div>
    </form>
  );
}

/* Right-side sheet — a lightweight drawer (Radix dialog pinned to the right edge,
   overlay not push) for the connect form. Distinct from the AI copilot drawer,
   which is copilot-specific. */
function RightDrawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-fade-in" />
        {/* Starts at `--titlebar-h`, not at 0, for the reason the Praxis drawer
            does (see praxis-drawer.tsx): pinned to the right edge, a full-height
            sheet puts its own close button underneath the OS caption buttons in
            an installed window. Any right-edge sheet inherits that problem, so
            it inherits the same one-variable answer. */}
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed bottom-0 right-0 top-[var(--titlebar-h)] z-50 flex w-[min(560px,100vw)] flex-col border-l border-t border-border bg-card shadow-2xl outline-none data-[state=open]:animate-fade-in"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <RadixDialog.Title className="font-display text-base">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label={tr("Close")}
                className="tap-24 grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <XIcon width={16} height={16} />
              </button>
            </RadixDialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function ConnectionsTab() {
  const conns = useResource(() => api.listConnections(), []);
  const [busyId, setBusyId] = React.useState<string>("");
  const [note, setNote] = React.useState<string>("");
  const [imapOpen, setImapOpen] = React.useState(false);
  const [editConn, setEditConn] = React.useState<api.Connection | null>(null);
  // A failed connection test with a classified SMTP code — renders the fix guide.
  const [testFail, setTestFail] = React.useState<{
    code?: string;
    message?: string;
  } | null>(null);

  // Surface the OAuth callback result. The provider redirect lands back on
  // /comms/mail?mail_connected=<provider> (or ?mail_error=<code>); show it,
  // refresh the mailbox list, then strip the query so a reload doesn't replay it.
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ok = p.get("mail_connected");
    const bad = p.get("mail_error");
    if (!ok && !bad) return;
    if (ok) {
      const who = ok === "google" ? "Google" : "Microsoft";
      const email = p.get("email");
      setNote(`✓ Connected ${who}${email ? ` — ${email}` : ""}`);
      conns.reload();
    } else {
      setNote(`✗ Connection failed (${bad})`);
      setTestFail({ code: bad ?? undefined, message: undefined });
    }
    window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── The OAuth kick-off, hidden with its two buttons ──────────────────────
   *
   * Commented out rather than deleted, for the reason set out beside the
   * buttons below: Microsoft Graph and Gmail are gated off for this programme
   * (Q4, Q11, PR-0 P4), not abandoned. `api.startMicrosoft` and
   * `api.startGoogle` are still exported, the adapters still have their CI
   * tests, and the server now refuses the flow itself
   * (`mail.service.assertProviderEnabled`, on both `startOAuth` and
   * `completeOAuth`). Re-enabling a provider should be un-commenting this and
   * the buttons, not rediscovering how the redirect worked.
   *
   *   async function oauth(kind: "ms" | "gg") {
   *     try {
   *       const r =
   *         kind === "ms" ? await api.startMicrosoft() : await api.startGoogle();
   *       window.location.href = r.url;
   *     } catch (err) {
   *       setNote(errMsg(err));
   *     }
   *   }
   */
  async function test(id: string) {
    setBusyId(id);
    setNote("");
    setTestFail(null);
    try {
      const r = await api.testConnection(id);
      setNote(r.ok ? `✓ ${tr("Connection OK")}` : `✗ ${r.error || tr("failed")}`);
      if (!r.ok) setTestFail({ code: r.code, message: r.error });
      conns.reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusyId("");
    }
  }
  async function sync(id: string) {
    setBusyId(id);
    setNote("");
    try {
      const r = await api.syncConnection(id);
      setNote(r.error ? `✗ ${r.error}` : `✓ ${tr("Synced")} — ${r.inserted ?? 0} ${tr("new")}`);
      conns.reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusyId("");
    }
  }
  /**
   * Disconnect — the action a person could not reach at all.
   *
   * `window.confirm` rather than a modal, deliberately: this is destructive of
   * a credential and the sentence has to be READ, and every dialog in this app
   * is dismissible by clicking outside it. What the sentence says is the point
   * — most people read "disconnect" as "delete my mail", and the difference
   * matters the first time somebody needs last March's bill of lading.
   */
  async function disconnect(c: api.Connection) {
    const ok = window.confirm(
      `${tr("Disconnect")} ${c.email_address}?\n\n` +
      tr("New mail stops arriving and the saved password is deleted. Everything already received stays here and stays readable. You can connect the address again later.")
    );
    if (!ok) return;
    setBusyId(c.email_connection_id);
    setNote("");
    try {
      await api.disconnectMailbox(c.email_connection_id);
      setNote(`✓ ${tr("Disconnected")} — ${c.email_address}`);
      conns.reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusyId("");
    }
  }

  async function makeDefault(id: string) {
    setBusyId(id);
    setNote("");
    try {
      await api.setDefaultMailbox(id);
      setNote(`✓ ${tr("Default mailbox updated")}`);
      conns.reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Connect Microsoft 365 / Connect Google Workspace: HIDDEN ─────────
       *
       * Not deleted — hidden, because the adapters are not dead code. Q4 and
       * Q11 put Microsoft Graph and Gmail out of scope for this programme
       * ("one provider properly rather than four adequately"), and PR-0 P4 kept
       * them "kept and tested but gated off — server-side, not only in the UI".
       * The adapters, their tests and `oauth()` below all still work; the day
       * `mail.provider.oauth` is turned on, this block comes back and nothing
       * else has to change.
       *
       * The server now agrees, which it did not before: `startOAuth` and
       * `completeOAuth` both call `assertProviderEnabled`. Until that was
       * added, the gate sat only on `connect()` — which the OAuth path never
       * goes through, since `completeOAuth` inserts its own connection row —
       * so hiding these two buttons was literally the only thing standing
       * between a caller and a half-supported provider.
       *
       *   <Button variant="outline" onClick={() => oauth("ms")}>
       *     Connect Microsoft 365
       *   </Button>
       *   <Button variant="outline" onClick={() => oauth("gg")}>
       *     Connect Google Workspace
       *   </Button>
       */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setImapOpen(true)}>
          {tr("Connect a mailbox")}
        </Button>
        {note && <span className="micro">{note}</span>}
      </div>

      {testFail && (
        <SmtpErrorGuide code={testFail.code} message={testFail.message} />
      )}
      {conns.error && <ErrorState message={conns.error} />}
      <div className="grid gap-3">
        {(conns.data || []).map((c) => (
          <div
            key={c.email_connection_id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="num font-medium text-foreground">
                  {c.email_address}
                </span>
                <Pill tone="mute">{providerLabel[c.provider]}</Pill>
                <Pill tone={connTone(c.status)}>{c.status}</Pill>
                {c.is_default && <Pill tone="ok">{tr("Default")}</Pill>}
              </div>
              <p className="micro mt-0.5">
                {tr("Last sync")} {dateFmt(c.last_sync_at)}
                {c.last_error ? ` · ${c.last_error.slice(0, 60)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!c.is_default && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => makeDefault(c.email_connection_id)}
                  disabled={busyId === c.email_connection_id}
                >
                  {tr("Make default")}
                </Button>
              )}
              {c.provider === "imap_smtp" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditConn(c)}
                >
                  {tr("Edit")}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => test(c.email_connection_id)}
                disabled={busyId === c.email_connection_id}
              >
                {tr("Test")}
              </Button>
              <Button
                size="sm"
                onClick={() => sync(c.email_connection_id)}
                loading={busyId === c.email_connection_id}
              >
                {tr("Sync now")}
              </Button>
              {/* Last, and quiet. It is the one control here that cannot be
                  undone by pressing it again. */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => disconnect(c)}
                disabled={busyId === c.email_connection_id}
              >
                {tr("Disconnect")}
              </Button>
            </div>
          </div>
        ))}
        {(conns.data || []).length === 0 && !conns.loading && (
          <p className="micro">{tr("No mailboxes connected yet.")}</p>
        )}
      </div>

      <RightDrawer
        open={imapOpen || !!editConn}
        onOpenChange={(v) => {
          if (!v) {
            setImapOpen(false);
            setEditConn(null);
          }
        }}
        title={
          editConn
            ? tr("Edit this mailbox")
            : tr("Connect a mailbox")
        }
      >
        <ImapConnectForm
          key={editConn?.email_connection_id ?? "new"}
          existing={editConn ?? undefined}
          onDone={() => {
            conns.reload();
            setImapOpen(false);
            setEditConn(null);
          }}
        />
      </RightDrawer>
    </div>
  );
}
