import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { platform, type PlatformSetting, type SettingTestResult } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useToast } from "@/components/Toast";
import { Button, Card, Empty, Field, Loading, PageHeader, Pill } from "@/components/ui";
import { AiVendorsSection } from "@/features/AiVendors";

/**
 * Deploy-wide integration credentials (S3 / Geoapify / VAPID). Root-admin sets
 * them once per deployment; secrets are write-only (reads show presence + last4)
 * and each has a live "Test" against the provider.
 */
export function Integrations() {
  const { data, loading, error, reload } = useAsync<PlatformSetting[]>(() => platform.settings() as Promise<PlatformSetting[]>);
  const byKey = useMemo(() => {
    const m: Record<string, PlatformSetting> = {};
    for (const r of data || []) m[`${r.section}.${r.key}`] = r;
    return m;
  }, [data]);

  return (
    <>
      <PageHeader title="Integrations" desc="Deploy-wide credentials shared by all tenants. Secrets are stored encrypted and never shown after saving." />
      {loading ? <Loading /> : error ? <Empty>Couldn’t load integrations — {error.message}</Empty> : (
        <div className="grid" style={{ display: "grid", gap: 16 }}>
          <S3Card row={byKey["storage.s3"]} onSaved={reload} />
          <GeoapifyCard row={byKey["geocoding.geoapify"]} onSaved={reload} />
          <VapidCard row={byKey["push.vapid"]} onSaved={reload} />
          <MailFallbackCard row={byKey["mail.fallback"]} onSaved={reload} />
          <BackupStorageCard row={byKey["storage.backup"]} onSaved={reload} />
          <SignwellCard rows={byKey} onSaved={reload} />
          <AlertsCard rows={byKey} onSaved={reload} />
        </div>
      )}
      {/* AI providers are deploy-wide integrations too — one shared key set. */}
      <AiVendorsSection />
    </>
  );
}

/* Shared test button + result pill ---------------------------------------- */
/* `mailHelp` (used by the Mail fallback card) renders the SMTP fix guide under
 * a failed result — the same guidance the tenant console shows, keyed on the
 * classified error code returned by settings.test(). */
function MailTestHelp({ code, error }: { code?: string | unknown; error?: string | unknown }) {
  const c = String(code || "").toUpperCase();
  const text = String(error || "").toLowerCase();
  const kind = c === "SMTP_SENDER_REJECTED" || c === "SENDER_NOT_AUTHORIZED" || text.includes("sender verify")
    ? "sender"
    : c === "SMTP_AUTH_FAILED" || text.includes("535") || text.includes("eauth")
      ? "auth"
      : null;
  if (!kind) return null;
  const steps = kind === "sender"
    ? [
        "Make the From address a REAL mailbox on its domain (create the mailbox or alias if it doesn't exist).",
        "Check DNS: valid MX, plus SPF allowing this mail server and DKIM (mxtoolbox.com / dmarcian.com).",
        "From must match the authenticated SMTP account — send as the login's own address or a real alias of it.",
        "cPanel/Exim hosts: allow authenticated senders to use any From address, or send from the account's own address.",
        "On a relay (SendGrid/SES/Postmark): verify the From domain as a sender identity.",
        "Then press Test again.",
      ]
    : [
        "Re-enter the SMTP password (blank keeps the old one).",
        "2FA accounts need an APP password, not the login password.",
        "SMTP user must match the mailbox account; port 587 (STARTTLS) or 465 (SSL).",
      ];
  return (
    <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-2)", fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)" }}>
      <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
        🛠 {kind === "sender" ? "550 Sender verify failed — how to fix" : "SMTP login rejected — how to fix"}
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 3 }}>
        {steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
    </div>
  );
}

function TestButton({ section, keyName, mailHelp }: { section: string; keyName: string; mailHelp?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SettingTestResult | null>(null);
  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      setRes((await platform.testSetting(section, keyName)) as SettingTestResult);
    } catch (e) {
      setRes({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <Button variant="ghost" size="sm" onClick={run} loading={busy}>Test</Button>
      {res && (res.ok
        ? <Pill tone="ok">Connected{typeof res.bucket === "string" ? ` · ${res.bucket}` : ""}</Pill>
        : <Pill tone="bad">Failed{res.status ? ` · ${res.status}` : ""}{res.error ? ` · ${String(res.error).slice(0, 60)}` : ""}</Pill>)}
      {mailHelp && res && !res.ok && (
        <span style={{ flexBasis: "100%" }}>
          <MailTestHelp code={res.code} error={res.error} />
        </span>
      )}
    </span>
  );
}

function SecretHint({ row, label }: { row?: PlatformSetting; label: string }) {
  return row?.secret_set
    ? <>Saved{row.last4 ? <> · ends <span className="mono">…{row.last4}</span></> : null}. Leave blank to keep the current {label}.</>
    : <>No {label} saved yet.</>;
}

/* S3 ---------------------------------------------------------------------- */
function S3Card({ row, onSaved }: { row?: PlatformSetting; onSaved: () => void }) {
  const v = (row?.value || {}) as Record<string, string>;
  const { toast } = useToast();
  const [f, setF] = useState({
    endpoint: v.endpoint || "",
    bucket: v.bucket || "",
    region: v.region || "us-east-1",
    access_key: v.access_key || "",
    cdn_base_url: v.cdn_base_url || "",
    secret: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const { secret, ...value } = f;
      await platform.putSetting("storage", "s3", { value, secret: secret || undefined });
      toast("Object storage saved");
      setF({ ...f, secret: "" });
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Object storage (S3-compatible)" actions={<TestButton section="storage" keyName="s3" />}>
      <div className="form-grid" style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <Field label="Bucket"><input className="in" value={f.bucket} onChange={set("bucket")} placeholder="praxis-vault" /></Field>
        <Field label="Region"><input className="in" value={f.region} onChange={set("region")} placeholder="us-east-1" /></Field>
        <Field label="Endpoint" hint="Blank for AWS; set for MinIO/Wasabi/B2/R2."><input className="in" value={f.endpoint} onChange={set("endpoint")} placeholder="https://s3.example.com" /></Field>
        <Field label="CDN base URL" hint="Optional public asset base."><input className="in" value={f.cdn_base_url} onChange={set("cdn_base_url")} placeholder="https://cdn.example.com" /></Field>
        <Field label="Access key ID"><input className="in" value={f.access_key} onChange={set("access_key")} /></Field>
        <Field label="Secret access key" hint={<SecretHint row={row} label="secret key" />}><input className="in" type="password" value={f.secret} onChange={set("secret")} placeholder="••••••••" /></Field>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <Button variant="primary" onClick={save} loading={busy}>Save</Button>
      </div>
    </Card>
  );
}

/* Backup storage (WS-B1) ---------------------------------------------------
 * Where per-tenant dumps, object copies and WAL segments are written.
 *
 * D6: this should be a DIFFERENT provider and account from primary storage.
 * Offsite backups only protect against an account compromise if they live
 * outside the account that could be compromised — pointing this at the same
 * bucket as the document vault gives you a copy, not a backup.
 *
 * Test is a real round trip: it writes an object, reads it back, compares the
 * bytes and deletes it. A key that can write but not read restores nothing, and
 * a key that cannot delete silently defeats retention — both pass a credential
 * check and fail when it matters.
 * ------------------------------------------------------------------------- */
function BackupStorageCard({ row, onSaved }: { row?: PlatformSetting; onSaved: () => void }) {
  const v = (row?.value || {}) as Record<string, string | boolean>;
  const { toast } = useToast();
  const [driver, setDriver] = useState(String(v.driver || "local"));
  const [f, setF] = useState({
    local_path: String(v.local_path || "./data/backups"),
    endpoint: String(v.endpoint || ""),
    bucket: String(v.bucket || ""),
    region: String(v.region || "us-east-1"),
    access_key: String(v.access_key || ""),
    force_path_style: v.force_path_style !== false,
  });
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      await platform.putSetting("storage", "backup", {
        value: { driver, ...f },
        secret: secret || undefined,
      });
      toast("Backup destination saved");
      setSecret("");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Backup storage" actions={<TestButton section="storage" keyName="backup" />}>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        Where tenant database dumps, vault copies and archived logs are written. Keep this in a
        <strong> different account</strong> from primary storage — a backup inside the account it is
        protecting against is a copy, not a backup.
      </p>

      <Field label="Destination">
        <select value={driver} onChange={(e) => setDriver(e.target.value)}>
          <option value="local">Local disk (single host — not offsite)</option>
          <option value="s3">S3-compatible bucket</option>
        </select>
      </Field>

      {driver === "local" ? (
        <div style={{ marginTop: 12 }}>
          <Field
            label="Path on the host"
            hint="Local disk is not offsite: it does not survive losing the machine. Fine for development, not for the only copy of production."
          >
            <input className="in" value={f.local_path} onChange={set("local_path")} />
          </Field>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12, marginTop: 12 }}>
          <div className="grid2">
            <Field label="Bucket"><input className="in" value={f.bucket} onChange={set("bucket")} /></Field>
            <Field label="Region"><input className="in" value={f.region} onChange={set("region")} /></Field>
          </div>
          <Field label="Endpoint" hint="Leave empty for AWS. Set it for Hetzner, Backblaze, Wasabi, MinIO.">
            <input className="in" value={f.endpoint} onChange={set("endpoint")} placeholder="https://s3.example.com" />
          </Field>
          <div className="grid2">
            <Field label="Access key"><input className="in" value={f.access_key} onChange={set("access_key")} /></Field>
            <Field label="Secret key" hint={<SecretHint row={row} label="secret key" />}>
              <input className="in" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••" />
            </Field>
          </div>
          <label className="row" style={{ gap: 8, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={Boolean(f.force_path_style)}
              onChange={(e) => setF({ ...f, force_path_style: e.target.checked })}
            />
            Path-style URLs (needed by MinIO and most non-AWS providers)
          </label>
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <Button variant="primary" onClick={save} loading={busy}>Save</Button>
      </div>
    </Card>
  );
}

/* Ops alerts (WS-ER1) ------------------------------------------------------
 * Where a failed backup, a failed restore drill or a RED tenant goes.
 *
 * The webhook URL is stored as a SECRET, not as config: a Slack/Teams/Discord
 * incoming webhook is a bearer credential — anyone holding it can post as the
 * integration — so it is encrypted at rest and read back as last4 only, exactly
 * like an API key.
 *
 * Two channels rather than one, because the alternative is a single channel
 * that is either noisy enough to be muted or quiet enough to miss things.
 * `page` is optional and falls back to the default when unset: a
 * misconfiguration must degrade to "too noisy", never to "silent".
 * ------------------------------------------------------------------------- */
function AlertsCard({ rows, onSaved }: { rows: Record<string, PlatformSetting>; onSaved: () => void }) {
  const { toast } = useToast();
  const [def, setDef] = useState("");
  const [page, setPage] = useState("");
  const [busy, setBusy] = useState(false);

  const defaultRow = rows["alerts.default"];
  const pageRow = rows["alerts.page"];
  const emailRow = rows["alerts.email"];

  /* The address is NOT a secret, so unlike the webhooks it is shown rather than
   * masked — an operator has to be able to see where alerts are going. It also
   * means the field is seeded with the saved value instead of sitting empty. */
  const savedEmail = (emailRow?.value as { to?: string } | undefined)?.to ?? "";
  const [email, setEmail] = useState(savedEmail);
  useEffect(() => { setEmail(savedEmail); }, [savedEmail]);

  const save = async () => {
    setBusy(true);
    try {
      if (def) await platform.putSetting("alerts", "default", { value: {}, secret: def });
      if (page) await platform.putSetting("alerts", "page", { value: {}, secret: page });
      /* Sent even when blank, so clearing the field actually removes the
       * destination. A setting you can add and not remove is a trap. */
      if (email !== savedEmail) {
        await platform.putSetting("alerts", "email", { value: { to: email.trim() } });
      }
      toast("Alert destinations saved");
      setDef("");
      setPage("");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Ops alerts"
      actions={<TestButton section="alerts" keyName="default" />}
    >
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        Where failed backups, failed restore drills, corrupt documents and RED tenants are sent.
        Until one of these is set, those events are written to a log and nobody is told.
        <strong> Test sends a real message</strong> — check it arrives, because a webhook pasted
        wrong looks identical to one that works right up until the night it matters.
      </p>

      <Field
        label="Default channel"
        hint={<SecretHint row={defaultRow} label="webhook" />}
      >
        <input
          className="in"
          type="password"
          value={def}
          onChange={(e) => setDef(e.target.value)}
          placeholder="https://hooks.slack.com/services/…"
        />
      </Field>

      <div style={{ marginTop: 12 }}>
        <Field
          label="Page channel (optional)"
          hint={
            <>
              For <code className="tag">page</code> severity only — failed backups, failed drills,
              corruption, a tenant that cannot serve. Leave empty and pages go to the default
              channel. <SecretHint row={pageRow} label="webhook" />
            </>
          }
        >
          <input
            className="in"
            type="password"
            value={page}
            onChange={(e) => setPage(e.target.value)}
            placeholder="https://hooks.slack.com/services/… (louder channel)"
          />
        </Field>
      </div>

      <div style={{ marginTop: 12 }}>
        <Field
          label="Email (optional, and independent)"
          hint={
            <>
              Alerts go to <strong>every</strong> destination set here, not the first one that works.
              A chat outage on the night a backup fails should not also be the night nobody is told,
              and email leaves the building a different way — through the system mail sender, so
              set <code className="tag">Mail fallback</code> first or the test will say so.
              {savedEmail ? <> Currently sending to <strong>{savedEmail}</strong>.</> : " Not set."}
            </>
          }
        >
          {/* type=email, not password: an address is not a credential, and an
              operator must be able to see which one is configured. */}
          <input
            className="in"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ops@yourcompany.com"
          />
        </Field>
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginTop: 12, alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 11.5 }}>
          {pageRow?.secret_set ? "Page channel configured." : "No page channel — pages use the default."}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {pageRow?.secret_set && <TestButton section="alerts" keyName="page" />}
          {savedEmail && <TestButton section="alerts" keyName="email" />}
          <Button
            variant="primary"
            onClick={save}
            loading={busy}
            disabled={!def && !page && email === savedEmail}
          >
            Save
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* Geoapify ---------------------------------------------------------------- */
function GeoapifyCard({ row, onSaved }: { row?: PlatformSetting; onSaved: () => void }) {
  const { toast } = useToast();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await platform.putSetting("geocoding", "geoapify", { value: {}, secret: secret || undefined });
      toast("Geoapify key saved");
      setSecret("");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Geocoding (Geoapify)" actions={<TestButton section="geocoding" keyName="geoapify" />}>
      <Field label="API key" hint={<SecretHint row={row} label="key" />}>
        <input className="in" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••" />
      </Field>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <Button variant="primary" onClick={save} loading={busy}>Save</Button>
      </div>
    </Card>
  );
}

/* Certified signing (SignWell) ---------------------------------------------
 * The platform's certified-signature account (SIGNATURE_ENGINEERING_GUIDE
 * §7.2, §7.5). The free-tier allowance belongs to the platform account — the
 * tenants consume envelopes against it — so the key sits here, deploy-wide,
 * not in any tenant's settings. A tenant that brings its own account stores
 * its key in ITS OWN integration secrets (key `qes_signwell`), which the
 * backend prefers over this one; this card is the shared default.
 *
 * The pricing row is platform-tier on the same reasoning: a tenant cannot
 * set the price the platform charges it, and the monthly quota is the
 * platform's allowance, not a tenant's.
 * ------------------------------------------------------------------------- */
function SignwellCard({ rows, onSaved }: { rows: Record<string, PlatformSetting>; onSaved: () => void }) {
  const keyRow = rows["qes.signwell"];
  const priceRow = rows["qes.pricing"];
  const p = (priceRow?.value || {}) as Record<string, string | number>;
  const k = (keyRow?.value || {}) as Record<string, string>;
  const { toast } = useToast();
  const [secret, setSecret] = useState("");
  const [base_url, setBaseUrl] = useState(k.base_url || "");
  const [unit_cost, setUnitCost] = useState(p.unit_cost != null ? String(p.unit_cost) : "");
  const [currency, setCurrency] = useState(String(p.currency || "XAF"));
  const [monthly_quota, setMonthlyQuota] = useState(p.monthly_quota != null ? String(p.monthly_quota) : "25");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await platform.putSetting("qes", "signwell", {
        value: { base_url: base_url.trim() || undefined },
        secret: secret || undefined,
      });
      await platform.putSetting("qes", "pricing", {
        value: {
          unit_cost: unit_cost === "" ? 0 : Number(unit_cost),
          currency: currency.trim().toUpperCase() || "XAF",
          monthly_quota: monthly_quota === "" ? 0 : Number(monthly_quota),
        },
      });
      toast("Certified signing saved");
      setSecret("");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Certified signing (SignWell)" actions={<TestButton section="qes" keyName="signwell" />}>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        The platform account behind the <strong>CERTIFIED</strong> signature card. Envelopes issued
        on it consume the monthly allowance below; the quota watch alerts here at 80% and 95%.
        Tenants with their own SignWell account keep its key in their own workspace, and the
        backend prefers the tenant's key over this one.
      </p>
      <div className="form-grid" style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
        <Field label="API key" hint={<SecretHint row={keyRow} label="key" />}>
          <input className="in" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••" />
        </Field>
        <Field label="API base URL" hint="Blank for the public API. Set for a provider sandbox.">
          <input className="in" value={base_url} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://www.signwell.com/api/v1" />
        </Field>
        <Field label="Unit cost (per envelope)" hint="What the platform bills a tenant per issued envelope. 0 until a rate is set.">
          <input className="in" type="number" min="0" value={unit_cost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Monthly envelope quota" hint="Fleet-wide allowance for the month. 0 disables the quota watch.">
          <input className="in" type="number" min="0" value={monthly_quota} onChange={(e) => setMonthlyQuota(e.target.value)} placeholder="25" />
        </Field>
        <Field label="Currency">
          <input className="in" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="XAF" />
        </Field>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <Button variant="primary" onClick={save} loading={busy}>Save</Button>
      </div>
    </Card>
  );
}

/* VAPID ------------------------------------------------------------------- */
function VapidCard({ row, onSaved }: { row?: PlatformSetting; onSaved: () => void }) {
  const v = (row?.value || {}) as Record<string, string>;
  const { toast } = useToast();
  const [subject, setSubject] = useState(v.subject || "mailto:admin@praxisls.com");
  const [busy, setBusy] = useState(false);
  const generate = async () => {
    setBusy(true);
    try {
      await platform.generateVapid(subject || undefined);
      toast("VAPID keypair generated");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Web Push (VAPID)" actions={<TestButton section="push" keyName="vapid" />}>
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        {row?.secret_set ? <Pill tone="ok">Keypair set</Pill> : <Pill tone="warn">Not generated</Pill>}
        {v.public_key ? <span className="mono muted" style={{ fontSize: 11, wordBreak: "break-all" }}>{String(v.public_key).slice(0, 24)}…</span> : null}
      </div>
      <Field label="Subject" hint="Contact URI sent to push services (mailto: or https:).">
        <input className="in" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
        <Button variant="primary" onClick={generate} loading={busy}>{row?.secret_set ? "Regenerate keypair" : "Generate keypair"}</Button>
      </div>
      {/*
        The old note said push delivery was "not yet wired". It has been wired
        for a long time, and that sentence made this the safest-looking button
        on the page: regenerating looked like configuring something inert.
        It is the opposite. Every browser subscription in every tenant is
        bound to the CURRENT public key, and the push services reject a
        signature from a new one with 403 rather than 410 — so before 12770
        nothing pruned those rows, nothing reported them, and every device on
        the deploy went silently and permanently deaf.
        Devices now re-register themselves on their next app boot, which is
        what makes this recoverable rather than terminal, and what the copy
        below promises. Say the recovery, and say what it costs.
      */}
      {row?.secret_set ? (
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          <strong>Regenerating replaces the identity every registered device subscribed with.</strong>{" "}
          Push stops reaching every user on this deployment until each of their devices
          re-registers, which happens automatically the next time they open the app —
          so a phone nobody opens stays silent. Only regenerate if the private key
          has been exposed.
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          Generate once. Without a keypair, no notification can reach a closed app on
          any tenant — the delivery path degrades quietly rather than erroring.
        </p>
      )}
    </Card>
  );
}

/* System-email fallback ---------------------------------------------------
 * Deploy-wide sender used for SYSTEM emails (OTP, invites, invoices,
 * notifications) when a tenant hasn't configured their own mail — so tenants
 * who haven't pointed their DNS at us never fail to receive system mail.
 * Distinct from each user's mailbox (email_connection). See
 * doc/EMAIL_TWO_CONFIGS.md. */ 
function MailFallbackCard({ row, onSaved }: { row?: PlatformSetting; onSaved: () => void }) {
  const v = (row?.value || {}) as Record<string, string>;
  const { toast } = useToast();
  const [f, setF] = useState({
    from: v.from || "no-reply@praxisls.com",
    from_name: v.from_name || "Praxis",
    support_from: v.support_from || "support@praxisls.com",
    reply_to: v.reply_to || "",
    fallback_domain: v.fallback_domain || "praxisls.com",
    smtp_host: v.smtp_host || "",
    smtp_port: v.smtp_port != null ? String(v.smtp_port) : "587",
    smtp_user: v.smtp_user || "",
    secret: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const { secret, ...value } = f;
      await platform.putSetting("mail", "fallback", { value, secret: secret || undefined });
      toast("Mail fallback saved");
      setF({ ...f, secret: "" });
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="System-email fallback sender">
      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Praxis-owned sender for system emails (OTP, invites, invoices, notifications) when a tenant
        hasn’t configured their own mail. Tenants who don’t point their DNS at us fall back here so
        nothing fails. This is the second email config — separate from each user’s mailbox
        (email_connection).
      </p>
      <div className="form-grid" style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <Field label="From (transactional)"><input className="in" value={f.from} onChange={set("from")} placeholder="no-reply@praxisls.com" /></Field>
        <Field label="From name"><input className="in" value={f.from_name} onChange={set("from_name")} placeholder="Praxis" /></Field>
        <Field label="Support from"><input className="in" value={f.support_from} onChange={set("support_from")} placeholder="support@praxisls.com" /></Field>
        <Field label="Reply-to"><input className="in" value={f.reply_to} onChange={set("reply_to")} placeholder="optional" /></Field>
        <Field label="SMTP host"><input className="in" value={f.smtp_host} onChange={set("smtp_host")} placeholder="mail.praxisls.com" /></Field>
        <Field label="SMTP port"><input className="in" value={f.smtp_port} onChange={set("smtp_port")} /></Field>
        <Field label="SMTP user"><input className="in" value={f.smtp_user} onChange={set("smtp_user")} /></Field>
        <Field label="SMTP password" hint={<SecretHint row={row} label="SMTP password" />}><input className="in" type="password" value={f.secret} onChange={set("secret")} placeholder="••••••••" /></Field>
      </div>
      {/* The Test lives in the body (not the card header like other cards) so a
          failed send-verification renders its fix guide right beneath it. */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginTop: 12, gap: 12 }}>
        <TestButton section="mail" keyName="fallback" mailHelp />
        <Button variant="primary" onClick={save} loading={busy}>Save</Button>
      </div>
      <details style={{ marginTop: 10, fontSize: 12, color: "var(--ink-2)" }}>
        <summary style={{ cursor: "pointer", color: "var(--ink)", fontWeight: 600 }}>Why would the Test fail? (sender-verify guide)</summary>
        <div style={{ marginTop: 6, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-2)", lineHeight: 1.55 }}>
          “550 Sender verify failed” means the server checked the From address and found no real mailbox behind it — a
          DNS/mailbox setup problem, not a Praxis bug:
          <ol style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 3 }}>
            <li>The From address must be a real mailbox on its domain with valid MX, SPF and DKIM records.</li>
            <li>The From address must match the authenticated SMTP account (or be a real alias of it).</li>
            <li>On cPanel/Exim hosts, allow authenticated senders to use any From address — or send from the account’s own address.</li>
            <li>On a relay (SendGrid/SES/Postmark), verify the From domain as a sender identity first.</li>
          </ol>
        </div>
      </details>
    </Card>
  );
}
