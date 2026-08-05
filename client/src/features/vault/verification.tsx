/**
 * Vault — hash verification: does this file still match what was stored?
 *
 * Split out of `features/vault/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";
import { cell } from "@/lib/format";
import { Callout } from "@/components/ui/callout";
import { Segmented } from "@/components/ui/segmented";

export function VerificationPage() {
  const [kind, setKind] = React.useState<"entity_ref" | "doc_id">("entity_ref");
  const [target, setTarget] = React.useState("");
  const [hash, setHash] = React.useState("");
  const [result, setResult] = React.useState<Row | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canVerify = !!target.trim() && hash.trim().length >= 4 && !busy;

  async function verify() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const qs = new URLSearchParams();
      qs.set("hash", hash.trim());
      qs.set(kind, target.trim());
      const r = await tenant<Row>(`/document-verification/verify?${qs.toString()}`);
      setResult(r);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const verified = result ? result.verified === true : null;

  return (
    <section className={pageShell.reading}>
      <PageHeader eyebrow={<HubCrumb area="Vault & compliance" to="/vault" />} title="Document verification" description="Check a document's fingerprint against the vault — confirms it hasn't been tampered with." />
      <HubTabs />
      <form
        className="lux-card space-y-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canVerify) verify();
        }}
      >
        <Field label="Look up by">
          <Segmented
            label="Look up by"
            value={kind}
            onChange={(v) => setKind(v)}
            options={[
              { value: "entity_ref", label: "Reference" },
              { value: "doc_id", label: "Document ID" },
            ]}
          />
        </Field>
        <Field label={kind === "entity_ref" ? "Document reference" : "Document ID"} required>
          <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={kind === "entity_ref" ? "DOSSIER-2026-0042" : "uuid…"} />
        </Field>
        <Field label="Hash" required hint="The fingerprint from the QR / document (min 4 chars)">
          <Input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="a1b2c3d4…" />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!canVerify}>
            Verify
          </Button>
        </div>
      </form>

      {result && (
        <div className={`lux-card mt-4 p-4 ${verified ? "border-ok/40" : "border-bad/40"}`}>
          <Callout tone={verified ? "ok" : "bad"} title={verified ? "Verified" : "Not verified"}>
            {verified ? "The stored hash matches this document — no tampering." : "The stored hash does not match this document."}
          </Callout>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-medium">{cell(result.doc_type)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-medium">{cell(result.version_no)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="font-medium">{cell(result.entity_ref)}</dd>
            </div>
            <div className="flex justify-between gap-4 sm:col-span-2">
              <dt className="text-muted-foreground">Stored hash</dt>
              <dd className="truncate font-mono text-xs">{cell(result.content_hash)}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
