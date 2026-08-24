/**
 * AI Control — the governance admin surface (AI_ARCHITECTURE §6). Feature flags
 * (incl. the global AI on/off that every Praxis affordance gates on), per-user
 * access grants, spend caps, vendor keys, and usage. Admin-gated server-side
 * (MOD-70). Composes the locked kit; accents resolve to --primary.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { RowActions } from "@/components/ui/row-actions";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { useBaseCurrency } from "@/lib/use-base-currency";
import { money, num, dateFmt, todayISO } from "@/lib/format";
import * as api from "@/lib/ai-governance-api";
import { reportActionError } from "@/lib/action-error";

type GovUser = { user_id: string; full_name?: string | null; email: string };

const shell = pageShell.wide;

function Toggle({
  on,
  busy,
  onClick,
}: {
  on: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      role="switch"
      aria-checked={on}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-[rgb(var(--ink-3)/0.3)]"} ${busy ? "opacity-60" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}

/* ═══════════════════════ Features (flags) ═══════════════════════ */
export function AiFeaturesPage() {
  const { rows, error, loading, reload } = useList<api.FeatureFlag>(
    "/ai/governance/features",
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const flags = rows || [];

  async function toggle(f: api.FeatureFlag) {
    setBusy(f.feature_key);
    try {
      await api.setFeature(f.feature_key, { is_enabled: !f.is_enabled });
      reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<api.FeatureFlag>[] = [
    {
      key: "feature_key",
      label: "Feature",
      render: (f) => (
        <span className="font-medium text-foreground">{f.feature_key}</span>
      ),
    },
    {
      key: "description",
      label: "What it controls",
      render: (f) => (
        <span className="text-muted-foreground">{f.description || "—"}</span>
      ),
    },
    {
      key: "model",
      label: "Model",
      render: (f) =>
        f.default_model ? (
          <span className="num text-muted-foreground">
            {f.default_provider ? `${f.default_provider} · ` : ""}
            {f.default_model}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "state",
      label: "State",
      render: (f) => (
        <Pill tone={f.is_enabled ? "ok" : "mute"}>
          {f.is_enabled ? "On" : "Off"}
        </Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (f) => (
        <div className="flex justify-end">
          <Toggle
            on={f.is_enabled}
            busy={busy === f.feature_key}
            onClick={() => toggle(f)}
          />
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="AI Control" to="/ai-control" />}
        title="Feature flags"
        description="Turn AI capabilities on or off per tenant — the switch every Praxis affordance obeys."
      />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Features" value={num(flags.length)} />
        <KpiTile
          label={tr("Enabled")}
          value={num(flags.filter((f) => f.is_enabled).length)}
        />
        <KpiTile
          label={tr("Off")}
          value={num(flags.filter((f) => !f.is_enabled).length)}
        />
      </KpiRow>
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(f) => f.feature_key}
        empty={{
          title: "No feature flags",
          hint: "Flags seed on tenant bootstrap.",
        }}
      />
    </section>
  );
}

/* ═══════════════════════ Access grants ═══════════════════════ */
function GrantForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const ccy = useBaseCurrency();
  const { rows: users } = useList<GovUser>("/users");
  const { rows: features } = useList<api.FeatureFlag>(
    "/ai/governance/features",
  );
  const [f, setF] = React.useState({
    user_id: "",
    feature_key: "",
    monthly_cap_xaf: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.grantAccess({
        user_id: f.user_id,
        feature_key: f.feature_key,
        monthly_cap_xaf:
          f.monthly_cap_xaf === "" ? undefined : Number(f.monthly_cap_xaf),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Grant AI access"
      description="Give a user access to a feature, optionally with a personal monthly cap."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="User" required>
            <Select
              value={f.user_id}
              onChange={(e) => set("user_id", e.target.value)}
            >
              <option value="">—</option>
              {(users || []).map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name || u.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Feature" required>
            <Select
              value={f.feature_key}
              onChange={(e) => set("feature_key", e.target.value)}
            >
              <option value="">—</option>
              {(features || []).map((x) => (
                <option key={x.feature_key} value={x.feature_key}>
                  {x.feature_key}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Monthly cap (${ccy})`} className="sm:col-span-2">
            <Input
              type="number"
              min="0"
              step="1"
              className="num text-right"
              value={f.monthly_cap_xaf}
              onChange={(e) => set("monthly_cap_xaf", e.target.value)}
              placeholder={tr("Optional")}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={!f.user_id || !f.feature_key || busy}
          >
            Grant access
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AiGrantsPage() {
  const { rows, error, loading, reload } = useList<api.Grant>(
    "/ai/governance/grants",
  );
  const { rows: users } = useList<GovUser>("/users");
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const userName = React.useMemo(() => {
    const m: Record<string, string> = {};
    (users || []).forEach((u) => {
      m[String(u.user_id)] = u.full_name || u.email;
    });
    return m;
  }, [users]);

  async function revoke(g: api.Grant) {
    setBusy(g.user_id + g.feature_key);
    try {
      await api.revokeAccess({
        user_id: g.user_id,
        feature_key: g.feature_key,
      });
      reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<api.Grant>[] = [
    {
      key: "user",
      label: "User",
      render: (g) => (
        <span className="font-medium text-foreground">
          {userName[g.user_id] || g.user_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "feature_key",
      label: "Feature",
      render: (g) => <Pill tone="mute">{g.feature_key}</Pill>,
    },
    {
      key: "cap",
      label: "Monthly cap",
      className: "num text-right",
      render: (g) =>
        g.monthly_cap_xaf != null ? money(g.monthly_cap_xaf) : "—",
    },
    {
      key: "state",
      label: "State",
      render: (g) => (
        <Pill tone={g.revoked_at ? "bad" : "ok"}>
          {g.revoked_at ? "Revoked" : "Active"}
        </Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (g) =>
        !g.revoked_at ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              loading={busy === g.user_id + g.feature_key}
              onClick={() => revoke(g)}
            >
              Revoke
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="AI Control" to="/ai-control" />}
        title="Access grants"
        description="Per-user access to AI features (the feature flag must also be on)."
        action={<Button onClick={() => setOpen(true)}>Grant access</Button>}
      />
      <HubTabs />
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(g) => g.grant_id || g.user_id + g.feature_key}
        empty={{
          title: "No grants",
          hint: "Grant a user access to an AI feature.",
        }}
      />
      {open && <GrantForm onClose={() => setOpen(false)} onSaved={reload} />}
    </section>
  );
}

/* ═══════════════════════ Budget / spend caps ═══════════════════════ */
export function AiBudgetPage() {
  const b = useResource(() => api.getBudget(), []);
  const [open, setOpen] = React.useState(false);
  const d = b.data;
  const stateTone: Tone =
    d?.state === "BLOCK" ? "bad" : d?.state === "WARN" ? "warn" : "ok";
  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="AI Control" to="/ai-control" />}
        title="Spend caps"
        description="Monthly AI budget — soft cap warns, hard cap blocks all AI calls."
        action={<Button onClick={() => setOpen(true)}>Set budget</Button>}
      />
      <HubTabs />
      {b.loading ? (
        <div className="py-8 text-center micro">{tr("Loading…")}</div>
      ) : b.error ? (
        <ErrorState message={b.error} />
      ) : (
        <KpiRow>
          <KpiTile label="Spent this period" value={money(d?.spent_xaf)} />
          <KpiTile label="Soft cap" value={money(d?.soft_cap_xaf)} />
          <KpiTile label="Hard cap" value={money(d?.hard_cap_xaf)} />
          <KpiTile
            label={tr("State")}
            value={<Pill tone={stateTone}>{d?.state || "OK"}</Pill>}
          />
        </KpiRow>
      )}
      {d?.period_start && (
        <p className="micro">
          Period {dateFmt(d.period_start)} → {dateFmt(d.period_end)}
        </p>
      )}
      {open && (
        <BudgetForm
          current={d}
          onClose={() => setOpen(false)}
          onSaved={() => b.reload()}
        />
      )}
    </section>
  );
}

function BudgetForm({
  current,
  onClose,
  onSaved,
}: {
  current?: api.Budget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ccy = useBaseCurrency();
  const [f, setF] = React.useState({
    period_start: current?.period_start || todayISO(),
    period_end: current?.period_end || todayISO(),
    soft_cap_xaf:
      current?.soft_cap_xaf != null ? String(current.soft_cap_xaf) : "",
    hard_cap_xaf:
      current?.hard_cap_xaf != null ? String(current.hard_cap_xaf) : "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setBudget({
        period_start: f.period_start,
        period_end: f.period_end,
        soft_cap_xaf: Number(f.soft_cap_xaf),
        hard_cap_xaf: Number(f.hard_cap_xaf),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Set AI budget"
      description="Caps apply to the whole tenant's AI spend for the period."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Period start" required>
            <Input
              type="date"
              value={f.period_start}
              onChange={(e) => set("period_start", e.target.value)}
            />
          </Field>
          <Field label="Period end" required>
            <Input
              type="date"
              value={f.period_end}
              onChange={(e) => set("period_end", e.target.value)}
            />
          </Field>
          <Field label={`Soft cap (${ccy})`} required>
            <Input
              type="number"
              min="0"
              className="num text-right"
              value={f.soft_cap_xaf}
              onChange={(e) => set("soft_cap_xaf", e.target.value)}
            />
          </Field>
          <Field label={`Hard cap (${ccy})`} required>
            <Input
              type="number"
              min="0"
              className="num text-right"
              value={f.hard_cap_xaf}
              onChange={(e) => set("hard_cap_xaf", e.target.value)}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            Save budget
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ═══════════════════════ Vendors / keys ═══════════════════════ */
/** Numeric field → string for a controlled input; 0 and null both render "". */
const numStr = (v: number | string | null | undefined) =>
  v === null || v === undefined || Number(v) === 0 ? "" : String(v);
/** Controlled rate input → the number the API wants; blank leaves it at 0. */
const rate = (v: string) => {
  const n = Number(String(v).trim());
  return String(v).trim() === "" || !Number.isFinite(n) || n < 0 ? 0 : n;
};

function VendorKeyForm({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: api.Vendor;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    api_key: "",
    default_model: vendor.default_model || "",
    endpoint_url: vendor.endpoint_url || "",
    // Pricing: without it every metered call costs 0 and the Usage screen
    // reports 0.00 no matter how many tokens it counted.
    cost_per_1k_input_tokens: numStr(vendor.cost_per_1k_input_tokens),
    cost_per_1k_output_tokens: numStr(vendor.cost_per_1k_output_tokens),
    cost_per_audio_minute: numStr(vendor.cost_per_audio_minute),
    cost_native_currency: vendor.cost_native_currency || "USD",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setVendor(vendor.vendor, {
        api_key: f.api_key || undefined,
        default_model: f.default_model || undefined,
        endpoint_url: f.endpoint_url || undefined,
        cost_per_1k_input_tokens: rate(f.cost_per_1k_input_tokens),
        cost_per_1k_output_tokens: rate(f.cost_per_1k_output_tokens),
        cost_per_audio_minute: rate(f.cost_per_audio_minute),
        cost_native_currency:
          f.cost_native_currency.trim().toUpperCase() || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`${vendor.display_name || vendor.vendor} · credentials`}
      description="The API key is encrypted at rest and never returned to the browser."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tr("API key")}
            className="sm:col-span-2"
            hint={
              vendor.has_key
                ? "A key is already set — leave blank to keep it."
                : "Paste the provider API key."
            }
          >
            <Input
              type="password"
              value={f.api_key}
              onChange={(e) => set("api_key", e.target.value)}
              placeholder={vendor.has_key ? "•••••••• (set)" : "sk-…"}
            />
          </Field>
          <Field label="Default model">
            <Input
              value={f.default_model}
              onChange={(e) => set("default_model", e.target.value)}
            />
          </Field>
          <Field label="Endpoint URL">
            <Input
              value={f.endpoint_url}
              onChange={(e) => set("endpoint_url", e.target.value)}
              placeholder="https://…"
            />
          </Field>
        </div>
        <div className="space-y-1 pt-2">
          <div className="text-sm font-medium">{tr("Pricing")}</div>
          <p className="text-xs text-muted-foreground">
            {tr(
              "The provider's list price, in the currency below. Leave a rate at 0 and every call metered against this vendor costs 0 — which is what makes AI Control → Usage read 0.00.",
            )}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tr("Cost per 1k input tokens")}
            hint="e.g. 0.00027 for DeepSeek chat ($0.27 per 1M)."
          >
            <Input
              inputMode="decimal"
              value={f.cost_per_1k_input_tokens}
              onChange={(e) => set("cost_per_1k_input_tokens", e.target.value)}
              placeholder="0.000000"
            />
          </Field>
          <Field label={tr("Cost per 1k output tokens")}>
            <Input
              inputMode="decimal"
              value={f.cost_per_1k_output_tokens}
              onChange={(e) => set("cost_per_1k_output_tokens", e.target.value)}
              placeholder="0.000000"
            />
          </Field>
          <Field
            label={tr("Cost per audio minute")}
            hint="Transcription vendors only (Whisper/Groq)."
          >
            <Input
              inputMode="decimal"
              value={f.cost_per_audio_minute}
              onChange={(e) => set("cost_per_audio_minute", e.target.value)}
              placeholder="0.000000"
            />
          </Field>
          <Field
            label={tr("Price currency")}
            hint="Converted to your base currency with the FX rate of the day."
          >
            <Input
              value={f.cost_native_currency}
              onChange={(e) => set("cost_native_currency", e.target.value)}
              placeholder="USD"
              maxLength={3}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* Common OpenAI-compatible providers, prefilled but fully editable. `PUT
 * /vendors/:vendor` upserts, so "adding" is just setting a new vendor row. */
// Vendor ids MUST match what the runtime resolves (embeddings.service uses
// "embeddings"; llm.service PRIMARY is "deepseek"; ai-vision uses "gemini";
// ai-transcribe uses "groq"). A DB row for the right id overrides the .env key.
const VENDOR_PRESETS: {
  vendor: string;
  display_name: string;
  endpoint_url: string;
  default_model: string;
  note: string;
}[] = [
  {
    vendor: "embeddings",
    display_name: "Embeddings (OpenAI)",
    endpoint_url: "https://api.openai.com/v1",
    default_model: "text-embedding-3-small",
    note: "pgvector recall — fixes the embeddings 401",
  },
  {
    vendor: "deepseek",
    display_name: "DeepSeek",
    endpoint_url: "https://api.deepseek.com/v1",
    default_model: "deepseek-chat",
    note: "assistant / chat (primary)",
  },
  {
    vendor: "gemini",
    display_name: "Google Gemini",
    endpoint_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    default_model: "gemini-1.5-flash",
    note: "document vision",
  },
  {
    vendor: "groq",
    display_name: "Groq",
    endpoint_url: "https://api.groq.com/openai/v1",
    default_model: "whisper-large-v3",
    note: "voice-to-text",
  },
];

function AddVendorForm({
  existing,
  onClose,
  onSaved,
}: {
  existing: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [preset, setPreset] = React.useState("openai");
  const p0 = VENDOR_PRESETS[0];
  const [f, setF] = React.useState({
    vendor: p0.vendor,
    display_name: p0.display_name,
    endpoint_url: p0.endpoint_url,
    default_model: p0.default_model,
    api_key: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  function applyPreset(id: string) {
    setPreset(id);
    const p = VENDOR_PRESETS.find((x) => x.vendor === id);
    setF(
      p
        ? {
            vendor: p.vendor,
            display_name: p.display_name,
            endpoint_url: p.endpoint_url,
            default_model: p.default_model,
            api_key: "",
          }
        : {
            vendor: "",
            display_name: "",
            endpoint_url: "",
            default_model: "",
            api_key: "",
          },
    );
  }
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = f.vendor.trim().toLowerCase();
  const dup = existing.includes(id);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setVendor(id, {
        display_name: f.display_name || undefined,
        endpoint_url: f.endpoint_url || undefined,
        default_model: f.default_model || undefined,
        api_key: f.api_key || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Add AI vendor"
      description="Register a provider + its API key (encrypted at rest). OpenAI-compatible endpoints."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Provider")}>
          <Select value={preset} onChange={(e) => applyPreset(e.target.value)}>
            {VENDOR_PRESETS.map((p) => (
              <option key={p.vendor} value={p.vendor}>
                {p.display_name} — {p.note}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Vendor id"
            required
            hint={
              dup
                ? "Already added — this will overwrite it."
                : "lowercase key, e.g. openai"
            }
          >
            <Input
              value={f.vendor}
              onChange={(e) => set("vendor", e.target.value)}
              disabled={preset !== "custom"}
            />
          </Field>
          <Field label={tr("Display name")}>
            <Input
              value={f.display_name}
              onChange={(e) => set("display_name", e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Endpoint URL"
          hint="OpenAI-compatible base; the app appends /embeddings or /chat/completions."
        >
          <Input
            value={f.endpoint_url}
            onChange={(e) => set("endpoint_url", e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </Field>
        <Field label="Default model">
          <Input
            value={f.default_model}
            onChange={(e) => set("default_model", e.target.value)}
            placeholder="text-embedding-3-small"
          />
        </Field>
        <Field label={tr("API key")} required>
          <Input
            type="password"
            value={f.api_key}
            onChange={(e) => set("api_key", e.target.value)}
            placeholder="sk-…"
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={!id || !f.api_key || busy}
          >
            Add vendor
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Any non-zero rate = this vendor's calls will cost something. */
const isPriced = (v: api.Vendor) =>
  Number(v.cost_per_1k_input_tokens || 0) > 0 ||
  Number(v.cost_per_1k_output_tokens || 0) > 0 ||
  Number(v.cost_per_audio_minute || 0) > 0;

export function AiVendorsPage() {
  const { rows, error, loading, reload } = useList<api.Vendor>(
    "/ai/governance/vendors",
  );
  const [editing, setEditing] = React.useState<api.Vendor | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [testing, setTesting] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function toggleActive(v: api.Vendor) {
    setBusy(v.vendor);
    try {
      await api.setVendor(v.vendor, { is_active: !v.is_active });
      reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusy(null);
    }
  }
  async function test(v: api.Vendor) {
    setTesting(v.vendor);
    try {
      const r = await api.testVendor(v.vendor);
      alert(r.ok ? "Connection OK" : `Failed: ${r.message || "unknown"}`);
    } catch (e) {
      alert(errMsg(e));
    } finally {
      setTesting(null);
    }
  }

  const columns: Column<api.Vendor>[] = [
    {
      key: "vendor",
      label: "Vendor",
      render: (v) => (
        <span className="font-medium text-foreground">
          {v.display_name || v.vendor}
        </span>
      ),
    },
    {
      key: "model",
      label: "Model",
      render: (v) => (
        <span className="num text-muted-foreground">
          {v.current_model || v.default_model || "—"}
        </span>
      ),
    },
    {
      key: "key",
      label: "Key",
      render: (v) => (
        <Pill tone={v.has_key ? "ok" : "warn"}>
          {v.has_key ? "Set" : "Missing"}
        </Pill>
      ),
    },
    {
      // An unpriced vendor meters every call at 0, so Usage reports 0.00 spend
      // however many tokens it counted. Surfaced here because it is invisible
      // otherwise — the token counts look perfectly healthy.
      key: "priced",
      label: "Pricing",
      render: (v) =>
        isPriced(v) ? (
          <Pill tone="ok">{v.cost_native_currency || "set"}</Pill>
        ) : (
          <Pill tone="warn">Not priced</Pill>
        ),
    },
    {
      key: "active",
      label: "Active",
      render: (v) => (
        <Toggle
          on={!!v.is_active}
          busy={busy === v.vendor}
          onClick={() => toggleActive(v)}
        />
      ),
    },
    {
      key: "_a",
      label: "",
      render: (v) => (
        <RowActions>
          <Button
            size="sm"
            variant="outline"
            loading={testing === v.vendor}
            onClick={() => test(v)}
          >
            Test
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(v)}>
            Key
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="AI Control" to="/ai-control" />}
        title="Vendors & keys"
        description="LLM/vision/voice providers — model, encrypted API key, and a connection test."
        action={<Button onClick={() => setAdding(true)}>Add vendor</Button>}
      />
      <HubTabs />
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(v) => v.vendor}
        empty={{
          title: "No vendors yet",
          hint: "Add a provider (e.g. OpenAI for embeddings) and paste its API key.",
        }}
      />
      {editing && (
        <VendorKeyForm
          vendor={editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {adding && (
        <AddVendorForm
          existing={(rows || []).map((v) => v.vendor)}
          onClose={() => setAdding(false)}
          onSaved={reload}
        />
      )}
    </section>
  );
}

/* ═══════════════════════ Usage ═══════════════════════ */
export function AiUsagePage() {
  const ccy = useBaseCurrency();
  const { rows, error, loading } = useList<api.UsageRow>(
    "/ai/governance/usage",
  );
  const list = rows || [];
  const total = list.reduce((s, r) => s + Number(r.cost_xaf || 0), 0);
  // Calls that were metered but priced at nothing. Either the vendor carries no
  // rates, or no FX rate resolved its currency into ours — both end as a 0.00
  // row beside a healthy token count, which reads as "the meter is broken".
  const unpriced = list.filter(
    (r) => Number(r.cost_xaf || 0) === 0 && Number(r.total_tokens || r.input_tokens || 0) > 0,
  ).length;
  const columns: Column<api.UsageRow>[] = [
    {
      key: "occurred_at",
      label: "When",
      // The ledger column is occurred_at; created_at is a fallback for any
      // caller that ever shaped a row itself.
      render: (r) => (
        <span className="num">{dateFmt(r.occurred_at || r.created_at)}</span>
      ),
    },
    {
      key: "feature_key",
      label: "Feature",
      render: (r) =>
        r.feature_key ? <Pill tone="mute">{r.feature_key}</Pill> : "—",
    },
    {
      key: "model",
      label: "Model",
      render: (r) => (
        <span className="num text-muted-foreground">
          {r.provider ? `${r.provider} · ` : ""}
          {r.model || "—"}
        </span>
      ),
    },
    {
      key: "tokens",
      label: "Tokens",
      className: "num text-right",
      render: (r) =>
        `${num(r.input_tokens || 0)} / ${num(r.output_tokens || 0)}`,
    },
    {
      key: "cost",
      label: `Cost · ${ccy}`,
      className: "num text-right",
      render: (r) => {
        const cost = Number(r.cost_xaf || 0);
        const native = Number(r.cost_native || 0);
        // Priced by the vendor but not convertible — show the vendor-currency
        // figure rather than a 0.00 that claims the call was free.
        if (cost === 0 && native > 0)
          return (
            <span title="No FX rate for this vendor's currency — set one under Currencies.">
              {native.toFixed(6)} {r.cost_native_currency || ""}
            </span>
          );
        return money(r.cost_xaf);
      },
    },
    {
      key: "ok",
      label: "",
      render: (r) =>
        r.was_successful === false ? <Pill tone="bad">failed</Pill> : null,
    },
  ];
  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="AI Control" to="/ai-control" />}
        title="Usage"
        description="Metered AI calls and their cost, per the active budget period."
      />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Calls" value={num(list.length)} />
        <KpiTile label={tr("Total cost")} value={money(total)} />
      </KpiRow>
      {unpriced > 0 && (
        <p className="text-xs text-muted-foreground">
          {unpriced} {tr("of these calls priced at zero.")}{" "}
          {tr(
            "A call costs nothing when its vendor has no token rates (AI Control → Vendors → Key) or when no FX rate converts the vendor's currency into",
          )}{" "}
          {ccy}.
        </p>
      )}
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r, i) => String(r.usage_id || i)}
        empty={{
          title: "No usage yet",
          hint: "AI calls are metered here as they happen.",
        }}
      />
    </section>
  );
}
