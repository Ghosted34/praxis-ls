/**
 * A client's portal, managed from the client's own record (Client 360 → Portal).
 *
 *   PEOPLE       who at the client can sign in, what each of them sees
 *                (Everything / Shipments & documents / Billing), who manages
 *                their team, until when — and the invitation each is waiting
 *                on. Invite, resend, change and remove all happen here; the
 *                Settings → Portal access screen keeps investors and auditors.
 *   ONBOARDING   the client's checklist, ticked off as each step completes.
 *                The steps themselves are the tenant's, set once for every
 *                client in ⚙ Settings on the Clients list.
 *
 * TWO SHELLS, ONE BODY — the rule every tab of this 360 already follows
 * (FRONTEND_GUIDE §3.16). On a desktop the people are the same `MiniTable` the
 * Documents and Banks tabs draw, a column per fact and the row's actions at its
 * end, and the checklist is a dense list of checkboxes; on a phone the people
 * are `RecordCard`s (one visible action, the rest behind ⋯) and each step is a
 * full-width row a thumb can hit. `useIsCompact()` picks one — never both
 * mounted, never a CSS `hidden` pair.
 *
 * Gated on MOD-29 (the client portal) server-side; the tab hides for anyone
 * who cannot read it. The API is the authority for create/edit.
 */
import * as React from "react";
import { tr, tv, currentLocale } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { errMsg, isFeatureDisabled, useResource } from "@/lib/use-resource";
import { dateFmt, todayISO } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useIsCompact } from "@/lib/use-media-query";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Checkbox, RadioGroup } from "@/components/ui/checkbox";
import { Pill, type Tone } from "@/components/ui/pill";
import { MoreMenu } from "@/components/ui/more-menu";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { ResponsiveList, RecordCard } from "@/components/ui/responsive-list";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { CheckIcon, MailIcon, ShieldIcon } from "@/components/ui/icons";
import { MiniTable, Th, Td } from "@/features/masterdata/mini-table";
import { SCOPE_LABEL, type PortalScope } from "./portal-scope";

/* ── shapes (portal_client.controller staffPeople / peopleWithLogins) ───── */

export type SignIn = "ACTIVE" | "INVITED" | "INVITE_EXPIRED" | "NOT_INVITED" | "DISABLED";

export type PortalPerson = {
  portal_access_id: string;
  email: string;
  client_id: string;
  access_scope: PortalScope;
  is_client_admin: boolean;
  invited_by_email: string | null;
  created_at: string;
  expires_at: string | null;
  full_name: string | null;
  last_login_at: string | null;
  sign_in: SignIn;
  invited_at: string | null;
  invite_expires_at: string | null;
};

export type InviteDefaults = { access_scope: PortalScope; first_is_admin: boolean };
type People = { members: PortalPerson[]; defaults: InviteDefaults };
type Added = PortalPerson & { invite: { sent: boolean; emailed: boolean } };

/** A contact on the client's record, offered as a one-tap invite. */
export type ContactSuggestion = { name: string; email: string };

const SCOPES: PortalScope[] = ["ALL", "OPERATIONS", "BILLING"];
const SCOPE_HINT: Record<PortalScope, string> = {
  ALL: "Shipments, documents, invoices and payments",
  OPERATIONS: "Shipments and their documents — no invoices",
  BILLING: "Invoices and payments only",
};
const SIGN_IN_TONE: Record<SignIn, Tone> = {
  ACTIVE: "ok",
  INVITED: "blue",
  INVITE_EXPIRED: "warn",
  NOT_INVITED: "mute",
  DISABLED: "bad",
};
const SIGN_IN_LABEL: Record<SignIn, string> = {
  ACTIVE: "Can sign in",
  INVITED: "Invitation sent",
  INVITE_EXPIRED: "Invitation expired",
  NOT_INVITED: "Not invited yet",
  DISABLED: "Sign-in switched off",
};

/** The stored end is the last instant of a day; the form edits the day. */
const dayOf = (ts: string | null) => (ts ? String(ts).slice(0, 10) : "");
const ended = (p: PortalPerson) => !!p.expires_at && Date.parse(p.expires_at) < Date.now();
const displayName = (p: PortalPerson) => p.full_name || p.email;
/** A login from before the name was required — staff add it from Edit. */
const nameMissing = (p: PortalPerson) => !p.full_name || !p.full_name.trim();
/** Whether the row offers an invitation — anyone who cannot sign in yet. */
const canInvite = (p: PortalPerson) => p.sign_in !== "ACTIVE";
const inviteLabel = (p: PortalPerson) => (p.sign_in === "INVITED" ? tr("Resend invitation") : tr("Send invitation"));

/** The one line under a person's status: when they last signed in, or how their link stands. */
function signInDetail(p: PortalPerson): string | null {
  if (p.sign_in === "ACTIVE") return p.last_login_at ? tv("Last signed in {{date}}", { date: dateFmt(p.last_login_at) }) : null;
  if (p.sign_in === "INVITED" && p.invite_expires_at) return tv("Link valid until {{date}}", { date: dateFmt(p.invite_expires_at) });
  return null;
}

const peoplePath = (clientId: string) => `/portal/clients/${encodeURIComponent(clientId)}/people`;

/**
 * A section heading and its one action — the same markup as the `Section`
 * the Documents, Contacts and Banks tabs of this 360 use, so the Portal tab's
 * headings sit exactly where theirs do.
 */
export function PortalSectionHeader({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </div>
  );
}

/* ── people ─────────────────────────────────────────────────────────────── */

export function ClientPortalPeople({
  clientId,
  contacts = [],
}: {
  clientId: string;
  contacts?: ContactSuggestion[];
}) {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const people = useResource(() => tenant<People>(peoplePath(clientId)), [clientId], { fresh: true });
  const [inviting, setInviting] = React.useState(false);
  const [editing, setEditing] = React.useState<PortalPerson | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const members = people.data?.members ?? [];
  const defaults = people.data?.defaults ?? { access_scope: "ALL", first_is_admin: true };
  const taken = new Set(members.map((m) => m.email.toLowerCase()));
  const suggestions = contacts.filter((c) => c.email && !taken.has(c.email.toLowerCase()));

  /** Send or re-send one person's link, from their row. */
  async function invite(p: PortalPerson) {
    setBusy(p.portal_access_id);
    try {
      const r = await tenant<Added>(`${peoplePath(clientId)}/${encodeURIComponent(p.portal_access_id)}/invite`, { method: "POST" });
      if (r.invite.emailed) toast.success(tv("Invitation sent to {{email}}.", { email: p.email }));
      else toast.error(tr("The link is ready but the email could not be sent. Try again in a moment."));
      // An open sheet shows the new state of the link, not the one it opened on.
      setEditing((cur) => (cur && cur.portal_access_id === p.portal_access_id ? r : cur));
      people.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: PortalPerson) {
    const ok = await confirm({
      title: tv("Remove {{name}}'s access?", { name: displayName(p) }),
      body: tr("They can no longer see this client's shipments, documents or invoices. You can invite them again later."),
      confirmLabel: tr("Remove access"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(p.portal_access_id);
    try {
      await tenant(`${peoplePath(clientId)}/${encodeURIComponent(p.portal_access_id)}/revoke`, { method: "POST" });
      toast.success(tv("{{name}} no longer has access.", { name: displayName(p) }));
      setEditing(null);
      people.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  if (isFeatureDisabled(people.errorCode)) {
    return (
      <section className="min-w-0">
        <PortalSectionHeader title={tr("Who can sign in")} />
        <EmptyState
          title={tr("The client portal is not switched on")}
          hint={tr("It is part of the plan your administrator manages. Once it is on, you give access from here.")}
        />
      </section>
    );
  }

  /** The row's less-used actions — the invitation when it is not the visible one, and Remove, last. */
  const menu = (p: PortalPerson, withInvite: boolean) => (
    <MoreMenu label={tv("Actions for {{name}}", { name: displayName(p) })} disabled={busy === p.portal_access_id}>
      {withInvite && canInvite(p) ? (
        <>
          <DropdownItem onSelect={() => void invite(p)}>{inviteLabel(p)}</DropdownItem>
          <DropdownSeparator />
        </>
      ) : null}
      <DropdownItem destructive onSelect={() => void remove(p)}>
        {tr("Remove access")}
      </DropdownItem>
    </MoreMenu>
  );

  return (
    <section className="min-w-0">
      <PortalSectionHeader
        title={tr("Who can sign in")}
        action={
          people.data ? (
            <Button size="sm" variant="outline" icon={null} onClick={() => setInviting(true)}>
              {tr("+ Invite")}
            </Button>
          ) : undefined
        }
      />
      {people.error ? (
        <ErrorState message={people.error} />
      ) : !people.data ? (
        <SkeletonTable />
      ) : members.length === 0 ? (
        <EmptyState
          title={tr("Nobody at this client can sign in yet")}
          hint={tr("Invite their main contact. They get an email to set a password, and can then add their own colleagues.")}
          action={<Button onClick={() => setInviting(true)}>{tr("Invite someone")}</Button>}
        />
      ) : (
        <ResponsiveList
          items={members}
          renderItem={(p) => (
            <RecordCard
              title={displayName(p)}
              subtitle={p.full_name ? p.email : undefined}
              pills={<PersonPills p={p} />}
              meta={[
                [tr("Sign-in"), signInDetail(p)],
                [tr("Access until"), p.expires_at ? dateFmt(p.expires_at) : null],
              ]}
              actions={
                <>
                  <Button size="sm" variant="outline" icon={null} onClick={() => setEditing(p)}>
                    {tr("Edit")}
                  </Button>
                  {menu(p, true)}
                </>
              }
            />
          )}
        >
          <MiniTable
            empty={false}
            head={
              <>
                <Th>{tr("Person")}</Th>
                <Th>{tr("What they see")}</Th>
                <Th>{tr("Sign-in")}</Th>
                <Th>{tr("Access until")}</Th>
                <Th>
                  <span className="sr-only">{tr("Actions")}</span>
                </Th>
              </>
            }
          >
            {/* Nothing in a row wraps: the short columns hold their line, a
                long address is cut with its full text on hover, and the
                invitation lives under the status it changes — so a row is one
                or two lines of text, never a tower of wrapped words. */}
            {members.map((p) => (
              <tr key={p.portal_access_id} className={ended(p) ? "opacity-60" : undefined}>
                <Td>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="max-w-[14rem] truncate font-medium text-foreground 2xl:max-w-[28rem]" title={displayName(p)}>
                      {displayName(p)}
                    </span>
                    {p.is_client_admin ? (
                      <Pill tone="ok">
                        <ShieldIcon width={12} height={12} aria-hidden />
                        {tr("Admin")}
                      </Pill>
                    ) : null}
                  </div>
                  {/* The second line: their address under a name, or — for a
                      login from before names were required — the flag that
                      one is missing, where it costs the row no width. */}
                  {p.full_name ? (
                    <div className="max-w-[14rem] truncate text-xs text-muted-foreground 2xl:max-w-[28rem]" title={p.email}>
                      {p.email}
                    </div>
                  ) : nameMissing(p) ? (
                    <div className="whitespace-nowrap">
                      <Pill tone="warn">{tr("Name missing")}</Pill>
                    </div>
                  ) : null}
                </Td>
                <Td>
                  <span className="whitespace-nowrap">{tr(SCOPE_LABEL[p.access_scope])}</span>
                </Td>
                <Td>
                  <div className="whitespace-nowrap">
                    <Pill tone={SIGN_IN_TONE[p.sign_in]}>{tr(SIGN_IN_LABEL[p.sign_in])}</Pill>
                  </div>
                  {canInvite(p) ? (
                    <button
                      type="button"
                      disabled={busy === p.portal_access_id}
                      onClick={() => void invite(p)}
                      className="whitespace-nowrap text-xs font-medium text-primary-ink underline-offset-2 hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {busy === p.portal_access_id ? tr("Sending…") : inviteLabel(p)}
                    </button>
                  ) : signInDetail(p) ? (
                    <div className="whitespace-nowrap text-xs text-muted-foreground">{signInDetail(p)}</div>
                  ) : null}
                </Td>
                <Td>
                  <span className="whitespace-nowrap">
                    {p.expires_at ? (
                      ended(p) ? (
                        <Pill tone="bad">{tr("Access ended")}</Pill>
                      ) : (
                        dateFmt(p.expires_at)
                      )
                    ) : (
                      <span className="text-muted-foreground">{tr("No end date")}</span>
                    )}
                  </span>
                </Td>
                <Td r>
                  <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                    <Button size="sm" variant="ghost" icon={null} onClick={() => setEditing(p)}>
                      {tr("Edit")}
                    </Button>
                    {menu(p, true)}
                  </div>
                </Td>
              </tr>
            ))}
          </MiniTable>
        </ResponsiveList>
      )}

      <InviteSheet
        open={inviting}
        clientId={clientId}
        defaults={defaults}
        firstPerson={members.length === 0}
        suggestions={suggestions}
        onClose={() => setInviting(false)}
        onDone={people.reload}
      />
      <PersonSheet
        person={editing}
        clientId={clientId}
        busy={editing ? busy === editing.portal_access_id : false}
        onClose={() => setEditing(null)}
        onSaved={people.reload}
        onInvite={(p) => void invite(p)}
        onRemove={(p) => void remove(p)}
      />
      {confirmDialog}
    </section>
  );
}

/** A person's status pills, in the phone card's order: scope, role, sign-in, end. */
function PersonPills({ p }: { p: PortalPerson }) {
  return (
    <>
      {nameMissing(p) ? <Pill tone="warn">{tr("Name missing")}</Pill> : null}
      <Pill tone="blue">{tr(SCOPE_LABEL[p.access_scope])}</Pill>
      {p.is_client_admin ? (
        <Pill tone="ok">
          <ShieldIcon width={12} height={12} aria-hidden />
          {tr("Admin")}
        </Pill>
      ) : null}
      <Pill tone={SIGN_IN_TONE[p.sign_in]}>{tr(SIGN_IN_LABEL[p.sign_in])}</Pill>
      {ended(p) ? <Pill tone="bad">{tr("Access ended")}</Pill> : null}
    </>
  );
}

function ScopeChoice({ value, onChange }: { value: PortalScope; onChange: (s: PortalScope) => void }) {
  return (
    <RadioGroup
      aria-label={tr("What they see")}
      value={value}
      onValueChange={(v) => onChange(v as PortalScope)}
      options={SCOPES.map((s) => ({ value: s, label: tr(SCOPE_LABEL[s]), hint: tr(SCOPE_HINT[s]) }))}
      className="rounded-xl border bg-card p-3"
    />
  );
}

function InviteSheet({
  open,
  clientId,
  defaults,
  firstPerson,
  suggestions,
  onClose,
  onDone,
}: {
  open: boolean;
  clientId: string;
  defaults: InviteDefaults;
  firstPerson: boolean;
  suggestions: ContactSuggestion[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState<PortalScope>(defaults.access_scope);
  const [admin, setAdmin] = React.useState(false);
  const [until, setUntil] = React.useState("");
  const [send, setSend] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEmail("");
    setName("");
    setNameError(null);
    setScope(defaults.access_scope);
    // The tenant's rule, shown rather than applied behind the person's back:
    // the box starts ticked for a client's first person when that is the
    // setting, and they can untick it.
    setAdmin(firstPerson && defaults.first_is_admin);
    setUntil("");
    setSend(true);
    setError(null);
  }, [open, defaults.access_scope, defaults.first_is_admin, firstPerson]);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const valid = emailOk && !!name.trim();

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!emailOk) {
      setError(tr("Enter their email address."));
      return;
    }
    if (!name.trim()) {
      setNameError(tr("Enter their name."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await tenant<Added>(peoplePath(clientId), {
        method: "POST",
        body: {
          email: email.trim(),
          full_name: name.trim(),
          access_scope: scope,
          is_client_admin: admin,
          expires_at: until || null,
          send_invite: send,
        },
      });
      onDone();
      onClose();
      if (!send) toast.success(tv("{{email}} has access. Send the invitation when you are ready.", { email: r.email }));
      else if (r.invite.emailed) toast.success(tv("Invitation sent to {{email}}.", { email: r.email }));
      // The grant stands either way — the row offers Resend, and saying so is
      // what stops "I invited them" from being quietly untrue.
      else toast.error(tv("{{email}} has access, but the email could not be sent. Open them and resend it.", { email: r.email }));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr("Invite to the client portal")}
      description={tr("They sign in to follow their shipments, send documents and see their invoices.")}
      size="lg"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            {tr("Cancel")}
          </Button>
          <Button
            loading={busy}
            disabled={!valid}
            icon={send ? <MailIcon width={16} height={16} /> : <CheckIcon width={16} height={16} />}
            onClick={() => void submit()}
            className="w-full sm:w-auto"
          >
            {send ? tr("Send invitation") : tr("Give access")}
          </Button>
        </div>
      }
    >
      <form className="grid grid-cols-1 gap-4" onSubmit={(e) => void submit(e)} noValidate>
        {suggestions.length ? (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{tr("From this client's contacts")}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.slice(0, 6).map((s) => {
                const on = email.trim().toLowerCase() === s.email.toLowerCase();
                return (
                  <button
                    key={s.email}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setEmail(s.email);
                      // Keep a name already typed when the contact has none on file.
                      if (s.name && s.name.trim()) setName(s.name.trim());
                      setNameError(null);
                    }}
                    className={cn(
                      "min-h-9 max-w-full truncate rounded-full border px-3 py-1.5 text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-primary bg-primary/10 text-primary-ink" : "bg-card text-foreground hover:bg-accent",
                    )}
                  >
                    {s.name || s.email}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {/* Side by side from `sm`, the way the app's other grant forms lay out
            their identity fields; one column in the phone's sheet. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Email")} required error={error ?? undefined}>
            <Input
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </Field>
          <Field
            label={tr("Name")}
            required
            error={nameError ?? undefined}
            hint={tr("Greets them in the email and the portal, and shows on every message and file they send.")}
          >
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (e.target.value.trim()) setNameError(null);
              }}
              autoComplete="off"
              maxLength={120}
            />
          </Field>
        </div>
        <Field label={tr("What they see")}>
          <ScopeChoice value={scope} onChange={setScope} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
          <Field label={tr("Last day of access")} hint={tr("Leave empty for no end date.")}>
            <DateField value={until} onChange={setUntil} min={todayISO()} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:pt-6">
            <Checkbox
              checked={admin}
              onCheckedChange={setAdmin}
              label={tr("Portal admin")}
              hint={tr("Can invite and manage their colleagues from the portal.")}
            />
            <Checkbox
              checked={send}
              onCheckedChange={setSend}
              label={tr("Email them the invitation now")}
              hint={tr("A link to set their own password. It stays valid for 7 days.")}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}

function signInLine(p: PortalPerson): string {
  switch (p.sign_in) {
    case "ACTIVE":
      return p.last_login_at ? tv("Last signed in {{date}}.", { date: dateFmt(p.last_login_at) }) : tr("They have set their password.");
    case "INVITED":
      return p.invite_expires_at
        ? tv("Invitation sent {{sent}} — the link works until {{until}}.", { sent: dateFmt(p.invited_at), until: dateFmt(p.invite_expires_at) })
        : tr("Invitation sent.");
    case "INVITE_EXPIRED":
      return tr("Their invitation expired before they used it. Send a new one.");
    case "DISABLED":
      return tr("Their sign-in is switched off. Sending an invitation switches it back on.");
    default:
      return tr("They have access but no invitation yet — they cannot sign in until you send one.");
  }
}

/**
 * One person's access, opened from their row's Edit. The invitation and the
 * removal are the ROW's actions (the parent owns them, so a row's ⋯ and this
 * dialog cannot drift); this dialog adds the three things only it edits.
 */
function PersonSheet({
  person,
  clientId,
  busy,
  onClose,
  onSaved,
  onInvite,
  onRemove,
}: {
  person: PortalPerson | null;
  clientId: string;
  busy: boolean;
  onClose: () => void;
  onSaved: () => void;
  onInvite: (p: PortalPerson) => void;
  onRemove: (p: PortalPerson) => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState<PortalScope>("ALL");
  const [admin, setAdmin] = React.useState(false);
  const [until, setUntil] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!person) return;
    setName(person.full_name ?? "");
    setScope(person.access_scope);
    setAdmin(person.is_client_admin);
    setUntil(dayOf(person.expires_at));
  }, [person]);

  if (!person) return null;
  const p = person;
  const nameChanged = name.trim() !== (p.full_name ?? "").trim();
  const dirty = nameChanged || scope !== p.access_scope || admin !== p.is_client_admin || until !== dayOf(p.expires_at);
  // A name can be corrected but never removed — the team must know who this is.
  const nameOk = !!name.trim();

  async function save() {
    setSaving(true);
    try {
      await tenant<PortalPerson>(`${peoplePath(clientId)}/${encodeURIComponent(p.portal_access_id)}`, {
        method: "POST",
        body: {
          ...(nameChanged ? { full_name: name.trim() } : {}),
          access_scope: scope,
          is_client_admin: admin,
          expires_at: until || null,
        },
      });
      toast.success(nameChanged ? tr("Saved") : tr("Access updated."));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={displayName(p)}
      description={p.full_name ? p.email : undefined}
      size="lg"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="ghost"
            disabled={busy || saving}
            onClick={() => onRemove(p)}
            className="w-full text-destructive sm:w-auto"
          >
            {tr("Remove access")}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
              {tr("Cancel")}
            </Button>
            <Button loading={saving} disabled={!dirty || !nameOk || busy} onClick={() => void save()} className="w-full sm:w-auto">
              {tr("Save")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        {/* Where their sign-in stands, with the one action that changes it —
            beside the sentence on a desktop, under it in the phone's sheet. */}
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Pill tone={SIGN_IN_TONE[p.sign_in]}>{tr(SIGN_IN_LABEL[p.sign_in])}</Pill>
            <p className="min-w-0 flex-1 text-sm text-foreground">{signInLine(p)}</p>
          </div>
          {canInvite(p) ? (
            <Button
              size="sm"
              variant="outline"
              loading={busy}
              icon={<MailIcon width={14} height={14} />}
              onClick={() => onInvite(p)}
              className="w-full shrink-0 sm:w-auto"
            >
              {inviteLabel(p)}
            </Button>
          ) : null}
        </div>
        <Field
          label={tr("Name")}
          required
          error={nameOk || nameMissing(p) ? undefined : tr("Enter their name.")}
          hint={
            nameMissing(p)
              ? tr("Nobody entered a name when they were invited. Add it so the team knows who sends their messages and files.")
              : tr("Shown on every message and file they send. They can also correct it in their portal.")
          }
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={120} />
        </Field>
        <Field label={tr("What they see")}>
          <ScopeChoice value={scope} onChange={setScope} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
          <Field label={tr("Last day of access")} hint={tr("Leave empty for no end date.")}>
            <div className="flex items-center gap-2">
              <DateField value={until} onChange={setUntil} className="min-w-0 flex-1" />
              {until ? (
                <Button variant="ghost" size="sm" icon={null} onClick={() => setUntil("")}>
                  {tr("No end date")}
                </Button>
              ) : null}
            </div>
          </Field>
          <div className="sm:pt-6">
            <Checkbox
              checked={admin}
              onCheckedChange={setAdmin}
              label={tr("Portal admin")}
              hint={tr("Can invite and manage their colleagues from the portal.")}
            />
          </div>
        </div>
        <p className="break-words text-xs text-muted-foreground">
          {[
            // The dialog's title truncates a long address; the full one is here.
            p.full_name ? null : p.email,
            tv("Access given {{date}}", { date: dateFmt(p.created_at) }),
            p.invited_by_email ? tv("added by {{who}} from the portal", { who: p.invited_by_email }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </Modal>
  );
}

/* ── onboarding ─────────────────────────────────────────────────────────── */

type Step = {
  step_key: string;
  label_en: string;
  label_fr: string;
  done: boolean;
  done_at: string | null;
};
type Onboarding = { client_id: string; progress: number; steps: Step[] };

/** A phone's checklist row: the whole width is the target, ≥ 56px tall. */
const PHONE_ROW =
  "flex w-full min-h-[56px] items-center gap-3 px-3 py-2.5 text-left transition-colors " +
  "hover:bg-accent/60 active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring " +
  "disabled:cursor-default disabled:opacity-60";

export function ClientOnboarding({ clientId }: { clientId: string }) {
  const toast = useToast();
  const compact = useIsCompact();
  const path = `/portal/clients/${encodeURIComponent(clientId)}/onboarding`;
  const onb = useResource(() => tenant<Onboarding>(path), [clientId], { fresh: true });
  // Optimistic ticks: a checklist that waits a round trip before the box fills
  // reads as broken. The server's answer replaces them on reload.
  const [local, setLocal] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const fr = currentLocale().startsWith("fr");

  React.useEffect(() => setLocal({}), [onb.data]);

  if (isFeatureDisabled(onb.errorCode)) return null;

  const steps = (onb.data?.steps ?? []).map((s) => ({ ...s, done: local[s.step_key] ?? s.done }));
  const done = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const label = (s: Step) => (fr ? s.label_fr || s.label_en : s.label_en || s.label_fr);

  async function toggle(s: Step) {
    setBusy(s.step_key);
    setLocal((m) => ({ ...m, [s.step_key]: !s.done }));
    try {
      await tenant(`${path}/${encodeURIComponent(s.step_key)}`, { method: "POST" });
      onb.reload();
    } catch (e) {
      setLocal((m) => {
        const next = { ...m };
        delete next[s.step_key];
        return next;
      });
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  // The checklist's heading row: how far along, as words, a bar and a figure.
  const progress = (
    <div className="flex items-center gap-3 border-b bg-muted/50 px-3 py-2 text-muted-foreground">
      <span className="shrink-0 text-sm font-medium">{tv("{{done}} of {{total}} done", { done, total: steps.length })}</span>
      <div
        role="progressbar"
        aria-label={tr("Onboarding progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-ok transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="num shrink-0 text-sm font-medium text-foreground">{pct}%</span>
    </div>
  );

  return (
    <section className="min-w-0">
      <PortalSectionHeader title={tr("Onboarding")} />
      {onb.error ? (
        <ErrorState message={onb.error} />
      ) : !onb.data ? (
        <SkeletonTable />
      ) : steps.length === 0 ? (
        <EmptyState
          title={tr("No onboarding steps")}
          hint={tr("Add the steps every client goes through in ⚙ Settings on the Clients list.")}
        />
      ) : compact ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          {progress}
          <ul className="divide-y">
            {steps.map((s) => (
              <li key={s.step_key}>
                <button
                  type="button"
                  className={PHONE_ROW}
                  aria-pressed={s.done}
                  disabled={busy === s.step_key}
                  onClick={() => void toggle(s)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors",
                      s.done ? "border-ok bg-ok text-background" : "border-input bg-background",
                    )}
                  >
                    {s.done ? <CheckIcon width={14} height={14} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", s.done ? "text-muted-foreground" : "font-medium text-foreground")}>
                      {label(s)}
                    </span>
                    {s.done && s.done_at ? (
                      <span className="block text-xs text-muted-foreground">{tv("Done {{date}}", { date: dateFmt(s.done_at) })}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        // A desktop checklist: one dense line per step, a real checkbox, and
        // the day it was done where a date column would be — the same frame
        // as the people table above it.
        <div className="overflow-hidden rounded-lg border">
          {progress}
          <ul className="divide-y divide-border">
            {steps.map((s) => (
              <li key={s.step_key} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <Checkbox
                  checked={s.done}
                  disabled={busy === s.step_key}
                  onCheckedChange={() => void toggle(s)}
                  label={<span className={s.done ? "text-muted-foreground" : "text-foreground"}>{label(s)}</span>}
                  className="min-w-0 flex-1 items-center"
                />
                <span className="num shrink-0 text-muted-foreground">
                  {s.done && s.done_at ? tv("Done {{date}}", { date: dateFmt(s.done_at) }) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {steps.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {tr("The client sees this checklist in their portal. The steps are the same for every client — change them in ⚙ Settings on the Clients list.")}
        </p>
      ) : null}
    </section>
  );
}
