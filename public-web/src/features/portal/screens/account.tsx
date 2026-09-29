/**
 * Account — who they are, who else from their company is here, and the few
 * settings anybody changes: Face ID, their devices, language, light or dark.
 *
 * THE TEAM. Several people at one client share one account — the same
 * shipments, the same invoices. The company's admin adds a colleague with one
 * of three plain choices (the owner's brief: roles, but "the simplest UI"):
 *
 *   EVERYTHING                 shipments, documents and billing
 *   SHIPMENTS & DOCUMENTS      the operations side, no money
 *   BILLING                    invoices and payments, nothing else
 *
 * and can make them an admin too. Nobody can remove the last admin — the
 * server refuses it — so a company can never lock itself out.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  portalTeam,
  portalInvite,
  portalSaveProfile,
  portalUpdateMember,
  portalRemoveMember,
  portalPasskeys,
  portalDeletePasskey,
  portalPasskeyRegisterOptions,
  portalPasskeyRegisterVerify,
  portalDevices,
  portalRevokeDevice,
  portalNotifySettings,
  portalNotifySave,
  portalPushTest,
  type Scope,
  type TeamMember,
  type PortalDevice,
  type NotifyChoice,
  type NotifyTopic,
} from "@/lib/portal-api";
import { portalSession } from "@/lib/portal-session";
import { getLang, setLang } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { usePortal, KindSwitchContext, type PortalKind } from "../lib/portal-context";
import { getPortalTheme, setPortalTheme, type PortalTheme } from "../lib/theme";
import { deviceCanUsePasskey, createPasskey, isCancel, biometricKind } from "../lib/passkey";
import { pushState, enablePush, disablePush, useInstall, type PushState } from "../lib/portal-pwa";
import { usePageChrome } from "../shell/portal-shell";
import {
  Avatar,
  Pill,
  IconDisc,
  Seg,
  Switch,
  Sheet,
  TextField,
  ConfirmSheet,
  SkeletonCards,
  ErrorCard,
  InfoButton,
  useLoad,
  useToast,
  errorText,
  Busy,
  type Tone,
} from "../ui/kit";
import {
  UsersIcon,
  UserPlusIcon,
  FaceIdIcon,
  FingerprintIcon,
  DeviceIcon,
  GlobeIcon,
  SunIcon,
  MoonIcon,
  LogOutIcon,
  ChevronRightIcon,
  MailIcon,
  CheckIcon,
  TrashIcon,
  ShieldIcon,
  BellIcon,
  ChatIcon,
  FolderIcon,
  WalletIcon,
  QuoteIcon,
  ShipIcon,
  ShareIcon,
  PlusIcon,
  InstallIcon,
} from "../ui/icons";
import { whenShort } from "../lib/when";

const SCOPES: Scope[] = ["ALL", "OPERATIONS", "BILLING"];
const SCOPE_TONE: Record<Scope, Tone> = { ALL: "brand", OPERATIONS: "info", BILLING: "ok" };

export function AccountPage() {
  const { t } = useTranslation();
  const portal = usePortal();
  usePageChrome(t("portal.nav.account"), "/portal");
  const u = portal.me.portal_user;
  const [out, setOut] = React.useState<"plain" | "forget" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [naming, setNaming] = React.useState(false);

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      {/* ── who ── */}
      <section className="pt-card flex items-center gap-4 p-5 sm:p-6">
        <Avatar name={u.full_name} email={u.email} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="pt-display truncate text-[1.45rem]">{u.full_name || u.email}</h1>
          <p className="truncate text-sm text-muted-foreground">{u.email}</p>
          {portal.company ? <p className="truncate text-sm font-semibold text-foreground">{portal.company}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {portal.kind === "CLIENT" ? <Pill tone={SCOPE_TONE[portal.scope]}>{t(`portal.team.scope.${portal.scope}`)}</Pill> : null}
            {portal.isAdmin ? (
              <Pill tone="ok">
                <ShieldIcon size={13} />
                {t("portal.team.admin")}
              </Pill>
            ) : null}
          </div>
          <button
            type="button"
            className="mt-2 text-sm font-semibold text-primary-ink underline-offset-2 hover:underline"
            onClick={() => setNaming(true)}
          >
            {u.full_name ? t("portal.account.editName") : t("portal.account.addName")}
          </button>
        </div>
      </section>
      <NameSheet open={naming} current={u.full_name || ""} onClose={() => setNaming(false)} onSaved={portal.reloadMe} />

      <KindSwitch />
      {portal.kind === "CLIENT" ? <Team /> : null}
      {portal.kind === "CLIENT" ? <InstallApp /> : null}
      {portal.kind === "CLIENT" ? <Notifications /> : null}
      <Security />
      <Preferences />

      <section className="grid gap-2">
        <button type="button" className="pt-btn pt-btn-danger pt-btn-block" onClick={() => setOut("plain")}>
          <LogOutIcon size={20} />
          {t("portal.account.signOut")}
        </button>
        {portalSession.known() ? (
          <button type="button" className="pt-btn pt-btn-ghost pt-btn-block !text-sm text-muted-foreground" onClick={() => setOut("forget")}>
            {t("portal.account.signOutForget")}
          </button>
        ) : null}
      </section>

      <ConfirmSheet
        open={!!out}
        title={out === "forget" ? t("portal.account.forgetTitle") : t("portal.account.signOutTitle")}
        body={out === "forget" ? t("portal.account.forgetBody") : undefined}
        confirmLabel={t("portal.account.signOut")}
        destructive
        busy={busy}
        onClose={() => setOut(null)}
        onConfirm={async () => {
          setBusy(true);
          await portal.signOut({ forget: out === "forget" });
          setBusy(false);
        }}
      />
    </div>
  );
}

function Section({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="pt-section-title flex items-center gap-2">
          <span className="text-primary-ink" aria-hidden="true">
            {icon}
          </span>
          {title}
        </h2>
        {action}
      </div>
      <div className="pt-card pt-rows overflow-hidden">{children}</div>
    </section>
  );
}

/* ── one login, more than one portal ─────────────────────────────────────── */

function KindSwitch() {
  const { t } = useTranslation();
  const { kinds, active, setKind } = React.useContext(KindSwitchContext);
  if (kinds.length < 2) return null;
  return (
    <Seg<PortalKind>
      label={t("portal.account.portal")}
      value={(active || kinds[0]) as PortalKind}
      onChange={setKind}
      items={kinds.map((k) => ({ value: k, label: t(`portal.kind.${k}`) }))}
    />
  );
}

/* ── the team ───────────────────────────────────────────────────────────── */

function Team() {
  const { t } = useTranslation();
  const team = useLoad(portalTeam, "team");
  const [inviting, setInviting] = React.useState(false);
  const [member, setMember] = React.useState<TeamMember | null>(null);
  const canManage = !!team.data?.can_manage;

  return (
    <Section
      title={t("portal.team.title")}
      icon={<UsersIcon size={20} />}
      action={
        canManage ? (
          <button type="button" className="pt-btn pt-btn-soft pt-btn-sm" onClick={() => setInviting(true)}>
            <UserPlusIcon size={18} />
            {t("portal.team.invite")}
          </button>
        ) : null
      }
    >
      {!team.data ? (
        <div className="p-3">
          <SkeletonCards count={2} />
        </div>
      ) : (
        team.data.members.map((m) => (
          <button
            key={m.portal_access_id}
            type="button"
            className="pt-row disabled:cursor-default"
            disabled={!canManage || m.is_you}
            onClick={() => setMember(m)}
          >
            <Avatar name={m.full_name} email={m.email} size={40} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[0.95rem] font-semibold text-foreground">{m.full_name || m.email}</span>
                {m.is_you ? <span className="text-xs text-muted-foreground">{t("portal.team.you")}</span> : null}
              </span>
              <span className="mt-1 flex flex-wrap gap-1.5">
                <Pill tone={SCOPE_TONE[m.access_scope]}>{t(`portal.team.scope.${m.access_scope}`)}</Pill>
                {m.is_client_admin ? (
                  <Pill tone="ok">
                    <ShieldIcon size={13} />
                    {t("portal.team.admin")}
                  </Pill>
                ) : null}
                {m.pending ? (
                  <Pill tone="warn">
                    <MailIcon size={13} />
                    {t("portal.team.invited")}
                  </Pill>
                ) : null}
              </span>
            </span>
            {canManage && !m.is_you ? <ChevronRightIcon size={18} className="text-muted-foreground" /> : null}
          </button>
        ))
      )}
      <InviteSheet
        open={inviting}
        defaultScope={team.data?.default_scope ?? "ALL"}
        onClose={() => setInviting(false)}
        onDone={team.reload}
      />
      <MemberSheet m={member} onClose={() => setMember(null)} onDone={team.reload} />
    </Section>
  );
}

function ScopeChoice({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2" role="radiogroup" aria-label={t("portal.team.access")}>
      {SCOPES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          aria-pressed={value === s}
          className="pt-chip !h-auto justify-between !py-3 text-left"
          onClick={() => onChange(s)}
        >
          <span className="min-w-0">
            <span className="block font-semibold">{t(`portal.team.scope.${s}`)}</span>
            <span className="block text-xs font-normal text-muted-foreground">{t(`portal.team.scopeHint.${s}`)}</span>
          </span>
          <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2", value === s ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]" : "border-[var(--pt-line-strong)]")}>
            {value === s ? <CheckIcon size={14} /> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Their own name — kept by them, and correctable by the team from the ERP. */
function NameSheet({
  open,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  current: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = React.useState(current);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(current);
    setError(null);
  }, [open, current]);

  const valid = !!name.trim() && name.trim() !== current.trim();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await portalSaveProfile({ full_name: name.trim() });
      await onSaved();
      toast(t("portal.account.nameSaved"));
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("portal.account.nameTitle")}
      footer={
        <button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={!valid || busy} onClick={() => void save()}>
          <Busy busy={busy}>
            <CheckIcon size={20} />
          </Busy>
          {t("portal.team.saved")}
        </button>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">{t("portal.account.nameBody")}</p>
        <TextField
          label={t("portal.account.nameLabel")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={120}
          required
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-[rgb(var(--bad))]">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function InviteSheet({
  open,
  defaultScope,
  onClose,
  onDone,
}: {
  open: boolean;
  /** What the tenant chose a new colleague sees unless the admin says otherwise. */
  defaultScope: Scope;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState<Scope>("ALL");
  const [admin, setAdmin] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEmail("");
    setName("");
    setScope(defaultScope);
    setAdmin(false);
    setError(null);
  }, [open, defaultScope]);

  // A name is required: the team has to know who at the company is writing.
  const valid = /^\S+@\S+\.\S+$/.test(email.trim()) && !!name.trim();

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await portalInvite({ email: email.trim(), full_name: name.trim(), access_scope: scope, is_client_admin: admin });
      toast(t("portal.team.inviteSent", { email: email.trim() }));
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("portal.team.inviteTitle")}
      footer={
        <button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={!valid || busy} onClick={() => void send()}>
          <Busy busy={busy}>
            <MailIcon size={20} />
          </Busy>
          {t("portal.team.sendInvite")}
        </button>
      }
    >
      <div className="grid gap-4">
        <TextField label={t("portal.signin.email")} type="email" inputMode="email" autoCapitalize="none" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div>
          <TextField label={t("portal.team.name")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={120} required />
          <p className="mt-1.5 text-xs text-muted-foreground">{t("portal.team.nameHint")}</p>
        </div>
        <div>
          <p className="pt-label">{t("portal.team.access")}</p>
          <ScopeChoice value={scope} onChange={setScope} />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-[16px] bg-[var(--pt-soft)] p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("portal.team.makeAdmin")}</p>
            <p className="text-xs text-muted-foreground">{t("portal.team.adminHint")}</p>
          </div>
          <Switch checked={admin} onChange={setAdmin} label={t("portal.team.makeAdmin")} />
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-[rgb(var(--bad))]">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function MemberSheet({ m, onClose, onDone }: { m: TeamMember | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [scope, setScope] = React.useState<Scope>("ALL");
  const [admin, setAdmin] = React.useState(false);
  const [busy, setBusy] = React.useState<"save" | "remove" | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!m) return;
    setScope(m.access_scope);
    setAdmin(m.is_client_admin);
    setError(null);
    setConfirm(false);
  }, [m]);

  if (!m) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const changed = scope !== m.access_scope || admin !== m.is_client_admin;

  async function save() {
    if (!m) return;
    setBusy("save");
    setError(null);
    try {
      await portalUpdateMember(m.portal_access_id, { access_scope: scope, is_client_admin: admin });
      toast(t("portal.team.saved"));
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!m) return;
    setBusy("remove");
    try {
      await portalRemoveMember(m.portal_access_id);
      toast(t("portal.team.removed"));
      onDone();
      setConfirm(false);
      onClose();
    } catch (e) {
      setConfirm(false);
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Sheet
        open={!!m && !confirm}
        onClose={onClose}
        title={m.full_name || m.email}
        footer={
          <div className="grid gap-2">
            <button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={!changed || !!busy} onClick={() => void save()}>
              <Busy busy={busy === "save"} />
              {t("portal.common.save")}
            </button>
            <button type="button" className="pt-btn pt-btn-ghost pt-btn-block !text-[rgb(var(--bad))]" disabled={!!busy} onClick={() => setConfirm(true)}>
              <TrashIcon size={18} />
              {t("portal.team.remove")}
            </button>
          </div>
        }
      >
        <p className="-mt-1 mb-4 truncate text-sm text-muted-foreground">{m.email}</p>
        <p className="pt-label">{t("portal.team.access")}</p>
        <ScopeChoice value={scope} onChange={setScope} />
        <div className="mt-4 flex items-center justify-between gap-4 rounded-[16px] bg-[var(--pt-soft)] p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("portal.team.makeAdmin")}</p>
            <p className="text-xs text-muted-foreground">{t("portal.team.adminHint")}</p>
          </div>
          <Switch checked={admin} onChange={setAdmin} label={t("portal.team.makeAdmin")} />
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-[rgb(var(--bad))]">
            {error}
          </p>
        ) : null}
      </Sheet>
      <ConfirmSheet
        open={confirm}
        title={t("portal.team.removeTitle", { name: m.full_name || m.email })}
        body={t("portal.team.removeBody")}
        confirmLabel={t("portal.team.remove")}
        destructive
        busy={busy === "remove"}
        onClose={() => setConfirm(false)}
        onConfirm={() => void remove()}
      />
    </>
  );
}

/* ── security ───────────────────────────────────────────────────────────── */

function Security() {
  const { t } = useTranslation();
  const toast = useToast();
  const portal = usePortal();
  const kind = biometricKind();
  const Icon = kind === "face" ? FaceIdIcon : FingerprintIcon;
  const [capable, setCapable] = React.useState(false);
  const passkeys = useLoad(portalPasskeys, "passkeys");
  const devices = useLoad(portalDevices, "devices");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [revoke, setRevoke] = React.useState<PortalDevice | null>(null);
  const trusted = portalSession.trusted();

  React.useEffect(() => {
    void deviceCanUsePasskey().then(setCapable);
  }, []);

  const local = portalSession.known()?.passkeys || [];
  const here = (passkeys.data || []).find((p) => local.includes(p.credential_id)) || null;

  async function toggle(on: boolean) {
    setBusy("passkey");
    try {
      if (on) {
        const options = await portalPasskeyRegisterOptions();
        const att = await createPasskey(options);
        const out = await portalPasskeyRegisterVerify(att, String(options._challengeToken || ""));
        if (!portalSession.known()) portalSession.remember({ email: portal.me.portal_user.email, firstName: portal.firstName, company: portal.company });
        portalSession.addPasskey(out.credential_id);
        toast(t(`portal.passkey.on.${kind}`));
      } else if (here) {
        await portalDeletePasskey(here.credential_id);
        portalSession.dropPasskey(here.credential_id);
        toast(t("portal.passkey.off"));
      }
      passkeys.reload();
    } catch (e) {
      if (!isCancel(e)) toast(errorText(e), "bad");
    } finally {
      setBusy(null);
    }
  }

  async function doRevoke() {
    if (!revoke) return;
    setBusy(revoke.portal_session_id);
    try {
      await portalRevokeDevice(revoke.portal_session_id);
      toast(t("portal.account.deviceOut"));
      setRevoke(null);
      devices.reload();
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title={t("portal.account.security")} icon={<ShieldIcon size={20} />}>
      {capable && trusted ? (
        <div className="pt-row">
          <IconDisc>
            <Icon />
          </IconDisc>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.95rem] font-semibold text-foreground">{t(`portal.passkey.label.${kind}`)}</span>
            <span className="block text-xs text-muted-foreground">{t("portal.passkey.thisDevice")}</span>
          </span>
          <Switch checked={!!here} onChange={(v) => void toggle(v)} label={t(`portal.passkey.label.${kind}`)} disabled={busy === "passkey" || !passkeys.data} />
        </div>
      ) : null}
      {(devices.data || []).map((d) => (
        <div key={d.portal_session_id} className="pt-row">
          <IconDisc tone={d.is_current ? "ok" : "mute"}>
            <DeviceIcon />
          </IconDisc>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.95rem] font-semibold text-foreground">{d.device_label || t("portal.account.device")}</span>
            <span className="block text-xs text-muted-foreground">
              {d.is_current ? t("portal.account.thisDevice") : t("portal.account.lastSeen", { when: whenShort(d.last_seen_at) })}
            </span>
          </span>
          {!d.is_current ? (
            <button type="button" className="pt-btn pt-btn-ghost pt-btn-sm" onClick={() => setRevoke(d)}>
              {t("portal.account.signOutDevice")}
            </button>
          ) : null}
        </div>
      ))}
      {!devices.data && !devices.error ? (
        <div className="p-3">
          <SkeletonCards count={1} />
        </div>
      ) : null}
      <ConfirmSheet
        open={!!revoke}
        title={t("portal.account.deviceOutTitle")}
        body={revoke?.device_label || undefined}
        confirmLabel={t("portal.account.signOutDevice")}
        destructive
        busy={!!revoke && busy === revoke.portal_session_id}
        onClose={() => setRevoke(null)}
        onConfirm={() => void doRevoke()}
      />
    </Section>
  );
}

/* ── the app on this device (client portal PR 2) ────────────────────────── */

/**
 * Offered only where it can happen: a browser that handed us its install
 * prompt, or an iPhone, where it is two taps in Safari's Share sheet. Gone
 * once installed, and never shown where neither applies.
 */
function InstallApp() {
  const { t } = useTranslation();
  const { state, install } = useInstall();
  if (state === "installed" || state === "unavailable") return null;
  return (
    <section className="pt-card flex items-center gap-4 p-4 sm:p-5">
      <IconDisc tone="brand">
        <InstallIcon />
      </IconDisc>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.95rem] font-semibold text-foreground">{t("portal.install.title")}</span>
        <span className="block text-xs text-muted-foreground">{t("portal.install.hint")}</span>
      </span>
      {state === "ready" ? (
        <button type="button" className="pt-btn pt-btn-primary pt-btn-sm shrink-0" onClick={() => void install()}>
          {t("portal.install.button")}
        </button>
      ) : (
        <InstallHelp />
      )}
    </section>
  );
}

/** iPhone and iPad: Share, then "Add to Home Screen" — Safari has no button a site can press. */
function InstallHelp() {
  const { t } = useTranslation();
  const steps: [React.ReactNode, string][] = [
    [<ShareIcon key="share" size={18} />, t("portal.install.ios1")],
    [<PlusIcon key="add" size={18} />, t("portal.install.ios2")],
    [<BellIcon key="bell" size={18} />, t("portal.install.ios3")],
  ];
  return (
    <InfoButton label={t("portal.install.howLabel")} title={t("portal.install.iosTitle")}>
      <ol className="grid gap-3">
        {steps.map(([icon, text], i) => (
          <li key={i} className="flex items-center gap-3 text-[0.95rem] text-foreground">
            <IconDisc size={36}>{icon}</IconDisc>
            <span className="min-w-0 flex-1">{text}</span>
          </li>
        ))}
      </ol>
    </InfoButton>
  );
}

/* ── notifications (14180) ──────────────────────────────────────────────── */

const TOPIC_ICON: Record<NotifyTopic, React.ReactNode> = {
  MESSAGES: <ChatIcon size={20} />,
  REQUESTS: <FolderIcon size={20} />,
  BILLING: <WalletIcon size={20} />,
  PROPOSALS: <QuoteIcon size={20} />,
  SHIPMENTS: <ShipIcon size={20} />,
};

/**
 * This device on or off, and per topic: email, the app, both or neither. A
 * topic this person's access does not show them is not listed at all — the
 * server only returns the ones they can see.
 */
function Notifications() {
  const { t } = useTranslation();
  const toast = useToast();
  const settings = useLoad(portalNotifySettings, "notify");
  const [device, setDevice] = React.useState<PushState | null>(null);
  const [topics, setTopics] = React.useState<NotifyChoice[] | null>(null);
  const [busy, setBusy] = React.useState<"device" | "test" | null>(null);
  const lang = getLang() === "fr" ? "fr" : "en";

  React.useEffect(() => {
    void pushState().then(setDevice);
  }, []);
  React.useEffect(() => {
    if (settings.data) setTopics(settings.data.topics);
  }, [settings.data]);

  const publicKey = settings.data?.push.configured ? settings.data.push.public_key : null;

  async function toggleDevice(on: boolean) {
    setBusy("device");
    try {
      const next = on ? (publicKey ? await enablePush(publicKey, lang) : "unsupported") : await disablePush();
      setDevice(next);
      if (next === "on") toast(t("portal.notify.turnedOn"));
      else if (!on) toast(t("portal.notify.turnedOff"));
    } catch (e) {
      toast(errorText(e), "bad");
      setDevice(await pushState());
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const r = await portalPushTest(lang);
      if (r.sent) toast(t("portal.notify.testSent"));
      else toast(t("portal.notify.testNone"), "bad");
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setBusy(null);
    }
  }

  async function flip(topic: NotifyTopic, channel: "email" | "push") {
    if (!topics) return;
    const before = topics;
    const next = topics.map((x) => (x.topic === topic ? { ...x, [channel]: !x[channel] } : x));
    setTopics(next);
    try {
      const saved = await portalNotifySave(next, lang);
      setTopics(saved.topics);
    } catch (e) {
      setTopics(before);
      toast(errorText(e), "bad");
    }
  }

  const stateLine =
    device === null
      ? ""
      : !publicKey && settings.data && (device === "on" || device === "off")
        ? t("portal.notify.state.unconfigured")
        : t(`portal.notify.state.${device === "install-first" ? "installFirst" : device}`);
  const canSwitch = !!publicKey && (device === "on" || device === "off");

  return (
    <Section
      title={t("portal.notify.title")}
      icon={<BellIcon size={20} />}
      action={
        <InfoButton label={t("portal.notify.infoLabel")} title={t("portal.notify.infoTitle")}>
          <div className="grid gap-3 text-[0.95rem] text-foreground">
            <p>{t("portal.notify.info1")}</p>
            <p>{t("portal.notify.info2")}</p>
            <p>{t("portal.notify.info3")}</p>
          </div>
        </InfoButton>
      }
    >
      <div className="pt-row">
        <IconDisc tone={device === "on" ? "ok" : "mute"}>
          <BellIcon />
        </IconDisc>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.95rem] font-semibold text-foreground">{t("portal.notify.thisDevice")}</span>
          <span className="block text-xs text-muted-foreground">{stateLine}</span>
        </span>
        {device === "on" ? (
          <button type="button" className="pt-btn pt-btn-ghost pt-btn-sm shrink-0" disabled={busy === "test"} onClick={() => void test()}>
            <Busy busy={busy === "test"} />
            {t("portal.notify.test")}
          </button>
        ) : null}
        {canSwitch ? (
          <Switch checked={device === "on"} onChange={(v) => void toggleDevice(v)} label={t("portal.notify.switchLabel")} disabled={busy === "device"} />
        ) : device === "blocked" ? (
          <InfoButton label={t("portal.notify.blockedTitle")} title={t("portal.notify.blockedTitle")}>
            <p className="text-[0.95rem] text-foreground">{t("portal.notify.blockedHow")}</p>
          </InfoButton>
        ) : device === "install-first" ? (
          <InstallHelp />
        ) : null}
      </div>
      {(topics || []).map((x) => (
        <div key={x.topic} className="pt-row flex-wrap">
          <IconDisc size={38}>{TOPIC_ICON[x.topic]}</IconDisc>
          <span className="min-w-0 flex-1 text-[0.95rem] font-semibold text-foreground">{t(`portal.notify.topic.${x.topic}`)}</span>
          <span className="flex shrink-0 gap-2" role="group" aria-label={t(`portal.notify.topic.${x.topic}`)}>
            <button type="button" className="pt-chip pt-chip-sm" aria-pressed={x.email} onClick={() => void flip(x.topic, "email")}>
              <MailIcon size={16} />
              {t("portal.notify.email")}
            </button>
            <button type="button" className="pt-chip pt-chip-sm" aria-pressed={x.push} onClick={() => void flip(x.topic, "push")}>
              <DeviceIcon size={16} />
              {t("portal.notify.push")}
            </button>
          </span>
        </div>
      ))}
      {!settings.data && !settings.error ? (
        <div className="p-3">
          <SkeletonCards count={2} />
        </div>
      ) : null}
      {settings.error ? (
        <div className="p-3">
          <ErrorCard message={settings.error} onRetry={settings.reload} />
        </div>
      ) : null}
    </Section>
  );
}

/* ── preferences ────────────────────────────────────────────────────────── */

function Preferences() {
  const { t } = useTranslation();
  const [lang, setLangState] = React.useState(getLang());
  const [theme, setTheme] = React.useState<PortalTheme>(getPortalTheme());
  return (
    <Section title={t("portal.account.preferences")} icon={<GlobeIcon size={20} />}>
      <div className="pt-row flex-wrap justify-between">
        <span className="flex items-center gap-3 text-[0.95rem] font-semibold text-foreground">
          <GlobeIcon size={20} className="text-muted-foreground" />
          {t("portal.account.language")}
        </span>
        <Seg<"en" | "fr">
          label={t("portal.account.language")}
          value={lang === "fr" ? "fr" : "en"}
          onChange={(l) => {
            setLang(l);
            setLangState(l);
          }}
          items={[
            { value: "en", label: "English" },
            { value: "fr", label: "Français" },
          ]}
        />
      </div>
      <div className="pt-row flex-wrap justify-between">
        <span className="flex items-center gap-3 text-[0.95rem] font-semibold text-foreground">
          <SunIcon size={20} className="text-muted-foreground" />
          {t("portal.account.theme")}
        </span>
        <Seg<PortalTheme>
          label={t("portal.account.theme")}
          value={theme}
          onChange={(v) => {
            setPortalTheme(v);
            setTheme(v);
          }}
          items={[
            { value: "light", label: <SunIcon size={18} />, aria: t("portal.account.light") },
            { value: "dark", label: <MoonIcon size={18} />, aria: t("portal.account.dark") },
            { value: "system", label: <DeviceIcon size={18} />, aria: t("portal.account.auto") },
          ]}
        />
      </div>
    </Section>
  );
}
