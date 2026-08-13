/**
 * Mail setup guide — the Zoho-style assistant for Comms → Setup.
 *
 * Four steps, completed in order, each auto-verified where the backend can:
 *   1. Sender address — at least one active From address on the tenant's domain
 *   2. DNS records     — MX / SPF / DKIM lookups (with copyable values to add)
 *   3. SMTP connection — live nodemailer verify() against the shared login
 *   4. Test email      — a REAL message sent through the tenant's transport
 *
 * Where a lookup is impossible (resolver failure) the row falls back to a
 * self-check tick — the product decision: max auto-verify, self-check only
 * where practically impossible. Entry is manual-only (the Setup page's
 * "Setup guide" button); no login auto-show.
 *
 * Failures reuse <SmtpErrorGuide />, so a 550 during step 3/4 shows the same
 * fix list the rest of the mail surfaces show.
 */
import * as React from "react";
import { Modal, Field } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { SmtpErrorGuide } from "@/components/mail/smtp-guide";
import { useResource, errMsg } from "@/lib/use-resource";
import { cn } from "@/lib/cn";
import * as api from "@/lib/mail-api";
import * as scapi from "@/lib/smartcomm-api";

const domainOf = (addr: string) => addr.split("@")[1] || "";

const STEPS = [
  { id: "sender", title: "Sender address", sub: "The From address your email goes out from" },
  { id: "dns", title: "DNS records", sub: "MX, SPF and DKIM for that domain" },
  { id: "smtp", title: "SMTP connection", sub: "Credentials actually accepted by the server" },
  { id: "test", title: "Test email", sub: "A real message leaves the building" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

/* Copyable record value — the thing the operator pastes into DNS. */
function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); } catch { /* clipboard unavailable */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
      <code className="num min-w-0 flex-1 break-all text-[11px] text-foreground">{value}</code>
      <Button type="button" size="sm" variant="ghost" onClick={copy}>{copied ? "✓ Copied" : "Copy"}</Button>
    </div>
  );
}

/* One DNS row: label, verdict pill, detail (record to add / hint / self-check). */
function DnsRow({ label, check, manual, onManual }: {
  label: string;
  check: scapi.DnsRecordCheck | undefined;
  manual: boolean;
  onManual: (v: boolean) => void;
}) {
  if (!check) return null;
  const tone = check.ok === true ? "ok" : check.ok === false ? "bad" : "warn";
  const status = check.ok === true ? "OK" : check.ok === false ? "Missing" : "Unchecked";
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-sm text-foreground">{label}</span>
        <Pill tone={tone}>{status}</Pill>
      </div>
      <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {check.ok === true && check.records && check.records.length > 0 && (
          <div>
            {check.records.map((r) => (
              <div key={`${r.host}:${r.priority}`} className="num">{r.host} <span className="text-muted-foreground/70">· priority {r.priority}</span></div>
            ))}
          </div>
        )}
        {check.ok === true && check.record && <CopyRow value={check.record} />}
        {check.ok === true && check.selector && <div>Selector: <span className="num">{check.selector}</span></div>}
        {check.ok === true && check.note && <div>{check.note}</div>}
        {check.ok === false && check.suggest && check.suggest.length > 0 && (
          <div className="space-y-1">
            <div className="text-foreground">Add one of these TXT records to the domain:</div>
            {check.suggest.map((s) => <CopyRow key={s} value={s} />)}
          </div>
        )}
        {check.hint && <div>{check.hint}</div>}
        {check.ok === null && (
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-foreground">
            <input type="checkbox" checked={manual} onChange={(e) => onManual(e.target.checked)} />
            I've set this up — count it as done
          </label>
        )}
      </div>
    </div>
  );
}

export function MailSetupWizard({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: () => void }) {
  const senders = useResource(() => api.listSenders(), []);
  const active = React.useMemo(() => (senders.data || []).filter((s) => s.is_active), [senders.data]);
  const senderKey = active.map((s) => s.email_identity_id).join("|");

  const [step, setStep] = React.useState<number>(0);
  const [domain, setDomain] = React.useState("");
  const [dns, setDns] = React.useState<scapi.DnsCheckResult | null>(null);
  const [dnsBusy, setDnsBusy] = React.useState(false);
  const [dnsErr, setDnsErr] = React.useState<unknown>(null);
  const [manual, setManual] = React.useState({ mx: false, spf: false, dkim: false });
  const [smtp, setSmtp] = React.useState<scapi.TestResult | null>(null);
  const [smtpBusy, setSmtpBusy] = React.useState(false);
  const [to, setTo] = React.useState("");
  const [send, setSend] = React.useState<scapi.TestResult | null>(null);
  const [sendBusy, setSendBusy] = React.useState(false);

  // Derived pass/fail — declared before the effects that consume them.
  const dnsPassed = dns ? (["mx", "spf", "dkim"] as const).every((k) => dns[k].ok === true || manual[k]) : false;
  const smtpPassed = smtp?.ok === true;
  const sendPassed = send?.ok === true;
  const passed: Record<StepId, boolean> = { sender: active.length > 0, dns: dnsPassed, smtp: smtpPassed, test: sendPassed };
  const passedCount = Object.values(passed).filter(Boolean).length;
  const summary = step === STEPS.length;

  // Follow the senders: the domain checked is the first active sender's domain.
  React.useEffect(() => {
    if (!active.length) return;
    const d = domainOf(active[0].from_address);
    if (d && d !== domain) {
      setDomain(d);
      setDns(null);
      setManual({ mx: false, spf: false, dkim: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- domain is guarded (early return once equal)
  }, [senderKey]);

  const checkDns = React.useCallback(async () => {
    if (!domain) return;
    setDnsBusy(true); setDnsErr(null);
    setManual({ mx: false, spf: false, dkim: false });
    try { setDns(await scapi.dnsCheckEmail(domain)); }
    catch (err) { setDnsErr(err); }
    finally { setDnsBusy(false); }
  }, [domain]);

  const runSmtp = React.useCallback(async () => {
    setSmtpBusy(true);
    try { setSmtp(await scapi.testEmail()); }
    catch (err) { setSmtp({ ok: false, error: errMsg(err) }); }
    finally { setSmtpBusy(false); }
  }, []);

  const sendTest = React.useCallback(async () => {
    if (!to.trim()) return;
    setSendBusy(true); setSend(null);
    try { setSend(await scapi.testSendEmail({ to: to.trim() })); }
    catch (err) { setSend({ ok: false, error: errMsg(err) }); }
    finally { setSendBusy(false); }
  }, [to]);

  // Auto-verify on landing: DNS when the step has a domain, SMTP on its step.
  React.useEffect(() => {
    if (open && step === 1 && domain && !dns && !dnsBusy) void checkDns();
  }, [open, step, domain, dns, dnsBusy, checkDns]);
  React.useEffect(() => {
    if (open && step === 2 && !smtp && !smtpBusy) void runSmtp();
  }, [open, step, smtp, smtpBusy, runSmtp]);

  // On open, resume at the first step that hasn't passed yet.
  React.useEffect(() => {
    if (!open) return;
    if (!active.length) setStep(0);
    else if (!dnsPassed) setStep(1);
    else if (!smtpPassed) setStep(2);
    else if (!sendPassed) setStep(3);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume point derives from live verification state, not deps
  }, [open]);

  const continueDisabled = !passed[STEPS[Math.min(step, STEPS.length - 1)].id];
  const smtpUnconfigured = smtp && !smtp.ok && !smtp.code;

  function continue_() {
    if (step < STEPS.length) setStep(step + 1);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={summary ? "Mail setup — complete" : "Mail setup guide"}
      description={summary ? "Your outbound email is verified and working." : "Four steps to verified outbound email. Each check runs against your real configuration."}
      footer={
        summary
          ? <Button size="sm" onClick={() => { onClose(); onDone?.(); }}>Done</Button>
          : <>
              {step > 0 && <Button size="sm" variant="outline" onClick={() => setStep(step - 1)}>Back</Button>}
              <Button size="sm" onClick={continue_} disabled={continueDisabled}>{step === STEPS.length - 1 ? "Finish" : "Continue"}</Button>
            </>
      }
    >
      {/* Step chips + progress */}
      {!summary && (
        <div className="mb-4">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const done = passed[s.id];
              const current = i === step;
              const clickable = done || current;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!clickable}
                  onClick={() => setStep(i)}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] leading-tight transition-colors",
                    current ? "border-primary bg-primary/10 text-foreground" : done ? "border-border bg-card text-foreground" : "border-border bg-card/40 text-muted-foreground opacity-60",
                    clickable && "cursor-pointer hover:border-primary/50",
                  )}
                >
                  <span className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                    done ? "bg-[rgb(var(--ok))] text-white" : current ? "bg-primary text-white" : "bg-muted text-muted-foreground",
                  )}>
                    {done ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{s.title}</span>
                    <span className="block truncate text-muted-foreground">{s.sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-[rgb(var(--ok))] transition-all" style={{ width: `${(passedCount / STEPS.length) * 100}%` }} />
          </div>
        </div>
      )}

      {/* ── Step 0 — Sender address ── */}
      {step === 0 && (
        <div className="space-y-3">
          {active.length > 0 && (
            <div className="space-y-2">
              {active.map((s) => (
                <div key={s.email_identity_id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                  <div className="min-w-0">
                    <div className="num font-medium text-foreground">{s.from_address}</div>
                    <div className="micro">{s.purpose}{s.from_name ? ` · ${s.from_name}` : ""}</div>
                  </div>
                  <Pill tone="ok">Active</Pill>
                </div>
              ))}
              <p className="micro">Your email goes out from the first active sender. Add another section sender below if you need one.</p>
            </div>
          )}
          <AddSenderInline onAdded={() => senders.reload()} />
        </div>
      )}

      {/* ── Step 1 — DNS records ── */}
      {step === 1 && (
        <div className="space-y-3">
          <p className="micro">
            Checking <span className="num text-foreground">{domain}</span> — the domain of your From address. This is the step
            that fixes <span className="num">550 Sender verify failed</span>: the domain must look like a real mail domain to
            receiving servers.
          </p>
          {dnsErr != null && <ErrorState message={errMsg(dnsErr)} />}
          {!dns && !dnsBusy && !dnsErr && (
            <p className="micro">Press “Verify now” to check the domain's records.</p>
          )}
          {dns && (
            <div className="space-y-2">
              <DnsRow label="MX — mail exchange" check={dns.mx} manual={manual.mx} onManual={(v) => setManual((m) => ({ ...m, mx: v }))} />
              <DnsRow label="SPF — sender policy framework" check={dns.spf} manual={manual.spf} onManual={(v) => setManual((m) => ({ ...m, spf: v }))} />
              <DnsRow label="DKIM — signing key" check={dns.dkim} manual={manual.dkim} onManual={(v) => setManual((m) => ({ ...m, dkim: v }))} />
            </div>
          )}
          <div className="flex items-center justify-end">
            <Button size="sm" variant="outline" onClick={checkDns} loading={dnsBusy} disabled={dnsBusy || !domain}>
              {dns ? "Verify again" : "Verify now"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2 — SMTP connection ── */}
      {step === 2 && (
        <div className="space-y-3">
          <p className="micro">We open a real connection to your SMTP server and authenticate — no message is sent.</p>
          {smtpBusy && !smtp && <p className="micro">Testing the SMTP connection…</p>}
          {smtp && smtp.ok && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3">
              <span className="text-[rgb(var(--ok))]">✓</span>
              <span className="text-sm">SMTP connection accepted{typeof smtp.smtp_host === "string" ? <span className="num"> · {smtp.smtp_host}</span> : null}</span>
            </div>
          )}
          {smtp && !smtp.ok && (
            <div>
              <ErrorState message={String(smtp.error || "SMTP test failed")} />
              {smtpUnconfigured && (
                <p className="micro mt-2">
                  No SMTP host is configured yet — fill in the <strong>Shared SMTP login</strong> card on this page (Comms →
                  Setup → Credentials), save it, then run the test again.
                </p>
              )}
              <SmtpErrorGuide code={smtp.code} message={smtp.error} />
            </div>
          )}
          <div className="flex items-center justify-end">
            <Button size="sm" variant="outline" onClick={runSmtp} loading={smtpBusy} disabled={smtpBusy}>Run test again</Button>
          </div>
        </div>
      )}

      {/* ── Step 3 — Test email ── */}
      {step === 3 && (
        <div className="space-y-3">
          <p className="micro">A real message, through your real sender. Send it to an inbox you can check.</p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Send the test to" required>
                <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@company.cm" />
              </Field>
            </div>
            <Button size="sm" onClick={sendTest} loading={sendBusy} disabled={sendBusy || !to.trim()}>Send test email</Button>
          </div>
          {send && send.ok && (
            <div className="rounded-xl border border-border bg-card p-3 text-sm">
              <div className="text-[rgb(var(--ok))]">✓ Sent to {to} — check the inbox <strong>and the spam folder</strong>.</div>
              <p className="micro mt-1">If it lands in spam, mark it “not spam” and return to step 2 — SPF/DKIM are usually the cause.</p>
            </div>
          )}
          {send && !send.ok && (
            <div>
              <ErrorState message={String(send.error || "Test send failed")} />
              <SmtpErrorGuide code={send.code} message={send.error} />
            </div>
          )}
        </div>
      )}

      {/* ── Summary ── */}
      {summary && (
        <div className="space-y-2">
          {STEPS.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <div>
                <div className="text-sm font-medium text-foreground">{s.title}</div>
                <div className="micro">{s.sub}</div>
              </div>
              <Pill tone="ok">✓ Verified</Pill>
            </div>
          ))}
          <p className="micro pt-1">
            Outbound email is configured and verified. If a send ever fails later, the error will carry the same step-by-step
            fix guide you just followed.
          </p>
        </div>
      )}
    </Modal>
  );
}

/* Inline "add a sender" form for step 1 — the same upsert the page's modal
 * uses, minimal fields (section label, From address, From name). */
function AddSenderInline({ onAdded }: { onAdded: () => void }) {
  const [f, setF] = React.useState({ purpose: "", from: "", name: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const [open, setOpen] = React.useState(false);

  async function add() {
    setBusy(true); setError(null);
    try {
      await api.upsertSender({ purpose: f.purpose.trim(), from_address: f.from.trim(), from_name: f.name.trim() });
      setF({ purpose: "", from: "", name: "" });
      setOpen(false);
      onAdded();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  if (!open) {
    return <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>+ Add sender</Button>;
  }
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Section" required><Input value={f.purpose} onChange={(e) => setF((s) => ({ ...s, purpose: e.target.value }))} placeholder="e.g. Billing" /></Field>
        <Field label="From address" required hint="Must be a real mailbox on your domain."><Input type="email" value={f.from} onChange={(e) => setF((s) => ({ ...s, from: e.target.value }))} placeholder="billing@yourco.cm" /></Field>
        <Field label="From name" required><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="YourCo Billing" /></Field>
      </div>
      {error != null && (
        <div className="mt-2">
          <ErrorState message={errMsg(error)} />
          <SmtpErrorGuide err={error} />
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-3">
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="button" size="sm" loading={busy} disabled={busy || !f.purpose.trim() || !f.from.trim() || !f.name.trim()} onClick={add}>Add sender</Button>
      </div>
    </div>
  );
}
