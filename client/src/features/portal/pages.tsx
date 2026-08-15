/**
 * Portal access — manage external read-access grants (Client / Investor
 * / Auditor) and preview the exact scope each grantee would see. The external
 * data views are feature-gated (portal.client / portal.investor / portal.audit);
 * previews degrade gracefully when a flag is off.
 *
 * Shared primitives from components/ui/*; AI panel gated globally.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { SearchSelect } from "@/components/ui/search-select";
import { DataView } from "@/components/ui/data-view";

const PORTAL_AI: AiAction[] = [
  {
    label: "Review access",
    kind: "read",
    describe:
      "Summarise who currently has portal access and when grants expire.",
  },
];

const PORTALS = ["CLIENT", "INVESTOR", "AUDITOR"];

function GrantModal({
  open,
  clients,
  onClose,
  onSaved,
}: {
  open: boolean;
  clients: Row[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [portal, setPortal] = React.useState("CLIENT");
  const [email, setEmail] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [invite, setInvite] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPortal("CLIENT");
    setEmail("");
    setClientId("");
    setExpiresAt("");
    setInvite(true);
    setError(null);
    setNotice(null);
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

      // Create the LOGIN as well, not just the grant.
      //
      // Until 2026-08-02 this screen stopped at the line above — and a grant on
      // its own is unusable, because `portal_access` is keyed by email while the
      // credentials live in `portal_user`, which nothing ever created. Every
      // grant issued before today points at somebody who cannot sign in.
      //
      // Sent as a SEPARATE, non-fatal step: the grant is the record that matters
      // and must not be rolled back because an SMTP server was down. If the
      // invite fails we say so and offer "Resend" on the row, rather than
      // reporting success and leaving staff to discover it from the client.
      let problem: string | null = null;
      if (invite) {
        try {
          const r = await tenant<{ emailed: boolean }>("/portal/users/invite", {
            method: "POST",
            body: { email: email.trim() },
          });
          if (!r.emailed)
            problem =
              "Access granted, but the invitation email could not be sent. Use Resend on the row.";
        } catch (e) {
          problem = `Access granted, but the invitation could not be sent (${errMsg(e)}). Use Resend on the row.`;
        }
      }
      onSaved();
      // Held open on a problem so the message is actually read — closing the
      // modal on a partial success is how the gap stayed invisible before.
      setNotice(problem);
      if (!problem) onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const clientLabel = (() => {
    const c = (clients || []).find((x) => String(x.client_id) === clientId);
    return c ? cell(c.name ?? c.legal_name) : null;
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Grant portal access"
      description="Give an external party a scoped, read-only view."
      size="lg"
    >
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
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cfo@acme.cm"
            />
          </Field>
          {portal === "CLIENT" && (
            <Field
              label="Client scope"
              hint="They only ever see this client"
              required
            >
              <SearchSelect
                path="/clients"
                value={clientLabel}
                placeholder="Search clients…"
                getLabel={(c) => cell(c.name ?? c.legal_name)}
                getKey={(c) => String(c.client_id)}
                onSelect={(c) => setClientId(String(c.client_id))}
              />
            </Field>
          )}
          <Field label="Expires at" hint="Optional — recommended for auditors">
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </Field>
        </div>

        {/* A grant without a login is unusable — portal_access is keyed by email
            and the credentials live in portal_user. On by default for that
            reason; turn it off only when the person already has a sign-in. */}
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={invite}
            onChange={(e) => setInvite(e.target.checked)}
          />
          <span>
            Email them a link to set a password
            <span className="block text-xs text-muted-foreground">
              Without a sign-in, a grant alone doesn't let anyone in. Leave this
              on unless they already have one.
            </span>
          </span>
        </label>

        {error && <ErrorState message={error} />}
        {notice && (
          <div className="rounded-lg border border-[hsl(var(--warn))]/40 bg-[hsl(var(--warn))]/10 p-3 text-sm text-foreground">
            {notice}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {notice ? "Close" : "Cancel"}
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={!email.trim() || busy}
          >
            Grant access
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PreviewModal({
  open,
  title,
  path,
  onClose,
}: {
  open: boolean;
  title: string;
  path: string;
  onClose: () => void;
}) {
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

  const gated =
    error && /feature|not enabled|disabled|forbidden|permission/i.test(error);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Exactly what this grantee would see."
      size="xl"
    >
      <div className="space-y-4">
        {error ? (
          gated ? (
            <EmptyState
              title="This portal view isn't enabled"
              hint="The portal.* feature flag for this view is off. Enable it to preview the external scope."
            />
          ) : (
            <ErrorState message={error} />
          )
        ) : data === undefined ? (
          <LoadingRow label="Loading scope…" />
        ) : (
          <DataView
            data={data}
            emptyTitle="This grantee would see nothing here"
            emptyHint="The scope resolves to no records — check the grant's client and date range."
            className="max-h-96 overflow-auto"
          />
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
  const reload = useRefresh();
  const { rows, error } = useList("/portals/access");
  const { rows: clients } = useList("/clients");
  // Logins, so a grant can say whether the person can actually sign in. Matched
  // in the CLIENT rather than joined server-side: portal_access is per-environment
  // business data while portal_user is identity (live) data, and a cross-schema
  // join is exactly the trap that broke TEST-mode writes for fourteen sessions.
  const { rows: portalUsers } = useList("/portal/users");
  const [grantOpen, setGrantOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<{
    title: string;
    path: string;
  } | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const [rowNotice, setRowNotice] = React.useState<string | null>(null);

  const clientName = React.useMemo(
    () =>
      new Map(
        (clients || []).map((c) => [
          String(c.client_id),
          cell(c.name ?? c.legal_name),
        ]),
      ),
    [clients],
  );
  const loginByEmail = React.useMemo(
    () =>
      new Map(
        (portalUsers || []).map((u) => [
          String(u.email || "").toLowerCase(),
          u,
        ]),
      ),
    [portalUsers],
  );

  /** Create-or-find the login and (re)send the set-password link. */
  async function invite(email: string) {
    setRowBusy(email);
    setRowError(null);
    setRowNotice(null);
    try {
      const r = await tenant<{ emailed: boolean; created: boolean }>(
        "/portal/users/invite",
        {
          method: "POST",
          body: { email },
        },
      );
      setRowNotice(
        r.emailed
          ? `Invitation sent to ${email}.`
          : `Login ready for ${email}, but the email could not be sent — check the SMTP settings and resend.`,
      );
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  async function revoke(id: string) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/portals/access/${id}/revoke`, {
        method: "POST",
        body: {},
      });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Portal" to="/portal/access" />}
        title="Portal access"
        description="Grant and revoke external read-access — client, investor and auditor portals."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setPreview({
                  title: "Investor portal preview",
                  path: "/portals/investor",
                })
              }
            >
              Preview investor
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setPreview({
                  title: "Auditor portal preview",
                  path: "/portals/auditor",
                })
              }
            >
              Preview auditor
            </Button>
            <Button onClick={() => setGrantOpen(true)}>Grant access</Button>
          </div>
        }
      />

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}
      {rowNotice && (
        <div className="mb-3 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          {rowNotice}
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No active grants"
          hint="Grant a client, investor or auditor scoped read-access to get started."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((g) => {
            const id = String(g.portal_access_id);
            const portal = String(g.portal);
            const email = String(g.subject_email || "").toLowerCase();
            // A grant with no portal_user is a grant nobody can use. Surfaced on
            // the row because it is invisible otherwise — the failure only shows
            // up as a client saying "your link doesn't work".
            const login = loginByEmail.get(email);
            const signedInBefore = !!(login && login.last_login_at);
            return (
              <div
                key={id}
                className="lux-card flex flex-wrap items-center gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {cell(g.subject_email)}
                    </p>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary-ink">
                      {portal.toLowerCase()}
                    </span>
                    {!login ? (
                      <span className="rounded-full bg-[hsl(var(--warn))]/15 px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--warn))]">
                        no sign-in
                      </span>
                    ) : !signedInBefore ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        invited
                      </span>
                    ) : null}
                    {g.expires_at ? (
                      <span className="text-xs text-muted-foreground">
                        expires {dateFmt(g.expires_at)}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {g.client_id
                      ? `Scope: ${clientName.get(String(g.client_id)) ?? "client"} · `
                      : ""}
                    granted {dateFmt(g.created_at)}
                    {signedInBefore
                      ? ` · last signed in ${dateFmt(login.last_login_at)}`
                      : ""}
                  </p>
                </div>
                {portal === "CLIENT" && !!g.client_id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setPreview({
                        title: `Client portal — ${clientName.get(String(g.client_id)) ?? ""}`,
                        path: `/portals/client?client_id=${String(g.client_id)}`,
                      })
                    }
                  >
                    Preview
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={login ? "ghost" : "outline"}
                  loading={rowBusy === email}
                  onClick={() => invite(email)}
                  title={
                    login
                      ? "Send a fresh set-password link"
                      : "Create the sign-in and email a set-password link"
                  }
                >
                  {login ? "Resend invite" : "Create sign-in"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={rowBusy === id}
                  onClick={() => revoke(id)}
                >
                  Revoke
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <AiActions actions={PORTAL_AI} />

      <GrantModal
        open={grantOpen}
        clients={clients}
        onClose={() => setGrantOpen(false)}
        onSaved={reload}
      />
      <PreviewModal
        open={!!preview}
        title={preview?.title ?? ""}
        path={preview?.path ?? ""}
        onClose={() => setPreview(null)}
      />
    </section>
  );
}
