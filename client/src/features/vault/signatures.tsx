/**
 * Vault — signatures on a document reference.
 *
 * Split out of `features/vault/pages.tsx` in Phase 4 (audit F7). Search-first by
 * design: it fetches nothing until a reference is entered, so its "empty" IS
 * its arrival state.
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { errMsg, useList, useRefresh } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { isGated } from "./shared";

const SIGN_METHODS = [
  { value: "DIGITAL", label: "Digital" },
  { value: "PHYSICAL", label: "Physical" },
];

function SignForm({ open, entityRef, onClose, onSaved }: { open: boolean; entityRef: string; onClose: () => void; onSaved: () => void }) {
  const [signerName, setSignerName] = React.useState("");
  const [method, setMethod] = React.useState("DIGITAL");
  const [signatureRef, setSignatureRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSignerName("");
    setMethod("DIGITAL");
    setSignatureRef("");
    setError(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/signatures", {
        method: "POST",
        body: { entity_ref: entityRef, signer_name: signerName.trim() || undefined, method, signature_ref: signatureRef.trim() || undefined },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add signature" description={`Sign the document at reference "${entityRef}" — bound to its content fingerprint.`} size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Signer name" hint="Defaults to you if left blank">
            <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {SIGN_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Signature reference" hint="Optional external ref (e-sign id, doc №)" className="sm:col-span-2">
            <Input value={signatureRef} onChange={(e) => setSignatureRef(e.target.value)} placeholder="docusign:abc123" />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Add signature
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SignaturesPage() {
  const [refInput, setRefInput] = React.useState("");
  const [activeRef, setActiveRef] = React.useState("");
  const reload = useRefresh();
  const { rows, error, errorCode } = useList(activeRef ? `/signatures?entity_ref=${encodeURIComponent(activeRef)}` : null);
  const [signOpen, setSignOpen] = React.useState(false);
  const gated = isGated(errorCode);

  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Vault & compliance" to="/vault" />} title="Signatures" description="Signatures are bound to a document's fingerprint. Look one up by its reference, then sign." />
      <HubTabs />
      <form
        className="mb-5 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setActiveRef(refInput.trim());
        }}
      >
        <Field label="Document reference" className="min-w-64 flex-1">
          <Input value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="DOSSIER-2026-0042" />
        </Field>
        <Button type="submit" disabled={!refInput.trim()}>
          Look up
        </Button>
      </form>

      {!activeRef ? (
        <EmptyState title="Enter a reference" hint="Type a document reference above to see its signatures." />
      ) : gated ? (
        <EmptyState title="Signatures aren't enabled" hint="The `signatures` feature flag is off for this tenant (or you lack access)." />
      ) : error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {rows.length} signature{rows.length === 1 ? "" : "s"} on <span className="font-medium text-foreground">{activeRef}</span>
            </p>
            <Button size="sm" onClick={() => setSignOpen(true)}>
              Add signature
            </Button>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No signatures yet" hint="Be the first to sign this document." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Signer</TH>
                  <TH>Method</TH>
                  <TH>Signed</TH>
                  <TH>Reference</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={String(r.signature_id ?? r.document_signature_id ?? `${r.entity_ref}-${r.signed_at}`)}>
                    <TD className="text-sm font-medium">{cell(r.signer_name ?? r.signer_user_id)}</TD>
                    <TD className="text-sm">
                      <StatusPill status={String(r.method ?? "—")} />
                    </TD>
                    <TD className="text-sm">{dateFmt(r.signed_at ?? r.created_at)}</TD>
                    <TD className="text-sm">{cell(r.signature_ref)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}

      <SignForm open={signOpen} entityRef={activeRef} onClose={() => setSignOpen(false)} onSaved={reload} />
    </section>
  );
}

/* ═══════════════════════════════════ VERIFICATION ═══════════════════════════════════ */
