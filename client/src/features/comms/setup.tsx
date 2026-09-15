/**
 * Comms → Setup — messaging keys & channels.
 *
 * PER-SECTION sender identities are DYNAMIC: any labelled section (not a fixed
 * four) can have its own From address + SMTP. They are listed in a TABLE with
 * add / edit / view / archive; add and edit share one modal. Below sits the
 * shared SMTP login. Secrets are write-only (blank keeps current).
 * Kit-styled; accents → --primary.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { DataList, type Column } from "@/components/data-list";
import { useResource, errMsg } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import * as api from "@/lib/mail-api";
import * as scapi from "@/lib/smartcomm-api";
import {
  SmtpErrorGuide,
  MailTroubleshootingCard,
} from "@/components/mail/smtp-guide";
import { MailSetupWizard } from "./mail-setup-wizard";
import { useConfirm } from "@/components/ui/use-confirm";

/* The ERP send points a sender can be bound to. These are the system-mail
 * purposes the app sends today; a sender bound to one becomes its From. */
const SECTIONS = [
  { key: "BILLING", label: "Billing (invoices, receipts)" },
  { key: "DOCUMENTS", label: "Documents (BLs, delivery notes)" },
  { key: "NOTIFICATIONS", label: "Notifications (alerts, reminders)" },
  { key: "SUPPORT", label: "Support (customer replies)" },
];

type SenderMode = "add" | "edit" | "view";

/* Add / edit / view a section sender — one modal for all three (view = read-only).
 * Save upserts by `purpose`: a new section inserts, an existing one updates.
 * The section label can't be changed on edit (it keys the row). */
function SenderModal({
  open,
  mode,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: SenderMode;
  existing?: api.Sender;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ro = mode === "view";
  const blank = React.useCallback(
    () => ({
      purpose: existing?.purpose || "",
      from_address: existing?.from_address || "",
      from_name: existing?.from_name || "",
      reply_to: existing?.reply_to || "",
      smtp_host: existing?.smtp_host || "",
      smtp_port: existing?.smtp_port != null ? String(existing.smtp_port) : "",
      is_active: existing?.is_active ?? true,
    }),
    [existing],
  );
  const [f, setF] = React.useState(blank);
  React.useEffect(() => {
    setF(blank());
  }, [blank, open]);
  const set = (k: string, v: string | boolean) =>
    setF((s) => ({ ...s, [k]: v }));
  const [sections, setSections] = React.useState<string[]>(
    existing?.sections || [],
  );
  React.useEffect(() => {
    setSections(existing?.sections || []);
  }, [existing, open]);
  const toggleSection = (k: string) =>
    setSections((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.upsertSender({
        purpose: f.purpose.trim(),
        from_address: f.from_address,
        from_name: f.from_name,
        reply_to: f.reply_to || undefined,
        smtp_host: f.smtp_host || undefined,
        smtp_port: f.smtp_port === "" ? undefined : Number(f.smtp_port),
        is_active: f.is_active,
        sections,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "add"
      ? "Add section sender"
      : mode === "edit"
        ? `Edit — ${existing?.purpose}`
        : `Sender — ${existing?.purpose}`;
  const canSave =
    !ro && !!f.purpose.trim() && !!f.from_address && !!f.from_name;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        ro ? (
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={busy}
              disabled={busy || !canSave}
              onClick={save}
            >
              Save
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={tr("Section")}
          required
          hint={
            mode === "edit"
              ? "The section can't be renamed here."
              : "e.g. Billing, Documents, Ops"
          }
        >
          <Input
            value={f.purpose}
            disabled={ro || mode === "edit"}
            onChange={(e) => set("purpose", e.target.value)}
            placeholder="Billing"
          />
        </Field>
        <Field label={tr("Status")}>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.is_active}
              disabled={ro}
              onChange={(e) => set("is_active", e.target.checked)}
            />{" "}
            Active
          </label>
        </Field>
        <Field label="From address" required>
          <Input
            value={f.from_address}
            disabled={ro}
            onChange={(e) => set("from_address", e.target.value)}
            placeholder="billing@yourco.cm"
          />
        </Field>
        <Field label="From name" required>
          <Input
            value={f.from_name}
            disabled={ro}
            onChange={(e) => set("from_name", e.target.value)}
            placeholder="YourCo Billing"
          />
        </Field>
        <Field label="Reply-to">
          <Input
            value={f.reply_to}
            disabled={ro}
            onChange={(e) => set("reply_to", e.target.value)}
            placeholder={tr("optional")}
          />
        </Field>
        <div />
        <Field label={tr("SMTP host")}>
          <Input
            value={f.smtp_host}
            disabled={ro}
            onChange={(e) => set("smtp_host", e.target.value)}
            placeholder="smtp.provider.com"
          />
        </Field>
        <Field label={tr("SMTP port")}>
          <Input
            type="number"
            className="num"
            value={f.smtp_port}
            disabled={ro}
            onChange={(e) => set("smtp_port", e.target.value)}
            placeholder="587"
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field
          label="Used for (system mail)"
          hint="Which system emails send from this address. Unassigned → the tenant default / Praxis fallback handles it. A section can belong to only one sender."
        >
          <div className="grid gap-1.5 sm:grid-cols-2">
            {SECTIONS.map((sec) => (
              <label key={sec.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sections.includes(sec.key)}
                  disabled={ro}
                  onChange={() => toggleSection(sec.key)}
                />{" "}
                {sec.label}
              </label>
            ))}
          </div>
        </Field>
      </div>
      {ro && (
        <p className="mt-3 rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          SMTP password: <span className="num">••••••••</span> — a shared login,
          set (masked) under <strong>{tr("Credentials")}</strong> below, not per sender.
        </p>
      )}
      {error != null && (
        <div className="mt-2">
          <ErrorState message={errMsg(error)} />
          <SmtpErrorGuide err={error} />
        </div>
      )}
    </Modal>
  );
}

/* Live test result line for the SMTP card. */
function TestLine({ result }: { result: scapi.TestResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <span className="micro text-[rgb(var(--ok))]">
      ✓ Connected
      {typeof result.smtp_host === "string" ? ` · ${result.smtp_host}` : ""}
    </span>
  ) : (
    <span className="micro text-[rgb(var(--bad))]">
      ✗ {String(result.error || "Failed").slice(0, 80)}
    </span>
  );
}

/* SMTP provider config — encrypted password + a live connection test.
 * Secrets are write-only (blank keeps the current value). */
function ChannelConfig() {
  const cfg = useResource(() => scapi.getCommsConfig(), []);
  const em = cfg.data?.email;

  // SMTP
  const [emF, setEmF] = React.useState({
    smtp_host: "",
    smtp_port: "",
    smtp_user: "",
    smtp_pass: "",
  });
  const [emBusy, setEmBusy] = React.useState(false);
  const [emTest, setEmTest] = React.useState<scapi.TestResult | null>(null);
  const [emErr, setEmErr] = React.useState<unknown>(null);
  React.useEffect(() => {
    if (em)
      setEmF((s) => ({
        ...s,
        smtp_host: em.smtp_host || "",
        smtp_port: em.smtp_port ? String(em.smtp_port) : "",
        smtp_user: em.smtp_user || "",
      }));
  }, [em]);
  async function saveEm(e: React.FormEvent) {
    e.preventDefault();
    setEmBusy(true);
    setEmErr(null);
    setEmTest(null);
    try {
      await scapi.setEmailConfig({
        smtp_host: emF.smtp_host || undefined,
        smtp_port: emF.smtp_port === "" ? undefined : Number(emF.smtp_port),
        smtp_user: emF.smtp_user || undefined,
        smtp_pass: emF.smtp_pass || undefined,
      });
      setEmF((s) => ({ ...s, smtp_pass: "" }));
      cfg.reload();
    } catch (err) {
      setEmErr(err);
    } finally {
      setEmBusy(false);
    }
  }
  async function testEm() {
    setEmTest(null);
    setEmErr(null);
    try {
      setEmTest(await scapi.testEmail());
    } catch (err) {
      setEmErr(err);
    }
  }

  return (
    <>
      <form
        onSubmit={saveEm}
        className="rounded-2xl border border-border bg-card p-5 shadow-sm"
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-display text-base">Shared SMTP login</h3>
            <p className="micro">
              Transport for system emails (OTP, invoices, notifications) sent
              from the section senders above. Password encrypted.
            </p>
          </div>
          <Pill tone={em?.pass_set ? "ok" : "warn"}>
            {em?.pass_set ? "Password set" : "Not set"}
          </Pill>
        </div>
        <p className="mb-3 rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <strong>Two separate configs.</strong> These section senders + the
          SMTP login are your <strong>system-email</strong>
          config — how Praxis sends OTPs, invoices and notifications. Until you
          add a sender here, they go out from a Praxis address (
          <span className="num">no-reply@praxisls.com</span> /{" "}
          <span className="num">support@praxisls.com</span>) via the deploy-wide
          fallback, so nothing fails before you set your own DNS/SMTP. Your{" "}
          <strong>mailbox</strong>
          (reading &amp; replying to your own company-domain mail, inbound +
          outbound) is separate — connect it in{" "}
          <span className="num">Comms → Mailbox</span>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("SMTP host")}>
            <Input
              value={emF.smtp_host}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_host: e.target.value }))
              }
              placeholder="smtp.provider.com"
            />
          </Field>
          <Field label={tr("SMTP port")}>
            <Input
              type="number"
              className="num"
              value={emF.smtp_port}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_port: e.target.value }))
              }
              placeholder="587"
            />
          </Field>
          <Field label="SMTP user">
            <Input
              value={emF.smtp_user}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_user: e.target.value }))
              }
              placeholder="apikey / user"
            />
          </Field>
          <Field
            label="SMTP password"
            hint={em?.pass_set ? "Leave blank to keep current." : undefined}
          >
            <Input
              type="password"
              value={emF.smtp_pass}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_pass: e.target.value }))
              }
              placeholder="••••••"
            />
          </Field>
        </div>
        {emErr != null && (
          <div className="mt-2">
            <ErrorState message={errMsg(emErr)} />
            <SmtpErrorGuide err={emErr} />
          </div>
        )}
        {emTest && !emTest.ok && (
          <SmtpErrorGuide code={emTest.code} message={emTest.error} />
        )}
        <div className="mt-3 flex items-center justify-end gap-3">
          <TestLine result={emTest} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={testEm}
            disabled={emBusy}
          >
            Test
          </Button>
          <Button type="submit" size="sm" loading={emBusy} disabled={emBusy}>
            Save
          </Button>
        </div>
      </form>
    </>
  );
}

export function SetupPage() {
  const senders = useResource(() => api.listSenders(), []);
  const navigate = useNavigate();
  const [modal, setModal] = React.useState<{
    mode: SenderMode;
    existing?: api.Sender;
  } | null>(null);
  const [guideOpen, setGuideOpen] = React.useState(false);
  const activeCount = (senders.data || []).filter((s) => s.is_active).length;
  const [confirm, confirmDialog] = useConfirm();

  async function archive(s: api.Sender) {
    // Archiving is reversible (the row is hidden, not deleted), so this is the
    // one confirmation here that is NOT `destructive` — it stays dismissible
    // and keeps the primary button colour. Reserving red for the irreversible
    // is what keeps red meaning something.
    const ok = await confirm({
      title: `Archive the “${s.purpose}” sender?`,
      body: "It stops being available and is hidden from this list. Mail already sent through it is unaffected.",
      confirmLabel: "Archive sender",
    });
    if (!ok) return;
    try {
      await api.archiveSender(s.email_identity_id);
      senders.reload();
    } catch (e) {
      reportActionError(e);
    }
  }

  const cols: Column<api.Sender>[] = [
    {
      key: "section",
      label: "Section",
      render: (s) => (
        <div>
          <span className="font-medium text-foreground">{s.purpose}</span>
          {(s.sections || []).length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {(s.sections || []).map((k) => (
                <Pill key={k} tone="blue">
                  {k}
                </Pill>
              ))}
            </div>
          ) : (
            <span className="micro block">Not bound to a send point</span>
          )}
        </div>
      ),
    },
    {
      key: "from",
      label: "From",
      render: (s) => (
        <div>
          <span className="num text-foreground">{s.from_address}</span>
          {s.from_name ? (
            <span className="micro block">{s.from_name}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (s) => (
        <Pill tone={s.is_active ? "ok" : "mute"}>
          {s.is_active ? "Active" : "Off"}
        </Pill>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (s) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModal({ mode: "view", existing: s })}
          >
            View
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModal({ mode: "edit", existing: s })}
          >
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => archive(s)}>
            Archive
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className={pageShell.wide}>
      {confirmDialog}
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="micro uppercase tracking-wide">Comms</div>
          <h1 className="font-display text-2xl tracking-tight text-foreground">
            Setup &amp; channels
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Per-section email senders and shared credentials.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {activeCount > 0 ? (
            <Pill tone="ok">
              ✓ {activeCount} active sender{activeCount > 1 ? "s" : ""}
            </Pill>
          ) : (
            <Pill tone="warn">Email not set up</Pill>
          )}
          <Button onClick={() => setGuideOpen(true)}>📖 Setup guide</Button>
          <Button variant="outline" onClick={() => navigate("/comms")}>
            ← Back to inbox
          </Button>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg">Section senders</h2>
          <p className="micro">
            Each section mails from its own verified address. Add as many as you
            need.
          </p>
        </div>
        <Button size="sm" onClick={() => setModal({ mode: "add" })}>
          Add sender
        </Button>
      </div>
      <DataList
        columns={cols}
        rows={senders.data}
        error={senders.error}
        loading={senders.loading}
        rowKey={(s) => s.email_identity_id}
        empty={{
          title: "No section senders yet",
          hint: "Add one to send system mail from your own verified address.",
        }}
      />

      <h2 className="mb-2 mt-8 font-display text-lg">{tr("Credentials")}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChannelConfig />
        <MailTroubleshootingCard />
      </div>

      {modal && (
        <SenderModal
          open
          mode={modal.mode}
          existing={modal.existing}
          onClose={() => setModal(null)}
          onSaved={senders.reload}
        />
      )}
      {guideOpen && (
        <MailSetupWizard
          open
          onClose={() => setGuideOpen(false)}
          onDone={senders.reload}
        />
      )}
    </section>
  );
}
