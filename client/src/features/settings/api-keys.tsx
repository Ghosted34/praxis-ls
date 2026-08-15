/**
 * Settings — third-party integration secrets.
 *
 * Split out of `features/settings/config-pages.tsx` in Phase 4 (audit F7).
 * Write-only: keys are never returned by the API, only their last 4 characters,
 * which is why the form has no populated-value state to render.
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { errMsg, useList, useRefresh } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";

type Integration = {
  key: string;
  provider: string;
  keyName: string;
  label: string;
  hint: string;
};
const KNOWN_INTEGRATIONS: Integration[] = [];
// Secrets configured by a dedicated screen — never surfaced on this generic page.
const DOMAIN_OWNED = new Set(["fx_exchangerate", "email_smtp_pass"]);

type KeyInit = {
  key?: string;
  label?: string;
  provider?: string;
  keyName?: string;
  locked?: boolean;
  configured?: boolean;
};

function KeyForm({
  open,
  onClose,
  onSaved,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial: KeyInit | null;
}) {
  const locked = !!initial?.locked;
  const configured = !!initial?.configured;
  const [key, setKey] = React.useState("");
  const [provider, setProvider] = React.useState("");
  const [keyName, setKeyName] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setKey(initial?.key ?? "");
    setProvider(initial?.provider ?? "");
    setKeyName(initial?.keyName ?? "");
    setSecret("");
    setError(null);
  }, [open, initial]);

  const canSubmit =
    !!key.trim() && !!provider.trim() && !!secret.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant(
        `/settings/integration_secret/${encodeURIComponent(key.trim())}`,
        {
          method: "PUT",
          body: {
            value: {
              provider: provider.trim(),
              key_name: keyName.trim() || undefined,
              secret: secret.trim(),
            },
          },
        },
      );
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const title = configured
    ? `Rotate ${initial?.label ?? key}`
    : initial?.label
      ? `Set up ${initial.label}`
      : "Add key";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Encrypted, write-only third-party key. It is never returned — only the last 4 characters are shown."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Key" hint="Stable identifier used in code" required>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="fx_exchangerate"
              disabled={locked}
            />
          </Field>
          <Field label="Provider" required>
            <Input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="exchangerate-api"
              disabled={locked}
            />
          </Field>
          <Field label="Key name" hint="Optional label (e.g. env var name)">
            <Input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="EXCHANGERATE_API_KEY"
            />
          </Field>
          <Field
            label="Secret"
            hint={
              configured
                ? "Enter the new value to rotate."
                : "Stored encrypted; never returned."
            }
            required
          >
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={configured ? "•••••• (new value)" : "paste key…"}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {configured ? "Rotate key" : "Save key"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ApiKeysPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/settings/integration_secret");
  const [formOpen, setFormOpen] = React.useState(false);
  const [initial, setInitial] = React.useState<KeyInit | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<{
    key: string;
    ok: boolean;
    text: string;
  } | null>(null);

  // Known integrations always show (as "Set up" rows until configured); any
  // other configured keys are appended as custom rows.
  const display = React.useMemo(() => {
    const known = KNOWN_INTEGRATIONS.map((k) => ({
      key: k.key,
      label: k.label,
      provider: k.provider,
      keyName: k.keyName,
      hint: k.hint,
      row: (rows || []).find((r) => String(r.key) === k.key),
    }));
    const extra = (rows || [])
      .filter(
        (r) =>
          !KNOWN_INTEGRATIONS.some((k) => k.key === String(r.key)) &&
          !DOMAIN_OWNED.has(String(r.key)),
      )
      .map((r) => {
        const v = (r.value || {}) as { provider?: string; key_name?: string };
        return {
          key: String(r.key),
          label: String(r.key),
          provider: v.provider || "",
          keyName: v.key_name || "",
          hint: "",
          row: r,
        };
      });
    return [...known, ...extra];
  }, [rows]);

  function openAdd() {
    setInitial(null);
    setFormOpen(true);
  }
  function openConfigure(d: (typeof display)[number]) {
    const v = (d.row?.value || {}) as { last4?: string };
    // key + provider are locked for a specific integration so the stored value
    // keeps matching the backend consumer + test probe.
    setInitial({
      key: d.key,
      label: d.label,
      provider: d.provider,
      keyName: d.keyName,
      locked: true,
      configured: !!v.last4,
    });
    setFormOpen(true);
  }

  async function test(key: string) {
    setRowBusy(key);
    setTestResult(null);
    try {
      const res = await tenant<{
        ok?: boolean;
        provider?: string;
        error?: string;
      }>(`/settings/integration_secret/${encodeURIComponent(key)}/test`, {
        method: "POST",
      });
      setTestResult({
        key,
        ok: res.ok === true,
        text: res.ok ? "Connected." : res.error || "Test failed.",
      });
    } catch (e) {
      setTestResult({ key, ok: false, text: errMsg(e) });
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="API keys & secrets"
        description={
          <>
            Encrypted, write-only third-party integration keys (FX &amp; more).
            Keys are never returned — only their last 4 characters. AI provider
            keys are managed in the platform console.
          </>
        }
        action={<Button onClick={openAdd}>Add key</Button>}
      />

      {testResult && (
        <Callout
          tone={testResult.ok ? "ok" : "bad"}
          title={`${testResult.key}:`}
          className="mb-3"
        >
          {testResult.text}
        </Callout>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : display.length === 0 ? (
        <EmptyState
          title="No custom keys"
          hint="FX lives in Currencies & FX, messaging keys in Comms → Setup, and AI keys in AI Control. Use “Add key” for anything else."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Integration</TH>
              <TH>Provider</TH>
              <TH>Secret</TH>
              <TH>Updated</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {display.map((d) => {
              const v = (d.row?.value || {}) as { last4?: string };
              const isSet = !!v.last4;
              return (
                <TR key={d.key}>
                  <TD className="text-sm font-medium">
                    {d.label}
                    {d.label !== d.key && (
                      <span className="ml-2 num text-xs text-muted-foreground">
                        {d.key}
                      </span>
                    )}
                    {d.hint && (
                      <div className="text-xs font-normal text-muted-foreground">
                        {d.hint}
                      </div>
                    )}
                  </TD>
                  <TD className="text-sm">{cell(d.provider)}</TD>
                  <TD className="text-sm">
                    {isSet ? (
                      <Pill tone="ok">{`Set · …${v.last4}`}</Pill>
                    ) : (
                      <Pill tone="mute">Not set</Pill>
                    )}
                  </TD>
                  <TD className="text-sm">{dateFmt(d.row?.updated_at)}</TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openConfigure(d)}
                      >
                        {isSet ? "Rotate" : "Set up"}
                      </Button>
                      {isSet && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={rowBusy === d.key}
                          onClick={() => test(d.key)}
                        >
                          Test
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <KeyForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
        initial={initial}
      />
    </section>
  );
}

/* ─────────────────────── Pipeline stages ─────────────────────── */
