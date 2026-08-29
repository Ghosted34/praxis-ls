/**
 * Comms → Setup → My mailbox.
 *
 * One person, one professional address. This is the whole surface a
 * non-administrator gets, so it has to answer three questions without help:
 * is my mail working, what is it doing, and how do I connect it.
 *
 * ── WHY THE cPANEL BUTTON IS FIRST ──────────────────────────────────────────
 *
 * The first tenant runs cPanel, and this programme deliberately does one
 * provider properly rather than four adequately. cPanel mail is predictable —
 * mail.<domain>, IMAP 993 SSL, SMTP 465 SSL — which turns a five-field form into
 * a two-field one. The single most common reason a cPanel mailbox fails to
 * authenticate is that the username is the FULL address rather than the part
 * before the @, so the preset fills that in and says so rather than letting the
 * user discover it from a rejection.
 *
 * ── AND WHY THERE IS NO "ADD ANOTHER" BUTTON ────────────────────────────────
 *
 * One personal mailbox per person is a rule enforced by a unique index in the
 * database. Offering a control that can only ever fail would teach people to
 * distrust the ones that work, so the page shows the mailbox they have and how
 * to change it instead.
 *
 * ── THERE IS, HOWEVER, A WAY OUT ────────────────────────────────────────────
 *
 * There was not. A person could connect their mailbox here and then had no way
 * to disconnect it — this page pointed at "Mailbox → Mailboxes", an
 * administrator's screen most people cannot open, where the only action was
 * "Retire": it stopped the sync and left the stored IMAP password behind.
 *
 * "Disconnect" is the action people actually mean. It archives the connection
 * AND deletes the credential, and it says plainly that no mail is deleted —
 * because "disconnect" reads as "delete my email" to most people, and the
 * difference matters the first time somebody needs last March's bill of lading.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Modal } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill, type Tone } from "@/components/ui/pill";
import { PageHeader } from "@/components/data-list";
import { useResource, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { SmtpErrorGuide } from "@/components/mail/smtp-guide";
import * as api from "@/lib/mail-api";
import { HealthPill } from "./health-pill";

/* ── The three-step personal connect ─────────────────────────────────────── */

function ConnectWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [f, setF] = React.useState({
    display_name: "",
    imap_host: "", imap_port: 993, imap_secure: true,
    smtp_host: "", smtp_port: 465, smtp_secure: true,
    auth_user: "", password: "",
  });
  const [result, setResult] = React.useState<api.Mailbox | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  function applyPreset(p: api.CpanelPreset) {
    setF((s) => ({
      ...s,
      imap_host: p.imap_host, imap_port: p.imap_port, imap_secure: p.imap_secure,
      smtp_host: p.smtp_host, smtp_port: p.smtp_port, smtp_secure: p.smtp_secure,
      auth_user: p.auth_user,
    }));
    setNote(p.note);
    setStep(2);
  }

  async function useCpanel() {
    setBusy(true); setError(null);
    try { applyPreset(await api.cpanelPreset(email)); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function useAutodiscover() {
    setBusy(true); setError(null); setNote(null);
    try {
      const d = await api.autodiscover(email);
      setF((s) => ({
        ...s,
        imap_host: d.imap_host || `mail.${email.split("@").pop()}`,
        imap_port: d.imap_port || 993,
        imap_secure: d.imap_secure !== false,
        smtp_host: d.smtp_host || `mail.${email.split("@").pop()}`,
        smtp_port: d.smtp_port || 465,
        smtp_secure: d.smtp_secure !== false,
        auth_user: email,
      }));
      setStep(2);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const conn = await api.connectImap({
        email_address: email,
        display_name: f.display_name || undefined,
        imap_host: f.imap_host, imap_port: Number(f.imap_port), imap_secure: String(f.imap_secure) !== "false",
        smtp_host: f.smtp_host, smtp_port: Number(f.smtp_port), smtp_secure: String(f.smtp_secure) !== "false",
        auth_user: f.auth_user || email, password: f.password,
      });
      setResult(conn as unknown as api.Mailbox);
      setStep(3);
      onDone();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={tr("Connect your mailbox")}
      description={`${tr("Step")} ${step} ${tr("of")} 3 — ${step === 1 ? tr("your address") : step === 2 ? tr("server settings") : tr("check it works")}`}
    >
      {step === 1 && (
        <div className="space-y-3">
          <Field label={tr("Your work email address")} required hint={tr("The professional address your company gave you.")}>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourcompany.cm"
              type="email"
            />
          </Field>
          <div className="rounded-lg border border-border bg-card/40 p-3">
            <div className="text-sm font-medium">{tr("How is your company email hosted?")}</div>
            <p className="micro mt-1 text-muted-foreground">
              {tr("If you are not sure, try cPanel first — it is what most company mail in the region runs on.")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={useCpanel} disabled={!email || busy} loading={busy}>
                {tr("My company uses cPanel")}
              </Button>
              <Button type="button" variant="outline" onClick={useAutodiscover} disabled={!email || busy}>
                {tr("Work it out for me")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setStep(2)} disabled={!email}>
                {tr("I will type the settings")}
              </Button>
            </div>
          </div>
          {error != null && <ErrorState message={errMsg(error)} />}
        </div>
      )}

      {step === 2 && (
        <form className="space-y-3" onSubmit={connect}>
          {note && (
            <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">{note}</div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tr("Incoming server (IMAP)")} required>
              <Input value={f.imap_host} onChange={set("imap_host")} placeholder="mail.yourcompany.cm" />
            </Field>
            <Field label={tr("IMAP port")} required>
              <Input value={String(f.imap_port)} onChange={set("imap_port")} inputMode="numeric" />
            </Field>
            <Field label={tr("Outgoing server (SMTP)")} required>
              <Input value={f.smtp_host} onChange={set("smtp_host")} placeholder="mail.yourcompany.cm" />
            </Field>
            <Field label={tr("SMTP port")} required>
              <Input value={String(f.smtp_port)} onChange={set("smtp_port")} inputMode="numeric" />
            </Field>
            <Field label={tr("Username")} required hint={tr("On cPanel this is your full email address.")}>
              <Input value={f.auth_user} onChange={set("auth_user")} placeholder={email} />
            </Field>
            <Field label={tr("Password")} required>
              <Input value={f.password} onChange={set("password")} type="password" autoComplete="off" />
            </Field>
            <Field label={tr("Display name")} hint={tr("What recipients see beside your address.")}>
              <Input value={f.display_name} onChange={set("display_name")} placeholder="Ada Lovelace" />
            </Field>
          </div>
          {error != null && (
            <>
              <ErrorState message={errMsg(error)} />
              <SmtpErrorGuide err={error} />
            </>
          )}
          <div className="flex items-center justify-between pt-1">
            <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={busy}>{tr("Back")}</Button>
            <Button type="submit" loading={busy} disabled={busy}>{tr("Connect and test")}</Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="space-y-3">
          {result?.status === "CONNECTED" ? (
            <div className="rounded-lg border border-[rgb(var(--ok))]/40 bg-[rgb(var(--ok))]/5 px-3 py-3">
              <div className="text-sm font-medium">{tr("Connected —")} {result.email_address}</div>
              <p className="micro mt-1 text-muted-foreground">
                {tr("Your mail will start appearing in the Mailbox tab within a minute or two.")}
              </p>
            </div>
          ) : (
            <>
              <ErrorState message={tr("Connected the settings, but the mail server refused them. Nothing is syncing yet.")} />
              <SmtpErrorGuide err={{ message: (result as { last_error?: string })?.last_error || "" }} />
              <Button type="button" variant="outline" onClick={() => setStep(2)}>{tr("Change the settings")}</Button>
            </>
          )}
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>{tr("Done")}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── The page ────────────────────────────────────────────────────────────── */

const tone = (s?: string | null): Tone =>
  String(s).toUpperCase() === "CONNECTED" ? "ok" : String(s).toUpperCase() === "PENDING" ? "warn" : "bad";

export function MyMailboxTab() {
  const mine = useResource(() => api.myMailboxes(), []);
  const [wizard, setWizard] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function disconnect(m: api.Mailbox) {
    // The sentence is the feature. See the header.
    const ok = window.confirm(
      `${tr("Disconnect")} ${m.email_address}?\n\n` +
      tr("New mail stops arriving and the saved password is deleted. Everything already received stays here and stays readable. You can connect the address again later.")
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.disconnectMailbox(m.email_connection_id);
      mine.reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const rows = mine.data || [];
  const personal = rows.find((m) => m.kind === "PERSONAL") || null;
  const shared = rows.filter((m) => m.kind !== "PERSONAL");

  const allowance = useResource(
    () => (personal ? api.sendAllowance(personal.email_connection_id) : Promise.resolve(null)),
    [personal?.email_connection_id],
  );

  return (
    <section className="space-y-5">
      <PageHeader
        title={tr("My mailbox")}
        description={tr("Your own professional address, and the team mailboxes you have been given access to.")}
      />

      {mine.error && <ErrorState message={mine.error} />}
      {error && <ErrorState message={error} />}

      {!personal && !mine.loading && (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <div className="text-sm font-medium">{tr("You have not connected your mailbox yet")}</div>
          <p className="micro mx-auto mt-1 max-w-md text-muted-foreground">
            {tr("Connect your work address and you can read and answer it here, with every message attached to the client or shipment it belongs to.")}
          </p>
          <Button className="mt-4" onClick={() => setWizard(true)}>{tr("Connect my mailbox")}</Button>
        </div>
      )}

      {personal && (
        <div className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="num text-base font-medium">{personal.email_address}</span>
                <Pill tone={tone(personal.status)}>{personal.status}</Pill>
                <HealthPill health={personal.health} showReason />
              </div>
              <p className="micro mt-1 text-muted-foreground">
                {personal.display_name ? `${tr("Sending as")} “${personal.display_name}”. ` : ""}
                {personal.last_success_at
                  ? `${tr("Last synced")} ${dateFmt(personal.last_success_at)}.`
                  : tr("Not synced yet.")}
              </p>
              {personal.last_error && (
                <p className="micro mt-1 text-[rgb(var(--danger))]">{personal.last_error}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2 text-right">
              {allowance.data && (
                <p className="micro text-muted-foreground">
                  {allowance.data.allowed
                    ? `${allowance.data.remaining_hour} ${tr("more messages this hour")}`
                    : `${tr("Sending paused until")} ${dateFmt(allowance.data.retryAt || undefined)}`}
                </p>
              )}
              {/* Quiet, and last. It is the only control on this page that
                  cannot be undone by pressing it again. */}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => disconnect(personal)}
              >
                {tr("Disconnect")}
              </Button>
            </div>
          </div>
          <p className="micro mt-3 border-t border-border pt-3 text-muted-foreground">
            {tr("Each person has one personal mailbox. To move to a different address, disconnect this one and connect the new one — the mail already here stays. If you need another address for a team — billing, operations, support — ask an administrator to set up a shared mailbox and add you to it.")}
          </p>
        </div>
      )}

      {shared.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">{tr("Shared mailboxes you can work")}</h3>
          <ul className="mt-2 space-y-2">
            {shared.map((m) => (
              <li key={m.email_connection_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                <span className="num text-sm">{m.email_address}</span>
                {m.catalogue_label && <Pill tone="mute">{m.catalogue_label}</Pill>}
                <Pill tone={m.access_role === "VIEWER" ? "mute" : "blue"}>
                  {m.access_role === "VIEWER" ? tr("Read only") : m.access_role === "MANAGER" ? tr("Manager") : tr("Can send")}
                </Pill>
                <HealthPill health={m.health} showReason />
              </li>
            ))}
          </ul>
        </div>
      )}

      {wizard && <ConnectWizard onClose={() => setWizard(false)} onDone={() => mine.reload()} />}
    </section>
  );
}
