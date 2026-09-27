import { useEffect, useState } from "react";
import { fmtDateDmy } from "@/lib/format";
import { platform, type AiVendor, type GeminiModelCheck } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useToast } from "@/components/Toast";
import { Button, Card, ConfirmModal, Empty, Field, Loading, Pill } from "@/components/ui";

/**
 * Deploy-wide AI vendor keys — ONE shared set every tenant's AI runtime uses.
 * Rendered as a section inside Integrations (AI is a deploy-wide integration).
 * Keys are stored encrypted and never shown after saving; each has a live test.
 *
 * This is also where the deployment chooses which chat vendor answers FIRST.
 * The API marks one row `is_chat_primary`; the runtime reads it on every call,
 * so a switch here reaches every tenant's next turn with no restart. The
 * fallback is not chosen separately — it is the default chain with the primary
 * removed, so choosing Gemini makes DeepSeek the fallback and vice versa. Only
 * `chat_capable` vendors get the control: Groq (voice) and the embeddings
 * endpoint cannot answer a chat call and the API refuses them regardless.
 */
export function AiVendorsSection() {
  const { data, loading, error, reload } = useAsync<AiVendor[]>(() => platform.aiVendors() as Promise<AiVendor[]>);
  const rows = data || [];
  const primary = rows.find((v) => v.is_chat_primary && v.chat_capable) || null;
  // The runtime's fallback is "the default chain minus the primary". Shown so
  // the operator sees the whole chain a turn will walk, not just its head.
  const fallback = rows.find((v) => v.chat_capable && v.vendor !== (primary ? primary.vendor : "deepseek")) || null;
  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>AI providers</h2>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          One shared set of provider keys for the whole deployment — every tenant's AI runtime uses these. Keys are encrypted and never shown after saving.
        </div>
        {!loading && !error && rows.length > 0 && (
          <div className="row" style={{ gap: 8, marginTop: 8, fontSize: 12.5 }} data-testid="ai-chat-chain">
            <span className="dim">Chat chain:</span>
            <Pill tone="ok">{primary ? primary.display_name || primary.vendor : "DeepSeek (default)"}</Pill>
            <span className="muted">→</span>
            <Pill tone="mute">{fallback ? fallback.display_name || fallback.vendor : "—"}</Pill>
            <span className="muted">
              {primary ? "Chosen here; every tenant's assistant and drafting tries the primary first." : "No primary chosen yet — the code default applies."}
            </span>
          </div>
        )}
      </div>
      {loading ? <Loading /> : error ? <Empty>Couldn’t load AI providers — {error.message}</Empty> : (
        <div style={{ display: "grid", gap: 16 }}>
          {rows.map((v) => <VendorCard key={v.vendor} v={v} onSaved={reload} />)}
          {rows.length === 0 && <Empty>No AI providers configured.</Empty>}
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

/**
 * "Use as primary" — behind a confirmation because it changes which vendor
 * every tenant is billed to from the next turn on, and because the card's
 * Save button sits right beside it. The dialog names the outcome (which vendor
 * becomes primary, which becomes the fallback) so the operator confirms a
 * sentence, not a button.
 */
function MakePrimaryButton({ v, onDone }: { v: AiVendor; onDone: () => void }) {
  const { toast, fail } = useToast();
  const [asking, setAsking] = useState(false);
  const name = v.display_name || v.vendor;
  const ready = v.is_active && v.has_key;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setAsking(true)}
        title={ready ? `Make ${name} the first chat provider every tenant's AI tries` : `${name} needs a saved key and Active on before it can answer first`}
      >
        Use as primary
      </Button>
      {asking && (
        <ConfirmModal
          title={`Make ${name} the primary chat provider?`}
          confirmLabel={`Make ${name} primary`}
          onClose={() => setAsking(false)}
          onConfirm={async () => {
            try {
              await platform.setAiChatPrimary(v.vendor);
              toast(`${name} is now the primary chat provider`);
              onDone();
            } catch (e) {
              fail(e);
            }
          }}
          body={
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                Every tenant's assistant, drafting and copy features will try <strong>{name}</strong> first from their next
                turn. The current primary becomes the fallback. No restart is needed.
              </div>
              {!ready && (
                <div style={{ color: "var(--warn)" }}>
                  {name} has {v.has_key ? "" : "no saved key"}{!v.has_key && !v.is_active ? " and " : ""}{v.is_active ? "" : "Active off"} — until that is fixed every
                  turn will fail over to the fallback after a failed call. Save a key and switch it on first, or expect slower answers.
                </div>
              )}
              <div className="muted" style={{ fontSize: 12 }}>
                Spend is metered per vendor at the prices set in each tenant's AI Control → Vendors; check the {name} row is priced.
              </div>
            </div>
          }
        />
      )}
    </>
  );
}

/**
 * Whether the configured Gemini model still exists (calls audit N3). Google
 * retires model ids; a retired one fails every Gemini request, which takes out
 * the call transcription fallback, call summaries and document vision.
 */
export function GeminiModelStatus({ refreshKey = 0 }: { refreshKey?: number }) {
  const [check, setCheck] = useState<GeminiModelCheck | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    platform.geminiModelCheck(refreshKey > 0)
      .then((c) => { if (live) { setCheck(c); setFailed(null); } })
      .catch((e: unknown) => { if (live) setFailed(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [refreshKey]);
  if (failed) return <Pill tone="warn">Model not checked · {failed.slice(0, 60)}</Pill>;
  if (!check) return <span className="muted" style={{ fontSize: 12 }}>Checking model…</span>;
  if (check.status === "ok") return <Pill tone="ok">Model {check.model} is available</Pill>;
  if (check.status === "missing") {
    return (
      <span role="alert">
        <Pill tone="bad">Model {check.model} does not exist at Google — set a current model</Pill>
      </span>
    );
  }
  if (check.status === "unusable") return <Pill tone="bad">Model {check.model} cannot generate content</Pill>;
  if (check.status === "unconfigured") return <Pill tone="warn">No Gemini key, so the model was not checked</Pill>;
  return <Pill tone="warn">Model not checked{check.http_status ? ` · ${check.http_status}` : ""}</Pill>;
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
  const [saves, setSaves] = useState(0);
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
      setSaves((n) => n + 1);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };
  const title = (
    <span className="row" style={{ gap: 8 }}>
      <span>{v.display_name || v.vendor}</span>
      {v.chat_capable && v.is_chat_primary && <Pill tone="ok">Primary chat provider</Pill>}
      {v.chat_capable && !v.is_chat_primary && <Pill tone="mute">Chat fallback</Pill>}
    </span>
  );
  return (
    <Card title={title} actions={<TestButton vendor={v.vendor} />}>
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
          {v.last_rotated_at && <span className="muted" style={{ fontSize: 12 }}>rotated {fmtDateDmy(v.last_rotated_at)}</span>}
          {v.vendor === "gemini" && <GeminiModelStatus refreshKey={saves} />}
        </span>
        <span className="row" style={{ gap: 8 }}>
          {v.chat_capable && !v.is_chat_primary && <MakePrimaryButton v={v} onDone={onSaved} />}
          <Button variant="primary" onClick={save} loading={busy}>Save</Button>
        </span>
      </div>
    </Card>
  );
}
