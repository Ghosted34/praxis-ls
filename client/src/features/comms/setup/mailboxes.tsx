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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Modal, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill, type Tone } from "@/components/ui/pill";
import { DataList, PageHeader, type Column } from "@/components/data-list";
import { EmployeePicker } from "@/components/employee-picker";
import { useResource, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
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
      title={slot ? `Set up ${slot.label_en}` : "Set up a shared mailbox"}
      description={slot?.description_en || "A team address several people work together."}
    >
      <form className="space-y-3" onSubmit={submit}>
        <Field
          label="Address"
          required
          hint={slot ? `Usually ${slot.suggested_local_part}@yourcompany.cm` : undefined}
        >
          <div className="flex gap-2">
            <Input
              value={f.email_address}
              onChange={set("email_address")}
              placeholder={`${slot?.suggested_local_part || "team"}@yourcompany.cm`}
              type="email"
            />
            <Button type="button" variant="outline" onClick={preset} disabled={!f.email_address || busy}>
              cPanel settings
            </Button>
          </div>
        </Field>
        {note && <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">{note}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name"><Input value={f.display_name} onChange={set("display_name")} /></Field>
          <Field label="Department"><Input value={f.department} onChange={set("department")} placeholder="Finance" /></Field>
          <Field label="IMAP host" required><Input value={f.imap_host} onChange={set("imap_host")} /></Field>
          <Field label="IMAP port" required><Input value={String(f.imap_port)} onChange={set("imap_port")} inputMode="numeric" /></Field>
          <Field label="SMTP host" required><Input value={f.smtp_host} onChange={set("smtp_host")} /></Field>
          <Field label="SMTP port" required><Input value={String(f.smtp_port)} onChange={set("smtp_port")} inputMode="numeric" /></Field>
          <Field label="Username" required hint="On cPanel, the full address."><Input value={f.auth_user} onChange={set("auth_user")} /></Field>
          <Field label="Password" required><Input value={f.password} onChange={set("password")} type="password" autoComplete="off" /></Field>
        </div>
        {error != null && (<><ErrorState message={errMsg(error)} /><SmtpErrorGuide err={error} /></>)}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy}>Create and test</Button>
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
      title={`Who can work ${mailbox.email_address}`}
      description="Reading a team's mail and sending as it are different rights."
    >
      <div className="space-y-4">
        <Field label="Access level for the next person you add">
          <Select value={role} onChange={(e) => setRole(e.target.value as api.MemberRole)}>
            {(Object.keys(ROLE_LABEL) as api.MemberRole[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]} — {ROLE_HINT[r]}</option>
            ))}
          </Select>
        </Field>

        <EmployeePicker
          label="Add someone"
          placeholder="Search by name or job title…"
          exclude={chosen}
          disabled={busy}
          onPick={(e) => add(e.employee_id)}
        />

        {error != null && <ErrorState message={errMsg(error)} />}
        {members.error && <ErrorState message={members.error} />}

        <div>
          <div className="micro mb-1">
            {(members.data || []).length} {(members.data || []).length === 1 ? "person" : "people"} with access
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
                  <Pill tone={m.member_role === "VIEWER" ? "mute" : "blue"}>{ROLE_LABEL[m.member_role]}</Pill>
                  <Button type="button" variant="outline" onClick={() => remove(m.user_id)} disabled={busy}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
            {!members.loading && (members.data || []).length === 0 && (
              <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                Nobody has been added yet. Only the owner can see this mailbox.
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
      title={`Limits for ${mailbox.email_address}`}
      description="Leave a field empty to use the company default."
    >
      <form className="space-y-3" onSubmit={submit}>
        <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">
          Most shared hosts, cPanel included, <strong>suspend</strong> a mailbox that sends more than
          its hourly allowance. Praxis holds anything over the limit for the next hour and tells the
          sender when it will go, rather than letting the host cut the mailbox off.
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Per hour" hint={eff ? `Company default ${eff.send_limit_hourly}` : undefined}>
            <Input value={String(f.send_limit_hourly)} inputMode="numeric"
              onChange={(e) => setF((s) => ({ ...s, send_limit_hourly: e.target.value }))} />
          </Field>
          <Field label="Per day" hint={eff ? `Company default ${eff.send_limit_daily}` : undefined}>
            <Input value={String(f.send_limit_daily)} inputMode="numeric"
              onChange={(e) => setF((s) => ({ ...s, send_limit_daily: e.target.value }))} />
          </Field>
          <Field label="History to sync (days)" hint={eff ? `Company default ${eff.sync_depth_days}` : undefined}>
            <Input value={String(f.sync_depth_days)} inputMode="numeric"
              onChange={(e) => setF((s) => ({ ...s, sync_depth_days: e.target.value }))} />
          </Field>
        </div>
        {error != null && <ErrorState message={errMsg(error)} />}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy}>Save</Button>
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
    <Modal open onClose={onClose} title={`Hand over ${mailbox.email_address}`}
      description="Turns one person's mailbox into a team one.">
      <form className="space-y-3" onSubmit={submit}>
        <div className="rounded-lg border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn))]/5 px-3 py-2 text-sm">
          This takes <strong>{mailbox.owner_name || "one person"}</strong>&apos;s correspondence and makes it
          visible to a team. It is the right thing when somebody leaves and a colleague has to answer
          their clients, and the wrong thing to do by accident — so it is recorded on the audit trail
          with your name against it.
        </div>
        <Field label="Team address it becomes" hint="Optional. Leave empty for a shared mailbox with no catalogue slot.">
          <Select value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">— none —</option>
            {free.map((c) => <option key={c.catalogue_key} value={c.catalogue_key}>{c.label_en}</option>)}
          </Select>
        </Field>
        {error != null && <ErrorState message={errMsg(error)} />}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy}>Hand it over</Button>
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
      key: "email_address", label: "Address",
      render: (m) => (
        <div className="min-w-0">
          <div className="num truncate text-sm">{m.email_address}</div>
          <div className="micro truncate text-muted-foreground">
            {m.kind === "PERSONAL" ? m.owner_name || "personal" : m.catalogue_label || "shared"}
          </div>
        </div>
      ),
    },
    { key: "kind", label: "Kind", render: (m) => <Pill tone={m.kind === "PERSONAL" ? "mute" : "blue"}>{m.kind}</Pill> },
    { key: "status", label: "Status", render: (m) => <Pill tone={statusTone(m.status)}>{m.status}</Pill> },
    { key: "health", label: "Health", render: (m) => <HealthPill health={m.health} /> },
    {
      key: "member_count", label: "People",
      render: (m) => (m.kind === "PERSONAL" ? <span className="text-muted-foreground">—</span> : <span className="num">{m.member_count ?? 0}</span>),
    },
    { key: "last_success_at", label: "Last sync", render: (m) => <span className="num">{m.last_success_at ? dateFmt(m.last_success_at) : "—"}</span> },
    {
      key: "_a", label: "",
      render: (m) => (
        <div className="flex flex-wrap justify-end gap-1">
          {m.kind !== "PERSONAL" && (
            <Button type="button" variant="outline" onClick={() => setMembers(m)}>People</Button>
          )}
          {m.kind === "PERSONAL" && (
            <Button type="button" variant="outline" onClick={() => setHandover(m)}>Hand over</Button>
          )}
          <Button type="button" variant="outline" onClick={() => setLimits(m)}>Limits</Button>
          <Button type="button" variant="outline" onClick={() => archive(m)}>Retire</Button>
        </div>
      ),
    },
  ];

  const unfilled = (catalogue.data || []).filter((c) => !c.configured && c.is_enabled);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Mailboxes"
        description="Every mailbox in the company — the personal ones people connect themselves, and the team addresses you set up for them."
        action={<Button onClick={() => setCreating(null)}>New shared mailbox</Button>}
      />

      {error != null && <ErrorState message={errMsg(error)} />}

      {unfilled.length > 0 && (
        <div className="rounded-xl border border-border p-4">
          <div className="text-sm font-medium">Team addresses not set up yet</div>
          <p className="micro mt-1 text-muted-foreground">
            These are the addresses a logistics business normally runs. Set one up and the parts of
            the product that belong to it can send from it.
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
          title: "No mailboxes yet",
          hint: "People connect their own from the My mailbox tab. Team addresses are set up here.",
          action: <Button onClick={() => setCreating(null)}>New shared mailbox</Button>,
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
