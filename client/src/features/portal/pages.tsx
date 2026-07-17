/**
 * Portal access (MOD-67) — manage external read-access grants (Client / Investor
 * / Auditor) and preview the exact scope each grantee would see. The external
 * data views are feature-gated (portal.client / portal.investor / portal.audit);
 * previews degrade gracefully when a flag is off.
 *
 * Shared primitives from features/sales/ui.tsx; AI panel gated globally.
 */
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { Row, errMsg, cell, when, useList } from "@/features/sales/ui";

const PORTAL_AI: AiAction[] = [
  { label: "Review access", kind: "read", describe: "Summarise who currently has portal access and when grants expire." },
];

const PORTALS = ["CLIENT", "INVESTOR", "AUDITOR"];

function GrantModal({ open, clients, onClose, onSaved }: { open: boolean; clients: Row[] | null; onClose: () => void; onSaved: () => void }) {
  const [portal, setPortal] = React.useState("CLIENT");
  const [email, setEmail] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPortal("CLIENT");
    setEmail("");
    setClientId("");
    setExpiresAt("");
    setError(null);
  }, [open]);

  async function submit() {
    if (portal === "CLIENT" && !clientId) {
      setError("A client-portal grant needs a client to scope it to.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await tenant("/portals/access", {
        method: "POST",
        body: {
          portal,
          subject_email: email.trim(),
          client_id: portal === "CLIENT" ? clientId : undefined,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        },
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
    <Modal open={open} onClose={onClose} title="Grant portal access" description="Give an external party a scoped, read-only view (MOD-67)." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Portal" required>
            <Select value={portal} onChange={(e) => setPortal(e.target.value)}>
              {PORTALS.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0) + p.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Subject email" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cfo@acme.cm" />
          </Field>
          {portal === "CLIENT" && (
            <Field label="Client scope" hint="They only ever see this client" required>
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">— select —</option>
                {(clients || []).map((c) => (
                  <option key={String(c.client_id)} value={String(c.client_id)}>
                    {cell(c.name ?? c.legal_name)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Expires at" hint="Optional — recommended for auditors">
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!email.trim() || busy}>
            Grant access
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PreviewModal({ open, title, path, onClose }: { open: boolean; title: string; path: string; onClose: () => void }) {
  const [data, setData] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !path) return;
    let live = true;
    setData(undefined);
    setError(null);
    tenant<unknown>(path)
      .then((r) => live && setData(r))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [open, path]);

  const gated = error && /feature|not enabled|disabled|forbidden|permission/i.test(error);

  return (
    <Modal open={open} onClose={onClose} title={title} description="Exactly what this grantee would see." size="xl">
      <div className="space-y-4">
        {error ? (
          gated ? (
            <EmptyState title="This portal view isn't enabled" hint="The portal.* feature flag for this view is off. Enable it to preview the external scope." />
          ) : (
            <ErrorState message={error} />
          )
        ) : data === undefined ? (
          <LoadingRow label="Loading scope…" />
        ) : (
          <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">{JSON.stringify(data, null, 2)}</pre>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function PortalAccessPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/portals/access", nonce);
  const { rows: clients } = useList("/clients", nonce);
  const [grantOpen, setGrantOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<{ title: string; path: string } | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const clientName = React.useMemo(() => new Map((clients || []).map((c) => [String(c.client_id), cell(c.name ?? c.legal_name)])), [clients]);

  async function revoke(id: string) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/portals/access/${id}/revoke`, { method: "POST", body: {} });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Portal access</h1>
          <p className="mt-1 text-sm text-muted-foreground">Grant and revoke external read-access — client, investor and auditor portals (MOD-67).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setPreview({ title: "Investor portal preview", path: "/portals/investor" })}>
            Preview investor
          </Button>
          <Button variant="outline" onClick={() => setPreview({ title: "Auditor portal preview", path: "/portals/auditor" })}>
            Preview auditor
          </Button>
          <Button onClick={() => setGrantOpen(true)}>Grant access</Button>
        </div>
      </header>

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow label="Loading grants…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No active grants" hint="Grant a client, investor or auditor scoped read-access to get started." />
      ) : (
        <div className="space-y-2">
          {rows.map((g) => {
            const id = String(g.portal_access_id);
            const portal = String(g.portal);
            return (
              <div key={id} className="lux-card flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{cell(g.subject_email)}</p>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{portal.toLowerCase()}</span>
                    {g.expires_at ? <span className="text-xs text-muted-foreground">expires {when(g.expires_at)}</span> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {g.client_id ? `Scope: ${clientName.get(String(g.client_id)) ?? "client"} · ` : ""}granted {when(g.created_at)}
                  </p>
                </div>
                {portal === "CLIENT" && !!g.client_id && (
                  <Button size="sm" variant="ghost" onClick={() => setPreview({ title: `Client portal — ${clientName.get(String(g.client_id)) ?? ""}`, path: `/portals/client?client_id=${String(g.client_id)}` })}>
                    Preview
                  </Button>
                )}
                <Button size="sm" variant="outline" loading={rowBusy === id} onClick={() => revoke(id)}>
                  Revoke
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <AiActions actions={PORTAL_AI} />

      <GrantModal open={grantOpen} clients={clients} onClose={() => setGrantOpen(false)} onSaved={reload} />
      <PreviewModal open={!!preview} title={preview?.title ?? ""} path={preview?.path ?? ""} onClose={() => setPreview(null)} />
    </section>
  );
}
