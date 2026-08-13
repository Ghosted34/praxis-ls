/**
 * Settings — document numbering schemes, per module.
 *
 * Split out of `features/settings/config-pages.tsx` in Phase 4 (audit F7). The
 * live preview matters more than it looks: a numbering scheme is effectively
 * immutable once documents exist under it, so seeing the result before saving
 * is the only cheap moment to catch a mistake.
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { ErrorState } from "@/components/ui/states";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/modal";

const RESET_OPTIONS = ["yearly", "never"];

type Scheme = { prefix?: string; code?: string; padding?: number; reset?: string; separator?: string };

function previewOf(s: Scheme): string {
  const sep = s.separator ?? "-";
  const year = new Date().getUTCFullYear();
  const seq = String(1).padStart(Math.max(1, Number(s.padding) || 4), "0");
  const parts = [s.prefix, s.code, s.reset === "never" ? null : year, seq].filter((p) => p !== null && p !== undefined && p !== "");
  return parts.join(sep);
}

function NumberingEditor({ moduleKey, label }: { moduleKey: string; label: string }) {
  const [scheme, setScheme] = React.useState<Scheme | null>(null);
  const [isDefault, setIsDefault] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    setSaved(false);
    tenant<{ scheme: Scheme; is_default: boolean }>(`/numbering-schemes/${encodeURIComponent(moduleKey)}`)
      .then((d) => {
        if (!live) return;
        setScheme(d.scheme || {});
        setIsDefault(d.is_default !== false);
      })
      .catch((e) => live && setError(errMsg(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [moduleKey]);

  function patch(p: Partial<Scheme>) {
    setScheme((s) => ({ ...(s || {}), ...p }));
    setSaved(false);
  }

  async function save() {
    if (!scheme) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        scheme: {
          prefix: scheme.prefix || undefined,
          code: scheme.code || undefined,
          padding: scheme.padding ? Number(scheme.padding) : undefined,
          reset: scheme.reset || undefined,
          separator: scheme.separator || undefined,
        },
      };
      const d = await tenant<{ scheme: Scheme; is_default: boolean }>(`/numbering-schemes/${encodeURIComponent(moduleKey)}`, { method: "PUT", body });
      setScheme(d.scheme || scheme);
      setIsDefault(d.is_default !== false);
      setSaved(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageSkeleton rows={5} cols={3} />;
  if (error && !scheme) return <ErrorState message={error} />;
  if (!scheme) return null;

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">{label}</span>
          <span className="ml-2 text-xs text-muted-foreground">{moduleKey}</span>
          {isDefault && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">default</span>}
        </div>
        <code className="rounded bg-background px-2 py-1 text-xs">{previewOf(scheme)}</code>
      </div>
      <div className="grid gap-4 sm:grid-cols-5">
        <Field label="Prefix">
          <Input value={scheme.prefix ?? ""} onChange={(e) => patch({ prefix: e.target.value })} placeholder="INV" />
        </Field>
        <Field label="Code" hint="Segment after prefix">
          <Input value={scheme.code ?? ""} onChange={(e) => patch({ code: e.target.value })} placeholder="51" />
        </Field>
        <Field label="Padding">
          <Input type="number" min="1" max="10" className="num text-right" value={scheme.padding ?? 4} onChange={(e) => patch({ padding: Number(e.target.value) })} />
        </Field>
        <Field label="Reset">
          <Select value={scheme.reset ?? "yearly"} onChange={(e) => patch({ reset: e.target.value })}>
            {RESET_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Separator">
          <Input maxLength={3} value={scheme.separator ?? "-"} onChange={(e) => patch({ separator: e.target.value })} placeholder="-" />
        </Field>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorState message={error} />
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-ok">Saved.</span>}
        <Button size="sm" onClick={save} loading={busy}>
          Save scheme
        </Button>
      </div>
    </div>
  );
}

// The document types that actually draw a number from the tenant's numbering
// sequences — the moduleKey each issuer passes to numbering.allocate(). This is
// the canonical list (mirrors scripts/tenant/seed-numbering.js and the
// document_vault doc_type registry); the page is driven by it instead of the
// full module catalogue, which listed every MOD-xx (IAM, WMS, HR…) — none of
// which issue documents — and required IAM-view access just to load.
const DOC_NUMBER_MODULES: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: "Documents",
    items: [
      { key: "MOD-51", label: "Final invoice" },
      { key: "MOD-51-CN", label: "Credit note" },
      { key: "MOD-50", label: "Proforma / customer advance" },
      { key: "MOD-52", label: "Payment receipt" },
      { key: "MOD-27", label: "Quotation" },
      { key: "MOD-23", label: "Proposal" },
      { key: "MOD-60", label: "Purchase order" },
      { key: "MOD-62", label: "Purchase request" },
      { key: "MOD-61", label: "Supplier invoice" },
      { key: "MOD-30", label: "Transit order" },
      { key: "MOD-32", label: "Delivery note" },
      { key: "MOD-29", label: "Dossier / operations file" },
      { key: "MOD-49", label: "Cash request / régie advance" },
    ],
  },
  {
    group: "Master codes",
    items: [
      { key: "MOD-04", label: "Supplier code" },
      { key: "MOD-03", label: "Client code" },
    ],
  },
  {
    group: "Master documents",
    items: [
      { key: "MOD-01-DOC", label: "Corporate entity document" },
      { key: "MOD-04-DOC", label: "Supplier KYC document" },
      { key: "MOD-03-DOC", label: "Client KYC document" },
    ],
  },
];

const DOC_MODULE_LABEL: Record<string, string> = Object.fromEntries(
  DOC_NUMBER_MODULES.flatMap((g) => g.items.map((it) => [it.key, it.label])),
);

export function NumberingPage() {
  const [selected, setSelected] = React.useState<string>(DOC_NUMBER_MODULES[0].items[0].key);

  return (
    <section className={pageShell.reading}>
      <PageHeader eyebrow={<HubCrumb area="Settings" to="/settings" />} title="Document numbering" description="Per-document numbering schemes — prefix, padding, reset cadence and separator." />

      <div className="space-y-4">
        <Field label="Document type">
          <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {/* Disabled header rows group the list while staying direct <option>
                children, so the Select's option-colour styling still applies
                (an <optgroup> would nest them and lose it in dark mode). */}
            {DOC_NUMBER_MODULES.map((g) => (
              <React.Fragment key={g.group}>
                <option disabled>{"— " + g.group + " —"}</option>
                {g.items.map((it) => (
                  <option key={it.key} value={it.key}>
                    {it.label}
                  </option>
                ))}
              </React.Fragment>
            ))}
          </Select>
        </Field>
        <NumberingEditor key={selected} moduleKey={selected} label={DOC_MODULE_LABEL[selected] || selected} />
      </div>
    </section>
  );
}
