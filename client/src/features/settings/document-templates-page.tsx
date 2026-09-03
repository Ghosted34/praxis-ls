/**
 * Template Studio (doc/DOCUMENT_TEMPLATES_PLAN.md §2/§9). Settings surface where a
 * tenant beautifies + live-previews each generated document. Left = the document
 * rendered live in a sandboxed iframe; right = structured beautify controls,
 * scoped per corporate entity, previewing a real record (or bundled sample).
 * Talks to /document-templates (MOD-70).
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";

type Tpl = {
  docType: string;
  title: { fr?: string; en?: string };
  module: string;
  fields: string[];
  report?: boolean;
};
type Entity = { entity_id: string; legal_name?: string };
type Rec = { id: string; label?: string };
type Cfg = Record<string, unknown>;

const shell = pageShell.wide;
const label = (t: Tpl["title"]) => t.en || t.fr || "";

const Field = ({
  label: l,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <label className="block">
    <span className="micro mb-1 block">{l}</span>
    {children}
    {hint ? (
      <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>
    ) : null}
  </label>
);
const Check = ({
  label: l,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <label className="flex items-center gap-2 py-0.5 text-sm">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    {l}
  </label>
);

export function TemplateStudioPage() {
  const templates = useResource(() => tenant<Tpl[]>("/document-templates"), []);
  const { rows: entities } = useList<Entity>("/entities");
  const [docType, setDocType] = React.useState<string>("");
  const [entityId, setEntityId] = React.useState<string>(""); // "" = tenant default
  const [recordId, setRecordId] = React.useState<string>("");
  const [records, setRecords] = React.useState<Rec[]>([]);
  const [cfg, setCfg] = React.useState<Cfg>({});
  const [html, setHtml] = React.useState<string>("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /** The outcome of `generate()` — see the note there. */
  const [notice, setNotice] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);

  const list = React.useMemo(() => templates.data || [], [templates.data]);
  React.useEffect(() => {
    if (!docType && list.length) setDocType(list[0].docType);
  }, [list, docType]);

  // Load saved config + records when the document or entity changes.
  React.useEffect(() => {
    if (!docType) return;
    let live = true;
    setError(null);
    setDirty(false);
    setRecordId("");
    (async () => {
      try {
        const q = entityId ? `?entity_id=${entityId}` : "";
        const c = await tenant<{
          tenant_default: Cfg;
          entity_override: Cfg | null;
        }>(`/document-templates/${docType}/config${q}`);
        if (live)
          setCfg({ ...(c.tenant_default || {}), ...(c.entity_override || {}) });
        const recs = await tenant<Rec[]>(
          `/document-templates/${docType}/records`,
        );
        if (live) setRecords(recs || []);
      } catch (e) {
        if (live) setError(errMsg(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [docType, entityId]);

  // Debounced live preview whenever the doc/entity/record/config changes.
  React.useEffect(() => {
    if (!docType) return;
    let live = true;
    const id = setTimeout(async () => {
      try {
        const r = await tenant<{ html: string }>(
          `/document-templates/${docType}/preview`,
          {
            method: "POST",
            body: {
              entity_id: entityId || undefined,
              record_id: recordId || undefined,
              config: cfg,
            },
          },
        );
        if (live) setHtml(r.html);
      } catch (e) {
        if (live) setError(errMsg(e));
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [docType, entityId, recordId, cfg]);

  const set = (patch: Cfg) => {
    setCfg((c) => ({ ...c, ...patch }));
    setDirty(true);
  };
  const setNested = (key: string, patch: Cfg) => {
    setCfg((c) => ({ ...c, [key]: { ...(c[key] as Cfg), ...patch } }));
    setDirty(true);
  };
  const show = (cfg.show as Cfg) || {};
  const logo = (cfg.logo as Cfg) || {};
  const sig = (cfg.signature as Cfg) || {};
  const s = (v: unknown, d = "") =>
    v === undefined || v === null ? d : String(v);

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await tenant(`/document-templates/${docType}/config`, {
        method: "PUT",
        body: { entity_id: entityId || undefined, config: cfg },
      });
      setDirty(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  async function generate() {
    setBusy("gen");
    setError(null);
    setNotice(null);
    try {
      const out = await tenant<{ verify?: string }>(
        `/document-templates/${docType}/generate`,
        {
          method: "POST",
          body: {
            entity_id: entityId || undefined,
            record_id: recordId || undefined,
          },
        },
      );
      // Both branches were `alert()`, so "it worked" and "it failed" arrived in
      // the same unbranded OS box. The verdict now lands on the page: a Callout
      // for the success — carrying the verification URL, which people copy and
      // which was unselectable inside an alert — and the existing error state
      // for the failure.
      setNotice(
        "PDF generated & vaulted." + (out.verify ? ` Verify: ${out.verify}` : ""),
      );
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="Document templates"
        description="Beautify and live-preview every generated document — per corporate entity."
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              loading={busy === "gen"}
              onClick={generate}
              disabled={!docType}
            >
              Generate PDF
            </Button>
            <Button
              loading={busy === "save"}
              onClick={save}
              disabled={!docType || !dirty}
            >
              {dirty ? "Save" : "Saved"}
            </Button>
          </div>
        }
      />
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}
      {notice && (
        <div className="mb-3">
          <Callout
            tone="ok"
            action={
              <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
                Dismiss
              </Button>
            }
          >
            {notice}
          </Callout>
        </div>
      )}

      <div className="mb-4 max-w-sm">
        <span className="micro mb-1 block">Document</span>
        <Select
          aria-label={tr("Document type")}
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
        >
          {list.map((t) => (
            <option key={t.docType} value={t.docType}>
              {label(t.title)}
              {t.report ? " · report" : ""}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Live preview */}
        <div className="lux-card overflow-hidden p-0">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="micro">{tr("Entity")}</span>
              <Select
                aria-label="Preview as entity"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                className="h-8 w-auto"
              >
                <option value="">All entities (default)</option>
                {(entities || []).map((en) => (
                  <option key={en.entity_id} value={en.entity_id}>
                    {en.legal_name || en.entity_id.slice(0, 8)}
                  </option>
                ))}
              </Select>
              <span className="micro ml-2">{tr("Preview")}</span>
              <Select
                aria-label="Preview with record"
                value={recordId}
                onChange={(e) => setRecordId(e.target.value)}
                className="h-8 w-auto"
              >
                <option value="">Sample data</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label || r.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <iframe
            title="preview"
            srcDoc={html}
            className="h-[78vh] w-full bg-white"
            sandbox=""
          />
        </div>

        {/* Beautify controls */}
        <div className="lux-card max-h-[82vh] space-y-4 overflow-auto p-4">
          <div>
            <div className="micro mb-2">Brand</div>
            <div className="space-y-2">
              <Field label="Accent colour">
                <Input
                  type="color"
                  value={s(cfg.accent, "#F5821F")}
                  onChange={(e) => set({ accent: e.target.value })}
                  className="h-9 w-full"
                />
              </Field>
              <Field
                label="Language"
                hint={tr(
                  "Documents print in one language per sheet. Leave unset to use the entity's default language.",
                )}
              >
                <Select
                  value={s(cfg.language, "")}
                  onChange={(e) => set({ language: e.target.value || null })}
                >
                  <option value="">{tr("Entity default")}</option>
                  <option value="fr">{tr("Français")}</option>
                  <option value="en">{tr("English")}</option>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Paper">
                  <Select
                    value={s(cfg.paper, "A4")}
                    onChange={(e) => set({ paper: e.target.value })}
                  >
                    <option>A4</option>
                    <option>Letter</option>
                  </Select>
                </Field>
                <Field label="Margin (mm)">
                  <Input
                    type="number"
                    value={s(cfg.margin_mm, "16")}
                    onChange={(e) => set({ margin_mm: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <Check
                label="Show logo"
                checked={logo.show !== false}
                onChange={(v) => setNested("logo", { show: v })}
              />
              <Field label="Logo align">
                <Select
                  value={s(logo.align, "left")}
                  onChange={(e) => setNested("logo", { align: e.target.value })}
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </Select>
              </Field>
            </div>
          </div>

          <div>
            <div className="micro mb-2">Sections</div>
            <Check
              label="Tax breakdown"
              checked={show.tax_breakdown !== false}
              onChange={(v) => setNested("show", { tax_breakdown: v })}
            />
            <Check
              label={tr("Notes")}
              checked={show.notes !== false}
              onChange={(v) => setNested("show", { notes: v })}
            />
            <Check
              label="Bank details"
              checked={show.bank !== false}
              onChange={(v) => setNested("show", { bank: v })}
            />
            <Check
              label="Terms & conditions"
              checked={show.terms !== false}
              onChange={(v) => setNested("show", { terms: v })}
            />
            <Check
              label="Signature block"
              checked={show.signature !== false}
              onChange={(v) => setNested("show", { signature: v })}
            />
            <Check
              label="Verify QR line"
              checked={show.qr !== false}
              onChange={(v) => setNested("show", { qr: v })}
            />
          </div>

          <div>
            <div className="micro mb-2">Content</div>
            <div className="space-y-2">
              <Field label="Footer text">
                <Input
                  value={s(cfg.footer_text)}
                  onChange={(e) => set({ footer_text: e.target.value })}
                  placeholder="Thank you for your business"
                />
              </Field>
              <Field label="Terms & conditions">
                <Textarea
                  value={s(cfg.terms)}
                  onChange={(e) => set({ terms: e.target.value })}
                  rows={3}
                  placeholder="Payable under 30 days…"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Signatory name">
                  <Input
                    value={s(sig.name)}
                    onChange={(e) =>
                      setNested("signature", { name: e.target.value })
                    }
                  />
                </Field>
                <Field label="Signatory title">
                  <Input
                    value={s(sig.title)}
                    onChange={(e) =>
                      setNested("signature", { title: e.target.value })
                    }
                  />
                </Field>
              </div>
              {/*
                * THE COMPANY CACHET — the round rubber stamp a Cameroonian
                * commercial document carries, and what a client's filing clerk
                * looks for on a transit order.
                *
                * It has been in the config shape since the kit existed and has
                * never had a control or been rendered, so every tenant printed
                * an empty signature box.
                *
                * It is NOT a signature and the product must never present it as
                * one: an uploaded image proves nothing about who applied it,
                * which is why the signatures engine has no `UPLOAD` mark
                * (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.4). What it is, is the
                * house mark. The evidentiary claim on a signed document comes
                * from the seal printed beneath it.
                */}
              <Field label="Company stamp (cachet)">
                <div className="space-y-2">
                  {sig.image_url ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={String(sig.image_url)}
                        alt=""
                        className="h-14 rounded border border-[rgb(var(--ink)/0.12)] bg-white p-1"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setNested("signature", { image_url: "" })}
                      >
                        {tr("Remove")}
                      </Button>
                    </div>
                  ) : null}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      // Held as a data URI in the config, exactly like a small
                      // inline logo: the renderer has no page origin, so a
                      // relative URL would resolve in the preview iframe and
                      // silently not in the PDF.
                      const reader = new FileReader();
                      reader.onload = () =>
                        setNested("signature", {
                          image_url: String(reader.result || ""),
                        });
                      reader.readAsDataURL(file);
                      e.target.value = "";
                    }}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      "Printed in the company signature box. A transparent PNG of the stamp reproduces best.",
                    )}
                  </p>
                </div>
              </Field>
              <Field label="Watermark">
                <Input
                  value={s(cfg.watermark)}
                  onChange={(e) => set({ watermark: e.target.value })}
                  placeholder="DRAFT / PAID / COPY"
                />
              </Field>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default TemplateStudioPage;
