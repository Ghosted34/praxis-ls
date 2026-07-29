import { useState } from "react";
import { platform, type AiVendor } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useToast } from "@/components/Toast";
import { Button, Card, Empty, Field, Loading, Pill } from "@/components/ui";

/**
 * Deploy-wide AI vendor keys — ONE shared set every tenant's AI runtime uses.
 * Rendered as a section inside Integrations (AI is a deploy-wide integration).
 * Keys are stored encrypted and never shown after saving; each has a live test.
 */
export function AiVendorsSection() {
  const { data, loading, error, reload } = useAsync<AiVendor[]>(() => platform.aiVendors() as Promise<AiVendor[]>);
  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>AI providers</h2>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          One shared set of provider keys for the whole deployment — every tenant's AI runtime uses these. Keys are encrypted and never shown after saving.
        </div>
      </div>
      {loading ? <Loading /> : error ? <Empty>Couldn’t load AI providers — {error.message}</Empty> : (
        <div style={{ display: "grid", gap: 16 }}>
          {(data || []).map((v) => <VendorCard key={v.vendor} v={v} onSaved={reload} />)}
          {(data || []).length === 0 && <Empty>No AI providers configured.</Empty>}
        </div>
      )}
    </section>
  );
}

type TestResult = { ok: boolean; error?: string; status?: number; models?: number };

function TestButton({ vendor }: { vendor: string }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TestResult | null>(null);
  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      setRes((await platform.testAiVendor(vendor)) as TestResult);
    } catch (e) {
      setRes({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="row" style={{ gap: 10 }}>
      <Button variant="ghost" size="sm" onClick={run} loading={busy}>Test</Button>
      {res && (res.ok
        ? <Pill tone="ok">Connected{typeof res.models === "number" ? ` · ${res.models} models` : ""}</Pill>
        : <Pill tone="bad">Failed{res.status ? ` · ${res.status}` : ""}{res.error ? ` · ${String(res.error).slice(0, 60)}` : ""}</Pill>)}
    </span>
  );
}

function VendorCard({ v, onSaved }: { v: AiVendor; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({
    current_model: v.current_model || v.default_model || "",
    endpoint_url: v.endpoint_url || "",
    api_key: "",
    is_active: v.is_active,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: "current_model" | "endpoint_url" | "api_key") => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      await platform.setAiVendor(v.vendor, {
        current_model: f.current_model || undefined,
        endpoint_url: f.endpoint_url || undefined,
        api_key: f.api_key || undefined,
        is_active: f.is_active,
      });
      toast(`${v.display_name || v.vendor} saved`);
      setF({ ...f, api_key: "" });
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={v.display_name || v.vendor} actions={<TestButton vendor={v.vendor} />}>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <Field label="Model"><input className="in" value={f.current_model} onChange={set("current_model")} placeholder="model id" /></Field>
        <Field label="Endpoint URL"><input className="in" value={f.endpoint_url} onChange={set("endpoint_url")} placeholder="https://api.provider.com/v1" /></Field>
        <Field label="API key" hint={v.has_key ? "A key is saved. Leave blank to keep it." : "No key saved yet."}>
          <input className="in" type="password" value={f.api_key} onChange={set("api_key")} placeholder="••••••••" />
        </Field>
        <Field label="Status">
          {/* Constrain the checkbox so it doesn't stretch to the input full-width rule. */}
          <label className="row" style={{ gap: 8, height: 38 }}>
            <input type="checkbox" style={{ width: 16, height: 16, flex: "0 0 auto" }} checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />
            <span>{f.is_active ? "Active" : "Inactive"}</span>
          </label>
        </Field>
      </div>
      <div className="between" style={{ marginTop: 14 }}>
        <span className="row" style={{ gap: 8 }}>
          {v.has_key ? <Pill tone="ok">Key set</Pill> : <Pill tone="warn">No key</Pill>}
          {v.last_rotated_at && <span className="muted" style={{ fontSize: 12 }}>rotated {new Date(v.last_rotated_at).toLocaleDateString()}</span>}
        </span>
        <Button variant="primary" onClick={save} loading={busy}>Save</Button>
      </div>
    </Card>
  );
}
