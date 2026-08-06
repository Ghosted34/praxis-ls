import { useMemo, useState } from "react";
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
        </div>
      )}
      {/* AI providers are deploy-wide integrations too — one shared key set. */}
      <AiVendorsSection />
    </>
  );
}

/* Shared test button + result pill ---------------------------------------- */
function TestButton({ section, keyName }: { section: string; keyName: string }) {
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
    <span className="row" style={{ gap: 10, alignItems: "center" }}>
      <Button variant="ghost" size="sm" onClick={run} loading={busy}>Test</Button>
      {res && (res.ok
        ? <Pill tone="ok">Connected{typeof res.bucket === "string" ? ` · ${res.bucket}` : ""}</Pill>
        : <Pill tone="bad">Failed{res.status ? ` · ${res.status}` : ""}{res.error ? ` · ${String(res.error).slice(0, 60)}` : ""}</Pill>)}
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
      <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Regenerating invalidates existing browser subscriptions. Note: push delivery (subscription table + client service worker) is not yet wired.
      </p>
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
    <Card
      title="System-email fallback sender"
      actions={<TestButton section="mail" keyName="fallback" />}
    >
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
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <Button variant="primary" onClick={save} loading={busy}>Save</Button>
      </div>
    </Card>
  );
}
