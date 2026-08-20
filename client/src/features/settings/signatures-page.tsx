/**
 * Settings — Signatures (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.11).
 *
 * Level 2 of the eligibility funnel: which signature methods a document type
 * may offer. The levels around it are deliberately NOT here —
 *
 *   level 1  the doc-type ceiling, in code. A payslip is never wet-signed; a
 *            delivery note never needs certification. Shown as a disabled card
 *            with its reason, so an administrator can see WHY an option is
 *            missing rather than hunting for a switch that does not exist.
 *   level 3  the sender's two booleans, chosen per dispatch.
 *   level 4  the signer's own pick, on the signing page.
 *
 * The company seal is not configured here either: it derives entirely from
 * branding and entity data the system already holds. Nobody retypes what we
 * already know.
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { errMsg, type Row } from "@/lib/use-resource";
import { BLOCKED_REASON, ASSURANCE_WORDS, look } from "@/features/vault/signature-vocab";

type Preset = {
  preset_code: string;
  label_en: string;
  tier_label: string | null;
  assurance_level: string;
};

type Policy = { allowed: string[]; default: string };

/** The doc types that can carry a signature, mirroring SIGNATURE_CEILING. */
const DOC_TYPES = [
  "FINAL_INVOICE",
  "PROFORMA_ADVANCE",
  "QUOTATION",
  "PROPOSAL",
  "PURCHASE_ORDER",
  "DELIVERY_NOTE",
  "TRANSIT_ORDER",
  "EMPLOYMENT_CONTRACT",
];

const humanDocType = (t: string) =>
  t.toLowerCase().replace(/_/g, " ").replace(/^./, (m) => m.toUpperCase());

function DocTypeRow({
  docType,
  presets,
  policy,
  onSave,
}: {
  docType: string;
  presets: Preset[];
  policy: Policy;
  onSave: (docType: string, next: Policy) => Promise<void>;
}) {
  const [allowed, setAllowed] = React.useState<string[]>(policy.allowed);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => setAllowed(policy.allowed), [policy.allowed]);

  const dirty =
    allowed.length !== policy.allowed.length ||
    allowed.some((a) => !policy.allowed.includes(a));

  function toggle(code: string) {
    setSaved(false);
    setAllowed((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Keep the default inside the allowed set — a default nobody can pick is
      // how a signing page ends up offering nothing.
      const preferred = allowed.includes(policy.default) ? policy.default : allowed[0];
      await onSave(docType, { allowed, default: preferred });
      setSaved(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{humanDocType(docType)}</h3>
        {dirty ? (
          <Button size="sm" onClick={save} loading={busy} disabled={busy}>
            {tr("Save")}
          </Button>
        ) : saved ? (
          <span className="text-xs text-muted-foreground">{tr("Saved")}</span>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {presets.map((p) => {
          const on = allowed.includes(p.preset_code);
          return (
            <label
              key={p.preset_code}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-sm hover:bg-muted/40"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={on}
                onChange={() => toggle(p.preset_code)}
              />
              <span>
                <span className="block font-medium">{p.label_en}</span>
                <span className="block text-xs text-muted-foreground">
                  {look(ASSURANCE_WORDS, p.assurance_level, p.assurance_level)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {allowed.length === 0 ? (
        <p className="mt-2 text-xs text-destructive">
          {tr("With nothing selected, this document cannot be signed at all.")}
        </p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}

export function SignaturesSettingsPage() {
  const [presets, setPresets] = React.useState<Preset[] | null>(null);
  const [policies, setPolicies] = React.useState<Record<string, Policy>>({});
  const [behaviour, setBehaviour] = React.useState<Record<string, unknown>>({});
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [cat, section] = await Promise.all([
        tenant<Row[]>("/signatures/presets"),
        tenant<Record<string, unknown>>("/settings/signature_policy"),
      ]);
      setPresets((Array.isArray(cat) ? cat : []) as unknown as Preset[]);
      const next: Record<string, Policy> = {};
      const rest: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(section || {})) {
        if (DOC_TYPES.includes(key)) {
          const v = (value ?? {}) as Partial<Policy>;
          next[key] = { allowed: v.allowed ?? [], default: v.default ?? "STAMP" };
        } else {
          rest[key] = value;
        }
      }
      setPolicies(next);
      setBehaviour(rest);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function savePolicy(docType: string, value: Policy) {
    await tenant(`/settings/signature_policy/${encodeURIComponent(docType)}`, {
      method: "PUT",
      body: { value },
    });
    setPolicies((prev) => ({ ...prev, [docType]: value }));
  }

  async function saveBehaviour(key: string, value: unknown) {
    await tenant(`/settings/signature_policy/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: { value },
    });
    setBehaviour((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={tr("Signatures")}
        description="Which signing methods each kind of document may offer, and how identity is confirmed."
      />

      {error ? (
        <ErrorState message={error} />
      ) : presets === null ? (
        <SkeletonTable />
      ) : (
        <div className="space-y-6">
          <Callout tone="info" title={tr("How the choice narrows")}>
            You set what each document type <em>may</em> offer. The person sending a document can
            narrow it further for one dispatch, and the person signing picks from what is left.
            Options greyed out here are fixed in the product — a payslip is never signed on paper,
            and a delivery note never needs a certified signature.
          </Callout>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {tr("By document type")}
            </h2>
            <div className="space-y-3">
              {DOC_TYPES.map((t) => (
                <DocTypeRow
                  key={t}
                  docType={t}
                  presets={presets}
                  policy={policies[t] ?? { allowed: [], default: "STAMP" }}
                  onSave={savePolicy}
                />
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {tr("Identity")}
            </h2>
            <div className="rounded-lg border border-border p-4">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={behaviour.stepup_enabled === true}
                  onChange={(e) => saveBehaviour("stepup_enabled", e.target.checked)}
                />
                <span>
                  <span className="block font-medium">
                    {tr("Ask staff for an emailed code on high-value documents")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Staff always sign from their own account. Above the amount below, they also
                    enter a code sent to their work address. People outside your company always
                    enter a code, whatever this is set to.
                  </span>
                </span>
              </label>
              {behaviour.stepup_enabled === true ? (
                <Field
                  label={tr("Amount (XAF)")}
                  className="mt-3 max-w-xs"
                  hint="Leave empty to apply to every document."
                >
                  <Input
                    type="number"
                    defaultValue={
                      behaviour.stepup_threshold_xaf === null ||
                      behaviour.stepup_threshold_xaf === undefined
                        ? ""
                        : String(behaviour.stepup_threshold_xaf)
                    }
                    onBlur={(e) =>
                      saveBehaviour(
                        "stepup_threshold_xaf",
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  />
                </Field>
              ) : null}
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {tr("Verification")}
            </h2>
            <div className="space-y-3 rounded-lg border border-border p-4">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={behaviour.notify_on_scan === true}
                  onChange={(e) => saveBehaviour("notify_on_scan", e.target.checked)}
                />
                <span>
                  <span className="block font-medium">
                    {tr("Tell me when a document is verified from somewhere new")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Every verification is recorded either way. This only controls the notification.
                  </span>
                </span>
              </label>
              <Field
                label={tr("Keep verification records for (days)")}
                className="max-w-xs"
                hint="Verification records include the network address they came from."
              >
                <Input
                  type="number"
                  defaultValue={String(behaviour.scan_retention_days ?? 400)}
                  onBlur={(e) => saveBehaviour("scan_retention_days", Number(e.target.value))}
                />
              </Field>
            </div>
          </div>

          {Object.keys(policies).length === 0 ? (
            <EmptyState
              title={tr("No signature policy yet")}
              hint={BLOCKED_REASON.NOT_ENABLED_BY_TENANT}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
